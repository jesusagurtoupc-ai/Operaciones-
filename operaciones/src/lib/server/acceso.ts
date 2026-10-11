import { NextResponse } from "next/server";
import { getCurrentUser, type UsuarioSesion } from "@/lib/server/auth";

/**
 * Comprobación de sesión DENTRO de cada ruta (defensa en profundidad): el proxy
 * ya filtra, pero si alguna vez falla o cambia su matcher, las rutas de lectura
 * no deben quedar abiertas. Devuelve el usuario, o la respuesta 401 lista para devolver.
 */
export async function exigirSesion(): Promise<
  { user: UsuarioSesion; error?: undefined } | { user?: undefined; error: NextResponse }
> {
  const user = await getCurrentUser();
  if (!user) {
    return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  }
  return { user };
}
