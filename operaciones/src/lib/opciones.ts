// Listas desplegables tomadas de la hoja "Listas" del archivo original
// Sistema_Correctivos_2025.xlsm. Edítalas aquí si necesitas agregar o
// quitar opciones.

export const ESTADOS = [
  "cotizar",
  "enviado",
  "Ingresado a PS",
  "Por Ejecutar",
  "Esperando Informe",
  "Finalizado",
] as const;

export const TIPOS_TRAB = [
  "General",
  "Materiales",
  "Preventivo",
  "Proyecto",
  "SAF",
  "Municipal",
  "Señalética",
] as const;

export const SUB_TIPOS_TRAB = [
  "Audio/Video",
  "Aire Acond.",
  "Mobiliario",
  "Sanitario",
  "Electrico",
  "Material",
  "Pintura",
  "Proyecto",
  "General",
  "Ferreteria",
  "Limpieza",
  "Data",
  "Señalética",
] as const;

export const AREAS = [
  "Mantenimiento",
  "Seguridad",
  "Servicios",
  "A&L",
  "Biblioteca",
  "Registros",
  "PTC",
] as const;

export const LUGARES = ["pabellon A", "pabellon B", "pabellon A y B"] as const;

export const ESTADO_COLORS: Record<string, string> = {
  cotizar: "bg-slate-100 text-slate-700 border-slate-300",
  enviado: "bg-sky-100 text-sky-700 border-sky-300",
  "Ingresado a PS": "bg-amber-100 text-amber-800 border-amber-300",
  "Por Ejecutar": "bg-orange-100 text-orange-800 border-orange-300",
  "Esperando Informe": "bg-purple-100 text-purple-800 border-purple-300",
  Finalizado: "bg-emerald-100 text-emerald-800 border-emerald-300",
};
