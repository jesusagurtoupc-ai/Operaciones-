import { exigirSesion } from "@/lib/server/acceso";
import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { getAdmin } from "@/lib/server/auth";
import { validarCorrectivo } from "@/lib/server/validacion";
import { diferencias, registrar } from "@/lib/server/historial";
import { esViolacionUnica } from "@/lib/server/errores";
import { normalizeCorrectivo } from "@/lib/shared/types";


type Params = { params: Promise<{ id: string }> };

/** Valida que el id de la URL sea un entero antes de tocar la base de
 * datos. Sin esto, un id no numérico (p. ej. /api/correctivos/abc)
 * hacía fallar la consulta SQL y devolvía un 500 genérico en vez de
 * un 400 claro. */
function parseId(id: string): number | null {
  if (!/^\d+$/.test(id)) return null;
  return Number(id);
}

export async function GET(_req: NextRequest, { params }: Params) {
  const sesion = await exigirSesion();
  if (sesion.error) return sesion.error;
  try {
    const { id } = await params;
    const numId = parseId(id);
    if (numId === null) {
      return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    }

    const rows = await sql`SELECT * FROM correctivos WHERE id = ${numId} AND eliminado_en IS NULL`;
    if (rows.length === 0) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    return NextResponse.json({ data: normalizeCorrectivo(rows[0] as Record<string, unknown>) });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Error al obtener el correctivo" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const user = await getAdmin();
    if (!user) {
      return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
    }
    const { id } = await params;
    const numId = parseId(id);
    if (numId === null) {
      return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    }

    await ensureSchema();

    // Fila anterior: sirve para dejar en el historial qué cambió y para
    // seguir aceptando valores antiguos que ya no están en las listas.
    const antes = await sql`SELECT * FROM correctivos WHERE id = ${numId} AND eliminado_en IS NULL`;
    if (antes.length === 0) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }

    const validado = validarCorrectivo(
      await req.json().catch(() => null),
      antes[0] as Record<string, unknown>
    );
    if (!validado.ok) {
      return NextResponse.json({ error: validado.error }, { status: 400 });
    }
    const d = validado.datos;

    const rows = await sql`
      UPDATE correctivos SET
        refer = ${d.refer},
        ticket = ${d.ticket},
        f_reg = COALESCE(${d.f_reg}::date, f_reg),
        descripcion = ${d.descripcion},
        lugar = ${d.lugar},
        estado_desde = CASE
          WHEN estado IS DISTINCT FROM ${d.estado} THEN now()
          ELSE estado_desde
        END,
        estado = ${d.estado},
        proveedor = ${d.proveedor},
        monto = ${d.monto},
        f_coti = ${d.f_coti},
        f_oc = ${d.f_oc},
        f_inicio = ${d.f_inicio},
        f_fin = ${d.f_fin},
        cuenta = ${d.cuenta},
        tipo_trab = ${d.tipo_trab},
        sub_tipo_trab = ${d.sub_tipo_trab},
        n_oc = ${d.n_oc},
        area = ${d.area},
        updated_at = now()
      WHERE id = ${numId} AND eliminado_en IS NULL
      RETURNING *
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }

    const cambios = diferencias(antes[0] as Record<string, unknown>, {
      ...d,
      f_reg: d.f_reg || antes[0].f_reg,
    });
    if (cambios.length > 0) {
      await registrar(numId, user.username, cambios.join(" · "));
    }

    return NextResponse.json({ data: normalizeCorrectivo(rows[0] as Record<string, unknown>) });
  } catch (err) {
    if (esViolacionUnica(err)) {
      return NextResponse.json(
        { error: "Ya existe otro ticket con ese N° Refer." },
        { status: 409 }
      );
    }
    console.error(err);
    return NextResponse.json(
      { error: "Error al actualizar el correctivo" },
      { status: 500 }
    );
  }
}

/** Borrado lógico: el ticket se oculta, pero conserva archivos e historial. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await getAdmin();
    if (!user) {
      return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
    }
    const { id } = await params;
    const numId = parseId(id);
    if (numId === null) {
      return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    }

    const rows = await sql`
      UPDATE correctivos
      SET eliminado_en = now(), eliminado_por = ${user.username}, updated_at = now()
      WHERE id = ${numId} AND eliminado_en IS NULL
      RETURNING id
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    await registrar(numId, user.username, "Ticket eliminado");
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Error al eliminar el correctivo" },
      { status: 500 }
    );
  }
}
