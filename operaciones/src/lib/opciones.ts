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

// Líneas de documentos de cada ticket, en el orden en que se muestran.
export const DOCUMENTOS = [
  { clave: "cotizacion", nombre: "Cotización" },
  { clave: "oc", nombre: "OC" },
  { clave: "informe", nombre: "Informe" },
  { clave: "certificado", nombre: "Certificado" },
] as const;

// Nombre mostrado -> clave guardada, para el filtro "documento pendiente".
export const DOC_FILTRO: Record<string, string> = Object.fromEntries(
  DOCUMENTOS.map((d) => [d.nombre, d.clave])
);

// Estados en los que un ticket se considera "atrasado" si lleva muchos días.
export const ESTADOS_CON_PLAZO = ["Ingresado a PS", "Por Ejecutar", "Esperando Informe"];
export const DIAS_ATRASO = 15;

// "No aplica": trabajos que no requieren ese documento (ej. sin certificado).
export const ESTADOS_DOC = ["Pendiente", "Listo", "Aprobado", "No aplica"] as const;

export const ESTADO_DOC_COLORS: Record<string, string> = {
  Pendiente: "bg-slate-100 text-slate-700",
  Listo: "bg-emerald-100 text-emerald-800",
  Aprobado: "bg-emerald-200 text-emerald-900",
  "No aplica": "bg-stone-100 text-stone-500 line-through decoration-stone-400",
};

export const ESTADO_COLORS: Record<string, string> = {
  cotizar: "bg-slate-100 text-slate-700",
  enviado: "bg-sky-100 text-sky-700",
  "Ingresado a PS": "bg-amber-100 text-amber-800",
  "Por Ejecutar": "bg-orange-100 text-orange-800",
  "Esperando Informe": "bg-purple-100 text-purple-800",
  Finalizado: "bg-emerald-100 text-emerald-800",
};
