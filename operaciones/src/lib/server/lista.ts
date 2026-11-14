// Consulta de la lista de correctivos. La usan la API (/api/correctivos) y la página del servidor
// (/correctivos), que así entrega la primera página ya con datos en vez de pedirlos después.
import { after } from "next/server";
import { sql, ensureSchema, purgarPapelera } from "./db";
import { trasladarABlob, usaBlob } from "./almacen";
import { actualizarDesdeOCs, unificarProveedores } from "./proveedores";
import { buildOrderBy, buildWhere, buildFacetasQuery, armarFacetas } from "./utils";
import { normalizeCorrectivos, ESTADOS_CON_PLAZO, DIAS_ATRASO } from "@/lib/shared";

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
  const [filas, espacio] = await Promise.all([panelP, espacioP]);
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
  return { porEstado, porTipo, porArea, porLugar, porMes, porProveedor, totales, almacenamiento };
}
