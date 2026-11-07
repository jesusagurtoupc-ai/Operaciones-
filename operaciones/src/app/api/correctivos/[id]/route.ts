import { exigirSesion, exigirAdmin } from "@/lib/server/utils";
import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { diferencias } from "@/lib/server/utils";
import { violacionUnica, mensajeDuplicado, ocEnUso, claveOc } from "@/lib/server/utils";
import { normalizeCorrectivo, toDateOnly } from "@/lib/shared";
import {
  leerJson, validarCorrectivo, incoherenciasFechas,
  MSG_FINALIZADO_SIN_FIN, MSG_JSON_INVALIDO,
} from "@/lib/server/utils";


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
    const antes = await sql`SELECT * FROM correctivos WHERE id = ${numId} AND eliminado_en IS NULL`;
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

    // Una OC no puede estar en dos correctivos. Solo se comprueba si el usuario CAMBIA la OC: un
    // ticket histórico que ya comparte OC con otro sigue siendo editable en sus demás campos.
    if (claveOc(d.n_oc) !== claveOc(previo.n_oc)) {
      const msgOc = await ocEnUso(d.n_oc, numId);
      if (msgOc) {
        return NextResponse.json({ error: msgOc }, { status: 409 });
      }
    }

    // Si la petición no trae "refer" (cliente que manda solo algunos campos) se conserva el
    // actual; antes se borraba. Mandar refer vacío o null sí lo deja sin Ref a propósito.
    const refer = body.refer === undefined ? (previo.refer as number | null) : d.refer;

    // Igual que "refer": si la petición no trae estos campos (cliente que manda solo algunos) se
    // conservan los actuales en vez de borrarlos.
    const ruc_proveedor = body.ruc_proveedor === undefined ? (previo.ruc_proveedor as string | null) : d.ruc_proveedor;
    const f_entrega = body.f_entrega === undefined ? toDateOnly(previo.f_entrega) : d.f_entrega;
    const contrato = body.contrato === undefined ? (previo.contrato as string | null) : d.contrato;

    // Qué cambió (para el historial): solo depende de la fila anterior y de lo recibido.
    const cambios = diferencias(previo, {
      ...d,
      ruc_proveedor,
      f_entrega,
      contrato,
      f_reg: d.f_reg || previo.f_reg,
    });

    // Guardar y anotar el historial en UNA sola instrucción: una ida y vuelta menos a la base.
    const rows = await sql`
      WITH act AS (
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
        ruc_proveedor = ${ruc_proveedor},
        f_entrega = ${f_entrega}::date,
        contrato = ${contrato},
        updated_at = now()
      WHERE id = ${numId} AND eliminado_en IS NULL
      RETURNING *
      ),
      hist AS (
        INSERT INTO historial (correctivo_id, usuario, detalle)
        SELECT id, ${acceso.user.username}::text, ${cambios.join(" · ").slice(0, 1000)}::text
        FROM act
        WHERE ${cambios.length > 0}::boolean
        RETURNING id
      )
      SELECT * FROM act
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }

    return NextResponse.json({ data: normalizeCorrectivo(rows[0] as Record<string, unknown>) });
  } catch (err) {
    const dup = violacionUnica(err);
    if (dup) {
      return NextResponse.json(
        { error: mensajeDuplicado(dup) },
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

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const acceso = await exigirAdmin();
    if (acceso.error) return acceso.error;
    const { id } = await params;
    const numId = parseId(id);
    if (numId === null) {
      return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    }

    // ?definitivo=1 borra de verdad (con sus archivos e historial), pero SOLO un correctivo que ya
    // esté en la papelera: nadie puede eliminar para siempre un ticket activo de un solo paso.
    if (new URL(req.url).searchParams.get("definitivo") === "1") {
      const borrados = await sql`
        DELETE FROM correctivos WHERE id = ${numId} AND eliminado_en IS NOT NULL RETURNING id
      `;
      if (borrados.length === 0) {
        return NextResponse.json(
          { error: "Solo se puede eliminar definitivamente un correctivo que esté en la papelera" },
          { status: 409 }
        );
      }
      return NextResponse.json({ ok: true });
    }

    // Eliminar = enviar a la papelera (se puede restaurar). Los archivos y el historial se conservan.
    const rows = await sql`
      WITH baja AS (
        UPDATE correctivos
        SET eliminado_en = now(), eliminado_por = ${acceso.user.username}, updated_at = now()
        WHERE id = ${numId} AND eliminado_en IS NULL
        RETURNING id
      ),
      hist AS (
        INSERT INTO historial (correctivo_id, usuario, detalle)
        SELECT id, ${acceso.user.username}::text, 'Ticket enviado a la papelera' FROM baja
        RETURNING id
      )
      SELECT id FROM baja
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
