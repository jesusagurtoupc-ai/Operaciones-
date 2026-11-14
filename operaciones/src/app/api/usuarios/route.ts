import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql, ensureSchema } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/auth";
import { paginasValidas, paginasParaGuardar } from "@/lib/shared";
import { errorClaveNueva } from "@/lib/server/utils";
import { registrarEvento, ipDe } from "@/lib/server/auditoria";

async function soloAdmin() {
  const user = await getCurrentUser();
  return user?.rol === "admin" ? user : null;
}

export async function GET() {
  if (!(await soloAdmin())) {
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  }
  try {
    await ensureSchema();
    const rows = await sql`
      SELECT id, username, rol, activo, paginas, created_at
      FROM usuarios ORDER BY username
    `;
    return NextResponse.json({ data: rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error al listar usuarios" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const admin = await soloAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const username = String(body.username ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const rol = body.rol === "admin" ? "admin" : body.rol === "lectura" ? "lectura" : null;

    if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
      return NextResponse.json(
        { error: "El usuario debe tener 3 a 30 caracteres: letras, números, punto, guion o guion bajo" },
        { status: 400 }
      );
    }
    const errClave = errorClaveNueva(password);
    if (errClave) {
      return NextResponse.json({ error: errClave }, { status: 400 });
    }
    if (!rol) {
      return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
    }

    // Páginas permitidas: el administrador ve todo; sin lista = todas; con lista, al menos una.
    const lista = paginasValidas(body.paginas);
    if (rol === "lectura" && lista !== null && lista.length === 0) {
      return NextResponse.json({ error: "Elige al menos una página para este usuario" }, { status: 400 });
    }
    const paginas = rol === "admin" ? null : paginasParaGuardar(lista);

    await ensureSchema();
    // sesiones_desde = ahora: si antes existió otro usuario con este mismo nombre y se eliminó, sus
    // sesiones antiguas (tokens emitidos antes de hoy) no sirven para entrar con la cuenta nueva.
    const hash = await bcrypt.hash(password, 10);
    const rows = await sql`
      INSERT INTO usuarios (username, password_hash, rol, paginas, sesiones_desde)
      VALUES (${username}, ${hash}, ${rol}, ${paginas}::text[], to_timestamp(${Math.floor(Date.now() / 1000)}))
      ON CONFLICT (username) DO NOTHING
      RETURNING id, username, rol, activo, paginas, created_at
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Ese usuario ya existe" }, { status: 409 });
    }
    await registrarEvento(
      "usuario_creado", admin.username,
      `creó "${username}" (${rol}${paginas ? `, páginas: ${paginas.join(", ")}` : ""})`, ipDe(req)
    );
    return NextResponse.json({ data: rows[0] }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error al crear el usuario" }, { status: 500 });
  }
}
