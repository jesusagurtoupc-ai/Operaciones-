import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { exigirAdmin } from "@/lib/server/utils";
import { leerPdfDeCotizacion } from "@/lib/server/leerCotizacion";
import { formatoFecha, formatoSoles, toDateOnly } from "@/lib/shared";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const vacio = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

/**
 * Lee el PDF de la línea "Cotización" del ticket y COMPLETA solo los datos que el ticket aún no
 * tiene (proveedor, RUC, fecha de cotización y monto). Nunca pisa un dato que ya está escrito.
 * Si el número de la línea sigue siendo el nombre del archivo, lo cambia por el N° de cotización leído.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const acceso = await exigirAdmin();
    if (acceso.error) return acceso.error;
    const { id } = await params;
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    const numId = Number(id);

    await ensureSchema();
    const filas = await sql`
      SELECT proveedor, ruc_proveedor, f_coti, monto, documentos
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
    const arch = await sql`
      SELECT nombre, encode(data, 'base64') AS b64 FROM archivos
      WHERE id = ${Number(m[2])} AND correctivo_id = ${numId}
    `;
    if (arch.length === 0) return NextResponse.json({ error: "No se encontró el archivo" }, { status: 404 });
    const { nombre, b64 } = arch[0] as { nombre: string; b64: string };

    const r = leerPdfDeCotizacion(Buffer.from(b64, "base64"));
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.noEsPdf ? 400 : 422 });
    const d = r.datos;

    // Solo se completa lo que está vacío.
    const proveedor = vacio(t.proveedor) && d.proveedor ? d.proveedor.slice(0, 200) : null;
    const ruc = vacio(t.ruc_proveedor) && d.ruc_proveedor ? d.ruc_proveedor : null;
    const fCoti = vacio(t.f_coti) && d.fecha && !d.fecha_ambigua ? d.fecha : null;
    const monto =
      (t.monto === null || t.monto === undefined) && d.moneda !== "USD" && d.total !== null && d.total >= 0 && d.total < 1e10
        ? Math.round(d.total * 100) / 100
        : null;
    // El número de la línea es el nombre del archivo mientras nadie lo cambie a mano.
    const nombreSinExt = nombre.replace(/\.[^.]+$/, "");
    const numero =
      d.numero && (vacio(linea?.numero) || linea?.numero === nombreSinExt) ? d.numero.slice(0, 100) : null;

    const partes: string[] = [];
    if (proveedor) partes.push(`proveedor ${proveedor}`);
    if (ruc) partes.push(`RUC ${ruc}`);
    if (fCoti) partes.push(`F. cotización ${formatoFecha(fCoti)}`);
    if (monto !== null) partes.push(`monto ${formatoSoles(monto)}${d.total_calculado ? " (calculado: subtotal + IGV, la cotización no incluye IGV)" : ""}`);
    const detalle = partes.length > 0 ? `Cotización leída, se completó: ${partes.join(" · ")}`.slice(0, 1000) : "";

    const usuario = acceso.user.username;
    const rows = await sql`
      WITH act AS (
        UPDATE correctivos SET
          proveedor = CASE WHEN ${proveedor !== null}::boolean THEN ${proveedor}::text ELSE proveedor END,
          ruc_proveedor = CASE WHEN ${ruc !== null}::boolean THEN ${ruc}::text ELSE ruc_proveedor END,
          f_coti = CASE WHEN ${fCoti !== null}::boolean THEN ${fCoti}::date ELSE f_coti END,
          monto = CASE WHEN ${monto !== null}::boolean THEN ${monto}::numeric ELSE monto END,
          documentos = CASE WHEN ${numero !== null}::boolean
            THEN jsonb_set(COALESCE(documentos, '{}'::jsonb), '{cotizacion,numero}', to_jsonb(${numero}::text))
            ELSE documentos END,
          updated_at = now()
        WHERE id = ${numId} AND eliminado_en IS NULL
        RETURNING documentos
      ),
      hist AS (
        INSERT INTO historial (correctivo_id, usuario, detalle)
        SELECT ${numId}::int, ${usuario}::text, ${detalle}::text FROM act WHERE ${partes.length > 0}::boolean
        RETURNING id
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
