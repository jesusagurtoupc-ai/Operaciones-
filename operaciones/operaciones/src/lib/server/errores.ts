// Detección de errores de unicidad de Postgres (código 23505) para poder
// responder 409 con un mensaje claro en vez de un 500 genérico.
export type CampoUnico = "refer" | "ticket" | "n_oc";

export const INDICE_REFER = "uq_correctivos_refer_activos";
export const INDICE_TICKET = "uq_correctivos_ticket_activos";
export const INDICE_N_OC = "uq_correctivos_n_oc_activos";

export function violacionUnica(err: unknown): CampoUnico | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: string; constraint?: string; message?: string };
  if (e.code !== "23505") return null;
  const donde = `${e.constraint ?? ""} ${e.message ?? ""}`;
  if (donde.includes(INDICE_REFER)) return "refer";
  if (donde.includes(INDICE_TICKET)) return "ticket";
  if (donde.includes(INDICE_N_OC)) return "n_oc";
  return null;
}

export const MSG_REFER_REPETIDO = "Ya existe un correctivo con ese N° Refer.";
export const MSG_TICKET_REPETIDO = "Ya existe un correctivo con ese ticket";
export const MSG_OC_REPETIDA = "Ya existe un correctivo con ese N° de OC";

/** Mensaje para el usuario según qué campo único se repitió. */
export function mensajeUnico(campo: CampoUnico): string {
  return campo === "refer" ? MSG_REFER_REPETIDO : campo === "n_oc" ? MSG_OC_REPETIDA : MSG_TICKET_REPETIDO;
}
