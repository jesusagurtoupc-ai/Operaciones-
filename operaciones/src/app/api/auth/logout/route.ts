import { NextRequest, NextResponse } from "next/server";
import { destroySession, getCurrentUser, cerrarTodasLasSesiones, revocarSesionActual } from "@/lib/server/auth";
import { registrarUsuario } from "@/lib/server/auditoriaUsuarios";
import { registrarAcceso } from "@/lib/server/auditoriaAccesos";

/** Cierra la sesión. Con `{ "todas": true }` la cierra además en todos los dispositivos. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const quien = await getCurrentUser().catch(() => null);
  if (quien) await registrarAcceso(body?.todas === true ? "logout_todas" : "logout", quien.username, req);
  if (body?.todas === true) {
    try {
      const user = await getCurrentUser();
      if (user) {
        await cerrarTodasLasSesiones(user.username);
        await registrarUsuario(user.username, "Cerró todas sus sesiones", user.username);
      }
    } catch (err) {
      console.error(err);
      return NextResponse.json({ error: "No se pudieron cerrar las sesiones" }, { status: 500 });
    }
  }
  try {
    await revocarSesionActual();
  } catch (err) {
    console.error(err); // aunque falle, la cookie se borra igualmente
  }
  await destroySession();
  return NextResponse.json({ ok: true });
}
