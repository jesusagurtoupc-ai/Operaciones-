"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/layout/TopNav";
import { useDialogos } from "@/components/ui/Dialogos";

type Eliminado = {
  id: number;
  refer: number | null;
  ticket: string | null;
  descripcion: string;
  estado: string;
  proveedor: string | null;
  eliminado_en: string;
  eliminado_por: string | null;
};

const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-PE", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function EliminadosPage() {
  const { confirmar, dialogos } = useDialogos();
  const [filas, setFilas] = useState<Eliminado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const cargar = useCallback(async () => {
    const res = await fetch("/api/correctivos/eliminados");
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.error || "No se pudo cargar la lista");
    } else {
      setFilas(d.data);
    }
    setCargando(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar();
  }, [cargar]);

  async function restaurar(f: Eliminado) {
    const ok = await confirmar({
      titulo: `¿Restaurar el ticket #${f.refer ?? f.id}?`,
      mensaje: "Volverá a verse en la lista, el panel y el Excel.",
      boton: "Restaurar",
    });
    if (!ok) return;
    setError("");
    setAviso("");
    const res = await fetch(`/api/correctivos/${f.id}/restaurar`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.error || "No se pudo restaurar el ticket");
      return;
    }
    setAviso(
      d.referNuevo
        ? `Ticket restaurado. Su N° Refer. original ya estaba en uso, así que ahora es el ${d.referNuevo}.`
        : "Ticket restaurado."
    );
    await cargar();
  }

  return (
    <div className="min-h-screen bg-page">
      <TopNav />
      <main className="max-w-6xl mx-auto px-5 py-8">
        <h1 className="font-display font-700 text-4xl tracking-tight mb-2">Eliminados</h1>
        <p className="text-sm text-ink-soft mb-6">
          Los tickets eliminados se ocultan pero conservan sus archivos e historial. Desde aquí se
          pueden restaurar.{" "}
          <Link href="/correctivos" className="underline">
            Volver a Correctivos
          </Link>
        </p>

        {error && (
          <p role="alert" className="text-sm text-danger bg-[var(--danger-soft)] border border-danger/30 px-3 py-2 mb-4">
            {error}
          </p>
        )}
        {aviso && (
          <p role="status" className="text-sm bg-teal-soft border border-teal/30 px-3 py-2 mb-4">
            {aviso}
          </p>
        )}

        <div className="bg-white border border-line rounded-lg shadow-card overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Tickets eliminados</caption>
            <thead>
              <tr className="border-b border-line text-left">
                <th scope="col" className="px-3 py-2 text-xs font-semibold">Ref.</th>
                <th scope="col" className="px-3 py-2 text-xs font-semibold">Ticket</th>
                <th scope="col" className="px-3 py-2 text-xs font-semibold">Descripción</th>
                <th scope="col" className="px-3 py-2 text-xs font-semibold">Eliminado</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {cargando && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-ink-soft">Cargando...</td>
                </tr>
              )}
              {!cargando && filas.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-ink-soft">
                    No hay tickets eliminados.
                  </td>
                </tr>
              )}
              {filas.map((f) => (
                <tr key={f.id} className="border-b border-line align-top">
                  <td className="px-3 py-2 font-mono-tag text-xs">{f.refer ?? f.id}</td>
                  <td className="px-3 py-2">{f.ticket ?? "—"}</td>
                  <td className="px-3 py-2 max-w-md">
                    <span className="line-clamp-2">{f.descripcion}</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-ink-soft">
                    {fechaHora(f.eliminado_en)}
                    {f.eliminado_por && <> · {f.eliminado_por}</>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => restaurar(f)}
                      className="text-xs font-medium hover:underline"
                    >
                      Restaurar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
      {dialogos}
    </div>
  );
}
