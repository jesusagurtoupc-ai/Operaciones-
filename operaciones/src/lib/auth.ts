import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { sql, ensureSchema } from "@/lib/db";

const COOKIE_NAME = "correctivos_session";
const alg = "HS256";

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
  await ensureSchema();
  const rows = await sql`
    SELECT username, rol FROM usuarios
    WHERE username = ${payload.username} AND activo = true
  `;
  if (rows.length === 0) return null;
  return { username: rows[0].username as string, rol: rows[0].rol as Rol };
}

export async function getCurrentUser(): Promise<UsuarioSesion | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return getUserFromToken(token);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
