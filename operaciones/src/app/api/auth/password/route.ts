import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/server/db";
import { getCurrentUser, createSession, olvidarUsuario } from "@/lib/server/auth";
import { registrarUsuario } from "@/lib/server/auditoriaUsuarios";
import { errorContrasena, BCRYPT_COSTO } from "@/lib/shared/passwords";
import { contarIntento, limpiarFallos } from "@/lib/server/limiteLogin";

/** Cambia la contraseña del usuario en sesión (cualquier rol). */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const actual = String(body.actual ?? "");
    const nueva = String(body.nueva ?? "");

    const errorClave = errorContrasena(nueva, user.username);
    if (errorClave) {
      return NextResponse.json({ error: errorClave }, { status: 400 });
    }
    if (nueva === actual) {
      return NextResponse.json(
        { error: "La nueva contraseña debe ser distinta de la actual" },
        { status: 400 }
      );
    }

    // Una sesión robada no debe servir para adivinar la contraseña actual sin freno.
    const claveLimite = `p|${encodeURIComponent(user.username.slice(0, 100))}`;
    if ((await contarIntento(claveLimite)) > 10) {
      return NextResponse.json({ error: "Demasiados intentos. Espera 15 minutos." }, { status: 429 });
    }
    const rows = await sql`
      SELECT password_hash FROM usuarios WHERE username = ${user.username}
    `;
    const hash = (rows[0] as { password_hash: string } | undefined)?.password_hash;
    if (!hash || !(await bcrypt.compare(actual, hash))) {
      return NextResponse.json(
        { error: "La contraseña actual no es correcta" },
        { status: 400 }
      );
    }

    await limpiarFallos(claveLimite);

    // Sube la versión de sesión: las demás sesiones abiertas con la clave
    // anterior dejan de valer. Esta sesión se renueva para no sacar a quien cambia su clave.
    const nuevaVersion = await sql`
      UPDATE usuarios
      SET password_hash = ${await bcrypt.hash(nueva, BCRYPT_COSTO)},
          sesion_version = sesion_version + 1,
          debe_cambiar_clave = false
      WHERE username = ${user.username}
      RETURNING sesion_version
    `;
    olvidarUsuario(user.username);
    await registrarUsuario(user.username, "Cambió su contraseña", user.username);
    await createSession(user.username, user.rol, nuevaVersion[0].sesion_version as number);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "No se pudo cambiar la contraseña" },
      { status: 500 }
    );
  }
}
