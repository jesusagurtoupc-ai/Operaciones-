import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { exigirAdmin, diferencias, claveOc } from "@/lib/server/utils";
import { leerPdfDeOC, valoresDeOC } from "@/lib/server/leerOC";
import { MAX_ARCHIVOS_POR_TICKET, MAX_BYTES, TIPOS_PERMITIDOS, extensionDe } from "@/lib/shared";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// Datos del ticket que una OC puede actualizar.
const CAMPOS = ["f_oc", "proveedor", "ruc_proveedor", "monto", "contrato", "f_entrega", "descripcion"] as const;
type Campo = (typeof CAMPOS)[number];

/**
 * Actualiza un ticket YA EXISTENTE con una carga nueva de su misma OC (p. ej. una OC reemitida con
 * otro monto), en vez de crear un ticket repetido.
 *
 * Body (multipart):
 *  - file            = PDF de la OC (debe ser la OC del ticket: mismo N°).
 *  - campo           = (repetido) qué datos actualizar: f_oc, proveedor, ruc_proveedor, monto, contrato,
 *                      f_entrega, descripcion. Los valores se leen aquí del PDF, nunca del navegador.
 *  - reemplazar_pdf  = "1" para guardar este PDF como el documento de OC del ticket (el anterior se borra).
 *  - base / fecha_ok = igual que al crear (total o subtotal; confirmación de fechas ambiguas).
 *
 * Solo se pisan los datos marcados que el PDF trae; lo que no trae queda como estaba.
 * Todo (datos, PDF e historial) se guarda en UNA instrucción: o se hace completo o nada.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const acceso = await exigirAdmin();
    if (acceso.error) return acceso.error;
    const { id } = await params;
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    const numId = Number(id);

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Elige el PDF de la orden de compra" }, { status: 400 });
    }
    if (file.size === 0) return NextResponse.json({ error: "El archivo está vacío" }, { status: 400 });
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "El archivo supera el máximo de 4 MB" }, { status: 413 });
    }
    let nombre = file.name.replace(/[\\/\r\n]/g, "_").trim().slice(0, 190) || "oc";
    if (extensionDe(nombre) !== "pdf") nombre += ".pdf";
    const buf = Buffer.from(await file.arrayBuffer());
    const oc = leerPdfDeOC(buf, nombre);
    if (!oc.ok) return NextResponse.json({ error: oc.error }, { status: oc.noEsPdf ? 400 : 422 });

    const base = form?.get("base") === "subtotal" ? "subtotal" : "total";
    const v = valoresDeOC(oc.datos, { base, fechaOk: form?.get("fecha_ok") === "1" });
    if (!v.n_oc) {
      return NextResponse.json({ error: "No se pudo leer el N° de la orden de compra en este PDF" }, { status: 422 });
    }

    await ensureSchema();
    const filas = await sql`
      SELECT c.*, (SELECT COUNT(*)::int FROM archivos a WHERE a.correctivo_id = c.id) AS n_archivos
      FROM correctivos c
      WHERE c.id = ${numId} AND c.eliminado_en IS NULL
    `;
    if (filas.length === 0) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    const previo = filas[0] as Record<string, unknown> & { n_archivos: number };

    // Solo se actualiza el ticket que tiene ESA OC: evita pisar otro ticket por un PDF equivocado.
    if (claveOc(v.n_oc) !== claveOc(previo.n_oc)) {
      return NextResponse.json(
        { error: `Este PDF es de la OC ${v.n_oc}, pero el ticket tiene la OC ${previo.n_oc ?? "(sin OC)"}` },
        { status: 409 }
      );
    }

    // Qué se actualiza: lo marcado Y que el PDF trae (si no trae un dato, el actual se conserva).
    const nuevos: Record<Campo, string | number | null> = {
      f_oc: v.f_oc,
      proveedor: v.proveedor,
      ruc_proveedor: v.ruc_proveedor,
      monto: v.monto,
      contrato: v.contrato,
      f_entrega: v.f_entrega,
      descripcion: v.descripcionLeida,
    };
    const pedidos = new Set(form?.getAll("campo").map(String) ?? []);
    const aplica = (c: Campo) => pedidos.has(c) && nuevos[c] !== null;
    const aplicados = CAMPOS.filter(aplica);
    const reemplazar = form?.get("reemplazar_pdf") === "1";
    if (aplicados.length === 0 && !reemplazar) {
      return NextResponse.json(
        { error: "No hay nada para actualizar: marca datos que el PDF traiga o el reemplazo del PDF" },
        { status: 400 }
      );
    }

    // PDF anterior de la línea OC (se reemplaza), si lo hay.
    const urlAnterior = (previo.documentos as { oc?: { url?: string } } | null)?.oc?.url ?? "";
    const mAnt = /^\/api\/correctivos\/\d+\/archivos\/(\d+)$/.exec(urlAnterior);
    const idAnterior = mAnt ? Number(mAnt[1]) : null;
    if (reemplazar && idAnterior === null && previo.n_archivos >= MAX_ARCHIVOS_POR_TICKET) {
      return NextResponse.json(
        { error: `El ticket ya tiene el máximo de ${MAX_ARCHIVOS_POR_TICKET} archivos` },
        { status: 400 }
      );
    }

    // Historial: qué cambió realmente.
    const despues: Record<string, unknown> = {};
    for (const c of aplicados) despues[c] = nuevos[c];
    const cambios = diferencias(previo, despues);
    const detalle = (
      `OC ${v.n_oc} cargada de nuevo` +
      (cambios.length > 0 ? `: ${cambios.join(" · ")}` : "") +
      (reemplazar ? `${cambios.length > 0 ? " · " : ": "}PDF de la OC reemplazado` : "")
    ).slice(0, 1000);
    const hayHistorial = cambios.length > 0 || reemplazar;

    const usuario = acceso.user.username;
    const b64 = buf.toString("base64");

    const rows = await sql`
      WITH ids AS (
        SELECT nextval(pg_get_serial_sequence('archivos', 'id'))::int AS aid
      ),
      nuevo AS (
        INSERT INTO archivos (id, correctivo_id, nombre, tipo, tamano, data, subido_por)
        SELECT ids.aid, ${numId}::int, ${nombre}::text, ${TIPOS_PERMITIDOS.pdf.mime}::text, ${file.size}::int,
               decode(${b64}::text, 'base64'), ${usuario}::text
        FROM ids
        WHERE ${reemplazar}::boolean
        RETURNING id
      ),
      viejo AS (
        DELETE FROM archivos
        WHERE ${reemplazar}::boolean AND correctivo_id = ${numId}::int AND id = ${idAnterior}::int
        RETURNING id
      ),
      act AS (
        UPDATE correctivos SET
          f_oc = CASE WHEN ${aplica("f_oc")}::boolean THEN ${nuevos.f_oc}::date ELSE f_oc END,
          proveedor = CASE WHEN ${aplica("proveedor")}::boolean THEN ${nuevos.proveedor}::text ELSE proveedor END,
          ruc_proveedor = CASE WHEN ${aplica("ruc_proveedor")}::boolean THEN ${nuevos.ruc_proveedor}::text ELSE ruc_proveedor END,
          monto = CASE WHEN ${aplica("monto")}::boolean THEN ${nuevos.monto}::numeric ELSE monto END,
          contrato = CASE WHEN ${aplica("contrato")}::boolean THEN ${nuevos.contrato}::text ELSE contrato END,
          f_entrega = CASE WHEN ${aplica("f_entrega")}::boolean THEN ${nuevos.f_entrega}::date ELSE f_entrega END,
          descripcion = CASE WHEN ${aplica("descripcion")}::boolean THEN ${nuevos.descripcion}::text ELSE descripcion END,
          documentos = CASE WHEN ${reemplazar}::boolean
            THEN jsonb_set(COALESCE(documentos, '{}'::jsonb), '{oc}', jsonb_build_object(
                   'numero', ${v.n_oc}::text,
                   'estado', 'Listo',
                   'url', '/api/correctivos/' || ${numId}::text || '/archivos/' || (SELECT aid FROM ids)::text))
            ELSE documentos END,
          updated_at = now()
        WHERE id = ${numId} AND eliminado_en IS NULL
        RETURNING id, refer
      ),
      hist AS (
        INSERT INTO historial (correctivo_id, usuario, detalle)
        SELECT id, ${usuario}::text, ${detalle}::text FROM act WHERE ${hayHistorial}::boolean
        RETURNING id
      )
      SELECT id, refer FROM act
    `;
    if (rows.length === 0) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

    return NextResponse.json({
      data: { id: numId, refer: (rows[0] as { refer: number | null }).refer },
      aplicados,
      pdf: reemplazar,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo actualizar el ticket con la OC" }, { status: 500 });
  }
}
