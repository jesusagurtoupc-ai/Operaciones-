import { formatoSoles } from "@/lib/shared/formato";

export default function TarjetaEstado({
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
      className={`text-left border rounded-lg p-3 flex flex-col gap-1 transition-colors ${
        activa
          ? "bg-ink text-concrete border-ink"
          : sinResultados
          ? "bg-white border-line opacity-40 cursor-not-allowed"
          : "bg-white border-line hover:border-line-strong cursor-pointer"
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
            activa ? "bg-concrete border-concrete text-ink" : "border-line-strong"
          }`}
        >
          {activa ? "✓" : ""}
        </span>
      </span>
      <span className="font-display font-700 text-3xl leading-none">{cantidad}</span>
      <span
        className={`font-mono-tag text-[11px] ${activa ? "text-concrete/70" : "text-ink-soft"}`}
      >
        {formatoSoles(monto, 0)}
      </span>
    </button>
  );
}
