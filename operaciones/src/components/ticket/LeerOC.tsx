"use client";

import { useEffect, useRef, useState } from "react";
import type { CorrectivoInput, DatosOC } from "@/lib/shared";
import { formatoFecha, formatoSoles } from "@/lib/shared";
import { EVENTO_OC_LEIDA, leerOrdenCompra } from "@/lib/client";

type CampoOC = "n_oc" | "f_oc" | "proveedor" | "monto" | "descripcion";
type BaseMonto = "total" | "subtotal";

const ETIQUETAS: Record<CampoOC, string> = {
  n_oc: "N° OC",
  f_oc: "F. OC",
  proveedor: "Proveedor",
  monto: "Monto (S/)",
  descripcion: "Descripción",
};

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

/**
 * Botón "Leer OC (PDF)" del formulario del ticket y panel con lo que se leyó.
 * Nada se guarda al leer: "Aplicar" solo llena el formulario y la persona
 * revisa y presiona "Guardar cambios".
 *
 * El panel también se abre cuando la sección Documentos lee una OC
 * (al subir el PDF a la línea de OC, o con su botón "Leer OC").
 */
export default function LeerOC({
  form,
  id,
  onAplicar,
}: {
  form: CorrectivoInput;
  id?: number;
  onAplicar: (cambios: Partial<CorrectivoInput>) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [datos, setDatos] = useState<DatosOC | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState("");
  const [aplicado, setAplicado] = useState(false);
  const [marcados, setMarcados] = useState<Record<CampoOC, boolean>>({
    n_oc: false, f_oc: false, proveedor: false, monto: false, descripcion: false,
  });
  const [base, setBase] = useState<BaseMonto>("total");

  /** Valor leído de la OC para cada campo del ticket (null si no se encontró). */
  function valorOc(d: DatosOC, campo: CampoOC, b: BaseMonto): string | number | null {
    switch (campo) {
      case "n_oc": return d.n_oc;
      case "f_oc": return d.f_oc;
      case "proveedor": return d.proveedor;
      case "monto": return b === "total" ? d.total ?? d.subtotal : d.subtotal ?? d.total;
      case "descripcion": return d.descripcion;
    }
  }

  function valorActual(campo: CampoOC): string | number | null {
    const v = form[campo];
    return v === "" || v === undefined ? null : v;
  }

  function hayConflicto(d: DatosOC, campo: CampoOC, b: BaseMonto): boolean {
    const nuevo = valorOc(d, campo, b);
    const actual = valorActual(campo);
    if (nuevo === null || actual === null) return false;
    if (campo === "monto") return Math.abs(Number(actual) - Number(nuevo)) > 0.005;
    return norm(actual) !== norm(nuevo);
  }

  function abrirPanel(d: DatosOC) {
    setError("");
    setAplicado(false);
    setBase("total");
    // Marcados de entrada: lo que se encontró y no pisa un dato distinto que el ticket ya tiene.
    const m = {} as Record<CampoOC, boolean>;
    (Object.keys(ETIQUETAS) as CampoOC[]).forEach((c) => {
      m[c] = valorOc(d, c, "total") !== null && !hayConflicto(d, c, "total");
    });
    setMarcados(m);
    setDatos(d);
  }

  // Escucha las OC leídas desde la sección Documentos.
  useEffect(() => {
    const alLeer = (e: Event) => {
      abrirPanel((e as CustomEvent<DatosOC>).detail);
      setTimeout(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    };
    window.addEventListener(EVENTO_OC_LEIDA, alLeer);
    return () => window.removeEventListener(EVENTO_OC_LEIDA, alLeer);
    // abrirPanel solo usa `form` para comparar; reinscribir el oyente en cada tecla no aporta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  async function alElegir(files: FileList | null) {
    const archivo = files?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!archivo) return;
    setError("");
    setLeyendo(true);
    try {
      abrirPanel(await leerOrdenCompra(archivo, archivo.name, id));
    } catch (e) {
      setDatos(null);
      setError(e instanceof Error ? e.message : "No se pudo leer la orden de compra");
    } finally {
      setLeyendo(false);
    }
  }

  function cambiarBase(b: BaseMonto) {
    setBase(b);
    if (!datos) return;
    setMarcados((m) => ({ ...m, monto: valorOc(datos, "monto", b) !== null && !hayConflicto(datos, "monto", b) }));
  }

  function aplicar() {
    if (!datos) return;
    const cambios: Partial<CorrectivoInput> = {};
    if (marcados.n_oc && datos.n_oc) cambios.n_oc = datos.n_oc;
    if (marcados.f_oc && datos.f_oc) cambios.f_oc = datos.f_oc;
    if (marcados.proveedor && datos.proveedor) cambios.proveedor = datos.proveedor;
    const monto = valorOc(datos, "monto", base);
    if (marcados.monto && typeof monto === "number") cambios.monto = monto;
    if (marcados.descripcion && datos.descripcion) cambios.descripcion = datos.descripcion;
    onAplicar(cambios);
    setAplicado(true);
  }

  const filaCls = "flex items-start gap-3 rounded-md bg-white border border-line px-3 py-2";

  function mostrar(campo: CampoOC, v: string | number | null): string {
    if (v === null || v === "") return "—";
    if (campo === "monto") return formatoSoles(Number(v));
    if (campo === "f_oc") return formatoFecha(String(v));
    return String(v);
  }

  return (
    <div className="mt-4">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(e) => void alElegir(e.target.files)}
      />
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          disabled={leyendo}
          onClick={() => inputRef.current?.click()}
          className="border border-line-strong rounded-md px-4 py-2 text-sm font-medium hover:bg-concrete-dim transition-colors disabled:opacity-50"
        >
          {leyendo ? "Leyendo OC…" : "Leer OC (PDF)"}
        </button>
        <span className="text-xs text-ink-soft">
          Elige el PDF de la orden de compra y se llenan N° OC, fecha, proveedor, monto y descripción. Tú revisas antes de guardar.
        </span>
      </div>

      {error && (
        <p className="mt-3 text-sm text-danger bg-[var(--danger-soft)] border border-danger/30 px-3 py-2">
          {error}
        </p>
      )}

      {datos && (
        <div ref={panelRef} className="mt-4 rounded-lg border border-line-strong bg-concrete-dim/60 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium">
              Datos leídos de la OC <span className="font-mono-tag">{datos.n_oc ?? ""}</span>
            </p>
            <button
              type="button"
              onClick={() => setDatos(null)}
              className="text-xs text-ink-soft hover:text-ink hover:underline shrink-0"
            >
              Cerrar
            </button>
          </div>

          {datos.fecha_ambigua && (
            <p className="text-xs border border-line-strong bg-white px-3 py-2 rounded-md">
              El PDF escribe las fechas como mes/día/año. Se leyó la fecha de la OC como{" "}
              <strong>{formatoFecha(datos.f_oc)}</strong>; confírmala antes de guardar.
            </p>
          )}
          {datos.otros_tickets.length > 0 && (
            <p className="text-xs border border-line-strong bg-white px-3 py-2 rounded-md">
              Esta OC ya está en{" "}
              {datos.otros_tickets
                .map((t) => `el ticket #${t.refer ?? t.id}${t.ticket ? ` (${t.ticket})` : ""}`)
                .join(", ")}
              . Puede ser normal si la OC cubre varios trabajos.
            </p>
          )}
          {datos.avisos.map((a) => (
            <p key={a} className="text-xs border border-line-strong bg-white px-3 py-2 rounded-md">
              {a}
            </p>
          ))}

          <ul className="space-y-2">
            {(Object.keys(ETIQUETAS) as CampoOC[]).map((campo) => {
              const nuevo = valorOc(datos, campo, base);
              const actual = valorActual(campo);
              const conflicto = hayConflicto(datos, campo, base);
              const sinDato = nuevo === null;
              return (
                <li key={campo} className={`${filaCls} ${sinDato ? "opacity-60" : ""}`}>
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={sinDato}
                    checked={marcados[campo] && !sinDato}
                    onChange={(e) => setMarcados((m) => ({ ...m, [campo]: e.target.checked }))}
                    aria-label={`Usar ${ETIQUETAS[campo]} de la OC`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-ink-soft">{ETIQUETAS[campo]}</p>
                    <p className="text-sm break-words">{sinDato ? "No se encontró en la OC" : mostrar(campo, nuevo)}</p>
                    {conflicto && (
                      <p className="text-xs text-danger mt-0.5 break-words">
                        El ticket tiene: {mostrar(campo, actual)} (marca la casilla para reemplazarlo)
                      </p>
                    )}
                    {campo === "monto" && datos.total !== null && datos.subtotal !== null && (
                      <div className="flex gap-4 mt-1 text-xs">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input type="radio" name="base-monto-oc" checked={base === "total"} onChange={() => cambiarBase("total")} />
                          Total con IGV ({formatoSoles(datos.total)})
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input type="radio" name="base-monto-oc" checked={base === "subtotal"} onChange={() => cambiarBase("subtotal")} />
                          Subtotal sin IGV ({formatoSoles(datos.subtotal)})
                        </label>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <details className="text-xs text-ink-soft">
            <summary className="cursor-pointer select-none">Otros datos de la OC (no se copian al ticket)</summary>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              {datos.ruc_proveedor && (<><dt>RUC proveedor</dt><dd className="text-ink">{datos.ruc_proveedor}</dd></>)}
              {datos.moneda && (<><dt>Moneda</dt><dd className="text-ink">{datos.moneda}</dd></>)}
              {datos.entregar_en && (<><dt>Entregar en</dt><dd className="text-ink">{datos.entregar_en}</dd></>)}
              {datos.f_entrega && (<><dt>Entrega (más tardía)</dt><dd className="text-ink">{formatoFecha(datos.f_entrega)}</dd></>)}
              {datos.condicion_pago && (<><dt>Condición de pago</dt><dd className="text-ink">{datos.condicion_pago}</dd></>)}
              {datos.comprador && (<><dt>Comprador</dt><dd className="text-ink">{datos.comprador}</dd></>)}
              {datos.igv !== null && (<><dt>IGV</dt><dd className="text-ink">{formatoSoles(datos.igv)}</dd></>)}
            </dl>
            {datos.lineas.length > 0 && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-ink-soft">
                      <th className="pr-3 font-medium">Descripción</th>
                      <th className="pr-3 font-medium text-right">Cant.</th>
                      <th className="pr-3 font-medium text-right">Precio</th>
                      <th className="font-medium text-right">Importe</th>
                    </tr>
                  </thead>
                  <tbody className="text-ink">
                    {datos.lineas.map((l) => (
                      <tr key={`${l.linea}-${l.codigo}`}>
                        <td className="pr-3 py-0.5">{l.descripcion || l.codigo}</td>
                        <td className="pr-3 text-right">{l.cantidad} {l.unidad}</td>
                        <td className="pr-3 text-right">{formatoSoles(l.precio)}</td>
                        <td className="text-right">{formatoSoles(l.importe)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={aplicar}
              disabled={!Object.values(marcados).some(Boolean)}
              className="bg-amber border border-amber text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-amber-hover hover:border-amber-hover transition-colors disabled:opacity-50"
            >
              Aplicar al ticket
            </button>
            {aplicado && (
              <span className="text-xs text-teal">
                Listo: los datos están en el formulario. Revísalos y presiona &quot;Guardar cambios&quot;.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
