"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ALERTAS,
  ALERTAS_POR_DEFECTO,
  CLASE_TONO_ALERTA,
  type AvisoItem,
  type ClaveAlerta,
} from "@/components/lista/filtrosLista";

/**
 * Recuadro con todas las notificaciones de los tickets (en vez de mostrarlas dentro de cada fila).
 * Se puede plegar, filtrar por tipo, configurar qué tipos ver, y cada notificación abre su ticket.
 * Las preferencias (tipos activos y si está abierto) se guardan en este navegador.
 */
/** Cuántas filas se dibujan de una vez (con miles de avisos, dibujarlos todos traba la lista). */
const POR_TANDA = 100;

export default function PanelNotificaciones({ refrescar }: { refrescar: number }) {
  const [limite, setLimite] = useState(POR_TANDA);
  const router = useRouter();
  const [items, setItems] = useState<AvisoItem[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [activas, setActivas] = useState<ClaveAlerta[]>(ALERTAS_POR_DEFECTO);
  const [abierto, setAbierto] = useState(true);
  const [tipo, setTipo] = useState<ClaveAlerta | "">("");
  const [truncado, setTruncado] = useState<number | null>(null);

  useEffect(() => {
    // Se lee después del primer render (no en el servidor) y de forma asíncrona.
    let vivo = true;
    void Promise.resolve().then(() => {
      if (!vivo) return;
      try {
        const g = JSON.parse(localStorage.getItem("lista:avisos") ?? "null");
        if (Array.isArray(g)) setActivas(g.filter((c): c is ClaveAlerta => ALERTAS.some((a) => a.clave === c)));
        if (localStorage.getItem("lista:avisos-abierto") === "0") setAbierto(false);
      } catch {
        /* sin almacenamiento: valores por defecto */
      }
    });
    return () => { vivo = false; };
  }, []);

  const cargar = useCallback(async (fresco: boolean) => {
    setCargando(true);
    try {
      // Tras un cambio de datos se piden "frescos" (sin la copia de 20 s del servidor).
      const res = await fetch(`/api/correctivos/avisos${fresco ? "?fresco=1" : ""}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudieron obtener las notificaciones");
      setItems(data.data ?? []);
      setTruncado(data.truncado ? Number(data.revisados) || null : null);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron obtener las notificaciones");
    } finally {
      setCargando(false);
    }
  }, []);

  // Se vuelve a pedir cuando cambia la lista (p. ej. al eliminar un ticket), con una pequeña espera.
  useEffect(() => {
    // Al abrir la lista se piden enseguida; tras un cambio, con una pequeña espera (por si vienen varios).
    const t = setTimeout(() => void cargar(refrescar > 0), refrescar > 0 ? 400 : 0);
    return () => clearTimeout(t);
  }, [refrescar, cargar]);

  function cambiarActivas(nuevas: ClaveAlerta[]) {
    setActivas(nuevas);
    if (tipo && !nuevas.includes(tipo)) setTipo("");
    try {
      localStorage.setItem("lista:avisos", JSON.stringify(nuevas));
    } catch {
      /* vale solo para esta sesión */
    }
  }
  function alternarAbierto() {
    const v = !abierto;
    setAbierto(v);
    try {
      localStorage.setItem("lista:avisos-abierto", v ? "1" : "0");
    } catch {
      /* ignorar */
    }
  }

  const cuentasTodas: Partial<Record<ClaveAlerta, number>> = {};
  for (const i of items) cuentasTodas[i.clave] = (cuentasTodas[i.clave] ?? 0) + 1;
  const visibles = items.filter((i) => activas.includes(i.clave));
  const mostrados = tipo ? visibles.filter((i) => i.clave === tipo) : visibles;
  const hayUrgentes = visibles.some((i) => i.tono === "rojo");

  return (
    <section className="mb-4 rounded-lg border border-line bg-white shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <button
          type="button"
          onClick={alternarAbierto}
          aria-expanded={abierto}
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <span aria-hidden="true">{abierto ? "▾" : "▸"}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-slate-ink"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></svg>
          Notificaciones
          {!cargando && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-mono-tag ${
                visibles.length === 0
                  ? "bg-concrete-dim text-ink-soft"
                  : hayUrgentes
                    ? "bg-danger-soft text-danger"
                    : "bg-aviso-soft text-aviso"
              }`}
            >
              {visibles.length}
            </span>
          )}
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void cargar(true)}
            disabled={cargando}
            className="text-xs text-ink-soft hover:text-ink hover:underline disabled:opacity-50"
          >
            {cargando ? "Actualizando…" : "Actualizar"}
          </button>
          <OpcionesAlertas activas={activas} cuentas={cuentasTodas} onCambiar={cambiarActivas} />
        </div>
      </div>

      {abierto && (
        <div className="border-t border-line px-4 py-3">
          {error && <p className="mb-2 text-sm text-danger">{error}</p>}
          {truncado !== null && (
            <p className="mb-2 text-xs text-aviso">
              Solo se revisaron los {truncado.toLocaleString("es-PE")} tickets más recientes: los más antiguos no aparecen aquí.
            </p>
          )}

          {visibles.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => { setTipo(""); setLimite(POR_TANDA); }}
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  tipo === "" ? "border-ink bg-ink text-white" : "border-line-strong hover:bg-concrete-dim"
                }`}
              >
                Todas ({visibles.length})
              </button>
              {ALERTAS.filter((a) => activas.includes(a.clave) && (cuentasTodas[a.clave] ?? 0) > 0).map((a) => (
                <button
                  key={a.clave}
                  type="button"
                  onClick={() => { setTipo(tipo === a.clave ? "" : a.clave); setLimite(POR_TANDA); }}
                  title={a.ayuda}
                  className={`rounded-full border px-2.5 py-1 text-xs ${
                    tipo === a.clave ? "border-ink bg-ink text-white" : "border-line-strong hover:bg-concrete-dim"
                  }`}
                >
                  {a.nombre} ({cuentasTodas[a.clave]})
                </button>
              ))}
            </div>
          )}

          {!cargando && !error && mostrados.length === 0 ? (
            <p className="text-sm text-ink-soft">
              {activas.length === 0
                ? "No hay tipos de notificación activos. Actívalos en “Avisos”."
                : "No hay notificaciones pendientes."}
            </p>
          ) : (
            <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-md border border-line text-sm">
              {mostrados.slice(0, limite).map((i) => (
                <li key={`${i.id}-${i.clave}`}>
                  <button
                    type="button"
                    onClick={() => router.push(`/correctivos/${i.id}`)}
                    title={i.titulo}
                    className="flex w-full items-baseline gap-3 px-3 py-2 text-left hover:bg-page"
                  >
                    <span className={`w-44 shrink-0 text-[11px] font-mono-tag font-semibold ${CLASE_TONO_ALERTA[i.tono]}`}>
                      {i.texto}
                    </span>
                    <span className="w-24 shrink-0 text-xs font-mono-tag text-ink-soft">#{i.refer ?? i.id}</span>
                    <span className="w-32 shrink-0 truncate text-xs font-mono-tag text-ink-soft">{i.n_oc || "—"}</span>
                    <span className="min-w-0 flex-1 truncate">{i.descripcion}</span>
                  </button>
                </li>
              ))}
              {mostrados.length > limite && (
                <li>
                  <button
                    type="button"
                    onClick={() => setLimite((n) => n + POR_TANDA)}
                    className="w-full px-3 py-2 text-left text-xs font-medium text-teal hover:bg-page"
                  >
                    Mostrar {Math.min(POR_TANDA, mostrados.length - limite)} más (de {mostrados.length - limite} restantes)
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// ───────── Opciones de avisos (antes OpcionesAlertas.tsx) ─────────
/**
 * Menú para elegir qué avisos se muestran en la columna Estado. Cada opción indica cuántos tickets
 * de la página actual tienen ese aviso. La elección se guarda en este navegador.
 */
function OpcionesAlertas({
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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>
        Tipos de aviso
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
