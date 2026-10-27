// Detección de errores de unicidad de Postgres (código 23505) para poder
// responder 409 con un mensaje claro en vez de un 500 genérico.
export type CampoUnico = "refer" | "ticket";

export const INDICE_REFER = "uq_correctivos_refer_activos";
export const INDICE_TICKET = "uq_correctivos_ticket_activos";

export function violacionUnica(err: unknown): CampoUnico | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: string; constraint?: string; message?: string };
  if (e.code !== "23505") return null;
  const donde = `${e.constraint ?? ""} ${e.message ?? ""}`;
  if (donde.includes(INDICE_REFER)) return "refer";
  if (donde.includes(INDICE_TICKET)) return "ticket";
  return null;
}

export const MSG_REFER_REPETIDO = "Ya existe un correctivo con ese N° Refer.";
export const MSG_TICKET_REPETIDO = "Ya existe un correctivo con ese ticket";
