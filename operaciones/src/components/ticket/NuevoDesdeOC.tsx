"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Correctivo, DatosOC } from "@/lib/shared";
import { formatoFecha, formatoSoles, toDateOnly } from "@/lib/shared";
import { leerOrdenCompra, prepararAutoguardado, autoGuardarTicket } from "@/lib/client";

type Base = "total" | "subtotal";

// Datos de un ticket existente que una carga nueva de su OC puede actualizar.
type CampoAct = "f_oc" | "proveedor" | "ruc_proveedor" | "monto" | "contrato" | "f_entrega" | "descripcion";
const CAMPOS_ACT: { k: CampoAct; etiqueta: string }[] = [
  { k: "f_oc", etiqueta: "F. OC" },
  { k: "proveedor", etiqueta: "Proveedor" },
  { k: "ruc_proveedor", etiqueta: "RUC proveedor" },
  { k: "monto", etiqueta: "Monto (S/)" },
  { k: "contrato", etiqueta: "Contrato" },
  { k: "f_entrega", etiqueta: "F. entrega" },
  { k: "descripcion", etiqueta: "Descripción" },
];
const SIN_MARCAR: Record<CampoAct, boolean> = {
  f_oc: false, proveedor: false, ruc_proveedor: false, monto: false, contrato: false, f_entrega: false, descripcion: false,
};

/**
 * Única forma de crear un ticket: se elige el PDF de la orden de compra, se leen sus datos, la
 * persona los revisa y recién entonces se crea. Lo que la OC no trae (ticket, lugar, tipo de trabajo,
 * fechas del proceso...) se completa después, en la pantalla del ticket.
 * Nada se guarda hasta presionar "Crear ticket".
 *
 * Si la OC ya está en un ticket (p. ej. una OC reemitida), en vez de bloquear se ofrece ACTUALIZAR
 * ese ticket: se comparan sus datos con los del PDF y la persona marca cuáles quiere cambiar.
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
  // Modo "actualizar un ticket existente" (la OC ya estaba registrada).
  const [destinoId, setDestinoId] = useState<number | null>(null);
  const [actualDe, setActualDe] = useState<{ id: number; c: Correctivo } | null>(null);
  const [marcados, setMarcados] = useState<Record<CampoAct, boolean>>(SIN_MARCAR);
  const [reemplazarPdf, setReemplazarPdf] = useState(true);
  const [actualizando, setActualizando] = useState(false);

  const enSoles = !datos?.moneda || datos.moneda === "PEN";
  const ocEnUso = (datos?.otros_tickets.length ?? 0) > 0;
  const sinNumero = !!datos && !datos.n_oc;
  const monto = !datos ? null : base === "total" ? datos.total : datos.subtotal;
  const puedeCrear = !!datos && !!archivo && !ocEnUso && !sinNumero && !creando;

  // Ticket que ya tiene esta OC (el elegido, si por datos antiguos hubiera más de uno).
  const actual = actualDe && actualDe.id === destinoId ? actualDe.c : null;
  const fechasValen = !datos?.fecha_ambigua || fechaOk;
  /** Valor que trae el PDF para cada dato (null = no lo trae o aún no vale). */
  function nuevoDe(k: CampoAct): string | number | null {
    if (!datos) return null;
    switch (k) {
      case "f_oc": return fechasValen ? datos.f_oc : null;
      case "f_entrega": return fechasValen ? datos.f_entrega : null;
      case "proveedor": return datos.proveedor;
      case "ruc_proveedor": return datos.ruc_proveedor;
      case "contrato": return datos.contrato;
      case "descripcion": return datos.descripcion;
      case "monto": return enSoles ? monto : null;
    }
  }
  /** Valor que tiene hoy el ticket. */
  function actualDeTicket(c: Correctivo, k: CampoAct): string | number | null {
    if (k === "f_oc" || k === "f_entrega") return toDateOnly(c[k]) || null;
    const v = c[k];
    return v === undefined || v === "" ? null : (v as string | number | null);
  }
  function iguales(c: Correctivo, k: CampoAct): boolean {
    const a = actualDeTicket(c, k);
    const n = nuevoDe(k);
    if (k === "monto") return (a === null ? null : Number(a)) === (n === null ? null : Number(n));
    return String(a ?? "").trim() === String(n ?? "").trim();
  }
  const hayMarcados = CAMPOS_ACT.some(({ k }) => marcados[k] && nuevoDe(k) !== null);
  const puedeActualizar =
    !!datos && !!archivo && ocEnUso && destinoId !== null && !!actual && !actualizando && (hayMarcados || reemplazarPdf);

  // Al encontrar que la OC ya existe se trae el ticket para compararlo con el PDF.
  useEffect(() => {
    if (destinoId === null) return;
    let vigente = true;
    void (async () => {
      try {
        const res = await fetch(`/api/correctivos/${destinoId}`);
        const json = await res.json().catch(() => null);
        if (!vigente || !res.ok || !json?.data) return;
        const c = json.data as Correctivo;
        setActualDe({ id: destinoId, c });
        // Marcado de entrada: lo que el PDF trae y cambia. La descripción no, porque suele estar editada a mano.
        const marca = { ...SIN_MARCAR };
        for (const { k } of CAMPOS_ACT) {
          const a = actualDeTicket(c, k);
          if (k === "descripcion" ? a === null && nuevoDe(k) !== null : nuevoDe(k) !== null && !iguales(c, k)) marca[k] = true;
        }
        setMarcados(marca);
      } catch {
        /* sin red: queda "Cargando el ticket…" y se puede reintentar eligiendo el PDF de nuevo */
      }
    })();
    return () => {
      vigente = false;
    };
    // Solo al cambiar de ticket destino: lo demás se recalcula al dibujar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinoId]);

  function reiniciar() {
    setArchivo(null);
    setDatos(null);
    setError("");
    setBase("total");
    setFechaOk(false);
    setDestinoId(null);
    setActualDe(null);
    setMarcados(SIN_MARCAR);
    setReemplazarPdf(true);
  }

  async function alElegir(files: FileList | null) {
    const elegido = files?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!elegido) return;
    reiniciar();
    setLeyendo(true);
    try {
      const leido = await leerOrdenCompra(elegido, elegido.name);
      setDatos(leido);
      setArchivo(elegido);
      if (leido.otros_tickets.length > 0) setDestinoId(leido.otros_tickets[0].id);
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

  async function actualizar() {
    if (!puedeActualizar || !archivo || destinoId === null) return;
    setError("");
    setActualizando(true);
    try {
      await prepararAutoguardado();
      const fd = new FormData();
      fd.append("file", archivo, archivo.name);
      fd.append("base", base);
      if (fechaOk) fd.append("fecha_ok", "1");
      if (reemplazarPdf) fd.append("reemplazar_pdf", "1");
      for (const { k } of CAMPOS_ACT) if (marcados[k] && nuevoDe(k) !== null) fd.append("campo", k);
      const res = await fetch(`/api/correctivos/${destinoId}/actualizar-oc`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo actualizar el ticket");
      await autoGuardarTicket(destinoId);
      router.push(`/correctivos/${destinoId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar el ticket");
      setActualizando(false);
    }
  }

  const mostrarValor = (k: CampoAct, v: string | number | null) =>
    v === null ? "—" : k === "monto" ? formatoSoles(Number(v)) : k === "f_oc" || k === "f_entrega" ? formatoFecha(String(v)) : String(v);

  const fila = "flex justify-between gap-4 border-b border-line py-2 text-sm last:border-b-0";

  return (
    <div className="bg-white border border-line rounded-lg shadow-card p-6 space-y-5">
      <div>
        <p className="text-sm text-ink-soft mb-3">
          Los tickets se crean leyendo la orden de compra (PDF): se toman el N° de OC, la fecha, el proveedor, el
          monto y la descripción, y el PDF queda guardado en el ticket. Lo demás se completa después en el ticket.
          Si la OC ya estaba registrada, te deja actualizar ese ticket con los datos del PDF nuevo.
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
            <div className="text-sm border border-amber/60 bg-white px-3 py-2 rounded-md space-y-1.5">
              <p>
                <strong>Esta OC ya está registrada</strong> y una OC no puede estar en dos tickets, así que no se
                crea uno nuevo. Puedes <strong>actualizar el ticket existente</strong> con los datos de este PDF:
                abajo eliges qué cambiar.
              </p>
              {datos.otros_tickets.length > 1 ? (
                <div className="flex flex-col gap-1 text-xs">
                  <span className="text-ink-soft">Hay más de un ticket con esta OC; elige cuál actualizar:</span>
                  {datos.otros_tickets.map((t) => (
                    <label key={t.id} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="destino-oc"
                        checked={destinoId === t.id}
                        onChange={() => setDestinoId(t.id)}
                      />
                      Ticket #{t.refer ?? t.id}
                      {t.ticket ? ` (${t.ticket})` : ""}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-ink-soft">
                  Ticket #{datos.otros_tickets[0].refer ?? datos.otros_tickets[0].id}
                  {datos.otros_tickets[0].ticket ? ` (${datos.otros_tickets[0].ticket})` : ""}
                </p>
              )}
            </div>
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
                Confirmo que es correcta; si no la confirmo, no se usan la fecha de OC ni la de entrega.
              </span>
            </label>
          )}

          {ocEnUso && (
            <div className="bg-white rounded-md border border-line px-4 py-3 space-y-2">
              <p className="text-sm font-medium">¿Qué datos del ticket quieres actualizar?</p>
              {!actual ? (
                <p className="text-xs text-ink-soft">Cargando el ticket…</p>
              ) : (
                <>
                  <div className="divide-y divide-line">
                    {CAMPOS_ACT.map(({ k, etiqueta }) => {
                      const nuevo = nuevoDe(k);
                      const antes = actualDeTicket(actual, k);
                      const igual = iguales(actual, k);
                      const sinDato = nuevo === null;
                      return (
                        <label
                          key={k}
                          className={`flex items-start gap-3 py-2 text-sm ${
                            sinDato || igual ? "opacity-60" : "cursor-pointer"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="mt-1"
                            disabled={sinDato || igual}
                            checked={marcados[k] && !sinDato && !igual}
                            onChange={(e) => setMarcados((m) => ({ ...m, [k]: e.target.checked }))}
                          />
                          <span className="flex-1 min-w-0">
                            <span className="block text-xs text-ink-soft">{etiqueta}</span>
                            {sinDato ? (
                              <span className="text-xs">
                                {(k === "f_oc" || k === "f_entrega") && datos.fecha_ambigua && !fechaOk
                                  ? "Confirma la fecha arriba para poder usarla"
                                  : "El PDF no trae este dato: se conserva el actual"}
                              </span>
                            ) : igual ? (
                              <span className="text-xs">Sin cambios ({mostrarValor(k, antes)})</span>
                            ) : (
                              <span className="block break-words">
                                <span className="text-ink-soft line-through">{mostrarValor(k, antes)}</span>
                                {" → "}
                                <span className="font-medium">{mostrarValor(k, nuevo)}</span>
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <label className="flex items-start gap-3 pt-2 text-sm cursor-pointer border-t border-line">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={reemplazarPdf}
                      onChange={(e) => setReemplazarPdf(e.target.checked)}
                    />
                    <span>
                      Reemplazar el PDF de la OC del ticket por este
                      <span className="block text-xs text-ink-soft">
                        El PDF anterior se borra del ticket (y de tu carpeta local al volver a guardarla).
                      </span>
                    </span>
                  </label>
                </>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            {ocEnUso ? (
              <button
                type="button"
                disabled={!puedeActualizar}
                onClick={() => void actualizar()}
                className="bg-amber border border-amber text-white rounded-md px-6 py-2.5 text-sm font-medium hover:bg-amber-hover hover:border-amber-hover transition-colors disabled:opacity-50"
              >
                {actualizando
                  ? "Actualizando…"
                  : `Actualizar ticket #${datos.otros_tickets.find((t) => t.id === destinoId)?.refer ?? destinoId ?? ""}`}
              </button>
            ) : (
              <button
                type="button"
                disabled={!puedeCrear}
                onClick={() => void crear()}
                className="bg-amber border border-amber text-white rounded-md px-6 py-2.5 text-sm font-medium hover:bg-amber-hover hover:border-amber-hover transition-colors disabled:opacity-50"
              >
                {creando ? "Creando…" : "Crear ticket"}
              </button>
            )}
            <button
              type="button"
              disabled={creando || actualizando}
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
