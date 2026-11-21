// Solicitud de materiales: tipos y reglas puras (búsqueda en el catálogo, totales, validación,
// borrador). No depende de React ni del servidor, así que se puede probar sola.

/** Una de las filas de public/catalogo-materiales.json (ver scripts/importar-catalogo.mjs). */
export type ArchivoCatalogo = {
  version: number;
  titulo: string;
  generado: string;
  proveedores: { id: string; nombre: string; minimo: string; entrega: string }[];
  categorias: string[];
  /** Código de cada categoría (columna "Categoria" del catálogo original), mismo orden que `categorias`. */
  categoriasCodigo?: string[];
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
  /** Categoría del catálogo y código del proveedor (para el Excel de la solicitud). */
  categoria?: string;
  categoriaCodigo?: string;
  proveedorId?: string;
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
  /** N° de ticket (o referencia) para el que se pide este material; sale en el PDF. */
  ticket?: string;
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
export const LIMITES = { descripcion: 300, unidad: 20, texto: 120, observaciones: 600, ticket: 40 } as const;

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
  const items: ItemCatalogo[] = a.items.map(([articulo, descripcion, precio, ip, ic, im, iv]) => {
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
      categoria: a.categorias[ic] ?? "",
      categoriaCodigo: a.categoriasCodigo?.[ic] ?? "",
      proveedorId: prov?.id ?? "",
      clave: normalizar(`${articulo} ${descripcion}`),
    };
  });
  return { titulo: a.titulo, generado: a.generado, items };
}

/**
 * Búsqueda por palabras sobre cualquier lista: todas las palabras escritas deben aparecer (en cualquier
 * orden) en el texto de cada elemento. Primero salen los que empiezan con la primera palabra o la tienen
 * como palabra completa. Devuelve como máximo `limite` resultados y el total de coincidencias.
 */
function buscarPorTexto<T>(
  lista: T[],
  textoDe: (x: T) => string,
  consulta: string,
  limite: number
): { items: T[]; total: number } {
  // Coma o punto y coma entre palabras también separan ("cable,thw"); entre números no ("2,5 mm").
  const palabras = normalizar(consulta.replace(/;|,(?!\d)|(?<!\d),/g, " ")).split(" ").filter(Boolean);
  if (palabras.length === 0) return { items: [], total: 0 };
  const primera = palabras[0];
  const frase = palabras.join(" ");
  const aciertos: { it: T; puntos: number }[] = [];
  for (const it of lista) {
    const clave = textoDe(it);
    let ok = true;
    for (const p of palabras) {
      if (!clave.includes(p)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const i = clave.indexOf(primera);
    // 3: el texto empieza con la palabra · 2: es una palabra completa · 1: aparece dentro de otra
    const completa = i >= 0 && (i === 0 || clave[i - 1] === " ") && (clave[i + primera.length] ?? " ") === " ";
    // la frase completa tal cual la escribió la persona pesa más que palabras sueltas
    const puntos = (clave.startsWith(primera) ? 3 : completa ? 2 : 1) + (clave.includes(frase) ? 4 : 0);
    aciertos.push({ it, puntos });
  }
  // sort estable: dentro del mismo puntaje se conserva el orden original
  aciertos.sort((a, b) => b.puntos - a.puntos);
  return { items: aciertos.slice(0, limite).map((x) => x.it), total: aciertos.length };
}

/** Busca en el catálogo (código o descripción). */
export function buscarCatalogo(
  cat: Catalogo,
  consulta: string,
  limite = MAX_RESULTADOS
): { items: ItemCatalogo[]; total: number } {
  return buscarPorTexto(cat.items, (it) => it.clave, consulta, limite);
}

// ───────── materiales fuera del catálogo (salen de órdenes de compra anteriores) ─────────
/** public/materiales-fuera-catalogo.json: un renglón por material, con el precio de su última orden de compra. */
export type ArchivoFuera = {
  version: number;
  titulo: string;
  generado: string;
  proveedor: string;
  moneda: string;
  items: { descripcion: string; unidad: string; precio: number; oc: string; fecha: string; cantidad: number; veces: number }[];
};

export type ItemFuera = {
  /** Misma clave que usan los favoritos para un material libre: "libre:<descripción normalizada>". */
  clave: string;
  descripcion: string;
  unidad: string;
  /** Precio unitario sin IGV de la última orden de compra. */
  precio: number;
  moneda: string;
  proveedor: string;
  /** N° de la última orden de compra y su fecha (YYYY-MM-DD). */
  oc: string;
  fecha: string;
  /** Cantidad de la última orden de compra. */
  cantidad: number;
  /** En cuántas órdenes de compra apareció. */
  veces: number;
  /** Texto normalizado sobre el que se busca. */
  texto: string;
};

export type CatalogoFuera = { titulo: string; version: number; items: ItemFuera[] };

export const URL_FUERA_CATALOGO = "/materiales-fuera-catalogo.json";

export function prepararFuera(a: ArchivoFuera): CatalogoFuera {
  const items = a.items.map((x) => ({
    clave: `libre:${normalizar(x.descripcion)}`,
    descripcion: x.descripcion,
    unidad: x.unidad,
    precio: x.precio,
    moneda: a.moneda || "PEN",
    proveedor: a.proveedor,
    oc: x.oc,
    fecha: x.fecha,
    cantidad: x.cantidad,
    veces: x.veces,
    texto: normalizar(`${x.descripcion} ${x.oc} ${a.proveedor}`),
  }));
  return { titulo: a.titulo, version: a.version, items };
}

/** Sin consulta devuelve toda la lista (es corta); con consulta, las coincidencias. */
export function buscarFuera(cat: CatalogoFuera, consulta: string): { items: ItemFuera[]; total: number } {
  if (normalizar(consulta) === "") return { items: cat.items, total: cat.items.length };
  return buscarPorTexto(cat.items, (it) => it.texto, consulta, cat.items.length);
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

/**
 * Línea de un material fuera del catálogo. Igual que los que se escriben a mano, no lleva código ni
 * proveedor (el PDF solo usa el proveedor para las líneas del catálogo); el precio es el de su última orden de compra.
 */
export function lineaDeFuera(it: ItemFuera, cantidad = 1): Linea {
  return {
    uid: nuevoUid(),
    codigo: null,
    descripcion: it.descripcion.slice(0, LIMITES.descripcion),
    cantidad,
    unidad: it.unidad.slice(0, LIMITES.unidad),
    precio: it.precio,
    moneda: it.moneda,
    vence: null,
    proveedor: null,
    minimo: null,
    entrega: null,
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
        ticket: txt(l.ticket, LIMITES.ticket),
      });
    }
    return { cabecera, lineas };
  } catch {
    return null;
  }
}

// ---- Materiales favoritos: todo lo que alguna vez se solicitó (se guarda en este navegador) ----
export const CLAVE_FAVORITOS = "solicitud-materiales:favoritos";
export const MAX_FAVORITOS = 1000;

export type Favorito = {
  /** Código del catálogo, o "libre:<descripción normalizada>" para materiales fuera del catálogo. */
  clave: string;
  codigo: string | null;
  descripcion: string;
  unidad: string;
  /** Cuántas veces se exportó en una solicitud. */
  veces: number;
  /** Fecha (YYYY-MM-DD, Lima) de la última solicitud. */
  ultima: string;
  ultimaCantidad: number;
};

export const claveFavorito = (l: Pick<Linea, "codigo" | "descripcion">) =>
  l.codigo ? l.codigo : `libre:${normalizar(l.descripcion)}`;

export function leerFavoritos(crudo: string | null): Favorito[] {
  if (!crudo) return [];
  try {
    const d = JSON.parse(crudo) as unknown;
    if (!Array.isArray(d)) return [];
    const out: Favorito[] = [];
    for (const x of d.slice(0, MAX_FAVORITOS)) {
      const f = x as Record<string, unknown>;
      const descripcion = txt(f.descripcion, LIMITES.descripcion);
      const clave = txt(f.clave, 400);
      const cantidad = numOrNull(f.ultimaCantidad);
      if (!descripcion || !clave) continue;
      out.push({
        clave,
        codigo: typeof f.codigo === "string" ? f.codigo : null,
        descripcion,
        unidad: txt(f.unidad, LIMITES.unidad),
        veces: Math.max(1, Math.trunc(numOrNull(f.veces) ?? 1)),
        ultima: txt(f.ultima, 10),
        ultimaCantidad: cantidad ?? 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Suma a los favoritos los materiales de una solicitud exportada (la última solicitud queda primero, en su orden). */
export function registrarFavoritos(actuales: Favorito[], lineas: Linea[], fecha: string): Favorito[] {
  const previos = new Map(actuales.map((f) => [f.clave, f]));
  const nuevos = new Map<string, Favorito>();
  for (const l of lineas) {
    const clave = claveFavorito(l);
    const base = nuevos.get(clave) ?? previos.get(clave);
    nuevos.set(clave, {
      clave,
      codigo: l.codigo,
      descripcion: l.descripcion,
      unidad: l.unidad,
      veces: (base?.veces ?? 0) + 1,
      ultima: fecha,
      ultimaCantidad: l.cantidad,
    });
  }
  const resto = actuales.filter((f) => !nuevos.has(f.clave));
  return [...nuevos.values(), ...resto].slice(0, MAX_FAVORITOS);
}

/** Clave del navegador que recuerda hasta qué versión de la lista fuera de catálogo ya se sembró en favoritos. */
export const CLAVE_FAVORITOS_SEMILLA = "solicitud-materiales:favoritos-semilla";

/**
 * Agrega a los favoritos los materiales fuera del catálogo que todavía no estén (no toca los que ya existen,
 * ni sus conteos). Los nuevos van al final, de la orden de compra más reciente a la más antigua.
 */
export function sembrarFavoritos(actuales: Favorito[], cat: CatalogoFuera): Favorito[] {
  const ya = new Set(actuales.map((f) => f.clave));
  const nuevos: Favorito[] = cat.items
    .filter((it) => !ya.has(it.clave))
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || a.descripcion.localeCompare(b.descripcion))
    .map((it) => ({
      clave: it.clave,
      codigo: null,
      descripcion: it.descripcion,
      unidad: it.unidad,
      veces: it.veces,
      ultima: it.fecha,
      ultimaCantidad: it.cantidad,
    }));
  return [...actuales, ...nuevos].slice(0, MAX_FAVORITOS);
}

// ───────── agregar varias líneas a la vez (botón "Agregar materiales") ─────────
/**
 * Suma `nuevas` a la solicitud: si el material ya está (mismo código, o misma descripción en los libres)
 * se suma la cantidad; si no, se agrega al final mientras quepa (MAX_LINEAS). Devuelve cuántas no cupieron.
 */
export function fusionarLineas(actuales: Linea[], nuevas: Linea[]): { lineas: Linea[]; omitidas: number } {
  const out = actuales.map((l) => ({ ...l }));
  let omitidas = 0;
  for (const n of nuevas) {
    const i = out.findIndex((l) => (n.codigo ? l.codigo === n.codigo : !l.codigo && claveFavorito(l) === claveFavorito(n)));
    if (i >= 0) {
      out[i] = { ...out[i], cantidad: (Number.isFinite(out[i].cantidad) ? out[i].cantidad : 0) + n.cantidad };
    } else if (out.length >= MAX_LINEAS) {
      omitidas++;
    } else {
      out.push(n);
    }
  }
  return { lineas: out, omitidas };
}

// ───────── Catálogo desde el Excel del proveedor (carga desde la app) ─────────
// Mismo criterio que scripts/importar-catalogo.mjs: busca el renglón de encabezados (puede haber títulos
// encima), toma las columnas por su nombre (no importa el orden) y guarda una sola vez lo que se repite
// (proveedor, categoría, moneda, vencimiento).

const normCab = (t: unknown) =>
  String(t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const limpiarCelda = (t: unknown) => String(t ?? "").replace(/[ \s]+/g, " ").trim();

/** Fecha de una celda de Excel (Date, número de serie o texto dd/mm/aaaa o aaaa-mm-dd) → "aaaa-mm-dd". */
function fechaCelda(v: unknown): string {
  if (v instanceof Date && !isNaN(v.getTime())) {
    // Fecha local del Excel (sin desplazarla por la zona horaria).
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = limpiarCelda(v);
  let m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

export type LecturaCatalogo =
  | { ok: true; catalogo: ArchivoCatalogo; descartadas: number }
  | { ok: false; error: string };

/** Convierte las filas de la hoja del catálogo (matriz de celdas) en el formato que usa la app. */
export function catalogoDesdeFilas(filas: unknown[][], nombreHoja: string, hoyISO: string): LecturaCatalogo {
  const iCab = filas.slice(0, 30).findIndex((f) => {
    const t = (f ?? []).map(normCab);
    return t.some((x) => x.startsWith("id art")) && t.some((x) => x.startsWith("precio"));
  });
  if (iCab < 0) return { ok: false, error: 'No encontré el renglón de encabezados: debe tener "Id Articulo" y "Precio".' };
  const cab = filas[iCab].map(normCab);
  const col = (...pistas: string[]) => cab.findIndex((x) => pistas.some((p) => x.startsWith(p)));
  const C = {
    articulo: col("id art"),
    descripcion: col("descrip"),
    categoria: col("nombre cat"),
    categoriaCodigo: col("categ"),
    provId: col("id prov"),
    provNombre: col("nombre prov"),
    moneda: col("moneda", "mon"),
    precio: col("precio"),
    vence: col("fecha de venc", "vencim"),
    minimo: col("cantidad min"),
    entrega: col("tiempo de entrega"),
  };
  const nombres: Record<string, string> = {
    articulo: "Id Articulo",
    descripcion: "Descripción",
    categoria: "Nombre Categoria",
    provId: "Id Proveedor",
    provNombre: "Nombre Proveedor",
    moneda: "MONEDA",
    precio: "Precio (sin igv)",
    vence: "Fecha de vencimiento",
    minimo: "Cantidad minima",
    entrega: "Tiempo de entrega",
  };
  const faltan = Object.entries(C)
    .filter(([k, v]) => v < 0 && k !== "categoriaCodigo")
    .map(([k]) => nombres[k] ?? k);
  if (faltan.length > 0) return { ok: false, error: `Faltan columnas en el encabezado: ${faltan.join(", ")}.` };

  const titulo =
    filas
      .slice(0, iCab)
      .flat()
      .find((x): x is string => typeof x === "string" && x.trim().length > 8)
      ?.trim() ?? nombreHoja;

  const dic = {
    prov: new Map<string, { i: number; valor: ArchivoCatalogo["proveedores"][number] }>(),
    cat: new Map<string, { i: number; valor: { nombre: string; codigo: string } }>(),
    mon: new Map<string, { i: number; valor: string }>(),
    venc: new Map<string, { i: number; valor: string }>(),
  };
  const indice = <T,>(mapa: Map<string, { i: number; valor: T }>, clave: string, valor: T) => {
    if (!mapa.has(clave)) mapa.set(clave, { i: mapa.size, valor });
    return mapa.get(clave)!.i;
  };
  const items: ArchivoCatalogo["items"] = [];
  const vistos = new Set<string>();
  let descartadas = 0;
  for (const f of filas.slice(iCab + 1)) {
    if (!f) continue;
    const articulo = limpiarCelda(f[C.articulo]);
    const descripcion = limpiarCelda(f[C.descripcion]);
    const crudo = f[C.precio];
    const precio = typeof crudo === "number" ? crudo : Number(String(crudo ?? "").replace(/[^\d.,-]/g, "").replace(",", "."));
    if (!articulo || !descripcion || !Number.isFinite(precio) || precio < 0 || vistos.has(articulo)) {
      if (articulo || descripcion) descartadas++;
      continue;
    }
    vistos.add(articulo);
    const prov = {
      id: limpiarCelda(f[C.provId]),
      nombre: limpiarCelda(f[C.provNombre]),
      minimo: limpiarCelda(f[C.minimo]),
      entrega: limpiarCelda(f[C.entrega]),
    };
    const moneda = limpiarCelda(f[C.moneda]) || "PEN";
    const vence = fechaCelda(f[C.vence]);
    items.push([
      articulo,
      descripcion.slice(0, LIMITES.descripcion),
      Math.round(precio * 10000) / 10000,
      indice(dic.prov, JSON.stringify(prov), prov),
      indice(dic.cat, limpiarCelda(f[C.categoria]), {
        nombre: limpiarCelda(f[C.categoria]),
        codigo: C.categoriaCodigo >= 0 ? limpiarCelda(f[C.categoriaCodigo]) : "",
      }),
      indice(dic.mon, moneda, moneda),
      indice(dic.venc, vence, vence),
    ]);
  }
  if (items.length === 0) return { ok: false, error: "No encontré materiales válidos (código, descripción y precio) debajo del encabezado." };
  const lista = <T,>(m: Map<string, { i: number; valor: T }>) => [...m.values()].sort((a, b) => a.i - b.i).map((x) => x.valor);
  const cats = lista(dic.cat);
  return {
    ok: true,
    descartadas,
    catalogo: {
      version: 1,
      titulo,
      generado: hoyISO,
      proveedores: lista(dic.prov),
      categorias: cats.map((c) => c.nombre),
      categoriasCodigo: cats.map((c) => c.codigo),
      monedas: lista(dic.mon),
      vencimientos: lista(dic.venc),
      items,
    },
  };
}

/** Revisa que un catálogo recibido tenga la forma esperada (lo usa el servidor antes de guardarlo). */
export function catalogoValido(c: unknown): c is ArchivoCatalogo {
  if (!c || typeof c !== "object") return false;
  const a = c as Record<string, unknown>;
  const arr = (v: unknown) => Array.isArray(v);
  if (a.version !== 1 || typeof a.titulo !== "string" || !arr(a.items) || !arr(a.proveedores) || !arr(a.categorias)) return false;
  if (!arr(a.monedas) || !arr(a.vencimientos)) return false;
  const items = a.items as unknown[];
  if (items.length === 0 || items.length > 60000) return false;
  const np = (a.proveedores as unknown[]).length;
  const nc = (a.categorias as unknown[]).length;
  const nm = (a.monedas as unknown[]).length;
  const nv = (a.vencimientos as unknown[]).length;
  return items.every((it) => {
    if (!Array.isArray(it) || it.length !== 7) return false;
    const [art, desc, precio, ip, ic, im, iv] = it as unknown[];
    const idx = (v: unknown, n: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < n;
    return (
      typeof art === "string" && art.length > 0 && art.length <= 60 &&
      typeof desc === "string" && desc.length > 0 && desc.length <= 400 &&
      typeof precio === "number" && Number.isFinite(precio) && precio >= 0 &&
      idx(ip, np) && idx(ic, nc) && idx(im, nm) && idx(iv, nv)
    );
  });
}

// ───────── N° de ticket escrito en una solicitud ─────────
/**
 * Cómo se reconoce el ticket que alguien escribió en una línea de la solicitud: por su código de ticket
 * (sin importar mayúsculas ni espacios) o por su N° Ref, escrito como "512", "Ref 512", "Ref. 512",
 * "N° 512", "Nro 512" o "#512". La misma regla usa la base de datos (ver PREFIJO_REF_SQL).
 */
export function claveTicket(t: string | null | undefined): { texto: string; refer: number | null } {
  const texto = (t ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const sinPrefijo = texto.replace(/^(ref\.?|nro\.?|n[°º]?\.?|#)\s*/, "");
  return { texto, refer: /^\d{1,9}$/.test(sinPrefijo) ? Number(sinPrefijo) : null };
}
/** Expresión regular equivalente (para SQL, con la bandera 'i' no hace falta: el texto va en minúsculas). */
export const PREFIJO_REF_SQL = "^(ref\\.?|nro\\.?|n[°º]?\\.?|#)\\s*";
