"use client";

import { useState } from "react";
import { useMe } from "@/lib/useMe";
import { DOCUMENTOS, ESTADOS_DOC, ESTADO_DOC_COLORS } from "@/lib/opciones";
import type { DocumentoClave, DocumentoLinea, Documentos } from "@/lib/types";

const VACIA: DocumentoLinea = { numero: "", estado: "Pendiente", url: "" };

export default function DocumentosTicket({
  correctivoId,
  inicial,
  numeroOc,
}: {
  correctivoId: number;
  inicial: Documentos;
  numeroOc: string | null;
}) {
  const me = useMe();
  const esAdmin = me?.rol === "admin";
  const [docs, setDocs] = useState<Documentos>(inicial);
  const [editando, setEditando] = useState<DocumentoClave | null>(null);
  const [borrador, setBorrador] = useState<DocumentoLinea>(VACIA);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  // El N° de OC del ticket se muestra en la línea de OC si no se escribió otro.
  function linea(clave: DocumentoClave): DocumentoLinea {
    const d = { ...VACIA, ...(docs[clave] ?? {}) };
    if (clave === "oc" && !d.numero && numeroOc) d.numero = numeroOc;
    return d;
  }

  function abrirEdicion(clave: DocumentoClave) {
    setError("");
    setBorrador(linea(clave));
    setEditando(clave);
  }

  async function guardar() {
    if (!editando) return;
    setGuardando(true);
    setError("");
    const nuevos: Documentos = { ...docs, [editando]: borrador };
    try {
      const res = await fetch(`/api/correctivos/${correctivoId}/documentos`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nuevos),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo guardar");
      setDocs(data.data ?? nuevos);
      setEditando(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  const inputCls =
    "w-full border border-line px-2.5 py-1.5 bg-white text-sm focus:outline-none focus:border-ink";

  return (
    <section className="bg-white border-2 border-ink p-6 mt-6">
      <h3 className="font-mono-tag text-xs uppercase tracking-widest text-ink-soft border-b border-line pb-2 mb-4">
        Documentos
      </h3>

      {error && (
        <p className="text-sm text-danger bg-[var(--danger-soft)] border border-danger/30 px-3 py-2 mb-3">
          {error}
        </p>
      )}

      <ul className="space-y-2.5">
        {DOCUMENTOS.map(({ clave, nombre }) => {
          const d = linea(clave);
          if (editando === clave) {
            return (
              <li key={clave} className="rounded-lg bg-concrete-dim/60 px-4 py-3">
                <p className="font-medium mb-2">{nombre}</p>
                <div className="grid md:grid-cols-3 gap-3">
                  <input
                    className={inputCls}
                    placeholder="Número"
                    value={borrador.numero}
                    onChange={(e) => setBorrador({ ...borrador, numero: e.target.value })}
                  />
                  <select
                    className={inputCls}
                    value={borrador.estado}
                    onChange={(e) => setBorrador({ ...borrador, estado: e.target.value })}
                  >
                    {ESTADOS_DOC.map((e) => (
                      <option key={e} value={e}>{e}</option>
                    ))}
                  </select>
                  <input
                    className={inputCls}
                    placeholder="Enlace al documento (https://…)"
                    value={borrador.url}
                    onChange={(e) => setBorrador({ ...borrador, url: e.target.value })}
                  />
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    type="button"
                    disabled={guardando}
                    onClick={guardar}
                    className="bg-amber border-2 border-ink px-4 py-1 text-xs font-mono-tag uppercase tracking-wide text-white hover:bg-ink transition-colors disabled:opacity-50"
                  >
                    {guardando ? "Guardando..." : "Guardar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditando(null)}
                    className="border-2 border-ink px-4 py-1 text-xs font-mono-tag uppercase tracking-wide hover:bg-ink hover:text-concrete transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </li>
            );
          }
          return (
            <li
              key={clave}
              className="flex items-center justify-between gap-3 rounded-lg bg-concrete-dim/60 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="font-medium leading-tight">{nombre}</p>
                <p className="font-mono-tag text-xs text-ink-soft mt-0.5 truncate">
                  {d.numero || "—"}
                </p>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <span
                  className={`rounded-full px-3 py-0.5 text-xs font-semibold uppercase tracking-wide ${
                    ESTADO_DOC_COLORS[d.estado] ?? ESTADO_DOC_COLORS.Pendiente
                  }`}
                >
                  {d.estado}
                </span>
                {d.url ? (
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-ink-soft hover:text-ink hover:underline"
                  >
                    Ver documento ↗
                  </a>
                ) : (
                  <span className="text-sm text-ink-soft/50">Sin documento</span>
                )}
                {esAdmin && (
                  <button
                    type="button"
                    onClick={() => abrirEdicion(clave)}
                    className="text-xs font-mono-tag uppercase text-teal hover:underline"
                  >
                    Editar
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
