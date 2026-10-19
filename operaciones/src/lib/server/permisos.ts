// Verificación de sesión y rol DENTRO de cada ruta de la API.
//
// El proxy (src/proxy.ts) ya bloquea a quien no tiene sesión y a los usuarios
// de solo lectura, pero es una sola capa: si alguna vez falla o una ruta nueva
// queda fuera de su alcance, los datos quedarían expuestos. Cada ruta vuelve a
// comprobarlo por su cuenta (defensa en profundidad), con los mismos mensajes.
import { NextResponse } from "next/server";
import { getCurrentUser, type UsuarioSesion } from "./auth";

export type Acceso =
  | { user: UsuarioSesion; error?: undefined }
  | { user?: undefined; error: NextResponse };

/** Cualquier usuario con sesión válida (admin o lectura). */
export async function exigirSesion(): Promise<Acceso> {
  const user = await getCurrentUser();
  if (!user) {
    return { error: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
  }
  return { user };
}

/** Solo administradores: para crear, editar y eliminar. */
export async function exigirAdmin(): Promise<Acceso> {
  const acceso = await exigirSesion();
  if (acceso.error) return acceso;
  if (acceso.user.rol !== "admin") {
    return {
      error: NextResponse.json({ error: "Tu usuario es de solo lectura" }, { status: 403 }),
    };
  }
  return acceso;
}
