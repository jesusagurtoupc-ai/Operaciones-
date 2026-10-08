import type { Correctivo } from "@/lib/types";

function fila(etiqueta: string, valor: string | number | null | undefined) {
  return (
    <div className="flex border-b border-black/20 py-1.5">
      <span className="w-40 shrink-0 font-semibold text-xs uppercase tracking-wide">
        {etiqueta}
      </span>
      <span className="text-sm">{valor || valor === 0 ? valor : "—"}</span>
    </div>
  );
}

function formatoFecha(f: string | null) {
  if (!f) return "—";
  return new Date(String(f).slice(0, 10) + "T00:00:00").toLocaleDateString("es-PE");
}

function formatoSoles(n: number | null) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" }).format(n);
}

/**
 * Resumen de solo lectura pensado para imprimir una orden de trabajo.
 * Está oculto en pantalla (ver .solo-impresion en globals.css) y solo
 * aparece al usar Ctrl+P / el botón "Imprimir", en vez de intentar
 * imprimir los <input>/<select> del formulario editable.
 */
export default function TicketImprimible({ c }: { c: Correctivo }) {
  return (
    <div className="solo-impresion text-black p-8">
      <div className="flex items-center justify-between border-b-2 border-black pb-3 mb-4">
        <h1 className="text-2xl font-bold">Orden de Trabajo — Correctivo</h1>
        <span className="text-lg font-mono">#{c.refer ?? c.id}</span>
      </div>

      <div className="grid grid-cols-2 gap-x-8">
        <div>
          {fila("Ticket", c.ticket)}
          {fila("Fecha de registro", formatoFecha(c.f_reg))}
          {fila("Estado", c.estado)}
          {fila("Lugar", c.lugar)}
          {fila("Área", c.area)}
        </div>
        <div>
          {fila("Tipo de trabajo", c.tipo_trab)}
          {fila("Sub tipo", c.sub_tipo_trab)}
          {fila("Proveedor", c.proveedor)}
          {fila("Monto", formatoSoles(c.monto))}
          {fila("N° OC", c.n_oc)}
        </div>
      </div>

      <div className="mt-2">{fila("Descripción", c.descripcion)}</div>

      <div className="grid grid-cols-2 gap-x-8 mt-2">
        <div>
          {fila("F. Cotización", formatoFecha(c.f_coti))}
        </div>
        <div>
          {fila("F. OC", formatoFecha(c.f_oc))}
          {fila("F. Inicio / Fin", `${formatoFecha(c.f_inicio)} — ${formatoFecha(c.f_fin)}`)}
        </div>
      </div>


      <div className="grid grid-cols-2 gap-x-8 mt-16">
        <div className="border-t border-black pt-2 text-center text-xs">Firma responsable</div>
        <div className="border-t border-black pt-2 text-center text-xs">Firma supervisión</div>
      </div>
    </div>
  );
}
