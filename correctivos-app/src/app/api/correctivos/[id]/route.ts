import { exigirSesion, exigirAdmin } from "@/lib/server/permisos";
import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/auth";
import { diferencias, registrar } from "@/lib/server/historial";
import { violacionUnica, MSG_REFER_REPETIDO, MSG_TICKET_REPETIDO } from "@/lib/server/errores";
import { normalizeCorrectivo, toDateOnly } from "@/lib/shared/types";
import {
  leerJson, validarCorrectivo, incoherenciasFechas,
  MSG_FINALIZADO_SIN_FIN, MSG_JSON_INVALIDO,
} from "@/lib/server/validar";


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
  try {
    const acceso = await exigirSesion();
    if (acceso.error) return acceso.error;
    const { id } = await params;
    const numId = parseId(id);
    if (numId === null) {
      return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    }

    const rows = await sql`SELECT * FROM correctivos WHERE id = ${numId}`;
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
    const acceso = await exigirAdmin();
    if (acceso.error) return acceso.error;
    const { id } = await params;
    const numId = parseId(id);
    if (numId === null) {
      return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    }

    await ensureSchema();
    const body = await leerJson(req);
    if (!body) {
      return NextResponse.json({ error: MSG_JSON_INVALIDO }, { status: 400 });
    }
    // Fila anterior: sirve para el historial y para no bloquear datos históricos (las reglas
    // solo se aplican a lo que el usuario cambia).
    const antes = await sql`SELECT * FROM correctivos WHERE id = ${numId}`;
    if (antes.length === 0) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    const previo = antes[0] as Record<string, unknown>;

    const v = validarCorrectivo(body, previo);
    if (!v.ok) {
      return NextResponse.json({ error: v.error }, { status: 400 });
    }
    const d = v.datos;

    // Coherencia de fechas: solo se rechazan los problemas NUEVOS. Hay
    // tickets históricos con fechas incoherentes; si no se tocan esas fechas,
    // editar otro campo (p. ej. el proveedor) no debe quedar bloqueado.
    const fechasPrevias = {
      f_reg: toDateOnly(previo.f_reg),
      f_inicio: toDateOnly(previo.f_inicio),
      f_fin: toDateOnly(previo.f_fin),
    };
    const yaExistian = new Set(incoherenciasFechas(fechasPrevias));
    const nuevas = incoherenciasFechas({
      f_reg: d.f_reg ?? fechasPrevias.f_reg,
      f_inicio: d.f_inicio,
      f_fin: d.f_fin,
    }).filter((m) => !yaExistian.has(m));
    if (nuevas.length > 0) {
      return NextResponse.json({ error: nuevas[0] }, { status: 400 });
    }
    // Igual con "Finalizado": se exige la fecha de fin al pasar a ese estado,
    // pero un ticket histórico ya finalizado sin fecha sigue siendo editable.
    if (d.estado === "Finalizado" && !d.f_fin && previo.estado !== "Finalizado") {
      return NextResponse.json({ error: MSG_FINALIZADO_SIN_FIN }, { status: 400 });
    }

    // Si la petición no trae "refer" (cliente que manda solo algunos campos) se conserva el
    // actual; antes se borraba. Mandar refer vacío o null sí lo deja sin Ref a propósito.
    const refer = body.refer === undefined ? (previo.refer as number | null) : d.refer;

    const rows = await sql`
      UPDATE correctivos SET
        refer = ${refer},
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
      WHERE id = ${numId}
      RETURNING *
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }

    const cambios = diferencias(previo, {
      ...d,
      f_reg: d.f_reg || previo.f_reg,
    });
    if (cambios.length > 0) {
      const user = await getCurrentUser();
      await registrar(numId, user?.username, cambios.join(" · "));
    }

    return NextResponse.json({ data: normalizeCorrectivo(rows[0] as Record<string, unknown>) });
  } catch (err) {
    const dup = violacionUnica(err);
    if (dup) {
      return NextResponse.json(
        { error: dup === "refer" ? MSG_REFER_REPETIDO : MSG_TICKET_REPETIDO },
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

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const acceso = await exigirAdmin();
    if (acceso.error) return acceso.error;
    const { id } = await params;
    const numId = parseId(id);
    if (numId === null) {
      return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    }

    const rows = await sql`
      DELETE FROM correctivos WHERE id = ${numId} RETURNING id
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Error al eliminar el correctivo" },
      { status: 500 }
    );
  }
}
