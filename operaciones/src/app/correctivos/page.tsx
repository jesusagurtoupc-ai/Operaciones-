"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TopNav from "@/components/layout/TopNav";
import { useMe } from "@/lib/client/useMe";
import GuardarCarpeta from "@/components/ticket/GuardarCarpeta";
import EstadoBadge from "@/components/ticket/EstadoBadge";
import {
  ESTADOS,
  DOCUMENTOS,
} from "@/lib/shared/opciones";
import type { Correctivo } from "@/lib/shared/types";
import { formatoSoles, formatoFecha } from "@/lib/shared/formato";
import AvanceDocs from "@/components/lista/AvanceDocs";
import TarjetaEstado from "@/components/lista/TarjetaEstado";
import GrupoChips from "@/components/lista/GrupoChips";
import {
  DIMENSIONES,
  FILTROS_VACIOS,
  FACETAS_VACIAS,
  TITULO_GRUPO,
  ACENTO_ESTADO,
  construirParams,
  unirOrdenado,
  diasAtraso,
  type Dimension,
  type Filtros,
  type ItemFaceta,
  type Facetas,
} from "@/components/lista/filtrosLista";

export default function CorrectivosPage() {
  const router = useRouter();
  const me = useMe();
  const esAdmin = me?.rol === "admin";
  const [rows, setRows] = useState<Correctivo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [resumen, setResumen] = useState({ total: 0, monto: 0 });
  const [facetas, setFacetas] = useState<Facetas>(FACETAS_VACIAS);
  // Todas las opciones que existen en los datos. Se acumulan para que las
  // tarjetas no aparezcan y desaparezcan al filtrar (solo se atenúan).
  const [catalogo, setCatalogo] = useState<Record<Dimension, string[]>>({
    estado: [...ESTADOS],
    tipo_trab: [],
    sub_tipo_trab: [],
    lugar: [],
    area: [],
    sin: DOCUMENTOS.map((d) => d.nombre),
  });

  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS);
  // Siempre apunta a los filtros más recientes (para el retardo de la búsqueda).
  const filtrosActuales = useRef<Filtros>(FILTROS_VACIOS);
  useEffect(() => {
    filtrosActuales.current = filtros;
  }, [filtros]);

  // Si se hacen varios clics seguidos, las respuestas pueden llegar en
  // desorden; solo la solicitud más reciente actualiza la pantalla.
  const solicitud = useRef(0);

  // `cargar` recibe los filtros explícitamente (en vez de leerlos del
  // estado del componente) para no depender de un closure que podría
  // quedar desactualizado justo después de un setFiltros().
  const cargar = useCallback(async (p: number, f: Filtros, soloPagina = false) => {
    const id = ++solicitud.current;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/correctivos?${construirParams(f, p, soloPagina).toString()}`);
      const data = await res.json();
      if (id !== solicitud.current) return;
      if (!res.ok) throw new Error(data?.error || "Error");

      setRows(data.data ?? []);
      setTotalPages(data.pagination?.totalPages || 1);
      setTotal(data.pagination?.total || 0);
      setPage(p);
      if (soloPagina) return; // cambio de página: tarjetas y resumen siguen igual
      setResumen(data.resumen ?? { total: data.pagination?.total || 0, monto: 0 });

      const nuevas: Facetas = { ...FACETAS_VACIAS, ...(data.facetas ?? {}) };
      setFacetas(nuevas);
      setCatalogo((prev) => {
        const sig = { ...prev };
        for (const dim of DIMENSIONES) {
          sig[dim] = unirOrdenado(dim, prev[dim], nuevas[dim].map((i) => i.valor));
        }
        return sig;
      });
    } catch {
      if (id === solicitud.current) {
        setError("No se pudieron cargar los tickets. Revisa tu conexión e intenta de nuevo.");
      }
    } finally {
      if (id === solicitud.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar(1, FILTROS_VACIOS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cualquier cambio de filtro se aplica al instante, sin botón "Filtrar".
  function aplicarCambio(cambios: Partial<Filtros>) {
    const nuevos = { ...filtros, ...cambios };
    setFiltros(nuevos);
    cargar(1, nuevos);
  }

  // Tarjeta/opción: si estaba elegida se quita, si no se agrega (selección
  // múltiple dentro de cada categoría).
  function alternar(dim: Dimension, valor: string) {
    const actuales = filtros[dim];
    const nuevos = actuales.includes(valor)
      ? actuales.filter((v) => v !== valor)
      : [...actuales, valor];
    aplicarCambio({ [dim]: nuevos } as Partial<Filtros>);
  }

  // El texto de búsqueda se ve al instante, pero la consulta se manda un
  // instante después de que la persona deja de escribir.
  const primerRender = useRef(true);
  useEffect(() => {
    if (primerRender.current) {
      primerRender.current = false;
      return;
    }
    const t = setTimeout(() => {
      cargar(1, filtrosActuales.current);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtros.q]);

  function limpiarFiltros() {
    setFiltros(FILTROS_VACIOS);
    cargar(1, FILTROS_VACIOS);
  }

  /* ───── Vistas guardadas (solo en este navegador, vía localStorage) ───── */
  const [vistas, setVistas] = useState<{ nombre: string; filtros: Filtros }[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("correctivos_vistas");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setVistas(JSON.parse(raw));
    } catch {
      // localStorage no disponible (modo incógnito, etc.): se ignora.
    }
  }, []);

  function persistirVistas(nuevas: { nombre: string; filtros: Filtros }[]) {
    setVistas(nuevas);
    try {
      localStorage.setItem("correctivos_vistas", JSON.stringify(nuevas));
    } catch {
      // si falla el guardado no rompemos la app, solo no persiste.
    }
  }

  function guardarVistaActual() {
    const nombre = window.prompt(
      "Nombre para esta combinación de filtros (ej. \"Pendientes pabellón A\")"
    );
    if (!nombre || !nombre.trim()) return;
    const limpio = nombre.trim();
    const sinDuplicado = vistas.filter((v) => v.nombre !== limpio);
    persistirVistas([...sinDuplicado, { nombre: limpio, filtros }]);
  }

  function aplicarVista(v: { nombre: string; filtros: Filtros }) {
    setFiltros(v.filtros);
    cargar(1, v.filtros);
  }

  function eliminarVista(nombre: string, e: React.MouseEvent) {
    e.stopPropagation();
    persistirVistas(vistas.filter((v) => v.nombre !== nombre));
  }

  async function eliminar(id: number) {
    if (!confirm("¿Eliminar este correctivo? Esta acción no se puede deshacer.")) return;
    const res = await fetch(`/api/correctivos/${id}`, { method: "DELETE" });
    if (res.ok) {
      cargar(page, filtros);
    } else {
      alert("No se pudo eliminar el registro");
    }
  }

  /** Trae todos los tickets que cumplen los filtros actuales (de 200 en 200). */
  async function cargarTodosFiltrados() {
    const todos: Correctivo[] = [];
    for (let p = 1; ; p++) {
      const params = construirParams(filtros, p);
      params.set("pageSize", "200");
      const res = await fetch(`/api/correctivos?${params.toString()}`);
      if (!res.ok) throw new Error("No se pudo leer la lista de tickets");
      const d = await res.json();
      todos.push(...d.data);
      if (p >= d.pagination.totalPages) break;
    }
    return todos;
  }

  function exportar() {
    window.open(`/api/export?${construirParams(filtros).toString()}`, "_blank");
  }

  const activos =
    (filtros.q ? 1 : 0) +
    (filtros.desde ? 1 : 0) +
    (filtros.hasta ? 1 : 0) +
    DIMENSIONES.reduce((n, d) => n + filtros[d].length, 0);

  // Une el catálogo (opciones que existen) con los conteos actuales.
  function itemsDe(dim: Dimension): ItemFaceta[] {
    const porValor = new Map(facetas[dim].map((i) => [i.valor, i]));
    return catalogo[dim].map((v) => porValor.get(v) ?? { valor: v, cantidad: 0, monto: 0 });
  }

  const input =
    "w-full border border-line rounded-md px-2.5 py-1.5 bg-white text-sm focus:outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-200/70";
  const label = "block text-xs font-medium text-ink-soft mb-1";

  return (
    <div className="min-h-screen bg-page">
      <TopNav />
      <main className="max-w-7xl mx-auto px-5 py-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-6">
          <h1 className="font-display font-700 text-4xl tracking-tight">Correctivos</h1>
          <div className="flex gap-2 flex-wrap items-start">
            <GuardarCarpeta
              cargarTodos={cargarTodosFiltrados}
              etiqueta="Guardar vista en carpeta"
            />
            <button
              onClick={exportar}
              className="border border-line-strong rounded-md px-4 py-2 text-sm font-medium hover:bg-concrete-dim transition-colors"
            >
              Exportar Excel
            </button>
            {esAdmin && (
              <Link
                href="/correctivos/nuevo"
                className="bg-amber text-white border border-amber rounded-md px-4 py-2 text-sm font-medium hover:bg-amber-hover hover:border-amber-hover transition-colors"
              >
                + Nuevo Ticket
              </Link>
            )}
          </div>
        </div>

        {/* ───── Panel de filtros con KPI ───── */}
        <section className="bg-white border border-line rounded-lg shadow-card mb-6">
          {/* Resumen de lo que se está viendo */}
          <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 border-b border-line bg-concrete-dim">
            <div className="flex items-end gap-8">
              <div>
                <span className={label + " !mb-0"}>Tickets</span>
                <span className="font-display font-700 text-3xl leading-none">
                  {resumen.total}
                </span>
              </div>
              <div>
                <span className={label + " !mb-0"}>Monto</span>
                <span className="font-display font-700 text-3xl leading-none text-ink">
                  {formatoSoles(resumen.monto, 0)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden md:inline text-xs text-ink-soft">
                Toca una o varias tarjetas para filtrar
              </span>
              {activos > 0 && (
                <button
                  type="button"
                  onClick={guardarVistaActual}
                  className="border border-line-strong rounded-md bg-white px-3 py-1.5 text-xs font-medium hover:bg-concrete-dim transition-colors"
                >
                  Guardar vista
                </button>
              )}
              {activos > 0 && (
                <button
                  type="button"
                  onClick={limpiarFiltros}
                  className="border border-line-strong rounded-md bg-white px-3 py-1.5 text-xs font-medium hover:bg-concrete-dim transition-colors"
                >
                  Limpiar filtros ({activos})
                </button>
              )}
            </div>
          </div>

          {vistas.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line bg-white">
              <span className="text-xs font-medium text-ink-soft mr-1">
                Vistas guardadas:
              </span>
              {vistas.map((v) => (
                <button
                  key={v.nombre}
                  type="button"
                  onClick={() => aplicarVista(v)}
                  className="group flex items-center gap-1.5 border border-line rounded-md px-2.5 py-1 text-xs hover:border-line-strong hover:bg-concrete-dim transition-colors"
                >
                  {v.nombre}
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => eliminarVista(v.nombre, e)}
                    className="text-ink-soft hover:text-ink"
                    title="Eliminar esta vista"
                  >
                    ×
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="p-4 space-y-5">
            {/* Búsqueda y fechas */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="col-span-2">
                <label className={label}>Buscar</label>
                <input
                  className={input}
                  placeholder="Descripción, ticket, proveedor…"
                  value={filtros.q}
                  onChange={(e) => setFiltros({ ...filtros, q: e.target.value })}
                />
              </div>
              <div>
                <label className={label}>Desde</label>
                <input
                  type="date"
                  className={input}
                  value={filtros.desde}
                  onChange={(e) => aplicarCambio({ desde: e.target.value })}
                />
              </div>
              <div>
                <label className={label}>Hasta</label>
                <input
                  type="date"
                  className={input}
                  value={filtros.hasta}
                  onChange={(e) => aplicarCambio({ hasta: e.target.value })}
                />
              </div>
            </div>

            {/* Estado: tarjetas KPI */}
            <div>
              <p className={label + " !mb-2"}>
                Estado
                {filtros.estado.length > 0 && (
                  <span className="ml-2 text-ink-soft">
                    · {filtros.estado.length} elegido{filtros.estado.length === 1 ? "" : "s"}
                  </span>
                )}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                {itemsDe("estado").map((it) => (
                  <TarjetaEstado
                    key={it.valor}
                    etiqueta={it.valor}
                    cantidad={it.cantidad}
                    monto={it.monto}
                    acento={ACENTO_ESTADO[it.valor] ?? "#8c8c90"}
                    activa={filtros.estado.includes(it.valor)}
                    onClick={() => alternar("estado", it.valor)}
                  />
                ))}
              </div>
            </div>

            {/* Resto de categorías: opciones con contador */}
            <div className="grid md:grid-cols-2 gap-x-8 gap-y-5 pt-4 border-t border-line">
              {(["tipo_trab", "sub_tipo_trab", "lugar", "area", "sin"] as const).map((dim) => (
                <GrupoChips
                  key={dim}
                  titulo={TITULO_GRUPO[dim]}
                  items={itemsDe(dim)}
                  seleccionados={filtros[dim]}
                  onAlternar={(v) => alternar(dim, v)}
                />
              ))}
            </div>
          </div>
        </section>

        {error && (
          <p className="mb-4 text-sm text-danger bg-danger-soft border border-danger/30 px-3 py-2">
            {error}
          </p>
        )}

        {/* ───── Tabla ───── */}
        <div
          className={`bg-white border border-line rounded-lg shadow-card overflow-x-auto transition-opacity ${
            loading && rows.length > 0 ? "opacity-50" : ""
          }`}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-page">
                <th className="text-left px-4 py-3 text-xs font-medium text-ink-soft">Ref</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-ink-soft">F. Registro</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-ink-soft">Descripción</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-ink-soft">Lugar</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-ink-soft">Proveedor</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-ink-soft">Monto</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-ink-soft">Estado</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-ink-soft">Docs</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-ink-soft">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-ink-soft text-sm">
                    Cargando…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-ink-soft text-sm">
                    No hay tickets con esta combinación de filtros.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    onClick={() => {
                      // No abrir si la persona estaba seleccionando texto.
                      if (window.getSelection()?.toString()) return;
                      router.push(`/correctivos/${r.id}`);
                    }}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && e.key === "Enter") {
                        router.push(`/correctivos/${r.id}`);
                      }
                    }}
                    className="border-b border-line last:border-b-0 hover:bg-page cursor-pointer focus:outline-none focus:bg-page"
                  >
                    <td className="px-4 py-3.5 font-mono-tag text-xs">{r.refer ?? r.id}</td>
                    <td className="px-4 py-3.5 whitespace-nowrap">{formatoFecha(r.f_reg)}</td>
                    <td className="px-4 py-3.5 max-w-xs truncate" title={r.descripcion}>{r.descripcion}</td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-ink-soft">{r.lugar || "—"}</td>
                    <td className="px-4 py-3.5 whitespace-nowrap">{r.proveedor || "—"}</td>
                    <td className="px-4 py-3.5 text-right font-mono-tag tabular-nums whitespace-nowrap">
                      {formatoSoles(r.monto)}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <EstadoBadge estado={r.estado} />
                      {diasAtraso(r) !== null && (
                        <span
                          className="ml-2 text-[11px] font-mono-tag text-danger font-semibold"
                          title={`Lleva ${diasAtraso(r)} días en este estado`}
                        >
                          ⚠ {diasAtraso(r)} d
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <AvanceDocs documentos={r.documentos} />
                    </td>
                    <td className="px-4 py-3.5 text-right whitespace-nowrap">
                      <Link
                        href={`/correctivos/${r.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs font-medium text-teal hover:underline mr-3"
                      >
                        {esAdmin ? "Editar" : "Ver"}
                      </Link>
                      {esAdmin && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            eliminar(r.id);
                          }}
                          className="text-xs font-medium text-danger hover:underline"
                        >
                          Eliminar
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-4">
          <span className="text-xs text-ink-soft">
            {total} registro{total === 1 ? "" : "s"} · página {page} de {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => cargar(page - 1, filtros, true)}
              className="border border-line-strong rounded-md px-3 py-1 text-xs font-medium disabled:opacity-30 hover:bg-concrete-dim"
            >
              ← Anterior
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => cargar(page + 1, filtros, true)}
              className="border border-line-strong rounded-md px-3 py-1 text-xs font-medium disabled:opacity-30 hover:bg-concrete-dim"
            >
              Siguiente →
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
