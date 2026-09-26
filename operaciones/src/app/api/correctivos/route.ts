import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { normalizeCorrectivos, normalizeCorrectivo } from "@/lib/types";

/**
 * A diferencia de "valor || null", esto NO convierte 0 en null.
 * `monto: 0` (ej. trabajo cubierto por garantía) es un valor válido y
 * distinto de "sin monto"; con "|| null" se perdía silenciosamente.
 */
function numOrNull(v: unknown): number | null {
  return v === null || v === undefined || v === "" ? null : Number(v);
}


function buildWhere(searchParams: URLSearchParams) {
  const clauses: string[] = [];
  const values: unknown[] = [];

  const estado = searchParams.get("estado");
  const area = searchParams.get("area");
  const tipoTrab = searchParams.get("tipo_trab");
  const lugar = searchParams.get("lugar");
  const q = searchParams.get("q");
  const desde = searchParams.get("desde");
  const hasta = searchParams.get("hasta");

  if (estado) {
    values.push(estado);
    clauses.push(`estado = $${values.length}`);
  }
  if (area) {
    values.push(area);
    clauses.push(`area = $${values.length}`);
  }
  if (tipoTrab) {
    values.push(tipoTrab);
    clauses.push(`tipo_trab = $${values.length}`);
  }
  if (lugar) {
    values.push(lugar);
    clauses.push(`lugar = $${values.length}`);
  }
  if (q) {
    values.push(`%${q}%`);
    const i = values.length;
    clauses.push(
      `(descripcion ILIKE $${i} OR proveedor ILIKE $${i} OR ticket ILIKE $${i} OR CAST(refer AS TEXT) ILIKE $${i})`
    );
  }
  if (desde) {
    values.push(desde);
    clauses.push(`f_reg >= $${values.length}`);
  }
  if (hasta) {
    values.push(hasta);
    clauses.push(`f_reg <= $${values.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { where, values };
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
    const countQuery = `SELECT COUNT(*)::int AS total FROM correctivos ${where}`;

    const [rows, countRows] = await Promise.all([
      sql.query(query, values),
      sql.query(countQuery, values),
    ]);

    const total = (countRows as unknown as { total: number }[])[0]?.total ?? 0;

    return NextResponse.json({
      data: normalizeCorrectivos(rows as Record<string, unknown>[]),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
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
      f_coti, obs_cot, f_ps, f_oc, f_inicio, f_fin, cuenta, tipo_trab,
      sub_tipo_trab, evaluacion, n_oc, area,
    } = body;

    if (!descripcion || String(descripcion).trim() === "") {
      return NextResponse.json(
        { error: "La descripción es obligatoria" },
        { status: 400 }
      );
    }

    const rows = await sql`
      INSERT INTO correctivos
        (refer, ticket, f_reg, descripcion, lugar, estado, proveedor, monto,
         f_coti, obs_cot, f_ps, f_oc, f_inicio, f_fin, cuenta, tipo_trab,
         sub_tipo_trab, evaluacion, n_oc, area)
      VALUES
        (${numOrNull(refer)}, ${ticket || null}, ${f_reg || null},
         ${descripcion}, ${lugar || null}, ${estado || "cotizar"},
         ${proveedor || null}, ${numOrNull(monto)}, ${f_coti || null},
         ${obs_cot || null}, ${f_ps || null}, ${f_oc || null},
         ${f_inicio || null}, ${f_fin || null}, ${cuenta || null},
         ${tipo_trab || null}, ${sub_tipo_trab || null},
         ${evaluacion || null}, ${n_oc || null}, ${area || null})
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
