import { ESTADO_COLORS } from "@/lib/opciones";

export default function EstadoBadge({ estado }: { estado: string | null }) {
  const label = estado || "Sin estado";
  const cls =
    ESTADO_COLORS[label] || "bg-slate-100 text-slate-700 border-slate-300";
  return (
    <span
      className={`inline-block px-2 py-0.5 text-xs font-mono-tag uppercase tracking-wide border rounded-sm whitespace-nowrap ${cls}`}
    >
      {label}
    </span>
  );
}
