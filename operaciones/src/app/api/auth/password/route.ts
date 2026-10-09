import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/auth";

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

    await sql`
      UPDATE usuarios SET password_hash = ${await bcrypt.hash(nueva, 10)}
      WHERE username = ${user.username}
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "No se pudo cambiar la contraseña" },
      { status: 500 }
    );
  }
}
