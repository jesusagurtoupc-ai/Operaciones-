"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DatosOC } from "@/lib/shared";
import { formatoFecha, formatoSoles } from "@/lib/shared";
import { leerOrdenCompra, prepararAutoguardado, autoGuardarTicket } from "@/lib/client";

type Base = "total" | "subtotal";

/**
 * Única forma de crear un ticket: se elige el PDF de la orden de compra, se leen sus datos, la
 * persona los revisa y recién entonces se crea. Lo que la OC no trae (ticket, lugar, tipo de trabajo,
 * fechas del proceso...) se completa después, en la pantalla del ticket.
 * Nada se guarda hasta presionar "Crear ticket".
 */
export default function NuevoDesdeOC() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [datos, setDatos] = useState<DatosOC | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState("");
  const [base, setBase] = useState<Base>("total");
  const [fechaOk, setFechaOk] = useState(false);

  const enSoles = !datos?.moneda || datos.moneda === "PEN";
  const ocEnUso = (datos?.otros_tickets.length ?? 0) > 0;
  const sinNumero = !!datos && !datos.n_oc;
  const monto = !datos ? null : base === "total" ? datos.total : datos.subtotal;
  const puedeCrear = !!datos && !!archivo && !ocEnUso && !sinNumero && !creando;

  function reiniciar() {
    setArchivo(null);
    setDatos(null);
    setError("");
    setBase("total");
    setFechaOk(false);
  }

  async function alElegir(files: FileList | null) {
    const elegido = files?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!elegido) return;
    reiniciar();
    setLeyendo(true);
    try {
      setDatos(await leerOrdenCompra(elegido, elegido.name));
      setArchivo(elegido);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer la orden de compra");
    } finally {
      setLeyendo(false);
    }
  }

  async function crear() {
    if (!puedeCrear || !archivo) return;
    setError("");
    setCreando(true);
    try {
      // Es un clic de la persona: buen momento para que el navegador vuelva a pedir el permiso de la carpeta local.
      await prepararAutoguardado();
      const fd = new FormData();
      fd.append("file", archivo, archivo.name);
      fd.append("base", base);
      if (fechaOk) fd.append("fecha_ok", "1");
      const res = await fetch("/api/correctivos/desde-oc", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo crear el ticket");
      const id: number = data.data.id;
      await autoGuardarTicket(id);
      router.push(`/correctivos/${id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el ticket");
      setCreando(false);
    }
  }

  const fila = "flex justify-between gap-4 border-b border-line py-2 text-sm last:border-b-0";

  return (
    <div className="bg-white border border-line rounded-lg shadow-card p-6 space-y-5">
      <div>
        <p className="text-sm text-ink-soft mb-3">
          Los tickets se crean leyendo la orden de compra (PDF): se toman el N° de OC, la fecha, el proveedor, el
          monto y la descripción, y el PDF queda guardado en el ticket. Lo demás se completa después en el ticket.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => void alElegir(e.target.files)}
        />
        <button
          type="button"
          disabled={leyendo || creando}
          onClick={() => inputRef.current?.click()}
          className="bg-amber border border-amber text-white rounded-md px-5 py-2.5 text-sm font-medium hover:bg-amber-hover hover:border-amber-hover transition-colors disabled:opacity-50"
        >
          {leyendo ? "Leyendo la OC…" : datos ? "Elegir otro PDF" : "Elegir PDF de la OC"}
        </button>
      </div>

      {error && (
        <p className="text-sm text-danger bg-[var(--danger-soft)] border border-danger/30 px-3 py-2">{error}</p>
      )}

      {datos && (
        <div className="rounded-lg border border-line-strong bg-concrete-dim/60 p-4 space-y-3">
          <p className="text-sm font-medium">
            Datos leídos de <span className="font-mono-tag">{archivo?.name}</span>
          </p>

          {sinNumero && (
            <p className="text-sm text-danger bg-[var(--danger-soft)] border border-danger/30 px-3 py-2 rounded-md">
              No se pudo leer el N° de la orden de compra en este PDF, y sin él no se puede crear el ticket.
            </p>
          )}
          {ocEnUso && (
            <p className="text-sm text-danger bg-[var(--danger-soft)] border border-danger/30 px-3 py-2 rounded-md">
              Esta OC ya está registrada en{" "}
              {datos.otros_tickets
                .map((t) => `el ticket #${t.refer ?? t.id}${t.ticket ? ` (${t.ticket})` : ""}`)
                .join(", ")}
              . Una OC no se puede usar en dos tickets.
            </p>
          )}
          {!enSoles && (
            <p className="text-xs border border-line-strong bg-white px-3 py-2 rounded-md">
              La OC está en {datos.moneda}: el ticket se maneja en soles, así que se creará sin monto para que lo
              conviertas después.
            </p>
          )}
          {datos.avisos
            .filter((a) => !a.startsWith("La OC está en "))
            .map((a) => (
              <p key={a} className="text-xs border border-line-strong bg-white px-3 py-2 rounded-md">
                {a}
              </p>
            ))}

          <div className="bg-white rounded-md border border-line px-4">
            <div className={fila}>
              <span className="text-ink-soft">N° OC</span>
              <span className="font-medium">{datos.n_oc ?? "No se encontró"}</span>
            </div>
            <div className={fila}>
              <span className="text-ink-soft">F. OC</span>
              <span className="font-medium">{formatoFecha(datos.f_oc)}</span>
            </div>
            <div className={fila}>
              <span className="text-ink-soft">Proveedor</span>
              <span className="font-medium text-right break-words">{datos.proveedor ?? "No se encontró"}</span>
            </div>
            <div className={fila}>
              <span className="text-ink-soft">RUC proveedor</span>
              <span className="font-medium">{datos.ruc_proveedor ?? "No se encontró"}</span>
            </div>
            <div className={fila}>
              <span className="text-ink-soft">Contrato</span>
              <span className="font-medium">{datos.contrato ?? "No se encontró"}</span>
            </div>
            <div className={fila}>
              <span className="text-ink-soft">F. entrega</span>
              <span className="font-medium">{formatoFecha(datos.f_entrega)}</span>
            </div>
            <div className={fila}>
              <span className="text-ink-soft">Monto (S/)</span>
              <span className="font-medium">{enSoles ? formatoSoles(monto) : "—"}</span>
            </div>
            <div className={fila}>
              <span className="text-ink-soft">Descripción</span>
              <span className="text-right break-words max-w-[70%]">
                {datos.descripcion ?? "No se encontró (se usará el N° de OC y el proveedor)"}
              </span>
            </div>
          </div>

          {enSoles && datos.total !== null && datos.subtotal !== null && (
            <div className="flex flex-wrap gap-4 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="base-monto" checked={base === "total"} onChange={() => setBase("total")} />
                Total con IGV ({formatoSoles(datos.total)})
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="base-monto"
                  checked={base === "subtotal"}
                  onChange={() => setBase("subtotal")}
                />
                Subtotal sin IGV ({formatoSoles(datos.subtotal)})
              </label>
            </div>
          )}

          {datos.fecha_ambigua && datos.f_oc && (
            <label className="flex items-start gap-2 text-xs border border-line-strong bg-white px-3 py-2 rounded-md cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={fechaOk} onChange={(e) => setFechaOk(e.target.checked)} />
              <span>
                El PDF escribe las fechas como mes/día/año y se leyó <strong>{formatoFecha(datos.f_oc)}</strong>.
                Confirmo que es correcta; si no la confirmo, el ticket se crea sin fecha de OC ni de entrega.
              </span>
            </label>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              disabled={!puedeCrear}
              onClick={() => void crear()}
              className="bg-amber border border-amber text-white rounded-md px-6 py-2.5 text-sm font-medium hover:bg-amber-hover hover:border-amber-hover transition-colors disabled:opacity-50"
            >
              {creando ? "Creando…" : "Crear ticket"}
            </button>
            <button
              type="button"
              disabled={creando}
              onClick={reiniciar}
              className="border border-line-strong rounded-md px-6 py-2.5 text-sm font-medium hover:bg-concrete-dim transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {!datos && !leyendo && (
        <div>
          <button
            type="button"
            onClick={() => router.push("/correctivos")}
            className="text-sm text-ink-soft hover:text-ink hover:underline"
          >
            Volver a la lista
          </button>
        </div>
      )}
    </div>
  );
}
