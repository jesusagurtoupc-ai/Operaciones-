"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ItemFaceta } from "@/components/lista/filtrosLista";
import { formatoSoles } from "@/lib/shared";

/**
 * Desplegable de proveedores (selección múltiple, con buscador). Está encadenado con los demás
 * filtros: solo muestra los proveedores que tienen tickets con lo que ya se eligió en el resto
 * (estado, tipo, lugar, fechas…), con su cantidad y monto. Y al elegir proveedores, los demás filtros
 * recalculan sus números con esa elección.
 *
 * Búsqueda pensada para cómo se escriben los nombres en la práctica:
 *  - sin importar tildes, mayúsculas ni puntos ("sac" encuentra "S.A.C.", "peru" encuentra "PERÚ");
 *  - varias palabras en cualquier orden ("peru msg" encuentra "MSG PERU S.A.C.");
 *  - también por RUC si el nombre lo trae;
 *  - la parte que coincide se resalta, y Enter elige el primero de la lista.
 */

/** Texto comparable: sin tildes, en minúsculas, sin puntos ni signos (S.A.C. → sac). */
function normalizar(t: string) {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,;:()"'´`-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Resalta en el nombre las palabras buscadas (comparando sin tildes ni mayúsculas). */
function Resaltado({ texto, palabras }: { texto: string; palabras: string[] }) {
  if (palabras.length === 0) return <>{texto}</>;
  // Se arma la versión simple del nombre recordando de qué letra original sale cada carácter, así
  // "sac" también resalta "S.A.C." (los puntos no cuentan, igual que al buscar).
  const letras = Array.from(texto);
  let unido = "";
  const origen: number[] = [];
  letras.forEach((c, i) => {
    const s = /\s/.test(c)
      ? " "
      : c.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[.,;:()"'´`-]/g, "");
    for (const x of s) {
      if (x === " " && (unido === "" || unido.endsWith(" "))) continue;
      unido += x;
      origen.push(i);
    }
  });
  const marcar = new Array(letras.length).fill(false);
  for (const p of palabras) {
    let desde = 0;
    for (;;) {
      const k = unido.indexOf(p, desde);
      if (k === -1) break;
      for (let n = k; n < k + p.length; n++) marcar[origen[n]] = true;
      desde = k + p.length;
    }
  }
  // Los puntos que quedan entre letras resaltadas (S.A.C.) también se pintan, para que se lea seguido.
  for (let n = 1; n < letras.length - 1; n++) {
    if (!marcar[n] && marcar[n - 1] && marcar[n + 1]) marcar[n] = true;
  }
  const partes: { t: string; m: boolean }[] = [];
  letras.forEach((c, i) => {
    const ult = partes[partes.length - 1];
    if (ult && ult.m === marcar[i]) ult.t += c;
    else partes.push({ t: c, m: marcar[i] });
  });
  return (
    <>
      {partes.map((p, i) =>
        p.m ? (
          <mark key={i} className="rounded-sm bg-amber/30 px-0 text-ink">
            {p.t}
          </mark>
        ) : (
          <span key={i}>{p.t}</span>
        )
      )}
    </>
  );
}

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
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const buscador = useRef<HTMLInputElement>(null);

  // Clic fuera o tecla Esc: se cierra (antes había que buscar el botón "Cerrar").
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    // El cursor queda listo para escribir.
    buscador.current?.focus();
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, [abierto]);

  const palabras = useMemo(() => normalizar(texto).split(" ").filter(Boolean), [texto]);

  // Solo los que tienen tickets con los otros filtros (más los ya elegidos, para poder quitarlos).
  const todos = useMemo(
    () => items.filter((i) => i.valor.trim() !== "" && (i.cantidad > 0 || seleccionados.includes(i.valor))),
    [items, seleccionados]
  );
  const coinciden = useMemo(() => {
    const lista = todos.filter((i) => {
      if (palabras.length === 0) return true;
      const n = normalizar(i.valor);
      return palabras.every((p) => n.includes(p));
    });
    return lista.sort(
      (a, b) =>
        // Primero los que EMPIEZAN con lo buscado, luego los de más tickets.
        Number(palabras.length > 0 && normalizar(b.valor).startsWith(palabras[0])) -
          Number(palabras.length > 0 && normalizar(a.valor).startsWith(palabras[0])) ||
        b.cantidad - a.cantidad ||
        a.valor.localeCompare(b.valor, "es")
    );
  }, [todos, palabras]);
  const elegidos = coinciden.filter((i) => seleccionados.includes(i.valor));
  const otros = coinciden.filter((i) => !seleccionados.includes(i.valor));

  const resumen =
    seleccionados.length === 0
      ? "Todos los proveedores"
      : seleccionados.length === 1
        ? seleccionados[0]
        : `${seleccionados.length} proveedores elegidos`;

  function fila(i: ItemFaceta) {
    const marcado = seleccionados.includes(i.valor);
    return (
      <li key={i.valor}>
        <label
          className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-page ${marcado ? "bg-teal/5" : ""}`}
        >
          <input type="checkbox" checked={marcado} onChange={() => onAlternar(i.valor)} />
          <span className="min-w-0 flex-1 truncate" title={i.valor}>
            <Resaltado texto={i.valor} palabras={palabras} />
          </span>
          <span className="shrink-0 text-right leading-tight">
            <span
              className="block rounded bg-concrete-dim px-1.5 py-0.5 text-xs font-mono-tag text-ink-soft"
              title="Tickets de este proveedor con los filtros actuales"
            >
              {i.cantidad} {i.cantidad === 1 ? "ticket" : "tickets"}
            </span>
            {i.monto > 0 && <span className="block text-[11px] text-ink-soft">{formatoSoles(i.monto)}</span>}
          </span>
        </label>
      </li>
    );
  }

  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
        aria-label="Filtrar por proveedor"
        className="flex w-full cursor-pointer select-none items-center justify-between gap-2 rounded-md border border-line-strong bg-white px-3 py-2 text-left text-sm hover:bg-concrete-dim"
      >
        <span className={`truncate ${seleccionados.length === 0 ? "text-ink-soft" : "font-medium"}`}>
          {seleccionados.length === 0 ? "🔎 " : ""}
          {resumen}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-ink-soft">
          {seleccionados.length > 0 && (
            <span className="rounded-full bg-ink px-1.5 py-0.5 font-mono-tag text-white">{seleccionados.length}</span>
          )}
          <span aria-hidden="true">{abierto ? "▴" : "▾"}</span>
        </span>
      </button>

      {/* Los elegidos se ven también con el desplegable cerrado, y se quitan con la ✕. */}
      {!abierto && seleccionados.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {seleccionados.map((v) => (
            <span
              key={v}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-teal/40 bg-teal/5 px-2 py-0.5 text-xs"
            >
              <span className="truncate" title={v}>
                {v}
              </span>
              <button
                type="button"
                onClick={() => onAlternar(v)}
                className="text-ink-soft hover:text-ink"
                aria-label={`Quitar ${v}`}
                title="Quitar"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {abierto && (
        <div className="absolute left-0 z-30 mt-1 w-full min-w-[22rem] rounded-lg border border-line bg-white p-2 shadow-card">
          <input
            ref={buscador}
            type="search"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              // Enter: elige (o quita) el primero de la lista filtrada.
              if (e.key === "Enter") {
                e.preventDefault();
                const primero = otros[0] ?? elegidos[0];
                if (primero) {
                  onAlternar(primero.valor);
                  setTexto("");
                }
              }
            }}
            placeholder="Escribe parte del nombre: «msg», «peru sac»…"
            className="w-full rounded-md border border-line-strong px-3 py-1.5 text-sm"
            aria-label="Buscar proveedor"
          />
          <p className="mb-2 mt-1 px-1 text-[11px] text-ink-soft">
            {palabras.length > 0
              ? `${coinciden.length} de ${todos.length} proveedores coinciden · Enter elige el primero`
              : `${todos.length} proveedores con los filtros actuales · marca uno o varios`}
          </p>

          <ul className="max-h-72 overflow-y-auto">
            {coinciden.length === 0 ? (
              <li className="px-2 py-3 text-sm text-ink-soft">
                {texto ? (
                  <>
                    Ningún proveedor coincide con «{texto}». Prueba con menos letras o solo una palabra del nombre.
                    {todos.length < items.filter((i) => i.valor.trim() !== "").length && (
                      <span className="mt-1 block">
                        Ojo: solo se listan proveedores con tickets en los demás filtros elegidos.
                      </span>
                    )}
                  </>
                ) : (
                  "No hay proveedores con los filtros elegidos. Quita algún filtro para ver más."
                )}
              </li>
            ) : (
              <>
                {elegidos.length > 0 && (
                  <>
                    <li className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                      Elegidos ({elegidos.length})
                    </li>
                    {elegidos.map(fila)}
                    {otros.length > 0 && (
                      <li className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                        Otros proveedores
                      </li>
                    )}
                  </>
                )}
                {otros.map(fila)}
              </>
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
            <button type="button" onClick={() => setAbierto(false)} className="font-medium text-ink hover:underline">
              Listo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
