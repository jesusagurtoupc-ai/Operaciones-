import { SignJWT, jwtVerify } from "jose";
import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { UsuarioSesion } from "@/lib/server/auth";

// Reautenticación ("modo sudo") para las acciones delicadas de administrador: crear usuarios,
// cambiar roles, desactivar, restablecer contraseñas o el 2FA de otros, y eliminar usuarios.
// Una cookie de sesión robada ya no basta para ello: hay que volver a dar la contraseña (y el
// código del 2FA si lo tiene). La prueba dura 10 minutos y es de ese usuario y esa versión de sesión.

export const REAUTH_SEGUNDOS = 60 * 10;
const NOMBRE = process.env.NODE_ENV === "production" ? "__Host-correctivos_reauth" : "correctivos_reauth";
export const REAUTH_COOKIE_NAME = NOMBRE;

/** Clave propia derivada de SESSION_SECRET: un token de sesión no sirve aquí ni al revés. */
function clave(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("Falta SESSION_SECRET");
  return new Uint8Array(createHmac("sha256", s).update("reauth-v1").digest());
}

export function opcionesCookieReauth() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: REAUTH_SEGUNDOS,
  };
}

export async function emitirReauth(username: string, sv: number): Promise<string> {
  return new SignJWT({ k: "reauth", sv })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(username)
    .setAudience("reauth")
    .setIssuedAt()
    .setExpirationTime(`${REAUTH_SEGUNDOS}s`)
    .sign(clave());
}

/** ¿La petición trae una prueba de reautenticación vigente de este usuario? */
export async function reautenticadoReciente(req: NextRequest, username: string): Promise<boolean> {
  const token = req.cookies.get(NOMBRE)?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, clave(), { algorithms: ["HS256"], audience: "reauth" });
    return payload.k === "reauth" && payload.sub === username;
  } catch {
    return false;
  }
}

/**
 * null = puede continuar. Si no, devuelve el 403 que la interfaz entiende (`codigo: "REAUTH"`)
 * para pedir la contraseña (y el código, si `pideCodigo`) y reintentar.
 */
export async function exigirReauth(req: NextRequest, user: UsuarioSesion): Promise<NextResponse | null> {
  if (process.env.REAUTH_ADMIN === "0") return null; // salida de emergencia documentada en el README
  if (await reautenticadoReciente(req, user.username)) return null;
  return NextResponse.json(
    {
      error: "Por seguridad, confirma tu contraseña para continuar",
      codigo: "REAUTH",
      pideCodigo: user.mfaActivo === true,
    },
    { status: 403 }
  );
}

/** true si REQUIRE_ADMIN_MFA=1 y este administrador aún no activó la verificación en dos pasos. */
export function adminSinMfa(user: Pick<UsuarioSesion, "rol" | "mfaActivo">): boolean {
  return process.env.REQUIRE_ADMIN_MFA === "1" && user.rol === "admin" && user.mfaActivo !== true;
}
