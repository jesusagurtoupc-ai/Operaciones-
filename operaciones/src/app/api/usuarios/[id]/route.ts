import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

async function cargar(idRaw: string) {
  if (!/^\d+$/.test(idRaw)) return null;
  const rows = await sql`
    SELECT id, username, rol, activo FROM usuarios WHERE id = ${Number(idRaw)}
  `;
  return (rows[0] as { id: number; username: string; rol: string; activo: boolean }) ?? null;
}

/** Cuenta los administradores activos distintos del usuario indicado. */
async function otrosAdminsActivos(id: number) {
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM usuarios
    WHERE rol = 'admin' AND activo = true AND id <> ${id}
  `;
  return (rows[0] as { n: number }).n;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const yo = await getCurrentUser();
  if (yo?.rol !== "admin") {
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  }
  try {
    const { id } = await params;
    const objetivo = await cargar(id);
    if (!objetivo) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    const body = await req.json().catch(() => ({}));
    const esMismo = objetivo.username === yo.username;

    const cambiaRol = body.rol !== undefined && body.rol !== objetivo.rol;
    const cambiaActivo = body.activo !== undefined && body.activo !== objetivo.activo;

    if (body.rol !== undefined && body.rol !== "admin" && body.rol !== "lectura") {
      return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
    }
    if (esMismo && (cambiaRol || cambiaActivo)) {
      return NextResponse.json(
        { error: "No puedes cambiar tu propio rol ni desactivarte" },
        { status: 400 }
      );
    }
    const dejaDeSerAdminActivo =
      objetivo.rol === "admin" &&
      objetivo.activo &&
      ((cambiaRol && body.rol !== "admin") || (cambiaActivo && body.activo === false));
    if (dejaDeSerAdminActivo && (await otrosAdminsActivos(objetivo.id)) === 0) {
      return NextResponse.json(
        { error: "Debe quedar al menos un administrador activo" },
        { status: 400 }
      );
    }

    if (body.password !== undefined) {
      const password = String(body.password);
      if (password.length < 6) {
        return NextResponse.json(
          { error: "La contraseña debe tener al menos 6 caracteres" },
          { status: 400 }
        );
      }
      await sql`
        UPDATE usuarios SET password_hash = ${bcrypt.hashSync(password, 10)}
        WHERE id = ${objetivo.id}
      `;
    }
    if (cambiaRol) {
      await sql`UPDATE usuarios SET rol = ${body.rol} WHERE id = ${objetivo.id}`;
    }
    if (cambiaActivo) {
      await sql`UPDATE usuarios SET activo = ${Boolean(body.activo)} WHERE id = ${objetivo.id}`;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error al actualizar el usuario" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const yo = await getCurrentUser();
  if (yo?.rol !== "admin") {
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  }
  try {
    const { id } = await params;
    const objetivo = await cargar(id);
    if (!objetivo) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    if (objetivo.username === yo.username) {
      return NextResponse.json({ error: "No puedes eliminarte a ti mismo" }, { status: 400 });
    }
    if (
      objetivo.rol === "admin" &&
      objetivo.activo &&
      (await otrosAdminsActivos(objetivo.id)) === 0
    ) {
      return NextResponse.json(
        { error: "Debe quedar al menos un administrador activo" },
        { status: 400 }
      );
    }
    await sql`DELETE FROM usuarios WHERE id = ${objetivo.id}`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error al eliminar el usuario" }, { status: 500 });
  }
}
