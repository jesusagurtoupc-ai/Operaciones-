import { NextRequest, NextResponse } from "next/server";
import { resolverProveedor } from "@/lib/server/proveedores";
import { sql, ensureSchema } from "@/lib/server/db";
import { guardarEnBlob, borrarDeBlob } from "@/lib/server/almacen";
import { exigirAdmin, ocEnUso, violacionUnica, mensajeDuplicado, MSG_OC_REPETIDO } from "@/lib/server/utils";
import { leerPdfDeOC, valoresDeOC } from "@/lib/server/leerOC";
import { sugerirLugar, sugerirSubTipo, sugerirTipo } from "@/lib/server/sugerencias";
import { MAX_BYTES, TIPOS_PERMITIDOS, extensionDe } from "@/lib/shared";

// Usa zlib de Node: no puede correr en el runtime "edge".
export const runtime = "nodejs";

// Valores iniciales de los campos que la OC no trae (los mismos que tenía el formulario manual).
// El resto (ticket, lugar, tipo de trabajo, fechas del proceso...) se completa después en el ticket.
const ESTADO_INICIAL = "Por Ejecutar"; // el ticket nace con la OC cargada
const AREA_INICIAL = "Mantenimiento";

/**
 * Crea un ticket a partir del PDF de una orden de compra (la otra forma es desde su cotización:
 * ver /api/correctivos/desde-cotizacion).
 *
 * Body (multipart):
 *  - file     = PDF de la OC (se guarda como adjunto del ticket, en la línea "OC").
 *  - base     = "total" (con IGV, por defecto) o "subtotal" (sin IGV): cuál es el monto del ticket.
 *  - fecha_ok = "1" si la persona confirmó la fecha de la OC cuando el PDF la deja ambigua
 *               (mes/día o día/mes). Sin confirmar, el ticket se crea sin fecha de OC.
 *
 * Los datos se leen aquí, en el servidor, del propio PDF: nunca se aceptan datos sueltos del cliente.
 * El ticket y su archivo se graban en UNA sola instrucción, así que o se crean los dos o ninguno.
 */
export async function POST(req: NextRequest) {
  try {
    const acceso = await exigirAdmin();
    if (acceso.error) return acceso.error;

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Elige el PDF de la orden de compra" }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "El archivo está vacío" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "El archivo supera el máximo de 4 MB" }, { status: 413 });
    }
    // Se decide por el CONTENIDO, no por el nombre: un PDF sin extensión (o con otra) también sirve.
    // Si el nombre no termina en .pdf se le agrega, para que el visor lo abra como PDF.
    let nombre = file.name.replace(/[\\/\r\n]/g, "_").trim().slice(0, 190) || "oc";
    if (extensionDe(nombre) !== "pdf") nombre += ".pdf";
    const buf = Buffer.from(await file.arrayBuffer());
    const oc = leerPdfDeOC(buf, nombre);
    if (!oc.ok) return NextResponse.json({ error: oc.error }, { status: oc.noEsPdf ? 400 : 422 });
    const d = oc.datos;

    // Monto y fechas con las reglas compartidas (ver valoresDeOC).
    const base = form?.get("base") === "subtotal" ? "subtotal" : "total";
    const v = valoresDeOC(d, { base, fechaOk: form?.get("fecha_ok") === "1" });
    const { n_oc, proveedor: provLeido, ruc_proveedor: rucLeido, contrato, monto, enSoles, fechaConfirmada, f_oc, f_entrega } = v;
    const descripcion = v.descripcion ?? "";
    if (!n_oc) {
      return NextResponse.json(
        { error: "No se pudo leer el N° de la orden de compra en este PDF, y sin él no se puede crear el ticket" },
        { status: 422 }
      );
    }

    await ensureSchema();
    // El proveedor pasa a su nombre oficial del registro (un solo nombre por empresa).
    const { nombre: proveedor, ruc: ruc_proveedor } = await resolverProveedor(provLeido, rucLeido);

    const usuario = acceso.user.username;

    // Sugerencias automáticas (solo si hay coincidencia clara): lugar según dónde se entrega y
    // sub tipo de trabajo según la descripción.
    const lugar = sugerirLugar(d.entregar_en) ?? sugerirLugar(descripcion);
    const tipoTrab = sugerirTipo(descripcion);
    const subTipo = sugerirSubTipo(descripcion);

    // Texto del historial (se anota en la misma instrucción que crea el ticket).
    const notas = [`Ticket creado desde la OC ${n_oc}`];
    if (lugar || tipoTrab || subTipo) {
      notas.push(`sugerido automáticamente: ${[lugar && `lugar ${lugar}`, tipoTrab && `tipo ${tipoTrab}`, subTipo && `sub tipo ${subTipo}`].filter(Boolean).join(", ")}`);
    }
    if (d.fecha_ambigua && !fechaConfirmada) notas.push("fechas de la OC sin confirmar: no se guardaron");
    if (!enSoles) notas.push(`la OC está en ${d.moneda}: monto sin guardar`);
    const detalleHistorial = notas.join(" · ").slice(0, 1000);

    // Una sola instrucción: comprueba que la OC no esté ya en otro ticket, reserva los ids, crea el
    // ticket (con la línea de OC apuntando al archivo), guarda el PDF como adjunto y anota el
    // historial. Si algo falla se deshace todo; si la OC ya estaba registrada no se inserta nada
    // (devuelve 0 filas). Cada parámetro lleva su tipo porque en INSERT ... SELECT Postgres no lo
    // puede deducir.
    // (justo antes de guardar: si algo falla antes, no queda nada suelto en Blob)
    // Con Vercel Blob el PDF va allí y la base solo guarda dónde está (ver almacen.ts).
    const enBlob = await guardarEnBlob(nombre, TIPOS_PERMITIDOS.pdf.mime, buf);
    const b64 = enBlob ? null : buf.toString("base64");
    const insertar = () => sql`
      WITH ids AS (
        SELECT nextval(pg_get_serial_sequence('correctivos', 'id'))::int AS cid,
               nextval(pg_get_serial_sequence('archivos', 'id'))::int AS aid
      ),
      nuevo AS (
        INSERT INTO correctivos
          (id, refer, ticket, f_reg, descripcion, lugar, estado, proveedor, monto,
           f_oc, n_oc, area, tipo_trab, sub_tipo_trab, ruc_proveedor, f_entrega, contrato, documentos, estado_desde)
        SELECT ids.cid,
               GREATEST((SELECT COALESCE(MAX(refer), 0) FROM correctivos),
                        COALESCE((SELECT valor FROM refer_tope WHERE id = 1), 0)) + 1,
               NULL,
               (now() AT TIME ZONE 'America/Lima')::date,
               ${descripcion}::text, ${lugar}::text, ${ESTADO_INICIAL}::text, ${proveedor}::text, ${monto}::numeric,
               ${f_oc}::date, ${n_oc}::text, ${AREA_INICIAL}::text, ${tipoTrab}::text, ${subTipo}::text,
               ${ruc_proveedor}::text, ${f_entrega}::date, ${contrato}::text,
               jsonb_build_object('oc', jsonb_build_object(
                 'numero', ${n_oc}::text,
                 'estado', 'Listo',
                 'url', '/api/correctivos/' || ids.cid::text || '/archivos/' || ids.aid::text
               )),
               now()
        FROM ids
        WHERE NOT EXISTS (
          SELECT 1 FROM correctivos x
          WHERE x.eliminado_en IS NULL
            AND x.n_oc IS NOT NULL AND BTRIM(x.n_oc) <> ''
            AND LOWER(BTRIM(x.n_oc)) = LOWER(BTRIM(${n_oc}::text))
        )
        RETURNING id, refer
      ),
      adjunto AS (
        INSERT INTO archivos (id, correctivo_id, nombre, tipo, tamano, data, subido_por, blob_path, blob_url)
        SELECT ids.aid, ids.cid, ${nombre}::text, ${TIPOS_PERMITIDOS.pdf.mime}::text, ${file.size}::int,
               decode(${b64}::text, 'base64'), ${usuario}::text, ${enBlob?.path ?? null}::text, ${enBlob?.url ?? null}::text
        FROM ids
        JOIN nuevo ON nuevo.id = ids.cid
        RETURNING id
      ),
      hist AS (
        INSERT INTO historial (correctivo_id, usuario, detalle)
        SELECT nuevo.id, ${usuario}::text, ${detalleHistorial}::text FROM nuevo
        RETURNING id
      )
      SELECT nuevo.id, nuevo.refer FROM nuevo
    `;

    // Si dos personas crean a la vez, ambas calculan el mismo "máximo + 1"; el índice único deja
    // pasar a una y la otra reintenta ya con el Ref nuevo a la vista.
    let rows: Record<string, unknown>[] = [];
    for (let intento = 0; ; intento++) {
      try {
        rows = (await insertar()) as Record<string, unknown>[];
        break;
      } catch (e) {
        if (violacionUnica(e) === "refer" && intento < 8) continue;
        await borrarDeBlob([enBlob?.url]); // no se creó el ticket: el archivo no debe quedar en Blob
        throw e;
      }
    }
    // 0 filas = esa OC ya está registrada en otro ticket: se busca en cuál para decírselo a la persona.
    if (rows.length === 0) {
      await borrarDeBlob([enBlob?.url]);
      const enUso = await ocEnUso(n_oc);
      return NextResponse.json({ error: enUso ?? MSG_OC_REPETIDO }, { status: 409 });
    }
    const creado = rows[0] as { id: number; refer: number | null };

    return NextResponse.json({ data: { id: creado.id, refer: creado.refer } }, { status: 201 });
  } catch (err) {
    const dup = violacionUnica(err);
    if (dup) {
      // Dos altas simultáneas con la misma OC: el índice único dejó pasar solo a una.
      return NextResponse.json({ error: mensajeDuplicado(dup) }, { status: 409 });
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo crear el ticket desde la OC" }, { status: 500 });
  }
}
