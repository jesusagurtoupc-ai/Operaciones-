import { toDateOnly } from "@/lib/shared/types";

export function formatoSoles(n: number | null, decimales = 2) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "PEN",
    maximumFractionDigits: decimales,
  }).format(n);
}

export function formatoFecha(f: string | null) {
  const soloFecha = toDateOnly(f);
  if (!soloFecha) return "—";
  // "T00:00:00" (sin "Z") fuerza a interpretar la fecha en hora local
  // en vez de UTC, evitando que se corra un día según la zona horaria
  // del navegador.
  const d = new Date(soloFecha + "T00:00:00");
  return d.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" });
}
