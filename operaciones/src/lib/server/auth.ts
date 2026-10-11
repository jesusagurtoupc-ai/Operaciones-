import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { sql, ensureSchema } from "@/lib/server/db";
import { errorSessionSecret } from "@/lib/server/secretos";

// En producción la cookie lleva el prefijo __Host-: el navegador solo la acepta con Secure,
// Path=/ y sin Domain, así que no la puede fijar un subdominio vecino.
const COOKIE_NAME = process.env.NODE_ENV === "production" ? "__Host-correctivos_session" : "correctivos_session";
const alg = "HS256";

// Cuánto se recuerda el rol/estado de un usuario antes de volver a consultarlo.
// En otras instancias del servidor un cambio de rol puede tardar hasta este tiempo.
const TTL_USUARIO_MS = 10_000;
const cacheUsuarios = new Map<string, { usuario: UsuarioSesion; sv: number; vence: number }>();

export type Rol = "admin" | "lectura";
export type UsuarioSesion = { username: string; rol: Rol; debeCambiarClave?: boolean; mfaActivo?: boolean };

// Duración de cada token (se renueva solo mientras la persona usa la app) y
// tope absoluto desde el inicio de sesión, aunque no deje de usarla.
const TOKEN_SEGUNDOS = 60 * 60 * 12; // 12 horas
const SESION_MAX_SEGUNDOS = 60 * 60 * 24 * 7; // 7 días
const RENOVAR_DESPUES_SEGUNDOS = 60 * 30; // se renueva si el token tiene más de 30 min

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  // En producción se exige un secreto largo y no de ejemplo; en local basta con que exista.
  const error = !secret || process.env.NODE_ENV === "production" ? errorSessionSecret(secret) : null;
  if (error) throw new Error(error);
  return new TextEncoder().encode(secret);
}

function opcionesCookie(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

async function firmar(username: string, rol: Rol, sv: number, ini: number, segundos: number, jti: string) {
  return new SignJWT({ username, rol, sv, ini })
    .setJti(jti)
    .setProtectedHeader({ alg })
    .setIssuedAt()
    .setExpirationTime(`${segundos}s`)
    .sign(getSecret());
}

/** `sv` es la versión de sesión del usuario: si cambia (nueva contraseña, cierre global), los tokens anteriores dejan de valer. */
export async function createSession(username: string, rol: Rol, sv = 0) {
  const ahora = Math.floor(Date.now() / 1000);
  const token = await firmar(username, rol, sv, ahora, TOKEN_SEGUNDOS, crypto.randomUUID());
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, opcionesCookie(TOKEN_SEGUNDOS));
}

/**
 * Si el token ya tiene más de 30 minutos y la sesión no superó su tope absoluto,
 * devuelve un token nuevo (y las opciones de la cookie) para renovarla. null = no hace falta.
 */
export async function tokenRenovado(
  token: string
): Promise<{ token: string; opciones: ReturnType<typeof opcionesCookie> } | null> {
  const p = await verifyToken(token);
  if (!p?.username || typeof p.iat !== "number") return null;
  const ahora = Math.floor(Date.now() / 1000);
  if (ahora - p.iat < RENOVAR_DESPUES_SEGUNDOS) return null;
  const ini = typeof p.ini === "number" ? p.ini : p.iat;
  const restante = ini + SESION_MAX_SEGUNDOS - ahora;
  if (restante <= 0) return null;
  const segundos = Math.min(TOKEN_SEGUNDOS, restante);
  // Se conserva el mismo `jti`: cerrar la sesión revoca también las renovaciones.
  const nuevo = await firmar(p.username, p.rol ?? "lectura", typeof p.sv === "number" ? p.sv : 0, ini, segundos, p.jti ?? crypto.randomUUID());
  return { token: nuevo, opciones: opcionesCookie(segundos) };
}

/** Cierra la sesión en TODOS los dispositivos: los tokens anteriores dejan de valer. */
export async function cerrarTodasLasSesiones(username: string) {
  await sql`UPDATE usuarios SET sesion_version = sesion_version + 1 WHERE username = ${username}`;
  olvidarUsuario(username);
}

/**
 * Revoca el token de la sesión actual en el servidor (además de borrar la cookie): si alguien
 * se hubiera copiado la cookie, deja de servirle al instante en la instancia que atiende el
 * "Salir" y, en las demás, en cuanto vence su caché de pocos segundos.
 */
export async function revocarSesionActual() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return;
  const p = await verifyToken(token);
  if (!p?.jti || typeof p.exp !== "number") return;
  await sql`
    INSERT INTO sesiones_revocadas (jti, expira) VALUES (${p.jti}, to_timestamp(${p.exp}))
    ON CONFLICT (jti) DO NOTHING
  `;
  if (Math.random() < 0.05) await sql`DELETE FROM sesiones_revocadas WHERE expira < now()`;
  olvidarUsuario(p.username);
}

export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function verifyToken(token: string) {
  const secret = getSecret(); // un secreto mal configurado debe verse como error, no como "token inválido"
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: [alg] });
    // Tope absoluto de la sesión desde que se inició (los tokens antiguos sin `ini` usan su `iat`).
    const ini = typeof payload.ini === "number" ? payload.ini : payload.iat;
    if (typeof ini === "number" && Date.now() / 1000 - ini > SESION_MAX_SEGUNDOS) return null;
    return payload as { username: string; rol?: Rol; sv?: number; iat?: number; ini?: number; jti?: string; exp?: number };
  } catch {
    return null;
  }
}

/**
 * Valida el token Y consulta la base de datos: el rol y el estado
 * "activo" se toman de la tabla `usuarios`, no del token. Así, si un
 * administrador desactiva a alguien o le cambia el rol, el cambio
 * aplica de inmediato y no hay que esperar a que venza la sesión.
 */
export async function getUserFromToken(
  token: string,
  /** true = ignora la caché y consulta la base (el proxy lo usa en toda escritura). */
  fresco = false
): Promise<UsuarioSesion | null> {
  const payload = await verifyToken(token);
  if (!payload?.username) return null;

  // Los tokens emitidos antes de existir la versión de sesión no la traen: valen 0.
  const svToken = typeof payload.sv === "number" ? payload.sv : 0;

  // Caché de pocos segundos: cada petición pasa por el proxy y por la ruta,
  // y sin esto cada una consultaba la base de datos dos veces. Solo se usa si
  // la versión coincide; si no, se consulta la base antes de rechazar.
  const guardado = cacheUsuarios.get(payload.username);
  if (!fresco && guardado && guardado.vence > Date.now() && guardado.sv === svToken) {
    return guardado.usuario;
  }

  await ensureSchema();
  const rows = await sql`
    SELECT username, rol, sesion_version, debe_cambiar_clave, mfa_activo,
           (SELECT COUNT(*) FROM sesiones_revocadas WHERE jti = ${payload.jti ?? ""})::int AS revocada
    FROM usuarios
    WHERE username = ${payload.username} AND activo = true
  `;
  if (rows.length === 0) {
    cacheUsuarios.delete(payload.username);
    return null;
  }
  // Sesión cerrada con "Salir" (el token ya no vale aunque no haya vencido).
  if (payload.jti && (rows[0].revocada as number) > 0) {
    cacheUsuarios.delete(payload.username);
    return null;
  }
  // Contraseña cambiada o restablecida después de emitir este token.
  if ((rows[0].sesion_version as number) !== svToken) {
    cacheUsuarios.delete(payload.username);
    return null;
  }
  const usuario: UsuarioSesion = {
    username: rows[0].username as string,
    rol: rows[0].rol as Rol,
    debeCambiarClave: rows[0].debe_cambiar_clave === true,
    mfaActivo: rows[0].mfa_activo === true,
  };
  cacheUsuarios.set(payload.username, {
    usuario,
    sv: svToken,
    vence: Date.now() + TTL_USUARIO_MS,
  });
  return usuario;
}

/** Olvida al usuario guardado (se llama al cambiarle el rol, desactivarlo o eliminarlo). */
export function olvidarUsuario(username: string) {
  cacheUsuarios.delete(username);
}

export async function getCurrentUser(fresco = false): Promise<UsuarioSesion | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return getUserFromToken(token, fresco);
}

/** Devuelve al usuario en sesión solo si es administrador (null en otro caso). */
export async function getAdmin(): Promise<UsuarioSesion | null> {
  // Sin caché: un administrador degradado o desactivado pierde el acceso al instante.
  const user = await getCurrentUser(true);
  return user?.rol === "admin" ? user : null;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
