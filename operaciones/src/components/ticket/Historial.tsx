import { sql } from "@/lib/server/db";
import { PREFIJO_REF_SQL } from "@/lib/materiales";
import { revisarTicket, type Correctivo } from "@/lib/shared";

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

/** Últimos 30 cambios del ticket (la página los pide junto con el ticket). */
export async function leerHistorial(correctivoId: number): Promise<Fila[]> {
  return (await sql`
    SELECT id, usuario, detalle, created_at
    FROM historial
    WHERE correctivo_id = ${correctivoId}
    ORDER BY created_at DESC, id DESC
    LIMIT 30
  `) as unknown as Fila[];
}

/** Últimos cambios hechos en el ticket: quién, cuándo y qué. */
export default function Historial({ filas }: { filas: Fila[] }) {

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

// ───────── Materiales solicitados para este ticket ─────────
// Salen del historial de solicitudes de materiales: cada línea cuyo "N° Ticket" es este ticket (por su
// código de ticket o por su N° Ref, escrito como "512", "Ref 512", "#512"…; ver claveTicket).

type LineaGuardada = {
  codigo: string | null;
  descripcion: string;
  cantidad: number;
  unidad: string;
  precio: number | null;
  moneda: string;
  ticket?: string;
};
type FilaMaterial = { numero: string; estado: string; username: string; creado_en: string | Date; linea: LineaGuardada };

export async function leerMaterialesDelTicket(correctivoId: number): Promise<FilaMaterial[]> {
  try {
    return (await sql`
      SELECT s.numero, s.estado, s.username, s.creado_en, l.value AS linea
      FROM correctivos c
      JOIN solicitudes_materiales s ON true
      CROSS JOIN LATERAL jsonb_array_elements(s.lineas) l
      WHERE c.id = ${correctivoId}
        AND COALESCE(BTRIM(l.value->>'ticket'), '') <> ''
        AND (
          (COALESCE(BTRIM(c.ticket), '') <> ''
            AND regexp_replace(LOWER(BTRIM(l.value->>'ticket')), '\\s+', ' ', 'g') = regexp_replace(LOWER(BTRIM(c.ticket)), '\\s+', ' ', 'g'))
          OR (c.refer IS NOT NULL AND (
            CASE WHEN regexp_replace(regexp_replace(LOWER(BTRIM(l.value->>'ticket')), '\\s+', ' ', 'g'), ${PREFIJO_REF_SQL}, '') ~ '^[0-9]{1,9}$'
                 THEN regexp_replace(regexp_replace(LOWER(BTRIM(l.value->>'ticket')), '\\s+', ' ', 'g'), ${PREFIJO_REF_SQL}, '')::int
            END) = c.refer)
        )
      ORDER BY s.creado_en DESC, s.numero
      LIMIT 300
    `) as unknown as FilaMaterial[];
  } catch (err) {
    console.error("[ticket] materiales solicitados", err);
    return [];
  }
}

const soles = (n: number) => `S/ ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const COLOR_ESTADO: Record<string, string> = {
  Enviada: "bg-slate-soft border-line-strong",
  Aprobada: "bg-teal-soft border-teal/40",
  Atendida: "bg-[#e7f6ec] text-[#14532d] border-[#86c79b]",
  Anulada: "bg-[var(--danger-soft)] text-danger border-danger/30 line-through",
};

/** Qué materiales se pidieron para este ticket, en qué solicitud, su estado y su costo. */
export function MaterialesDelTicket({ filas }: { filas: FilaMaterial[] }) {
  const grupos = new Map<string, FilaMaterial[]>();
  for (const f of filas) grupos.set(f.numero, [...(grupos.get(f.numero) ?? []), f]);
  const costo = (fs: FilaMaterial[]) =>
    fs.reduce((s, f) => s + (f.linea.precio ?? 0) * (Number(f.linea.cantidad) || 0), 0);
  // El total no cuenta las solicitudes anuladas.
  const total = costo(filas.filter((f) => f.estado !== "Anulada"));
  const sinPrecio = filas.filter((f) => f.estado !== "Anulada" && f.linea.precio === null).length;

  return (
    <details className="bg-white border border-line rounded-lg shadow-card p-6 mt-6" open={filas.length > 0}>
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-ink-soft">
        Materiales solicitados ({filas.length}){filas.length > 0 && ` · ${soles(total)} sin IGV`}
      </summary>
      {filas.length === 0 ? (
        <p className="text-sm text-ink-soft mt-4">
          Ninguna solicitud de materiales menciona este ticket. En la página Materiales, escribe su N° Ref o su código
          de ticket en la columna «N° Ticket» de cada material.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {[...grupos.entries()].map(([numero, fs]) => (
            <div key={numero} className="border border-line rounded-md overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 bg-page px-3 py-2 text-xs">
                <b className="font-mono-tag">{numero}</b>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] ${COLOR_ESTADO[fs[0].estado] ?? ""}`}>{fs[0].estado}</span>
                <span className="text-ink-soft">
                  {cuando(fs[0].creado_en)} · {fs[0].username}
                </span>
                <span className="ml-auto font-mono-tag">{soles(costo(fs))}</span>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {fs.map((f, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="px-3 py-1.5">
                        {f.linea.descripcion}
                        <span className="block text-[11px] text-ink-soft font-mono-tag">{f.linea.codigo ?? "fuera del catálogo"}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right whitespace-nowrap font-mono-tag text-xs">
                        {f.linea.cantidad} {f.linea.unidad}
                      </td>
                      <td className="px-3 py-1.5 text-right whitespace-nowrap font-mono-tag text-xs">
                        {f.linea.precio === null ? "sin precio" : soles(f.linea.precio * (Number(f.linea.cantidad) || 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <p className="text-xs text-ink-soft">
            Total sin IGV (sin contar solicitudes anuladas): <b className="text-ink">{soles(total)}</b>
            {sinPrecio > 0 && ` · ${sinPrecio} material(es) sin precio no suman`}.
          </p>
        </div>
      )}
    </details>
  );
}

/** RUC(s) que tiene en el registro de proveedores la empresa del ticket (para la revisión automática). */
export async function leerRucRegistro(correctivoId: number): Promise<string[]> {
  try {
    const r = (await sql`
      SELECT p.ruc, COALESCE(p.otros_ruc, '{}') AS otros
      FROM correctivos c JOIN proveedores p ON p.nombre = c.proveedor
      WHERE c.id = ${correctivoId} LIMIT 1
    `) as { ruc: string | null; otros: string[] }[];
    return r[0] ? [r[0].ruc, ...r[0].otros].filter((x): x is string => !!x) : [];
  } catch {
    return [];
  }
}

/** Revisión automática: lo que no cuadra entre los datos del ticket y sus documentos (si hay algo). */
export function RevisionAutomatica({ c, rucRegistro }: { c: Correctivo; rucRegistro: string[] }) {
  const avisos = revisarTicket(c, rucRegistro);
  if (avisos.length === 0) return null;
  return (
    <section className="mt-6 border border-amber-200 bg-amber-50 rounded-lg px-4 py-3 text-sm text-amber-900">
      <h2 className="font-semibold text-xs uppercase tracking-wider mb-1">Revisión automática</h2>
      <ul className="list-disc pl-5 space-y-0.5">
        {avisos.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </section>
  );
}
