// ───────── types.ts ─────────
/** Una línea de documento del ticket: su número, estado y enlace. */
export type DocumentoLinea = {
  numero: string;
  estado: string;
  url: string;
  /** Otros archivos de la misma línea (otra cotización, guía de remisión, ficha, acta…). */
  adicionales?: DocumentoAdicional[];
};
export type DocumentoAdicional = { nombre: string; url: string };
/** Máximo de archivos adicionales por línea. */
export const MAX_ADICIONALES = 15;

/**
 * N° de cotización normalizado para compararlo entre documentos: sin mayúsculas, guiones ni espacios, y con
 * el año en 2 cifras ("SM-0196-2025" y "SM-0196-25" → "sm019625").
 */
export function normNumCotizacion(n: string | null | undefined): string {
  return (n ?? "").toLowerCase().replace(/(\D)20(\d{2})$/, "$1$2").replace(/[^a-z0-9]/g, "");
}

/** Qué es un documento cargado (lo decide /api/documentos/leer). */
export type TipoDocumento = "oc" | "cotizacion" | "informe" | "certificado" | "guia" | "otro";

/** Lo que devuelve /api/documentos/leer. */
export type DocumentoLeido = {
  tipo: TipoDocumento;
  /** Título del documento si se reconoció ("INFORME TÉCNICO N° 974 - 2026"). */
  titulo: string | null;
  /** PDF sin texto (escaneado): solo se usó el nombre del archivo. */
  escaneado: boolean;
  pistas: PistasDocumento;
  oc?: Omit<DatosOC, "otros_tickets">;
  cotizacion?: DatosCotizacion;
};

/** Pistas de un documento para juntarlo con los demás del mismo trabajo. */
export type PistasDocumento = {
  /** N° de OC que cita, sin prefijo ni ceros ("162509"). */
  ocs: string[];
  /** Números sueltos del nombre del archivo (valen solo si coinciden con una OC conocida). */
  numeros: string[];
  /** N° de cotización que cita ("421-2026/HVC"). */
  cotizaciones: string[];
  /** RUC del proveedor (nunca el de la universidad). */
  ruc: string | null;
  fecha: string | null;
  /** Qué se hizo, en pocas palabras (título, asunto, nombre del archivo). */
  resumen: string;
  /** Nombres de empresa y dominios de correo que aparecen en el documento (para el proveedor si no hay RUC). */
  empresas: string[];
};

/** N° de OC sin prefijo ni ceros a la izquierda: "PER05-0000162509" → "162509". */
export function numeroOc(t: string | null | undefined): string {
  const s = String(t ?? "").trim().replace(/^[A-Z]{3}\d{2}-?/i, "");
  return s.replace(/\D/g, "").replace(/^0+/, "");
}

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
  /** Condiciones leídas de su cotización (plazo, validez, garantía, pago, partidas). */
  condiciones?: CondicionesCotizacion | null;
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
  /** Qué trabajo se cotiza (línea "Solicitud:", "Asunto:", "Servicio:"…): la descripción del ticket. */
  solicitud?: string | null;
  /** Lugar dentro del campus si la cotización lo dice ("Area: LABORATORIO 406 B - Pabellon B"). */
  ubicacion?: string | null;
  /** Condiciones comerciales leídas (plazo, validez, garantía, pago, partidas). */
  condiciones?: CondicionesCotizacion | null;
  avisos: string[];
};

/** Partida principal de una cotización ("1.00 TRABAJOS PRELIMINARES S/ 300.00"). */
export type PartidaCotizacion = { item: string; descripcion: string; monto: number };

/**
 * Condiciones de la cotización que se guardan en el ticket (columna `condiciones`). Todo es opcional:
 * cada proveedor escribe distinto y lo que no se encuentra queda en null.
 */
export type CondicionesCotizacion = {
  /** N° de la cotización de la que salieron. */
  numero?: string | null;
  /** Plazo de entrega/ejecución: "2 días hábiles una vez generada la OC" → 2, "hábiles". */
  plazo_dias?: number | null;
  plazo_tipo?: "hábiles" | "calendario" | null;
  plazo_texto?: string | null;
  /** Validez de la oferta en días calendario, contados desde la fecha de la cotización. */
  validez_dias?: number | null;
  /** Garantía del trabajo en meses ("6 meses", "1 año" → 12), contada desde la fecha de fin. */
  garantia_meses?: number | null;
  garantia_texto?: string | null;
  forma_pago?: string | null;
  partidas?: PartidaCotizacion[];
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
  "/correctivos": ["/api/correctivos", "/api/export", "/api/ordenes-compra", "/api/cotizaciones", "/api/documentos"],
  "/materiales": ["/api/materiales"],
};

/**
 * Archivos de `public/` que necesita cada página. Antes no figuraban aquí y el control de acceso los
 * bloqueaba: un usuario con acceso solo a "Materiales" no podía cargar el catálogo.
 */
const ARCHIVOS_POR_PAGINA: Record<string, string[]> = {
  "/materiales": ["/catalogo-materiales.json", "/materiales-fuera-catalogo.json"],
};

/** Deja solo páginas conocidas (sin repetir). No es un arreglo → null (= todas las páginas). */
export function paginasValidas(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const conocidas: string[] = PAGINAS.map((p) => p.href);
  return [...new Set(v.filter((x): x is string => typeof x === "string" && conocidas.includes(x)))];
}

/**
 * Lista de páginas tal como se guarda: si están marcadas TODAS se guarda null (= todas), así una
 * página que se agregue en el futuro también le aparece a ese usuario.
 */
export function paginasParaGuardar(lista: string[] | null): string[] | null {
  if (lista === null) return null;
  return PAGINAS.every((p) => lista.includes(p.href)) ? null : lista;
}

const empieza = (ruta: string, base: string) => ruta === base || ruta.startsWith(base + "/");

/** ¿Puede este usuario abrir la ruta? Administrador o `paginas` null = todo. */
export function puedeVerRuta(rol: string, paginas: string[] | null, ruta: string): boolean {
  if (rol === "admin" || paginas === null) return true;
  if (ruta.startsWith("/api")) {
    if (ruta.startsWith("/api/auth")) return true;
    return paginas.some((p) => (API_POR_PAGINA[p] ?? []).some((a) => empieza(ruta, a)));
  }
  if (paginas.some((p) => (ARCHIVOS_POR_PAGINA[p] ?? []).includes(ruta))) return true;
  return paginas.some((p) => empieza(ruta, p));
}

// ───────── fechas en hora de Lima ─────────
/**
 * Fecha de hoy (YYYY-MM-DD) en Lima, sin importar la zona horaria de la máquina. El servidor
 * (Vercel) trabaja en UTC: con `new Date().setHours(0,0,0,0)`, de 7 p. m. a medianoche de Lima ya
 * creía que era el día siguiente.
 */
export function hoyLima(ahora: Date = new Date()): string {
  return ahora.toLocaleDateString("en-CA", { timeZone: "America/Lima" });
}

/** Suma días a una fecha YYYY-MM-DD: calendario, o hábiles (lunes a viernes; no considera feriados). */
export function sumarDias(fecha: string, dias: number, habiles: boolean): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const f = new Date(Date.UTC(y, m - 1, d));
  if (!habiles) f.setUTCDate(f.getUTCDate() + dias);
  else {
    let n = 0;
    while (n < dias) {
      f.setUTCDate(f.getUTCDate() + 1);
      const dow = f.getUTCDay();
      if (dow !== 0 && dow !== 6) n++;
    }
  }
  return f.toISOString().slice(0, 10);
}

/** Suma meses a una fecha YYYY-MM-DD (31/01 + 1 mes → 28 o 29/02). */
export function sumarMeses(fecha: string, meses: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const ultimo = new Date(Date.UTC(y, m - 1 + meses + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + meses, Math.min(d, ultimo))).toISOString().slice(0, 10);
}

/** Fecha hasta la que vale la cotización (fecha + validez en días calendario), o null. */
export function venceCotizacion(c: Pick<Correctivo, "f_coti" | "condiciones">): string | null {
  const f = toDateOnly(c.f_coti);
  const v = c.condiciones?.validez_dias;
  return f && v ? sumarDias(f, v, false) : null;
}

/** Fecha hasta la que rige la garantía del trabajo (fecha de fin + meses), o null. */
export function garantiaHasta(c: Pick<Correctivo, "f_fin" | "condiciones">): string | null {
  const f = toDateOnly(c.f_fin);
  const m = c.condiciones?.garantia_meses;
  return f && m ? sumarMeses(f, m) : null;
}

/** Días de calendario de `desde` a `hasta` (ambas YYYY-MM-DD); negativo si `hasta` es anterior. */
export function diasEntre(desde: string, hasta: string): number {
  const ms = (f: string) => {
    const [y, m, d] = f.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(hasta) - ms(desde)) / 86_400_000);
}

// ───────── proveedores: un solo nombre por empresa ─────────
// Formas jurídicas que se escriben de mil maneras ("S.A.C.", "SAC", "S. A. C.", "Sociedad Anónima
// Cerrada"…): al final del nombre no cuentan para decidir si es la misma empresa. Las de varias palabras
// se quitan como frase completa (así "OTRA EMPRESA S.A." conserva "EMPRESA").
const FORMAS_JURIDICAS = new Set(["SAC", "SA", "SAA", "SRL", "EIRL", "SCRL", "SCR", "SCS", "SAS"]);
const FRASES_JURIDICAS = [
  "SOCIEDAD ANONIMA CERRADA",
  "SOCIEDAD ANONIMA ABIERTA",
  "SOCIEDAD ANONIMA",
  "SOCIEDAD COMERCIAL DE RESPONSABILIDAD LIMITADA",
  "SOCIEDAD DE RESPONSABILIDAD LIMITADA",
  "EMPRESA INDIVIDUAL DE RESPONSABILIDAD LIMITADA",
];

/**
 * Clave para comparar nombres de proveedor: sin tildes, mayúsculas, sin puntos ni signos, "&" = "Y",
 * letras sueltas unidas ("M S G" → "MSG") y sin la forma jurídica final. Así "MSG Perú S.A.C.",
 * "M.S.G. PERU SAC" y "msg peru" dan la misma clave ("MSG PERU"). Vacía si no queda nada.
 */
export function claveProveedor(nombre: string | null | undefined): string {
  const limpio = (nombre ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/&/g, " Y ")
    .replace(/[.,;:()"'´`\-_/]/g, " ")
    .replace(/[^A-Z0-9Ñ ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Une letras sueltas consecutivas: "S A C" → "SAC", "M S G" → "MSG".
  const unidos: string[] = [];
  let ultimaEsSuelta = false; // ¿el último elemento se formó solo con letras sueltas?
  for (const t of limpio.split(" ").filter(Boolean)) {
    const suelta = t.length === 1 && /[A-ZÑ]/.test(t);
    if (suelta && ultimaEsSuelta) {
      unidos[unidos.length - 1] += t;
    } else {
      unidos.push(t);
    }
    ultimaEsSuelta = suelta;
  }
  let t = unidos.join(" ");
  for (let cambio = true; cambio; ) {
    cambio = false;
    for (const f of FRASES_JURIDICAS) {
      if (t.endsWith(" " + f)) {
        t = t.slice(0, -f.length - 1);
        cambio = true;
      }
    }
    const partes = t.split(" ");
    if (partes.length > 1 && FORMAS_JURIDICAS.has(partes[partes.length - 1])) {
      t = partes.slice(0, -1).join(" ");
      cambio = true;
    }
  }
  return t;
}
