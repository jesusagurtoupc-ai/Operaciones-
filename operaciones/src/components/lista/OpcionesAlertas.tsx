"use client";

import { ALERTAS, ALERTAS_POR_DEFECTO, type ClaveAlerta } from "@/components/lista/filtrosLista";

/**
 * Menú para elegir qué avisos se muestran en la columna Estado. Cada opción indica cuántos tickets
 * de la página actual tienen ese aviso. La elección se guarda en este navegador.
 */
export default function OpcionesAlertas({
  activas,
  cuentas,
  onCambiar,
}: {
  activas: ClaveAlerta[];
  cuentas: Partial<Record<ClaveAlerta, number>>;
  onCambiar: (nuevas: ClaveAlerta[]) => void;
}) {
  const alternar = (c: ClaveAlerta) =>
    onCambiar(activas.includes(c) ? activas.filter((x) => x !== c) : [...activas, c]);

  return (
    <details className="relative">
      <summary className="list-none cursor-pointer select-none inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-white px-3 py-1.5 text-xs font-medium hover:bg-concrete-dim">
        ⚙ Tipos de aviso
        <span className="text-ink-soft">({activas.length}/{ALERTAS.length})</span>
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-80 rounded-lg border border-line bg-white p-3 shadow-card">
        <p className="mb-2 text-xs text-ink-soft">Elige qué tipos de notificación aparecen en el recuadro.</p>
        <ul className="space-y-2">
          {ALERTAS.map((a) => (
            <li key={a.clave}>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={activas.includes(a.clave)}
                  onChange={() => alternar(a.clave)}
                />
                <span>
                  <span className="font-medium">{a.nombre}</span>
                  {(cuentas[a.clave] ?? 0) > 0 && (
                    <span className="ml-1.5 text-xs font-mono-tag text-ink-soft">{cuentas[a.clave]} tickets</span>
                  )}
                  <span className="block text-xs text-ink-soft">{a.ayuda}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between border-t border-line pt-2 text-xs">
          <button type="button" className="text-teal hover:underline" onClick={() => onCambiar(ALERTAS.map((a) => a.clave))}>
            Activar todos
          </button>
          <button type="button" className="text-ink-soft hover:underline" onClick={() => onCambiar(ALERTAS_POR_DEFECTO)}>
            Restablecer
          </button>
        </div>
      </div>
    </details>
  );
}
