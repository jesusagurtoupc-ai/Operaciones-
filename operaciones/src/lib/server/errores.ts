/** true si Postgres rechazó la operación por un índice único (código 23505). */
export function esViolacionUnica(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505";
}
