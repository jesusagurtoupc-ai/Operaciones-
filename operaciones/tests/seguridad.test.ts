import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { errorSessionSecret, esValorDeEjemplo, nombreAdminInicial } from "@/lib/server/secretos";
import { limitesLogin } from "@/lib/server/limiteLogin";

const m = vi.hoisted(() => ({
  usuario: null as { username: string; rol: "admin" | "lectura" } | null,
  responder: (() => []) as (t: string) => unknown[],
}));

vi.mock("@/lib/server/db", () => ({
  sql: Object.assign(() => Promise.resolve(m.responder("")), {
    query: () => Promise.resolve(m.responder("")),
  }),
  ensureSchema: () => Promise.resolve(),
}));
vi.mock("@/lib/server/auth", () => ({
  SESSION_COOKIE_NAME: "correctivos_session",
  getCurrentUser: async () => m.usuario,
  getAdmin: async () => (m.usuario?.rol === "admin" ? m.usuario : null),
}));

const req = (url: string) => new NextRequest(`http://localhost${url}`);
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

beforeEach(() => {
  m.usuario = null;
  m.responder = () => [];
});

describe("las rutas de lectura comprueban la sesión por sí mismas (sin depender del proxy)", () => {
  it("devuelven 401 sin sesión", async () => {
    const llamadas: [string, () => Promise<Response>][] = [
      ["lista", async () => (await import("@/app/api/correctivos/route")).GET(req("/api/correctivos"))],
      ["detalle", async () => (await import("@/app/api/correctivos/[id]/route")).GET(req("/x"), ctx({ id: "1" }))],
      ["archivos", async () => (await import("@/app/api/correctivos/[id]/archivos/route")).GET(req("/x"), ctx({ id: "1" }))],
      [
        "archivo",
        async () =>
          (await import("@/app/api/correctivos/[id]/archivos/[archivoId]/route")).GET(req("/x"), ctx({ id: "1", archivoId: "1" })),
      ],
      ["export", async () => (await import("@/app/api/export/route")).GET(req("/api/export"))],
      ["dashboard", async () => (await import("@/app/api/dashboard/route")).GET()],
    ];
    for (const [nombre, llamar] of llamadas) {
      const res = await llamar();
      expect(res.status, nombre).toBe(401);
    }
  });
});

describe("archivos y exportación no se guardan en la caché del navegador", () => {
  it("el archivo se sirve con no-store", async () => {
    const { GET } = await import("@/app/api/correctivos/[id]/archivos/[archivoId]/route");
    m.usuario = { username: "ana", rol: "lectura" };
    m.responder = () => [{ nombre: "a.pdf", tipo: "application/pdf", b64: Buffer.from("%PDF-1").toString("base64") }];
    const res = await GET(req("/x"), ctx({ id: "1", archivoId: "1" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    // El PDF se abre sin `sandbox` (bloquearía el visor de Chrome); una imagen sí lo lleva.
    expect(res.headers.get("content-security-policy")).toBeNull();
    m.responder = () => [{ nombre: "a.png", tipo: "image/png", b64: Buffer.from("x").toString("base64") }];
    const img = await GET(req("/x"), ctx({ id: "1", archivoId: "2" }));
    expect(img.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("el Excel se sirve con no-store", async () => {
    const { GET } = await import("@/app/api/export/route");
    m.usuario = { username: "ana", rol: "lectura" };
    const res = await GET(req("/api/export"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});

describe("secretos de configuración", () => {
  it("SESSION_SECRET: exige longitud y rechaza valores de ejemplo", () => {
    expect(errorSessionSecret(undefined)).toMatch(/Falta/);
    expect(errorSessionSecret("corto")).toMatch(/32/);
    expect(errorSessionSecret("cambia-esto-por-una-cadena-aleatoria-larga")).toMatch(/ejemplo/);
    expect(errorSessionSecret("secreto-solo-para-ci-0123456789abcdef0123456789")).toMatch(/ejemplo/);
    expect(errorSessionSecret("a3f9c2e81b7d4c6a9e0f5b2d8c1a7e43")).toBeNull();
  });

  it("detecta contraseñas iniciales de ejemplo", () => {
    expect(esValorDeEjemplo("pon-aqui-una-contrasena-inicial")).toBe(true);
    expect(esValorDeEjemplo("admin")).toBe(true);
    expect(esValorDeEjemplo("Zq7!mP2xLw9#")).toBe(false);
  });

  it("nombre del administrador inicial: el indicado si es válido, si no 'admin'", () => {
    expect(nombreAdminInicial(" Jefe.TI ")).toBe("jefe.ti");
    expect(nombreAdminInicial("a")).toBe("admin");
    expect(nombreAdminInicial(undefined)).toBe("admin");
    expect(nombreAdminInicial("con espacio")).toBe("admin");
  });
});

describe("límite de login", () => {
  it("usa tres contadores distintos y no se pueden confundir entre sí", () => {
    const l = limitesLogin("ana", "1.2.3.4");
    expect(l).toHaveLength(3);
    expect(new Set(l.map((x) => x.clave)).size).toBe(3);
    expect(l[0].max).toBeLessThan(l[2].max);
    expect(l[2].max).toBeLessThan(l[1].max);
    // Un usuario llamado "1.2.3.4" no choca con el contador de esa IP.
    const raro = limitesLogin("1.2.3.4", "x");
    expect(raro.map((x) => x.clave)).not.toContain(l[1].clave);
  });
});

describe("permisos mínimos del rol de la aplicación", () => {
  it("valida el nombre del rol y genera sentencias sin permisos de DDL", async () => {
    const { rolValido, sentenciasPermisos, PERMISOS_TABLAS } = await import("../scripts/permisos.mjs");
    expect(rolValido("app_correctivos")).toBe(true);
    expect(rolValido('x"; DROP TABLE usuarios; --')).toBe(false);
    expect(() => sentenciasPermisos("Mal Nombre")).toThrow(/rol válido/);
    const todas = sentenciasPermisos("app_correctivos").join("\n");
    expect(todas).not.toMatch(/ALL PRIVILEGES|TRUNCATE|REFERENCES|TRIGGER/);
    expect(todas).toContain('REVOKE CREATE ON SCHEMA public FROM "app_correctivos"');
    // El historial y la auditoría solo se agregan: sin UPDATE ni DELETE (salvo la purga de accesos).
    expect(PERMISOS_TABLAS.historial).toEqual(["SELECT", "INSERT"]);
    expect(PERMISOS_TABLAS.auditoria_usuarios).toEqual(["SELECT", "INSERT"]);
    expect(PERMISOS_TABLAS.correctivos).not.toContain("DELETE");
  });
});

describe("contraseñas (reglas al crear o cambiar)", () => {
  it("rechaza cortas, de más de 72 bytes, comunes, repetidas y iguales al usuario", async () => {
    const { errorContrasena } = await import("@/lib/shared/passwords");
    expect(errorContrasena("corta")).not.toBeNull();
    expect(errorContrasena("a".repeat(73))).not.toBeNull();
    expect(errorContrasena("ñ".repeat(37))).not.toBeNull(); // 74 bytes aunque sean 37 caracteres
    expect(errorContrasena("Password123")).not.toBeNull();
    expect(errorContrasena("1234567890")).not.toBeNull();
    expect(errorContrasena("aaaaaaaaaaaa")).not.toBeNull();
    expect(errorContrasena("maria.lopez01", "maria.lopez01")).not.toBeNull();
  });
  it("acepta una contraseña razonable (hasta 72 bytes)", async () => {
    const { errorContrasena } = await import("@/lib/shared/passwords");
    expect(errorContrasena("trece-caballos-azules")).toBeNull();
    expect(errorContrasena("x7".repeat(36))).toBeNull(); // 72 bytes exactos
  });
});

describe("verificación de Origin en escrituras", () => {
  const post = (origen: string | null, metodo = "POST") =>
    new Request("https://app.example.com/api/correctivos", {
      method: metodo,
      headers: { host: "app.example.com", ...(origen === null ? {} : { origin: origen }) },
    });
  it("acepta el mismo sitio, la ausencia de Origin y las lecturas", async () => {
    const { origenValido } = await import("@/lib/server/origen");
    expect(origenValido(post("https://app.example.com"))).toBe(true);
    expect(origenValido(post(null))).toBe(true);
    expect(origenValido(post("https://malo.example.org", "GET"))).toBe(true);
  });
  it("rechaza otro sitio, \"null\" y Origin mal formado en POST/PUT/PATCH/DELETE", async () => {
    const { origenValido } = await import("@/lib/server/origen");
    for (const metodo of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(origenValido(post("https://malo.example.org", metodo))).toBe(false);
    }
    expect(origenValido(post("null"))).toBe(false);
    expect(origenValido(post("no es una url"))).toBe(false);
  });
});

describe("enlaces de documentos al mostrarse", () => {
  it("solo acepta archivos del propio ticket y direcciones http(s)", async () => {
    const { urlDocumentoSegura } = await import("@/lib/shared/archivos");
    expect(urlDocumentoSegura("/api/correctivos/5/archivos/9", 5)).toBe("/api/correctivos/5/archivos/9");
    expect(urlDocumentoSegura("/api/correctivos/6/archivos/9", 5)).toBeNull();
    expect(urlDocumentoSegura("https://sitio.example.com/a.pdf")).toBe("https://sitio.example.com/a.pdf");
    for (const mala of ["javascript:alert(1)", "data:text/html,x", "//evil.com/x", "/api/usuarios", ""]) {
      expect(urlDocumentoSegura(mala, 5)).toBeNull();
    }
  });
});

describe("verificación en dos pasos (TOTP)", () => {
  it("coincide con el vector de prueba del RFC 6238 (SHA-1, T=59 s → 94287082 → 287082)", async () => {
    const { codigoTotp, base32Encode } = await import("@/lib/server/mfa");
    const secreto = base32Encode(Buffer.from("12345678901234567890"));
    expect(codigoTotp(secreto, Math.floor(59 / 30))).toBe("287082");
    expect(codigoTotp(secreto, Math.floor(1111111109 / 30))).toBe("081804");
  });
  it("acepta ±1 paso, rechaza otros y no deja reutilizar un código", async () => {
    const { codigoTotp, verificarTotp, generarSecreto } = await import("@/lib/server/mfa");
    const s = generarSecreto();
    const ahora = 1_700_000_000_000;
    const paso = Math.floor(ahora / 30000);
    expect(verificarTotp(s, codigoTotp(s, paso), ahora)).toBe(paso);
    expect(verificarTotp(s, codigoTotp(s, paso - 1), ahora)).toBe(paso - 1);
    expect(verificarTotp(s, codigoTotp(s, paso + 5), ahora)).toBeNull();
    expect(verificarTotp(s, codigoTotp(s, paso), ahora, paso)).toBeNull(); // ya usado
    expect(verificarTotp(s, "abc123", ahora)).toBeNull();
  });
  it("el secreto se cifra y se descifra, y un dato alterado falla", async () => {
    process.env.SESSION_SECRET = "x".repeat(40);
    const { cifrarSecreto, descifrarSecreto, generarSecreto } = await import("@/lib/server/mfa");
    const s = generarSecreto();
    const c = cifrarSecreto(s);
    expect(c).not.toContain(s);
    expect(descifrarSecreto(c)).toBe(s);
    const partes = c.split(".");
    partes[2] = Buffer.from("otra cosa").toString("base64");
    expect(() => descifrarSecreto(partes.join("."))).toThrow();
  });
});

describe("IP del cliente", () => {
  it("ignora x-forwarded-for / x-real-ip si no hay proxy de confianza", async () => {
    const { ipCliente } = await import("@/lib/server/ip");
    const falsa = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" } });
    delete process.env.TRUST_PROXY;
    delete process.env.VERCEL;
    expect(ipCliente(falsa)).toBe("desconocida");
    const deVercel = new Request("http://x", { headers: { "x-vercel-forwarded-for": "9.9.9.9" } });
    // Fuera de Vercel esa cabecera la puede inventar cualquiera: no se usa.
    expect(ipCliente(deVercel)).toBe("desconocida");
    process.env.VERCEL = "1";
    expect(ipCliente(deVercel)).toBe("9.9.9.9");
    delete process.env.VERCEL;
    process.env.TRUST_PROXY = "1";
    expect(ipCliente(falsa)).toBe("5.6.7.8");
    delete process.env.TRUST_PROXY;
  });
});

describe("formatos de Office antiguos", () => {
  it("ya no se aceptan .doc ni .xls", async () => {
    const { TIPOS_PERMITIDOS } = await import("@/lib/shared/archivos");
    expect(TIPOS_PERMITIDOS["doc"]).toBeUndefined();
    expect(TIPOS_PERMITIDOS["xls"]).toBeUndefined();
    expect(TIPOS_PERMITIDOS["docx"]).toBeDefined();
  });
});

describe("destino tras el login (redirección abierta)", () => {
  it("rechaza destinos externos, incluidos los que usan tabuladores o saltos de línea", async () => {
    const { rutaInternaSegura } = await import("@/lib/shared/rutas");
    const malos = ["//evil.com", "https://evil.com", "/\t/evil.com", "/\n/evil.com", "/\r/evil.com", "/\\evil.com",
      "/ /evil.com", "javascript:alert(1)", "evil.com", "", "/\u0000/evil.com"];
    for (const m of malos) expect(rutaInternaSegura(m)).toBe("/dashboard");
    expect(rutaInternaSegura(null)).toBe("/dashboard");
  });
  it("conserva las rutas internas legítimas", async () => {
    const { rutaInternaSegura } = await import("@/lib/shared/rutas");
    expect(rutaInternaSegura("/correctivos?estado=Abierto&page=2")).toBe("/correctivos?estado=Abierto&page=2");
    expect(rutaInternaSegura("/correctivos/12")).toBe("/correctivos/12");
  });
});

describe("códigos de respaldo del 2FA", () => {
  it("se generan 8 únicos con formato legible; la huella no revela el código y no depende de guiones/mayúsculas", async () => {
    process.env.SESSION_SECRET = "x".repeat(40);
    const { generarRespaldos, huellaRespaldo, esFormatoRespaldo, CANTIDAD_RESPALDOS } = await import("@/lib/server/mfa");
    const { codigos, huellas } = generarRespaldos();
    expect(codigos).toHaveLength(CANTIDAD_RESPALDOS);
    expect(new Set(codigos).size).toBe(CANTIDAD_RESPALDOS);
    for (const c of codigos) expect(c).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    expect(huellas[0]).toBe(huellaRespaldo(codigos[0].toLowerCase().replace("-", " ")));
    expect(huellas[0]).not.toContain(codigos[0].replace("-", ""));
    expect(esFormatoRespaldo("123456")).toBe(false); // un TOTP no se confunde con un respaldo
  });
});

describe("PDF con contenido activo", () => {
  it("rechaza /JavaScript, /JS y /Launch (incluso ofuscados con #xx) y acepta un PDF normal", async () => {
    const { pdfTieneContenidoActivo } = await import("@/lib/shared/archivos");
    const t = (s: string) => new TextEncoder().encode(s);
    expect(pdfTieneContenidoActivo(t("%PDF-1.4\n1 0 obj <</S /JavaScript /JS (app.alert(1))>> endobj"))).toBe(true);
    expect(pdfTieneContenidoActivo(t("%PDF-1.4\n<</S/Launch>>"))).toBe(true);
    expect(pdfTieneContenidoActivo(t("%PDF-1.4\n<</S /J#61vaScript>>"))).toBe(true);
    expect(pdfTieneContenidoActivo(t("%PDF-1.4\n<</Type /Catalog /OpenAction [3 0 R /Fit]>> %%EOF"))).toBe(false);
  });
});
