import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql, ensureSchema } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/auth";
import { registrarUsuario } from "@/lib/server/auditoriaUsuarios";
import { errorContrasena, BCRYPT_COSTO } from "@/lib/shared/passwords";
import { exigirReauth } from "@/lib/server/reauth";

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
      SELECT id, username, rol, activo, created_at, mfa_activo
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
  const reauth = await exigirReauth(req, admin);
  if (reauth) return reauth;
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
    const errorClave = errorContrasena(password, username);
    if (errorClave) {
      return NextResponse.json({ error: errorClave }, { status: 400 });
    }
    if (!rol) {
      return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
    }

    await ensureSchema();
    const hash = await bcrypt.hash(password, BCRYPT_COSTO);
    const rows = await sql`
      INSERT INTO usuarios (username, password_hash, rol, debe_cambiar_clave)
      VALUES (${username}, ${hash}, ${rol}, true)
      ON CONFLICT (username) DO NOTHING
      RETURNING id, username, rol, activo, created_at
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Ese usuario ya existe" }, { status: 409 });
    }
    await registrarUsuario(admin.username, "Usuario creado", username, `Rol: ${rol}`);
    return NextResponse.json({ data: rows[0] }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error al crear el usuario" }, { status: 500 });
  }
}
