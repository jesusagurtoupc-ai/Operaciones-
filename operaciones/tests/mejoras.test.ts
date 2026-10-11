import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Pruebas de las mejoras de la auditoría de seguridad (tanda 7).
const m = vi.hoisted(() => ({
  responder: (() => []) as (t: string) => unknown[],
  consultas: [] as string[],
  usuario: null as { username: string; rol: "admin" | "lectura"; mfaActivo?: boolean } | null,
}));

vi.mock("@/lib/server/db", () => {
  const sql = Object.assign(
    (s: TemplateStringsArray) => {
      const t = s.join("?");
      m.consultas.push(t);
      return Promise.resolve(m.responder(t));
    },
    { query: (t: string) => (m.consultas.push(t), Promise.resolve(m.responder(t))) }
  );
  return { sql, ensureSchema: () => Promise.resolve() };
});
vi.mock("@/lib/server/auth", () => ({
  SESSION_COOKIE_NAME: "correctivos_session",
  getCurrentUser: async () => m.usuario,
  getAdmin: async () => (m.usuario?.rol === "admin" ? m.usuario : null),
}));
vi.mock("@/lib/server/historial", () => ({ registrar: async () => {} }));

beforeEach(() => {
  m.responder = () => [];
  m.consultas = [];
  m.usuario = null;
  process.env.SESSION_SECRET = "s".repeat(40);
});

describe("límite de login atómico", () => {
  it("cuenta el intento antes de verificar y bloquea al superar el tope de cualquier contador", async () => {
    const { contarIntentosLogin, limitesLogin, MAX_FALLOS_IP } = await import("@/lib/server/limiteLogin");
    const limites = limitesLogin("ana", "1.2.3.4");
    m.responder = () => [{ fallos: 1 }];
    expect(await contarIntentosLogin(limites)).toBe(false);
    m.responder = () => [{ fallos: 6 }]; // 6 > 5 (usuario+IP)
    expect(await contarIntentosLogin(limites)).toBe(true);
    m.responder = () => [{ fallos: MAX_FALLOS_IP }]; // 100 > 5 también
    expect(await contarIntentosLogin(limites)).toBe(true);
    // Una sola sentencia con RETURNING: sin "leer y luego escribir".
    expect(m.consultas.every((q) => !q.startsWith("SELECT"))).toBe(true);
    expect(m.consultas.some((q) => q.includes("RETURNING fallos"))).toBe(true);
  });
});

describe("reautenticación de administradores", () => {
  const conCookie = async (usuarioToken: string, usuarioPide: string, tocar?: (t: string) => string) => {
    const { emitirReauth, reautenticadoReciente, REAUTH_COOKIE_NAME } = await import("@/lib/server/reauth");
    let token = await emitirReauth(usuarioToken, 0);
    if (tocar) token = tocar(token);
    const req = new NextRequest("http://localhost/api/usuarios", { headers: { cookie: `${REAUTH_COOKIE_NAME}=${token}` } });
    return reautenticadoReciente(req, usuarioPide);
  };

  it("vale para el mismo usuario y no para otro, ni alterada", async () => {
    expect(await conCookie("root", "root")).toBe(true);
    expect(await conCookie("root", "otro")).toBe(false);
    expect(await conCookie("root", "root", (t) => t.slice(0, -3) + "AAA")).toBe(false);
  });

  it("un token de sesión no sirve como prueba de reautenticación", async () => {
    const { SignJWT } = await import("jose");
    const { reautenticadoReciente, REAUTH_COOKIE_NAME } = await import("@/lib/server/reauth");
    const sesion = await new SignJWT({ username: "root", rol: "admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("root")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.SESSION_SECRET));
    const req = new NextRequest("http://localhost/x", { headers: { cookie: `${REAUTH_COOKIE_NAME}=${sesion}` } });
    expect(await reautenticadoReciente(req, "root")).toBe(false);
  });

  it("exigirReauth responde 403 REAUTH e indica si hay que pedir el código del 2FA", async () => {
    const { exigirReauth } = await import("@/lib/server/reauth");
    const req = new NextRequest("http://localhost/api/usuarios", { method: "POST" });
    const r = await exigirReauth(req, { username: "root", rol: "admin", mfaActivo: true });
    expect(r?.status).toBe(403);
    expect(await r?.json()).toMatchObject({ codigo: "REAUTH", pideCodigo: true });
  });

  it("REQUIRE_ADMIN_MFA solo afecta a administradores sin 2FA", async () => {
    const { adminSinMfa } = await import("@/lib/server/reauth");
    delete process.env.REQUIRE_ADMIN_MFA;
    expect(adminSinMfa({ rol: "admin", mfaActivo: false })).toBe(false);
    process.env.REQUIRE_ADMIN_MFA = "1";
    expect(adminSinMfa({ rol: "admin", mfaActivo: false })).toBe(true);
    expect(adminSinMfa({ rol: "admin", mfaActivo: true })).toBe(false);
    expect(adminSinMfa({ rol: "lectura", mfaActivo: false })).toBe(false);
    delete process.env.REQUIRE_ADMIN_MFA;
  });

  it("POST /api/auth/reautenticar: contraseña incorrecta = 400 y sin cookie", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    const { POST } = await import("@/app/api/auth/reautenticar/route");
    m.usuario = { username: "root", rol: "admin" };
    m.responder = (t) =>
      t.includes("RETURNING fallos") ? [{ fallos: 1 }]
      : t.includes("SELECT password_hash")
        ? [{ password_hash: bcrypt.hashSync("clave-correcta-1", 4), sesion_version: 0, mfa_activo: false, mfa_secreto: null, mfa_ultimo_paso: 0 }]
        : [];
    const pedir = (password: string) =>
      POST(new NextRequest("http://localhost/api/auth/reautenticar", { method: "POST", body: JSON.stringify({ password }) }));
    const mala = await pedir("otra");
    expect(mala.status).toBe(400);
    expect(mala.headers.get("set-cookie")).toBeNull();
    const buena = await pedir("clave-correcta-1");
    expect(buena.status).toBe(200);
    expect(buena.headers.get("set-cookie")).toContain("correctivos_reauth=");
  });
});

describe("clave propia para los secretos TOTP (MFA_KEY)", () => {
  it("con MFA_KEY se cifra con ella y los secretos antiguos (SESSION_SECRET) siguen funcionando", async () => {
    const { cifrarSecreto, descifrarSecreto } = await import("@/lib/server/mfa");
    delete process.env.MFA_KEY;
    const antiguo = cifrarSecreto("JBSWY3DPEHPK3PXP");
    process.env.MFA_KEY = "k".repeat(40);
    const nuevo = cifrarSecreto("JBSWY3DPEHPK3PXP");
    expect(descifrarSecreto(nuevo)).toBe("JBSWY3DPEHPK3PXP");
    expect(descifrarSecreto(antiguo)).toBe("JBSWY3DPEHPK3PXP");
    // Sin MFA_KEY, el secreto nuevo no se puede descifrar solo con SESSION_SECRET.
    delete process.env.MFA_KEY;
    expect(() => descifrarSecreto(nuevo)).toThrow();
  });
});

describe("filtro 'sin': solo nombres de documento reales", () => {
  it("'constructor', 'toString' o '__proto__' no entran al SQL", async () => {
    const { buildWhere } = await import("@/lib/server/filtros");
    const { DOCUMENTOS } = await import("@/lib/shared/opciones");
    for (const raro of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const { where } = buildWhere(new URLSearchParams({ sin: raro }));
      expect(where).not.toContain("documentos");
      expect(where).not.toContain("native code");
    }
    const bueno = buildWhere(new URLSearchParams({ sin: DOCUMENTOS[0].nombre }));
    expect(bueno.where).toContain(`documentos->'${DOCUMENTOS[0].clave}'`);
  });
});

describe("subida de archivos: tope atómico por ticket", () => {
  it("si el INSERT no inserta nada (ya hay 20) responde 400", async () => {
    const { POST } = await import("@/app/api/correctivos/[id]/archivos/route");
    m.usuario = { username: "root", rol: "admin" };
    m.responder = (t) => (t.includes("SELECT 1 FROM correctivos") ? [{ "?column?": 1 }] : []); // INSERT → []
    const form = new FormData();
    form.set("file", new File(["%PDF-1.4\n%fin"], "a.pdf", { type: "application/pdf" }));
    const res = await POST(new NextRequest("http://localhost/x", { method: "POST", body: form }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Máximo");
    expect(m.consultas.some((q) => q.includes("INSERT INTO archivos") && q.includes("SELECT COUNT(*) FROM archivos"))).toBe(true);
  });
});
