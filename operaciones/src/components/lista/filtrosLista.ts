import {
  ESTADOS,
  TIPOS_TRAB,
  SUB_TIPOS_TRAB,
  LUGARES,
  AREAS,
  DOCUMENTOS,
  ESTADOS_CON_PLAZO,
  DIAS_ATRASO,
} from "@/lib/shared/opciones";
import type { Correctivo } from "@/lib/shared/types";

/* Tipos, constantes y funciones de los filtros de la lista de correctivos. */

export type Dimension = "estado" | "tipo_trab" | "sub_tipo_trab" | "lugar" | "area" | "sin";

export const DIMENSIONES: Dimension[] = ["estado", "tipo_trab", "sub_tipo_trab", "lugar", "area", "sin"];

export interface Filtros {
  q: string;
  desde: string;
  hasta: string;
  estado: string[];
  tipo_trab: string[];
  sub_tipo_trab: string[];
  lugar: string[];
  area: string[];
  sin: string[];
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
  sin: [],
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
  sin: DOCUMENTOS.map((d) => d.nombre),
};

export const TITULO_GRUPO: Record<Exclude<Dimension, "estado">, string> = {
  tipo_trab: "Tipo de trabajo",
  sub_tipo_trab: "Sub tipo de trabajo",
  lugar: "Lugar",
  area: "Área",
  sin: "Documento pendiente",
};

// Barra de color de cada estado: gris mientras avanza el trámite, rojo
// institucional en lo que requiere acción, verde cuando terminó.
export const ACENTO_ESTADO: Record<string, string> = {
  cotizar: "#b6b6ba",
  enviado: "#8c8c90",
  "Ingresado a PS": "#58585d",
  "Por Ejecutar": "#3a3a3d",
  "Esperando Informe": "#141416",
  Finalizado: "#2f6e52",
};

export function construirParams(f: Filtros, pagina?: number, soloPagina = false) {
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.desde) params.set("desde", f.desde);
  if (f.hasta) params.set("hasta", f.hasta);
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
