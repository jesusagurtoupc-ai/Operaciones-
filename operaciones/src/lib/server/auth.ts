import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { sql, ensureSchema } from "@/lib/server/db";

const COOKIE_NAME = "correctivos_session";
const alg = "HS256";

// Cuánto se recuerda el rol/estado de un usuario antes de volver a consultarlo.
// En otras instancias del servidor un cambio de rol puede tardar hasta este tiempo.
const TTL_USUARIO_MS = 10_000;
const cacheUsuarios = new Map<string, { usuario: UsuarioSesion; vence: number }>();

export type Rol = "admin" | "lectura";
export type UsuarioSesion = { username: string; rol: Rol };

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "Falta la variable de entorno SESSION_SECRET (defínela en .env.local o en Vercel)."
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createSession(username: string, rol: Rol) {
  const token = await new SignJWT({ username, rol })
    .setProtectedHeader({ alg })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 días
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as { username: string; rol?: Rol };
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
  token: string
): Promise<UsuarioSesion | null> {
  const payload = await verifyToken(token);
  if (!payload?.username) return null;

  // Caché de pocos segundos: cada petición pasa por el proxy y por la ruta,
  // y sin esto cada una consultaba la base de datos dos veces.
  const guardado = cacheUsuarios.get(payload.username);
  if (guardado && guardado.vence > Date.now()) return guardado.usuario;

  await ensureSchema();
  const rows = await sql`
    SELECT username, rol FROM usuarios
    WHERE username = ${payload.username} AND activo = true
  `;
  if (rows.length === 0) {
    cacheUsuarios.delete(payload.username);
    return null;
  }
  const usuario = { username: rows[0].username as string, rol: rows[0].rol as Rol };
  cacheUsuarios.set(payload.username, { usuario, vence: Date.now() + TTL_USUARIO_MS });
  return usuario;
}

/** Olvida al usuario guardado (se llama al cambiarle el rol, desactivarlo o eliminarlo). */
export function olvidarUsuario(username: string) {
  cacheUsuarios.delete(username);
}

export async function getCurrentUser(): Promise<UsuarioSesion | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return getUserFromToken(token);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
