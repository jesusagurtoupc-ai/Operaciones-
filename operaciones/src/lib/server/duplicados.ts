import { sql } from "@/lib/server/db";

export type OcDuplicada = { id: number; refer: number | null };

/**
 * Busca otro correctivo ACTIVO (no eliminado) con la misma OC. Ignora mayúsculas y espacios de
 * los bordes, igual que el índice único de la base. `excluirId` deja fuera al propio ticket que
 * se está editando. Una OC vacía nunca es duplicada.
 */
export async function ocDuplicada(
  nOc: string | null | undefined,
  excluirId?: number
): Promise<OcDuplicada | null> {
  const oc = (nOc ?? "").trim();
  if (!oc) return null;
  const rows = await sql`
    SELECT id, refer FROM correctivos
    WHERE LOWER(BTRIM(n_oc)) = LOWER(${oc})
      AND eliminado_en IS NULL
      AND (${excluirId ?? null}::int IS NULL OR id <> ${excluirId ?? null}::int)
    ORDER BY id
    LIMIT 1
  `;
  return (rows[0] as OcDuplicada | undefined) ?? null;
}

export function mensajeOcRepetida(oc: string, dup: OcDuplicada): string {
  return `La OC ${oc} ya está registrada en el ticket #${dup.refer ?? dup.id}`;
}
