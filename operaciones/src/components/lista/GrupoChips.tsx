import type { ItemFaceta } from "./filtrosLista";

export default function GrupoChips({
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
                  ? "bg-ink text-concrete border-ink"
                  : sinResultados
                  ? "bg-white border-line opacity-40 cursor-not-allowed"
                  : "bg-white border-line hover:border-line-strong cursor-pointer"
              }`}
            >
              <span>{it.valor}</span>
              <span
                className={`font-mono-tag text-[11px] px-1.5 py-0.5 ${
                  activa ? "bg-concrete text-ink" : "bg-concrete-dim text-ink-soft"
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
