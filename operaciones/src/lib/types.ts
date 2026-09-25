export type Correctivo = {
  id: number;
  refer: number | null;
  ticket: string | null;
  f_reg: string | null;
  descripcion: string;
  lugar: string | null;
  estado: string;
  proveedor: string | null;
  monto: number | null;
  f_coti: string | null;
  obs_cot: string | null;
  f_ps: string | null;
  f_oc: string | null;
  f_inicio: string | null;
  f_fin: string | null;
  cuenta: string | null;
  tipo_trab: string | null;
  sub_tipo_trab: string | null;
  evaluacion: string | null;
  n_oc: string | null;
  area: string | null;
  created_at?: string;
  updated_at?: string;
};

export type CorrectivoInput = Omit<
  Correctivo,
  "id" | "created_at" | "updated_at"
>;

/**
 * Postgres devuelve las columnas NUMERIC (como `monto`) como texto para
 * no perder precisión con el driver. Aquí se convierten a number para
 * que el resto de la app (ordenar, sumar, exportar) reciba tipos
 * consistentes con `Correctivo`.
 */
export function normalizeCorrectivo<T extends Record<string, unknown>>(
  row: T
): T {
  return {
    ...row,
    monto:
      row.monto === null || row.monto === undefined
        ? null
        : Number(row.monto),
  };
}

export function normalizeCorrectivos<T extends Record<string, unknown>>(
  rows: T[]
): T[] {
  return rows.map(normalizeCorrectivo);
}

/**
 * Las columnas DATE de Postgres pueden llegar como objeto Date o como
 * string ISO completo ("2026-08-27T00:00:00.000Z") según el driver y
 * si pasan por una API route (JSON) o por un Server Component (RSC).
 * Concatenar texto a ciegas (`valor + "T00:00:00"`) rompía tanto el
 * listado (mostraba "Invalid Date") como el formulario de edición
 * (los campos de fecha aparecían vacíos). Esta función siempre
 * devuelve "YYYY-MM-DD" o "" — el único formato que un <input
 * type="date"> acepta.
 */
export function toDateOnly(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}
