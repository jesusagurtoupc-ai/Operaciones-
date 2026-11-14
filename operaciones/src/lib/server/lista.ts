// Consulta de la lista de correctivos. La usan la API (/api/correctivos) y la página del servidor
// (/correctivos), que así entrega la primera página ya con datos en vez de pedirlos después.
import { after } from "next/server";
import { sql, ensureSchema, purgarPapelera } from "./db";
import { trasladarABlob, usaBlob } from "./almacen";
import { actualizarDesdeOCs, unificarProveedores } from "./proveedores";
import { buildOrderBy, buildWhere, buildFacetasQuery, armarFacetas } from "./utils";
import { normalizeCorrectivos, ESTADOS_CON_PLAZO, DIAS_ATRASO } from "@/lib/shared";
import { PREFIJO_REF_SQL } from "@/lib/materiales";

/** Number(...) con parámetros de query inválidos (vacío, texto, etc.)
 * produce NaN, que si se interpola directo en el SQL (como en
 * LIMIT/OFFSET) genera un 500 en vez de simplemente usar un valor por
 * defecto razonable. */
function parsePositiveInt(raw: string | null, fallback: number, max?: number) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  const int = Math.floor(n);
  return max ? Math.min(int, max) : int;
}

// Columnas que usa la lista (se omiten las que la app no muestra ni edita).
// De las condiciones de la cotización la lista solo usa el N° y la validez (aviso "cotización por
// vencer"): las partidas (hasta 30 por ticket) se quedan en la base y la respuesta pesa mucho menos.
const COLUMNAS_LISTA = `id, refer, ticket, f_reg, descripcion, lugar, estado, proveedor, monto,
  f_coti, f_oc, f_inicio, f_fin, cuenta, tipo_trab, sub_tipo_trab, n_oc, area,
  ruc_proveedor, f_entrega, contrato, documentos,
  CASE WHEN condiciones IS NULL THEN NULL
       ELSE jsonb_build_object('numero', condiciones->'numero', 'validez_dias', condiciones->'validez_dias') END AS condiciones,
  estado_desde, created_at, updated_at, eliminado_en, eliminado_por`;

/** Misma forma que devuelve GET /api/correctivos. */
export async function consultarLista(
  searchParams: URLSearchParams,
  { papelera }: { papelera: boolean }
): Promise<Record<string, unknown>> {
  await ensureSchema(); // asegura las columnas nuevas antes de consultar
  // Vaciado de la papelera (más de 30 días; máx. 1 vez por hora): se hace DESPUÉS de responder, para que
  // la persona no espere esa consulta extra al cargar la lista.
  // Y, si hay Vercel Blob conectado, el traslado de los adjuntos antiguos de la base a Blob (de a poco).
  const fondo = async () => {
    await purgarPapelera();
    await trasladarABlob();
    // Proveedores: los tickets antiguos (o editados a mano) pasan al nombre oficial de su empresa.
    // Como mucho una vez cada 5 minutos por instancia; si no hay nada pendiente es una sola consulta.
    const g = globalThis as typeof globalThis & { __unificarProv?: number };
    if (!g.__unificarProv || Date.now() - g.__unificarProv > 5 * 60_000) {
      g.__unificarProv = Date.now();
      await unificarProveedores().catch((e) => console.error("[proveedores] unificación", e));
      // Y los que aún no pasaron por una OC toman los datos de la OC guardada en sus tickets (5 por vez).
      await actualizarDesdeOCs(5).catch((e) => console.error("[proveedores] revisión con OC", e));
    }
    await automatizar();
  };
  try {
    after(fondo);
  } catch {
    void fondo();
  }
  const { where, values } = buildWhere(searchParams, undefined, { papelera });

  const page = parsePositiveInt(searchParams.get("page"), 1);
  const pageSize = parsePositiveInt(searchParams.get("pageSize"), 25, 200);
  const offset = (page - 1) * pageSize;

  const query = `
      SELECT ${COLUMNAS_LISTA} FROM correctivos
      ${where}
      ORDER BY ${papelera ? "eliminado_en DESC, id DESC" : buildOrderBy(searchParams.get("orden"))}
      LIMIT ${pageSize} OFFSET ${offset}
    `;
  // Al cambiar de página los filtros no cambian: el cliente pide
  // `facetas=0` y se ahorran las 7 consultas de conteos.
  if (searchParams.get("facetas") === "0") {
    const [rows, totalRows] = await Promise.all([
      sql.query(query, values),
      sql.query(`SELECT COUNT(*)::int AS total FROM correctivos ${where}`, values),
    ]);
    const total = (totalRows as unknown as { total: number }[])[0]?.total ?? 0;
    return {
      data: normalizeCorrectivos(rows as Record<string, unknown>[]),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  // Conteos por categoría para las tarjetas de filtro (cada una aplica TODOS los demás filtros
  // menos el suyo), resumen y documentos pendientes: una sola consulta, en paralelo con las filas.
  const fq = buildFacetasQuery(searchParams, { papelera });
  const [rows, facetaRows] = await Promise.all([
    sql.query(query, values),
    sql.query(fq.text, fq.values),
  ]);
  const { resumen, facetas } = armarFacetas(facetaRows as Record<string, unknown>[]);
  const total = resumen.total;

  return {
    data: normalizeCorrectivos(rows as Record<string, unknown>[]),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    resumen: { total, monto: resumen.monto },
    facetas,
  };
}

/* ───────── Panel General (lo usan /api/dashboard y la página /dashboard) ───────── */

type FilaPanel = {
  g: number;
  estado: string | null; tipo_trab: string | null; area: string | null; lugar: string | null;
  mes: string | null; proveedor: string | null;
  cantidad: number; monto: number; finalizados: number; pendientes: number; atrasados: number;
};
type Barra = { label: string; cantidad: number; monto: number };

// GROUPING(...) vale 1 en el bit de cada columna que NO se agrupa (la primera columna es el bit más alto):
// con esto se sabe a cuál de los 7 grupos pertenece cada fila.
const GRUPO = { estado: 31, tipo: 47, area: 55, lugar: 59, mes: 61, proveedor: 62, total: 63 } as const;

/** Reparte las filas de la consulta única en las mismas listas que devolvían las 7 consultas de antes. */
function armarPanel(filas: FilaPanel[]) {
  const o = {
    porEstado: [] as Barra[], porTipo: [] as Barra[], porArea: [] as Barra[], porLugar: [] as Barra[],
    porMes: [] as Barra[], porProveedor: [] as Barra[],
    totales: { total_tickets: 0, monto_total: 0, finalizados: 0, pendientes: 0, atrasados: 0 },
  };
  for (const r of filas) {
    const b = { cantidad: r.cantidad, monto: r.monto };
    switch (r.g) {
      case GRUPO.estado: o.porEstado.push({ label: r.estado ?? "Sin estado", ...b }); break;
      case GRUPO.tipo: o.porTipo.push({ label: r.tipo_trab ?? "Sin tipo", ...b }); break;
      case GRUPO.area: o.porArea.push({ label: r.area ?? "Sin área", ...b }); break;
      case GRUPO.lugar: o.porLugar.push({ label: r.lugar ?? "Sin lugar", ...b }); break;
      case GRUPO.mes: if (r.mes !== null) o.porMes.push({ label: r.mes, ...b }); break;
      case GRUPO.proveedor:
        if (r.proveedor !== null && r.proveedor !== "") o.porProveedor.push({ label: r.proveedor, ...b });
        break;
      case GRUPO.total:
        o.totales = {
          total_tickets: r.cantidad, monto_total: r.monto,
          finalizados: r.finalizados, pendientes: r.pendientes, atrasados: r.atrasados,
        };
        break;
    }
  }
  const porCantidad = (a: Barra, b: Barra) => b.cantidad - a.cantidad;
  const porMonto = (a: Barra, b: Barra) => b.monto - a.monto;
  o.porEstado.sort(porCantidad);
  o.porLugar.sort(porCantidad);
  o.porTipo.sort(porMonto);
  o.porArea.sort(porMonto);
  o.porMes.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  o.porProveedor.sort(porMonto);
  o.porProveedor = o.porProveedor.slice(0, 8);
  return o;
}

/**
 * Todo el panel. La consulta del panel y la del espacio usado (solo administradores) van a la vez:
 * antes la segunda esperaba a la primera.
 */
export async function calcularPanel(esAdmin: boolean) {
  await ensureSchema(); // asegura la columna estado_desde
  // UNA sola consulta (una sola lectura de la tabla) calcula todo el panel con GROUPING SETS: antes eran 7
  // consultas que leían la tabla completa cada una (con 20 000 tickets: ~85 ms → ~35 ms).
  const panelP = sql`
      SELECT GROUPING(estado, tipo_trab, area, lugar, mes, proveedor)::int AS g,
             estado, tipo_trab, area, lugar, mes, proveedor,
             COUNT(*)::int AS cantidad,
             COALESCE(SUM(monto), 0)::float AS monto,
             COUNT(*) FILTER (WHERE estado = 'Finalizado')::int AS finalizados,
             COUNT(*) FILTER (WHERE estado != 'Finalizado')::int AS pendientes,
             COUNT(*) FILTER (WHERE atrasado)::int AS atrasados
      FROM (
        SELECT estado, tipo_trab, area, lugar, proveedor, TO_CHAR(f_reg, 'YYYY-MM') AS mes, monto,
               (estado = ANY(string_to_array(${ESTADOS_CON_PLAZO.join("|")}, '|'))
                AND COALESCE(estado_desde, f_reg::timestamptz, updated_at)
                    < now() - make_interval(days => ${DIAS_ATRASO}::int)) AS atrasado
        FROM correctivos
        WHERE eliminado_en IS NULL
      ) c
      GROUP BY GROUPING SETS ((estado), (tipo_trab), (area), (lugar), (mes), (proveedor), ())
    `;
  // Espacio usado (solo administradores): los adjuntos se guardan dentro de la base de datos, así que
  // con el tiempo pueden llenar el plan. El límite se configura con LIMITE_BASE_MB (por defecto
  // 512 MB, el del plan gratuito de Neon).
  const espacioP = esAdmin
    ? sql`
        SELECT pg_database_size(current_database())::float AS base,
               (SELECT COALESCE(SUM(tamano) FILTER (WHERE blob_path IS NULL), 0)::float FROM archivos) AS arch,
               (SELECT COUNT(*) FILTER (WHERE blob_path IS NULL)::int FROM archivos) AS n,
               (SELECT COALESCE(SUM(tamano) FILTER (WHERE blob_path IS NOT NULL), 0)::float FROM archivos) AS blob,
               (SELECT COUNT(*) FILTER (WHERE blob_path IS NOT NULL)::int FROM archivos) AS nb
      `.catch((err: unknown) => {
        console.warn("No se pudo medir el espacio de la base de datos", err);
        return null;
      })
    : Promise.resolve(null);
  const [filas, espacio, proveedores, materiales] = await Promise.all([
    panelP,
    espacioP,
    enMemoria("panelProveedores", calcularPanelProveedores),
    enMemoria("panelMateriales", calcularPanelMateriales),
  ]);
  const { porEstado, porTipo, porArea, porLugar, porMes, porProveedor, totales } = armarPanel(filas as FilaPanel[]);

  let almacenamiento = null;
  const e = (espacio as { base: number; arch: number; n: number; blob: number; nb: number }[] | null)?.[0];
  if (e) {
    const limiteMb = Number(process.env.LIMITE_BASE_MB) > 0 ? Number(process.env.LIMITE_BASE_MB) : 512;
    almacenamiento = {
      baseBytes: e.base, archivosBytes: e.arch, archivos: e.n, limiteBytes: limiteMb * 1024 * 1024,
      blobBytes: e.blob, archivosBlob: e.nb, blobConectado: usaBlob(),
    };
  }
  return { porEstado, porTipo, porArea, porLugar, porMes, porProveedor, totales, almacenamiento, proveedores, materiales };
}

/**
 * Automatizaciones (como mucho cada 30 min por instancia, después de responder la lista):
 *  1. Estado por fechas: un ticket "Por Ejecutar" cuya fecha de fin del trabajo (o, si no tiene, la de
 *     entrega de la OC) ya pasó y aún no tiene informe pasa a "Esperando Informe". Si sigue así más de
 *     DIAS_ATRASO días, la lista ya lo marca como atrasado.
 *  2. Solicitudes de materiales: una solicitud Enviada o Aprobada cuyos materiales tienen todos un
 *     ticket, y todos esos tickets están Finalizados, pasa sola a "Atendida".
 * Cada cambio queda en el historial (del ticket) o con "sistema" como autor (de la solicitud).
 */
const gAuto = globalThis as typeof globalThis & { __automatizado?: number; __correctivosAvisos?: unknown };
export async function automatizar(forzar = false): Promise<{ tickets: number; solicitudes: number }> {
  if (!forzar && gAuto.__automatizado && Date.now() - gAuto.__automatizado < 30 * 60_000) return { tickets: 0, solicitudes: 0 };
  gAuto.__automatizado = Date.now();
  let tickets = 0;
  let solicitudes = 0;
  try {
    const t = (await sql`
      WITH c AS (
        UPDATE correctivos
        SET estado = 'Esperando Informe', estado_desde = now()
        WHERE eliminado_en IS NULL AND estado = 'Por Ejecutar'
          AND COALESCE(f_fin, f_entrega) < (now() AT TIME ZONE 'America/Lima')::date
          AND COALESCE(documentos->'informe'->>'url', '') = ''
        RETURNING id, f_fin IS NOT NULL AS por_fin, COALESCE(f_fin, f_entrega) AS f
      ),
      h AS (
        INSERT INTO historial (correctivo_id, usuario, detalle)
        SELECT id, 'sistema',
               format('Estado: Por Ejecutar → Esperando Informe (automático: pasó la fecha de %s, %s)',
                      CASE WHEN por_fin THEN 'fin del trabajo' ELSE 'entrega de la OC' END, to_char(f, 'DD/MM/YYYY'))
        FROM c
      )
      SELECT COUNT(*)::int AS n FROM c
    `) as { n: number }[];
    tickets = t[0]?.n ?? 0;
    if (tickets > 0) gAuto.__correctivosAvisos = undefined; // las notificaciones se recalculan
  } catch (err) {
    console.error("[automático] estados por fecha", err);
  }
  try {
    const s2 = (await sql`
      WITH l AS (
        SELECT s.numero, regexp_replace(LOWER(BTRIM(COALESCE(e.value->>'ticket', ''))), '\s+', ' ', 'g') AS tk
        FROM solicitudes_materiales s CROSS JOIN LATERAL jsonb_array_elements(s.lineas) e
        WHERE s.estado IN ('Enviada', 'Aprobada')
      ),
      m AS (
        SELECT l.numero,
               (SELECT c.estado FROM correctivos c
                WHERE l.tk <> '' AND c.eliminado_en IS NULL
                  AND (regexp_replace(LOWER(BTRIM(COALESCE(c.ticket, ''))), '\s+', ' ', 'g') = l.tk
                       OR c.refer = CASE WHEN regexp_replace(l.tk, ${PREFIJO_REF_SQL}, '') ~ '^[0-9]{1,9}$'
                                         THEN regexp_replace(l.tk, ${PREFIJO_REF_SQL}, '')::int END)
                ORDER BY (c.estado = 'Finalizado') ASC
                LIMIT 1) AS est
        FROM l
      ),
      listas AS (
        SELECT numero FROM m GROUP BY numero HAVING bool_and(COALESCE(est = 'Finalizado', false))
      ),
      u AS (
        UPDATE solicitudes_materiales s
        SET estado = 'Atendida', estado_por = 'sistema', estado_en = now()
        FROM listas WHERE s.numero = listas.numero AND s.estado IN ('Enviada', 'Aprobada')
        RETURNING s.numero
      )
      SELECT COUNT(*)::int AS n FROM u
    `) as { n: number }[];
    solicitudes = s2[0]?.n ?? 0;
  } catch (err) {
    console.error("[automático] solicitudes atendidas", err);
  }
  return { tickets, solicitudes };
}

/**
 * Los paneles de proveedores y materiales cambian poco: se reutiliza el resultado 3 minutos por instancia
 * (menos consultas a la base, y el Panel responde más rápido). Un fallo (null) no se guarda.
 */
const memoria = globalThis as typeof globalThis & { __panelMemo?: Map<string, { t: number; v: unknown }> };
async function enMemoria<T>(clave: string, calcular: () => Promise<T>): Promise<T> {
  const m = (memoria.__panelMemo ??= new Map());
  const g = m.get(clave);
  if (g && Date.now() - g.t < 3 * 60_000) return g.v as T;
  const v = await calcular();
  if (v !== null) m.set(clave, { t: Date.now(), v });
  return v;
}

const anioLima = () => Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric" }).format(new Date()));

/**
 * Panel de proveedores: por empresa (nombres ya unificados en el registro), cuánto se le compró este año
 * (tickets con OC de este año), cuántos tickets tiene abiertos y cuánto tarda en promedio desde la OC
 * hasta el fin del trabajo (fecha del informe). Nunca falla: ante un error devuelve null.
 */
export async function calcularPanelProveedores() {
  const anio = anioLima();
  try {
    const filas = (await sql`
      SELECT proveedor,
             MAX(NULLIF(BTRIM(ruc_proveedor), '')) AS ruc,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM f_oc) = ${anio})::int AS tickets_anio,
             COALESCE(SUM(monto) FILTER (WHERE EXTRACT(YEAR FROM f_oc) = ${anio}), 0)::float AS monto_anio,
             COALESCE(SUM(monto), 0)::float AS monto_total,
             COUNT(*) FILTER (WHERE estado IS DISTINCT FROM 'Finalizado')::int AS abiertos,
             ROUND(AVG(f_fin - f_oc) FILTER (WHERE f_fin IS NOT NULL AND f_oc IS NOT NULL AND f_fin >= f_oc), 1)::float AS dias_prom,
             MAX(f_fin - f_oc) FILTER (WHERE f_fin IS NOT NULL AND f_oc IS NOT NULL AND f_fin >= f_oc)::int AS dias_max,
             COUNT(*) FILTER (WHERE f_fin IS NOT NULL AND f_oc IS NOT NULL AND f_fin >= f_oc)::int AS con_plazo
      FROM correctivos
      WHERE eliminado_en IS NULL AND COALESCE(BTRIM(proveedor), '') <> ''
      GROUP BY proveedor
      ORDER BY monto_anio DESC, monto_total DESC, proveedor
      LIMIT 60
    `) as {
      proveedor: string; ruc: string | null; total: number; tickets_anio: number; monto_anio: number; monto_total: number;
      abiertos: number; dias_prom: number | null; dias_max: number | null; con_plazo: number;
    }[];
    return { anio, filas };
  } catch (err) {
    console.error("[panel] proveedores", err);
    return null;
  }
}

/**
 * Panel de materiales (de las solicitudes registradas, sin las anuladas): gasto del año y por mes, los
 * materiales más pedidos, gasto por lugar (según el ticket de cada material) y catálogo vs fuera del
 * catálogo. Importes sin IGV; los materiales sin precio no suman. Nunca falla: ante un error, null.
 */
export async function calcularPanelMateriales() {
  const anio = anioLima();
  try {
    const [tot, meses, top, lugares] = await Promise.all([
      sql`
        WITH l AS (
          SELECT s.numero, EXTRACT(YEAR FROM s.creado_en AT TIME ZONE 'America/Lima')::int AS anio,
                 COALESCE((e.value->>'precio')::numeric, 0) * COALESCE((e.value->>'cantidad')::numeric, 0) AS costo,
                 (e.value->>'precio') IS NULL AS sin_precio, COALESCE(e.value->>'codigo', '') <> '' AS de_catalogo
          FROM solicitudes_materiales s CROSS JOIN LATERAL jsonb_array_elements(s.lineas) e
          WHERE s.estado <> 'Anulada'
        )
        SELECT COUNT(DISTINCT numero) FILTER (WHERE anio = ${anio})::int AS solicitudes,
               COALESCE(SUM(costo) FILTER (WHERE anio = ${anio}), 0)::float AS gasto,
               COALESCE(SUM(costo) FILTER (WHERE anio = ${anio} AND de_catalogo), 0)::float AS gasto_catalogo,
               COALESCE(SUM(costo) FILTER (WHERE anio = ${anio} AND NOT de_catalogo), 0)::float AS gasto_fuera,
               COUNT(*) FILTER (WHERE anio = ${anio})::int AS lineas,
               COUNT(*) FILTER (WHERE anio = ${anio} AND NOT de_catalogo)::int AS lineas_fuera,
               COUNT(*) FILTER (WHERE anio = ${anio} AND sin_precio)::int AS sin_precio
        FROM l
      `,
      sql`
        SELECT to_char(s.creado_en AT TIME ZONE 'America/Lima', 'YYYY-MM') AS mes,
               COUNT(DISTINCT s.numero)::int AS solicitudes,
               COALESCE(SUM(COALESCE((e.value->>'precio')::numeric, 0) * COALESCE((e.value->>'cantidad')::numeric, 0)), 0)::float AS gasto
        FROM solicitudes_materiales s CROSS JOIN LATERAL jsonb_array_elements(s.lineas) e
        WHERE s.estado <> 'Anulada' AND s.creado_en >= date_trunc('month', now() AT TIME ZONE 'America/Lima') - interval '11 months'
        GROUP BY 1 ORDER BY 1
      `,
      sql`
        SELECT MAX(e.value->>'descripcion') AS descripcion,
               NULLIF(MAX(COALESCE(e.value->>'codigo', '')), '') AS codigo,
               MAX(COALESCE(e.value->>'unidad', '')) AS unidad,
               COUNT(DISTINCT s.numero)::int AS veces,
               COALESCE(SUM((e.value->>'cantidad')::numeric), 0)::float AS cantidad,
               COALESCE(SUM(COALESCE((e.value->>'precio')::numeric, 0) * COALESCE((e.value->>'cantidad')::numeric, 0)), 0)::float AS gasto
        FROM solicitudes_materiales s CROSS JOIN LATERAL jsonb_array_elements(s.lineas) e
        WHERE s.estado <> 'Anulada'
        GROUP BY COALESCE(NULLIF(e.value->>'codigo', ''), LOWER(BTRIM(e.value->>'descripcion')))
        ORDER BY veces DESC, gasto DESC
        LIMIT 10
      `,
      sql`
        WITH l AS (
          SELECT COALESCE((e.value->>'precio')::numeric, 0) * COALESCE((e.value->>'cantidad')::numeric, 0) AS costo,
                 regexp_replace(LOWER(BTRIM(COALESCE(e.value->>'ticket', ''))), '\s+', ' ', 'g') AS tk
          FROM solicitudes_materiales s CROSS JOIN LATERAL jsonb_array_elements(s.lineas) e
          WHERE s.estado <> 'Anulada'
        )
        SELECT COALESCE(NULLIF(BTRIM(c.lugar), ''), CASE WHEN l.tk = '' THEN 'Sin ticket' ELSE 'Ticket no encontrado' END) AS lugar,
               COALESCE(SUM(l.costo), 0)::float AS gasto, COUNT(*)::int AS lineas
        FROM l
        LEFT JOIN LATERAL (
          SELECT c.lugar FROM correctivos c
          WHERE l.tk <> '' AND c.eliminado_en IS NULL
            AND (regexp_replace(LOWER(BTRIM(COALESCE(c.ticket, ''))), '\s+', ' ', 'g') = l.tk
                 OR c.refer = CASE WHEN regexp_replace(l.tk, ${PREFIJO_REF_SQL}, '') ~ '^[0-9]{1,9}$'
                                   THEN regexp_replace(l.tk, ${PREFIJO_REF_SQL}, '')::int END)
          LIMIT 1
        ) c ON true
        GROUP BY 1
        ORDER BY gasto DESC
        LIMIT 12
      `,
    ]);
    return {
      anio,
      totales: (tot as Record<string, number>[])[0],
      meses: meses as { mes: string; solicitudes: number; gasto: number }[],
      top: top as { descripcion: string; codigo: string | null; unidad: string; veces: number; cantidad: number; gasto: number }[],
      lugares: lugares as { lugar: string; gasto: number; lineas: number }[],
    };
  } catch (err) {
    console.error("[panel] materiales", err);
    return null;
  }
}
