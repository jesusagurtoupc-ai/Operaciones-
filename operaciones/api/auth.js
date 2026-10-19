import crypto from "node:crypto";
import { promisify } from "node:util";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const COOKIE = "ops_session";
const SECRET = process.env.AUTH_SECRET || process.env.DATABASE_URL;
if (!SECRET) {
  throw new Error("Falta AUTH_SECRET (o DATABASE_URL) en las variables de entorno: no se pueden firmar sesiones de forma segura.");
}
if (!process.env.AUTH_SECRET) {
  // No se corta el arranque (hoy las sesiones ya se firman así y exigirlo desconectaría a todos),
  // pero queda avisado: con la clave de la base de datos como secreto, quien consiga esa
  // cadena de conexión también podría fabricar sesiones, y rotar la contraseña de la base
  // cerraría la sesión de todos. Definir AUTH_SECRET (una cadena larga y aleatoria) lo evita.
  console.warn("[auth] AUTH_SECRET no está definida: las sesiones se firman con DATABASE_URL. Define AUTH_SECRET en Vercel.");
}

// Compara el encabezado "Authorization: Bearer ..." con un secreto en TIEMPO CONSTANTE
// (una comparación normal con === se detiene en el primer carácter distinto y, en teoría,
// permite deducir el secreto midiendo tiempos de respuesta). Se comparan los hashes para
// que la longitud tampoco delate nada.
export function bearerValido(authHeader, secret) {
  if (!secret) return false;
  const a = crypto.createHash("sha256").update(String(authHeader || "")).digest();
  const b = crypto.createHash("sha256").update(`Bearer ${secret}`).digest();
  return crypto.timingSafeEqual(a, b);
}

const scryptAsync = promisify(crypto.scrypt);
const SCRYPT_PREFIX = "scrypt:";
const SCRYPT_KEYLEN = 64;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scryptAsync(String(password), salt, SCRYPT_KEYLEN);
  return `${SCRYPT_PREFIX}${salt}:${derived.toString("hex")}`;
}
function hashPasswordLegacySha256(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}
export async function verifyPassword(password, stored) {
  if (!stored) return { valid: false, needsRehash: false };
  if (stored.startsWith(SCRYPT_PREFIX)) {
    const [, salt, hashHex] = stored.split(":");
    if (!salt || !hashHex) return { valid: false, needsRehash: false };
    try {
      const derived = await scryptAsync(String(password), salt, SCRYPT_KEYLEN);
      const storedBuf = Buffer.from(hashHex, "hex");
      const derivedBuf = Buffer.from(derived);
      const valid = storedBuf.length === derivedBuf.length && crypto.timingSafeEqual(storedBuf, derivedBuf);
      return { valid, needsRehash: false };
    } catch (e) {
      console.error("verifyPassword: fallo al derivar/verificar la clave", e);
      return { valid: false, needsRehash: false };
    }
  }
  const expected = hashPasswordLegacySha256(password);
  const storedBuf = Buffer.from(String(stored));
  const expectedBuf = Buffer.from(expected);
  const valid = storedBuf.length === expectedBuf.length && crypto.timingSafeEqual(storedBuf, expectedBuf);
  return { valid, needsRehash: valid };
}
async function rehashUserPassword(userName, newHash) {
  try {
    const rows = await sql`SELECT value, version FROM app_storage WHERE key = 'torre_ops_data'`;
    if (!rows.length) return;
    const data = JSON.parse(rows[0].value);
    if (!Array.isArray(data.users)) return;
    let changed = false;
    data.users = data.users.map(u => {
      if (String(u.name || "").toLowerCase() === String(userName || "").toLowerCase()) {
        changed = true;
        return { ...u, passwordHash: newHash };
      }
      return u;
    });
    if (!changed) return;
    await sql`
      UPDATE app_storage
      SET value = ${JSON.stringify(data)}, version = version + 1, updated_at = now()
      WHERE key = 'torre_ops_data' AND version = ${rows[0].version}
    `;
  } catch (e) {
    console.error("rehash de contraseña falló (no crítico, se reintenta en el próximo login)", e);
  }
}
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verify(token) {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch (e) { console.error("token invalido o corrupto", e); return null; }
}
function cookieValue(req) {
  const raw = req.headers.cookie || "";
  const found = raw.split(";").map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`));
  return found ? decodeURIComponent(found.slice(COOKIE.length + 1)) : null;
}
function setCookie(res, value, maxAge = 60 * 60 * 12) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

const DEFAULT_USERS = [
  { name: "Admin", passwordHash: process.env.ADMIN_INIT_PASSWORD_HASH || "", role: "admin", activo: true },
  { name: "user", passwordHash: process.env.USER_INIT_PASSWORD_HASH || "", role: "asistencia_viewer", activo: true },
  { name: "operaciones", passwordHash: process.env.OPERACIONES_INIT_PASSWORD_HASH || "", role: "asistencia_editor", activo: true },
];

export async function loadUsers() {
  try {
    const rows = await sql`SELECT value FROM app_storage WHERE key = 'torre_ops_data'`;
    if (rows.length) {
      const data = JSON.parse(rows[0].value);
      if (Array.isArray(data.users) && data.users.length) {
        return data.users.map(user => {
          const base = DEFAULT_USERS.find(d => d.name.toLowerCase() === String(user.name || "").toLowerCase());
          return (!user.passwordHash && base) ? { ...user, passwordHash: base.passwordHash } : user;
        });
      }
    }
  } catch (e) { console.error("auth users load", e); }
  return DEFAULT_USERS.filter((u) => u.passwordHash);
}

const LOGIN_ATTEMPTS_PREFIX = "login_attempts_";
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_ATTEMPTS_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

async function getLoginAttemptState(name) {
  const key = LOGIN_ATTEMPTS_PREFIX + name.toLowerCase();
  try {
    const rows = await sql`SELECT value FROM app_storage WHERE key = ${key}`;
    if (!rows.length) return { key, count: 0, firstAttemptAt: 0, lockedUntil: 0 };
    const data = JSON.parse(rows[0].value);
    return { key, count: data.count || 0, firstAttemptAt: data.firstAttemptAt || 0, lockedUntil: data.lockedUntil || 0 };
  } catch (e) {
    console.error("getLoginAttemptState error (no bloqueante)", e);
    return { key, count: 0, firstAttemptAt: 0, lockedUntil: 0 };
  }
}
async function recordFailedLogin(name) {
  try {
    const now = Date.now();
    const state = await getLoginAttemptState(name);
    const withinWindow = state.firstAttemptAt && (now - state.firstAttemptAt) < LOGIN_ATTEMPTS_WINDOW_MS;
    const count = (withinWindow ? state.count : 0) + 1;
    const firstAttemptAt = withinWindow ? state.firstAttemptAt : now;
    const lockedUntil = count >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_LOCKOUT_MS : 0;
    const value = JSON.stringify({ count, firstAttemptAt, lockedUntil });
    await sql`
      INSERT INTO app_storage (key, value, version, updated_at)
      VALUES (${state.key}, ${value}, 1, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, version = app_storage.version + 1, updated_at = now()
    `;
  } catch (e) {
    console.error("recordFailedLogin error (no bloqueante)", e);
  }
}
async function clearLoginAttempts(name) {
  try {
    await sql`DELETE FROM app_storage WHERE key = ${LOGIN_ATTEMPTS_PREFIX + name.toLowerCase()}`;
  } catch (e) {
    console.error("clearLoginAttempts error (no bloqueante)", e);
  }
}

export function getSession(req) { return verify(cookieValue(req)); }

export async function getFreshSession(req) {
  const base = verify(cookieValue(req));
  if (!base) return null;
  try {
    const users = await loadUsers();
    const user = users.find(u => String(u.name || "").toLowerCase() === String(base.name || "").toLowerCase());
    if (!user || user.activo === false) return null;
    return {
      name: user.name,
      role: user.role || "member",
      paginas: Array.isArray(user.paginas) ? user.paginas : null,
      permisosPorPagina: user.permisosPorPagina && typeof user.permisosPorPagina === "object" ? user.permisosPorPagina : null,
      trabajador: user.trabajador || null,
      trabajadorId: user.trabajadorId || null,
      exp: base.exp,
    };
  } catch (e) {
    console.error("getFreshSession error", e);
    return base;
  }
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const session = await getFreshSession(req);
      if (!session) return res.status(401).json({ authenticated: false });
      return res.status(200).json({ authenticated: true, user: session });
    }
    if (req.method === "DELETE") {
      setCookie(res, "", 0);
      return res.status(200).json({ ok: true });
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST, DELETE");
      return res.status(405).json({ error: "metodo no soportado" });
    }
    let body = {};
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    } catch (e) {
      console.error("handler: cuerpo de la peticion invalido", e);
      return res.status(400).json({ error: "cuerpo_invalido" });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({ error: "cuerpo_invalido" });
    }
    const name = String(body.name || "").trim();
    const password = String(body.password || "");
    if (!name || !password) return res.status(400).json({ error: "usuario y contraseña requeridos" });
    const attemptState = await getLoginAttemptState(name);
    if (attemptState.lockedUntil && attemptState.lockedUntil > Date.now()) {
      const retryAfterSeconds = Math.ceil((attemptState.lockedUntil - Date.now()) / 1000);
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ error: "demasiados_intentos", retryAfterSeconds });
    }
    const users = await loadUsers();
    const user = users.find(u => String(u.name || "").toLowerCase() === name.toLowerCase());
    if (!user || user.activo === false) { await recordFailedLogin(name); return res.status(401).json({ error: "credenciales_invalidas" }); }
    const stored = user.passwordHash || (user.password ? hashPasswordLegacySha256(user.password) : "");
    if (!stored) { await recordFailedLogin(name); return res.status(401).json({ error: "credenciales_invalidas" }); }
    const { valid, needsRehash } = await verifyPassword(password, stored);
    if (!valid) { await recordFailedLogin(name); return res.status(401).json({ error: "credenciales_invalidas" }); }
    await clearLoginAttempts(name);
    if (needsRehash) {
      await rehashUserPassword(user.name, await hashPassword(password));
    }
    const session = {
      name: user.name,
      role: user.role || "member",
      paginas: Array.isArray(user.paginas) ? user.paginas : null,
      permisosPorPagina: user.permisosPorPagina && typeof user.permisosPorPagina === "object" ? user.permisosPorPagina : null,
      trabajador: user.trabajador || null,
      trabajadorId: user.trabajadorId || null,
      exp: Date.now() + 1000 * 60 * 60 * 12,
    };
    setCookie(res, sign(session));
    return res.status(200).json({ authenticated: true, user: session });
  } catch (err) {
    console.error("auth api error", err);
    return res.status(500).json({ error: "error interno" });
  }
}
