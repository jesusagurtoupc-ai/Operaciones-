// Orden de la lista de correctivos y de la exportación a Excel.
//
// El número de "Ref" es lo que la gente ve en la columna, así que es lo que
// manda: se ordena como número (9, 99, 481, 1000...) y los que no tienen
// Ref van siempre al final. Para desempatar se usa el ticket en orden
// "natural" (los tickets son texto: "566", "566-B", "CC-2026-0012"; en
// orden alfabético "1000" quedaría antes que "481") y por último el id.
//
// Lista blanca: lo que llega por la URL solo elige una de estas opciones,
// nunca se concatena en la consulta.

const TICKET_BLANK = `(ticket IS NULL OR BTRIM(ticket) = '')`;
const TICKET_PREFIX = `LOWER(REGEXP_REPLACE(BTRIM(ticket), '\\d.*$', ''))`;
const TICKET_NUMBERS = `ARRAY(SELECT m[1]::numeric FROM REGEXP_MATCHES(ticket, '\\d+', 'g') AS m)`;

const ORDENES: Record<string, string> = {
  ref_desc: `refer DESC NULLS LAST, ${TICKET_BLANK}, ${TICKET_PREFIX} DESC, ${TICKET_NUMBERS} DESC, id DESC`,
  ref_asc: `refer ASC NULLS LAST, ${TICKET_BLANK}, ${TICKET_PREFIX}, ${TICKET_NUMBERS}, id ASC`,
  fecha: "f_reg DESC NULLS LAST, id DESC",
};

/** Orden por defecto: Ref de mayor a menor (el más nuevo arriba). */
export const ORDEN_POR_DEFECTO = "ref_desc";

export function buildOrderBy(orden: string | null): string {
  return ORDENES[orden || ""] || ORDENES[ORDEN_POR_DEFECTO];
}
