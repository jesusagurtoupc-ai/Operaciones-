import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { exigirAdmin, registrar, ocEnUso, violacionUnica, mensajeDuplicado } from "@/lib/server/utils";
import { extraerPaginasPdf } from "@/lib/server/pdfTexto";
import { parsearOC } from "@/lib/server/parsearOC";
import { MAX_BYTES, TIPOS_PERMITIDOS, extensionDe } from "@/lib/shared";

// Usa zlib de Node: no puede correr en el runtime "edge".
export const runtime = "nodejs";

// Valores iniciales de los campos que la OC no trae (los mismos que tenía el formulario manual).
// El resto (ticket, lugar, tipo de trabajo, fechas del proceso...) se completa después en el ticket.
const ESTADO_INICIAL = "cotizar";
const AREA_INICIAL = "Mantenimiento";

/**
 * ÚNICA forma de crear un ticket: a partir del PDF de una orden de compra.
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
    const nombre = file.name.replace(/[\\/\r\n]/g, "_").slice(0, 200) || "oc.pdf";
    const buf = Buffer.from(await file.arrayBuffer());
    if (extensionDe(nombre) !== "pdf" || buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
      return NextResponse.json({ error: "La orden de compra debe ser un archivo PDF" }, { status: 400 });
    }

    const pdf = extraerPaginasPdf(buf);
    if (!pdf.ok) return NextResponse.json({ error: pdf.error }, { status: 422 });
    const oc = parsearOC(pdf.paginas, pdf.creado);
    if (!oc.ok) return NextResponse.json({ error: oc.error }, { status: 422 });
    const d = oc.datos;

    const n_oc = d.n_oc?.trim().slice(0, 200) || null;
    if (!n_oc) {
      return NextResponse.json(
        { error: "No se pudo leer el N° de la orden de compra en este PDF, y sin él no se puede crear el ticket" },
        { status: 422 }
      );
    }

    await ensureSchema();
    const enUso = await ocEnUso(n_oc);
    if (enUso) return NextResponse.json({ error: enUso }, { status: 409 });

    const proveedor = d.proveedor?.trim().slice(0, 200) || null;
    const descripcion =
      d.descripcion?.trim().slice(0, 2000) || `OC ${n_oc}${proveedor ? ` – ${proveedor}` : ""}`;

    // Monto: el ticket se maneja en soles. Si la OC está en otra moneda no se guarda un monto
    // equivocado: queda vacío para que se convierta a mano en el ticket.
    const base = form?.get("base") === "subtotal" ? "subtotal" : "total";
    const montoLeido = base === "subtotal" ? d.subtotal ?? d.total : d.total ?? d.subtotal;
    const enSoles = !d.moneda || d.moneda === "PEN";
    const monto =
      enSoles && montoLeido !== null && Number.isFinite(montoLeido) && montoLeido >= 0 && montoLeido < 1e10
        ? Math.round(montoLeido * 100) / 100
        : null;

    // Fecha de la OC: si el PDF la deja ambigua, solo se guarda cuando la persona la confirmó.
    const fechaConfirmada = !d.fecha_ambigua || form?.get("fecha_ok") === "1";
    const f_oc = fechaConfirmada ? d.f_oc : null;

    const usuario = acceso.user.username;
    const b64 = buf.toString("base64");

    // Una sola instrucción: reserva los ids, crea el ticket (con la línea de OC apuntando al archivo)
    // y guarda el PDF como adjunto. Si algo falla se deshace todo. Cada parámetro lleva su tipo
    // porque en INSERT ... SELECT Postgres no lo puede deducir.
    const insertar = () => sql`
      WITH ids AS (
        SELECT nextval(pg_get_serial_sequence('correctivos', 'id'))::int AS cid,
               nextval(pg_get_serial_sequence('archivos', 'id'))::int AS aid
      ),
      nuevo AS (
        INSERT INTO correctivos
          (id, refer, ticket, f_reg, descripcion, lugar, estado, proveedor, monto,
           f_oc, n_oc, area, documentos, estado_desde)
        SELECT ids.cid,
               (SELECT COALESCE(MAX(refer), 0) + 1 FROM correctivos),
               NULL,
               (now() AT TIME ZONE 'America/Lima')::date,
               ${descripcion}::text, NULL, ${ESTADO_INICIAL}::text, ${proveedor}::text, ${monto}::numeric,
               ${f_oc}::date, ${n_oc}::text, ${AREA_INICIAL}::text,
               jsonb_build_object('oc', jsonb_build_object(
                 'numero', ${n_oc}::text,
                 'estado', 'Listo',
                 'url', '/api/correctivos/' || ids.cid::text || '/archivos/' || ids.aid::text
               )),
               now()
        FROM ids
        RETURNING id, refer
      ),
      adjunto AS (
        INSERT INTO archivos (id, correctivo_id, nombre, tipo, tamano, data, subido_por)
        SELECT ids.aid, ids.cid, ${nombre}::text, ${TIPOS_PERMITIDOS.pdf.mime}::text, ${file.size}::int,
               decode(${b64}::text, 'base64'), ${usuario}::text
        FROM ids
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
        throw e;
      }
    }
    const creado = rows[0] as { id: number; refer: number | null };

    const notas = [`Ticket creado desde la OC ${n_oc}`];
    if (d.fecha_ambigua && !fechaConfirmada) notas.push("fecha de la OC sin confirmar: no se guardó");
    if (!enSoles) notas.push(`la OC está en ${d.moneda}: monto sin guardar`);
    await registrar(creado.id, usuario, notas.join(" · "));

    return NextResponse.json({ data: { id: creado.id, refer: creado.refer } }, { status: 201 });
  } catch (err) {
    const dup = violacionUnica(err);
    if (dup) {
      return NextResponse.json({ error: mensajeDuplicado(dup) }, { status: 409 });
    }
    console.error(err);
    return NextResponse.json({ error: "No se pudo crear el ticket desde la OC" }, { status: 500 });
  }
}
