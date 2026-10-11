import { describe, expect, it, vi, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";

// Integración con un PostgreSQL REAL en memoria (PGlite): ejecuta el SQL tal cual.
vi.setConfig({ testTimeout: 60000 });
type Fila = Record<string, unknown>;
const h = vi.hoisted(() => ({
  db: null as unknown as { query: (t: string, p?: unknown[]) => Promise<{ rows: Fila[] }>; exec: (t: string) => Promise<unknown> },
  jar: new Map<string, string>(),
}));

vi.mock("@/lib/server/db", () => {
  const norm = (rows: Fila[]) =>
    rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? String(v) : v])));
  const run = async (text: string, params: unknown[]) => norm((await h.db.query(text, params)).rows);
  const sql = Object.assign(
    (s: TemplateStringsArray, ...v: unknown[]) => run(s.reduce((a, p, i) => a + p + (i < v.length ? `$${i + 1}` : ""), ""), v),
    { query: (t: string, v: unknown[] = []) => run(t, v) }
  );
  return { sql, ensureSchema: async () => {} };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (h.jar.has(n) ? { name: n, value: h.jar.get(n) } : undefined),
    set: (n: string, v: string) => void h.jar.set(n, v),
    delete: (n: string) => void h.jar.delete(n),
  }),
}));

let reauth = "";
const cookieHeader = () =>
  [...h.jar.entries()].map(([k, v]) => `${k}=${v}`).concat(reauth ? [`correctivos_reauth=${reauth}`] : []).join("; ");
const R = (url: string, method = "GET", body?: unknown, extra: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", cookie: cookieHeader(), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const q = async (text: string, params: unknown[] = []) => (await h.db.query(text, params)).rows as Fila[];

const CLAVE = "clave-larga-segura-1";
beforeAll(async () => {
  process.env.SESSION_SECRET = "s".repeat(40);
  const { PGlite } = await import("@electric-sql/pglite");
  h.db = new PGlite() as unknown as typeof h.db;
  await h.db.exec(readFileSync("scripts/schema.sql", "utf-8"));
  await h.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_correctivos_refer ON correctivos (refer) WHERE refer IS NOT NULL AND eliminado_en IS NULL");
  const bcrypt = (await import("bcryptjs")).default;
  await q("INSERT INTO usuarios (username, password_hash, rol) VALUES ('root', $1, 'admin'), ('ana', $1, 'lectura')", [bcrypt.hashSync(CLAVE, 12)]);
  await q("INSERT INTO correctivos (descripcion, estado) VALUES ('ticket uno', 'cotizar')");
}, 60000);

const login = async (username: string, password: string, codigo?: string) => {
  const { POST } = await import("@/app/api/auth/login/route");
  return POST(R("/api/auth/login", "POST", { username, password, codigo }));
};

describe("login con base real", () => {
  it("5 fallos permitidos, el 6.º se bloquea; un acierto antes del tope limpia el contador", async () => {
    for (let i = 0; i < 2; i++) expect((await login("ana", "mala")).status).toBe(401);
    const ok = await login("ana", CLAVE);
    expect(ok.status).toBe(200);
    expect(await q("SELECT 1 FROM intentos_login WHERE clave LIKE 'u|%|ana'")).toHaveLength(0); // limpiado
    h.jar.clear();
    for (let i = 0; i < 5; i++) expect((await login("ana", "mala")).status).toBe(401);
    expect((await login("ana", CLAVE)).status).toBe(429); // aunque la clave sea buena
    await q("DELETE FROM intentos_login");
  });

  it("peticiones en paralelo: solo 5 llegan a verificar la contraseña", async () => {
    const rs = await Promise.all(Array.from({ length: 40 }, () => login("root", "mala")));
    expect(rs.filter((r) => r.status === 401)).toHaveLength(5);
    expect(rs.filter((r) => r.status === 429)).toHaveLength(35);
    await q("DELETE FROM intentos_login");
  });

  it("usuario desconocido: la auditoría no guarda lo escrito en el campo usuario", async () => {
    await login("hunter2-es-mi-clave", "x");
    const f = await q("SELECT usuario, detalle FROM auditoria_accesos ORDER BY id DESC LIMIT 1");
    expect(f[0]).toMatchObject({ usuario: null, detalle: "usuario desconocido" });
    await q("DELETE FROM intentos_login");
  });
});

describe("sesión, proxy y reautenticación con base real", () => {
  it("login de admin, /me y proxy funcionan", async () => {
    h.jar.clear();
    expect((await login("root", CLAVE)).status).toBe(200);
    const { GET } = await import("@/app/api/auth/me/route");
    const me = await (await GET()).json();
    expect(me.user).toMatchObject({ username: "root", rol: "admin", mfaActivo: false, mfaRequerido: false });
    const { proxy } = await import("@/proxy");
    expect((await proxy(R("/api/correctivos"))).status).toBe(200);
  });

  it("crear/editar/eliminar usuarios exige reautenticar y luego funciona", async () => {
    const { POST } = await import("@/app/api/usuarios/route");
    const nuevo = { username: "luis", password: "otra-clave-larga-9", rol: "lectura" };
    const sin = await POST(R("/api/usuarios", "POST", nuevo));
    expect(sin.status).toBe(403);
    expect((await sin.json()).codigo).toBe("REAUTH");

    const { POST: reaut } = await import("@/app/api/auth/reautenticar/route");
    expect((await reaut(R("/api/auth/reautenticar", "POST", { password: "mala" }))).status).toBe(400);
    const buena = await reaut(R("/api/auth/reautenticar", "POST", { password: CLAVE }));
    expect(buena.status).toBe(200);
    reauth = buena.cookies.get("correctivos_reauth")!.value;

    const creado = await POST(R("/api/usuarios", "POST", nuevo));
    expect(creado.status).toBe(201);
    const id = String((await creado.json()).data.id);
    const { PATCH, DELETE } = await import("@/app/api/usuarios/[id]/route");
    expect((await PATCH(R(`/api/usuarios/${id}`, "PATCH", { rol: "admin" }), ctx({ id }))).status).toBe(200);
    expect((await DELETE(R(`/api/usuarios/${id}`, "DELETE"), ctx({ id }))).status).toBe(200);
    // Otro usuario (lectura) con esa cookie de reautenticación no pasa: el proxy lo frena antes.
  });

  it("cambio de contraseña: límite de intentos", async () => {
    const { POST } = await import("@/app/api/auth/password/route");
    let ultimo = 0;
    for (let i = 0; i < 12; i++) {
      ultimo = (await POST(R("/api/auth/password", "POST", { actual: "no-es", nueva: "nueva-clave-larga-1" }))).status;
    }
    expect(ultimo).toBe(429);
    await q("DELETE FROM intentos_login");
  });
});

describe("2FA con base real", () => {
  it("activar, login con código, reautenticar con código y REQUIRE_ADMIN_MFA sin esperas", async () => {
    const { POST: mfa } = await import("@/app/api/auth/mfa/route");
    const { codigoTotp } = await import("@/lib/server/mfa");
    const ini = await (await mfa(R("/api/auth/mfa", "POST", { accion: "iniciar", password: CLAVE }))).json();
    const paso = Math.floor(Date.now() / 30000);
    const conf = await mfa(R("/api/auth/mfa", "POST", { accion: "confirmar", codigo: codigoTotp(ini.secreto, paso) }));
    expect(conf.status).toBe(200);

    // Con el 2FA obligatorio, justo después de activarlo la API debe responder (sin caché vieja).
    process.env.REQUIRE_ADMIN_MFA = "1";
    const { proxy } = await import("@/proxy");
    const tras = await proxy(R("/api/correctivos"));
    expect(tras.status).toBe(200);
    delete process.env.REQUIRE_ADMIN_MFA;

    // Pasa el tiempo como en la vida real: el código de la activación ya está usado, hay que esperar al siguiente.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 30000 });
    h.jar.clear();
    expect(await (await login("root", CLAVE)).json()).toEqual({ requiereMfa: true });
    expect((await q("SELECT fallos FROM intentos_login WHERE clave LIKE 'u|%|root'"))[0].fallos).toBe(0); // intento devuelto
    expect((await login("root", CLAVE, codigoTotp(ini.secreto, paso + 1))).status).toBe(200);

    // Reautenticar exige el código; el que acaba de usar el login no vale, el del siguiente paso sí.
    reauth = "";
    const { POST: reaut } = await import("@/app/api/auth/reautenticar/route");
    const sinCodigo = await reaut(R("/api/auth/reautenticar", "POST", { password: CLAVE }));
    expect(sinCodigo.status).toBe(400);
    expect((await sinCodigo.json()).pideCodigo).toBe(true);
    expect((await reaut(R("/api/auth/reautenticar", "POST", { password: CLAVE, codigo: codigoTotp(ini.secreto, paso + 1) }))).status).toBe(400);
    vi.setSystemTime(Date.now() + 30000);
    const ok = await reaut(R("/api/auth/reautenticar", "POST", { password: CLAVE, codigo: codigoTotp(ini.secreto, paso + 2) }));
    expect(ok.status).toBe(200);
    vi.useRealTimers();
    // Quitar el 2FA para no afectar el resto.
    await q("UPDATE usuarios SET mfa_activo=false, mfa_secreto=NULL, mfa_ultimo_paso=0 WHERE username='root'");
    const { olvidarUsuario } = await import("@/lib/server/auth");
    olvidarUsuario("root");
  });
});

describe("archivos con base real", () => {
  const subir = async (nombre = "a.pdf") => {
    const { POST } = await import("@/app/api/correctivos/[id]/archivos/route");
    const form = new FormData();
    form.set("file", new File(["%PDF-1.4\nhola"], nombre, { type: "application/pdf" }));
    const r = new NextRequest("http://localhost/x", { method: "POST", body: form, headers: { cookie: cookieHeader() } });
    return POST(r, ctx({ id: "1" }));
  };
  it("sube, lista y descarga; el tope de 20 se respeta incluso con 30 subidas simultáneas", async () => {
    const primera = await subir();
    expect(primera.status).toBe(201);
    const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => subir(`b${i}.pdf`)));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(19); // 1 + 19 = 20
    expect(rs.filter((r) => r.status === 400)).toHaveLength(11);
    expect((await q("SELECT COUNT(*)::int n FROM archivos WHERE correctivo_id=1"))[0].n).toBe(20);
    const id = String((await q("SELECT id FROM archivos ORDER BY id LIMIT 1"))[0].id);
    const { GET } = await import("@/app/api/correctivos/[id]/archivos/[archivoId]/route");
    const d = await GET(R("/x"), ctx({ id: "1", archivoId: id }));
    expect(d.status).toBe(200);
    expect(Buffer.from(await d.arrayBuffer()).toString()).toContain("%PDF-1.4");
  });
});

describe("listado, filtros y exportación con base real", () => {
  it("GET /api/correctivos con filtros normales y con claves de prototipo", async () => {
    const { GET } = await import("@/app/api/correctivos/route");
    for (const qs of ["", "?sin=constructor", "?sin=__proto__&sin=toString", "?estado=cotizar&q=uno", "?sin=Cotización"]) {
      const r = await GET(R(`/api/correctivos${qs}`));
      expect(r.status, qs).toBe(200);
    }
    expect((await (await GET(R("/api/correctivos?q=uno"))).json()).data).toHaveLength(1);
  });
  it("dashboard y Excel responden", async () => {
    const dash = await import("@/app/api/dashboard/route");
    expect((await dash.GET()).status).toBe(200);
    const ex = await import("@/app/api/export/route");
    expect((await ex.GET(R("/api/export"))).status).toBe(200);
  });
});
