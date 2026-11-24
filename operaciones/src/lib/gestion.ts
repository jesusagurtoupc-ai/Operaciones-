// Páginas de Gestión (Garantías, Agenda y contratistas, Presupuesto, Preventivos contratados, Reportes por QR
// e Informe mensual): tipos y cálculos que comparten el servidor (/api/gestion/[modulo]) y el navegador.
import { diasEntre, sumarMeses, toDateOnly } from "@/lib/shared";

/** Módulos de Gestión, en el orden del menú. Las rutas también figuran en PAGINAS (lib/shared.ts). */
export const MODULOS = [
  { clave: "garantias", href: "/gestion/garantias", label: "Garantías", icono: "🛡" },
  { clave: "agenda", href: "/gestion/agenda", label: "Agenda y contratistas", icono: "📅" },
  { clave: "presupuesto", href: "/gestion/presupuesto", label: "Presupuesto", icono: "💰" },
  { clave: "preventivos", href: "/gestion/preventivos", label: "Preventivos contratados", icono: "🔁" },
  { clave: "reportes", href: "/gestion/reportes", label: "Reportes por QR", icono: "📣" },
  { clave: "informe", href: "/gestion/informe", label: "Informe mensual", icono: "📝" },
] as const;
export type ClaveModulo = (typeof MODULOS)[number]["clave"];

/** Días antes del vencimiento en que algo pasa a "por vencer". */
export const DIAS_AVISO = 30;

export type Semaforo = "vencido" | "por_vencer" | "al_dia" | "sin_dato";
export function semaforo(fecha: string | null | undefined, hoy: string, aviso = DIAS_AVISO): Semaforo {
  const f = toDateOnly(fecha);
  if (!f) return "sin_dato";
  const d = diasEntre(hoy, f);
  return d < 0 ? "vencido" : d <= aviso ? "por_vencer" : "al_dia";
}
export const SEMAFORO_TEXTO: Record<Semaforo, string> = {
  vencido: "Vencido",
  por_vencer: "Por vencer",
  al_dia: "Al día",
  sin_dato: "Sin fecha",
};
export const SEMAFORO_COLOR: Record<Semaforo, string> = {
  vencido: "bg-red-100 text-red-800",
  por_vencer: "bg-amber-100 text-amber-900",
  al_dia: "bg-emerald-100 text-emerald-800",
  sin_dato: "bg-slate-100 text-slate-600",
};

/** Registro genérico de la tabla gestion_registros. */
export type Registro<T> = { id: number; datos: T; usuario: string | null; actualizado_en: string };

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Clave para comparar nombres (proveedores, cuentas): sin tildes, mayúsculas, espacios ni signos
 *  ("Frío S.A.C." = "FRIO SAC"). También sirve para buscar: `claveTexto(texto).includes(claveTexto(q))`. */
export const claveTexto = (s: string | null | undefined) =>
  sinTildes(String(s ?? "")).toUpperCase().replace(/[^A-Z0-9]+/g, "");

// ───────── Garantías ─────────

/** Lo que el servidor manda de cada ticket para calcular garantías y reclamos. */
export type TicketGestion = {
  id: number;
  refer: number | null;
  ticket: string | null;
  descripcion: string;
  lugar: string | null;
  proveedor: string | null;
  monto: number | null;
  estado: string;
  f_reg: string | null;
  f_inicio: string | null;
  f_fin: string | null;
  f_entrega: string | null;
  cuenta: string | null;
  area: string | null;
  sub_tipo_trab: string | null;
  garantia_meses: number | null;
  garantia_texto: string | null;
  /** Equipo del inventario enlazado al ticket. */
  codigo: string | null;
};

/** Ajuste manual de una garantía (meses que no venían en la cotización, nota y reclamo al proveedor). */
export type AjusteGarantia = {
  correctivo_id: number;
  meses?: number | null;
  nota?: string;
  reclamo?: { estado: (typeof ESTADOS_RECLAMO)[number]; fecha: string; nota?: string } | null;
};
export const ESTADOS_RECLAMO = ["Por reclamar", "Reclamado", "Atendido por el proveedor", "No procede"] as const;

export type Garantia = {
  t: TicketGestion;
  meses: number;
  desde: string;
  hasta: string;
  /** Días que faltan (negativo: ya venció). */
  dias: number;
  estado: Semaforo;
  fuente: "cotizacion" | "manual";
  ajuste: AjusteGarantia | null;
  /** Tickets abiertos después del trabajo, mientras la garantía regía, en el mismo equipo o ambiente. */
  posibles: TicketGestion[];
};

/** Códigos de ambiente que cita un texto ("A-301", "aula 301 B" → A301 / B301). */
export function ambientesDe(texto: string): Set<string> {
  const t = sinTildes(texto).toUpperCase();
  const r = new Set<string>();
  for (const m of t.matchAll(/(?<![A-Z0-9])([AB])\s*-?\s*(\d{3})(?!\d)/g)) r.add(m[1] + m[2]);
  for (const m of t.matchAll(/(?<!\d)(\d{3})\s*-?\s*([AB])(?![A-Z0-9])/g)) r.add(m[2] + m[1]);
  return r;
}

/** ¿El ticket `b` puede ser una falla del mismo trabajo `a` (mismo equipo, o mismo ambiente y especialidad)? */
export function mismoTrabajo(a: TicketGestion, b: TicketGestion): boolean {
  if (a.id === b.id) return false;
  if (a.codigo && b.codigo) return a.codigo === b.codigo;
  const amb = ambientesDe(`${a.descripcion} ${a.lugar ?? ""}`);
  if (amb.size === 0) return false;
  const otros = ambientesDe(`${b.descripcion} ${b.lugar ?? ""}`);
  if (![...amb].some((x) => otros.has(x))) return false;
  return !a.sub_tipo_trab || !b.sub_tipo_trab || a.sub_tipo_trab === b.sub_tipo_trab;
}

export function calcularGarantias(tickets: TicketGestion[], ajustes: AjusteGarantia[], hoy: string): Garantia[] {
  const porId = new Map(ajustes.map((a) => [a.correctivo_id, a]));
  const out: Garantia[] = [];
  for (const t of tickets) {
    const aj = porId.get(t.id) ?? null;
    const meses = aj?.meses ?? t.garantia_meses;
    const desde = toDateOnly(t.f_fin);
    if (!meses || meses <= 0 || !desde) continue;
    const hasta = sumarMeses(desde, meses);
    const posibles = tickets.filter((b) => {
      const f = toDateOnly(b.f_reg);
      return !!f && f > desde && f <= hasta && mismoTrabajo(t, b);
    });
    out.push({
      t, meses, desde, hasta, dias: diasEntre(hoy, hasta), estado: semaforo(hasta, hoy),
      fuente: aj?.meses ? "manual" : "cotizacion", ajuste: aj, posibles,
    });
  }
  return out.sort((a, b) => a.hasta.localeCompare(b.hasta));
}

// ───────── Agenda y contratistas ─────────

export const RIESGOS = ["Trabajo en altura", "Trabajo en caliente", "Riesgo eléctrico", "Espacio confinado"] as const;
const PALABRAS_RIESGO: [string, RegExp][] = [
  ["Trabajo en altura", /\b(ALTURA|TECHO|AZOTEA|FACHADA|ANDAMIO|ESCALERA|CUBIERTA|TECHADO|CANALETA|LUMINARIAS? ALTAS?|FALSO CIELO|DRYWALL EN TECHO|VIDRIOS? EXTERIOR)/],
  ["Trabajo en caliente", /\b(SOLDA|CORTE CON|ESMERIL|AMOLAD|OXICORTE|DISCO DE CORTE)/],
  ["Riesgo eléctrico", /\b(TABLERO|ELECTRIC|SUBESTACION|CABLEADO|TENSION|INTERRUPTOR|LLAVE TERMICA|POZO A TIERRA|GRUPO ELECTROGENO|UPS)/],
  ["Espacio confinado", /\b(CISTERNA|TANQUE|BUZON|POZO|CAMARA DE BOMBEO|SOTANO TECNICO|DUCTO)/],
];
/** Riesgos que sugiere la descripción del trabajo (la persona los confirma). */
export function riesgosSugeridos(texto: string): string[] {
  const t = sinTildes(texto).toUpperCase();
  return PALABRAS_RIESGO.filter(([, re]) => re.test(t)).map(([r]) => r);
}

export const ESTADOS_PERMISO = ["Pendiente", "Emitido", "No aplica"] as const;
export type Permiso = {
  correctivo_id: number;
  riesgos: string[];
  estado: (typeof ESTADOS_PERMISO)[number];
  numero?: string;
  nota?: string;
};

export const DOCUMENTOS_CONTRATISTA = [
  "SCTR salud",
  "SCTR pensión",
  "Póliza de responsabilidad civil",
  "Seguro Vida Ley",
  "Plan de seguridad (IPERC)",
  "Otro",
] as const;
/** Documentos sin los que el contratista no debería entrar a trabajar. */
export const DOCUMENTOS_OBLIGATORIOS = ["SCTR salud", "SCTR pensión"];

export type DocContratista = { tipo: string; vence: string | null; enlace?: string };
export type Contratista = {
  proveedor: string;
  documentos: DocContratista[];
  personal: { nombre: string; cargo?: string }[];
  contacto?: string;
  notas?: string;
};

/** Avisos de la documentación de un contratista a la fecha `hoy`. */
export function alertasContratista(c: Contratista | null | undefined, hoy: string): { texto: string; grave: boolean }[] {
  const out: { texto: string; grave: boolean }[] = [];
  if (!c) return [{ texto: "Sin documentación registrada (SCTR)", grave: true }];
  for (const tipo of DOCUMENTOS_OBLIGATORIOS) {
    if (!c.documentos.some((d) => d.tipo === tipo)) out.push({ texto: `Falta ${tipo}`, grave: true });
  }
  for (const d of c.documentos) {
    const s = semaforo(d.vence, hoy);
    if (s === "vencido") out.push({ texto: `${d.tipo} vencido (${d.vence})`, grave: true });
    else if (s === "por_vencer") out.push({ texto: `${d.tipo} vence en ${diasEntre(hoy, d.vence!)} días`, grave: false });
  }
  if (c.personal.length === 0) out.push({ texto: "Sin personal autorizado registrado", grave: false });
  return out;
}

/** Fechas en que el ticket está en obra: de inicio a fin (o a la fecha de entrega de la OC). */
export function rangoTrabajo(t: TicketGestion): { desde: string; hasta: string } | null {
  const ini = toDateOnly(t.f_inicio) || null;
  const fin = toDateOnly(t.f_fin) || toDateOnly(t.f_entrega) || ini;
  if (!ini && !fin) return null;
  const desde = (ini || fin)!;
  const hasta = fin && fin >= desde ? fin : desde;
  return { desde, hasta };
}

// ───────── Presupuesto ─────────

export type LineaPresupuesto = { anio: number; cuenta: string; monto: number; nota?: string };
/** Gasto de un mes por cuenta: comprometido = con OC y aún sin finalizar; ejecutado = finalizado. */
export type GastoCuenta = { cuenta: string; mes: number; comprometido: number; ejecutado: number; n: number };
/** % del presupuesto a partir del cual se avisa. */
export const ALERTA_PRESUPUESTO = 0.8;

// ───────── Preventivos contratados ─────────

export type Preventivo = {
  servicio: string;
  categoria: string;
  proveedor?: string;
  frecuencia_meses: number;
  ultimo: string | null;
  ubicacion?: string;
  /** Lo revisa Defensa Civil en la ITSE. */
  itse: boolean;
  contrato?: string;
  monto?: number | null;
  /** Enlace al informe o certificado (SharePoint, OneDrive…). */
  enlace?: string;
  notas?: string;
  activo: boolean;
  historial: { fecha: string; nota?: string; enlace?: string; usuario?: string }[];
};
export const CATEGORIAS_PREVENTIVO = ["Seguridad contra incendios", "Eléctrico", "Transporte vertical", "Sanitario", "Climatización", "Saneamiento ambiental", "Otro"] as const;

export function proximoPreventivo(p: Pick<Preventivo, "ultimo" | "frecuencia_meses">): string | null {
  const u = toDateOnly(p.ultimo);
  return u && p.frecuencia_meses > 0 ? sumarMeses(u, p.frecuencia_meses) : null;
}

/**
 * Servicios que suelen contratarse por frecuencia. Las frecuencias son de referencia: se ajustan al
 * contrato y a la norma vigente al agregarlos.
 */
export const SERVICIOS_SUGERIDOS: Omit<Preventivo, "ultimo" | "activo" | "historial">[] = [
  { servicio: "Mantenimiento de puertas cortafuego", categoria: "Seguridad contra incendios", frecuencia_meses: 6, itse: true },
  { servicio: "Sistema de detección y alarma contra incendios", categoria: "Seguridad contra incendios", frecuencia_meses: 6, itse: true },
  { servicio: "Red y bombas contra incendio (gabinetes, rociadores)", categoria: "Seguridad contra incendios", frecuencia_meses: 6, itse: true },
  { servicio: "Recarga y mantenimiento de extintores", categoria: "Seguridad contra incendios", frecuencia_meses: 12, itse: true },
  { servicio: "Luces de emergencia", categoria: "Seguridad contra incendios", frecuencia_meses: 6, itse: true },
  { servicio: "Señalización de seguridad", categoria: "Seguridad contra incendios", frecuencia_meses: 12, itse: true },
  { servicio: "Medición de pozos a tierra (certificado)", categoria: "Eléctrico", frecuencia_meses: 12, itse: true },
  { servicio: "Mantenimiento de subestación eléctrica", categoria: "Eléctrico", frecuencia_meses: 12, itse: true },
  { servicio: "Tableros eléctricos (mantenimiento y termografía)", categoria: "Eléctrico", frecuencia_meses: 12, itse: true },
  { servicio: "Grupo electrógeno", categoria: "Eléctrico", frecuencia_meses: 3, itse: false },
  { servicio: "UPS", categoria: "Eléctrico", frecuencia_meses: 6, itse: false },
  { servicio: "Pararrayos", categoria: "Eléctrico", frecuencia_meses: 12, itse: false },
  { servicio: "Ascensores (mantenimiento preventivo)", categoria: "Transporte vertical", frecuencia_meses: 1, itse: true },
  { servicio: "Limpieza y desinfección de cisternas y tanques", categoria: "Sanitario", frecuencia_meses: 6, itse: false },
  { servicio: "Fumigación, desinsectación y desratización", categoria: "Saneamiento ambiental", frecuencia_meses: 6, itse: false },
  { servicio: "Aire acondicionado (contrato de mantenimiento)", categoria: "Climatización", frecuencia_meses: 3, itse: false },
];

// ───────── Reportes por QR ─────────

export const CATEGORIAS_REPORTE = [
  "Eléctrico / iluminación",
  "Agua / baños",
  "Aire acondicionado / ventilación",
  "Mobiliario / puertas / ventanas",
  "Limpieza",
  "Seguridad / riesgo",
  "Otro",
] as const;
export const ESTADOS_REPORTE = ["Nuevo", "En atención", "Resuelto", "Descartado"] as const;
export type Reporte = {
  lugar: string;
  categoria: string;
  descripcion: string;
  contacto?: string;
  /** Llegó desde un QR emitido por la app (firma válida). */
  qr: boolean;
  estado: (typeof ESTADOS_REPORTE)[number];
  ticket_id?: number | null;
  ticket_texto?: string;
  nota?: string;
  foto?: boolean;
};
export const LIMITES_REPORTE = { lugar: 120, descripcion: 1000, contacto: 120 };

// ───────── Informe mensual ─────────

export type InformeMes = {
  mes: string; // YYYY-MM
  generado: string;
  tickets: {
    creados: number;
    finalizados: number;
    abiertos: number;
    atrasados: number;
    porEstado: { estado: string; n: number }[];
    antiguos: { id: number; refer: number | null; descripcion: string; estado: string; dias: number; proveedor: string | null }[];
  };
  gasto: {
    mes: number;
    anio: number;
    presupuestoAnio: number;
    porCuenta: { cuenta: string; monto: number }[];
    proveedores: { proveedor: string; monto: number; n: number }[];
    materiales: { n: number; total: number };
  };
  /** SLA cotización → OC de las OC emitidas en el mes (días hábiles). */
  sla: { meta: number; n: number; promedio: number | null; enMeta: number; fuera: number };
  garantias: { vigentes: number; porVencer: { refer: number | null; descripcion: string; proveedor: string | null; hasta: string }[]; posiblesReclamos: number };
  preventivos: { total: number; realizados: { servicio: string; fecha: string }[]; vencidos: { servicio: string; proximo: string | null }[]; proximos: { servicio: string; proximo: string }[] };
  reportes: { recibidos: number; pendientes: number; porCategoria: { categoria: string; n: number }[] };
  contratistas: { conAlertas: { proveedor: string; alertas: string[] }[] };
  inventario: Record<string, number> | null;
  nota: string;
};
