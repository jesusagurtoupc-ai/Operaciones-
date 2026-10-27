import { exigirSesion, exigirAdmin } from "@/lib/server/permisos";
import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/auth";
import { registrar } from "@/lib/server/historial";
import { buildOrderBy } from "@/lib/server/orden";
import { violacionUnica, MSG_REFER_REPETIDO, MSG_TICKET_REPETIDO } from "@/lib/server/errores";
import {
  leerJson, validarCorrectivo, incoherenciasFechas, hoyLima,
  MSG_FINALIZADO_SIN_FIN, MSG_JSON_INVALIDO,
} from "@/lib/server/validar";
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
const COLUMNAS_LISTA = `id, refer, ticket, f_reg, descripcion, lugar, estado, proveedor, proveedor_ruc, monto,
  f_coti, f_oc, f_entrega, f_inicio, f_fin, cuenta, tipo_trab, sub_tipo_trab, n_oc, area,
  documentos, estado_desde, created_at, updated_at, eliminado_en, eliminado_por`;

export async function GET(req: NextRequest) {
  try {
    const acceso = await exigirSesion();
    if (acceso.error) return acceso.error;
    await ensureSchema(); // asegura las columnas nuevas antes de consultar
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
      const w = buildWhere(searchParams, dim, { papelera: verPapelera });
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
    const wSin = buildWhere(searchParams, "sin", { papelera: verPapelera });
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
    const acceso = await exigirAdmin();
    if (acceso.error) return acceso.error;
    await ensureSchema();
    const body = await leerJson(req);
    if (!body) {
      return NextResponse.json({ error: MSG_JSON_INVALIDO }, { status: 400 });
    }
    const v = validarCorrectivo(body);
    if (!v.ok) {
      return NextResponse.json({ error: v.error }, { status: 400 });
    }
    const d = v.datos;

    const incoherencias = incoherenciasFechas({ ...d, f_reg: d.f_reg ?? hoyLima() });
    if (incoherencias.length > 0) {
      return NextResponse.json({ error: incoherencias[0] }, { status: 400 });
    }
    if (d.estado === "Finalizado" && !d.f_fin) {
      return NextResponse.json({ error: MSG_FINALIZADO_SIN_FIN }, { status: 400 });
    }

    // Si N° Refer. o la fecha vienen vacíos, se completan solos: el refer con
    // el siguiente número de la lista y la fecha con el día de creación (hora
    // de Lima, para que no se corra de día en la noche).
    const insertar = () => sql`
      INSERT INTO correctivos
        (refer, ticket, f_reg, descripcion, lugar, estado, proveedor, proveedor_ruc, monto,
         f_coti, f_oc, f_entrega, f_inicio, f_fin, cuenta, tipo_trab,
         sub_tipo_trab, n_oc, area, estado_desde)
      VALUES
        (COALESCE(${d.refer}::int, (SELECT COALESCE(MAX(refer), 0) + 1 FROM correctivos)),
         ${d.ticket},
         COALESCE(${d.f_reg}::date, (now() AT TIME ZONE 'America/Lima')::date),
         ${d.descripcion}, ${d.lugar}, ${d.estado},
         ${d.proveedor}, ${d.proveedor_ruc}, ${d.monto}, ${d.f_coti},
         ${d.f_oc}, ${d.f_entrega},
         ${d.f_inicio}, ${d.f_fin}, ${d.cuenta},
         ${d.tipo_trab}, ${d.sub_tipo_trab},
         ${d.n_oc}, ${d.area}, now())
      RETURNING *
    `;

    // Si dos personas crean a la vez, ambas calculan el mismo "máximo + 1". El índice
    // único deja pasar a una y la otra recibe un error de Ref repetido: se vuelve a
    // intentar (ya con el Ref nuevo a la vista). Solo aplica al Ref automático.
    let rows: Record<string, unknown>[] = [];
    for (let intento = 0; ; intento++) {
      try {
        rows = (await insertar()) as Record<string, unknown>[];
        break;
      } catch (e) {
        if (d.refer === null && violacionUnica(e) === "refer" && intento < 8) continue;
        throw e;
      }
    }

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
    const dup = violacionUnica(err);
    if (dup) {
      return NextResponse.json(
        { error: dup === "refer" ? MSG_REFER_REPETIDO : MSG_TICKET_REPETIDO },
        { status: 409 }
      );
    }
    console.error(err);
    return NextResponse.json(
      { error: "Error al crear el correctivo" },
      { status: 500 }
    );
  }
}
