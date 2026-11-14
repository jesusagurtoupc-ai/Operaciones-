import {
  ESTADOS,
  TIPOS_TRAB,
  SUB_TIPOS_TRAB,
  LUGARES,
  AREAS,
  DOCUMENTOS,
  ESTADOS_CON_PLAZO,
  DIAS_ATRASO,
  toDateOnly,
  hoyLima,
  diasEntre,
  venceCotizacion,
} from "@/lib/shared";
import type { Correctivo } from "@/lib/shared";

/* Tipos, constantes y funciones de los filtros de la lista de correctivos. */

export type Dimension = "estado" | "tipo_trab" | "sub_tipo_trab" | "lugar" | "area" | "proveedor" | "sin";

export const DIMENSIONES: Dimension[] = ["estado", "tipo_trab", "sub_tipo_trab", "lugar", "area", "proveedor", "sin"];

export interface Filtros {
  q: string;
  desde: string;
  hasta: string;
  estado: string[];
  tipo_trab: string[];
  sub_tipo_trab: string[];
  lugar: string[];
  area: string[];
  proveedor: string[];
  sin: string[];
  /** Orden de la lista: "" = el de por defecto (Ref de mayor a menor). */
  orden: string;
  /** "1" = viendo la papelera (solo administradores); "" = tickets activos. */
  papelera: string;
}

export const FILTROS_VACIOS: Filtros = {
  q: "",
  desde: "",
  hasta: "",
  estado: [],
  tipo_trab: [],
  sub_tipo_trab: [],
  lugar: [],
  area: [],
  proveedor: [],
  sin: [],
  orden: "",
  papelera: "",
};

export interface ItemFaceta {
  valor: string;
  cantidad: number;
  monto: number;
}
export type Facetas = Record<Dimension, ItemFaceta[]>;

export const FACETAS_VACIAS: Facetas = {
  estado: [],
  tipo_trab: [],
  sub_tipo_trab: [],
  lugar: [],
  area: [],
  proveedor: [],
  sin: [],
};

// Orden fijo de las opciones: las tarjetas no cambian de lugar cuando se
// filtra, solo cambian sus números.
const ORDEN: Record<Dimension, readonly string[]> = {
  estado: ESTADOS,
  tipo_trab: TIPOS_TRAB,
  sub_tipo_trab: SUB_TIPOS_TRAB,
  lugar: LUGARES,
  area: AREAS,
  proveedor: [],
  sin: DOCUMENTOS.map((d) => d.nombre),
};

export const TITULO_GRUPO: Record<Exclude<Dimension, "estado">, string> = {
  tipo_trab: "Tipo de trabajo",
  sub_tipo_trab: "Sub tipo de trabajo",
  lugar: "Lugar",
  area: "Área",
  proveedor: "Proveedor",
  sin: "Documento pendiente",
};

// Color de cada estado (el mismo tono que su etiqueta en la tabla): se reconoce de un vistazo
// en qué punto del trámite está cada ticket.
export const ACENTO_ESTADO: Record<string, string> = {
  cotizar: "#94a3b8",
  enviado: "#0ea5e9",
  "Ingresado a PS": "#f59e0b",
  "Por Ejecutar": "#f97316",
  "Esperando Informe": "#8b5cf6",
  Finalizado: "#10b981",
};

export function construirParams(f: Filtros, pagina?: number, soloPagina = false) {
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.desde) params.set("desde", f.desde);
  if (f.hasta) params.set("hasta", f.hasta);
  if (f.orden) params.set("orden", f.orden);
  if (f.papelera) params.set("papelera", "1");
  for (const dim of DIMENSIONES) {
    for (const v of f[dim]) params.append(dim, v);
  }
  if (pagina !== undefined) {
    params.set("page", String(pagina));
    params.set("pageSize", "25");
    if (soloPagina) params.set("facetas", "0");
  }
  return params;
}

// ───────── Filtros en la dirección (URL) ─────────
// Los filtros, el orden y la página viven en la dirección (/correctivos?estado=…&page=2): al entrar a un
// ticket y volver (con "Volver", "Guardar" o la flecha atrás del navegador) la lista aparece tal como
// se dejó. También se puede copiar el enlace y compartir esa vista filtrada.

/** Lee los filtros y la página de una dirección. Valores raros se ignoran (el servidor igual los valida). */
export function leerFiltros(sp: URLSearchParams): { filtros: Filtros; pagina: number } {
  const corto = (v: string | null, max = 200) => (v ?? "").slice(0, max);
  const fecha = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
  const filtros: Filtros = {
    ...FILTROS_VACIOS,
    q: corto(sp.get("q")),
    desde: fecha(sp.get("desde")),
    hasta: fecha(sp.get("hasta")),
    orden: corto(sp.get("orden"), 40),
    papelera: sp.get("papelera") === "1" ? "1" : "",
  };
  for (const dim of DIMENSIONES) {
    filtros[dim] = Array.from(new Set(sp.getAll(dim).filter((v) => v !== "").map((v) => v.slice(0, 200)))).slice(0, 100);
  }
  const n = Number(sp.get("page"));
  return { filtros, pagina: Number.isInteger(n) && n >= 1 && n <= 100000 ? n : 1 };
}

/** Dirección de la lista con estos filtros y esta página ("/correctivos" si no hay nada elegido). */
export function urlLista(f: Filtros, pagina = 1): string {
  const params = construirParams(f);
  if (pagina > 1) params.set("page", String(pagina));
  const qs = params.toString();
  return qs ? `/correctivos?${qs}` : "/correctivos";
}

const CLAVE_ULTIMA_LISTA = "correctivos_ultima_lista";

/** Recuerda (en esta pestaña) la última vista de la lista, para que el ticket sepa a dónde volver. */
export function recordarLista(url: string) {
  try {
    sessionStorage.setItem(CLAVE_ULTIMA_LISTA, url);
  } catch {
    // sessionStorage no disponible: se vuelve a la lista sin filtros.
  }
}

const CLAVE_SCROLL = "correctivos_scroll";

/** Guarda hasta dónde se bajó en la lista (para volver al mismo punto desde un ticket o una pestaña). */
export function recordarScroll(url: string, y: number) {
  try {
    sessionStorage.setItem(CLAVE_SCROLL, JSON.stringify({ url, y: Math.max(0, Math.round(y)) }));
  } catch {
    // sin sessionStorage: se vuelve arriba de la lista.
  }
}

/** Posición guardada para ESTA vista de la lista (mismos filtros y página), o null. */
export function scrollGuardado(url: string): number | null {
  try {
    const d = JSON.parse(sessionStorage.getItem(CLAVE_SCROLL) ?? "null") as { url?: string; y?: number } | null;
    return d && d.url === url && typeof d.y === "number" ? d.y : null;
  } catch {
    return null;
  }
}

/** A dónde vuelve el ticket: la última vista de la lista (con sus filtros) o la lista sin filtros. */
export function rutaUltimaLista(): string {
  try {
    const u = sessionStorage.getItem(CLAVE_ULTIMA_LISTA) ?? "";
    // Solo direcciones de la propia lista (nunca otra página ni otro sitio).
    return /^\/correctivos(\?[^#]*)?$/.test(u) ? u : "/correctivos";
  } catch {
    return "/correctivos";
  }
}

export function unirOrdenado(dim: Dimension, actual: string[], nuevos: string[]) {
  const orden = ORDEN[dim];
  return Array.from(new Set([...actual, ...nuevos])).sort((a, b) => {
    const ia = orden.indexOf(a);
    const ib = orden.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b, "es");
  });
}

/** Días que lleva el ticket en su estado actual, solo si ya pasó el plazo. */
export function diasAtraso(r: Correctivo): number | null {
  if (!ESTADOS_CON_PLAZO.includes(r.estado)) return null;
  const desde = r.estado_desde ?? r.f_reg ?? r.updated_at ?? r.created_at;
  if (!desde) return null;
  const dias = Math.floor((Date.now() - new Date(desde).getTime()) / 86_400_000);
  return dias >= DIAS_ATRASO ? dias : null;
}

/** Días que pasaron desde la fecha de entrega de la OC, si ya venció y el ticket sigue sin informe. */
export function diasEntregaVencida(r: Correctivo): number | null {
  if (r.estado !== "Por Ejecutar" && r.estado !== "Esperando Informe") return null;
  if (!esperaInforme(r)) return null;
  const f = toDateOnly(r.f_entrega);
  if (!f) return null;
  // Con el día de Lima (no el de la máquina): el servidor está en UTC.
  const dias = diasEntre(f, hoyLima());
  return dias > 0 ? dias : null;
}

/** ¿El ticket aún espera su informe? (sin archivo cargado y sin estar marcado "No aplica"). */
function esperaInforme(r: Correctivo): boolean {
  return !r.documentos?.informe?.url && r.documentos?.informe?.estado !== "No aplica";
}

// ───────── Alertas de cada ticket (los avisos de colores en la columna Estado) ─────────

export type ClaveAlerta =
  | "atraso"
  | "cotizacion_vence"
  | "entrega_vencida"
  | "entrega_proxima"
  | "sin_fecha_entrega"
  | "sin_informe"
  | "sin_certificado"
  | "sin_monto";

export const ALERTAS: { clave: ClaveAlerta; nombre: string; ayuda: string; porDefecto: boolean }[] = [
  { clave: "atraso", nombre: "Días en el mismo estado", ayuda: `Más de ${DIAS_ATRASO} días sin cambiar de estado`, porDefecto: true },
  { clave: "entrega_vencida", nombre: "Entrega vencida", ayuda: "Pasó la fecha de entrega de la OC y no hay informe", porDefecto: true },
  { clave: "entrega_proxima", nombre: "Entrega próxima", ayuda: "La entrega vence hoy o en los próximos 3 días", porDefecto: true },
  { clave: "sin_informe", nombre: "Finalizado sin informe", ayuda: "El ticket está finalizado pero no tiene informe", porDefecto: true },
  { clave: "cotizacion_vence", nombre: "Cotización por vencer", ayuda: "Ticket sin OC cuya cotización vence en 3 días o menos (o ya venció)", porDefecto: true },
  { clave: "sin_fecha_entrega", nombre: "Sin fecha de entrega", ayuda: "Por ejecutar o esperando informe, sin fecha de entrega", porDefecto: false },
  { clave: "sin_certificado", nombre: "Finalizado sin certificado", ayuda: "Finalizado sin certificado (salvo que esté como No aplica)", porDefecto: false },
  { clave: "sin_monto", nombre: "Sin monto", ayuda: "El ticket no tiene monto (p. ej. una OC en dólares)", porDefecto: false },
];

export const ALERTAS_POR_DEFECTO: ClaveAlerta[] = ALERTAS.filter((a) => a.porDefecto).map((a) => a.clave);

export type AlertaTicket = { clave: ClaveAlerta; texto: string; titulo: string; tono: "rojo" | "ambar" | "gris" };

/** Días que faltan para la fecha de entrega (0 = hoy, negativo = ya pasó). */
function diasParaEntrega(r: Correctivo): number | null {
  const f = toDateOnly(r.f_entrega);
  if (!f) return null;
  return diasEntre(hoyLima(), f);
}

/** Todas las alertas que corresponden al ticket, limitadas a las claves activas. */
export function alertasDeTicket(r: Correctivo, activas: readonly string[]): AlertaTicket[] {
  const on = (c: ClaveAlerta) => activas.includes(c);
  const out: AlertaTicket[] = [];
  const enCurso = r.estado === "Por Ejecutar" || r.estado === "Esperando Informe";
  const sinInforme = esperaInforme(r);

  const at = diasAtraso(r);
  if (on("atraso") && at !== null) {
    out.push({ clave: "atraso", texto: `⚠ ${at} d`, titulo: `Lleva ${at} días en este estado`, tono: "rojo" });
  }
  const venc = diasEntregaVencida(r);
  if (on("entrega_vencida") && venc !== null) {
    out.push({
      clave: "entrega_vencida",
      texto: `⏰ entrega +${venc} d`,
      titulo: `La fecha de entrega de la OC venció hace ${venc} días y aún no hay informe`,
      tono: "rojo",
    });
  }
  const falta = enCurso && sinInforme ? diasParaEntrega(r) : null;
  if (on("entrega_proxima") && falta !== null && falta >= 0 && falta <= 3) {
    out.push({
      clave: "entrega_proxima",
      texto: falta === 0 ? "⏳ entrega hoy" : `⏳ entrega en ${falta} d`,
      titulo: falta === 0 ? "La entrega de la OC vence hoy" : `La entrega de la OC vence en ${falta} días`,
      tono: "ambar",
    });
  }
  // Cotización por vencer: el ticket aún no tiene OC y la validez de su cotización termina pronto.
  const vence = !r.n_oc && ["cotizar", "enviado", "Ingresado a PS", ""].includes(r.estado ?? "") ? venceCotizacion(r) : null;
  const quedan = vence ? diasEntre(hoyLima(), vence) : null;
  if (on("cotizacion_vence") && quedan !== null && quedan <= 3) {
    out.push({
      clave: "cotizacion_vence",
      texto: quedan < 0 ? `⌛ cotización vencida ${-quedan} d` : quedan === 0 ? "⌛ cotización vence hoy" : `⌛ cotización vence en ${quedan} d`,
      titulo:
        quedan < 0
          ? `La cotización venció hace ${-quedan} días y aún no hay OC: pide la OC o una cotización nueva`
          : `La cotización vence ${quedan === 0 ? "hoy" : `en ${quedan} días`} y aún no hay OC`,
      tono: quedan < 0 ? "rojo" : "ambar",
    });
  }
  if (on("sin_fecha_entrega") && enCurso && !toDateOnly(r.f_entrega)) {
    out.push({ clave: "sin_fecha_entrega", texto: "📅 sin fecha de entrega", titulo: "El ticket no tiene fecha de entrega", tono: "gris" });
  }
  if (on("sin_informe") && r.estado === "Finalizado" && sinInforme) {
    out.push({ clave: "sin_informe", texto: "📄 sin informe", titulo: "Está finalizado pero no tiene informe cargado", tono: "ambar" });
  }
  if (
    on("sin_certificado") &&
    r.estado === "Finalizado" &&
    !r.documentos?.certificado?.url &&
    r.documentos?.certificado?.estado !== "No aplica"
  ) {
    out.push({ clave: "sin_certificado", texto: "📜 sin certificado", titulo: "Está finalizado pero no tiene certificado", tono: "gris" });
  }
  if (on("sin_monto") && (r.monto === null || r.monto === undefined)) {
    out.push({ clave: "sin_monto", texto: "💲 sin monto", titulo: "El ticket no tiene monto", tono: "gris" });
  }
  return out;
}

export const CLASE_TONO_ALERTA: Record<AlertaTicket["tono"], string> = {
  rojo: "text-danger",
  ambar: "text-amber-700",
  gris: "text-ink-soft",
};

/** Una notificación de un ticket concreto (lo que devuelve /api/correctivos/avisos). */
export type AvisoItem = AlertaTicket & {
  id: number;
  refer: number | null;
  n_oc: string | null;
  descripcion: string;
};
