/**
 * Convierte un valor del formulario en número o null (vacío).
 * A diferencia de "valor || null" NO convierte 0 en null, y devuelve
 * `undefined` si el texto no es un número válido (para responder 400
 * en vez de guardar NaN).
 */
export function numOrNull(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
