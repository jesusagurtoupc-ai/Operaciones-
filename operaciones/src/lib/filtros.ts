/**
 * Filtros compartidos por el listado (/api/correctivos) y la exportación
 * (/api/export), para que una tabla y su Excel siempre coincidan.
 *
 * Cada "dimensión" admite selección múltiple: el frontend manda el mismo
 * parámetro repetido (?estado=A&estado=B) y aquí se convierte en
 * `estado IN ($1, $2)`. Dentro de una misma dimensión las opciones se
 * combinan con O; entre dimensiones distintas, con Y.
 */

// Lista fija (no viene del usuario): por eso es seguro escribir el nombre
// de la columna directamente dentro del SQL.
export const DIMENSIONES = [
  "estado",
  "tipo_trab",
  "sub_tipo_trab",
  "lugar",
  "area",
] as const;

export type Dimension = (typeof DIMENSIONES)[number];

/**
 * Arma el WHERE a partir de los parámetros de la URL.
 * `excluir` deja fuera una dimensión: se usa para calcular los conteos
 * de esa dimensión ("¿cuántos habría si eligiera esta opción?").
 */
export const DOC_CLAVES: Record<string, string> = {
  Cotización: "cotizacion",
  OC: "oc",
  Informe: "informe",
  Certificado: "certificado",
};

/** Condición SQL: el documento aún no está listo (sin línea o en Pendiente). */
export function docPendienteSql(clave: string) {
  return `COALESCE(documentos->'${clave}'->>'estado', 'Pendiente') = 'Pendiente'`;
}

export function buildWhere(searchParams: URLSearchParams, excluir?: Dimension | "sin") {
  const clauses: string[] = [];
  const values: unknown[] = [];

  for (const dim of DIMENSIONES) {
    if (dim === excluir) continue;
    const elegidos = searchParams.getAll(dim).filter((v) => v !== "");
    if (elegidos.length === 0) continue;
    const marcadores = elegidos.map((v) => {
      values.push(v);
      return `$${values.length}`;
    });
    clauses.push(`${dim} IN (${marcadores.join(", ")})`);
  }

  // Documento pendiente: tickets a los que aún les falta alguno de los elegidos.
  if (excluir !== "sin") {
    const claves = searchParams
      .getAll("sin")
      .map((v) => DOC_CLAVES[v])
      .filter(Boolean);
    if (claves.length > 0) {
      clauses.push(`(${claves.map(docPendienteSql).join(" OR ")})`);
    }
  }

  const q = searchParams.get("q");
  const desde = searchParams.get("desde");
  const hasta = searchParams.get("hasta");

  if (q) {
    values.push(`%${q}%`);
    const i = values.length;
    clauses.push(
      `(descripcion ILIKE $${i} OR proveedor ILIKE $${i} OR ticket ILIKE $${i} OR CAST(refer AS TEXT) ILIKE $${i} OR n_oc ILIKE $${i})`
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
