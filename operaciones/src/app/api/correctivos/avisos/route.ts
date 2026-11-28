import { NextResponse, type NextRequest } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { exigirSesion } from "@/lib/server/utils";
import { normalizeCorrectivos, CAMPUS, nombreCampus, SQL_DIAS_HABILES, SLA_COTI_OC_DIAS, ESTADOS_SIN_OC, SQL_TIENE_INFORME, formatoFecha } from "@/lib/shared";
import { getCurrentUser } from "@/lib/server/auth";
import type { Correctivo } from "@/lib/shared";
import { cronometro } from "@/lib/server/utils";
import { ALERTAS, alertasDeTicket, type AvisoItem } from "@/components/lista/filtrosLista";

export const dynamic = "force-dynamic";

const PESO = { rojo: 0, ambar: 1, gris: 2 } as const;

// Tope de tickets revisados (antes 5000, y si se pasaba no se avisaba). Si se alcanza, la respuesta
// lo indica con `truncado` y el panel lo muestra.
const MAX_TICKETS = 20000;

// Las notificaciones son las mismas para todos los usuarios y revisan TODOS los tickets: se guardan
// unos segundos en esta instancia, así abrir la lista (o que varias personas la abran a la vez) no
// repite esa consulta grande cada vez. Un cambio se ve, como mucho, en ese tiempo.
const TTL_AVISOS_MS = 20_000;
// Una copia por campus (al escribir un ticket se borran todas: ver proxy.ts).
const gAv = globalThis as typeof globalThis & { __correctivosAvisos?: Record<string, { vence: number; cuerpo: unknown }> };

/** Avisos de todos los tickets activos de un campus (lo usan la campana, el Panel y el resumen semanal). */
async function avisosDeCampus(campus: string): Promise<{ items: AvisoItem[]; truncado: boolean; revisados: number }> {
  const filas = await sql`
    SELECT id, refer, n_oc, f_oc, LEFT(descripcion, 200) AS descripcion, estado, f_entrega, monto,
           -- Los avisos solo miran la URL y el estado del informe y del certificado: se traen solo
           -- eso y no todo documentos (cotizaciones, OC, etc.), que pesa mucho en 5000 tickets.
           -- Más el monto de la cotización, la OC y el informe, para avisar si no coinciden.
           jsonb_build_object(
             'informe', jsonb_build_object('url', documentos->'informe'->'url', 'estado', documentos->'informe'->'estado',
                                           'monto', documentos->'informe'->'monto', 'moneda', documentos->'informe'->'moneda'),
             'certificado', jsonb_build_object('url', documentos->'certificado'->'url', 'estado', documentos->'certificado'->'estado'),
             'cotizacion', jsonb_build_object('estado', documentos->'cotizacion'->'estado',
                                              'monto', documentos->'cotizacion'->'monto', 'moneda', documentos->'cotizacion'->'moneda'),
             'oc', jsonb_build_object('estado', documentos->'oc'->'estado',
                                      'monto', documentos->'oc'->'monto', 'moneda', documentos->'oc'->'moneda')
           ) AS documentos,
           -- Para el aviso de cotización por vencer: solo la validez (no las partidas).
           f_coti, jsonb_build_object('validez_dias', condiciones->'validez_dias') AS condiciones,
           estado_desde, f_reg, created_at, updated_at
    FROM correctivos
    WHERE eliminado_en IS NULL AND campus = ${campus}
    ORDER BY id DESC
    LIMIT ${MAX_TICKETS + 1}
  `;
  const truncado = filas.length > MAX_TICKETS;
  if (truncado) filas.length = MAX_TICKETS;
  const todas = ALERTAS.map((a) => a.clave);
  const items: AvisoItem[] = [];
  for (const f of normalizeCorrectivos(filas as Record<string, unknown>[])) {
    const r = f as unknown as Correctivo;
    for (const a of alertasDeTicket(r, todas)) {
      items.push({ ...a, id: r.id, refer: r.refer, n_oc: r.n_oc, descripcion: r.descripcion });
    }
  }
  items.sort((a, b) => PESO[a.tono] - PESO[b.tono] || (b.refer ?? b.id) - (a.refer ?? a.id));
  return { items, truncado, revisados: filas.length };
}

/**
 * Todas las notificaciones de todos los tickets activos (no solo los de la página que se ve en la lista).
 * Se calculan con las mismas reglas que usaba la columna Estado; la persona elige en pantalla cuáles ver.
 */
export async function GET(req?: NextRequest) {
  if (req?.nextUrl?.searchParams.get("resumen") === "semanal") return resumenSemanal(req);
  try {
    const reloj = cronometro();
    const acceso = await exigirSesion();
    if (acceso.error) return acceso.error;
    reloj.paso("sesion");
    const campus = acceso.user.campus;
    const guardado = gAv.__correctivosAvisos?.[campus];
    const fresco = req?.nextUrl?.searchParams.get("fresco") === "1";
    if (!fresco && guardado && guardado.vence > Date.now()) {
      reloj.paso("copia");
      return NextResponse.json(guardado.cuerpo, { headers: { "Server-Timing": reloj.cabecera() } });
    }
    await ensureSchema();
    const { items, truncado, revisados } = await avisosDeCampus(campus);
    reloj.paso("base_datos");
    const cuerpo = { data: items, truncado, revisados };
    gAv.__correctivosAvisos = { ...gAv.__correctivosAvisos, [campus]: { vence: Date.now() + TTL_AVISOS_MS, cuerpo } };
    reloj.paso("calculo");
    return NextResponse.json(cuerpo, { headers: { "Server-Timing": reloj.cabecera() } });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudieron obtener las notificaciones" }, { status: 500 });
  }
}

// ───────── Resumen semanal por correo ─────────
// Lo dispara Vercel Cron cada lunes (vercel.json) con «Authorization: Bearer CRON_SECRET». Un administrador
// puede verlo en el navegador (`?resumen=semanal`) y enviarlo de prueba (`&enviar=1`).
// Envío: Resend (https://resend.com), con las variables RESEND_API_KEY, RESUMEN_PARA (correos separados por
// coma) y RESUMEN_DE (remitente verificado; por defecto el de pruebas de Resend).

type FilaResumen = { refer: number | null; descripcion: string; proveedor: string | null; dias: number };
type ListaResumen = { filas: FilaResumen[]; total: number };
type BloqueCampus = {
  campus: string;
  creados: number;
  finalizados: number;
  vencidas: ListaResumen;
  sinInforme: ListaResumen;
  ocFueraSla: ListaResumen;
  montos: ListaAviso;
  cotizaciones: ListaAviso;
};
type ListaAviso = { filas: { refer: number | null; descripcion: string; detalle: string }[]; total: number };

async function datosResumen(campus: string): Promise<BloqueCampus> {
  const hoy = "(now() AT TIME ZONE 'America/Lima')::date";
  // Las primeras 15 filas y el total real (COUNT(*) OVER () se calcula antes del LIMIT).
  const lista = async (q: string): Promise<ListaResumen> => {
    const rs = (await sql.query(q.replace("SELECT refer,", "SELECT COUNT(*) OVER ()::int AS total, refer,"), [campus])) as {
      total: number; refer: number | null; descripcion: string | null; proveedor: string | null; dias: number;
    }[];
    return {
      total: rs[0]?.total ?? 0,
      filas: rs.map((r) => ({ refer: r.refer, descripcion: (r.descripcion ?? "").replace(/\s+/g, " ").slice(0, 90), proveedor: r.proveedor, dias: Number(r.dias) })),
    };
  };
  const [cuentas, vencidas, sinInforme, ocFueraSla] = await Promise.all([
    sql.query(
      `SELECT COUNT(*) FILTER (WHERE f_reg >= ${hoy} - 7)::int AS creados,
              COUNT(*) FILTER (WHERE estado = 'Finalizado' AND estado_desde >= now() - interval '7 days')::int AS finalizados
       FROM correctivos WHERE eliminado_en IS NULL AND campus = $1`,
      [campus]
    ) as unknown as Promise<{ creados: number; finalizados: number }[]>,
    lista(`SELECT refer, descripcion, proveedor, (${hoy} - f_entrega)::int AS dias FROM correctivos
           WHERE eliminado_en IS NULL AND campus = $1 AND estado IN ('Ingresado a PS', 'Por Ejecutar')
             AND f_entrega < ${hoy} AND NOT ${SQL_TIENE_INFORME}
           ORDER BY f_entrega ASC LIMIT 15`),
    lista(`SELECT refer, descripcion, proveedor, (${hoy} - f_fin)::int AS dias FROM correctivos
           WHERE eliminado_en IS NULL AND campus = $1 AND estado = 'Por Ejecutar' AND f_fin < ${hoy} AND NOT ${SQL_TIENE_INFORME}
           ORDER BY f_fin ASC LIMIT 15`),
    lista(`SELECT refer, descripcion, proveedor, ${SQL_DIAS_HABILES("f_coti", hoy)} AS dias FROM correctivos
           WHERE eliminado_en IS NULL AND campus = $1 AND f_coti IS NOT NULL AND f_oc IS NULL
             AND estado = ANY($2::text[]) AND ${SQL_DIAS_HABILES("f_coti", hoy)} > ${SLA_COTI_OC_DIAS}
           ORDER BY f_coti ASC LIMIT 15`.replace("$2::text[]", `'{${ESTADOS_SIN_OC.map((e) => `"${e}"`).join(",")}}'::text[]`)),
  ]);
  // Montos que no coinciden y cotizaciones por vencer: las mismas reglas que la campana.
  const { items } = await avisosDeCampus(campus);
  const avisos = (clave: string): ListaAviso => {
    const l = items.filter((a) => a.clave === clave);
    return {
      total: l.length,
      filas: l.slice(0, 15).map((a) => ({
        refer: a.refer,
        descripcion: (a.descripcion ?? "").replace(/\s+/g, " ").slice(0, 90),
        detalle: a.titulo.replace(/^Los montos no coinciden: /, ""),
      })),
    };
  };
  return {
    campus,
    creados: cuentas[0]?.creados ?? 0,
    finalizados: cuentas[0]?.finalizados ?? 0,
    vencidas,
    sinInforme,
    ocFueraSla,
    montos: avisos("montos_distintos"),
    cotizaciones: avisos("cotizacion_vence"),
  };
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

function htmlResumen(bloques: BloqueCampus[], app: string): string {
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
  const tabla = (titulo: string, color: string, { filas, total }: ListaResumen, unidad: string) =>
    filas.length === 0
      ? ""
      : `<h3 style="font-size:14px;margin:18px 0 6px;color:${color}">${titulo} (${total})</h3>
         <table style="width:100%;border-collapse:collapse;font-size:12px">${filas
           .map(
             (f) => `<tr><td style="padding:5px 6px;border-bottom:1px solid #e1e5ec;font-family:monospace;color:#545e71">#${f.refer ?? "—"}</td>
               <td style="padding:5px 6px;border-bottom:1px solid #e1e5ec">${esc(f.descripcion)}</td>
               <td style="padding:5px 6px;border-bottom:1px solid #e1e5ec;color:#545e71">${esc(f.proveedor ?? "—")}</td>
               <td style="padding:5px 6px;border-bottom:1px solid #e1e5ec;text-align:right;white-space:nowrap;color:${color}"><b>${f.dias}</b> ${unidad}</td></tr>`
           )
           .join("")}</table>${total > filas.length ? `<p style="font-size:11px;color:#8a93a3;margin:4px 0 0">… y ${total - filas.length} más (los de mayor atraso arriba).</p>` : ""}`;
  const tablaAviso = (titulo: string, color: string, { filas, total }: ListaAviso) =>
    filas.length === 0
      ? ""
      : `<h3 style="font-size:14px;margin:18px 0 6px;color:${color}">${titulo} (${total})</h3>
         <table style="width:100%;border-collapse:collapse;font-size:12px">${filas
           .map(
             (f) => `<tr><td style="padding:5px 6px;border-bottom:1px solid #e1e5ec;font-family:monospace;color:#545e71;vertical-align:top">#${f.refer ?? "—"}</td>
               <td style="padding:5px 6px;border-bottom:1px solid #e1e5ec">${esc(f.descripcion)}<div style="color:${color};font-size:11px;margin-top:2px">${esc(f.detalle)}</div></td></tr>`
           )
           .join("")}</table>${total > filas.length ? `<p style="font-size:11px;color:#8a93a3;margin:4px 0 0">… y ${total - filas.length} más en la campana de la app.</p>` : ""}`;
  return `<!doctype html><html><body style="margin:0;background:#f4f6fa;font-family:Arial,Helvetica,sans-serif;color:#0f1626">
  <div style="max-width:720px;margin:0 auto;padding:24px">
   <div style="border-top:4px solid #d0112d;background:#fff;border:1px solid #e1e5ec;border-radius:8px;padding:22px 24px">
    <div style="font-size:11px;letter-spacing:.14em;font-weight:bold;color:#d0112d;text-transform:uppercase">Sistema de Correctivos · resumen semanal</div>
    <h1 style="font-size:22px;margin:6px 0 4px">Semana al ${formatoFecha(hoy)}</h1>
    <p style="font-size:13px;color:#545e71;margin:0 0 8px">Lo que requiere atención en cada campus.</p>
    ${bloques
      .map(
        (b) => `<div style="margin-top:20px;padding-top:14px;border-top:1px solid #e1e5ec">
      <h2 style="font-size:17px;margin:0 0 10px;color:#1e3a5f">${esc(nombreCampus(b.campus))}</h2>
      <table style="border-collapse:collapse;font-size:12px"><tr>
        ${[
          ["Creados (7 días)", b.creados, "#1e3a5f"],
          ["Finalizados (7 días)", b.finalizados, "#127a56"],
          ["Entrega vencida", b.vencidas.total, "#d0112d"],
          ["Terminados sin informe", b.sinInforme.total, "#c2410c"],
          ["OC fuera de SLA", b.ocFueraSla.total, "#b45309"],
          ["Montos ≠", b.montos.total, "#d0112d"],
          ["Cotiz. por vencer", b.cotizaciones.total, "#b45309"],
        ]
          .map(
            ([t, n, c]) => `<td style="padding:8px 14px 8px 0"><div style="color:#545e71">${t}</div><div style="font-size:22px;font-weight:bold;color:${c}">${n}</div></td>`
          )
          .join("")}
      </tr></table>
      ${tabla("Entrega de la OC vencida, sin informe", "#d0112d", b.vencidas, "días")}
      ${tabla("Trabajo terminado, falta el informe (sigue en Por Ejecutar)", "#c2410c", b.sinInforme, "días")}
      ${tabla(`Cotización sin OC más de ${SLA_COTI_OC_DIAS} días hábiles`, "#b45309", b.ocFueraSla, "d. háb.")}
      ${tablaAviso("Montos de cotización, OC e informe que no coinciden", "#d0112d", b.montos)}
      ${tablaAviso("Cotizaciones por vencer (sin OC)", "#b45309", b.cotizaciones)}
      ${b.vencidas.total + b.sinInforme.total + b.ocFueraSla.total + b.montos.total + b.cotizaciones.total === 0 ? '<p style="font-size:13px;color:#127a56">✓ Nada pendiente fuera de plazo.</p>' : ""}
     </div>`
      )
      .join("")}
    ${app ? `<p style="margin-top:22px"><a href="${app}/dashboard" style="background:#1e3a5f;color:#fff;text-decoration:none;padding:9px 16px;border-radius:6px;font-size:13px">Abrir el Panel</a></p>` : ""}
   </div>
   <p style="font-size:11px;color:#8a93a3;text-align:center;margin-top:12px">Correo automático del Sistema de Correctivos · Laureate Perú</p>
  </div></body></html>`;
}

async function enviarCorreo(asunto: string, html: string): Promise<{ ok: boolean; detalle: string }> {
  const clave = process.env.RESEND_API_KEY;
  const para = (process.env.RESUMEN_PARA ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!clave || para.length === 0) return { ok: false, detalle: "Falta configurar RESEND_API_KEY y RESUMEN_PARA en Vercel." };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${clave}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.RESUMEN_DE || "Correctivos <onboarding@resend.dev>", to: para, subject: asunto, html }),
  });
  return r.ok ? { ok: true, detalle: `Enviado a ${para.length} destinatario(s).` } : { ok: false, detalle: `El servicio de correo respondió ${r.status}: ${(await r.text()).slice(0, 200)}` };
}

async function resumenSemanal(req: NextRequest) {
  const secreto = process.env.CRON_SECRET;
  const porCron = !!secreto && req.headers.get("authorization") === `Bearer ${secreto}`;
  let campusLista: string[] = CAMPUS.map((c) => c.id);
  if (!porCron) {
    const user = await getCurrentUser();
    if (!user || user.rol !== "admin") return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
    campusLista = user.campusPermitidos;
  }
  await ensureSchema();
  const bloques = await Promise.all(campusLista.map((c) => datosResumen(c)));
  const app = process.env.APP_URL || req.nextUrl.origin;
  const html = htmlResumen(bloques, app);
  const asunto = `Correctivos · resumen semanal ${formatoFecha(new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" }))}`;
  if (porCron || req.nextUrl.searchParams.get("enviar") === "1") {
    const r = await enviarCorreo(asunto, html);
    if (porCron) return NextResponse.json(r, { status: r.ok ? 200 : 500 });
    return new NextResponse(`<p style="font-family:Arial;padding:12px;background:${r.ok ? "#e3f3eb" : "#fdecee"}">${esc(r.detalle)}</p>${html}`, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  // Vista previa para el administrador.
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

