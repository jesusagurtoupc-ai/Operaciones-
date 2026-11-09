// Lectura de una COTIZACIÓN en PDF (de cualquier proveedor). A diferencia de la OC, no hay un formato
// único: se buscan por etiquetas los datos que sirven al ticket (proveedor, RUC, N°, fecha y total).
// Todo es "mejor esfuerzo": lo que no se encuentra queda en null y nunca se inventa.
import type { DatosCotizacion } from "@/lib/shared";
import type { Pagina } from "./pdfTexto";

// RUC de la propia universidad y su grupo: nunca son el del proveedor.
const RUC_PROPIOS = new Set(["20211614545", "20215276024", "20349287111", "20521386470"]);
const EXCLUIR_NOMBRE = /universidad|\bupc\b|\bupn\b|cibertec|laur[eé]ate|cliente/i;
const SUFIJO = /\b(S\.?\s?A\.?\s?C\.?|S\.?\s?R\.?\s?L\.?|E\.?\s?I\.?\s?R\.?\s?L\.?|S\.?\s?A\.?)(?=\s|$|[,.;|])/i;

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

const limpiar = (t: string) => t.replace(/\s+/g, " ").trim();
const sinTildes = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const pad = (n: number) => String(n).padStart(2, "0");

/** Último importe de una línea: "S/ 1,355.93" -> 1355.93 ; "10891.40" -> 10891.4 */
function ultimoImporte(t: string): number | null {
  const m = [...t.matchAll(/(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?!\d)/g)];
  if (m.length === 0) return null;
  const x = m[m.length - 1];
  const v = Number(x[1].replace(/,/g, "") + (x[2] ? "." + x[2] : ""));
  return Number.isFinite(v) ? v : null;
}

function fechaValida(d: number, m: number, a: number): string | null {
  if (a < 2000 || a > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCMonth() === m - 1 ? `${a}-${pad(m)}-${pad(d)}` : null;
}

export function parsearCotizacion(
  paginas: Pagina[],
  creado: string | null
): { ok: true; datos: DatosCotizacion } | { ok: false; error: string } {
  const lineas = paginas.flatMap((p) => p.lineas).map((l) => ({
    texto: limpiar(l.texto),
    corridas: l.corridas.map((c) => limpiar(c.texto)).filter(Boolean),
  }));
  if (lineas.length === 0) return { ok: false, error: "El PDF no tiene texto que se pueda leer" };
  const avisos: string[] = [];
  const todo = lineas.map((l) => l.texto).join("\n");

  // ---- Total (con IGV) y subtotal ----
  let total: number | null = null;
  let lineaTotal = "";
  const reTotal = /total presupuestado|precio total|importe total|total a pagar|total general|monto total|total con igv|p\.?\s?venta|total pto/i;
  for (let i = 0; i < lineas.length && total === null; i++) {
    const t = lineas[i].texto;
    if (reTotal.test(t) && !/sub\s*total/i.test(t)) {
      total = ultimoImporte(t.replace(reTotal, ""));
      if (total !== null) lineaTotal = t;
    }
  }
  if (total === null) {
    for (const l of lineas) {
      if (/^total\b/i.test(l.texto) && !/sub\s*total/i.test(l.texto)) {
        const v = ultimoImporte(l.texto.replace(/^total\b/i, ""));
        if (v !== null) { total = v; lineaTotal = l.texto; break; }
      }
    }
  }
  let subtotal: number | null = null;
  for (const l of lineas) {
    if (/sub\s*total|costo directo/i.test(l.texto)) {
      const v = ultimoImporte(l.texto.replace(/sub\s*total|costo directo/i, ""));
      if (v !== null) { subtotal = v; break; }
    }
  }
  if (total !== null && subtotal !== null && total < subtotal) {
    avisos.push("El total leído es menor que el subtotal: revisa los montos");
  }

  // ---- Moneda ----
  let moneda: "PEN" | "USD" | null = null;
  if (/US\s?\$|USD|d[oó]lares/i.test(lineaTotal)) moneda = "USD";
  else if (/S\/|soles|PEN/i.test(lineaTotal)) moneda = "PEN";
  else if (/\b(US\$|USD|d[oó]lares)\b/i.test(todo) && !/S\/|soles/i.test(todo)) moneda = "USD";
  else if (/S\/|soles|\bPEN\b/i.test(todo)) moneda = "PEN";
  if (moneda === "USD") avisos.push("La cotización está en dólares: el ticket se maneja en soles, conviértela a mano");

  // ---- Fecha (día/mes/año en Perú; o "05 de enero de 2026") ----
  let fecha: string | null = null;
  const fechaAmbigua = false; // se mantiene el campo por compatibilidad con DatosCotizacion
  const candidatas = [...lineas.filter((l) => /fecha/i.test(l.texto)), ...lineas];
  for (const l of candidatas) {
    const txt = sinTildes(l.texto).toLowerCase();
    const mt = /(\d{1,2})\s+de\s+([a-z]+)\s+(?:de\s+|del\s+)?(\d{4})/.exec(txt);
    if (mt && MESES[mt[2]]) {
      fecha = fechaValida(Number(mt[1]), MESES[mt[2]], Number(mt[3]));
      if (fecha) break;
    }
    const nm = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/.exec(txt);
    if (nm) {
      const a = Number(nm[1]), b = Number(nm[2]), anio = Number(nm[3]);
      const dm = fechaValida(a, b, anio); // día/mes
      const md = a !== b ? fechaValida(b, a, anio) : null; // mes/día
      if (dm && md) {
        // Los dos órdenes valen: se usa día/mes si la fecha de creación del PDF lo confirma.
        if (creado === dm) fecha = dm;
        else if (creado === md) fecha = md;
        else fecha = dm; // en Perú se escribe día/mes: sin evidencia en contra, no se avisa
        break;
      }
      fecha = dm ?? md;
      if (fecha) break;
    }
  }

  // ---- RUC del proveedor (no el de la universidad) ----
  let ruc: string | null = null;
  for (const m of todo.matchAll(/(?<!\d)((?:10|15|16|17|20)\d{9})(?!\d)/g)) {
    if (!RUC_PROPIOS.has(m[1])) { ruc = m[1]; break; }
  }

  // ---- Nombre del proveedor ----
  let proveedor: string | null = null;
  for (const l of lineas) {
    if (EXCLUIR_NOMBRE.test(l.texto)) continue;
    for (const c of l.corridas) {
      if (EXCLUIR_NOMBRE.test(c) || !SUFIJO.test(c)) continue;
      const nombre = limpiar(c.replace(/^.*?(raz[oó]n social|nombre de la empresa|empresa)\s*:/i, "").replace(/\s*\b(?:RUC)?\s*:?\s*\d{11}\b.*$/i, ""));
      if (nombre.length >= 4 && nombre.length <= 120 && !/@|www\./i.test(nombre)) { proveedor = nombre; break; }
    }
    if (proveedor) break;
  }

  // ---- N° de cotización ----
  let numero: string | null = null;
  const mCot = /\bCOT[-_ ]?\d{1,6}\b/i.exec(todo);
  if (mCot) numero = limpiar(mCot[0]);
  if (!numero) {
    for (const l of lineas) {
      const m = /cotizaci[oó]n\s*(?:n[°º.]?\s*)?[:\-]?\s*(.*)$/i.exec(l.texto);
      if (!m) continue;
      const v = limpiar(m[1]);
      if (v && /\d/.test(v) && v.split(" ").length <= 3 && v.length <= 24 && !/\b[A-Za-z]{4,}\b/.test(v)) {
        numero = v;
        break;
      }
    }
  }
  if (!numero) {
    // "COTIZACION N°" y el número en una línea de abajo (diseños con la etiqueta a un lado).
    const i = lineas.findIndex((l) => /cotizaci[oó]n\s*n[°º.]?\s*$/i.test(l.texto));
    if (i >= 0) {
      for (const l of lineas.slice(i + 1, i + 4)) {
        if (/^[A-Z0-9][A-Z0-9_\-\/ ]{3,24}$/.test(l.texto) && /\d/.test(l.texto)) { numero = l.texto; break; }
      }
    }
  }

  if (!numero) {
    // "COTIZACIÓN" sola y "N° 001" en la línea siguiente.
    const i = lineas.findIndex((l) => /^cotizaci[oó]n$/i.test(l.texto));
    if (i >= 0 && lineas[i + 1]) {
      const m = /^n[°º.]\s*([A-Z0-9][A-Z0-9_\-\/ ]{0,23})$/i.exec(lineas[i + 1].texto);
      if (m && /\d/.test(m[1])) numero = limpiar(m[1]);
    }
  }

  if (total === null && proveedor === null && ruc === null && numero === null) {
    return { ok: false, error: "No se reconoció una cotización en este PDF (no se encontró total, proveedor ni RUC)" };
  }
  let totalCalculado = false;
  if (total === null && subtotal !== null && /no\s+incluye\s+igv/i.test(todo)) {
    totalCalculado = true;
    total = Math.round(subtotal * 1.18 * 100) / 100;
    avisos.push("La cotización no incluye IGV: el total se calculó como subtotal + 18 % de IGV");
  }
  if (total === null) avisos.push("No se pudo leer el total de la cotización");
  return {
    ok: true,
    datos: { numero, fecha, fecha_ambigua: fechaAmbigua, proveedor, ruc_proveedor: ruc, moneda, subtotal, total, total_calculado: totalCalculado, avisos },
  };
}
