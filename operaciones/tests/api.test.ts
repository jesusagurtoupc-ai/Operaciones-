import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Pruebas de las rutas de la API SIN base de datos real: `sql` y la sesión se
// simulan. Comprueban permisos, validaciones y códigos de respuesta.
const m = vi.hoisted(() => {
  type Usuario = { username: string; rol: "admin" | "lectura" } | null;
  return {
    usuario: null as Usuario,
    // Respuesta de la base según el texto de la consulta.
    responder: (() => []) as (texto: string) => unknown[],
    consultas: [] as string[],
    bloqueado: false,
    fallos: 0,
    cerradas: [] as string[],
    frescos: [] as boolean[],
    reauth: true,
  };
});

vi.mock("@/lib/server/db", () => {
  const sql = Object.assign(
    (strings: TemplateStringsArray) => {
      const texto = strings.join("?");
      m.consultas.push(texto);
      return Promise.resolve(m.responder(texto));
    },
    {
      query: (texto: string) => {
        m.consultas.push(texto);
        return Promise.resolve(m.responder(texto));
      },
    }
  );
  return { sql, ensureSchema: () => Promise.resolve() };
});

vi.mock("@/lib/server/auth", () => ({
  SESSION_COOKIE_NAME: "correctivos_session",
  getCurrentUser: async () => m.usuario,
  getAdmin: async () => (m.usuario?.rol === "admin" ? m.usuario : null),
  getUserFromToken: async (t: string, fresco?: boolean) => {
    m.frescos.push(fresco === true);
    return t === "ok" ? m.usuario : null;
  },
  revocarSesionActual: async () => {},
  olvidarUsuario: () => {},
  createSession: async () => {},
  destroySession: async () => {},
  cerrarTodasLasSesiones: async (u: string) => {
    m.cerradas.push(u);
  },
  tokenRenovado: async () => null,
}));

vi.mock("@/lib/server/limiteLogin", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/limiteLogin")>()),
  bloqueado: async () => m.bloqueado,
  registrarFallo: async () => {
    m.fallos++;
  },
  // El login cuenta el intento ANTES de verificar (atómico); aquí cada contador suma 1.
  contarIntentosLogin: async (limites: unknown[]) => {
    m.fallos += limites.length;
    return m.bloqueado;
  },
  devolverIntento: async () => {
    m.fallos--;
  },
  limpiarFallos: async () => {},
}));

// Las acciones delicadas de administrador exigen reautenticación; en estas pruebas se da por hecha
// salvo en el caso que comprueba justamente eso (m.reauth = false).
vi.mock("@/lib/server/reauth", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/reauth")>()),
  exigirReauth: async () =>
    m.reauth
      ? null
      : new Response(JSON.stringify({ error: "x", codigo: "REAUTH" }), { status: 403 }),
}));

const admin = { username: "root", rol: "admin" as const };
const lectura = { username: "ana", rol: "lectura" as const };

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

beforeEach(() => {
  m.usuario = null;
  m.responder = () => [];
  m.consultas = [];
  m.bloqueado = false;
  m.reauth = true;
  m.fallos = 0;
  m.cerradas = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("/api/correctivos", () => {
  it("POST: un usuario de solo lectura recibe 403 y no toca la base", async () => {
    const { POST } = await import("@/app/api/correctivos/route");
    m.usuario = lectura;
    const res = await POST(json("/api/correctivos", "POST", { descripcion: "x" }));
    expect(res.status).toBe(403);
    expect(m.consultas).toHaveLength(0);
  });

  it("POST: sin sesión recibe 403", async () => {
    const { POST } = await import("@/app/api/correctivos/route");
    expect((await POST(json("/api/correctivos", "POST", { descripcion: "x" }))).status).toBe(403);
  });

  it("POST: datos inválidos dan 400 antes de consultar la base", async () => {
    const { POST } = await import("@/app/api/correctivos/route");
    m.usuario = admin;
    expect((await POST(json("/api/correctivos", "POST", { estado: "cotizar" }))).status).toBe(400);
    expect(
      (await POST(json("/api/correctivos", "POST", { descripcion: "x", estado: "inventado" }))).status
    ).toBe(400);
    expect(
      (await POST(json("/api/correctivos", "POST", { descripcion: "x", f_reg: "2026-02-30" }))).status
    ).toBe(400);
    expect(m.consultas).toHaveLength(0);
  });

  it("POST: un ticket válido se crea (201)", async () => {
    const { POST } = await import("@/app/api/correctivos/route");
    m.usuario = admin;
    m.responder = (t) => (t.includes("INSERT INTO correctivos") ? [{ id: 7, descripcion: "Pintar" }] : []);
    const res = await POST(json("/api/correctivos", "POST", { descripcion: "Pintar" }));
    expect(res.status).toBe(201);
  });

  it("POST: N° Refer. repetido dado a mano responde 409", async () => {
    const { POST } = await import("@/app/api/correctivos/route");
    m.usuario = admin;
    m.responder = (t) => {
      if (t.includes("INSERT INTO correctivos")) throw Object.assign(new Error("dup"), { code: "23505" });
      return [];
    };
    const res = await POST(json("/api/correctivos", "POST", { descripcion: "x", refer: 5 }));
    expect(res.status).toBe(409);
  });

  it("GET: fechas inválidas dan 400 (no 500)", async () => {
    const { GET } = await import("@/app/api/correctivos/route");
    m.usuario = lectura;
    const res = await GET(json("/api/correctivos?desde=ayer", "GET"));
    expect(res.status).toBe(400);
  });

  it("GET: page enorme se limita y no rompe", async () => {
    const { GET } = await import("@/app/api/correctivos/route");
    m.usuario = lectura;
    const res = await GET(json("/api/correctivos?page=1e21&facetas=0", "GET"));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.pagination.page).toBe(1_000_000);
    expect(m.consultas.join(" ")).not.toMatch(/e\+/);
  });

  it("PUT y DELETE: solo administradores", async () => {
    const { PUT, DELETE } = await import("@/app/api/correctivos/[id]/route");
    m.usuario = lectura;
    expect((await PUT(json("/x", "PUT", { descripcion: "x" }), ctx({ id: "1" }))).status).toBe(403);
    expect((await DELETE(json("/x", "DELETE"), ctx({ id: "1" }))).status).toBe(403);
  });

  it("PUT/DELETE: id no numérico da 400 y ticket inexistente 404", async () => {
    const { PUT, DELETE } = await import("@/app/api/correctivos/[id]/route");
    m.usuario = admin;
    expect((await PUT(json("/x", "PUT", { descripcion: "x" }), ctx({ id: "abc" }))).status).toBe(400);
    expect((await DELETE(json("/x", "DELETE"), ctx({ id: "abc" }))).status).toBe(400);
    expect((await PUT(json("/x", "PUT", { descripcion: "x" }), ctx({ id: "9" }))).status).toBe(404);
    expect((await DELETE(json("/x", "DELETE"), ctx({ id: "9" }))).status).toBe(404);
  });

  it("DELETE: es un borrado lógico (UPDATE), nunca un DELETE de la fila", async () => {
    const { DELETE } = await import("@/app/api/correctivos/[id]/route");
    m.usuario = admin;
    m.responder = (t) => (t.includes("UPDATE correctivos") ? [{ id: 1 }] : []);
    expect((await DELETE(json("/x", "DELETE"), ctx({ id: "1" }))).status).toBe(200);
    expect(m.consultas.some((q) => /DELETE\s+FROM\s+correctivos/i.test(q))).toBe(false);
    expect(m.consultas.some((q) => q.includes("eliminado_en = now()"))).toBe(true);
  });
});

describe("tickets eliminados", () => {
  it("listar y restaurar son solo para administradores", async () => {
    const { GET } = await import("@/app/api/correctivos/eliminados/route");
    const { POST } = await import("@/app/api/correctivos/[id]/restaurar/route");
    m.usuario = lectura;
    expect((await GET()).status).toBe(403);
    expect((await POST(json("/x", "POST"), ctx({ id: "1" }))).status).toBe(403);
  });

  it("restaurar: id inválido 400, inexistente 404, correcto 200", async () => {
    const { POST } = await import("@/app/api/correctivos/[id]/restaurar/route");
    m.usuario = admin;
    expect((await POST(json("/x", "POST"), ctx({ id: "abc" }))).status).toBe(400);
    expect((await POST(json("/x", "POST"), ctx({ id: "3" }))).status).toBe(404);
    m.responder = (t) => (t.includes("UPDATE correctivos") ? [{ id: 3 }] : []);
    const res = await POST(json("/x", "POST"), ctx({ id: "3" }));
    expect(res.status).toBe(200);
    expect((await res.json()).referNuevo).toBeNull();
  });

  it("restaurar: si el N° Refer. ya está en uso, reasigna el siguiente libre", async () => {
    const { POST } = await import("@/app/api/correctivos/[id]/restaurar/route");
    m.usuario = admin;
    let intentos = 0;
    m.responder = (t) => {
      if (t.includes("UPDATE correctivos")) {
        intentos++;
        if (intentos === 1) throw Object.assign(new Error("dup"), { code: "23505" });
        return [{ id: 3, refer: 501 }];
      }
      return [];
    };
    const res = await POST(json("/x", "POST"), ctx({ id: "3" }));
    expect(res.status).toBe(200);
    expect((await res.json()).referNuevo).toBe(501);
  });
});

describe("/api/usuarios", () => {
  it("las rutas son solo para administradores", async () => {
    const { GET, POST } = await import("@/app/api/usuarios/route");
    const { PATCH, DELETE } = await import("@/app/api/usuarios/[id]/route");
    const { GET: actividad } = await import("@/app/api/usuarios/actividad/route");
    m.usuario = lectura;
    expect((await GET()).status).toBe(403);
    expect((await POST(json("/x", "POST", {}))).status).toBe(403);
    expect((await PATCH(json("/x", "PATCH", {}), ctx({ id: "1" }))).status).toBe(403);
    expect((await DELETE(json("/x", "DELETE"), ctx({ id: "1" }))).status).toBe(403);
    expect((await actividad()).status).toBe(403);
  });

  it("POST: valida usuario, contraseña (mínimo 10) y rol", async () => {
    const { POST } = await import("@/app/api/usuarios/route");
    m.usuario = admin;
    const ok = { username: "maria", password: "contrasena-larga", rol: "lectura" };
    expect((await POST(json("/x", "POST", { ...ok, username: "A B" }))).status).toBe(400);
    expect((await POST(json("/x", "POST", { ...ok, password: "corta" }))).status).toBe(400);
    expect((await POST(json("/x", "POST", { ...ok, rol: "root" }))).status).toBe(400);
    expect(m.consultas).toHaveLength(0);
  });

  it("PATCH: activo como texto (\"false\") se rechaza en vez de interpretarse como true", async () => {
    const { PATCH } = await import("@/app/api/usuarios/[id]/route");
    m.usuario = admin;
    m.responder = (t) =>
      t.includes("FROM usuarios") ? [{ id: 2, username: "bob", rol: "lectura", activo: true }] : [];
    const res = await PATCH(json("/x", "PATCH", { activo: "false" }), ctx({ id: "2" }));
    expect(res.status).toBe(400);
    expect(m.consultas.some((q) => q.includes("UPDATE usuarios"))).toBe(false);
  });

  it("PATCH: no puedes quitarte el rol ni desactivarte", async () => {
    const { PATCH } = await import("@/app/api/usuarios/[id]/route");
    m.usuario = admin;
    m.responder = (t) =>
      t.includes("FROM usuarios") ? [{ id: 1, username: "root", rol: "admin", activo: true }] : [];
    expect((await PATCH(json("/x", "PATCH", { rol: "lectura" }), ctx({ id: "1" }))).status).toBe(400);
    expect((await PATCH(json("/x", "PATCH", { activo: false }), ctx({ id: "1" }))).status).toBe(400);
  });

  it("DELETE: no se puede eliminar a uno mismo ni al último administrador", async () => {
    const { DELETE } = await import("@/app/api/usuarios/[id]/route");
    m.usuario = admin;
    m.responder = (t) =>
      t.includes("FROM usuarios") && t.includes("id = ")
        ? [{ id: 1, username: "root", rol: "admin", activo: true }]
        : [];
    expect((await DELETE(json("/x", "DELETE"), ctx({ id: "1" }))).status).toBe(400);
  });
});

describe("/api/usuarios: último administrador y contraseñas", () => {
  const ficha = (t: string) =>
    t.includes("FROM usuarios") && t.includes("id = ") && !t.includes("WITH admins")
      ? [{ id: 2, username: "bob", rol: "admin", activo: true }]
      : [];

  it("PATCH: si la base rechaza el cambio (carrera entre dos admins) responde 400 y no anota nada", async () => {
    const { PATCH } = await import("@/app/api/usuarios/[id]/route");
    m.usuario = admin;
    m.responder = (t) => (t.includes("WITH admins") ? [] : t.includes("COUNT(*)") ? [{ n: 1 }] : ficha(t));
    const res = await PATCH(json("/x", "PATCH", { activo: false }), ctx({ id: "2" }));
    expect(res.status).toBe(400);
    expect(m.consultas.some((q) => q.includes("INSERT INTO auditoria_usuarios"))).toBe(false);
  });

  it("PATCH: el cambio de rol/estado va en una sola sentencia guardada", async () => {
    const { PATCH } = await import("@/app/api/usuarios/[id]/route");
    m.usuario = admin;
    m.responder = (t) => (t.includes("WITH admins") ? [{ id: 2 }] : t.includes("COUNT(*)") ? [{ n: 1 }] : ficha(t));
    const res = await PATCH(json("/x", "PATCH", { rol: "lectura" }), ctx({ id: "2" }));
    expect(res.status).toBe(200);
    expect(m.consultas.filter((q) => q.includes("WITH admins"))).toHaveLength(1);
  });

  it("PATCH: una contraseña débil se rechaza antes de tocar el rol", async () => {
    const { PATCH } = await import("@/app/api/usuarios/[id]/route");
    m.usuario = admin;
    m.responder = (t) => (t.includes("COUNT(*)") ? [{ n: 1 }] : ficha(t));
    const res = await PATCH(json("/x", "PATCH", { rol: "lectura", password: "password123" }), ctx({ id: "2" }));
    expect(res.status).toBe(400);
    expect(m.consultas.some((q) => q.includes("UPDATE usuarios"))).toBe(false);
  });

  it("DELETE: si la base no elimina (último admin por carrera) responde 400", async () => {
    const { DELETE } = await import("@/app/api/usuarios/[id]/route");
    m.usuario = admin;
    m.responder = (t) => (t.includes("WITH admins") ? [] : t.includes("COUNT(*)") ? [{ n: 1 }] : ficha(t));
    expect((await DELETE(json("/x", "DELETE"), ctx({ id: "2" }))).status).toBe(400);
  });

  it("POST: rechaza contraseñas comunes", async () => {
    const { POST } = await import("@/app/api/usuarios/route");
    m.usuario = admin;
    const res = await POST(json("/x", "POST", { username: "maria", password: "qwertyuiop", rol: "lectura" }));
    expect(res.status).toBe(400);
    expect(m.consultas).toHaveLength(0);
  });
});

describe("login con verificación en dos pasos", () => {
  it("sin código pide el segundo paso; con código malo cuenta un fallo; con código bueno entra", async () => {
    process.env.SESSION_SECRET = "x".repeat(40);
    const bcrypt = (await import("bcryptjs")).default;
    const { generarSecreto, cifrarSecreto, codigoTotp } = await import("@/lib/server/mfa");
    const { POST } = await import("@/app/api/auth/login/route");
    const secreto = generarSecreto();
    const fila = {
      username: "ana", password_hash: await bcrypt.hash("contrasena-larga-1", 4), rol: "admin", activo: true,
      sesion_version: 0, debe_cambiar_clave: false, mfa_activo: true, mfa_secreto: cifrarSecreto(secreto), mfa_ultimo_paso: 0,
    };
    m.responder = (t) => (t.includes("SELECT username, password_hash") ? [fila] : t.includes("RETURNING 1") ? [{ "?column?": 1 }] : []);
    const pedir = (cuerpo: object) => POST(json("/api/auth/login", "POST", cuerpo));

    const sinCodigo = await pedir({ username: "ana", password: "contrasena-larga-1" });
    expect((await sinCodigo.json()).requiereMfa).toBe(true);
    expect(m.fallos).toBe(0); // el intento se devuelve: solo se pidió el código

    const malo = await pedir({ username: "ana", password: "contrasena-larga-1", codigo: "000000" });
    expect(malo.status).toBe(401);
    expect(m.fallos).toBeGreaterThan(0);

    const bueno = await pedir({
      username: "ana", password: "contrasena-larga-1",
      codigo: codigoTotp(secreto, Math.floor(Date.now() / 30000)),
    });
    expect(bueno.status).toBe(200);
  });
});

describe("login: el segundo paso nunca se salta", () => {
  it("MFA activo sin secreto utilizable: 403 y sin sesión", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    const { POST } = await import("@/app/api/auth/login/route");
    const fila = {
      username: "ana", password_hash: await bcrypt.hash("contrasena-larga-1", 4), rol: "admin", activo: true,
      sesion_version: 0, debe_cambiar_clave: false, mfa_activo: true, mfa_secreto: null, mfa_ultimo_paso: 0,
    };
    m.responder = (t) => (t.includes("SELECT username, password_hash") ? [fila] : []);
    const res = await POST(json("/api/auth/login", "POST", { username: "ana", password: "contrasena-larga-1", codigo: "123456" }));
    expect(res.status).toBe(403);
  });
});

describe("login con código de respaldo", () => {
  it("un código de respaldo válido entra y se consume; uno inexistente cuenta como fallo", async () => {
    process.env.SESSION_SECRET = "x".repeat(40);
    const bcrypt = (await import("bcryptjs")).default;
    const { generarSecreto, cifrarSecreto } = await import("@/lib/server/mfa");
    const { POST } = await import("@/app/api/auth/login/route");
    const fila = {
      username: "ana", password_hash: await bcrypt.hash("contrasena-larga-1", 4), rol: "admin", activo: true,
      sesion_version: 0, debe_cambiar_clave: false, mfa_activo: true, mfa_secreto: cifrarSecreto(generarSecreto()), mfa_ultimo_paso: 0,
    };
    let consumido = true;
    m.responder = (t) =>
      t.includes("SELECT username, password_hash") ? [fila] : t.includes("mfa_respaldo - ") ? (consumido ? [{ "?column?": 1 }] : []) : [];
    const pedir = () => POST(json("/api/auth/login", "POST", { username: "ana", password: "contrasena-larga-1", codigo: "ABCDE-FGHIJ" }));
    expect((await pedir()).status).toBe(200);
    expect(m.consultas.some((q) => q.includes("mfa_respaldo - "))).toBe(true);
    consumido = false;
    m.fallos = 0;
    expect((await pedir()).status).toBe(401);
    expect(m.fallos).toBeGreaterThan(0);
  });
});

describe("proxy: las escrituras se validan contra la base", () => {
  it("GET puede usar la caché; POST/PATCH/DELETE consultan la base (fresco)", async () => {
    const { proxy } = await import("@/proxy");
    m.usuario = admin;
    m.frescos = [];
    const pedir = (metodo: string) =>
      proxy(new NextRequest("http://localhost/api/correctivos", { method: metodo, headers: { cookie: "correctivos_session=ok" } }));
    await pedir("GET");
    await pedir("POST");
    await pedir("DELETE");
    expect(m.frescos).toEqual([false, true, true]);
  });
});

describe("Origin en el proxy", () => {
  it("una escritura desde otro sitio recibe 403 (también en el login); sin Origin pasa", async () => {
    const { proxy } = await import("@/proxy");
    const pedir = (ruta: string, origin?: string) =>
      proxy(
        new NextRequest(`http://localhost${ruta}`, {
          method: "POST",
          headers: { cookie: "correctivos_session=ok", ...(origin ? { origin } : {}) },
        })
      );
    m.usuario = admin;
    expect((await pedir("/api/correctivos", "https://malo.example.org")).status).toBe(403);
    expect((await pedir("/api/auth/login", "https://malo.example.org")).status).toBe(403);
    expect((await pedir("/api/correctivos", "http://localhost")).status).toBe(200);
    expect((await pedir("/api/correctivos")).status).toBe(200);
  });
});

describe("archivos adjuntos", () => {
  const formulario = (nombre: string, contenido: BlobPart) => {
    const f = new FormData();
    f.append("file", new File([contenido], nombre));
    return new NextRequest("http://localhost/x", { method: "POST", body: f });
  };

  it("solo administradores pueden subir", async () => {
    const { POST } = await import("@/app/api/correctivos/[id]/archivos/route");
    m.usuario = lectura;
    expect((await POST(formulario("a.pdf", "%PDF-1.4"), ctx({ id: "1" }))).status).toBe(403);
  });

  it("rechaza extensiones no permitidas (html, svg, exe)", async () => {
    const { POST } = await import("@/app/api/correctivos/[id]/archivos/route");
    m.usuario = admin;
    for (const n of ["a.html", "a.svg", "a.exe"]) {
      expect((await POST(formulario(n, "<script>1</script>"), ctx({ id: "1" }))).status).toBe(400);
    }
  });

  it("rechaza un archivo cuyo contenido no corresponde a la extensión", async () => {
    const { POST } = await import("@/app/api/correctivos/[id]/archivos/route");
    m.usuario = admin;
    const res = await POST(formulario("informe.pdf", "<html><script>alert(1)</script></html>"), ctx({ id: "1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no corresponde/);
    expect(m.consultas.some((q) => q.includes("INSERT INTO archivos"))).toBe(false);
  });

  it("acepta un PDF real", async () => {
    const { POST } = await import("@/app/api/correctivos/[id]/archivos/route");
    m.usuario = admin;
    m.responder = (t) => {
      if (t.includes("COUNT(*)")) return [{ n: 0 }];
      if (t.includes("SELECT 1 FROM correctivos")) return [{}];
      if (t.includes("INSERT INTO archivos")) return [{ id: 5, nombre: "informe.pdf" }];
      return [];
    };
    const res = await POST(formulario("informe.pdf", "%PDF-1.7\n..."), ctx({ id: "1" }));
    expect(res.status).toBe(201);
  });
});

describe("login", () => {
  it("responde 429 cuando el límite de intentos está activo", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    m.bloqueado = true;
    const res = await POST(json("/api/auth/login", "POST", { username: "root", password: "x" }));
    expect(res.status).toBe(429);
    expect(m.consultas).toHaveLength(0);
  });

  it("usuario inexistente: 401 y se suma un fallo en cada contador (usuario+IP, IP, usuario)", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    const res = await POST(json("/api/auth/login", "POST", { username: "nadie", password: "x" }));
    expect(res.status).toBe(401);
    expect(m.fallos).toBe(3);
  });

  it("deja constancia de los accesos (fallo y éxito) con IP", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    await POST(json("/api/auth/login", "POST", { username: "nadie", password: "x" }));
    expect(m.consultas.some((q) => q.includes("INSERT INTO auditoria_accesos"))).toBe(true);
  });

  it("cuerpos desmesurados se rechazan sin gastar bcrypt ni tocar la base", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    const res = await POST(json("/api/auth/login", "POST", { username: "root", password: "x".repeat(5000) }));
    expect(res.status).toBe(401);
    expect(m.consultas).toHaveLength(0);
  });

  it("logout con todas:true cierra las sesiones de todos los dispositivos", async () => {
    const { POST } = await import("@/app/api/auth/logout/route");
    m.usuario = lectura;
    await POST(json("/api/auth/logout", "POST", { todas: true }));
    expect(m.cerradas).toEqual(["ana"]);
    m.cerradas = [];
    await POST(json("/api/auth/logout", "POST", {}));
    expect(m.cerradas).toEqual([]);
  });
});

describe("proxy (control de acceso)", () => {
  const pedir = async (ruta: string, metodo: string, conCookie = true) => {
    const { proxy } = await import("@/proxy");
    const req = new NextRequest(`http://localhost${ruta}`, {
      method: metodo,
      headers: conCookie ? { cookie: "correctivos_session=ok" } : {},
    });
    return proxy(req);
  };

  it("sin sesión: 401 en la API y redirección a /login en páginas", async () => {
    expect((await pedir("/api/correctivos", "GET", false)).status).toBe(401);
    const pagina = await pedir("/correctivos", "GET", false);
    expect(pagina.status).toBe(307);
    expect(pagina.headers.get("location")).toContain("/login");
  });

  it("solo lectura: puede leer pero no escribir", async () => {
    m.usuario = lectura;
    expect((await pedir("/api/correctivos", "GET")).status).toBe(200);
    expect((await pedir("/api/correctivos", "POST")).status).toBe(403);
    expect((await pedir("/api/correctivos/1", "DELETE")).status).toBe(403);
    expect((await pedir("/api/usuarios", "GET")).status).toBe(403);
  });

  it("solo lectura: no entra a /usuarios, /correctivos/nuevo ni /correctivos/eliminados", async () => {
    m.usuario = lectura;
    for (const ruta of ["/usuarios", "/correctivos/nuevo", "/correctivos/eliminados"]) {
      expect((await pedir(ruta, "GET")).status).toBe(307);
    }
  });

  it("clave temporal: solo puede cambiarla, ver /me o salir", async () => {
    m.usuario = { ...admin, debeCambiarClave: true } as typeof m.usuario;
    const api = await pedir("/api/correctivos", "GET");
    expect(api.status).toBe(403);
    expect((await api.json()).codigo).toBe("CAMBIAR_CLAVE");
    expect((await pedir("/api/auth/password", "POST")).status).toBe(200);
    expect((await pedir("/api/auth/me", "GET")).status).toBe(200);
    const pagina = await pedir("/dashboard", "GET");
    expect(pagina.status).toBe(307);
    expect(pagina.headers.get("location")).toContain("/cambiar-clave");
    expect((await pedir("/cambiar-clave", "GET")).status).toBe(200);
  });

  it("las páginas llevan CSP con un nonce distinto por petición; la API no", async () => {
    m.usuario = lectura;
    const a = await pedir("/dashboard", "GET");
    const b = await pedir("/dashboard", "GET");
    const cspA = a.headers.get("content-security-policy") ?? "";
    const cspB = b.headers.get("content-security-policy") ?? "";
    expect(cspA).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(cspA).not.toBe(cspB);
    expect((await pedir("/api/correctivos", "GET")).headers.get("content-security-policy")).toBeNull();
  });

  it("sin clave temporal, /cambiar-clave redirige al panel", async () => {
    m.usuario = admin;
    const r = await pedir("/cambiar-clave", "GET");
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toContain("/dashboard");
  });

  it("administrador: acceso total", async () => {
    m.usuario = admin;
    expect((await pedir("/api/correctivos", "POST")).status).toBe(200);
    expect((await pedir("/correctivos/eliminados", "GET")).status).toBe(200);
  });
});


describe("acciones de administrador sobre usuarios: reautenticación", () => {
  it("sin prueba reciente de contraseña: 403 REAUTH y no se toca la base", async () => {
    const usuarios = await import("@/app/api/usuarios/route");
    const uno = await import("@/app/api/usuarios/[id]/route");
    m.usuario = admin;
    m.reauth = false;
    const crear = await usuarios.POST(json("/api/usuarios", "POST", { username: "nuevo", password: "una-clave-larga-1", rol: "admin" }));
    const editar = await uno.PATCH(json("/api/usuarios/5", "PATCH", { rol: "admin" }), ctx({ id: "5" }));
    const borrar = await uno.DELETE(json("/api/usuarios/5", "DELETE"), ctx({ id: "5" }));
    for (const r of [crear, editar, borrar]) {
      expect(r.status).toBe(403);
      expect((await r.json()).codigo).toBe("REAUTH");
    }
    expect(m.consultas).toHaveLength(0);
  });
});

describe("proxy: REQUIRE_ADMIN_MFA", () => {
  it("un administrador sin 2FA solo puede activarlo; con 2FA o sin la variable pasa", async () => {
    const { proxy } = await import("@/proxy");
    const pedir = (ruta: string) =>
      proxy(new NextRequest(`http://localhost${ruta}`, { headers: { cookie: "correctivos_session=ok" } }));
    m.usuario = { ...admin, mfaActivo: false } as typeof m.usuario;
    delete process.env.REQUIRE_ADMIN_MFA;
    expect((await pedir("/api/correctivos")).status).toBe(200);
    process.env.REQUIRE_ADMIN_MFA = "1";
    const bloqueada = await pedir("/api/correctivos");
    expect(bloqueada.status).toBe(403);
    expect((await bloqueada.json()).codigo).toBe("MFA_REQUERIDO");
    expect((await pedir("/api/auth/mfa")).status).toBe(200);
    expect((await pedir("/api/auth/me")).status).toBe(200);
    m.usuario = { ...admin, mfaActivo: true } as typeof m.usuario;
    expect((await pedir("/api/correctivos")).status).toBe(200);
    delete process.env.REQUIRE_ADMIN_MFA;
  });
});
