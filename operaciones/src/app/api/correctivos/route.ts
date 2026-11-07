import { exigirSesion } from "@/lib/server/utils";
import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema, purgarPapelera } from "@/lib/server/db";
import { buildOrderBy } from "@/lib/server/utils";
import { normalizeCorrectivos } from "@/lib/shared";
import { buildWhere, buildFacetasQuery, armarFacetas } from "@/lib/server/utils";

// Los tickets NO se crean por aquí: la única forma es leer una OC en PDF (POST /api/correctivos/desde-oc).
// Un POST a esta ruta responde 405.

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

export async function GET(req: NextRequest) {
  try {
    const acceso = await exigirSesion();
    if (acceso.error) return acceso.error;
    await ensureSchema(); // asegura las columnas nuevas antes de consultar
    await purgarPapelera(); // borra lo que lleva más de 30 días en la papelera (máx. 1 vez por hora)
    const { searchParams } = new URL(req.url);
    // La papelera solo la ve un administrador.
    const verPapelera = searchParams.get("papelera") === "1";
    if (verPapelera && acceso.user.rol !== "admin") {
      return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
    }
    const { where, values } = buildWhere(searchParams, undefined, { papelera: verPapelera });

    const page = parsePositiveInt(searchParams.get("page"), 1);
    const pageSize = parsePositiveInt(searchParams.get("pageSize"), 25, 200);
    const offset = (page - 1) * pageSize;

    const query = `
      SELECT ${COLUMNAS_LISTA} FROM correctivos
      ${where}
      ORDER BY ${verPapelera ? "eliminado_en DESC, id DESC" : buildOrderBy(searchParams.get("orden"))}
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
      return NextResponse.json({
        data: normalizeCorrectivos(rows as Record<string, unknown>[]),
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      });
    }

    // Conteos por categoría para las tarjetas de filtro (cada una aplica TODOS los demás filtros
    // menos el suyo), resumen y documentos pendientes: una sola consulta, en paralelo con las filas.
    const fq = buildFacetasQuery(searchParams, { papelera: verPapelera });
    const [rows, facetaRows] = await Promise.all([
      sql.query(query, values),
      sql.query(fq.text, fq.values),
    ]);
    const { resumen, facetas } = armarFacetas(facetaRows as Record<string, unknown>[]);
    const total = resumen.total;

    return NextResponse.json({
      data: normalizeCorrectivos(rows as Record<string, unknown>[]),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      resumen: { total, monto: resumen.monto },
      facetas,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Error al obtener los correctivos" },
      { status: 500 }
    );
  }
}

/** Creación manual retirada: los tickets solo se crean leyendo una orden de compra en PDF. */
export async function POST() {
  return NextResponse.json(
    { error: "Los tickets solo se crean leyendo una orden de compra en PDF" },
    { status: 405, headers: { Allow: "GET" } }
  );
}
