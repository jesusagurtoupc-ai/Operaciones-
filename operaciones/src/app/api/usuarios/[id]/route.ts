import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/server/db";
import { getCurrentUser, olvidarUsuario } from "@/lib/server/auth";
import { registrarUsuario } from "@/lib/server/auditoriaUsuarios";
import { actualizarRolYActivo, eliminarUsuarioSeguro } from "@/lib/server/admins";
import { errorContrasena, BCRYPT_COSTO } from "@/lib/shared/passwords";
import { exigirReauth } from "@/lib/server/reauth";

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
  const reauth = await exigirReauth(req, yo);
  if (reauth) return reauth;
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
    if (body.activo !== undefined && typeof body.activo !== "boolean") {
      return NextResponse.json({ error: "El campo activo debe ser verdadero o falso" }, { status: 400 });
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

    // Se valida la contraseña ANTES de tocar nada, para no dejar un cambio a medias.
    let nuevaClave: string | null = null;
    if (body.password !== undefined) {
      nuevaClave = String(body.password);
      const errorClave = errorContrasena(nuevaClave, objetivo.username);
      if (errorClave) {
        return NextResponse.json({ error: errorClave }, { status: 400 });
      }
    }

    if (cambiaRol || cambiaActivo) {
      // Una sola sentencia: la garantía de "queda al menos un administrador activo" se aplica
      // en la base de datos, así que dos cambios simultáneos no pueden dejar cero.
      const aplicado = await actualizarRolYActivo(
        objetivo.id,
        cambiaRol ? body.rol : objetivo.rol,
        cambiaActivo ? body.activo : objetivo.activo
      );
      if (!aplicado) {
        return NextResponse.json({ error: "Debe quedar al menos un administrador activo" }, { status: 400 });
      }
    }
    if (body.mfa === false) {
      // Un administrador puede quitar la verificación en dos pasos de alguien que perdió su teléfono.
      await sql`
        UPDATE usuarios
        SET mfa_activo = false, mfa_secreto = NULL, mfa_ultimo_paso = 0, mfa_respaldo = '[]'::jsonb, sesion_version = sesion_version + 1
        WHERE id = ${objetivo.id}
      `;
      await registrarUsuario(yo.username, "Verificación en dos pasos restablecida", objetivo.username);
    }
    if (nuevaClave !== null) {
      await sql`
        UPDATE usuarios
        SET password_hash = ${await bcrypt.hash(nuevaClave, BCRYPT_COSTO)},
            sesion_version = sesion_version + 1,
            debe_cambiar_clave = ${!esMismo}
        WHERE id = ${objetivo.id}
      `;
      await registrarUsuario(yo.username, "Contraseña restablecida", objetivo.username);
    }
    if (cambiaRol) {
      await registrarUsuario(yo.username, "Rol cambiado", objetivo.username, `${objetivo.rol} → ${body.rol}`);
    }
    if (cambiaActivo) {
      await registrarUsuario(
        yo.username,
        body.activo ? "Usuario activado" : "Usuario desactivado",
        objetivo.username
      );
    }

    olvidarUsuario(objetivo.username);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error al actualizar el usuario" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const yo = await getCurrentUser();
  if (yo?.rol !== "admin") {
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  }
  const reauth = await exigirReauth(req, yo);
  if (reauth) return reauth;
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
    if (!(await eliminarUsuarioSeguro(objetivo.id))) {
      return NextResponse.json({ error: "Debe quedar al menos un administrador activo" }, { status: 400 });
    }
    olvidarUsuario(objetivo.username);
    await registrarUsuario(yo.username, "Usuario eliminado", objetivo.username, `Rol: ${objetivo.rol}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error al eliminar el usuario" }, { status: 500 });
  }
}
