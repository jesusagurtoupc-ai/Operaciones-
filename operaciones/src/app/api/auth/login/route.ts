import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql, ensureSchema } from "@/lib/server/db";
import { createSession, type Rol } from "@/lib/server/auth";
import { bloqueado, registrarFallo, limpiarFallos } from "@/lib/server/limiteLogin";

// Hash de relleno: se compara igual cuando el usuario no existe, para que
// el tiempo de respuesta no delate qué usuarios están registrados.
const HASH_RELLENO = bcrypt.hashSync("relleno-sin-uso", 10);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const username = String(body.username ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
    const clave = `${username}|${ip}`;
    if (bloqueado(clave)) {
      return NextResponse.json(
        { error: "Demasiados intentos fallidos. Espera 15 minutos e intenta de nuevo." },
        { status: 429 }
      );
    }

    await ensureSchema();
    const rows = await sql`
      SELECT username, password_hash, rol, activo
      FROM usuarios WHERE username = ${username}
    `;
    const u = rows[0] as
      | { username: string; password_hash: string; rol: Rol; activo: boolean }
      | undefined;

    const ok = await bcrypt.compare(password, u?.password_hash ?? HASH_RELLENO);
    if (!u || !ok || !u.activo) {
      registrarFallo(clave);
      return NextResponse.json(
        { error: "Usuario o contraseña incorrectos" },
        { status: 401 }
      );
    }

    limpiarFallos(clave);
    await createSession(u.username, u.rol);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "No se pudo iniciar sesión. Intenta de nuevo." },
      { status: 500 }
    );
  }
}
