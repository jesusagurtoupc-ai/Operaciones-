// Lectura de una Orden de Compra de UPC (PDF generado por PeopleSoft) a partir de su TEXTO.
//
// No depende de ninguna librería: recibe el texto ya extraído del PDF (ver
// src/lib/client/leerPdf.ts) y busca los datos por sus etiquetas. El orden en que un lector de PDF
// entrega las palabras cambia (las columnas de la línea de detalle salen mezcladas), así que nada
// aquí depende de la posición: se busca por etiqueta ("Proveedor:", "Importe Total"...) o por formato
// (N° "PER05-0000168406", fechas dd/mm/aaaa).

/** Qué importe de la OC se carga en "Monto": el total con IGV o el subtotal sin IGV. */
export const MONTO_DESDE_OC: "total" | "subtotal" = "total";

const LIMITE_DESCRIPCION = 2000; // el mismo tope que valida el servidor

export type DatosOC = {
  /** N° de OC tal como figura en el documento, p. ej. "PER05-0000168406". */
  n_oc: string;
  /** Fecha de la OC en formato AAAA-MM-DD (o null si no se pudo leer). */
  f_oc: string | null;
  proveedor: string | null;
  /** RUC del proveedor (11 dígitos). */
  proveedor_ruc: string | null;
  /** Fecha de entrega comprometida (AAAA-MM-DD): la mayor de las líneas de la OC. */
  f_entrega: string | null;
  /** Importe elegido según MONTO_DESDE_OC; null si la OC no está en soles. */
  monto: number | null;
  subtotal: number | null;
  igv: number | null;
  total: number | null;
  moneda: string | null;
  /** Descripción de las líneas de la OC (unidas con "; "). */
  descripcion: string | null;
};

export type ResultadoOC =
  | { ok: true; datos: DatosOC; avisos: string[] }
  | { ok: false; error: string };

function numero(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Fecha de la OC -> "AAAA-MM-DD"; null si no es una fecha real.
 *
 * PeopleSoft imprime MES/DÍA/AÑO: la OC PER05-0000168406, "10/06/2026", es del 6 de octubre (el PDF se
 * generó ese día). Por eso se lee como mes/día; solo si el primer número no puede ser un mes (>12)
 * se entiende día/mes. `ambigua` avisa cuando las dos lecturas eran posibles.
 */
function fechaOc(texto: string | undefined): { iso: string; ambigua: boolean } | null {
  const m = texto ? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto) : null;
  if (!m) return null;
  const [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [mo, d] = a > 12 ? [b, a] : [a, b];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const dos = (n: number) => String(n).padStart(2, "0");
  return { iso: `${y}-${dos(mo)}-${dos(d)}`, ambigua: a <= 12 && b <= 12 && a !== b };
}

export function fechaLegible(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-PE", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

const IMPORTE = String.raw`(\d[\d,]*\.\d{2})`;

export function parsearOrdenCompra(textoCrudo: string): ResultadoOC {
  const texto = textoCrudo.replace(/\u00a0/g, " ");
  if (texto.replace(/\s/g, "").length < 20) {
    return {
      ok: false,
      error: "El PDF no tiene texto que se pueda leer (¿es una imagen escaneada?). Llena los datos a mano.",
    };
  }
  // Versión en una sola línea, con los espacios colapsados, para buscar por etiqueta.
  const plano = texto.replace(/\s+/g, " ");
  const avisos: string[] = [];

  const mOc = /\b(PER\d{2}-\d{10})\b/.exec(plano);
  if (!mOc) {
    return {
      ok: false,
      error: "No encontré un N° de orden de compra (formato PER05-0000000000). ¿Es una OC de UPC?",
    };
  }
  const n_oc = mOc[1];

  // La fecha de la OC va justo después de su número ("PER05-0000168406 10/06/2026 1").
  const mFecha = new RegExp(`${n_oc}\\s+(\\d{2}/\\d{2}/\\d{4})`).exec(plano);
  const fOc = fechaOc(mFecha?.[1]);
  const f_oc = fOc?.iso ?? null;
  if (!fOc) avisos.push("No pude leer la fecha de la OC.");
  else if (fOc.ambigua) {
    avisos.push(`La fecha ${mFecha?.[1]} la leí como mes/día: ${fechaLegible(fOc.iso)}. Verifícala.`);
  }

  const mProv = /Proveedor: ?\d+ (.+?) Direcci[oó]n:/.exec(plano);
  const proveedor = mProv ? mProv[1].trim().slice(0, 200) : null;
  if (!proveedor) avisos.push("No pude leer el proveedor.");

  // RUC del proveedor ("RUC: 20301612622"). El de UPC va escrito "R.U.C.:" y no coincide.
  const mRuc = /\bRUC: ?(\d{11})\b/.exec(plano);
  const proveedor_ruc = mRuc?.[1] ?? null;

  const mMoneda = /\b(PEN|USD|EUR)\b/.exec(plano);
  const moneda = mMoneda?.[1] ?? null;

  // "Importe Total" también es el título de una columna; solo vale el que trae el número pegado.
  const subtotal = numero(new RegExp(`SubTotal\\.?:? ${IMPORTE}`, "i").exec(plano)?.[1]);
  const igv = numero(new RegExp(`Total I\\.?G\\.?V\\.?:? ${IMPORTE}`, "i").exec(plano)?.[1]);
  let total = numero(new RegExp(`Importe Total ${IMPORTE}`, "i").exec(plano)?.[1]);

  // Control cruzado: el total debe ser subtotal + IGV. Si no cuadra, el lector tomó otro número
  // del documento: se usa la suma (si hay subtotal e IGV) y se avisa para que lo revisen.
  if (subtotal !== null && igv !== null) {
    const suma = Math.round((subtotal + igv) * 100) / 100;
    if (total === null || Math.abs(total - suma) > 0.02) {
      avisos.push("El total no cuadra con subtotal + IGV: revisa el monto.");
      total = suma;
    }
  }

  let monto = MONTO_DESDE_OC === "total" ? total : subtotal;
  if (monto === null) avisos.push("No pude leer el importe de la OC.");
  if (monto !== null && moneda !== null && moneda !== "PEN") {
    avisos.push(`La OC está en ${moneda} y el monto del ticket es en soles: no cargué el monto.`);
    monto = null;
  }

  // Líneas de detalle: "1- <descripción> ..." antes de los totales. Las columnas de precio salen
  // en cualquier orden, así que la descripción llega hasta el primer importe con decimales o "Atn:".
  const antesDeTotales = texto.split(/SubTotal/i)[0];
  const lineas: string[] = [];
  const reLinea = /(?:^|\n)\s*\d{1,3}-\s+([\s\S]+?)(?=\s\d[\d,]*\.\d{2}\b|\sAtn:|$)/g;
  for (const m of antesDeTotales.matchAll(reLinea)) {
    const d = m[1].replace(/\s+/g, " ").trim();
    if (d) lineas.push(d);
  }
  // Fecha de entrega: las fechas que están en la zona de las líneas de detalle (entre la primera
  // línea "1-" y los totales). Con varias líneas se toma la más tardía.
  const iPrimera = antesDeTotales.search(/(?:^|\n)\s*\d{1,3}-\s/);
  const zonaLineas = iPrimera >= 0 ? antesDeTotales.slice(iPrimera) : "";
  const entregas = [...zonaLineas.matchAll(/\b(\d{2}\/\d{2}\/\d{4})\b/g)]
    .map((m) => fechaOc(m[1])?.iso ?? null)
    .filter((f): f is string => f !== null)
    .sort();
  const f_entrega = entregas.length > 0 ? entregas[entregas.length - 1] : null;

  let descripcion = lineas.length > 0 ? lineas.join("; ") : null;
  if (descripcion && descripcion.length > LIMITE_DESCRIPCION) {
    descripcion = descripcion.slice(0, LIMITE_DESCRIPCION - 1) + "…";
  }

  return {
    ok: true,
    avisos,
    datos: { n_oc, f_oc, proveedor, proveedor_ruc, f_entrega, monto, subtotal, igv, total, moneda, descripcion },
  };
}
