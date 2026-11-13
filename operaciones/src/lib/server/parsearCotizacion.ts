// Lectura de una COTIZACIÓN en PDF (de cualquier proveedor). A diferencia de la OC, no hay un formato
// único: se buscan por etiquetas los datos que sirven al ticket (proveedor, RUC, N°, fecha y total).
// Todo es "mejor esfuerzo": lo que no se encuentra queda en null y nunca se inventa.
import type { CondicionesCotizacion, DatosCotizacion, PartidaCotizacion } from "@/lib/shared";
import type { Pagina } from "./pdfTexto";

// RUC de la propia universidad y su grupo: nunca son el del proveedor.
export const RUC_PROPIOS = new Set(["20211614545", "20215276024", "20349287111", "20521386470"]);
export const EXCLUIR_NOMBRE = /universidad|\bupc\b|\bupn\b|cibertec|laur[eé]ate|cliente/i;
export const SUFIJO = /\b(S\.?\s?A\.?\s?C\.?|S\.?\s?R\.?\s?L\.?|E\.?\s?I\.?\s?R\.?\s?L\.?|S\.?\s?A\.?)(?=\s|$|[,.;|])/i;

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
  const reTotal = /total presupuestado|precio total|importe total|total a pagar|total general|monto total|total con igv|costo total|precio final|p\.?\s?venta|total pto/i;
  for (let i = 0; i < lineas.length && total === null; i++) {
    const t = lineas[i].texto;
    if (reTotal.test(t) && !/sub\s*total/i.test(t)) {
      total = ultimoImporte(t.replace(reTotal, ""));
      if (total !== null) lineaTotal = t;
    }
  }
  if (total === null) {
    for (const l of lineas) {
      if (/^total\b/i.test(l.texto) && !/sub\s*total|sin\s+igv/i.test(l.texto)) {
        const v = ultimoImporte(l.texto.replace(/^total\b/i, ""));
        if (v !== null) { total = v; lineaTotal = l.texto; break; }
      }
    }
  }
  // Subtotal: líneas que EMPIEZAN con su etiqueta ("SUB TOTAL", "SUB 1-TOTAL", "SUBTOTAL (CD+GG+U)",
  // "COSTO DIRECTO"…). Antes valía cualquier línea que dijera "subtotal", y una condición de pago como
  // "100% del subtotal + IGV" daba 100. Si hay varias, se elige la que con IGV da el total; si no, la última.
  let subtotal: number | null = null;
  const reSub = /^(?:sub\s*\d*\s*-?\s*total|costo\s+directo|costo\s+sin\s+igv|valor\s+(?:de\s+)?venta|total\s+sin\s+igv|base\s+imponible|valor\s+neto)\b/i;
  const candSub: number[] = [];
  for (const l of lineas) {
    if (!reSub.test(l.texto)) continue;
    const v = ultimoImporte(l.texto.replace(/\([^)]*\)/g, " ").replace(reSub, "").replace(/\d+(?:[.,]\d+)?\s*%/g, ""));
    if (v !== null && v > 0) candSub.push(v);
  }
  if (candSub.length > 0) {
    const t = total;
    subtotal = (t !== null ? candSub.find((v) => Math.abs(v * 1.18 - t) <= 1) : undefined) ?? candSub[candSub.length - 1];
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
      const aNombre = /a\s+nombre\s+de\s+(.+?)\s+(?:con\s+)?RUC\b/i.exec(c);
      const nombre = limpiar(
        (aNombre ? aNombre[1] : c.replace(/^.*?(raz[oó]n social|nombre de la empresa|empresa)\s*:/i, ""))
          .replace(/\s*[\/|,–-]?\s*\b(?:RUC)?\s*(?:N[°º]\s*)?:?\s*\d{11}\b.*$/i, "")
          .replace(/\s*[\/|,–-]\s*$/, "")
      );
      if (nombre.length >= 4 && nombre.length <= 120 && !/@|www\./i.test(nombre)) { proveedor = nombre; break; }
    }
    if (proveedor) break;
  }

  // ---- N° de cotización ----
  let numero: string | null = null;
  const mCot = /\bCOT[-_ ]?\d{1,6}\b/i.exec(todo);
  if (mCot) numero = limpiar(mCot[0]);
  if (!numero) {
    const mp = /\bproforma\s*(?:n[°º.o]*\s*)?[:#]?\s*([A-Z0-9][A-Z0-9\-\/]{2,20})/i.exec(todo);
    if (mp && /\d/.test(mp[1])) numero = mp[1];
  }
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

  // ---- Qué se cotiza (será la descripción del ticket) ----
  // 1) "SOLICITUD: CORRECTIVO DE ...", "ASUNTO: ...", "SERVICIO: ...". Si la etiqueta está sola en su
  //    línea, el texto va en la siguiente.
  // 2) En tabla, sin dos puntos: "Referencia | CORRECTIVOS AA" (la etiqueta es la primera celda).
  // 3) En carta: "...presentarle la siguiente cotización sobre su solicitud:" y el trabajo en la línea siguiente.
  // Además, si hay "Area | LABORATORIO 406 B - Pabellon B, piso 4" (ubicación), se agrega a la descripción.
  const esDescripcion = (v: string) =>
    v.length >= 6 && /[a-záéíóúñ]{3}/i.test(v) && !/@|cotizaci[oó]n\s*n|^\s*(item|n[°º])\b/i.test(v);
  let solicitud: string | null = null;
  const reSolicitud =
    /^(?:solicitud|asunto|servicio|trabajo|proyecto|obra|referencia|ref\.?|descripci[oó]n del (?:servicio|trabajo))\s*[:.\-]\s*(.*)$/i;
  for (let i = 0; i < lineas.length && !solicitud; i++) {
    const m = reSolicitud.exec(lineas[i].texto);
    if (!m) continue;
    let v = limpiar(m[1]);
    if (!v && lineas[i + 1]) v = lineas[i + 1].texto;
    // Se descarta lo que no es una descripción: un N° de cotización, un correo o un teléfono.
    if (esDescripcion(v)) {
      solicitud = v.slice(0, 300);
    }
  }
  const celdaEtiqueta = (etiquetas: RegExp) => {
    for (const l of lineas) {
      const [primera, ...resto] = l.corridas;
      if (!primera || resto.length === 0 || !etiquetas.test(primera)) continue;
      const v = limpiar(resto.join(" "));
      if (esDescripcion(v)) return v;
    }
    return null;
  };
  if (!solicitud) {
    solicitud = celdaEtiqueta(/^(?:solicitud|asunto|servicio|trabajo|proyecto|obra|referencia|descripci[oó]n)\s*:?$/i);
  }
  if (!solicitud) {
    const i = lineas.findIndex((l) =>
      /(sobre su (?:solicitud|requerimiento|pedido)|(?:la|nuestra) (?:siguiente )?(?:cotizaci[oó]n|propuesta)(?: econ[oó]mica)? (?:para|de|por)?\s*:?)\s*:\s*$/i.test(l.texto)
    );
    if (i >= 0) {
      const sig = lineas.slice(i + 1, i + 3).map((l) => l.texto).find((t) => esDescripcion(t) && !/^(item|descripci)/i.test(t));
      if (sig) solicitud = sig.slice(0, 300);
    }
  }
  const ubicacion = celdaEtiqueta(/^(?:[aá]rea|ubicaci[oó]n|lugar|ambiente|local)\s*:?$/i);
  if (solicitud && ubicacion && !sinTildes(solicitud).toLowerCase().includes(sinTildes(ubicacion).toLowerCase())) {
    solicitud = `${solicitud} – ${ubicacion}`.slice(0, 300);
  }

  const condiciones = leerCondiciones(lineas, numero);

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
    datos: {
      numero, fecha, fecha_ambigua: fechaAmbigua, proveedor, ruc_proveedor: ruc, moneda, subtotal, total,
      total_calculado: totalCalculado, solicitud, ubicacion, condiciones, avisos,
    },
  };
}

// ───────── Condiciones comerciales ─────────

type L = { texto: string; corridas: string[] };

/** Texto de una etiqueta: lo que sigue a "Etiqueta:" en la misma línea o, si está vacía, las líneas siguientes. */
function valorDeEtiqueta(lineas: L[], re: RegExp, maxLineas = 2): { texto: string; linea: number } | null {
  for (let i = 0; i < lineas.length; i++) {
    const m = re.exec(lineas[i].texto);
    if (!m) continue;
    let v = limpiar(lineas[i].texto.slice(m.index + m[0].length).replace(/^\s*[:.\-]\s*/, ""));
    if (!v) {
      const sig: string[] = [];
      for (const l of lineas.slice(i + 1, i + 1 + maxLineas)) {
        // Se corta en la siguiente etiqueta ("VALIDEZ DE LA OFERTA:", "MONEDA COTIZADA:"…).
        if (/^[A-ZÁÉÍÓÚÑ ]{4,40}:?$/.test(l.texto) || /^[a-záéíóúñ ]{4,40}:$/i.test(l.texto)) break;
        sig.push(l.texto.replace(/^\s*(?:[•*\-]|\d+\s*\.-?)\s*/, ""));
      }
      v = limpiar(sig.join(" "));
    }
    if (v) return { texto: v.slice(0, 250), linea: i };
  }
  return null;
}

const NUM_PALABRA: Record<string, number> = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, doce: 12 };

function leerCondiciones(lineas: L[], numero: string | null): CondicionesCotizacion | null {
  const c: CondicionesCotizacion = { numero };

  // Plazo: "TIEMPO DE ENTREGA DEL SERVICIO: 2 DIAS HABILES…", "Tiempo de entrega: • 03 días hábiles…",
  // "PLAZOS DE ENTREGA: 1.- El requerimiento se atenderá, 2 días posterior a…".
  const plazo = valorDeEtiqueta(lineas, /(?:tiempos?|plazos?)\s+de\s+(?:entrega|ejecuci[oó]n|atenci[oó]n)(?:\s+del?\s+(?:servicio|trabajo))?/i);
  if (plazo) {
    const t = sinTildes(plazo.texto).toLowerCase();
    const m = /(\d{1,3})\s*(?:a\s*\d{1,3}\s*)?(dias?|horas?|semanas?)\s*(habiles|utiles|calendarios?|naturales)?/.exec(t);
    if (m) {
      const n = Number(m[1]);
      const dias = m[2].startsWith("hora") ? Math.max(1, Math.ceil(n / 24)) : m[2].startsWith("semana") ? n * 7 : n;
      if (dias > 0 && dias <= 365) {
        c.plazo_dias = dias;
        c.plazo_tipo = m[3] ? (/habil|util/.test(m[3]) ? "hábiles" : "calendario") : null;
      }
    }
    c.plazo_texto = plazo.texto;
  }

  // Validez: "VALIDEZ DE COTIZACION: 10 DIAS CALENDARIO", "VALIDEZ DE LA OFERTA: 1.- 15 días Calendarios".
  const validez = valorDeEtiqueta(lineas, /validez(?:\s+de\s+(?:la\s+)?(?:cotizaci[oó]n|oferta|propuesta|precios?))?/i);
  if (validez) {
    const m = /(\d{1,3})\s*d[ií]as?/i.exec(validez.texto);
    if (m && Number(m[1]) > 0 && Number(m[1]) <= 365) c.validez_dias = Number(m[1]);
  }

  // Garantía del trabajo: "GARANTIA DE TRABAJO: 6 MESES…", "6 Meses de garantía en equipos e instalación",
  // "Se considera 1 año de garantía…". Se prefiere la del trabajo/servicio/instalación a la "de fábrica".
  const garantias: { meses: number; texto: string; trabajo: boolean }[] = [];
  for (let i = 0; i < lineas.length; i++) {
    const t = lineas[i].texto;
    const candidatas = /garant[ií]a/i.test(t)
      ? [t]
      : /^garant[ií]a/i.test(lineas[i - 1]?.texto ?? "") ? [t] : [];
    for (const x of candidatas) {
      const m = /(\d{1,2}|un|uno|una|dos|tres|seis|doce)\s*(\(\d+\)\s*)?(mes(?:es)?|a[ñn]os?)/i.exec(sinTildes(x).toLowerCase().replace(/ano/g, "año"));
      if (!m) continue;
      const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM_PALABRA[m[1]] ?? 0;
      const meses = m[3].startsWith("mes") ? n : n * 12;
      if (meses > 0 && meses <= 120) {
        garantias.push({ meses, texto: limpiar(x.replace(/^\s*(?:[•*\-]|\d+\s*\.-?)\s*/, "")).slice(0, 200), trabajo: /trabajo|servicio|instalaci|mano de obra|accesorio/i.test(x) });
      }
    }
  }
  const g = garantias.find((x) => x.trabajo) ?? garantias[0];
  if (g) { c.garantia_meses = g.meses; c.garantia_texto = g.texto; }

  // Forma de pago.
  const pago = valorDeEtiqueta(lineas, /(?:forma|condici[oó]n(?:es)?)\s+de\s+pago/i);
  if (pago) c.forma_pago = pago.texto;

  // Partidas principales: el ítem es "1", "1.00" o "1.00.00" (todo ceros después del primer número),
  // con descripción y un importe al final. Los subítems (1.10, 1.01.01) no se repiten.
  const partidas: PartidaCotizacion[] = [];
  const reItem = /^(\d{1,2}(?:\.0{1,2}){0,2})\s+(.+?)\s+(?:S\/\.?\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})$/;
  for (const l of lineas) {
    const m = reItem.exec(l.texto);
    if (!m) continue;
    const descripcion = limpiar(m[2].replace(/\s+S\/\.?$/i, ""));
    // Una fila de detalle ("1 glb 300.00") no es una partida: debe tener palabras.
    if (!/[a-záéíóúñ]{4,}/i.test(descripcion) || /^(?:und|glb|global|m2|ml|u|unid)\b/i.test(descripcion)) continue;
    const monto = Number(m[3].replace(/,/g, ""));
    if (Number.isFinite(monto)) partidas.push({ item: m[1], descripcion: descripcion.slice(0, 120), monto });
    if (partidas.length >= 30) break;
  }
  if (partidas.length > 0) c.partidas = partidas;

  const hay = c.plazo_dias != null || c.plazo_texto || c.validez_dias != null || c.garantia_meses != null || c.forma_pago || partidas.length > 0;
  return hay ? c : null;
}
