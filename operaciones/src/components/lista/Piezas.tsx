import { formatoSoles, DOCUMENTOS } from "@/lib/shared";
import type { Correctivo } from "@/lib/shared";
import type { ItemFaceta } from "./filtrosLista";

// ───────── TarjetaEstado ─────────
export function TarjetaEstado({
  etiqueta,
  cantidad,
  monto,
  acento,
  activa,
  onClick,
}: {
  etiqueta: string;
  cantidad: number;
  monto: number;
  acento: string;
  activa: boolean;
  onClick: () => void;
}) {
  const sinResultados = cantidad === 0 && !activa;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={sinResultados}
      aria-pressed={activa}
      style={{
        borderTopWidth: 4,
        borderTopColor: acento,
        ...(activa
          ? {
              backgroundColor: `color-mix(in srgb, ${acento} 11%, white)`,
              borderLeftColor: acento,
              borderRightColor: acento,
              borderBottomColor: acento,
            }
          : {}),
      }}
      className={`text-left border rounded-lg p-3 flex flex-col gap-1 transition-shadow ${
        activa
          ? "shadow-card"
          : sinResultados
          ? "bg-white border-line opacity-40 cursor-not-allowed"
          : "bg-white border-line hover:shadow-card cursor-pointer"
      }`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-medium leading-tight">
          <span
            aria-hidden
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: acento }}
          />
          {etiqueta}
        </span>
        <span
          aria-hidden
          className={`w-3.5 h-3.5 shrink-0 border rounded-sm flex items-center justify-center text-[9px] leading-none ${
            activa ? "border-transparent text-white" : "border-line-strong"
          }`}
          style={activa ? { backgroundColor: acento } : undefined}
        >
          {activa ? "✓" : ""}
        </span>
      </span>
      <span className="font-display font-bold text-3xl leading-none">{cantidad}</span>
      <span
        className="font-mono-tag text-[11px] text-ink-soft"
      >
        {formatoSoles(monto, 0)}
      </span>
    </button>
  );
}

// ───────── AvanceDocs ─────────
/** "3/4" + un punto por documento (verde = listo/aprobado, gris = pendiente). */
export function AvanceDocs({ documentos }: { documentos?: Correctivo["documentos"] }) {
  const estados = DOCUMENTOS.map((d) => documentos?.[d.clave]?.estado ?? "Pendiente");
  // "No aplica" no cuenta: ese trabajo no necesita ese documento.
  const aplicables = estados.filter((e) => e !== "No aplica").length;
  const listos = estados.filter((e) => e === "Listo" || e === "Aprobado").length;
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={DOCUMENTOS.map((d, i) => `${d.nombre}: ${estados[i]}`).join("\n")}
    >
      <span className="font-mono-tag text-xs">
        {aplicables === 0 ? "—" : `${listos}/${aplicables}`}
      </span>
      <span className="inline-flex gap-0.5" aria-hidden>
        {estados.map((e, i) =>
          e === "No aplica" ? null : (
            <span
              key={i}
              className={`w-2 h-2 rounded-full ${e === "Pendiente" ? "bg-line/25" : "bg-teal"}`}
            />
          )
        )}
      </span>
    </span>
  );
}

// ───────── GrupoChips ─────────
export function GrupoChips({
  titulo,
  items,
  seleccionados,
  onAlternar,
}: {
  titulo: string;
  items: ItemFaceta[];
  seleccionados: string[];
  onAlternar: (valor: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-ink-soft mb-2">
        {titulo}
        {seleccionados.length > 0 && (
          <span className="ml-2 text-ink-soft">· {seleccionados.length} elegido{seleccionados.length === 1 ? "" : "s"}</span>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {items.map((it) => {
          const activa = seleccionados.includes(it.valor);
          const sinResultados = it.cantidad === 0 && !activa;
          return (
            <button
              key={it.valor}
              type="button"
              onClick={() => onAlternar(it.valor)}
              disabled={sinResultados}
              aria-pressed={activa}
              className={`inline-flex items-center gap-2 border rounded-md pl-2.5 pr-1 py-1 text-xs transition-colors ${
                activa
                  ? "bg-amber/10 text-amber-hover border-amber font-medium"
                  : sinResultados
                  ? "bg-white border-line opacity-40 cursor-not-allowed"
                  : "bg-white border-line hover:border-slate-ink/50 hover:bg-slate-soft cursor-pointer"
              }`}
            >
              <span>{it.valor}</span>
              <span
                className={`font-mono-tag text-[11px] px-1.5 py-0.5 rounded ${
                  activa ? "bg-amber text-white" : "bg-concrete-dim text-ink-soft"
                }`}
              >
                {it.cantidad}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
