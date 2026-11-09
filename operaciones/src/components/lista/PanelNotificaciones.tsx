"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import OpcionesAlertas from "@/components/lista/OpcionesAlertas";
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
export default function PanelNotificaciones({ refrescar }: { refrescar: unknown }) {
  const router = useRouter();
  const [items, setItems] = useState<AvisoItem[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [activas, setActivas] = useState<ClaveAlerta[]>(ALERTAS_POR_DEFECTO);
  const [abierto, setAbierto] = useState(true);
  const [tipo, setTipo] = useState<ClaveAlerta | "">("");

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

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch("/api/correctivos/avisos", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudieron obtener las notificaciones");
      setItems(data.data ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron obtener las notificaciones");
    } finally {
      setCargando(false);
    }
  }, []);

  // Se vuelve a pedir cuando cambia la lista (p. ej. al eliminar un ticket), con una pequeña espera.
  useEffect(() => {
    const t = setTimeout(() => void cargar(), 400);
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
          🔔 Notificaciones
          {!cargando && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-mono-tag ${
                visibles.length === 0
                  ? "bg-concrete-dim text-ink-soft"
                  : hayUrgentes
                    ? "bg-danger-soft text-danger"
                    : "bg-amber-100 text-amber-800"
              }`}
            >
              {visibles.length}
            </span>
          )}
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void cargar()}
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

          {visibles.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setTipo("")}
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
                  onClick={() => setTipo(tipo === a.clave ? "" : a.clave)}
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
              {mostrados.map((i) => (
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
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
