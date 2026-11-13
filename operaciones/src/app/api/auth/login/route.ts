import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql, ensureSchema } from "@/lib/server/db";
import { createSession, type Rol } from "@/lib/server/auth";
import {
  bloqueado, registrarFallo, limpiarFallos, MAX_FALLOS_USUARIO, MAX_FALLOS_IP,
} from "@/lib/server/utils";
import { registrarEvento, ipDe } from "@/lib/server/auditoria";

// Hash de relleno: se compara igual cuando el usuario no existe, para que
// el tiempo de respuesta no delate qué usuarios están registrados. Se calcula en segundo plano (antes
// era hashSync al cargar el módulo: bloqueaba ~80 ms cada arranque en frío del inicio de sesión).
const HASH_RELLENO: Promise<string> = bcrypt.hash("relleno-sin-uso", 10);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const username = String(body.username ?? "").trim().toLowerCase().slice(0, 100);
    const password = String(body.password ?? "");

    const ip = ipDe(req); // recortada a 64 caracteres: la clave del contador de intentos no crece sin límite
    const claveUsuario = `u:${username}|${ip}`;
    const claveIp = `ip:${ip}`;

    await ensureSchema();
    if (
      (await bloqueado(claveUsuario, MAX_FALLOS_USUARIO)) ||
      (await bloqueado(claveIp, MAX_FALLOS_IP))
    ) {
      await registrarEvento("login_bloqueado", username || null, "demasiados intentos fallidos", ip);
      return NextResponse.json(
        { error: "Demasiados intentos fallidos. Espera 15 minutos e intenta de nuevo." },
        { status: 429 }
      );
    }

    const rows = await sql`
      SELECT username, password_hash, rol, activo
      FROM usuarios WHERE username = ${username}
    `;
    const u = rows[0] as
      | { username: string; password_hash: string; rol: Rol; activo: boolean }
      | undefined;

    const ok = await bcrypt.compare(password, u?.password_hash ?? (await HASH_RELLENO));
    if (!u || !ok || !u.activo) {
      await Promise.all([
        registrarFallo(claveUsuario),
        registrarFallo(claveIp),
        registrarEvento("login_fallo", username || null, !u ? "usuario inexistente" : !u.activo ? "usuario desactivado" : "contraseña incorrecta", ip),
      ]);
      return NextResponse.json(
        { error: "Usuario o contraseña incorrectos" },
        { status: 401 }
      );
    }

    await limpiarFallos(claveUsuario);
    await createSession(u.username, u.rol);
    await registrarEvento("login_ok", u.username, "", ip);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "No se pudo iniciar sesión. Intenta de nuevo." },
      { status: 500 }
    );
  }
}
