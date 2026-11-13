"use client";

import { useMemo, useRef, useState } from "react";
import type { ItemFaceta } from "@/components/lista/filtrosLista";

/**
 * Desplegable de proveedores (selección múltiple, con buscador). Está encadenado con los demás
 * filtros: solo muestra los proveedores que tienen tickets con lo que ya se eligió en el resto
 * (estado, tipo, lugar, fechas…), con su cantidad. Y al elegir proveedores, los demás filtros
 * recalculan sus números con esa elección.
 */
export default function SelectorProveedor({
  items,
  seleccionados,
  onAlternar,
  onLimpiar,
}: {
  items: ItemFaceta[];
  seleccionados: string[];
  onAlternar: (valor: string) => void;
  onLimpiar: () => void;
}) {
  const [texto, setTexto] = useState("");
  const detalle = useRef<HTMLDetailsElement>(null);

  // Solo los que tienen tickets con los otros filtros (más los ya elegidos, para poder quitarlos).
  const disponibles = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return items
      .filter((i) => i.valor.trim() !== "" && (i.cantidad > 0 || seleccionados.includes(i.valor)))
      .filter((i) => !t || i.valor.toLowerCase().includes(t))
      .sort(
        (a, b) =>
          Number(seleccionados.includes(b.valor)) - Number(seleccionados.includes(a.valor)) ||
          b.cantidad - a.cantidad ||
          a.valor.localeCompare(b.valor, "es")
      );
  }, [items, seleccionados, texto]);

  const resumen =
    seleccionados.length === 0
      ? "Todos los proveedores"
      : seleccionados.length === 1
        ? seleccionados[0]
        : `${seleccionados[0]} y ${seleccionados.length - 1} más`;
  const totalOpciones = items.filter((i) => i.valor.trim() !== "" && (i.cantidad > 0 || seleccionados.includes(i.valor))).length;

  return (
    <details ref={detalle} className="relative">
      <summary
        className="list-none cursor-pointer select-none flex items-center justify-between gap-2 rounded-md border border-line-strong bg-white px-3 py-2 text-sm hover:bg-concrete-dim"
        aria-label="Filtrar por proveedor"
      >
        <span className={`truncate ${seleccionados.length === 0 ? "text-ink-soft" : "font-medium"}`}>{resumen}</span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-ink-soft">
          {seleccionados.length > 0 && (
            <span className="rounded-full bg-ink px-1.5 py-0.5 font-mono-tag text-white">{seleccionados.length}</span>
          )}
          <span aria-hidden="true">▾</span>
        </span>
      </summary>

      <div className="absolute left-0 z-30 mt-1 w-full min-w-[20rem] rounded-lg border border-line bg-white p-2 shadow-card">
        <input
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={`Buscar entre ${totalOpciones} proveedores…`}
          className="mb-2 w-full rounded-md border border-line-strong px-3 py-1.5 text-sm"
          aria-label="Buscar proveedor"
        />
        <ul className="max-h-64 overflow-y-auto">
          {disponibles.length === 0 ? (
            <li className="px-2 py-3 text-sm text-ink-soft">
              {texto ? "Ningún proveedor coincide." : "No hay proveedores con los filtros elegidos."}
            </li>
          ) : (
            disponibles.map((i) => (
              <li key={i.valor}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-page">
                  <input
                    type="checkbox"
                    checked={seleccionados.includes(i.valor)}
                    onChange={() => onAlternar(i.valor)}
                  />
                  <span className="min-w-0 flex-1 truncate" title={i.valor}>{i.valor}</span>
                  <span className="shrink-0 rounded bg-concrete-dim px-1.5 py-0.5 text-xs font-mono-tag text-ink-soft">
                    {i.cantidad}
                  </span>
                </label>
              </li>
            ))
          )}
        </ul>
        <div className="mt-2 flex justify-between border-t border-line pt-2 text-xs">
          <button
            type="button"
            disabled={seleccionados.length === 0}
            onClick={onLimpiar}
            className="text-teal hover:underline disabled:opacity-40 disabled:no-underline"
          >
            Quitar selección
          </button>
          <button
            type="button"
            onClick={() => {
              if (detalle.current) detalle.current.open = false;
            }}
            className="text-ink-soft hover:underline"
          >
            Cerrar
          </button>
        </div>
      </div>
    </details>
  );
}
