// ───────── types.ts ─────────
/** Una línea de documento del ticket: su número, estado y enlace. */
export type DocumentoLinea = {
  numero: string;
  estado: string;
  url: string;
};

export type DocumentoClave = "visita_tecnica" | "cotizacion" | "oc" | "informe" | "certificado";

export type Documentos = Partial<Record<DocumentoClave, DocumentoLinea>>;

export type Correctivo = {
  id: number;
  refer: number | null;
  ticket: string | null;
  f_reg: string | null;
  descripcion: string;
  lugar: string | null;
  estado: string;
  proveedor: string | null;
  monto: number | null;
  f_coti: string | null;
  f_oc: string | null;
  f_inicio: string | null;
  f_fin: string | null;
  cuenta: string | null;
  tipo_trab: string | null;
  sub_tipo_trab: string | null;
  n_oc: string | null;
  area: string | null;
  /** Datos que vienen de la OC: RUC del proveedor, fecha de entrega (la más tardía) y contrato. */
  ruc_proveedor: string | null;
  f_entrega: string | null;
  contrato: string | null;
  documentos?: Documentos | null;
  estado_desde?: string | null;
  created_at?: string;
  updated_at?: string;
  /** Si está en la papelera: cuándo y quién lo eliminó. */
  eliminado_en?: string | null;
  eliminado_por?: string | null;
};

/** Una línea de la orden de compra (cantidad, precio e importe). */
export type LineaOC = {
  linea: number;
  codigo: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  precio: number;
  importe: number;
  entrega: string | null; // YYYY-MM-DD
};

/** Datos que se leen de una orden de compra en PDF (ver lib/server/parsearOC.ts). */
export type DatosOC = {
  n_oc: string | null;
  f_oc: string | null; // YYYY-MM-DD
  proveedor: string | null;
  ruc_proveedor: string | null;
  moneda: string | null;
  subtotal: number | null;
  igv: number | null;
  total: number | null;
  descripcion: string | null;
  entregar_en: string | null;
  comprador: string | null;
  condicion_pago: string | null;
  f_entrega: string | null; // la fecha de entrega más tardía de las líneas
  /** N° de contrato (Contract ID) de las líneas, sin ceros a la izquierda; varios separados por coma. */
  contrato: string | null;
  lineas: LineaOC[];
  /** El PDF imprime mes/día/año; si todas las fechas caben en ambos órdenes, hay que confirmarlas. */
  fecha_ambigua: boolean;
  avisos: string[];
  /** Otros tickets (no eliminados) que ya tienen este mismo N° de OC. */
  otros_tickets: { id: number; refer: number | null; ticket: string | null }[];
};

/** Datos que se leen de una cotización en PDF (ver lib/server/parsearCotizacion.ts). */
export type DatosCotizacion = {
  numero: string | null;
  fecha: string | null; // YYYY-MM-DD
  /** La fecha viene como dd/mm o mm/dd y no se pudo saber cuál (no se aplica sola). */
  fecha_ambigua: boolean;
  proveedor: string | null;
  ruc_proveedor: string | null;
  moneda: "PEN" | "USD" | null;
  subtotal: number | null;
  total: number | null; // con IGV
  /** El PDF no trae total: se calculó como subtotal + IGV (18 %) porque dice "no incluye IGV". */
  total_calculado?: boolean;
  avisos: string[];
};

export type CorrectivoInput = Omit<
  Correctivo,
  "id" | "created_at" | "updated_at" | "documentos" | "estado_desde" | "eliminado_en" | "eliminado_por"
>;

/**
 * Postgres devuelve las columnas NUMERIC (como `monto`) como texto para
 * no perder precisión con el driver. Aquí se convierten a number para
 * que el resto de la app (ordenar, sumar, exportar) reciba tipos
 * consistentes con `Correctivo`.
 */
export function normalizeCorrectivo<T extends Record<string, unknown>>(
  row: T
): T {
  return {
    ...row,
    monto:
      row.monto === null || row.monto === undefined
        ? null
        : Number(row.monto),
  };
}

export function normalizeCorrectivos<T extends Record<string, unknown>>(
  rows: T[]
): T[] {
  return rows.map(normalizeCorrectivo);
}

/**
 * Las columnas DATE de Postgres pueden llegar como objeto Date o como
 * string ISO completo ("2026-08-27T00:00:00.000Z") según el driver y
 * si pasan por una API route (JSON) o por un Server Component (RSC).
 * Concatenar texto a ciegas (`valor + "T00:00:00"`) rompía tanto el
 * listado (mostraba "Invalid Date") como el formulario de edición
 * (los campos de fecha aparecían vacíos). Esta función siempre
 * devuelve "YYYY-MM-DD" o "" — el único formato que un <input
 * type="date"> acepta.
 */
export function toDateOnly(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

// ───────── opciones.ts ─────────
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
  { clave: "visita_tecnica", nombre: "Visita técnica" },
  { clave: "cotizacion", nombre: "Cotización" },
  { clave: "oc", nombre: "OC" },
  { clave: "informe", nombre: "Informe" },
  { clave: "certificado", nombre: "Certificado" },
] as const;

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

// ───────── num.ts ─────────
/**
 * Convierte un valor del formulario en número o null (vacío).
 * A diferencia de "valor || null" NO convierte 0 en null, y devuelve
 * `undefined` si el texto no es un número válido (para responder 400
 * en vez de guardar NaN).
 */
export function numOrNull(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// ───────── formato.ts ─────────
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

// ───────── archivos.ts ─────────
// Tipos permitidos como adjunto. Se decide por extensión (no por el tipo
// que declara el navegador) y se excluyen a propósito SVG y HTML, que
// podrían ejecutar scripts al abrirse desde la propia página.
export const TIPOS_PERMITIDOS: Record<string, { mime: string; inline: boolean }> = {
  pdf: { mime: "application/pdf", inline: true },
  jpg: { mime: "image/jpeg", inline: true },
  jpeg: { mime: "image/jpeg", inline: true },
  png: { mime: "image/png", inline: true },
  webp: { mime: "image/webp", inline: true },
  gif: { mime: "image/gif", inline: true },
  doc: { mime: "application/msword", inline: false },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    inline: false,
  },
  xls: { mime: "application/vnd.ms-excel", inline: false },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    inline: false,
  },
};

// Vercel rechaza cuerpos de petición de más de 4.5 MB en funciones.
export const MAX_BYTES = 4 * 1024 * 1024;
export const MAX_ARCHIVOS_POR_TICKET = 20;

export function extensionDe(nombre: string): string {
  const i = nombre.lastIndexOf(".");
  return i === -1 ? "" : nombre.slice(i + 1).toLowerCase();
}

export type Archivo = {
  id: number;
  nombre: string;
  tipo: string;
  tamano: number;
  subido_por: string | null;
  created_at: string;
};

// ───────── acceso por página (usuarios) ─────────
/** Páginas que se pueden asignar a un usuario. "Usuarios" es solo para administradores y no figura aquí. */
export const PAGINAS = [
  { href: "/dashboard", label: "Panel" },
  { href: "/correctivos", label: "Correctivos" },
  { href: "/materiales", label: "Materiales" },
] as const;

/** Rutas de la API que usa cada página: sin acceso a la página tampoco se pueden llamar. */
const API_POR_PAGINA: Record<string, string[]> = {
  "/dashboard": ["/api/dashboard"],
  "/correctivos": ["/api/correctivos", "/api/export", "/api/ordenes-compra", "/api/cotizaciones"],
  "/materiales": [],
};

/** Deja solo páginas conocidas (sin repetir). No es un arreglo → null (= todas las páginas). */
export function paginasValidas(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const conocidas: string[] = PAGINAS.map((p) => p.href);
  return [...new Set(v.filter((x): x is string => typeof x === "string" && conocidas.includes(x)))];
}

const empieza = (ruta: string, base: string) => ruta === base || ruta.startsWith(base + "/");

/** ¿Puede este usuario abrir la ruta? Administrador o `paginas` null = todo. */
export function puedeVerRuta(rol: string, paginas: string[] | null, ruta: string): boolean {
  if (rol === "admin" || paginas === null) return true;
  if (ruta.startsWith("/api")) {
    if (ruta.startsWith("/api/auth")) return true;
    return paginas.some((p) => (API_POR_PAGINA[p] ?? []).some((a) => empieza(ruta, a)));
  }
  return paginas.some((p) => empieza(ruta, p));
}
