import {
  ESTADOS,
  TIPOS_TRAB,
  SUB_TIPOS_TRAB,
  AREAS,
  LUGARES,
} from "@/lib/shared/opciones";
import { numOrNull } from "@/lib/shared/num";

/** Datos de un ticket ya validados y limpios (texto recortado, "" → null). */
export type DatosCorrectivo = {
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
};

export type ResultadoValidacion =
  | { ok: true; datos: DatosCorrectivo }
  | { ok: false; error: string };

const MAX_TEXTO = {
  ticket: 100,
  descripcion: 2000,
  proveedor: 200,
  cuenta: 100,
  n_oc: 100,
} as const;

const ETIQUETA_TEXTO: Record<keyof typeof MAX_TEXTO, string> = {
  ticket: "Ticket",
  descripcion: "Descripción",
  proveedor: "Proveedor",
  cuenta: "Cuenta",
  n_oc: "N° OC",
};

const LISTAS = {
  lugar: { opciones: LUGARES as readonly string[], etiqueta: "Lugar" },
  tipo_trab: { opciones: TIPOS_TRAB as readonly string[], etiqueta: "Tipo de trabajo" },
  sub_tipo_trab: { opciones: SUB_TIPOS_TRAB as readonly string[], etiqueta: "Sub tipo" },
  area: { opciones: AREAS as readonly string[], etiqueta: "Área" },
} as const;

const FECHAS = {
  f_reg: "F. registro",
  f_coti: "F. cotización",
  f_oc: "F. OC",
  f_inicio: "F. inicio",
  f_fin: "F. fin",
} as const;

// Postgres DATE acepta mucho más, pero fuera de este rango casi seguro es un error de tipeo.
const ANIO_MIN = 1900;
const ANIO_MAX = 2100;
const MAX_REFER = 2_147_483_647; // límite de INTEGER en Postgres
const MAX_MONTO = 9_999_999_999; // NUMERIC(12,2): 10 dígitos enteros

/** true si el texto es una fecha real con formato AAAA-MM-DD. */
export function fechaIsoValida(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const anio = Number(s.slice(0, 4));
  if (anio < ANIO_MIN || anio > ANIO_MAX) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Valida los filtros de fecha de la URL (desde/hasta). Devuelve el error o null. */
export function errorFiltrosFecha(searchParams: URLSearchParams): string | null {
  for (const clave of ["desde", "hasta"] as const) {
    const v = searchParams.get(clave);
    if (v && !fechaIsoValida(v)) {
      return `El filtro "${clave}" debe ser una fecha válida (AAAA-MM-DD)`;
    }
  }
  return null;
}

// undefined = tipo de dato inválido; null = vacío.
function texto(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) v = String(v);
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? null : t;
}

const falla = (error: string): ResultadoValidacion => ({ ok: false, error });

/**
 * Valida el cuerpo de POST/PUT de un ticket.
 * `previo` (solo al editar) es la fila actual: un valor que ya tenía el
 * ticket (por ejemplo importado del Excel original) se sigue aceptando
 * aunque ya no esté en las listas desplegables, para no impedir editarlo.
 */
export function validarCorrectivo(
  body: unknown,
  previo?: Record<string, unknown>
): ResultadoValidacion {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return falla("Datos inválidos");
  }
  const b = body as Record<string, unknown>;

  const t: Record<string, string | null> = {};
  for (const campo of Object.keys(MAX_TEXTO) as (keyof typeof MAX_TEXTO)[]) {
    const v = texto(b[campo]);
    if (v === undefined) return falla(`${ETIQUETA_TEXTO[campo]} no es válido`);
    if (v && v.length > MAX_TEXTO[campo]) {
      return falla(`${ETIQUETA_TEXTO[campo]} admite hasta ${MAX_TEXTO[campo]} caracteres`);
    }
    t[campo] = v;
  }
  if (!t.descripcion) return falla("La descripción es obligatoria");

  const refer = numOrNull(b.refer);
  const monto = numOrNull(b.monto);
  if (refer === undefined || monto === undefined) {
    return falla("N° Refer. y Monto deben ser números válidos");
  }
  if (refer !== null && (!Number.isInteger(refer) || refer < 0 || refer > MAX_REFER)) {
    return falla("N° Refer. debe ser un número entero válido");
  }
  if (monto !== null && Math.abs(monto) > MAX_MONTO) {
    return falla("El monto está fuera de rango");
  }

  const f: Record<string, string | null> = {};
  for (const [campo, etiqueta] of Object.entries(FECHAS)) {
    const raw = b[campo];
    if (raw === null || raw === undefined || raw === "") {
      f[campo] = null;
      continue;
    }
    if (typeof raw !== "string") return falla(`${etiqueta} no es una fecha válida`);
    const dia = raw.trim().slice(0, 10); // acepta también "2026-08-18T00:00:00.000Z"
    if (!fechaIsoValida(dia)) return falla(`${etiqueta} no es una fecha válida`);
    f[campo] = dia;
  }

  const estadoRaw = texto(b.estado);
  if (estadoRaw === undefined) return falla("Estado no válido");
  const estado = estadoRaw ?? "cotizar";
  if (!(ESTADOS as readonly string[]).includes(estado) && previo?.estado !== estado) {
    return falla("Estado no válido");
  }

  const l: Record<string, string | null> = {};
  for (const [campo, { opciones, etiqueta }] of Object.entries(LISTAS)) {
    const v = texto(b[campo]);
    if (v === undefined) return falla(`${etiqueta} no es válido`);
    if (v && !opciones.includes(v) && previo?.[campo] !== v) {
      return falla(`${etiqueta} no es válido`);
    }
    l[campo] = v;
  }

  return {
    ok: true,
    datos: {
      refer,
      ticket: t.ticket,
      f_reg: f.f_reg,
      descripcion: t.descripcion,
      lugar: l.lugar,
      estado,
      proveedor: t.proveedor,
      monto,
      f_coti: f.f_coti,
      f_oc: f.f_oc,
      f_inicio: f.f_inicio,
      f_fin: f.f_fin,
      cuenta: t.cuenta,
      tipo_trab: l.tipo_trab,
      sub_tipo_trab: l.sub_tipo_trab,
      n_oc: t.n_oc,
      area: l.area,
    },
  };
}
