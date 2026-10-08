import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { registrar } from "@/lib/historial";
import { normalizeCorrectivos, normalizeCorrectivo } from "@/lib/types";
import { buildWhere, DIMENSIONES, DOC_CLAVES, docPendienteSql } from "@/lib/filtros";

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
    await ensureSchema(); // asegura las columnas nuevas antes de consultar
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

    // Conteo de tickets a los que les falta cada documento.
    const wSin = buildWhere(searchParams, "sin");
    const sinQuery = sql.query(
      `SELECT ${Object.entries(DOC_CLAVES)
        .map(
          ([nombre, clave]) =>
            `COUNT(*) FILTER (WHERE ${docPendienteSql(clave)})::int AS "${nombre}"`
        )
        .join(", ")}
       FROM correctivos ${wSin.where}`,
      wSin.values
    );

    const [rows, resumenRows, sinRows, ...facetaRows] = await Promise.all([
      sql.query(query, values),
      sql.query(resumenQuery, values),
      sinQuery,
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

    const sinConteos = ((sinRows as unknown as Record<string, number>[])[0] ?? {}) as Record<string, number>;
    facetas.sin = Object.keys(DOC_CLAVES).map((nombre) => ({
      valor: nombre,
      cantidad: sinConteos[nombre] ?? 0,
      monto: 0,
    }));

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
    await ensureSchema();
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
         sub_tipo_trab, n_oc, area, estado_desde)
      VALUES
        (COALESCE(${numOrNull(refer)}::int, (SELECT COALESCE(MAX(refer), 0) + 1 FROM correctivos)),
         ${ticket || null},
         COALESCE(${f_reg || null}::date, (now() AT TIME ZONE 'America/Lima')::date),
         ${descripcion}, ${lugar || null}, ${estado || "cotizar"},
         ${proveedor || null}, ${numOrNull(monto)}, ${f_coti || null},
         ${f_oc || null},
         ${f_inicio || null}, ${f_fin || null}, ${cuenta || null},
         ${tipo_trab || null}, ${sub_tipo_trab || null},
         ${n_oc || null}, ${area || null}, now())
      RETURNING *
    `;
    const user = await getCurrentUser();
    await registrar(
      (rows[0] as { id: number }).id,
      user?.username,
      "Ticket creado"
    );

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
