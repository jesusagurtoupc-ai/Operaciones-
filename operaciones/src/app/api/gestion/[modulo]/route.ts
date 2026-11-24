import { createHmac, createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, sql } from "@/lib/server/db";
import { exigirAdmin, exigirSesion, bloqueado, registrarFallo, condCampus } from "@/lib/server/utils";
import { ipDe } from "@/lib/server/auditoria";
import { borrarDeBlob, guardarEnBlob } from "@/lib/server/almacen";
import { CAMPUS_PRINCIPAL, esCampus, ESTADOS_CON_PLAZO, DIAS_ATRASO, SLA_COTI_OC_DIAS, ESTADOS_SIN_OC, SQL_DIAS_HABILES, hoyLima, sumarMeses, sumarDias, diasEntre, toDateOnly } from "@/lib/shared";
import {
  type AjusteGarantia, type Contratista, type InformeMes, type Permiso, type Preventivo, type Registro, type Reporte,
  type TicketGestion, type GastoCuenta, type LineaPresupuesto,
  CATEGORIAS_REPORTE, DOCUMENTOS_CONTRATISTA, ESTADOS_PERMISO, ESTADOS_RECLAMO, ESTADOS_REPORTE, LIMITES_REPORTE, RIESGOS,
  alertasContratista, calcularGarantias, claveTexto, mismoTrabajo, proximoPreventivo, rangoTrabajo, semaforo,
} from "@/lib/gestion";

export const dynamic = "force-dynamic";

/**
 * Páginas de Gestión. Cada página usa su propia dirección (el acceso por página lo controla el proxy):
 *
 *  GET  /api/gestion/garantias            → garantías calculadas (cotización o ajuste manual), con los tickets
 *                                            abiertos después en el mismo equipo/ambiente (posible reclamo).
 *  GET  /api/gestion/garantias?ticket=ID  → si ese ticket cae dentro de la garantía de un trabajo anterior.
 *  GET  /api/gestion/agenda?desde&hasta   → trabajos en obra en esas fechas, por programar, contratistas y permisos.
 *  GET  /api/gestion/presupuesto?anio=    → presupuesto por cuenta y gasto mensual (comprometido / ejecutado).
 *  GET  /api/gestion/preventivos          → servicios preventivos contratados.
 *  GET  /api/gestion/reportes             → bandeja de reportes recibidos por QR.
 *  GET  /api/gestion/informe?mes=AAAA-MM  → resumen del mes para gerencia.
 *
 *  POST /api/gestion/<página>  { tipo, id?, datos }  → crea o actualiza un registro (solo administradores).
 *  POST /api/gestion/preventivos?accion=realizado { id, fecha, nota?, enlace? } → registra un servicio hecho.
 *  POST /api/gestion/reportes?accion=qr { lugares: [] } → enlaces firmados para imprimir los QR.
 *  DELETE /api/gestion/<página>?id=N → borra un registro (solo administradores).
 *
 *  POST /api/gestion/reportar (formulario)  → reporte PÚBLICO, sin sesión (lo abre el QR pegado en el ambiente).
 *       Protegido con límite por IP y total, campo trampa, tiempo mínimo de llenado y tamaño máximo.
 */

type Params = { params: Promise<{ modulo: string }> };
const sinCache = { "Cache-Control": "private, no-store" };
const MODULOS = ["garantias", "agenda", "presupuesto", "preventivos", "reportes", "informe"];
/** Qué tipos de registro escribe cada página. */
const TIPOS: Record<string, string[]> = {
  garantias: ["garantia"],
  agenda: ["contratista", "permiso"],
  presupuesto: ["presupuesto"],
  preventivos: ["preventivo"],
  reportes: ["reporte"],
  informe: ["informe_nota"],
};

const err = (error: string, status = 400) => NextResponse.json({ error }, { status });

// ───────── lectura ─────────

const fecha = (col: string) => `to_char(${col}, 'YYYY-MM-DD')`;
const COLUMNAS_TICKET = `c.id, c.refer, c.ticket, LEFT(c.descripcion, 300) AS descripcion, c.lugar, c.proveedor, c.monto::float AS monto,
  c.estado, ${fecha("c.f_reg")} AS f_reg, ${fecha("c.f_inicio")} AS f_inicio, ${fecha("c.f_fin")} AS f_fin,
  ${fecha("c.f_entrega")} AS f_entrega, c.cuenta, c.area, c.sub_tipo_trab,
  CASE WHEN jsonb_typeof(c.condiciones->'garantia_meses') = 'number' THEN ROUND((c.condiciones->>'garantia_meses')::numeric)::int END AS garantia_meses,
  c.condiciones->>'garantia_texto' AS garantia_texto, e.codigo`;

/** Tickets activos (con su equipo enlazado) que cumplen la condición SQL `donde` (sin datos del usuario). */
async function tickets(campus: string, donde = "TRUE", params: unknown[] = []): Promise<TicketGestion[]> {
  return (await sql.query(
    `SELECT ${COLUMNAS_TICKET} FROM correctivos c LEFT JOIN equipo_correctivos e ON e.correctivo_id = c.id
     WHERE c.eliminado_en IS NULL AND ${condCampus(campus, "c.campus")} AND (${donde}) ORDER BY c.id`,
    params
  )) as TicketGestion[];
}

async function registros<T>(campus: string, tipo: string, extra = "TRUE", params: unknown[] = []): Promise<Registro<T>[]> {
  return (await sql.query(
    `SELECT id, datos, usuario, actualizado_en, creado_en FROM gestion_registros WHERE tipo = $1 AND ${condCampus(campus)} AND (${extra}) ORDER BY id`,
    [tipo, ...params]
  )) as Registro<T>[];
}

/** Garantías vigentes o vencidas hace menos de un año (con sus posibles reclamos). */
async function garantias(campus: string, hoy: string) {
  const [ts, aj] = await Promise.all([
    tickets(campus, "c.f_reg >= current_date - interval '4 years' OR c.f_fin >= current_date - interval '4 years'"),
    registros<AjusteGarantia>(campus, "garantia"),
  ]);
  const todas = calcularGarantias(ts, aj.map((r) => r.datos), hoy);
  return { todas, tickets: ts, ajustes: aj };
}

async function verGarantias(req: NextRequest, hoy: string, campus: string) {
  const idTicket = Number(req.nextUrl.searchParams.get("ticket"));
  if (req.nextUrl.searchParams.has("ticket")) {
    if (!Number.isInteger(idTicket) || idTicket <= 0) return err("Ticket inválido");
    const [t] = await tickets(campus, "c.id = $1", [idTicket]);
    if (!t?.f_reg) return NextResponse.json({ data: { cubre: [] } }, { headers: sinCache });
    // Solo los trabajos terminados antes de que se abriera este ticket y que tienen (o pueden tener) garantía.
    const [cands, aj] = await Promise.all([
      tickets(campus, 
        `c.f_fin < $1::date AND c.f_fin >= $1::date - interval '10 years' AND (c.condiciones->'garantia_meses' IS NOT NULL
          OR c.id::text IN (SELECT clave FROM gestion_registros WHERE tipo = 'garantia'))`,
        [t.f_reg]
      ),
      registros<AjusteGarantia>(campus, "garantia"),
    ]);
    const g = calcularGarantias([...cands, t], aj.map((r) => r.datos), hoy).filter((x) => x.t.id !== t.id && x.hasta >= t.f_reg! && mismoTrabajo(x.t, t));
    return NextResponse.json(
      { data: { cubre: g.map((x) => ({ id: x.t.id, refer: x.t.refer, ticket: x.t.ticket, proveedor: x.t.proveedor, descripcion: x.t.descripcion, hasta: x.hasta, meses: x.meses })) } },
      { headers: sinCache }
    );
  }
  const { todas, tickets: ts, ajustes } = await garantias(campus, hoy);
  const desdeVencidas = sumarDias(hoy, -365, false);
  const lista = todas.filter((g) => g.hasta >= desdeVencidas);
  const conGarantia = new Set(todas.map((g) => g.t.id));
  // Trabajos finalizados del último año sin garantía conocida: para cargarla a mano.
  const sinGarantia = ts
    .filter((t) => t.estado === "Finalizado" && !conGarantia.has(t.id) && (toDateOnly(t.f_fin) || "") >= desdeVencidas)
    .map((t) => ({ id: t.id, refer: t.refer, ticket: t.ticket, descripcion: t.descripcion.slice(0, 160), proveedor: t.proveedor, f_fin: t.f_fin, monto: t.monto }))
    .slice(-500);
  const idAjuste = Object.fromEntries(ajustes.map((r) => [r.datos.correctivo_id, r.id]));
  return NextResponse.json({ data: { hoy, garantias: lista, sinGarantia, idAjuste } }, { headers: sinCache });
}

async function verAgenda(req: NextRequest, hoy: string, campus: string) {
  const sp = req.nextUrl.searchParams;
  let desde = toDateOnly(sp.get("desde")) || hoy;
  let hasta = toDateOnly(sp.get("hasta")) || sumarDias(desde, 6, false);
  if (hasta < desde) [desde, hasta] = [hasta, desde];
  if (diasEntre(desde, hasta) > 92) hasta = sumarDias(desde, 92, false);
  const [enObra, porProgramar, contratistas, permisos, proveedores] = await Promise.all([
    tickets(campus, 
      `COALESCE(c.f_inicio, c.f_fin, c.f_entrega) <= $2::date AND COALESCE(c.f_fin, c.f_entrega, c.f_inicio) >= $1::date`,
      [desde, hasta]
    ),
    tickets(campus, `c.estado IN ('Ingresado a PS', 'Por Ejecutar') AND c.f_inicio IS NULL AND c.f_fin IS NULL`),
    registros<Contratista>(campus, "contratista"),
    registros<Permiso>(campus, "permiso"),
    sql`SELECT proveedor, COUNT(*)::int AS n, MAX(f_reg)::text AS ultimo FROM correctivos
        WHERE eliminado_en IS NULL AND campus = ${campus} AND proveedor IS NOT NULL AND BTRIM(proveedor) <> '' AND f_reg >= current_date - interval '2 years'
        GROUP BY proveedor ORDER BY COUNT(*) DESC LIMIT 400`,
  ]);
  const ids = new Set([...enObra, ...porProgramar].map((t) => t.id));
  return NextResponse.json(
    {
      data: {
        hoy, desde, hasta,
        enObra: enObra.filter((t) => rangoTrabajo(t)),
        porProgramar: porProgramar.slice(-200),
        contratistas,
        permisos: permisos.filter((p) => ids.has(p.datos.correctivo_id)),
        proveedores,
      },
    },
    { headers: sinCache }
  );
}

async function gastoDelAnio(campus: string, anio: number): Promise<GastoCuenta[]> {
  const ini = `${anio}-01-01`;
  const fin = `${anio + 1}-01-01`;
  return (await sql`
    SELECT COALESCE(NULLIF(BTRIM(cuenta), ''), 'Sin cuenta') AS cuenta,
           EXTRACT(MONTH FROM COALESCE(f_oc, f_reg))::int AS mes,
           COALESCE(SUM(monto) FILTER (WHERE estado <> 'Finalizado'), 0)::float AS comprometido,
           COALESCE(SUM(monto) FILTER (WHERE estado = 'Finalizado'), 0)::float AS ejecutado,
           COUNT(*)::int AS n
    FROM correctivos
    WHERE eliminado_en IS NULL AND campus = ${campus} AND monto IS NOT NULL
      AND COALESCE(f_oc, f_reg) >= ${ini}::date AND COALESCE(f_oc, f_reg) < ${fin}::date
    GROUP BY 1, 2 ORDER BY 1, 2
  `) as GastoCuenta[];
}

async function verPresupuesto(req: NextRequest, hoy: string, campus: string) {
  const anio = Number(req.nextUrl.searchParams.get("anio")) || Number(hoy.slice(0, 4));
  if (anio < 2000 || anio > 2100) return err("Año inválido");
  const [lineas, gasto, materiales, anios] = await Promise.all([
    registros<LineaPresupuesto>(campus, "presupuesto", "(datos->>'anio')::int = $2", [anio]),
    gastoDelAnio(campus, anio),
    sql`SELECT EXTRACT(MONTH FROM (creado_en AT TIME ZONE 'America/Lima'))::int AS mes, COUNT(*)::int AS n,
               COALESCE(SUM(total_sin_igv), 0)::float AS total
        FROM solicitudes_materiales
        WHERE campus = ${campus} AND EXTRACT(YEAR FROM (creado_en AT TIME ZONE 'America/Lima')) = ${anio} AND estado <> 'Anulada'
        GROUP BY 1 ORDER BY 1`.catch(() => []),
    sql`SELECT DISTINCT EXTRACT(YEAR FROM COALESCE(f_oc, f_reg))::int AS a FROM correctivos
        WHERE eliminado_en IS NULL AND campus = ${campus} AND COALESCE(f_oc, f_reg) IS NOT NULL ORDER BY 1 DESC LIMIT 10`,
  ]);
  return NextResponse.json(
    { data: { hoy, anio, lineas, gasto, materiales, anios: (anios as { a: number }[]).map((x) => x.a) } },
    { headers: sinCache }
  );
}

async function verInforme(req: NextRequest, hoy: string, campus: string): Promise<NextResponse> {
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(req.nextUrl.searchParams.get("mes") ?? "")
    ? req.nextUrl.searchParams.get("mes")!
    : hoy.slice(0, 7);
  const ini = `${mes}-01`;
  const fin = sumarMeses(ini, 1);
  const anio = Number(mes.slice(0, 4));
  const plazo = ESTADOS_CON_PLAZO.join("|");
  const [tot, porEstado, antiguos, porCuenta, provs, anual, pres, mats, gar, prev, reps, contr, enObra, inv, nota, sla] = await Promise.all([
    sql`SELECT
          COUNT(*) FILTER (WHERE f_reg >= ${ini}::date AND f_reg < ${fin}::date)::int AS creados,
          COUNT(*) FILTER (WHERE estado = 'Finalizado' AND f_fin >= ${ini}::date AND f_fin < ${fin}::date)::int AS finalizados,
          COUNT(*) FILTER (WHERE estado <> 'Finalizado')::int AS abiertos,
          COUNT(*) FILTER (WHERE estado = ANY(string_to_array(${plazo}, '|'))
                           AND COALESCE(estado_desde, f_reg::timestamptz, updated_at) < now() - make_interval(days => ${DIAS_ATRASO}::int))::int AS atrasados
        FROM correctivos WHERE eliminado_en IS NULL AND campus = ${campus}`,
    sql`SELECT estado, COUNT(*)::int AS n FROM correctivos WHERE eliminado_en IS NULL AND campus = ${campus} AND estado <> 'Finalizado' GROUP BY estado ORDER BY 2 DESC`,
    sql`SELECT id, refer, LEFT(descripcion, 140) AS descripcion, estado, proveedor,
               (current_date - COALESCE(f_reg, created_at::date))::int AS dias
        FROM correctivos WHERE eliminado_en IS NULL AND campus = ${campus} AND estado <> 'Finalizado' ORDER BY dias DESC NULLS LAST LIMIT 10`,
    sql`SELECT COALESCE(NULLIF(BTRIM(cuenta), ''), 'Sin cuenta') AS cuenta, SUM(monto)::float AS monto FROM correctivos
        WHERE eliminado_en IS NULL AND campus = ${campus} AND monto IS NOT NULL AND COALESCE(f_oc, f_reg) >= ${ini}::date AND COALESCE(f_oc, f_reg) < ${fin}::date
        GROUP BY 1 ORDER BY 2 DESC`,
    sql`SELECT proveedor, SUM(monto)::float AS monto, COUNT(*)::int AS n FROM correctivos
        WHERE eliminado_en IS NULL AND campus = ${campus} AND monto IS NOT NULL AND proveedor IS NOT NULL
          AND COALESCE(f_oc, f_reg) >= ${ini}::date AND COALESCE(f_oc, f_reg) < ${fin}::date
        GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
    sql`SELECT COALESCE(SUM(monto), 0)::float AS monto FROM correctivos
        WHERE eliminado_en IS NULL AND campus = ${campus} AND COALESCE(f_oc, f_reg) >= ${`${anio}-01-01`}::date AND COALESCE(f_oc, f_reg) < ${fin}::date`,
    sql`SELECT COALESCE(SUM((datos->>'monto')::numeric), 0)::float AS monto FROM gestion_registros
        WHERE tipo = 'presupuesto' AND campus = ${campus} AND (datos->>'anio')::int = ${anio}`,
    sql`SELECT COUNT(*)::int AS n, COALESCE(SUM(total_sin_igv), 0)::float AS total FROM solicitudes_materiales
        WHERE campus = ${campus} AND (creado_en AT TIME ZONE 'America/Lima')::date >= ${ini}::date AND (creado_en AT TIME ZONE 'America/Lima')::date < ${fin}::date
          AND estado <> 'Anulada'`.catch(() => [{ n: 0, total: 0 }]),
    garantias(campus, hoy),
    registros<Preventivo>(campus, "preventivo"),
    registros<Reporte>(campus, "reporte", "creado_en >= now() - interval '2 years'"),
    registros<Contratista>(campus, "contratista"),
    tickets(campus, `COALESCE(c.f_inicio, c.f_fin, c.f_entrega) < $2::date AND COALESCE(c.f_fin, c.f_entrega, c.f_inicio) >= $1::date`, [ini, fin]),
    sql`SELECT datos FROM inventario_kpi_mensual WHERE campus = ${campus} AND mes <= ${mes} ORDER BY mes DESC LIMIT 1`,
    registros<{ mes: string; nota: string }>(campus, "informe_nota", "clave = $2", [mes]),
    // SLA cotización → OC (días hábiles) de las OC emitidas en el mes; y los que hoy esperan OC fuera de la meta.
    sql.query(
      `WITH t AS (
         SELECT CASE WHEN f_oc >= f_coti THEN ${SQL_DIAS_HABILES("f_coti", "f_oc")} END AS dias
         FROM correctivos
         WHERE eliminado_en IS NULL AND ${condCampus(campus)} AND f_coti IS NOT NULL AND f_oc >= $1::date AND f_oc < $2::date
       )
       SELECT COUNT(dias)::int AS n, ROUND(AVG(dias), 1)::float AS promedio, COUNT(*) FILTER (WHERE dias <= $3)::int AS en_meta,
              (SELECT COUNT(*)::int FROM correctivos
               WHERE eliminado_en IS NULL AND ${condCampus(campus)} AND f_coti IS NOT NULL AND f_oc IS NULL
                 AND COALESCE(BTRIM(n_oc), '') = '' AND COALESCE(estado, '') = ANY($4::text[])
                 AND ${SQL_DIAS_HABILES("f_coti", "(now() AT TIME ZONE 'America/Lima')::date")} > $3) AS fuera
       FROM t`,
      [ini, fin, SLA_COTI_OC_DIAS, ESTADOS_SIN_OC]
    ),
  ]);
  const t0 = tot[0] as { creados: number; finalizados: number; abiertos: number; atrasados: number };
  const vigentes = gar.todas.filter((g) => g.dias >= 0);
  const activos = prev.filter((p) => p.datos.activo !== false);
  const reportesMes = reps.filter((r) => toDateOnly((r as unknown as { creado_en: string }).creado_en) >= ini && toDateOnly((r as unknown as { creado_en: string }).creado_en) < fin);
  const porCat = new Map<string, number>();
  for (const r of reportesMes) porCat.set(r.datos.categoria, (porCat.get(r.datos.categoria) ?? 0) + 1);
  const docs = new Map(contr.map((c) => [claveTexto(c.datos.proveedor), c.datos]));
  const provMes = [...new Set(enObra.map((t) => t.proveedor).filter((p): p is string => !!p))];
  const informe: InformeMes = {
    mes,
    generado: new Date().toISOString(),
    tickets: { ...t0, porEstado: porEstado as { estado: string; n: number }[], antiguos: antiguos as InformeMes["tickets"]["antiguos"] },
    gasto: {
      mes: (porCuenta as { monto: number }[]).reduce((s, x) => s + (x.monto ?? 0), 0),
      anio: (anual[0] as { monto: number }).monto,
      presupuestoAnio: (pres[0] as { monto: number }).monto,
      porCuenta: porCuenta as { cuenta: string; monto: number }[],
      proveedores: provs as { proveedor: string; monto: number; n: number }[],
      materiales: (mats as { n: number; total: number }[])[0] ?? { n: 0, total: 0 },
    },
    sla: (() => {
      const x = (sla as unknown as { n: number; promedio: number | null; en_meta: number; fuera: number }[])[0];
      return { meta: SLA_COTI_OC_DIAS, n: x?.n ?? 0, promedio: x?.promedio ?? null, enMeta: x?.en_meta ?? 0, fuera: x?.fuera ?? 0 };
    })(),
    garantias: {
      vigentes: vigentes.length,
      porVencer: vigentes.filter((g) => g.dias <= 30).slice(0, 10).map((g) => ({ refer: g.t.refer, descripcion: g.t.descripcion.slice(0, 120), proveedor: g.t.proveedor, hasta: g.hasta })),
      posiblesReclamos: vigentes.filter((g) => g.posibles.length > 0).length,
    },
    preventivos: {
      total: activos.length,
      realizados: activos.flatMap((p) => p.datos.historial.filter((h) => h.fecha >= ini && h.fecha < fin).map((h) => ({ servicio: p.datos.servicio, fecha: h.fecha }))),
      vencidos: activos.filter((p) => semaforo(proximoPreventivo(p.datos), hoy) === "vencido" || !p.datos.ultimo).map((p) => ({ servicio: p.datos.servicio, proximo: proximoPreventivo(p.datos) })),
      proximos: activos
        .map((p) => ({ servicio: p.datos.servicio, proximo: proximoPreventivo(p.datos) }))
        .filter((p): p is { servicio: string; proximo: string } => !!p.proximo && semaforo(p.proximo, hoy) === "por_vencer"),
    },
    reportes: {
      recibidos: reportesMes.length,
      pendientes: reps.filter((r) => r.datos.estado === "Nuevo" || r.datos.estado === "En atención").length,
      porCategoria: [...porCat].map(([categoria, n]) => ({ categoria, n })).sort((a, b) => b.n - a.n),
    },
    contratistas: {
      conAlertas: provMes
        .map((p) => ({ proveedor: p, alertas: alertasContratista(docs.get(claveTexto(p)), hoy).filter((a) => a.grave).map((a) => a.texto) }))
        .filter((x) => x.alertas.length > 0),
    },
    inventario: ((inv[0] as { datos?: Record<string, number> } | undefined)?.datos) ?? null,
    nota: nota[0]?.datos.nota ?? "",
  };
  return NextResponse.json({ data: informe }, { headers: sinCache });
}

export async function GET(req: NextRequest, { params }: Params) {
  const { modulo } = await params;
  if (!MODULOS.includes(modulo)) return err("No encontrado", 404);
  const acceso = await exigirSesion();
  if (acceso.error) return acceso.error;
  try {
    await ensureSchema();
    const hoy = hoyLima();
    const campus = acceso.user.campus; // cada campus ve solo sus datos
    switch (modulo) {
      case "garantias":
        return await verGarantias(req, hoy, campus);
      case "agenda":
        return await verAgenda(req, hoy, campus);
      case "presupuesto":
        return await verPresupuesto(req, hoy, campus);
      case "preventivos":
        return NextResponse.json({ data: { hoy, preventivos: await registros<Preventivo>(campus, "preventivo") } }, { headers: sinCache });
      case "reportes": {
        const reps = await sql`
          SELECT r.id, r.datos, r.usuario, r.actualizado_en, r.creado_en,
                 (SELECT MIN(f.id) FROM materiales_fotos f WHERE f.clave = 'reporte:' || r.id) AS foto_id
          FROM gestion_registros r WHERE r.tipo = 'reporte' AND r.campus = ${campus} ORDER BY r.id DESC LIMIT 500`;
        return NextResponse.json({ data: { hoy, reportes: reps } }, { headers: sinCache });
      }
      default:
        return await verInforme(req, hoy, campus);
    }
  } catch (e) {
    console.error(e);
    return err("No se pudieron leer los datos", 500);
  }
}

// ───────── escritura ─────────

const texto = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
const fechaValida = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
};
/** Solo enlaces http(s): nada de "javascript:". */
const enlace = (v: unknown) => {
  const s = texto(v, 600);
  return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : "";
};
const entero = (v: unknown, min: number, max: number): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const monto = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v) * 100) / 100;
  return Number.isFinite(n) && n >= 0 && n <= 1e10 ? n : null;
};

type Validado = { clave: string | null; datos: Record<string, unknown> } | { error: string };

/** Valida los datos de cada tipo de registro y arma su clave única (si la tiene). */
function validar(tipo: string, d: Record<string, unknown>, previo: Record<string, unknown> | null): Validado {
  switch (tipo) {
    case "garantia": {
      const id = entero(d.correctivo_id, 1, 1e9);
      if (!id) return { error: "Falta el ticket" };
      const meses = d.meses === null || d.meses === "" || d.meses === undefined ? null : entero(d.meses, 1, 240);
      if (d.meses && meses === null) return { error: "Los meses de garantía deben ser un número entre 1 y 240" };
      const r = d.reclamo as Record<string, unknown> | null | undefined;
      const reclamo =
        r && (ESTADOS_RECLAMO as readonly string[]).includes(String(r.estado))
          ? { estado: String(r.estado), fecha: fechaValida(r.fecha) ?? hoyLima(), nota: texto(r.nota, 500) }
          : null;
      return { clave: String(id), datos: { correctivo_id: id, meses, nota: texto(d.nota, 500), reclamo } };
    }
    case "permiso": {
      const id = entero(d.correctivo_id, 1, 1e9);
      if (!id) return { error: "Falta el ticket" };
      const riesgos = Array.isArray(d.riesgos) ? d.riesgos.map(String).filter((x) => (RIESGOS as readonly string[]).includes(x)) : [];
      const estado = (ESTADOS_PERMISO as readonly string[]).includes(String(d.estado)) ? String(d.estado) : "Pendiente";
      return { clave: String(id), datos: { correctivo_id: id, riesgos: [...new Set(riesgos)], estado, numero: texto(d.numero, 60), nota: texto(d.nota, 500) } };
    }
    case "contratista": {
      const proveedor = texto(d.proveedor, 200);
      if (!proveedor) return { error: "Falta el nombre del contratista" };
      const documentos = (Array.isArray(d.documentos) ? d.documentos : []).slice(0, 30).map((x: Record<string, unknown>) => ({
        tipo: (DOCUMENTOS_CONTRATISTA as readonly string[]).includes(String(x?.tipo)) ? String(x.tipo) : texto(x?.tipo, 80) || "Otro",
        vence: fechaValida(x?.vence),
        enlace: enlace(x?.enlace),
      }));
      const personal = (Array.isArray(d.personal) ? d.personal : []).slice(0, 200)
        .map((x: Record<string, unknown>) => ({ nombre: texto(x?.nombre, 120), cargo: texto(x?.cargo, 80) }))
        .filter((x) => x.nombre);
      return { clave: claveTexto(proveedor), datos: { proveedor, documentos, personal, contacto: texto(d.contacto, 200), notas: texto(d.notas, 1000) } };
    }
    case "presupuesto": {
      const anio = entero(d.anio, 2000, 2100);
      const cuenta = texto(d.cuenta, 120);
      const m = monto(d.monto);
      if (!anio || !cuenta || m === null) return { error: "Indica el año, la cuenta y un monto válido" };
      return { clave: `${anio}|${claveTexto(cuenta)}`, datos: { anio, cuenta, monto: m, nota: texto(d.nota, 300) } };
    }
    case "preventivo": {
      const servicio = texto(d.servicio, 200);
      const frecuencia = entero(d.frecuencia_meses, 1, 120);
      if (!servicio || !frecuencia) return { error: "Indica el servicio y su frecuencia en meses (1 a 120)" };
      return {
        clave: null,
        datos: {
          servicio, categoria: texto(d.categoria, 80) || "Otro", proveedor: texto(d.proveedor, 200), frecuencia_meses: frecuencia,
          ultimo: fechaValida(d.ultimo), ubicacion: texto(d.ubicacion, 200), itse: d.itse === true, contrato: texto(d.contrato, 80),
          monto: monto(d.monto), enlace: enlace(d.enlace), notas: texto(d.notas, 1000), activo: d.activo !== false,
          // El historial solo crece con "Registrar realizado": no se reemplaza desde el formulario.
          historial: Array.isArray(previo?.historial) ? previo!.historial : [],
        },
      };
    }
    case "reporte": {
      if (!previo) return { error: "Los reportes llegan solo desde el formulario público" };
      const estado = (ESTADOS_REPORTE as readonly string[]).includes(String(d.estado)) ? String(d.estado) : String(previo.estado);
      return { clave: null, datos: { ...previo, estado, nota: texto(d.nota, 1000), ticket_texto: texto(d.ticket_texto, 50) } };
    }
    case "informe_nota": {
      const mes = String(d.mes ?? "");
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return { error: "Mes inválido" };
      return { clave: mes, datos: { mes, nota: texto(d.nota, 4000) } };
    }
  }
  return { error: "Tipo de registro desconocido" };
}

/** Firma corta del lugar del QR: un reporte con firma válida vino de un QR impreso por la app. */
function firma(lugar: string, campus: string): string {
  // El campus va en la firma: un QR de un campus no puede hacerse pasar por otro.
  const texto = campus === CAMPUS_PRINCIPAL ? `reporte|${lugar}` : `reporte|${campus}|${lugar}`;
  return createHmac("sha256", process.env.SESSION_SECRET ?? "sin-secreto").update(texto).digest("base64url").slice(0, 16);
}

const MAX_FOTO = 4 * 1024 * 1024;
function tipoImagen(b: Buffer): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Reporte público (sin sesión): lo envía el formulario de /reportar. */
async function recibirReporte(req: NextRequest): Promise<NextResponse> {
  const form = await req.formData().catch(() => null);
  if (!form) return err("Formulario inválido");
  // Campo trampa (invisible para personas) y tiempo mínimo de llenado: frena robots sin molestar a nadie.
  const iniciado = Number(form.get("t"));
  if (texto(form.get("web"), 50) || !Number.isFinite(iniciado) || Date.now() - iniciado < 3000) {
    return NextResponse.json({ ok: true }); // se responde "ok" para no darle pistas al robot
  }
  const lugar = texto(form.get("lugar"), LIMITES_REPORTE.lugar);
  const descripcion = texto(form.get("descripcion"), LIMITES_REPORTE.descripcion);
  const categoria = (CATEGORIAS_REPORTE as readonly string[]).includes(String(form.get("categoria"))) ? String(form.get("categoria")) : "Otro";
  if (lugar.length < 2 || descripcion.length < 5) return err("Indica el lugar y describe brevemente el problema");
  // Campus del QR (?c=); sin él, el principal. Uno desconocido se rechaza.
  const c = String(form.get("c") ?? "") || CAMPUS_PRINCIPAL;
  if (!esCampus(c)) return err("Campus desconocido");
  const ip = ipDe(req);
  const claveIp = `rep:${createHash("sha256").update(ip).digest("hex").slice(0, 24)}`;
  await ensureSchema();
  // Hasta 6 reportes cada 15 minutos por conexión y 80 en total; y no más de 300 sin revisar.
  if ((await bloqueado(claveIp, 6)) || (await bloqueado("rep:todos", 80))) {
    return err("Se recibieron muchos reportes seguidos. Intenta de nuevo en unos minutos.", 429);
  }
  const [{ n }] = (await sql`SELECT COUNT(*)::int AS n FROM gestion_registros WHERE tipo = 'reporte' AND campus = ${c} AND datos->>'estado' = 'Nuevo'`) as { n: number }[];
  if (n >= 300) return err("La bandeja de reportes está llena. Avisa al personal de mantenimiento.", 503);
  await Promise.all([registrarFallo(claveIp), registrarFallo("rep:todos")]);

  let foto: { buf: Buffer; tipo: string; nombre: string } | null = null;
  const archivo = form.get("foto");
  if (archivo instanceof File && archivo.size > 0) {
    if (archivo.size > MAX_FOTO) return err("La foto pesa más de 4 MB");
    const buf = Buffer.from(await archivo.arrayBuffer());
    const tipo = tipoImagen(buf);
    if (!tipo) return err("La foto debe ser JPG, PNG o WEBP");
    foto = { buf, tipo, nombre: `reporte.${tipo.split("/")[1]}` };
  }
  const datos: Reporte = {
    lugar, categoria, descripcion, contacto: texto(form.get("contacto"), LIMITES_REPORTE.contacto),
    qr: firma(lugar, c) === String(form.get("s") ?? ""), estado: "Nuevo", foto: !!foto,
  };
  const [fila] = (await sql`
    INSERT INTO gestion_registros (tipo, campus, datos, usuario) VALUES ('reporte', ${c}, ${JSON.stringify(datos)}::jsonb, NULL) RETURNING id
  `) as { id: number }[];
  if (foto) {
    const enBlob = await guardarEnBlob(foto.nombre, foto.tipo, foto.buf);
    await sql`
      INSERT INTO materiales_fotos (clave, nombre, tipo, tamano, data, blob_path, blob_url, subido_por)
      VALUES (${`reporte:${fila.id}`}, ${foto.nombre}, ${foto.tipo}, ${foto.buf.length},
              CASE WHEN ${!!enBlob}::boolean THEN NULL ELSE decode(${enBlob ? "" : foto.buf.toString("base64")}::text, 'base64') END,
              ${enBlob?.path ?? null}, ${enBlob?.url ?? null}, 'reporte público')
    `;
  }
  return NextResponse.json({ ok: true, numero: fila.id });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { modulo } = await params;
  try {
    if (modulo === "reportar") return await recibirReporte(req);
    if (!MODULOS.includes(modulo)) return err("No encontrado", 404);
    const acceso = await exigirAdmin();
    if (acceso.error) return acceso.error;
    await ensureSchema();
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return err("Solicitud inválida");
    const accion = req.nextUrl.searchParams.get("accion");
    const usuario = acceso.user.username;
    const campus = acceso.user.campus; // todo se escribe en el campus elegido

    if (modulo === "reportes" && accion === "qr") {
      const lugares = (Array.isArray(body.lugares) ? body.lugares : []).map((x) => texto(x, LIMITES_REPORTE.lugar)).filter((x) => x.length >= 2).slice(0, 500);
      return NextResponse.json({ data: [...new Set(lugares)].map((lugar) => ({ lugar, s: firma(lugar, campus), c: campus })) });
    }

    if (modulo === "preventivos" && accion === "realizado") {
      const id = entero(body.id, 1, 1e9);
      const f = fechaValida(body.fecha);
      if (!id || !f) return err("Indica el servicio y la fecha en que se hizo");
      if (f > hoyLima()) return err("La fecha no puede ser futura");
      const entrada = { fecha: f, nota: texto(body.nota, 500), enlace: enlace(body.enlace), usuario };
      // Una sola sentencia: agrega al historial y mueve "último" solo si esta fecha es más reciente.
      const filas = (await sql`
        UPDATE gestion_registros
        SET datos = jsonb_set(
                      jsonb_set(datos, '{historial}', COALESCE(datos->'historial', '[]'::jsonb) || ${JSON.stringify(entrada)}::jsonb),
                      '{ultimo}',
                      to_jsonb(GREATEST(COALESCE(NULLIF(datos->>'ultimo', ''), ${f}), ${f}))),
            usuario = ${usuario}, actualizado_en = now()
        WHERE id = ${id} AND tipo = 'preventivo' AND campus = ${campus}
        RETURNING id, datos, usuario, actualizado_en
      `) as Registro<Preventivo>[];
      if (!filas[0]) return err("No existe ese servicio", 404);
      return NextResponse.json({ data: filas[0] });
    }

    const tipo = String(body.tipo ?? "");
    if (!TIPOS[modulo].includes(tipo)) return err("Este registro no corresponde a esta página");
    const id = body.id === undefined || body.id === null ? null : entero(body.id, 1, 1e9);
    const entrada = body.datos && typeof body.datos === "object" ? (body.datos as Record<string, unknown>) : {};
    let previo: Record<string, unknown> | null = null;
    if (id) {
      const p = (await sql`SELECT datos FROM gestion_registros WHERE id = ${id} AND tipo = ${tipo} AND campus = ${campus}`) as { datos: Record<string, unknown> }[];
      if (!p[0]) return err("Ese registro ya no existe", 404);
      previo = p[0].datos;
    }
    const v = validar(tipo, entrada, previo);
    if ("error" in v) return err(v.error);
    if (tipo === "reporte" && v.datos.ticket_texto) {
      // "Enlazar a ticket": por N° Ref. o N° de ticket.
      const t = String(v.datos.ticket_texto);
      const enc = (await sql`
        SELECT id FROM correctivos WHERE eliminado_en IS NULL AND campus = ${campus} AND (refer::text = ${t} OR LOWER(BTRIM(ticket)) = LOWER(${t})) LIMIT 1
      `) as { id: number }[];
      if (!enc[0]) return err(`No hay ningún ticket con N° Ref. o ticket "${t}"`);
      v.datos.ticket_id = enc[0].id;
    } else if (tipo === "reporte") v.datos.ticket_id = null;
    const json = JSON.stringify(v.datos);
    let filas: Registro<unknown>[];
    if (id) {
      filas = (await sql`
        UPDATE gestion_registros SET datos = ${json}::jsonb, clave = ${v.clave}, usuario = ${usuario}, actualizado_en = now()
        WHERE id = ${id} AND tipo = ${tipo} AND campus = ${campus} RETURNING id, datos, usuario, actualizado_en
      `) as Registro<unknown>[];
    } else if (v.clave !== null) {
      filas = (await sql`
        INSERT INTO gestion_registros (tipo, campus, clave, datos, usuario) VALUES (${tipo}, ${campus}, ${v.clave}, ${json}::jsonb, ${usuario})
        ON CONFLICT (campus, tipo, clave) WHERE clave IS NOT NULL
        DO UPDATE SET datos = EXCLUDED.datos, usuario = EXCLUDED.usuario, actualizado_en = now()
        RETURNING id, datos, usuario, actualizado_en
      `) as Registro<unknown>[];
    } else {
      filas = (await sql`
        INSERT INTO gestion_registros (tipo, campus, datos, usuario) VALUES (${tipo}, ${campus}, ${json}::jsonb, ${usuario})
        RETURNING id, datos, usuario, actualizado_en
      `) as Registro<unknown>[];
    }
    return NextResponse.json({ data: filas[0] });
  } catch (e) {
    console.error(e);
    if (e && typeof e === "object" && (e as { code?: string }).code === "23505") {
      return err("Ya existe un registro con ese nombre (proveedor, cuenta o mes)", 409);
    }
    return err("No se pudo guardar", 500);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { modulo } = await params;
  if (!MODULOS.includes(modulo)) return err("No encontrado", 404);
  const acceso = await exigirAdmin();
  if (acceso.error) return acceso.error;
  const id = entero(req.nextUrl.searchParams.get("id"), 1, 1e9);
  if (!id) return err("Registro inválido");
  try {
    await ensureSchema();
    const filas = (await sql`DELETE FROM gestion_registros WHERE id = ${id} AND campus = ${acceso.user.campus} AND tipo = ANY(${TIPOS[modulo]}::text[]) RETURNING id, tipo`) as { id: number; tipo: string }[];
    if (!filas[0]) return err("Ese registro ya no existe", 404);
    if (filas[0].tipo === "reporte") {
      const fotos = (await sql`DELETE FROM materiales_fotos WHERE clave = ${`reporte:${id}`} RETURNING blob_url`) as { blob_url: string | null }[];
      await borrarDeBlob(fotos.map((f) => f.blob_url));
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return err("No se pudo borrar", 500);
  }
}
