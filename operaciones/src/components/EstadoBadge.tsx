import { ESTADO_COLORS } from "@/lib/opciones";

export default function EstadoBadge({ estado }: { estado: string | null }) {
  const label = estado || "Sin estado";
  const cls =
    ESTADO_COLORS[label] || "bg-slate-100 text-slate-700";
  return (
    <span
      className={`inline-block px-2.5 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${cls}`}
    >
      {label}
    </span>
  );
}
