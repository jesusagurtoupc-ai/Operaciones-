// ───────── types.ts ─────────
/** Una línea de documento del ticket: su número, estado y enlace. */
export type DocumentoLinea = {
  numero: string;
  estado: string;
  url: string;
  /** Otros archivos de la misma línea (otra cotización, guía de remisión, ficha, acta…). */
  adicionales?: DocumentoAdicional[];
  /** Monto total del documento (con IGV), leído del PDF o escrito a mano. Solo cotización, OC e informe. */
  monto?: number | null;
  /** Moneda del monto del documento (soles si no se indica). */
  moneda?: "PEN" | "USD";
};

/** Documentos cuyos montos se comparan entre sí (deben coincidir). */
export const DOCS_CON_MONTO = [
  { clave: "cotizacion", nombre: "Cotización" },
  { clave: "oc", nombre: "OC" },
  { clave: "informe", nombre: "Informe" },
] as const;
/** Diferencia máxima aceptada entre montos (redondeos de céntimos). */
export const TOLERANCIA_MONTO = 1;

/** Un monto de documento válido (0 a 10 000 millones, en céntimos) o null. */
export function montoDocValido(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v) * 100) / 100;
  return Number.isFinite(n) && n >= 0 && n < 1e10 ? n : null;
}

export type ComparacionMontos = {
  /** Los documentos que tienen monto, en orden: cotización, OC, informe. */
  montos: { clave: "cotizacion" | "oc" | "informe"; nombre: string; monto: number; moneda: "PEN" | "USD" }[];
  /** null = hay menos de dos montos para comparar. */
  coinciden: boolean | null;
  /** Diferencia entre el mayor y el menor (en la misma moneda), o null si las monedas no coinciden. */
  diferencia: number | null;
  /** La diferencia parece ser el IGV (un monto es el otro × 1,18). */
  pareceIgv: boolean;
  /** Frase corta para avisos ("Cotización S/ 1 000,00 · OC S/ 1 180,00 · Informe —"). */
  detalle: string;
};

/** Compara los montos de la cotización, la OC y el informe del ticket. */
export function compararMontos(docs: Documentos | null | undefined): ComparacionMontos {
  const montos: ComparacionMontos["montos"] = [];
  for (const { clave, nombre } of DOCS_CON_MONTO) {
    const d = docs?.[clave];
    const m = montoDocValido(d?.monto);
    if (d && m !== null && d.estado !== "No aplica") montos.push({ clave, nombre, monto: m, moneda: d.moneda === "USD" ? "USD" : "PEN" });
  }
  const fmt = (x: { monto: number; moneda: string }) => (x.moneda === "USD" ? formatoDolares(x.monto) : formatoSoles(x.monto));
  const detalle = montos.map((x) => `${x.nombre} ${fmt(x)}`).join(" · ");
  if (montos.length < 2) return { montos, coinciden: null, diferencia: null, pareceIgv: false, detalle };
  if (new Set(montos.map((x) => x.moneda)).size > 1) return { montos, coinciden: false, diferencia: null, pareceIgv: false, detalle };
  const vals = montos.map((x) => x.monto);
  const diferencia = Math.round((Math.max(...vals) - Math.min(...vals)) * 100) / 100;
  const coinciden = diferencia <= TOLERANCIA_MONTO;
  const pareceIgv =
    !coinciden && vals.some((a) => vals.some((b) => b > 0 && Math.abs(a - b * 1.18) <= Math.max(TOLERANCIA_MONTO, b * 0.002)));
  return { montos, coinciden, diferencia, pareceIgv, detalle };
}
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
  /** Monto total que trae el documento (p. ej. un informe con su valorización), si se leyó. */
  monto?: { total: number; moneda: "PEN" | "USD" } | null;
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
  /** Monto en soles: el que suman el panel, el presupuesto y los informes. En un ticket en dólares es el
   *  equivalente en soles (monto_usd × tipo_cambio). */
  monto: number | null;
  /** Moneda de la OC o cotización: "PEN" (soles) o "USD" (dólares). */
  moneda?: string | null;
  /** Monto en dólares tal como viene en la OC o cotización (solo si moneda = "USD"). */
  monto_usd?: number | null;
  /** Soles por dólar usados para pasar monto_usd a soles. */
  tipo_cambio?: number | null;
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
  /** Tipo de cambio impreso en la OC (soles por dólar), si lo trae. */
  tipo_cambio?: number | null;
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
  /** Tipo de cambio impreso en la cotización (soles por dólar), si lo trae. */
  tipo_cambio?: number | null;
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
    // «Esperando Informe» ya no existe: se muestra y se guarda como «Por Ejecutar».
    ...(row.estado === ESTADO_ANTIGUO_INFORME ? { estado: "Por Ejecutar" } : {}),
    monto:
      row.monto === null || row.monto === undefined
        ? null
        : Number(row.monto),
    ...("monto_usd" in row ? { monto_usd: row.monto_usd === null || row.monto_usd === undefined ? null : Number(row.monto_usd) } : {}),
    ...("tipo_cambio" in row ? { tipo_cambio: row.tipo_cambio === null || row.tipo_cambio === undefined ? null : Number(row.tipo_cambio) } : {}),
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
  "Finalizado",
] as const;

/**
 * Regla del informe: un ticket sin informe no se cierra; se queda en «Por Ejecutar» hasta que se carga.
 * «Esperando Informe» ya no se usa (un ticket guardado así se trata como «Por Ejecutar»).
 * Cuenta como informe el archivo cargado o el documento marcado «No aplica» (trabajos que no lo requieren).
 */
export const ESTADO_ANTIGUO_INFORME = "Esperando Informe";
export function tieneInforme(c: { documentos?: Partial<Record<string, { url?: string | null; estado?: string | null } | undefined>> | null }): boolean {
  const i = c.documentos?.informe;
  return !!i?.url || i?.estado === "No aplica";
}
export const SQL_TIENE_INFORME =
  // COALESCE en ambos: sin informe registrado la condición debe dar FALSO (no NULL, que NOT no invierte).
  "(COALESCE(documentos->'informe'->>'url', '') <> '' OR COALESCE(documentos->'informe'->>'estado', '') = 'No aplica')";
export const MSG_FINALIZAR_SIN_INFORME =
  "Para pasar a «Finalizado» primero carga el informe del trabajo (o márcalo «No aplica»). Mientras tanto el ticket queda en «Por Ejecutar».";

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
export const ESTADOS_CON_PLAZO = ["Ingresado a PS", "Por Ejecutar"];
export const DIAS_ATRASO = 15;

// ───────── SLA cotización → OC ─────────
/**
 * Meta del SLA de compra: días hábiles (lunes a viernes; los feriados no se descuentan) desde la fecha de la
 * cotización hasta la fecha de emisión de la OC. Para cambiar la meta, cambia este número.
 */
export const SLA_COTI_OC_DIAS = 5;
/** Estados en que el ticket aún espera su OC (el SLA sigue corriendo). */
export const ESTADOS_SIN_OC = ["cotizar", "enviado", "Ingresado a PS", ""];

/** Días hábiles (lun–vie) después de `desde` y hasta `hasta` inclusive (YYYY-MM-DD). 0 si hasta ≤ desde. */
// ───────── Feriados nacionales del Perú (se descuentan de los días hábiles del SLA) ─────────
// D. Leg. 713 y leyes posteriores (7 jun, 23 jul, 6 ago y 9 dic desde 2023-2024): 16 feriados al año.
// Jueves y Viernes Santo se calculan a partir de la Pascua. FERIADOS_EXTRA: feriados que el Gobierno declara
// para un año puntual (agregar aquí cuando se publiquen).
const FERIADOS_FIJOS = ["01-01", "05-01", "06-07", "06-29", "07-23", "07-28", "07-29", "08-06", "08-30", "10-08", "11-01", "12-08", "12-09", "12-25"];
const FERIADOS_EXTRA = ["2026-08-13"]; // Río Amazonas, Maravilla Natural del Mundo (gob.pe, feriados 2026)
function pascua(anio: number): Date {
  // Algoritmo de Meeus/Jones/Butcher (calendario gregoriano).
  const a = anio % 19, b = Math.floor(anio / 100), c = anio % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(anio, mes - 1, dia));
}
/** Feriados nacionales de un año (AAAA-MM-DD). */
export function feriadosPeru(anio: number): string[] {
  const p = pascua(anio).getTime();
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return [
    ...FERIADOS_FIJOS.map((md) => `${anio}-${md}`),
    iso(p - 3 * 86_400_000), // Jueves Santo
    iso(p - 2 * 86_400_000), // Viernes Santo
    ...FERIADOS_EXTRA.filter((f) => f.startsWith(String(anio))),
  ].sort();
}
/** Feriados de 2023 a 2032 (alcanza para los tickets y el SLA). */
const FERIADOS = Array.from({ length: 10 }, (_, i) => feriadosPeru(2023 + i)).flat();

export function diasHabiles(desde: string, hasta: string): number {
  return diasHabilesSinFeriados(desde, hasta) - FERIADOS.filter((f) => f > desde.slice(0, 10) && f <= hasta.slice(0, 10) && esDiaDeSemana(f)).length;
}
function esDiaDeSemana(f: string): boolean {
  const d = new Date(Date.UTC(Number(f.slice(0, 4)), Number(f.slice(5, 7)) - 1, Number(f.slice(8, 10)))).getUTCDay();
  return d !== 0 && d !== 6;
}
function diasHabilesSinFeriados(desde: string, hasta: string): number {
  const ms = (f: string) => Date.UTC(Number(f.slice(0, 4)), Number(f.slice(5, 7)) - 1, Number(f.slice(8, 10)));
  const total = Math.round((ms(hasta) - ms(desde)) / 86_400_000);
  if (!(total > 0)) return 0;
  let n = Math.floor(total / 7) * 5;
  let dia = new Date(ms(desde)).getUTCDay();
  for (let i = 0; i < total % 7; i++) {
    dia = (dia + 1) % 7;
    if (dia !== 0 && dia !== 6) n++;
  }
  return n;
}

export type SlaCotiOc = { dias: number; meta: number; cumple: boolean; /** Aún sin OC: cuenta hasta hoy. */ enCurso: boolean };
/**
 * SLA del ticket: días hábiles entre la cotización y la OC. Sin OC (y aún esperándola) cuenta hasta hoy.
 * null si no hay fecha de cotización, si la OC es anterior a la cotización (dato a revisar) o si el ticket
 * siguió sin OC (p. ej. finalizado sin compra).
 */
export function slaCotiOc(
  c: { f_coti?: string | null; f_oc?: string | null; n_oc?: string | null; estado?: string | null },
  hoy: string = hoyLima()
): SlaCotiOc | null {
  const coti = toDateOnly(c.f_coti ?? null);
  if (!coti) return null;
  const oc = toDateOnly(c.f_oc ?? null);
  if (oc) {
    if (oc < coti) return null;
    const dias = diasHabiles(coti, oc);
    return { dias, meta: SLA_COTI_OC_DIAS, cumple: dias <= SLA_COTI_OC_DIAS, enCurso: false };
  }
  if (String(c.n_oc ?? "").trim() || !ESTADOS_SIN_OC.includes(c.estado ?? "")) return null;
  const dias = diasHabiles(coti, hoy);
  return { dias, meta: SLA_COTI_OC_DIAS, cumple: dias <= SLA_COTI_OC_DIAS, enCurso: true };
}

/** Lo mismo en SQL (días hábiles de `desde` exclusive a `hasta` inclusive), para los paneles. */
// Cálculo directo (sin recorrer día por día, que con miles de tickets hacía lento el Panel): semanas completas × 5
// más los días hábiles del resto, según el día de la semana de inicio (tabla de 7 × 7). Da lo mismo que diasHabiles().
export const SQL_DIAS_HABILES = (desde: string, hasta: string) =>
  `(CASE WHEN (${hasta}) > (${desde}) THEN ((((${hasta}) - (${desde})) / 7) * 5 + (ARRAY[0,1,2,3,4,4,4,0,1,2,3,3,3,4,0,1,2,2,2,3,4,0,1,1,1,2,3,4,0,0,0,1,2,3,4,0,0,1,2,3,4,5,0,1,2,3,4,5,5])[(EXTRACT(ISODOW FROM (${desde}))::int - 1) * 7 + (((${hasta}) - (${desde})) % 7) + 1]` +
  // menos los feriados (de lunes a viernes) que caen en el rango
  ` - (SELECT COUNT(*) FROM unnest('{${FERIADOS_LABORABLES.join(",")}}'::date[]) fer WHERE fer > (${desde}) AND fer <= (${hasta}))::int) ELSE 0 END)::int`;
/** Feriados que caen de lunes a viernes (los de fin de semana ya no cuentan como hábiles). */
const FERIADOS_LABORABLES = FERIADOS.filter(esDiaDeSemana);

// "No aplica": trabajos que no requieren ese documento (ej. sin certificado).
export const ESTADOS_DOC = ["Pendiente", "Listo", "Aprobado", "No aplica"] as const;

export const ESTADO_DOC_COLORS: Record<string, string> = {
  Pendiente: "bg-concrete-dim text-ink-soft",
  Listo: "bg-teal-soft text-teal",
  Aprobado: "bg-teal text-white",
  "No aplica": "bg-concrete-dim text-ink-soft line-through decoration-line-strong",
};

export const ESTADO_COLORS: Record<string, string> = {
  // Fondo claro + texto oscuro + borde fino del mismo tono: se lee bien y no se ve «pastel».
  cotizar: "bg-page text-ink-soft ring-1 ring-inset ring-ink-soft/25",
  enviado: "bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-600/25",
  "Ingresado a PS": "bg-aviso-soft text-aviso ring-1 ring-inset ring-aviso/30",
  "Por Ejecutar": "bg-orange-50 text-orange-800 ring-1 ring-inset ring-orange-600/30",
  "Esperando Informe": "bg-violet-50 text-violet-800 ring-1 ring-inset ring-violet-600/25",
  Finalizado: "bg-teal-soft text-teal ring-1 ring-inset ring-teal/30",
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
// ───────── dólares ─────────
/** Tipo de cambio razonable (soles por dólar): lo que esté fuera se considera mal leído o mal escrito. */
export const TC_MIN = 2;
export const TC_MAX = 10;
export const tipoCambioValido = (v: unknown): number | null => {
  const n = Math.round(Number(v) * 10000) / 10000;
  return Number.isFinite(n) && n >= TC_MIN && n <= TC_MAX ? n : null;
};
/** Equivalente en soles de un monto en dólares (redondeado a céntimos). */
export const solesDeDolares = (usd: number | null | undefined, tc: number | null | undefined): number | null =>
  usd === null || usd === undefined || !tc ? null : Math.round(usd * tc * 100) / 100;
export function formatoDolares(n: number | null | undefined, decimales = 2) {
  if (n === null || n === undefined) return "—";
  return "US$ " + new Intl.NumberFormat("es-PE", { minimumFractionDigits: decimales, maximumFractionDigits: decimales }).format(n);
}
/** El monto de un ticket como se muestra: en dólares (con su equivalente en soles) o en soles. */
export function textoMonto(c: { monto: number | null; moneda?: string | null; monto_usd?: number | null; tipo_cambio?: number | null }, decimales = 2): string {
  if (c.moneda === "USD" && c.monto_usd !== null && c.monto_usd !== undefined) {
    return c.monto !== null && c.monto !== undefined
      ? `${formatoDolares(c.monto_usd, decimales)} (${formatoSoles(c.monto, decimales)})`
      : `${formatoDolares(c.monto_usd, decimales)} (sin tipo de cambio)`;
  }
  return formatoSoles(c.monto, decimales);
}

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

// ───────── campus ─────────
/**
 * Campus con datos separados (tickets, materiales, inventario, gestión). Cada fila de la base lleva su
 * campus y cada usuario ve solo el suyo ("*" = todos, con selector en la barra). El `id` no cambia nunca
 * (es lo que se guarda); el `nombre` se puede corregir aquí sin tocar datos. Para agregar otro campus,
 * suma una línea.
 */
export const CAMPUS = [
  { id: "principal", nombre: "UPC San Isidro" },
  { id: "villa", nombre: "UPC Villa" },
] as const;
export type IdCampus = (typeof CAMPUS)[number]["id"];
/** Campus de todos los datos que existían antes de separar por campus. */
export const CAMPUS_PRINCIPAL: IdCampus = "principal";
/** Asignado a un usuario que puede ver todos los campus. */
export const TODOS_LOS_CAMPUS = "*";
/** Cookie con el campus elegido en el selector de la barra. */
export const COOKIE_CAMPUS = "campus";
export const esCampus = (v: unknown): v is IdCampus => CAMPUS.some((c) => c.id === v);
export const nombreCampus = (id: string | null | undefined) =>
  id === TODOS_LOS_CAMPUS ? "Todos los campus" : (CAMPUS.find((c) => c.id === id)?.nombre ?? String(id ?? ""));
/** Campus que puede ver un usuario según lo asignado ("*" o un id). */
export function campusPermitidos(asignado: string | null | undefined): IdCampus[] {
  if (asignado === TODOS_LOS_CAMPUS) return CAMPUS.map((c) => c.id);
  return [esCampus(asignado) ? asignado : CAMPUS_PRINCIPAL];
}

// ───────── acceso por página (usuarios) ─────────
/** Páginas que se pueden asignar a un usuario. "Usuarios" es solo para administradores y no figura aquí. */
export const PAGINAS = [
  { href: "/dashboard", label: "Panel" },
  { href: "/correctivos", label: "Correctivos" },
  { href: "/materiales", label: "Materiales" },
  { href: "/inventario", label: "Inventario" },
  // Gestión (ver lib/gestion.ts): cada página se puede asignar por separado.
  { href: "/gestion/garantias", label: "Gestión · Garantías" },
  { href: "/gestion/agenda", label: "Gestión · Agenda y contratistas" },
  { href: "/gestion/presupuesto", label: "Gestión · Presupuesto" },
  { href: "/gestion/preventivos", label: "Gestión · Preventivos contratados" },
  { href: "/gestion/reportes", label: "Gestión · Reportes por QR" },
  { href: "/gestion/informe", label: "Gestión · Informe mensual" },
  { href: "/gestion/planos", label: "Gestión · Planos" },
  { href: "/gestion/tableros", label: "Gestión · Tableros eléctricos" },
] as const;

/** Rutas de la API que usa cada página: sin acceso a la página tampoco se pueden llamar. */
const API_POR_PAGINA: Record<string, string[]> = {
  "/dashboard": ["/api/dashboard"],
  // /api/inventario: el ticket muestra (y deja elegir) el equipo del inventario al que corresponde.
  // /api/gestion/garantias?ticket=: aviso de que el ticket puede estar cubierto por una garantía.
  "/correctivos": ["/api/correctivos", "/api/export", "/api/ordenes-compra", "/api/cotizaciones", "/api/documentos", "/api/inventario", "/api/gestion/garantias"],
  "/materiales": ["/api/materiales"],
  "/inventario": ["/api/inventario", "/api/materiales/fotos"],
  "/gestion/garantias": ["/api/gestion/garantias"],
  "/gestion/agenda": ["/api/gestion/agenda"],
  "/gestion/presupuesto": ["/api/gestion/presupuesto"],
  "/gestion/preventivos": ["/api/gestion/preventivos"],
  // La bandeja muestra la foto del reporte; los ambientes del inventario sirven para armar los QR.
  "/gestion/reportes": ["/api/gestion/reportes", "/api/materiales/fotos", "/api/inventario"],
  "/gestion/informe": ["/api/gestion/informe"],
  "/gestion/planos": ["/api/gestion/planos"],
};

/**
 * Archivos de `public/` que necesita cada página. Antes no figuraban aquí y el control de acceso los
 * bloqueaba: un usuario con acceso solo a "Materiales" no podía cargar el catálogo.
 */
const ARCHIVOS_POR_PAGINA: Record<string, string[]> = {
  "/materiales": ["/catalogo-materiales.json", "/materiales-fuera-catalogo.json"],
  "/inventario": ["/inventario-equipos.json"],
  "/gestion/reportes": ["/inventario-equipos.json"],
  // Quien ya tenía «Planos» conserva el acceso a los tableros (antes eran una pestaña de esa página).
  "/gestion/planos": ["/tableros-circuitos.html"],
  "/gestion/tableros": ["/tableros-circuitos.html"],
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

/**
 * Revisión automática de un ticket: incoherencias entre sus datos y sus documentos, para corregirlas a
 * tiempo. Devuelve frases cortas (vacío = todo en orden). Se muestra dentro del ticket, sin ventanas.
 * `rucRegistro`: RUC(s) de la empresa en el registro de proveedores (si se conocen).
 */
export function revisarTicket(c: Correctivo, rucRegistro: string[] = [], hoy = hoyLima()): string[] {
  const avisos: string[] = [];
  const docs = c.documentos ?? {};
  const tiene = (k: DocumentoClave) => !!docs[k]?.url;
  const fecha = (f: string | null | undefined) => formatoFecha(toDateOnly(f ?? null));

  const vence = venceCotizacion(c);
  if (vence && vence < hoy && !tiene("oc") && c.estado !== "Finalizado") {
    avisos.push(`La cotización venció el ${fecha(vence)} y aún no hay OC: conviene pedir una cotización actualizada.`);
  }
  const ruc = (c.ruc_proveedor ?? "").trim();
  if (ruc && rucRegistro.length && !rucRegistro.includes(ruc)) {
    avisos.push(`El RUC ${ruc} no es el de ${c.proveedor} en el registro de proveedores (${rucRegistro.join(" / ")}).`);
  }
  const nDoc = (docs.oc?.numero ?? "").replace(/\D/g, "");
  const nOc = (c.n_oc ?? "").replace(/\D/g, "");
  if (tiene("oc") && nDoc && nOc && nDoc !== nOc) {
    avisos.push(`El N° de OC del ticket (${c.n_oc}) no es el del documento OC cargado (${docs.oc?.numero}).`);
  }
  const partidas = c.condiciones?.partidas ?? [];
  const suma = Math.round(partidas.reduce((t, p) => t + (Number(p.monto) || 0), 0) * 100) / 100;
  const m = Number(c.monto);
  if (tiene("oc") && suma > 0 && m > 0) {
    const cerca = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, b * 0.02);
    if (!cerca(m, suma) && !cerca(m, suma * 1.18)) {
      avisos.push(
        `El monto del ticket (${formatoSoles(m)}) no coincide con la cotización (${formatoSoles(suma)} sin IGV · ${formatoSoles(Math.round(suma * 118) / 100)} con IGV).`
      );
    }
  }
  const cmp = compararMontos(docs);
  if (cmp.coinciden === false) {
    avisos.push(
      `Los montos de los documentos no coinciden: ${cmp.detalle}${cmp.diferencia !== null ? ` (diferencia ${formatoSoles(cmp.diferencia)})` : " (monedas distintas)"}${cmp.pareceIgv ? ". Parece ser el IGV: revisa si uno está sin IGV" : ""}.`
    );
  }
  const fOc = toDateOnly(c.f_oc);
  const fFin = toDateOnly(c.f_fin);
  const fIni = toDateOnly(c.f_inicio);
  if (fOc && fFin && fFin < fOc) avisos.push(`La fecha de fin (${fecha(fFin)}) es anterior a la fecha de la OC (${fecha(fOc)}).`);
  if (fIni && fFin && fFin < fIni) avisos.push(`La fecha de fin (${fecha(fFin)}) es anterior a la de inicio (${fecha(fIni)}).`);
  if (c.estado === "Finalizado" && !tiene("informe")) avisos.push("Está Finalizado pero no tiene el informe cargado.");
  if (tiene("informe") && !fFin) avisos.push("Tiene informe pero falta la fecha de fin del trabajo.");
  if (c.estado === "Por Ejecutar" && fFin && fFin < hoy && !tiene("informe")) {
    const d = diasEntre(fFin, hoy);
    if (d > DIAS_ATRASO) avisos.push(`Terminó hace ${d} días y aún no tiene informe: sigue en «Por Ejecutar» hasta cargarlo.`);
  }
  return avisos;
}
