import type { Correctivo } from "@/lib/shared";
import { diasEntre, formatoFecha, formatoSoles, garantiaHasta, hoyLima, venceCotizacion } from "@/lib/shared";

/**
 * Condiciones leídas de la cotización del ticket: plazo, validez (hasta cuándo vale), garantía (hasta
 * cuándo rige, desde la fecha de fin), forma de pago y partidas. Solo lectura; si el ticket no tiene
 * condiciones guardadas, no se muestra nada.
 */
export default function CondicionesCotizacion({ c }: { c: Correctivo }) {
  const k = c.condiciones;
  if (!k) return null;
  const hoy = hoyLima();

  const vence = venceCotizacion(c);
  const quedanValidez = vence ? diasEntre(hoy, vence) : null;
  const garantia = garantiaHasta(c);
  const quedanGarantia = garantia ? diasEntre(hoy, garantia) : null;
  const partidas = k.partidas ?? [];
  const sumaPartidas = partidas.reduce((s, p) => s + p.monto, 0);

  const fila = (titulo: string, valor: React.ReactNode, ayuda?: string | null) => (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wider text-ink-soft">{titulo}</dt>
      <dd className="mt-0.5 text-sm text-ink" title={ayuda ?? undefined}>{valor}</dd>
    </div>
  );

  return (
    <section className="bg-white border border-line rounded-lg shadow-card p-6 mt-6">
      <h2 className="font-display font-bold text-xl tracking-tight">
        Condiciones de la cotización{k.numero ? <span className="font-mono-tag text-base text-ink-soft"> N° {k.numero}</span> : null}
      </h2>
      <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {(k.plazo_dias != null || k.plazo_texto) &&
          fila(
            "Plazo de entrega",
            k.plazo_dias != null ? `${k.plazo_dias} días${k.plazo_tipo ? ` ${k.plazo_tipo}` : ""}` : k.plazo_texto,
            k.plazo_texto
          )}
        {k.validez_dias != null &&
          fila(
            "Validez de la cotización",
            <>
              {k.validez_dias} días{vence ? ` · hasta ${formatoFecha(vence)}` : ""}
              {c.n_oc ? (
                <span className="text-ink-soft"> · ya tiene OC</span>
              ) : quedanValidez !== null ? (
                <span className={quedanValidez < 0 ? "text-danger" : quedanValidez <= 3 ? "text-amber-700" : "text-ink-soft"}>
                  {" · "}
                  {quedanValidez < 0 ? `vencida hace ${-quedanValidez} d` : quedanValidez === 0 ? "vence hoy" : `vence en ${quedanValidez} d`}
                </span>
              ) : null}
            </>
          )}
        {k.garantia_meses != null &&
          fila(
            "Garantía del trabajo",
            <>
              {k.garantia_meses} meses
              {garantia ? (
                <>
                  {` · hasta ${formatoFecha(garantia)}`}
                  <span className={quedanGarantia !== null && quedanGarantia >= 0 ? "text-emerald-700" : "text-ink-soft"}>
                    {quedanGarantia !== null && quedanGarantia >= 0 ? " · vigente" : " · vencida"}
                  </span>
                </>
              ) : (
                <span className="text-ink-soft"> · se cuenta desde la fecha de fin (aún sin fecha)</span>
              )}
            </>,
            k.garantia_texto
          )}
        {k.forma_pago && fila("Forma de pago", k.forma_pago)}
      </dl>
      {partidas.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-soft">
              <tr className="border-b border-line">
                <th className="text-left py-1.5 pr-3 font-medium">Ítem</th>
                <th className="text-left py-1.5 pr-3 font-medium">Partida</th>
                <th className="text-right py-1.5 font-medium">Monto (sin IGV)</th>
              </tr>
            </thead>
            <tbody>
              {partidas.map((p, i) => (
                <tr key={i} className="border-b border-line/60">
                  <td className="py-1.5 pr-3 font-mono-tag text-xs text-ink-soft">{p.item}</td>
                  <td className="py-1.5 pr-3">{p.descripcion}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatoSoles(p.monto)}</td>
                </tr>
              ))}
              <tr>
                <td />
                <td className="py-1.5 pr-3 text-right text-xs text-ink-soft">Suma de partidas</td>
                <td className="py-1.5 text-right font-semibold tabular-nums">{formatoSoles(sumaPartidas)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
