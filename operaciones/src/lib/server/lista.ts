// Consulta de la lista de correctivos. La usan la API (/api/correctivos) y la página del servidor
// (/correctivos), que así entrega la primera página ya con datos en vez de pedirlos después.
import { sql, ensureSchema, purgarPapelera } from "./db";
import { buildOrderBy, buildWhere, buildFacetasQuery, armarFacetas } from "./utils";
import { normalizeCorrectivos } from "@/lib/shared";

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
const COLUMNAS_LISTA = `id, refer, ticket, f_reg, descripcion, lugar, estado, proveedor, monto,
  f_coti, f_oc, f_inicio, f_fin, cuenta, tipo_trab, sub_tipo_trab, n_oc, area,
  ruc_proveedor, f_entrega, contrato, documentos, estado_desde, created_at, updated_at, eliminado_en, eliminado_por`;

/** Misma forma que devuelve GET /api/correctivos. */
export async function consultarLista(
  searchParams: URLSearchParams,
  { papelera }: { papelera: boolean }
): Promise<Record<string, unknown>> {
  await ensureSchema(); // asegura las columnas nuevas antes de consultar
  await purgarPapelera(); // borra lo que lleva más de 30 días en la papelera (máx. 1 vez por hora)
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
