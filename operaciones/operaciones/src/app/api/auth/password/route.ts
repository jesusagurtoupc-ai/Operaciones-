import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/server/db";
import { getCurrentUser, createSession, olvidarUsuario } from "@/lib/server/auth";
import { bloqueado, registrarFallo, limpiarFallos } from "@/lib/server/limiteLogin";
import { ensureSchema } from "@/lib/server/db";

// Intentos fallidos de "contraseña actual" permitidos en 15 minutos. Sin límite, quien tuviera
// una sesión robada podía adivinar la contraseña actual sin freno y quedarse con la cuenta.
const MAX_FALLOS_CLAVE_ACTUAL = 5;

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

    if (nueva.length < 6) {
      return NextResponse.json(
        { error: "La nueva contraseña debe tener al menos 6 caracteres" },
        { status: 400 }
      );
    }
    if (nueva === actual) {
      return NextResponse.json(
        { error: "La nueva contraseña debe ser distinta de la actual" },
        { status: 400 }
      );
    }

    await ensureSchema();
    const claveLimite = `pw:${user.username}`;
    if (await bloqueado(claveLimite, MAX_FALLOS_CLAVE_ACTUAL)) {
      return NextResponse.json(
        { error: "Demasiados intentos fallidos. Espera 15 minutos e intenta de nuevo." },
        { status: 429 }
      );
    }

    const rows = await sql`
      SELECT password_hash FROM usuarios WHERE username = ${user.username}
    `;
    const hash = (rows[0] as { password_hash: string } | undefined)?.password_hash;
    if (!hash || !(await bcrypt.compare(actual, hash))) {
      await registrarFallo(claveLimite);
      return NextResponse.json(
        { error: "La contraseña actual no es correcta" },
        { status: 400 }
      );
    }
    await limpiarFallos(claveLimite);

    // sesiones_desde = ahora, con el reloj de ESTA app (el mismo que pone el `iat` del token; si se
    // usara el de la base de datos y difirieran un segundo, la sesión renovada de abajo se
    // rechazaría). Las demás sesiones abiertas de esta cuenta (p. ej. una robada) dejan de valer;
    // la de quien cambia la clave se renueva para que siga conectado.
    await sql`
      UPDATE usuarios
      SET password_hash = ${await bcrypt.hash(nueva, 10)}, sesiones_desde = to_timestamp(${Math.floor(Date.now() / 1000)})
      WHERE username = ${user.username}
    `;
    olvidarUsuario(user.username);
    await createSession(user.username, user.rol);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "No se pudo cambiar la contraseña" },
      { status: 500 }
    );
  }
}
