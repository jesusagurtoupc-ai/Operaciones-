import { exigirSesion, exigirAdmin } from "@/lib/server/utils";
import { resolverProveedor } from "@/lib/server/proveedores";
import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { borrarDeBlob } from "@/lib/server/almacen";
import { diferencias, mismoValor, ETIQUETAS } from "@/lib/server/utils";
import { violacionUnica, mensajeDuplicado, ocEnUso, claveOc, registrar, guardarTipoCambio } from "@/lib/server/utils";
import { normalizeCorrectivo, toDateOnly, tipoCambioValido, solesDeDolares, formatoDolares, TC_MIN, TC_MAX, tieneInforme, MSG_FINALIZAR_SIN_INFORME } from "@/lib/shared";
import {
  leerJson, validarCorrectivo, incoherenciasFechas,
  MSG_FINALIZADO_SIN_FIN, MSG_JSON_INVALIDO,
} from "@/lib/server/utils";


type Params = { params: Promise<{ id: string }> };

const CAMPOS_EDITABLES = [
  "refer", "ticket", "f_reg", "descripcion", "lugar", "estado", "proveedor", "monto", "f_coti", "f_oc",
  "f_inicio", "f_fin", "cuenta", "tipo_trab", "sub_tipo_trab", "n_oc", "area", "ruc_proveedor", "f_entrega", "contrato",
] as const;

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

    const rows = await sql`SELECT * FROM correctivos WHERE id = ${numId} AND campus = ANY(${acceso.user.campusPermitidos}::text[]) AND eliminado_en IS NULL`;
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
    const antes = await sql`SELECT * FROM correctivos WHERE id = ${numId} AND campus = ANY(${acceso.user.campusPermitidos}::text[]) AND eliminado_en IS NULL`;
    if (antes.length === 0) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    const previo = antes[0] as Record<string, unknown>;
    const marcaLeida = previo.updated_at instanceof Date ? previo.updated_at.toISOString() : String(previo.updated_at ?? "");

    // Ediciones simultáneas. El formulario manda, además de sus valores, `_original`: cómo estaba el
    // ticket cuando lo abrió. Solo se guardan los campos que la persona CAMBIÓ; los demás se toman de
    // lo que hay ahora en la base (así no se deshacen los cambios que otra persona, u otra pestaña,
    // hizo mientras tanto, p. ej. el paso automático a "Finalizado" al subir el informe). Si un mismo
    // campo lo cambiaron las dos personas con valores distintos, se rechaza y se avisa.
    const original =
      body._original && typeof body._original === "object" && !Array.isArray(body._original)
        ? (body._original as Record<string, unknown>)
        : null;
    delete body._original;
    if (original) {
      const conflictos: string[] = [];
      for (const k of CAMPOS_EDITABLES) {
        if (!(k in original) || body[k] === undefined) continue;
        if (mismoValor(k, body[k], original[k])) {
          delete body[k]; // no lo tocó: se conserva el valor actual de la base
          continue;
        }
        const cambioAjeno = !mismoValor(k, previo[k], original[k]);
        if (cambioAjeno && !mismoValor(k, body[k], previo[k])) conflictos.push(ETIQUETAS[k] ?? k);
      }
      if (conflictos.length > 0) {
        return NextResponse.json(
          {
            error:
              `Otra persona cambió ${conflictos.join(", ")} mientras editabas este ticket. ` +
              "Recarga la página para ver los datos actuales y vuelve a aplicar tu cambio.",
            conflicto: conflictos,
          },
          { status: 409 }
        );
      }
    }

    // Un cliente que manda solo algunos campos no borra los demás: lo que falta se toma de lo guardado.
    for (const k of CAMPOS_EDITABLES) {
      if (body[k] !== undefined) continue;
      const p = previo[k];
      body[k] = p === null || p === undefined ? null : k === "monto" ? Number(p) : k.startsWith("f_") ? toDateOnly(p) : p;
    }

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
      f_reg: d.f_reg,
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
    // Regla del informe: sin informe no se finaliza (queda en «Por Ejecutar»).
    if (d.estado === "Finalizado" && !tieneInforme({ documentos: previo.documentos as never })) {
      return NextResponse.json({ error: MSG_FINALIZAR_SIN_INFORME }, { status: 400 });
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
    let ruc_proveedor = body.ruc_proveedor === undefined ? (previo.ruc_proveedor as string | null) : d.ruc_proveedor;
    // Si se escribió (o cambió) el proveedor a mano, pasa a su nombre oficial del registro: "msg peru"
    // queda como "MSG PERU S.A.C." si así está registrada esa empresa (un solo nombre por empresa).
    if (d.proveedor && (d.proveedor !== previo.proveedor || ruc_proveedor !== previo.ruc_proveedor)) {
      const oficial = await resolverProveedor(d.proveedor, ruc_proveedor);
      if (oficial.nombre) d.proveedor = oficial.nombre;
      if (!ruc_proveedor && oficial.ruc) ruc_proveedor = oficial.ruc;
    }
    const f_entrega = body.f_entrega === undefined ? toDateOnly(previo.f_entrega) : d.f_entrega;
    const contrato = body.contrato === undefined ? (previo.contrato as string | null) : d.contrato;

    // Moneda. En dólares se guardan el monto en US$ y el tipo de cambio, y el monto en soles se CALCULA
    // (monto_usd × tipo de cambio): así el panel, el presupuesto y los informes siguen sumando en soles.
    const numONull = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
    const monedaPrev = String(previo.moneda ?? "PEN");
    const moneda = body.moneda === undefined ? monedaPrev : body.moneda === "USD" ? "USD" : "PEN";
    let monto_usd: number | null = null;
    let tipo_cambio: number | null = null;
    if (moneda === "USD") {
      monto_usd = numONull(body.monto_usd === undefined ? previo.monto_usd : body.monto_usd);
      if (monto_usd !== null && !(Number.isFinite(monto_usd) && monto_usd >= 0 && monto_usd < 1e10)) {
        return NextResponse.json({ error: "El monto en dólares no es válido" }, { status: 400 });
      }
      if (monto_usd !== null) monto_usd = Math.round(monto_usd * 100) / 100;
      const tcCrudo = numONull(body.tipo_cambio === undefined ? previo.tipo_cambio : body.tipo_cambio);
      tipo_cambio = tcCrudo === null ? null : tipoCambioValido(tcCrudo);
      if (tcCrudo !== null && tipo_cambio === null) {
        return NextResponse.json({ error: `El tipo de cambio debe estar entre ${TC_MIN} y ${TC_MAX} soles por dólar` }, { status: 400 });
      }
      d.monto = solesDeDolares(monto_usd, tipo_cambio);
    }
    const cambiosMoneda: string[] = [];
    if (moneda !== monedaPrev) cambiosMoneda.push(`Moneda: ${monedaPrev === "USD" ? "US$" : "S/"} → ${moneda === "USD" ? "US$" : "S/"}`);
    if (moneda === "USD" && numONull(previo.monto_usd) !== monto_usd) cambiosMoneda.push(`Monto US$: ${formatoDolares(numONull(previo.monto_usd))} → ${formatoDolares(monto_usd)}`);
    if (moneda === "USD" && numONull(previo.tipo_cambio) !== tipo_cambio) cambiosMoneda.push(`Tipo de cambio: ${previo.tipo_cambio ?? "—"} → ${tipo_cambio ?? "—"}`);

    // Qué cambió (para el historial): solo depende de la fila anterior y de lo recibido.
    const cambios = [...cambiosMoneda, ...diferencias(previo, {
      ...d,
      ruc_proveedor,
      f_entrega,
      contrato,
    })];

    // Guardar y anotar el historial en UNA sola instrucción: una ida y vuelta menos a la base.
    const rows = await sql`
      WITH act AS (
      UPDATE correctivos SET
        refer = ${refer},
        ticket = ${d.ticket},
        f_reg = ${d.f_reg}::date,
        descripcion = ${d.descripcion},
        lugar = ${d.lugar},
        estado_desde = CASE
          WHEN estado IS DISTINCT FROM ${d.estado} THEN now()
          ELSE estado_desde
        END,
        estado = ${d.estado},
        proveedor = ${d.proveedor},
        monto = ${d.monto},
        moneda = ${moneda},
        monto_usd = ${monto_usd},
        tipo_cambio = ${tipo_cambio},
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
      WHERE id = ${numId} AND campus = ANY(${acceso.user.campusPermitidos}::text[]) AND eliminado_en IS NULL
        -- Nadie lo cambió entre la lectura de arriba y este guardado (si no, se pisarían).
        -- (a milisegundos: el driver entrega la fecha con esa precisión y Postgres guarda microsegundos)
        AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${marcaLeida}::timestamptz)
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
      return NextResponse.json(
        {
          error: "Otra persona (o un proceso automático) guardó este ticket justo ahora. Recarga la página y vuelve a aplicar tu cambio.",
          conflicto: [],
        },
        { status: 409 }
      );
    }

    // El tipo de cambio escrito a mano pasa a ser la referencia para las próximas OC en dólares sin tipo de cambio.
    if (moneda === "USD" && tipo_cambio !== null && numONull(previo.tipo_cambio) !== tipo_cambio) {
      await guardarTipoCambio(tipo_cambio, `ticket #${refer ?? numId}`, acceso.user.username);
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
      // Los adjuntos que estén en Vercel Blob se borran también de allí (los de la base caen en cascada).
      // Una sola consulta: borra y, de la misma foto, dice qué adjuntos estaban en Blob.
      await ensureSchema();
      const borrados = (await sql`
        WITH b AS (
          DELETE FROM correctivos WHERE id = ${numId} AND campus = ANY(${acceso.user.campusPermitidos}::text[]) AND eliminado_en IS NOT NULL RETURNING id, refer, campus
        ),
        tope AS (
          -- Recuerda el N° Ref más alto que se borró: así nunca se vuelve a dar a un ticket nuevo
          -- (los PDFs y nombres de carpeta con "Ref N" seguirían apuntando al ticket borrado).
          INSERT INTO refer_tope (id, campus, valor)
          SELECT 1, campus, MAX(refer) FROM b WHERE refer IS NOT NULL GROUP BY campus
          ON CONFLICT (campus) DO UPDATE SET valor = GREATEST(refer_tope.valor, EXCLUDED.valor)
          RETURNING 1
        )
        SELECT b.id, a.blob_url FROM b LEFT JOIN archivos a ON a.correctivo_id = b.id AND a.blob_url IS NOT NULL
      `) as { id: number; blob_url: string | null }[];
      await borrarDeBlob(borrados.map((x) => x.blob_url));
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
        WHERE id = ${numId} AND campus = ANY(${acceso.user.campusPermitidos}::text[]) AND eliminado_en IS NULL
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

/** Saca un correctivo de la papelera y lo deja activo otra vez. Solo administradores. */
export async function POST(_req: NextRequest, { params }: Params) {
  // POST /api/correctivos/[id] = restaurar desde la papelera (antes /api/correctivos/[id]/restaurar).
  try {
    const acceso = await exigirAdmin();
    if (acceso.error) return acceso.error;
    const { id } = await params;
    if (!/^\d{1,9}$/.test(id)) {
      return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    }
    const numId = Number(id);
    await ensureSchema();

    // Mientras estuvo en la papelera, otro correctivo pudo registrar la misma OC.
    const enPapelera = await sql`
      SELECT n_oc FROM correctivos WHERE id = ${numId} AND campus = ANY(${acceso.user.campusPermitidos}::text[]) AND eliminado_en IS NOT NULL
    `;
    if (enPapelera.length === 0) {
      return NextResponse.json({ error: "No está en la papelera" }, { status: 404 });
    }
    const msgOc = await ocEnUso((enPapelera[0] as { n_oc: string | null }).n_oc, numId);
    if (msgOc) {
      return NextResponse.json({ error: `No se puede restaurar: ${msgOc.charAt(0).toLowerCase()}${msgOc.slice(1)}` }, { status: 409 });
    }

    const rows = await sql`
      UPDATE correctivos
      SET eliminado_en = NULL, eliminado_por = NULL, updated_at = now()
      WHERE id = ${numId} AND campus = ANY(${acceso.user.campusPermitidos}::text[]) AND eliminado_en IS NOT NULL
      RETURNING id
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "No está en la papelera" }, { status: 404 });
    }
    await registrar(numId, acceso.user.username, "Ticket restaurado de la papelera");
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Mientras estuvo en la papelera, otro correctivo pudo tomar su Ref o su ticket.
    const dup = violacionUnica(err);
    if (dup) {
      return NextResponse.json(
        {
          error:
            dup === "refer"
              ? "No se puede restaurar: su N° Refer. ya lo usa otro correctivo activo"
              : dup === "n_oc"
                ? "No se puede restaurar: su OC ya está registrada en otro correctivo activo"
                : "No se puede restaurar: su ticket ya lo usa otro correctivo activo",
        },
        { status: 409 }
      );
    }
    console.error(err);
    return NextResponse.json({ error: "Error al restaurar el correctivo" }, { status: 500 });
  }
}
