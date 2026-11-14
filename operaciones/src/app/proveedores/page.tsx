"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TopNav from "@/components/layout/TopNav";
import { claveProveedor, formatoSoles } from "@/lib/shared";

/**
 * Registro de proveedores (solo administradores): un nombre oficial por empresa.
 * Aquí se corrige el nombre oficial (y el RUC) y se unen los que quedaron duplicados; los tickets se
 * actualizan solos. Al cargar documentos, el sistema ya compara contra este registro.
 */

type Proveedor = {
  id: number;
  nombre: string;
  ruc: string | null;
  alias: string[];
  otros_ruc: string[];
  fuente: string | null;
  oc_ref: string | null;
  actualizado_oc: string | null;
  tickets: number;
  monto: number;
};

/** De dónde salió el nombre oficial, en palabras. */
function Origen({ p }: { p: Proveedor }) {
  if (p.fuente === "manual")
    return <span className="rounded bg-ink px-1.5 py-0.5 text-[10px] text-white" title="Lo fijó un administrador: las OC no lo cambian">📌 Fijado a mano</span>;
  if (p.fuente === "oc")
    return (
      <span className="rounded bg-teal-soft px-1.5 py-0.5 text-[10px] text-ink" title="Nombre y RUC tomados de la orden de compra">
        ✓ De la OC{p.oc_ref ? ` ${p.oc_ref}` : ""}{p.actualizado_oc ? ` · ${p.actualizado_oc.split("-").reverse().join("/")}` : ""}
      </span>
    );
  return <span className="rounded bg-concrete-dim px-1.5 py-0.5 text-[10px] text-ink-soft" title="Se actualizará con la próxima OC que se cargue">Sin OC aún</span>;
}

const inputCls =
  "w-full border border-line rounded-md px-2.5 py-1.5 bg-white text-sm focus:outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-200/70";

/** Grupos que PARECEN la misma empresa: misma primera palabra significativa y nombres que se contienen. */
function posiblesDuplicados(lista: Proveedor[]): Proveedor[][] {
  const grupos = new Map<string, Proveedor[]>();
  for (const p of lista) {
    const c = claveProveedor(p.nombre);
    const primera = c.split(" ").find((w) => w.length >= 3) ?? c;
    if (!primera) continue;
    grupos.set(primera, [...(grupos.get(primera) ?? []), p]);
  }
  const res: Proveedor[][] = [];
  for (const g of grupos.values()) {
    if (g.length < 2) continue;
    // Solo si alguno contiene al otro ("MSG" ⊂ "MSG PERU") y sus RUC no se contradicen.
    const claves = g.map((p) => claveProveedor(p.nombre));
    const unidos = g.filter((p, i) =>
      g.some((q, j) => j !== i && (claves[i].includes(claves[j]) || claves[j].includes(claves[i])) && (!p.ruc || !q.ruc || p.ruc === q.ruc))
    );
    if (unidos.length >= 2) res.push(unidos);
  }
  return res.slice(0, 20);
}

export default function ProveedoresPage() {
  const [lista, setLista] = useState<Proveedor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [texto, setTexto] = useState("");
  const [elegidos, setElegidos] = useState<number[]>([]);
  const [principal, setPrincipal] = useState<number | null>(null);
  const [editando, setEditando] = useState<{ id: number; nombre: string; ruc: string; fijar: boolean } | null>(null);
  const [pendientesOC, setPendientesOC] = useState(0);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    const res = await fetch("/api/proveedores");
    const d = await res.json().catch(() => ({}));
    setCargando(false);
    if (!res.ok) {
      setError(d.error || "No se pudo cargar la lista de proveedores");
      return;
    }
    setLista(d.data ?? []);
    setPendientesOC(d.pendientes ?? 0);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar();
  }, [cargar]);

  const filtrada = useMemo(() => {
    const palabras = claveProveedor(texto).split(" ").filter(Boolean);
    if (palabras.length === 0) return lista;
    return lista.filter((p) => {
      const donde = [p.nombre, ...p.alias].map(claveProveedor).join(" | ") + " " + (p.ruc ?? "");
      return palabras.every((w) => donde.includes(w));
    });
  }, [lista, texto]);
  const duplicados = useMemo(() => posiblesDuplicados(lista), [lista]);

  async function enviar(metodo: "PATCH" | "POST", cuerpo: unknown) {
    setOcupado(true);
    setError("");
    setAviso("");
    const res = await fetch("/api/proveedores", {
      method: metodo,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    const d = await res.json().catch(() => ({}));
    setOcupado(false);
    if (!res.ok) {
      setError(d.error || "No se pudo completar la acción");
      return null;
    }
    await cargar();
    return d.data;
  }

  async function guardarEdicion() {
    if (!editando) return;
    const r = await enviar("PATCH", {
      id: editando.id,
      nombre: editando.nombre,
      ruc: editando.ruc.trim() || null,
      fijar: editando.fijar,
    });
    if (r) {
      setAviso(`Nombre guardado. ${r.tickets} ticket${r.tickets === 1 ? "" : "s"} actualizado${r.tickets === 1 ? "" : "s"}.`);
      setEditando(null);
    }
  }

  async function unir(ids: number[], principalId: number) {
    const p = lista.find((x) => x.id === principalId);
    if (!p) return;
    const otros = ids.filter((x) => x !== principalId);
    if (!confirm(`¿Unir ${otros.length} proveedor${otros.length === 1 ? "" : "es"} en «${p.nombre}»? Sus tickets pasarán a ese nombre.`)) return;
    const r = await enviar("POST", { principal: principalId, otros });
    if (r) {
      setAviso(`Listo: ${r.unidos} unido${r.unidos === 1 ? "" : "s"} en «${r.nombre}» · ${r.tickets} ticket${r.tickets === 1 ? "" : "s"} actualizado${r.tickets === 1 ? "" : "s"}.`);
      setElegidos([]);
      setPrincipal(null);
    }
  }

  function alternar(id: number) {
    setElegidos((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]));
  }

  const elegidosObj = lista.filter((p) => elegidos.includes(p.id));
  const principalEf = principal && elegidos.includes(principal) ? principal : elegidosObj.sort((a, b) => b.tickets - a.tickets)[0]?.id ?? null;

  return (
    <div className="min-h-screen bg-page">
      <TopNav />
      <main className="max-w-6xl mx-auto px-5 py-8">
        <h1 className="font-display font-bold text-4xl tracking-tight mb-2">Proveedores</h1>
        <p className="text-sm text-ink-soft mb-6 max-w-3xl">
          Un solo nombre por empresa. Al crear o actualizar tickets (OC, cotizaciones, carga masiva o a mano), el
          proveedor se compara con esta lista —por <b>RUC</b> y, si no hay, por el <b>nombre</b> sin tildes, puntos
          ni «S.A.C.»— y se guarda con su nombre oficial. Las otras formas en que llegó escrito aparecen como
          variantes. <b>La OC manda:</b> cada vez que se carga una orden de compra, el proveedor toma la razón
          social y el RUC de la OC y sus tickets se actualizan (salvo que su nombre esté 📌 fijado a mano).
        </p>
        {pendientesOC > 0 && (
          <p className="mb-4 text-xs text-ink-soft">
            Revisando con las OC ya guardadas: faltan {pendientesOC} proveedor{pendientesOC === 1 ? "" : "es"}. Se
            completa solo en segundo plano (o recarga esta página para avanzar).
          </p>
        )}

        {error && <p className="text-sm text-danger bg-[var(--danger-soft)] border border-danger/30 px-3 py-2 mb-4">{error}</p>}
        {aviso && <p className="text-sm bg-teal-soft border border-teal/30 px-3 py-2 mb-4">{aviso}</p>}

        {duplicados.length > 0 && (
          <section className="mb-6 rounded-lg border border-amber/50 bg-amber/5 p-4">
            <h2 className="text-sm font-semibold mb-1">Posibles duplicados ({duplicados.length})</h2>
            <p className="text-xs text-ink-soft mb-3">
              Nombres parecidos que podrían ser la misma empresa. Revisa y únelos si corresponde: se conserva el que tiene más tickets.
            </p>
            <ul className="space-y-2">
              {duplicados.map((g) => {
                const princ = [...g].sort((a, b) => b.tickets - a.tickets)[0];
                return (
                  <li key={g.map((p) => p.id).join("-")} className="flex flex-wrap items-center gap-2 text-sm">
                    {g.map((p) => (
                      <span key={p.id} className="rounded-full border border-line bg-white px-2 py-0.5 text-xs">
                        {p.nombre} <span className="text-ink-soft">· {p.tickets}</span>
                        {p.ruc && <span className="text-ink-soft"> · RUC {p.ruc}</span>}
                      </span>
                    ))}
                    <button
                      type="button"
                      disabled={ocupado}
                      onClick={() => unir(g.map((p) => p.id), princ.id)}
                      className="text-xs font-medium text-teal hover:underline disabled:opacity-40"
                    >
                      Unir en «{princ.nombre}»
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar por nombre, variante o RUC…"
            className={`${inputCls} max-w-sm`}
          />
          <span className="text-xs text-ink-soft">
            {cargando ? "Cargando…" : `${filtrada.length} de ${lista.length} proveedores`}
          </span>
        </div>

        {elegidos.length >= 2 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-teal/40 bg-teal-soft px-3 py-2 text-sm">
            <span>Unir {elegidos.length} proveedores en:</span>
            <select
              className="rounded-md border border-line-strong bg-white px-2 py-1 text-sm"
              value={principalEf ?? ""}
              onChange={(e) => setPrincipal(Number(e.target.value))}
            >
              {elegidosObj.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} ({p.tickets} tickets)
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={ocupado || !principalEf}
              onClick={() => principalEf && unir(elegidos, principalEf)}
              className="rounded-md bg-ink px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
            >
              Unir
            </button>
            <button type="button" onClick={() => setElegidos([])} className="text-xs text-ink-soft hover:underline">
              Cancelar
            </button>
          </div>
        )}
        {elegidos.length === 1 && (
          <p className="mb-3 text-xs text-ink-soft">Marca al menos otro proveedor para unirlos.</p>
        )}

        <div className="overflow-x-auto rounded-lg border border-line bg-white shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-page text-left text-xs text-ink-soft">
              <tr>
                <th className="w-8 px-3 py-2" aria-label="Elegir" />
                <th className="px-3 py-2">Nombre oficial</th>
                <th className="px-3 py-2">RUC</th>
                <th className="px-3 py-2">Origen</th>
                <th className="px-3 py-2">Variantes recibidas</th>
                <th className="px-3 py-2 text-right">Tickets</th>
                <th className="px-3 py-2 text-right">Monto</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtrada.map((p) => {
                const ed = editando?.id === p.id ? editando : null;
                return (
                  <tr key={p.id} className="border-t border-line align-top">
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={elegidos.includes(p.id)} onChange={() => alternar(p.id)} aria-label={`Elegir ${p.nombre}`} />
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {ed ? (
                        <>
                          <input className={inputCls} value={ed.nombre} onChange={(e) => setEditando({ ...ed, nombre: e.target.value })} autoFocus />
                          <label className="mt-1 flex items-center gap-1.5 text-[11px] font-normal text-ink-soft">
                            <input type="checkbox" checked={ed.fijar} onChange={(e) => setEditando({ ...ed, fijar: e.target.checked })} />
                            Fijar este nombre (las OC que lleguen no lo cambian)
                          </label>
                        </>
                      ) : (
                        p.nombre
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono-tag text-xs">
                      {ed ? (
                        <input
                          className={inputCls}
                          value={ed.ruc}
                          inputMode="numeric"
                          maxLength={11}
                          placeholder="11 dígitos"
                          onChange={(e) => setEditando({ ...ed, ruc: e.target.value.replace(/\D/g, "") })}
                        />
                      ) : (
                        <>
                          {p.ruc ?? <span className="text-ink-soft">—</span>}
                          {p.otros_ruc.length > 0 && (
                            <span className="block text-[10px] text-ink-soft" title="RUC de proveedores unidos a este">
                              + {p.otros_ruc.join(", ")}
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Origen p={p} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {p.alias.length === 0 ? (
                          <span className="text-xs text-ink-soft">—</span>
                        ) : (
                          p.alias.map((a) => (
                            <span key={a} className="rounded bg-concrete-dim px-1.5 py-0.5 text-[11px] text-ink-soft">
                              {a}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono-tag">{p.tickets}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{p.monto > 0 ? formatoSoles(p.monto) : "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      {ed ? (
                        <>
                          <button type="button" disabled={ocupado} onClick={guardarEdicion} className="text-xs font-medium text-teal hover:underline">
                            Guardar
                          </button>
                          <button type="button" onClick={() => setEditando(null)} className="ml-2 text-xs text-ink-soft hover:underline">
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditando({ id: p.id, nombre: p.nombre, ruc: p.ruc ?? "", fijar: p.fuente === "manual" })}
                          className="text-xs font-medium hover:underline"
                        >
                          Editar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!cargando && filtrada.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-sm text-ink-soft">
                    {lista.length === 0 ? "Aún no hay proveedores registrados." : "Ningún proveedor coincide con la búsqueda."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
