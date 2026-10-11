import { exigirSesion } from "@/lib/server/acceso";
import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { getAdmin } from "@/lib/server/auth";
import { validarCorrectivo, errorFiltrosFecha } from "@/lib/server/validacion";
import { registrar } from "@/lib/server/historial";
import { esViolacionUnica } from "@/lib/server/errores";
import { buildOrderBy } from "@/lib/server/orden";
import { normalizeCorrectivos, normalizeCorrectivo } from "@/lib/shared/types";
import { buildWhere, DIMENSIONES, DOC_CLAVES, docPendienteSql } from "@/lib/server/filtros";



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
  documentos, estado_desde, created_at, updated_at`;

export async function GET(req: NextRequest) {
  const sesion = await exigirSesion();
  if (sesion.error) return sesion.error;
  try {
    await ensureSchema(); // comprueba que la base esté migrada
    const { searchParams } = new URL(req.url);
    const errorFecha = errorFiltrosFecha(searchParams);
    if (errorFecha) {
      return NextResponse.json({ error: errorFecha }, { status: 400 });
    }
    const { where, values } = buildWhere(searchParams);

    const page = parsePositiveInt(searchParams.get("page"), 1, 1_000_000);
    const pageSize = parsePositiveInt(searchParams.get("pageSize"), 25, 200);
    const offset = (page - 1) * pageSize;

    const query = `
      SELECT ${COLUMNAS_LISTA} FROM correctivos
      ${where}
      ORDER BY ${buildOrderBy(searchParams.get("orden"))}
      LIMIT ${pageSize} OFFSET ${offset}
    `;
    const resumenQuery = `
      SELECT COUNT(*)::int AS total, COALESCE(SUM(monto), 0)::float AS monto
      FROM correctivos ${where}
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
    const user = await getAdmin();
    if (!user) {
      return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
    }
    await ensureSchema();

    const validado = validarCorrectivo(await req.json().catch(() => null));
    if (!validado.ok) {
      return NextResponse.json({ error: validado.error }, { status: 400 });
    }
    const d = validado.datos;

    // Si N° Refer. o la fecha vienen vacíos, se completan solos: el refer con
    // el siguiente número de la lista y la fecha con el día de creación (hora
    // de Lima, para que no se corra de día en la noche).
    // Dos altas simultáneas pueden calcular el mismo número: el índice único
    // lo detecta y se reintenta con el siguiente.
    const referAutomatico = d.refer === null;
    let rows: Record<string, unknown>[] = [];
    for (let intento = 0; intento < 4; intento++) {
      try {
        rows = (await sql`
          INSERT INTO correctivos
            (refer, ticket, f_reg, descripcion, lugar, estado, proveedor, monto,
             f_coti, f_oc, f_inicio, f_fin, cuenta, tipo_trab,
             sub_tipo_trab, n_oc, area, estado_desde)
          VALUES
            (COALESCE(${d.refer}::int, (SELECT COALESCE(MAX(refer), 0) + 1 FROM correctivos)),
             ${d.ticket},
             COALESCE(${d.f_reg}::date, (now() AT TIME ZONE 'America/Lima')::date),
             ${d.descripcion}, ${d.lugar}, ${d.estado},
             ${d.proveedor}, ${d.monto}, ${d.f_coti},
             ${d.f_oc},
             ${d.f_inicio}, ${d.f_fin}, ${d.cuenta},
             ${d.tipo_trab}, ${d.sub_tipo_trab},
             ${d.n_oc}, ${d.area}, now())
          RETURNING *
        `) as Record<string, unknown>[];
        break;
      } catch (err) {
        if (!esViolacionUnica(err)) throw err;
        if (!referAutomatico) {
          return NextResponse.json(
            { error: `Ya existe un ticket con el N° Refer. ${d.refer}` },
            { status: 409 }
          );
        }
        if (intento === 3) throw err;
      }
    }
    await registrar(
      (rows[0] as { id: number }).id,
      user.username,
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
