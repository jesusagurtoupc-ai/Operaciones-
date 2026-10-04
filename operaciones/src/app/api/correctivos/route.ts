import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { normalizeCorrectivos, normalizeCorrectivo } from "@/lib/types";
import { buildWhere, DIMENSIONES } from "@/lib/filtros";

/**
 * A diferencia de "valor || null", esto NO convierte 0 en null.
 * `monto: 0` (ej. trabajo cubierto por garantía) es un valor válido y
 * distinto de "sin monto"; con "|| null" se perdía silenciosamente.
 */
function numOrNull(v: unknown): number | null {
  return v === null || v === undefined || v === "" ? null : Number(v);
}


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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const { where, values } = buildWhere(searchParams);

    const page = parsePositiveInt(searchParams.get("page"), 1);
    const pageSize = parsePositiveInt(searchParams.get("pageSize"), 25, 200);
    const offset = (page - 1) * pageSize;

    const query = `
      SELECT * FROM correctivos
      ${where}
      ORDER BY f_reg DESC NULLS LAST, id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;
    const resumenQuery = `
      SELECT COUNT(*)::int AS total, COALESCE(SUM(monto), 0)::float AS monto
      FROM correctivos ${where}
    `;

    // Conteos por categoría para las tarjetas de filtro. Cada dimensión se
    // calcula aplicando TODOS los demás filtros pero no el suyo propio: así
    // cada tarjeta muestra cuántos tickets habría al elegirla.
    const facetaQueries = DIMENSIONES.map((dim) => {
      const w = buildWhere(searchParams, dim);
      const sinNulos = w.where
        ? `${w.where} AND ${dim} IS NOT NULL`
        : `WHERE ${dim} IS NOT NULL`;
      return sql.query(
        `SELECT ${dim} AS valor, COUNT(*)::int AS cantidad,
                COALESCE(SUM(monto), 0)::float AS monto
         FROM correctivos ${sinNulos}
         GROUP BY ${dim}`,
        w.values
      );
    });

    const [rows, resumenRows, ...facetaRows] = await Promise.all([
      sql.query(query, values),
      sql.query(resumenQuery, values),
      ...facetaQueries,
    ]);

    const resumen = (resumenRows as unknown as { total: number; monto: number }[])[0] ?? {
      total: 0,
      monto: 0,
    };
    const total = resumen.total;

    const facetas: Record<string, unknown> = {};
    DIMENSIONES.forEach((dim, i) => {
      facetas[dim] = facetaRows[i];
    });

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      refer, ticket, f_reg, descripcion, lugar, estado, proveedor, monto,
      f_coti, f_oc, f_inicio, f_fin, cuenta, tipo_trab,
      sub_tipo_trab, n_oc, area,
    } = body;

    if (!descripcion || String(descripcion).trim() === "") {
      return NextResponse.json(
        { error: "La descripción es obligatoria" },
        { status: 400 }
      );
    }

    // Si N° Refer. o la fecha vienen vacíos, se completan solos: el refer con
    // el siguiente número de la lista y la fecha con el día de creación (hora
    // de Lima, para que no se corra de día en la noche).
    const rows = await sql`
      INSERT INTO correctivos
        (refer, ticket, f_reg, descripcion, lugar, estado, proveedor, monto,
         f_coti, f_oc, f_inicio, f_fin, cuenta, tipo_trab,
         sub_tipo_trab, n_oc, area)
      VALUES
        (COALESCE(${numOrNull(refer)}::int, (SELECT COALESCE(MAX(refer), 0) + 1 FROM correctivos)),
         ${ticket || null},
         COALESCE(${f_reg || null}::date, (now() AT TIME ZONE 'America/Lima')::date),
         ${descripcion}, ${lugar || null}, ${estado || "cotizar"},
         ${proveedor || null}, ${numOrNull(monto)}, ${f_coti || null},
         ${f_oc || null},
         ${f_inicio || null}, ${f_fin || null}, ${cuenta || null},
         ${tipo_trab || null}, ${sub_tipo_trab || null},
         ${n_oc || null}, ${area || null})
      RETURNING *
    `;

    return NextResponse.json(
      { data: normalizeCorrectivo(rows[0] as Record<string, unknown>) },
      { status: 201 }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Error al crear el correctivo" },
      { status: 500 }
    );
  }
}
