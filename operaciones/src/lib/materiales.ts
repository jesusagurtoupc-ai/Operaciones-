// Solicitud de materiales: tipos y reglas puras (búsqueda en el catálogo, totales, validación,
// borrador). No depende de React ni del servidor, así que se puede probar sola.

/** Una de las filas de public/catalogo-materiales.json (ver scripts/importar-catalogo.mjs). */
export type ArchivoCatalogo = {
  version: number;
  titulo: string;
  generado: string;
  proveedores: { id: string; nombre: string; minimo: string; entrega: string }[];
  categorias: string[];
  monedas: string[];
  vencimientos: string[];
  /** [articulo, descripcion, precio sin IGV, i.proveedor, i.categoria, i.moneda, i.vencimiento] */
  items: [string, string, number, number, number, number, number][];
};

export type ItemCatalogo = {
  articulo: string;
  descripcion: string;
  precio: number;
  moneda: string;
  /** Fecha hasta la que vale el precio (YYYY-MM-DD) o "". */
  vence: string;
  proveedor: string;
  minimo: string;
  entrega: string;
  /** Texto normalizado (sin tildes, en minúsculas) sobre el que se busca. */
  clave: string;
};

export type Catalogo = {
  titulo: string;
  generado: string;
  items: ItemCatalogo[];
};

/** Una línea de la solicitud: un artículo del catálogo o un material "libre" (fuera del catálogo). */
export type Linea = {
  uid: string;
  /** Id de artículo del catálogo; null en las líneas libres. */
  codigo: string | null;
  descripcion: string;
  cantidad: number;
  unidad: string;
  /** Precio unitario sin IGV; null = sin precio (líneas libres sin precio referencial). */
  precio: number | null;
  moneda: string;
  vence: string | null;
  proveedor: string | null;
  minimo: string | null;
  entrega: string | null;
};

export type Cabecera = {
  solicitante: string;
  area: string;
  ticket: string;
  lugar: string;
  fecha: string; // YYYY-MM-DD
  observaciones: string;
};

export const IGV = 0.18;
export const MAX_LINEAS = 300;
export const MAX_RESULTADOS = 50;
export const LIMITES = { descripcion: 300, unidad: 20, texto: 120, observaciones: 600 } as const;

// ───────── texto ─────────
/** Sin tildes, en minúsculas y con espacios simples: para comparar y buscar. */
export function normalizar(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u00a0\s]+/g, " ")
    .trim();
}

/** Fecha de hoy en Lima (YYYY-MM-DD), sin depender de la zona horaria del navegador. */
export function hoyLimaISO(ahora = new Date()): string {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ahora);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

/** YYYY-MM-DD → DD/MM/YYYY. */
export function fechaCorta(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

// ───────── catálogo ─────────
/** Convierte el archivo JSON compacto en objetos listos para buscar. */
export function prepararCatalogo(a: ArchivoCatalogo): Catalogo {
  const items: ItemCatalogo[] = a.items.map(([articulo, descripcion, precio, ip, , im, iv]) => {
    const prov = a.proveedores[ip];
    return {
      articulo,
      descripcion,
      precio,
      moneda: a.monedas[im] ?? "PEN",
      vence: a.vencimientos[iv] ?? "",
      proveedor: prov?.nombre ?? "",
      minimo: prov?.minimo ?? "",
      entrega: prov?.entrega ?? "",
      clave: normalizar(`${articulo} ${descripcion}`),
    };
  });
  return { titulo: a.titulo, generado: a.generado, items };
}

/**
 * Busca en el catálogo: todas las palabras escritas deben aparecer (en cualquier orden) en el código
 * o la descripción. Primero salen los que empiezan con la primera palabra o la tienen como palabra
 * completa. Devuelve como máximo `limite` resultados y el total de coincidencias.
 */
export function buscarCatalogo(
  cat: Catalogo,
  consulta: string,
  limite = MAX_RESULTADOS
): { items: ItemCatalogo[]; total: number } {
  const palabras = normalizar(consulta).split(" ").filter(Boolean);
  if (palabras.length === 0) return { items: [], total: 0 };
  const primera = palabras[0];
  const frase = palabras.join(" ");
  const aciertos: { it: ItemCatalogo; puntos: number }[] = [];
  for (const it of cat.items) {
    let ok = true;
    for (const p of palabras) {
      if (!it.clave.includes(p)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const i = it.clave.indexOf(primera);
    // 3: el texto empieza con la palabra · 2: es una palabra completa · 1: aparece dentro de otra
    const completa = i >= 0 && (i === 0 || it.clave[i - 1] === " ") && (it.clave[i + primera.length] ?? " ") === " ";
    // la frase completa tal cual la escribió la persona pesa más que palabras sueltas
    const puntos = (it.clave.startsWith(primera) ? 3 : completa ? 2 : 1) + (it.clave.includes(frase) ? 4 : 0);
    aciertos.push({ it, puntos });
  }
  // sort estable: dentro del mismo puntaje se conserva el orden del catálogo
  aciertos.sort((a, b) => b.puntos - a.puntos);
  return { items: aciertos.slice(0, limite).map((x) => x.it), total: aciertos.length };
}

// ───────── líneas y totales ─────────
let contador = 0;
export function nuevoUid(): string {
  contador += 1;
  return `l${Date.now().toString(36)}${contador}`;
}

export function lineaDeCatalogo(it: ItemCatalogo, cantidad = 1): Linea {
  return {
    uid: nuevoUid(),
    codigo: it.articulo,
    descripcion: it.descripcion,
    cantidad,
    unidad: "",
    precio: it.precio,
    moneda: it.moneda,
    vence: it.vence || null,
    proveedor: it.proveedor || null,
    minimo: it.minimo || null,
    entrega: it.entrega || null,
  };
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Importe de una línea (cantidad × precio, redondeado a céntimos); null si no tiene precio. */
export function subtotalLinea(l: Pick<Linea, "cantidad" | "precio">): number | null {
  if (l.precio === null || !Number.isFinite(l.precio) || !Number.isFinite(l.cantidad)) return null;
  return r2(l.cantidad * l.precio);
}

export type TotalMoneda = { moneda: string; subtotal: number; igv: number; total: number };

/**
 * Totales por moneda: suma de los importes de línea (sin IGV), IGV 18 % sobre esa suma y total.
 * Las líneas sin precio no entran: se cuentan aparte en `sinPrecio`.
 */
export function calcularTotales(lineas: Linea[]): { porMoneda: TotalMoneda[]; sinPrecio: number } {
  const acum = new Map<string, number>();
  let sinPrecio = 0;
  for (const l of lineas) {
    const s = subtotalLinea(l);
    if (s === null) {
      sinPrecio++;
      continue;
    }
    acum.set(l.moneda, r2((acum.get(l.moneda) ?? 0) + s));
  }
  const porMoneda = [...acum.entries()].map(([moneda, subtotal]) => {
    const igv = r2(subtotal * IGV);
    return { moneda, subtotal, igv, total: r2(subtotal + igv) };
  });
  return { porMoneda, sinPrecio };
}

/** Fechas de vencimiento de precios ya pasadas (distintas, ordenadas) entre las líneas con catálogo. */
export function preciosVencidos(lineas: Linea[], hoy: string): string[] {
  const set = new Set<string>();
  for (const l of lineas) if (l.codigo && l.vence && l.vence < hoy) set.add(l.vence);
  return [...set].sort();
}

// ───────── formatos ─────────
const SIMBOLO: Record<string, string> = { PEN: "S/", USD: "US$", EUR: "€" };
export const simbolo = (moneda: string) => SIMBOLO[moneda] ?? moneda;

/** 1234.5 → "1,234.50". */
export function numero2(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** Precio unitario: 2 decimales y hasta 4 si los necesita (75.0655). */
export function precioUnitario(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
/** Cantidad: sin decimales sobrantes (3, 2.5). */
export function cantidadTexto(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

// ───────── validación ─────────
/** Errores que impiden exportar (lista vacía = todo bien). */
export function validarSolicitud(c: Cabecera, lineas: Linea[]): string[] {
  const e: string[] = [];
  if (lineas.length === 0) e.push("Agrega al menos un material.");
  if (lineas.length > MAX_LINEAS) e.push(`Una solicitud admite hasta ${MAX_LINEAS} materiales.`);
  lineas.forEach((l, i) => {
    const n = i + 1;
    if (!l.descripcion.trim()) e.push(`Material ${n}: falta la descripción.`);
    if (!Number.isFinite(l.cantidad) || l.cantidad <= 0) e.push(`Material ${n}: la cantidad debe ser mayor que cero.`);
  });
  if (c.observaciones.length > LIMITES.observaciones) e.push(`Las observaciones admiten hasta ${LIMITES.observaciones} caracteres.`);
  return e;
}

// ───────── borrador (se guarda en el navegador) ─────────
export const CLAVE_BORRADOR = "solicitud-materiales:borrador";
export const CABECERA_VACIA: Cabecera = { solicitante: "", area: "", ticket: "", lugar: "", fecha: "", observaciones: "" };

const txt = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Reconstruye un borrador guardado, descartando lo que no tenga el formato esperado. */
export function leerBorrador(crudo: string | null): { cabecera: Cabecera; lineas: Linea[] } | null {
  if (!crudo) return null;
  try {
    const d = JSON.parse(crudo) as { cabecera?: Record<string, unknown>; lineas?: unknown };
    const c = d.cabecera ?? {};
    const cabecera: Cabecera = {
      solicitante: txt(c.solicitante, LIMITES.texto),
      area: txt(c.area, LIMITES.texto),
      ticket: txt(c.ticket, LIMITES.texto),
      lugar: txt(c.lugar, LIMITES.texto),
      fecha: txt(c.fecha, 10),
      observaciones: txt(c.observaciones, LIMITES.observaciones),
    };
    const lineas: Linea[] = [];
    for (const x of Array.isArray(d.lineas) ? d.lineas.slice(0, MAX_LINEAS) : []) {
      const l = x as Record<string, unknown>;
      const descripcion = txt(l.descripcion, LIMITES.descripcion);
      const cantidad = numOrNull(l.cantidad);
      if (!descripcion || cantidad === null) continue;
      lineas.push({
        uid: nuevoUid(),
        codigo: typeof l.codigo === "string" ? l.codigo : null,
        descripcion,
        cantidad,
        unidad: txt(l.unidad, LIMITES.unidad),
        precio: numOrNull(l.precio),
        moneda: txt(l.moneda, 3) || "PEN",
        vence: typeof l.vence === "string" ? l.vence : null,
        proveedor: typeof l.proveedor === "string" ? l.proveedor : null,
        minimo: typeof l.minimo === "string" ? l.minimo : null,
        entrega: typeof l.entrega === "string" ? l.entrega : null,
      });
    }
    return { cabecera, lineas };
  } catch {
    return null;
  }
}
