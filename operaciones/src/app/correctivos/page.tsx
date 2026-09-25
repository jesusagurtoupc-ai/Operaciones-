"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import EstadoBadge from "@/components/EstadoBadge";
import { ESTADOS, TIPOS_TRAB, AREAS, LUGARES } from "@/lib/opciones";
import type { Correctivo } from "@/lib/types";
import { toDateOnly } from "@/lib/types";

function formatoSoles(n: number | null) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "PEN",
    maximumFractionDigits: 2,
  }).format(n);
}

function formatoFecha(f: string | null) {
  const soloFecha = toDateOnly(f);
  if (!soloFecha) return "—";
  // "T00:00:00" (sin "Z") fuerza a interpretar la fecha en hora local
  // en vez de UTC, evitando que se corra un día según la zona horaria
  // del navegador.
  const d = new Date(soloFecha + "T00:00:00");
  return d.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const FILTROS_VACIOS = {
  q: "",
  estado: "",
  area: "",
  tipo_trab: "",
  lugar: "",
  desde: "",
  hasta: "",
};

type Filtros = typeof FILTROS_VACIOS;

function construirParams(f: Filtros, p: number) {
  const params = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  params.set("page", String(p));
  params.set("pageSize", "25");
  return params;
}

export default function CorrectivosPage() {
  const [rows, setRows] = useState<Correctivo[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS);

  // `cargar` recibe los filtros explícitamente (en vez de leerlos del
  // estado del componente) para evitar depender de un closure que
  // podría quedar desactualizado justo después de un setFiltros().
  const cargar = useCallback(async (p: number, f: Filtros) => {
    setLoading(true);
    const res = await fetch(`/api/correctivos?${construirParams(f, p).toString()}`);
    const data = await res.json();
    setRows(data.data || []);
    setTotalPages(data.pagination?.totalPages || 1);
    setTotal(data.pagination?.total || 0);
    setPage(p);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar(1, FILTROS_VACIOS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function aplicarFiltros(e: React.FormEvent) {
    e.preventDefault();
    cargar(1, filtros);
  }

  function limpiarFiltros() {
    setFiltros(FILTROS_VACIOS);
    cargar(1, FILTROS_VACIOS);
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

  function exportar() {
    const params = construirParams(filtros, 1);
    params.delete("page");
    params.delete("pageSize");
    window.open(`/api/export?${params.toString()}`, "_blank");
  }


  const input =
    "w-full border border-line px-2.5 py-1.5 bg-white text-sm focus:outline-none focus:border-ink";
  const label = "block text-[10px] font-mono-tag uppercase tracking-widest text-ink-soft mb-1";

  return (
    <div className="min-h-screen bg-concrete">
      <TopNav />
      <main className="max-w-7xl mx-auto px-5 py-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-6">
          <h1 className="font-display font-700 text-4xl tracking-tight">Correctivos</h1>
          <div className="flex gap-2">
            <button
              onClick={exportar}
              className="border-2 border-ink px-4 py-2 text-sm font-mono-tag uppercase tracking-wide hover:bg-ink hover:text-concrete transition-colors"
            >
              Exportar Excel
            </button>
            <Link
              href="/correctivos/nuevo"
              className="bg-amber border-2 border-ink px-4 py-2 text-sm font-mono-tag uppercase tracking-wide hover:bg-ink hover:text-amber transition-colors"
            >
              + Nuevo Ticket
            </Link>
          </div>
        </div>

        <form
          onSubmit={aplicarFiltros}
          className="bg-white border-2 border-ink p-4 mb-6 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-9 gap-3 items-end"
        >
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
            <label className={label}>Estado</label>
            <select
              className={input}
              value={filtros.estado}
              onChange={(e) => setFiltros({ ...filtros, estado: e.target.value })}
            >
              <option value="">Todos</option>
              {ESTADOS.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Área</label>
            <select
              className={input}
              value={filtros.area}
              onChange={(e) => setFiltros({ ...filtros, area: e.target.value })}
            >
              <option value="">Todas</option>
              {AREAS.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Tipo</label>
            <select
              className={input}
              value={filtros.tipo_trab}
              onChange={(e) => setFiltros({ ...filtros, tipo_trab: e.target.value })}
            >
              <option value="">Todos</option>

              {TIPOS_TRAB.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Lugar</label>
            <select
              className={input}
              value={filtros.lugar}
              onChange={(e) => setFiltros({ ...filtros, lugar: e.target.value })}
            >
              <option value="">Todos</option>
              {LUGARES.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Desde</label>
            <input
              type="date"
              className={input}
              value={filtros.desde}
              onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })}
            />
          </div>
          <div>
            <label className={label}>Hasta</label>
            <input
              type="date"
              className={input}
              value={filtros.hasta}
              onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })}
            />
          </div>
          <div className="flex gap-2 col-span-2 md:col-span-1 lg:col-span-1">
            <button
              type="submit"
              className="flex-1 bg-ink text-concrete text-sm font-mono-tag uppercase tracking-wide py-1.5 hover:bg-amber hover:text-ink transition-colors"
            >
              Filtrar
            </button>
            <button
              type="button"
              onClick={limpiarFiltros}
              className="border border-line text-sm font-mono-tag uppercase tracking-wide px-3 py-1.5 hover:border-ink transition-colors"
            >
              Limpiar
            </button>
          </div>
        </form>

        <div className="bg-white border-2 border-ink overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-ink bg-concrete-dim">
                <th className="text-left px-3 py-2 font-mono-tag text-[11px] uppercase tracking-wide">Ref</th>
                <th className="text-left px-3 py-2 font-mono-tag text-[11px] uppercase tracking-wide">F. Registro</th>
                <th className="text-left px-3 py-2 font-mono-tag text-[11px] uppercase tracking-wide">Descripción</th>
                <th className="text-left px-3 py-2 font-mono-tag text-[11px] uppercase tracking-wide">Lugar</th>
                <th className="text-left px-3 py-2 font-mono-tag text-[11px] uppercase tracking-wide">Proveedor</th>
                <th className="text-right px-3 py-2 font-mono-tag text-[11px] uppercase tracking-wide">Monto</th>
                <th className="text-left px-3 py-2 font-mono-tag text-[11px] uppercase tracking-wide">Estado</th>
                <th className="text-right px-3 py-2 font-mono-tag text-[11px] uppercase tracking-wide">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-10 font-mono-tag text-ink-soft text-sm">
                    Cargando…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-10 font-mono-tag text-ink-soft text-sm">
                    No se encontraron correctivos con estos filtros.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="stub-edge border-b border-line hover:bg-concrete-dim/60">
                    <td className="px-3 py-2 font-mono-tag text-xs">{r.refer ?? r.id}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatoFecha(r.f_reg)}</td>
                    <td className="px-3 py-2 max-w-xs truncate" title={r.descripcion}>{r.descripcion}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-ink-soft">{r.lugar || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.proveedor || "—"}</td>
                    <td className="px-3 py-2 text-right font-mono-tag whitespace-nowrap">
                      {formatoSoles(r.monto)}
                    </td>
                    <td className="px-3 py-2"><EstadoBadge estado={r.estado} /></td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Link
                        href={`/correctivos/${r.id}`}
                        className="text-xs font-mono-tag uppercase text-teal hover:underline mr-3"
                      >
                        Editar
                      </Link>
                      <button
                        onClick={() => eliminar(r.id)}
                        className="text-xs font-mono-tag uppercase text-danger hover:underline"
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-4">
          <span className="font-mono-tag text-xs text-ink-soft">
            {total} registro{total === 1 ? "" : "s"} · página {page} de {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => cargar(page - 1, filtros)}
              className="border border-line px-3 py-1 text-xs font-mono-tag uppercase disabled:opacity-30 hover:border-ink"
            >
              ← Anterior
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => cargar(page + 1, filtros)}
              className="border border-line px-3 py-1 text-xs font-mono-tag uppercase disabled:opacity-30 hover:border-ink"
            >
              Siguiente →
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
