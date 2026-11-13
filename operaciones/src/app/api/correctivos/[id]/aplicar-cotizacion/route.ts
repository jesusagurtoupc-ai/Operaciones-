import { createHash } from "node:crypto";
import { resolverProveedor } from "@/lib/server/proveedores";
import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { bytesDeArchivo } from "@/lib/server/almacen";
import { exigirAdmin } from "@/lib/server/utils";
import { leerPdfDeCotizacion } from "@/lib/server/leerCotizacion";
import { MAX_BYTES, formatoFecha, formatoSoles, toDateOnly } from "@/lib/shared";
import { claveCotizacion } from "@/components/lista/emparejarCarga";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const vacio = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

/**
 * Lee el PDF de la línea "Cotización" del ticket y COMPLETA solo los datos que el ticket aún no
 * tiene (proveedor, RUC, fecha de cotización y monto). Nunca pisa un dato que ya está escrito.
 * Si el número de la línea sigue siendo el nombre del archivo, lo cambia por el N° de cotización leído.
 *
 * Normalmente el PDF se lee de la base de datos. Si quien llama lo envía también (multipart, campo "file":
 * justo después de subirlo ya lo tiene en mano), se usa ese para no volver a traer varios MB de la base,
 * PERO solo si es idéntico al guardado: la base calcula la huella SHA-256 del archivo guardado y se compara
 * con la del enviado. Si no coinciden, se lee el guardado. Así los datos siempre salen del PDF del ticket.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const acceso = await exigirAdmin();
    if (acceso.error) return acceso.error;
    const { id } = await params;
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    const numId = Number(id);

    await ensureSchema();
    const filas = await sql`
      SELECT proveedor, ruc_proveedor, f_coti, monto, documentos, condiciones
      FROM correctivos WHERE id = ${numId} AND eliminado_en IS NULL
    `;
    if (filas.length === 0) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    const t = filas[0] as Record<string, unknown>;
    const linea = (t.documentos as { cotizacion?: { url?: string; numero?: string } } | null)?.cotizacion;

    const m = /^\/api\/correctivos\/(\d+)\/archivos\/(\d+)$/.exec(linea?.url ?? "");
    if (!m || Number(m[1]) !== numId) {
      return NextResponse.json(
        { error: "Solo se puede leer una cotización subida como archivo PDF, no un enlace" },
        { status: 400 }
      );
    }
    const idArchivo = Number(m[2]);
    let buf: Buffer | null = null;
    let nombre = "";
    const enviado = (req.headers.get("content-type") ?? "").includes("multipart/form-data")
      ? (await req.formData().catch(() => null))?.get("file")
      : null;
    // El archivo guardado (en la base o en Vercel Blob). Si el navegador mandó su copia y es IDÉNTICA
    // (misma huella SHA-256), se usa esa; si no, la guardada: nunca se lee un PDF distinto al del ticket.
    // Para no traer el archivo de la base si el navegador ya lo mandó: primero solo su huella.
    if (enviado instanceof File && enviado.size > 0 && enviado.size <= MAX_BYTES) {
      const local = Buffer.from(await enviado.arrayBuffer());
      const huella = (await sql`
        SELECT nombre, CASE WHEN blob_path IS NULL THEN encode(sha256(data), 'hex') END AS h
        FROM archivos WHERE id = ${idArchivo} AND correctivo_id = ${numId}
      `) as { nombre: string; h: string | null }[];
      if (huella.length === 0) return NextResponse.json({ error: "No se encontró el archivo" }, { status: 404 });
      if (huella[0].h && createHash("sha256").update(local).digest("hex") === huella[0].h) {
        buf = local;
        nombre = huella[0].nombre;
      }
    }
    if (!buf) {
      const guardado = await bytesDeArchivo(idArchivo, numId);
      if (!guardado) return NextResponse.json({ error: "No se encontró el archivo" }, { status: 404 });
      nombre = guardado.nombre;
      buf = guardado.buf;
    }

    const r = leerPdfDeCotizacion(buf);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.noEsPdf ? 400 : 422 });
    const d = r.datos;

    // Solo se completa lo que está vacío.
    // El proveedor del documento, con su nombre oficial del registro (un solo nombre por empresa).
    const oficial =
      (vacio(t.proveedor) && d.proveedor) || (vacio(t.ruc_proveedor) && d.ruc_proveedor)
        ? await resolverProveedor(d.proveedor ? d.proveedor.slice(0, 200) : null, d.ruc_proveedor)
        : { nombre: null, ruc: null };
    const proveedor = vacio(t.proveedor) && oficial.nombre ? oficial.nombre : null;
    const ruc = vacio(t.ruc_proveedor) && oficial.ruc ? oficial.ruc : null;
    const fCoti = vacio(t.f_coti) && d.fecha && !d.fecha_ambigua ? d.fecha : null;
    const monto =
      (t.monto === null || t.monto === undefined) && d.moneda !== "USD" && d.total !== null && d.total >= 0 && d.total < 1e10
        ? Math.round(d.total * 100) / 100
        : null;
    // El número de la línea es el nombre del archivo mientras nadie lo cambie a mano.
    const nombreSinExt = nombre.replace(/\.[^.]+$/, "");
    const numero =
      d.numero && (vacio(linea?.numero) || linea?.numero === nombreSinExt) ? d.numero.slice(0, 100) : null;

    // Condiciones (plazo, validez, garantía, pago, partidas): solo si el ticket aún no las tiene.
    const condiciones = t.condiciones == null && d.condiciones
      ? JSON.stringify({ ...d.condiciones, numero: d.numero ?? null })
      : null;

    const partes: string[] = [];
    if (proveedor) partes.push(`proveedor ${proveedor}`);
    if (ruc) partes.push(`RUC ${ruc}`);
    if (fCoti) partes.push(`F. cotización ${formatoFecha(fCoti)}`);
    if (monto !== null) partes.push(`monto ${formatoSoles(monto)}${d.total_calculado ? " (calculado: subtotal + IGV, la cotización no incluye IGV)" : ""}`);
    if (condiciones) partes.push("condiciones de la cotización (plazo, validez, garantía, pago, partidas)");
    const detalle = partes.length > 0 ? `Cotización leída, se completó: ${partes.join(" · ")}`.slice(0, 1000) : "";

    // Se registra la cotización (proveedor + N°) en este ticket: así no vuelve a crear otro ticket después.
    // Si ya estaba registrada (en este u otro ticket) no se cambia nada.
    const clave = claveCotizacion(d);
    const usuario = acceso.user.username;
    const rows = await sql`
      WITH act AS (
        UPDATE correctivos SET
          proveedor = CASE WHEN ${proveedor !== null}::boolean THEN ${proveedor}::text ELSE proveedor END,
          ruc_proveedor = CASE WHEN ${ruc !== null}::boolean THEN ${ruc}::text ELSE ruc_proveedor END,
          f_coti = CASE WHEN ${fCoti !== null}::boolean THEN ${fCoti}::date ELSE f_coti END,
          monto = CASE WHEN ${monto !== null}::boolean THEN ${monto}::numeric ELSE monto END,
          condiciones = CASE WHEN ${condiciones !== null}::boolean THEN ${condiciones}::jsonb ELSE condiciones END,
          documentos = CASE WHEN ${numero !== null}::boolean
            -- Si la línea de cotización aún no existía, jsonb_set no hacía nada y el N° se perdía.
            THEN jsonb_set(COALESCE(documentos, '{}'::jsonb), '{cotizacion}',
                   COALESCE(documentos->'cotizacion', '{"estado": "Pendiente", "url": ""}'::jsonb)
                   || jsonb_build_object('numero', ${numero}::text))
            ELSE documentos END,
          updated_at = now()
        WHERE id = ${numId} AND eliminado_en IS NULL
        RETURNING documentos
      ),
      hist AS (
        INSERT INTO historial (correctivo_id, usuario, detalle)
        SELECT ${numId}::int, ${usuario}::text, ${detalle}::text FROM act WHERE ${partes.length > 0}::boolean
        RETURNING id
      ),
      reg AS (
        INSERT INTO cotizaciones_tickets (clave, correctivo_id)
        SELECT ${clave}::text, ${numId}::int FROM act WHERE ${clave !== null}::boolean
        ON CONFLICT (clave) DO NOTHING
        RETURNING clave
      )
      SELECT documentos FROM act
    `;
    if (rows.length === 0) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

    const campos: Record<string, string | number> = {};
    if (proveedor) campos.proveedor = proveedor;
    if (ruc) campos.ruc_proveedor = ruc;
    if (fCoti) campos.f_coti = toDateOnly(fCoti);
    if (monto !== null) campos.monto = monto;

    const sinCompletar: string[] = [];
    if (d.fecha_ambigua) sinCompletar.push("la fecha (ambigua)");
    if (d.moneda === "USD") sinCompletar.push("el monto (está en dólares)");
    const resumen =
      (partes.length > 0 ? `Cotización leída. Se completó: ${partes.join(", ")}.` : "Cotización leída: no había datos vacíos que completar.") +
      (sinCompletar.length > 0 ? ` No se completó ${sinCompletar.join(" ni ")}.` : "") +
      (d.numero ? ` N° ${d.numero}.` : "");

    return NextResponse.json({
      data: { campos, documentos: rows[0].documentos, avisos: d.avisos, resumen },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo leer la cotización" }, { status: 500 });
  }
}
