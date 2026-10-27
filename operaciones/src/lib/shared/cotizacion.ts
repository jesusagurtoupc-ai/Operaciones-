// Lectura de una COTIZACIÓN de proveedor en PDF, a partir de su texto (ver src/lib/client/leerPdf.ts).
//
// A diferencia de la OC de UPC (un formato fijo), cada proveedor arma su cotización a su manera. Esto
// está probado con el formato de Ecotech ("Fecha: 22/09/26", "DE: <proveedor>", tabla ITEM / DESCRIPCIÓN /
// PRECIO TOTAL, "IGV", "TOTAL", "Vigencia: 5 días calendario"). Con otros formatos puede no encontrar
// algún dato: en ese caso lo avisa y el formulario queda como estaba.
import { MONTO_DESDE_OC, fechaLegible } from "./ordenCompra";

const LIMITE_DESCRIPCION = 2000; // el mismo tope que valida el servidor

export type DatosCotizacion = {
  /** Fecha de la cotización (AAAA-MM-DD). */
  f_coti: string | null;
  proveedor: string | null;
  descripcion: string | null;
  moneda: "PEN" | "USD" | null;
  subtotal: number | null;
  igv: number | null;
  total: number | null;
  /** Importe para el campo Monto (soles). null si está en otra moneda o no se pudo leer. */
  monto: number | null;
  /** Días de vigencia y, si son calendario, la fecha hasta la que vale (AAAA-MM-DD). */
  vigencia_dias: number | null;
  vigencia_hasta: string | null;
  /** Condición de pago, p. ej. "100% · Para gestionar la compra y suministro". */
  condicion_pago: string | null;
};

export type ResultadoCotizacion =
  | { ok: true; datos: DatosCotizacion; avisos: string[] }
  | { ok: false; error: string };

const IMPORTE = String.raw`(\d[\d,]*\.\d{2})`;
const SIMBOLO = String.raw`(US\$|USD|\$|S\/\.?|PEN)?`;

function numero(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

const redondear = (n: number) => Math.round(n * 100) / 100;

/** "22/09/26" o "22/09/2026" (día/mes/año) -> AAAA-MM-DD; null si no es una fecha real. */
function fechaCoti(texto: string | undefined): { iso: string; ambigua: boolean } | null {
  const m = texto ? /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(texto) : null;
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const [d, mo] = b > 12 ? [b, a] : [a, b]; // día/mes; si el "mes" no puede serlo, estaba al revés
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const dos = (n: number) => String(n).padStart(2, "0");
  return { iso: `${y}-${dos(mo)}-${dos(d)}`, ambigua: a <= 12 && b <= 12 && a !== b };
}

function sumarDias(iso: string, dias: number): string {
  const dt = new Date(`${iso}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

function monedaDe(simbolo: string | undefined): "PEN" | "USD" | null {
  if (!simbolo) return null;
  if (/^S\//i.test(simbolo) || simbolo === "PEN") return "PEN";
  return "USD"; // "$", "US$", "USD"
}

export function parsearCotizacion(textoCrudo: string): ResultadoCotizacion {
  const plano = textoCrudo.replace(/\u00a0/g, " ").replace(/\s+/g, " ");
  if (plano.replace(/\s/g, "").length < 20) {
    return {
      ok: false,
      error: "El PDF no tiene texto que se pueda leer (¿es una imagen escaneada?). Llena los datos a mano.",
    };
  }
  const avisos: string[] = [];

  const mFecha = /\bFecha: ?(\d{2}\/\d{2}\/(?:\d{4}|\d{2}))\b/i.exec(plano);
  const fecha = fechaCoti(mFecha?.[1]);
  const f_coti = fecha?.iso ?? null;
  if (!fecha) avisos.push("No pude leer la fecha de la cotización.");
  else if (fecha.ambigua) {
    avisos.push(`La fecha ${mFecha?.[1]} la leí como día/mes: ${fechaLegible(fecha.iso)}. Verifícala.`);
  }

  const mProv = /\bDE: (.+?) (?:Mediante|ITEM|Estimad|Por medio)\b/.exec(plano);
  const proveedor = mProv ? mProv[1].trim().slice(0, 200) : null;
  if (!proveedor) avisos.push("No pude leer el proveedor.");

  // Tabla: "ITEM DESCRIPCIÓN PRECIO TOTAL 1 15 metros de cable ... $ 254.93 IGV $ 45.89 TOTAL $ 300.82"
  const mTabla = /ITEM DESCRIPCI[OÓ]N (?:.{0,30}?)TOTAL (.+?) (?:IGV|TOTAL\b|Subtotal)/i.exec(plano);
  const filas: { descripcion: string; importe: number; simbolo?: string }[] = [];
  if (mTabla) {
    const reFila = new RegExp(`(?:^| )\\d{1,3} (.+?) ${SIMBOLO} ?${IMPORTE}`, "g");
    for (const m of mTabla[1].matchAll(reFila)) {
      const importe = numero(m[3]);
      if (importe !== null) filas.push({ descripcion: m[1].trim(), importe, simbolo: m[2] });
    }
  }

  const reIgv = new RegExp(`\\bIGV(?: ?\\(?\\d+ ?%\\)?)? ?${SIMBOLO} ?${IMPORTE}`, "i");
  const mIgv = reIgv.exec(plano);
  const igv = numero(mIgv?.[2]);

  // "TOTAL" también es título de columna: solo vale el que trae el importe pegado (se toma el último).
  const totales = [...plano.matchAll(new RegExp(`\\bTOTAL ${SIMBOLO} ?${IMPORTE}`, "g"))];
  const mTotal = totales.length > 0 ? totales[totales.length - 1] : null;
  let total = numero(mTotal?.[2]);

  const moneda = monedaDe(filas[0]?.simbolo ?? mIgv?.[1] ?? mTotal?.[1]);
  if (!moneda) avisos.push("No pude determinar la moneda de la cotización.");

  let subtotal = filas.length > 0 ? redondear(filas.reduce((a, f) => a + f.importe, 0)) : null;
  if (subtotal === null && total !== null && igv !== null) subtotal = redondear(total - igv);
  if (total === null && subtotal !== null && igv !== null) total = redondear(subtotal + igv);

  // Control cruzado: el total debe ser subtotal + IGV.
  if (subtotal !== null && igv !== null && total !== null && Math.abs(subtotal + igv - total) > 0.02) {
    avisos.push("El total no cuadra con subtotal + IGV: revisa los importes.");
  }
  if (total === null && subtotal === null) avisos.push("No pude leer los importes.");

  let monto = MONTO_DESDE_OC === "total" ? total : subtotal;
  if (monto !== null && moneda !== "PEN") {
    monto = null; // el monto del ticket es en soles: un importe en dólares no se carga
  }

  let descripcion = filas.length > 0 ? filas.map((f) => f.descripcion).join("; ") : null;
  if (descripcion && descripcion.length > LIMITE_DESCRIPCION) {
    descripcion = descripcion.slice(0, LIMITE_DESCRIPCION - 1) + "…";
  }

  const mVig = /Vigencia: ?(\d+) d[ií]as ?(calendario|h[aá]biles|[uú]tiles)?/i.exec(plano);
  const vigencia_dias = mVig ? Number(mVig[1]) : null;
  const esCalendario = !!mVig && (!mVig[2] || /^calendario$/i.test(mVig[2]));
  const vigencia_hasta = vigencia_dias !== null && esCalendario && f_coti ? sumarDias(f_coti, vigencia_dias) : null;

  const mPago = /\bPago ?(?:\((\d+ ?%)\))?:? (.+?)(?= Vigencia:| Consideraciones| ECOTECH|$)/i.exec(plano);
  const condicion_pago = mPago ? [mPago[1], mPago[2].trim()].filter(Boolean).join(" · ") : null;

  if (!/COTIZACI[OÓ]N/i.test(plano) && total === null && subtotal === null) {
    return { ok: false, error: "No reconocí una cotización en este PDF. Llena los datos a mano." };
  }

  return {
    ok: true,
    avisos,
    datos: {
      f_coti, proveedor, descripcion, moneda, subtotal, igv, total, monto,
      vigencia_dias, vigencia_hasta, condicion_pago,
    },
  };
}
