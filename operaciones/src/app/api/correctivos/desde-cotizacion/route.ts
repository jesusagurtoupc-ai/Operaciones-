import { NextRequest, NextResponse } from "next/server";
import { resolverProveedor } from "@/lib/server/proveedores";
import { sql, ensureSchema } from "@/lib/server/db";
import { guardarEnBlob, borrarDeBlob } from "@/lib/server/almacen";
import { exigirAdmin, violacionUnica, mensajeDuplicado } from "@/lib/server/utils";
import { leerPdfDeCotizacion } from "@/lib/server/leerCotizacion";
import { sugerirLugar, sugerirSubTipo, sugerirTipo } from "@/lib/server/sugerencias";
import { MAX_BYTES, TIPOS_PERMITIDOS, extensionDe, formatoSoles } from "@/lib/shared";
import { claveCotizacion } from "@/components/lista/emparejarCarga";

// Usa zlib de Node: no puede correr en el runtime "edge".
export const runtime = "nodejs";

// El ticket nace con la cotización recibida: es el mismo estado al que pasa un ticket cuando se le
// carga la cotización ("enviado"). Cuando llegue la OC pasará solo a "Por Ejecutar".
const ESTADO_INICIAL = "enviado";
const AREA_INICIAL = "Mantenimiento";

/** "CORRECTIVO_DE_PUERTA_BA_O_PISO_1B.pdf" → "CORRECTIVO DE PUERTA BA O PISO 1B" (solo si parece una descripción). */
function descripcionDesdeNombre(nombre: string): string | null {
  const t = nombre
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Un nombre como "COT-1128" o "scan0001" no describe el trabajo.
  if (t.length < 8 || !/[a-záéíóúñ]{4,}.*\s.*[a-záéíóúñ]{3,}/i.test(t) || /^(cot|coti|cotizaci[oó]n|scan|img|doc)\b[\s\-_]*\d*$/i.test(t)) {
    return null;
  }
  return t.slice(0, 300);
}

/**
 * Crea un ticket NUEVO a partir del PDF de una cotización (antes de que exista la OC).
 *
 * Body (multipart):
 *  - file = PDF de la cotización (se guarda como adjunto del ticket, en la línea "Cotización").
 *
 * Los datos se leen aquí, en el servidor, del propio PDF: nunca se aceptan datos sueltos del cliente.
 * El ticket queda en estado "enviado", con proveedor, RUC, fecha de cotización, monto (con IGV) y la
 * descripción ("Solicitud:" del PDF o, si no la trae, el nombre del archivo). Cuando llegue la OC,
 * se vincula a este ticket (botón "+ OC" o desde el ticket) y pasa a "Por Ejecutar".
 *
 * Una misma cotización (mismo N° y mismo proveedor) no puede crear dos tickets. Lo garantiza la base:
 * la tabla cotizaciones_tickets tiene la clave proveedor + N° como clave única, así que ni dos subidas
 * simultáneas de la misma cotización pueden crear dos tickets (la segunda falla entera y no deja nada).
 * El ticket, su archivo y el historial se graban en UNA sola instrucción: o todo o nada.
 */
export async function POST(req: NextRequest) {
  try {
    const acceso = await exigirAdmin();
    if (acceso.error) return acceso.error;

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Elige el PDF de la cotización" }, { status: 400 });
    }
    if (file.size === 0) return NextResponse.json({ error: "El archivo está vacío" }, { status: 400 });
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "El archivo supera el máximo de 4 MB" }, { status: 413 });
    }
    let nombre = file.name.replace(/[\\/\r\n]/g, "_").trim().slice(0, 190) || "cotizacion";
    if (extensionDe(nombre) !== "pdf") nombre += ".pdf";
    const buf = Buffer.from(await file.arrayBuffer());

    const r = leerPdfDeCotizacion(buf);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.noEsPdf ? 400 : 422 });
    const d = r.datos;
    // Igual de estricto que la carga masiva: sin total ni proveedor no es (o no se pudo leer) una cotización.
    if (d.total === null || !(d.ruc_proveedor || d.proveedor)) {
      return NextResponse.json(
        { error: "No se reconoció una cotización en este PDF (falta el total o el proveedor)" },
        { status: 422 }
      );
    }

    await ensureSchema();
    // El proveedor pasa a su nombre oficial del registro (un solo nombre por empresa).
    const { nombre: proveedor, ruc } = await resolverProveedor(d.proveedor ? d.proveedor.slice(0, 200) : null, d.ruc_proveedor);
    const enSoles = d.moneda !== "USD";
    const monto = enSoles && d.total >= 0 && d.total < 1e10 ? Math.round(d.total * 100) / 100 : null;
    const fCoti = d.fecha && !d.fecha_ambigua ? d.fecha : null;
    const nombreSinExt = nombre.replace(/\.[^.]+$/, "");
    const numeroCot = (d.numero ?? nombreSinExt).slice(0, 100);
    const descripcion =
      d.solicitud ??
      descripcionDesdeNombre(nombre) ??
      `Cotización${d.numero ? ` N° ${d.numero}` : ""}${proveedor ? ` de ${proveedor}` : ""}`;


    // ¿Esta cotización ya creó un ticket? Primero en el registro (incluye tickets en la papelera)…
    const clave = claveCotizacion(d);
    if (clave) {
      const registrada = await sql`
        SELECT c.id, c.refer, c.eliminado_en
        FROM cotizaciones_tickets ct JOIN correctivos c ON c.id = ct.correctivo_id
        WHERE ct.clave = ${clave}
      `;
      if (registrada.length > 0) {
        const t = registrada[0] as { id: number; refer: number | null; eliminado_en: string | null };
        return NextResponse.json(
          {
            error: t.eliminado_en
              ? `La cotización N° ${d.numero} ya creó el ticket #${t.refer ?? t.id}, que está en la papelera: restáuralo desde ahí`
              : `La cotización N° ${d.numero} ya está en el ticket #${t.refer ?? t.id}`,
            ticket: { id: t.id, refer: t.refer },
          },
          { status: 409 }
        );
      }
    }
    // …y luego en los tickets activos que ya la tienen en su línea "Cotización" (mismo N° y proveedor).
    // Sin N° leído no se puede comprobar: se avisa en el historial.
    if (d.numero) {
      const repetida = await sql`
        SELECT id, refer FROM correctivos
        WHERE eliminado_en IS NULL
          AND LOWER(BTRIM(documentos->'cotizacion'->>'numero')) = LOWER(BTRIM(${d.numero}::text))
          AND (
            (${ruc}::text IS NOT NULL AND ruc_proveedor = ${ruc}::text)
            OR (${proveedor}::text IS NOT NULL AND LOWER(BTRIM(proveedor)) = LOWER(BTRIM(${proveedor}::text)))
          )
        LIMIT 1
      `;
      if (repetida.length > 0) {
        const t = repetida[0] as { id: number; refer: number | null };
        return NextResponse.json(
          { error: `La cotización N° ${d.numero} ya está en el ticket #${t.refer ?? t.id}`, ticket: t },
          { status: 409 }
        );
      }
    }

    const usuario = acceso.user.username;
    const lugar = sugerirLugar(descripcion);
    // Condiciones de la cotización (plazo, validez, garantía, pago, partidas), con su N°.
    const condiciones = d.condiciones ? JSON.stringify({ ...d.condiciones, numero: d.numero ?? null }) : null;
    const tipoTrab = sugerirTipo(descripcion);
    const subTipo = sugerirSubTipo(descripcion);

    const notas = [`Ticket creado desde la cotización${d.numero ? ` N° ${d.numero}` : ""}${proveedor ? ` de ${proveedor}` : ""}`];
    if (monto !== null && d.total_calculado) notas.push(`monto ${formatoSoles(monto)} calculado: subtotal + IGV (la cotización no incluye IGV)`);
    if (!enSoles) notas.push("la cotización está en dólares: monto sin guardar");
    if (d.fecha_ambigua) notas.push("fecha de la cotización ambigua: no se guardó");
    if (!d.numero) notas.push("no se leyó el N° de cotización: no se pudo comprobar si estaba repetida");
    if (!d.solicitud) notas.push("descripción tomada del nombre del archivo: revísala");
    const cc = d.condiciones;
    if (cc) {
      const partes = [
        cc.plazo_dias != null && `plazo ${cc.plazo_dias} días${cc.plazo_tipo ? ` ${cc.plazo_tipo}` : ""}`,
        cc.validez_dias != null && `validez ${cc.validez_dias} días`,
        cc.garantia_meses != null && `garantía ${cc.garantia_meses} meses`,
        cc.partidas?.length && `${cc.partidas.length} partida${cc.partidas.length === 1 ? "" : "s"}`,
      ].filter(Boolean);
      if (partes.length) notas.push(`condiciones leídas: ${partes.join(", ")}`);
    }
    if (lugar || tipoTrab || subTipo) {
      notas.push(`sugerido automáticamente: ${[lugar && `lugar ${lugar}`, tipoTrab && `tipo ${tipoTrab}`, subTipo && `sub tipo ${subTipo}`].filter(Boolean).join(", ")}`);
    }
    const detalleHistorial = notas.join(" · ").slice(0, 1000);

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
          (id, refer, ticket, f_reg, descripcion, lugar, estado, proveedor, monto, f_coti,
           n_oc, area, tipo_trab, sub_tipo_trab, ruc_proveedor, documentos, estado_desde, condiciones)
        SELECT ids.cid,
               GREATEST((SELECT COALESCE(MAX(refer), 0) FROM correctivos),
                        COALESCE((SELECT valor FROM refer_tope WHERE id = 1), 0)) + 1,
               NULL,
               (now() AT TIME ZONE 'America/Lima')::date,
               ${descripcion}::text, ${lugar}::text, ${ESTADO_INICIAL}::text, ${proveedor}::text, ${monto}::numeric,
               ${fCoti}::date, NULL, ${AREA_INICIAL}::text, ${tipoTrab}::text, ${subTipo}::text, ${ruc}::text,
               jsonb_build_object('cotizacion', jsonb_build_object(
                 'numero', ${numeroCot}::text,
                 'estado', 'Listo',
                 'url', '/api/correctivos/' || ids.cid::text || '/archivos/' || ids.aid::text
               )),
               now(),
               ${condiciones}::jsonb
        FROM ids
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
      ),
      registro AS (
        -- Clave única: si otra subida de la misma cotización se adelantó, esto falla y no se crea nada.
        INSERT INTO cotizaciones_tickets (clave, correctivo_id)
        SELECT ${clave}::text, nuevo.id FROM nuevo WHERE ${clave}::text IS NOT NULL
        RETURNING clave
      )
      SELECT nuevo.id, nuevo.refer FROM nuevo
    `;

    // Dos altas a la vez calculan el mismo "máximo + 1": el índice único deja pasar a una y la otra reintenta.
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
    const creado = rows[0] as { id: number; refer: number | null };
    return NextResponse.json(
      { data: { id: creado.id, refer: creado.refer, descripcion, monto, avisos: d.avisos } },
      { status: 201 }
    );
  } catch (err) {
    const e = err as { code?: string; constraint?: string; message?: string };
    if (e?.code === "23505" && `${e.constraint ?? ""} ${e.message ?? ""}`.includes("cotizaciones_tickets")) {
      return NextResponse.json(
        { error: "Esta cotización se acaba de registrar en otro ticket (¿se subió dos veces a la vez?): revisa la lista" },
        { status: 409 }
      );
    }
    const dup = violacionUnica(err);
    if (dup) return NextResponse.json({ error: mensajeDuplicado(dup) }, { status: 409 });
    console.error(err);
    return NextResponse.json({ error: "No se pudo crear el ticket desde la cotización" }, { status: 500 });
  }
}
