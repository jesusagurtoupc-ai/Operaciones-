import type { Correctivo, DocumentoClave } from "@/lib/shared";
import {
  DOCUMENTOS,
  compararMontos,
  formatoDolares,
  formatoFecha,
  formatoSoles,
  hoyLima,
  montoDocValido,
  nombreCampus,
  textoMonto,
} from "@/lib/shared";

function fila(etiqueta: string, valor: string | number | null | undefined) {
  return (
    <div className="flex border-b border-black/15 py-1.5 break-inside-avoid">
      <span className="w-36 shrink-0 font-semibold text-[10px] uppercase tracking-wide text-black/70 pt-0.5">{etiqueta}</span>
      <span className="text-[12px]">{valor || valor === 0 ? valor : "—"}</span>
    </div>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 break-inside-avoid">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] border-l-4 border-danger pl-2 mb-2">{titulo}</h2>
      {children}
    </section>
  );
}

const montoDoc = (d?: { monto?: number | null; moneda?: string }) =>
  !d || montoDocValido(d.monto) === null ? "—" : d.moneda === "USD" ? formatoDolares(d.monto) : formatoSoles(d.monto as number);

/**
 * Ficha del ticket para imprimir o guardar como PDF (orden de trabajo): logo, datos del trabajo, proveedor
 * y OC, fechas, documentos con sus montos (y si coinciden) y firmas. Oculta en pantalla (ver .solo-impresion
 * en globals.css); aparece al usar Ctrl+P o el botón «Imprimir», en vez de imprimir el formulario editable.
 */
export default function TicketImprimible({ c }: { c: Correctivo }) {
  const docs = c.documentos ?? {};
  const cmp = compararMontos(docs);
  const campus = (c as Correctivo & { campus?: string | null }).campus;
  const conMonto: DocumentoClave[] = ["cotizacion", "oc", "informe"];
  return (
    <div className="solo-impresion text-black bg-white px-2 py-1 text-[12px] leading-snug">
      {/* Encabezado */}
      <header className="flex items-center justify-between gap-6 border-b-[3px] border-danger pb-3">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-upc.png" alt="UPC" className="h-12 w-auto" />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-danger">
              Operaciones{campus ? ` · ${nombreCampus(campus)}` : ""}
            </p>
            <h1 className="text-xl font-bold leading-tight">Orden de trabajo — Correctivo</h1>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-black/60">N° de referencia</p>
          <p className="text-2xl font-bold font-mono leading-none">#{c.refer ?? c.id}</p>
          <p className="mt-1 text-[10px] text-black/60">Estado: {c.estado || "—"}</p>
        </div>
      </header>

      <Seccion titulo="Trabajo">
        <div className="border border-black/15 rounded px-3 py-2 mb-2 text-[13px]">{c.descripcion || "—"}</div>
        <div className="grid grid-cols-2 gap-x-8">
          <div>
            {fila("Ticket", c.ticket)}
            {fila("Lugar", c.lugar)}
            {fila("Área", c.area)}
          </div>
          <div>
            {fila("Tipo de trabajo", c.tipo_trab)}
            {fila("Sub tipo", c.sub_tipo_trab)}
            {fila("Fecha de registro", formatoFecha(c.f_reg))}
          </div>
        </div>
      </Seccion>

      <Seccion titulo="Proveedor y orden de compra">
        <div className="grid grid-cols-2 gap-x-8">
          <div>
            {fila("Proveedor", c.proveedor)}
            {fila("RUC", c.ruc_proveedor)}
            {fila("Contrato", c.contrato)}
          </div>
          <div>
            {fila("N° OC", c.n_oc)}
            {fila("Monto del ticket", textoMonto(c))}
            {c.moneda === "USD" && c.tipo_cambio ? fila("Tipo de cambio", String(c.tipo_cambio)) : null}
          </div>
        </div>
      </Seccion>

      <Seccion titulo="Fechas">
        <div className="grid grid-cols-5 border border-black/15 rounded overflow-hidden text-center">
          {[
            ["Cotización", c.f_coti],
            ["OC", c.f_oc],
            ["Entrega", c.f_entrega],
            ["Inicio", c.f_inicio],
            ["Fin", c.f_fin],
          ].map(([t, f], i) => (
            <div key={t} className={`py-2 ${i ? "border-l border-black/15" : ""}`}>
              <p className="text-[9px] uppercase tracking-wide text-black/60">{t}</p>
              <p className="text-[12px] font-semibold tabular-nums">{formatoFecha(f ?? null)}</p>
            </div>
          ))}
        </div>
      </Seccion>

      <Seccion titulo="Documentos">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-black/5 text-left">
              <th className="border border-black/15 px-2 py-1 font-semibold">Documento</th>
              <th className="border border-black/15 px-2 py-1 font-semibold">N° / archivo</th>
              <th className="border border-black/15 px-2 py-1 font-semibold">Estado</th>
              <th className="border border-black/15 px-2 py-1 font-semibold text-right">Monto total</th>
            </tr>
          </thead>
          <tbody>
            {DOCUMENTOS.map(({ clave, nombre }) => {
              const d = docs[clave];
              return (
                <tr key={clave}>
                  <td className="border border-black/15 px-2 py-1 font-medium">{nombre}</td>
                  <td className="border border-black/15 px-2 py-1">{d?.numero || "—"}</td>
                  <td className="border border-black/15 px-2 py-1">{d?.url ? d.estado : d?.estado === "No aplica" ? "No aplica" : "Sin documento"}</td>
                  <td className="border border-black/15 px-2 py-1 text-right tabular-nums">{conMonto.includes(clave) ? montoDoc(d) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {cmp.montos.length >= 2 && (
          <p className={`mt-1.5 text-[11px] font-semibold ${cmp.coinciden ? "" : "text-danger"}`}>
            {cmp.coinciden
              ? "✓ Los montos de cotización, OC e informe coinciden."
              : `✗ Los montos no coinciden${cmp.diferencia !== null ? ` (diferencia ${formatoSoles(cmp.diferencia)})` : " (monedas distintas)"}${cmp.pareceIgv ? ": la diferencia parece ser el IGV" : ""}.`}
          </p>
        )}
      </Seccion>

      <Seccion titulo="Observaciones">
        <div className="border border-black/15 rounded h-16" />
      </Seccion>

      {/* Firmas */}
      <div className="grid grid-cols-3 gap-x-8 mt-14 break-inside-avoid">
        {["Responsable de mantenimiento", "Supervisión", "Proveedor"].map((t) => (
          <div key={t} className="text-center text-[10px]">
            <div className="border-t border-black pt-1.5 font-semibold">{t}</div>
            <div className="mt-1 text-black/60">Nombre y fecha</div>
          </div>
        ))}
      </div>

      <footer className="mt-8 pt-2 border-t border-black/15 flex justify-between text-[9px] text-black/50">
        <span>Sistema de Correctivos · Operaciones UPC</span>
        <span>Impreso el {formatoFecha(hoyLima())}</span>
      </footer>
    </div>
  );
}
