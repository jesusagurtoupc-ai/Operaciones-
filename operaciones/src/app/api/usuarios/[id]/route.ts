import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/server/db";
import { getCurrentUser, olvidarUsuario, createSession } from "@/lib/server/auth";
import { paginasValidas, paginasParaGuardar } from "@/lib/shared";
import { errorClaveNueva } from "@/lib/server/utils";
import { registrarEvento, ipDe } from "@/lib/server/auditoria";

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

    if (body.activo !== undefined && typeof body.activo !== "boolean") {
      return NextResponse.json({ error: "Valor de activo inválido" }, { status: 400 });
    }
    if (body.rol !== undefined && body.rol !== "admin" && body.rol !== "lectura") {
      return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
    }
    if (esMismo && (cambiaRol || cambiaActivo)) {
      return NextResponse.json(
        { error: "No puedes cambiar tu propio rol ni desactivarte" },
        { status: 400 }
      );
    }
    // Páginas: se manda la lista marcada. Si están TODAS se guarda null (= todas, también las futuras).
    const cambiaPaginas = body.paginas !== undefined;
    const lista = cambiaPaginas ? paginasValidas(body.paginas) : null;
    if (cambiaPaginas && (lista === null || lista.length === 0)) {
      return NextResponse.json({ error: "Elige al menos una página" }, { status: 400 });
    }
    const paginas = paginasParaGuardar(lista);
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

    let hash: string | null = null;
    if (body.password !== undefined) {
      const password = String(body.password);
      const errClave = errorClaveNueva(password);
      if (errClave) {
        return NextResponse.json({ error: errClave }, { status: 400 });
      }
      hash = await bcrypt.hash(password, 10);
    }
    const cambioClave = hash !== null; // se cierran las sesiones abiertas de esa cuenta
    const rolNuevo = cambiaRol ? String(body.rol) : null;
    const activoNuevo = cambiaActivo ? Boolean(body.activo) : null;

    // Un solo UPDATE (todo o nada) que además vuelve a comprobar, con los administradores
    // bloqueados, que quede otro admin activo: dos admins quitándose el rol a la vez ya no pueden
    // dejar el sistema sin ninguno.
    const hechoRows = await sql`
      WITH admins AS (
        SELECT id FROM usuarios WHERE rol = 'admin' AND activo = true FOR UPDATE
      )
      UPDATE usuarios SET
        password_hash = COALESCE(${hash}::text, password_hash),
        sesiones_desde = CASE WHEN ${hash}::text IS NULL THEN sesiones_desde
                              ELSE to_timestamp(${Math.floor(Date.now() / 1000)}) END,
        rol = COALESCE(${rolNuevo}::text, rol),
        paginas = CASE WHEN ${cambiaPaginas} THEN ${paginas}::text[] ELSE paginas END,
        activo = COALESCE(${activoNuevo}::boolean, activo)
      WHERE id = ${objetivo.id}
        AND (
          NOT (rol = 'admin' AND activo = true
               AND (COALESCE(${rolNuevo}::text, rol) <> 'admin' OR COALESCE(${activoNuevo}::boolean, activo) = false))
          OR (SELECT COUNT(*) FROM admins WHERE admins.id <> ${objetivo.id}) > 0
        )
      RETURNING id
    `;
    if (hechoRows.length === 0) {
      return NextResponse.json(
        { error: "Debe quedar al menos un administrador activo" },
        { status: 400 }
      );
    }

    olvidarUsuario(objetivo.username);
    const hechos = [
      cambioClave && "restableció la contraseña",
      cambiaRol && `rol ${objetivo.rol} → ${body.rol}`,
      cambiaActivo && (body.activo ? "activó la cuenta" : "desactivó la cuenta"),
      cambiaPaginas && `páginas: ${paginas ? paginas.join(", ") : "todas"}`,
    ].filter(Boolean);
    if (hechos.length > 0) {
      await registrarEvento(
        cambioClave && hechos.length === 1 ? "clave_cambiada" : "usuario_editado",
        yo.username, `"${objetivo.username}": ${hechos.join(" · ")}`, ipDe(req)
      );
    }
    // Si el admin cambió SU PROPIA clave, se renueva su sesión para que no lo desconecte a él.
    if (cambioClave && esMismo) await createSession(yo.username, yo.rol);
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
    // Igual que al editar: el borrado vuelve a comprobar, con los admins bloqueados, que quede otro.
    const borrados = await sql`
      WITH admins AS (
        SELECT id FROM usuarios WHERE rol = 'admin' AND activo = true FOR UPDATE
      )
      DELETE FROM usuarios
      WHERE id = ${objetivo.id}
        AND (NOT (rol = 'admin' AND activo = true)
             OR (SELECT COUNT(*) FROM admins WHERE admins.id <> ${objetivo.id}) > 0)
      RETURNING id
    `;
    if (borrados.length === 0) {
      return NextResponse.json(
        { error: "Debe quedar al menos un administrador activo" },
        { status: 400 }
      );
    }
    olvidarUsuario(objetivo.username);
    await registrarEvento("usuario_eliminado", yo.username, `eliminó "${objetivo.username}" (${objetivo.rol})`, ipDe(req));
    // Su borrador de materiales también se va: si mañana se crea otro usuario con el mismo nombre,
    // no debe encontrarse la solicitud a medio hacer de la persona anterior.
    await sql`DELETE FROM materiales_borradores WHERE username = ${objetivo.username}`.catch(() => {
      /* la tabla aún no existe: no hay nada que borrar */
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error al eliminar el usuario" }, { status: 500 });
  }
}
