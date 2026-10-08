import { sql } from "@/lib/db";

type Fila = { id: number; usuario: string | null; detalle: string; created_at: string | Date };

function cuando(v: string | Date) {
  return new Date(v).toLocaleString("es-PE", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Últimos cambios hechos en el ticket: quién, cuándo y qué. */
export default async function Historial({ correctivoId }: { correctivoId: number }) {
  const filas = (await sql`
    SELECT id, usuario, detalle, created_at
    FROM historial
    WHERE correctivo_id = ${correctivoId}
    ORDER BY created_at DESC, id DESC
    LIMIT 30
  `) as unknown as Fila[];

  return (
    <details className="bg-white border border-line rounded-lg shadow-card p-6 mt-6 group">
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-ink-soft">
        Historial de cambios ({filas.length})
      </summary>
      {filas.length === 0 ? (
        <p className="text-sm text-ink-soft mt-4">Aún no hay cambios registrados.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line border border-line rounded-md overflow-hidden text-sm">
          {filas.map((f) => (
            <li key={f.id} className="px-3 py-2">
              <p className="text-xs text-ink-soft">
                {cuando(f.created_at)} · {f.usuario ?? "—"}
              </p>
              <p className="mt-0.5">{f.detalle}</p>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
