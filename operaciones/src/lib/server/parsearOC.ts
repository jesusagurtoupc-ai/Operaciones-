// Interpreta el texto de una orden de compra (Purchase Order) de PeopleSoft/SQR
// ya extraído del PDF (ver pdfTexto.ts) y devuelve los datos que usa un ticket.
//
// El PDF tiene dos columnas (datos del proveedor a la izquierda, entrega y factura
// a la derecha) que quedan en la misma línea, así que se busca cada dato por su
// etiqueta y por su posición horizontal, no por el texto de la línea completa.
import type { DatosOC, LineaOC } from "@/lib/shared";
import type { Corrida, Linea, Pagina } from "./pdfTexto";

type DatosLeidos = Omit<DatosOC, "otros_tickets">;

export type ResultadoOC =
  | { ok: true; datos: DatosLeidos }
  | { ok: false; error: string };

const RE_FECHA = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;

function numero(s: string | undefined | null): number | null {
  if (!s) return null;
  const limpio = s.replace(/,/g, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(limpio)) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

const texto = (c: Corrida | undefined) => (c ? c.texto.trim() : "");

/** Texto comparable de una etiqueta: sin tildes, en minúsculas, sin ":" final ni espacios de más. */
const normEtiqueta = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/:$/, "")
    .trim();

// Denominaciones conocidas de cada etiqueta (plantilla en inglés y en español, y variantes).
const ET_PROVEEDOR = ["vendor", "proveedor", "supplier"];
const ET_MONEDA = ["currency", "moneda", "divisa"];
const ET_COMPRADOR = ["buyer", "comprador"];
const ET_PAGO = ["payment terms", "condicion pago", "condicion de pago", "condiciones de pago", "terminos de pago"];
const ET_ENTREGA = ["entregar bienes en", "entregar en", "ship to", "deliver to"];

/** Primera corrida de la línea cuyo texto cumple la condición. */
function buscarCorrida(l: Linea, cond: (t: string) => boolean): { c: Corrida; i: number } | null {
  for (let i = 0; i < l.corridas.length; i++) {
    if (cond(texto(l.corridas[i]))) return { c: l.corridas[i], i };
  }
  return null;
}

/** Texto de la línea siguiente que está justo debajo de `x` (columna de una etiqueta). */
function valorDebajo(lineas: Linea[], idx: number, x: number, tolerancia = 4): string {
  const sig = lineas[idx + 1];
  if (!sig) return "";
  const c = sig.corridas.find((k) => Math.abs(k.x - x) <= tolerancia);
  return texto(c);
}

type Orden = "MDY" | "DMY";

function aISO(d: string, orden: Orden): string | null {
  const m = RE_FECHA.exec(d);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const anio = Number(m[3]);
  const mes = orden === "MDY" ? a : b;
  const dia = orden === "MDY" ? b : a;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const f = new Date(Date.UTC(anio, mes - 1, dia));
  if (f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== dia) return null;
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/**
 * PeopleSoft/SQR imprime mes/día/año. Si alguna fecha tiene un primer número mayor a 12,
 * el PDF viene en día/mes/año y se respeta. Si todas caben en ambos órdenes, se asume
 * mes/día/año y se avisa para que la persona lo confirme.
 */
function detectarOrden(
  fechas: string[],
  fechaOc: string | null,
  creado: string | null
): { orden: Orden; ambigua: boolean } {
  let diaPrimero = false;
  let mesPrimero = false;
  let ambigua = false;
  for (const f of fechas) {
    const m = RE_FECHA.exec(f);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12) diaPrimero = true;
    else if (b > 12) mesPrimero = true;
    else if (a !== b) ambigua = true;
  }
  if (diaPrimero && !mesPrimero) return { orden: "DMY", ambigua: false };
  if (mesPrimero && !diaPrimero) return { orden: "MDY", ambigua: false };
  if (!ambigua) return { orden: "MDY", ambigua: false }; // día = mes: da igual el orden

  // Desempate: el PDF declara cuándo se generó. La OC se imprime el mismo día (o casi)
  // que su fecha, así que el orden que cae cerca de esa fecha es el correcto.
  if (fechaOc && creado) {
    const dif = (iso: string | null) =>
      iso ? Math.abs(Date.parse(iso) - Date.parse(creado)) / 86_400_000 : Infinity;
    const mdy = dif(aISO(fechaOc, "MDY"));
    const dmy = dif(aISO(fechaOc, "DMY"));
    if (mdy <= 7 && dmy > 7) return { orden: "MDY", ambigua: false };
    if (dmy <= 7 && mdy > 7) return { orden: "DMY", ambigua: false };
  }
  return { orden: "MDY", ambigua: true };
}

// El 2.º dato de la línea es el código del artículo (plantilla en inglés: "CNTRT0000000064783") o,
// en la plantilla en español, ya la primera línea de la descripción ("REPARACION FILTRACION DE AGUA").
const RE_CODIGO = /^\S*\d\S*$/; // una sola palabra que lleva algún número
const RE_ITEM =
  /^(\d+)\s*-\s*(.+?)\s+(-?[\d,]*\.?\d+)\s*([A-Za-z]{1,5})\s+(-?[\d,]+\.\d+)\s+(-?[\d,]+\.\d+)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s*$/;

/**
 * Las OC de PeopleSoft se descargan como "<número>_<unidad>.PDF" (p. ej. 0000168413_PER05.PDF) y su
 * N° de OC es "<unidad>-<número>" (PER05-0000168413). Sirve de respaldo y de comprobación cruzada.
 */
function ocDelNombre(nombreArchivo: string | null | undefined): string | null {
  const base = (nombreArchivo ?? "").replace(/^.*[\\/]/, "").replace(/\.[A-Za-z0-9]+$/, "");
  const m = /^(\d{6,14})_([A-Za-z]{2,5}\d{0,3})(?![A-Za-z0-9])/.exec(base);
  return m ? `${m[2].toUpperCase()}-${m[1]}` : null;
}

export function parsearOC(
  paginas: Pagina[],
  creado: string | null = null,
  nombreArchivo: string | null = null
): ResultadoOC {
  const lineas = paginas.flatMap((p) => p.lineas);
  if (lineas.length === 0) return { ok: false, error: "El PDF no tiene texto que se pueda leer" };

  const avisos: string[] = [];

  // ---- N° de OC y fecha ----
  let n_oc: string | null = null;
  let fechaOcCruda: string | null = null;
  for (const l of lineas) {
    const m = /\b([A-Z]{2,5}\d{0,3}-\d{6,14})\b/.exec(l.texto);
    if (m) {
      n_oc = m[1];
      const resto = l.texto.slice((m.index ?? 0) + m[1].length);
      fechaOcCruda = RE_FECHA.exec(resto)?.[0] ?? null;
      break;
    }
  }

  // Respaldo de la fecha: la primera que aparezca en el encabezado (primeras líneas de la 1.ª página).
  if (!fechaOcCruda) {
    for (const l of paginas[0]?.lineas.slice(0, 14) ?? []) {
      const f = RE_FECHA.exec(l.texto)?.[0];
      if (f) { fechaOcCruda = f; break; }
    }
  }

  // ---- Proveedor ----
  let proveedor: string | null = null;
  let ruc_proveedor: string | null = null;
  let moneda: string | null = null;
  let comprador: string | null = null;
  let condicion_pago: string | null = null;
  let entregar_en: string | null = null;

  for (let idx = 0; idx < lineas.length; idx++) {
    const l = lineas[idx];
    const vendor = buscarCorrida(l, (t) => ET_PROVEEDOR.includes(normEtiqueta(t)));
    if (vendor && proveedor === null) {
      const codigo = l.corridas[vendor.i + 1];
      if (codigo) {
        const sig = lineas[idx + 1];
        const nombre = sig?.corridas.find((k) => Math.abs(k.x - codigo.x) <= 4);
        proveedor = texto(nombre) || texto(codigo).replace(/^\d+\s*/, "") || null;
      }
    }
    if (ruc_proveedor === null) {
      const ruc = buscarCorrida(l, (t) => /^RUC:?$/i.test(t)); // no confunde con "R.U.C.:" (la universidad)
      if (ruc) {
        const val = texto(l.corridas[ruc.i + 1]);
        if (/^\d{8,11}$/.test(val)) ruc_proveedor = val;
      }
    }
    if (moneda === null) {
      const cur = buscarCorrida(l, (t) => ET_MONEDA.includes(normEtiqueta(t)));
      if (cur) {
        const val = valorDebajo(lineas, idx, cur.c.x, 40);
        if (/^[A-Z]{3}$/.test(val)) moneda = val;
      }
    }
    if (comprador === null) {
      const b = buscarCorrida(l, (t) => ET_COMPRADOR.includes(normEtiqueta(t)));
      if (b) comprador = valorDebajo(lineas, idx, b.c.x) || null;
    }
    if (condicion_pago === null) {
      const p = buscarCorrida(l, (t) => ET_PAGO.includes(normEtiqueta(t)));
      if (p) condicion_pago = valorDebajo(lineas, idx, p.c.x) || null;
    }
    if (entregar_en === null) {
      const e = buscarCorrida(l, (t) => ET_ENTREGA.includes(normEtiqueta(t)));
      if (e) entregar_en = texto(l.corridas[e.i + 1]) || null;
    }
  }

  // ---- Líneas de la OC ----
  const items: LineaOC[] = [];
  const fechasCrudas: string[] = fechaOcCruda ? [fechaOcCruda] : [];
  const entregasCrudas: (string | null)[] = [];
  lineas.forEach((l, idx) => {
    const m = RE_ITEM.exec(l.texto);
    if (!m) return;
    const codigoCorrida = l.corridas.find((c) => texto(c) === m[2] || texto(c).endsWith(m[2]));
    const esCodigo = RE_CODIGO.test(m[2]);
    const descr: string[] = esCodigo ? [] : [m[2]];
    for (let k = idx + 1; k < lineas.length; k++) {
      const s = lineas[k];
      if (/^(Att?n:|Contract ID:)/i.test(s.texto) || RE_ITEM.test(s.texto) || /^Sub\s?Total/i.test(s.texto)) break;
      const parte = s.corridas.filter((c) => !codigoCorrida || Math.abs(c.x - codigoCorrida.x) <= 4);
      const t = parte.map(texto).join(" ").trim();
      if (t) descr.push(t);
      if (descr.length >= 6) break;
    }
    fechasCrudas.push(m[7]);
    entregasCrudas.push(m[7]);
    items.push({
      linea: Number(m[1]),
      codigo: esCodigo ? m[2] : "",
      descripcion: descr.join(" "),
      cantidad: numero(m[3]) ?? 0,
      unidad: m[4].toUpperCase(),
      precio: numero(m[5]) ?? 0,
      importe: numero(m[6]) ?? 0,
      entrega: m[7], // se convierte a ISO más abajo
    });
  });

  // ---- Totales ----
  let subtotal: number | null = null;
  let igv: number | null = null;
  let total: number | null = null;
  let idxTotal = -1; // última línea de importes (subtotal / IGV / total): el comentario viene después
  for (let idx = 0; idx < lineas.length; idx++) {
    const l = lineas[idx];
    let m: RegExpExecArray | null;
    if (subtotal === null && (m = /^Sub\s?Total\.?:?\s+(-?[\d,]+\.\d+)$/i.exec(l.texto))) {
      subtotal = numero(m[1]);
      idxTotal = Math.max(idxTotal, idx);
    }
    if (igv === null && (m = /^(?:Total\s+)?(?:I\.?G\.?V\.?|IVA|Tax)\.?:?\s+(-?[\d,]+\.\d+)$/i.exec(l.texto))) {
      igv = numero(m[1]);
      idxTotal = Math.max(idxTotal, idx);
    }
    if (total === null && (m = /^(?:Total PO Amount|Importe Total|Total Orden(?: de Compra)?|Total OC|Total General)\s*:?\s+(-?[\d,]+\.\d+)$/i.exec(l.texto))) {
      total = numero(m[1]);
      idxTotal = Math.max(idxTotal, idx);
    }
  }

  // Si falta uno de los tres importes se calcula con los otros dos (subtotal + IGV = total).
  const derivados: string[] = [];
  if (total === null && subtotal !== null && igv !== null) {
    total = Math.round((subtotal + igv) * 100) / 100;
    derivados.push("total");
  } else if (subtotal === null && total !== null && igv !== null) {
    subtotal = Math.round((total - igv) * 100) / 100;
    derivados.push("subtotal");
  } else if (igv === null && total !== null && subtotal !== null) {
    igv = Math.round((total - subtotal) * 100) / 100;
    derivados.push("IGV");
  }
  if (derivados.length > 0) {
    avisos.push(`No se encontró el ${derivados.join(", ")} en la OC y se calculó con los otros importes: revísalo`);
  }

  // ---- N° de OC según el nombre del archivo: respaldo y comprobación cruzada ----
  const ocNombre = ocDelNombre(nombreArchivo);
  if (ocNombre) {
    if (!n_oc) {
      n_oc = ocNombre;
      avisos.push(`No se pudo leer el N° de OC dentro del PDF; se tomó del nombre del archivo (${ocNombre})`);
    } else if (n_oc.toLowerCase() !== ocNombre.toLowerCase()) {
      avisos.push(
        `El N° de OC del PDF (${n_oc}) no coincide con el del nombre del archivo (${ocNombre}): confirma que subiste el archivo correcto`
      );
    }
  }

  // ---- Comentario de la OC (texto entre el total y los términos y condiciones) ----
  let descripcion: string | null = null;
  if (idxTotal >= 0) {
    const partes: string[] = [];
    for (let k = idxTotal + 1; k < lineas.length && partes.length < 10; k++) {
      const t = lineas[k].texto;
      if (/^TERMINOS Y CONDICIONES/i.test(t)) break;
      // Etiqueta del total sin su importe (si el PDF no lo trae): no es parte del comentario.
      if (/^(?:Total PO Amount|Importe Total|Total Orden(?: de Compra)?|Total OC|Total General)\s*:?\s*$/i.test(t)) continue;
      if (t) partes.push(t);
    }
    if (partes.length) descripcion = partes.join("; ");
  }
  if (!descripcion && items.length) {
    descripcion = items.map((i) => i.descripcion).filter(Boolean).join("; ") || null;
  }
  if (descripcion && descripcion.length > 2000) descripcion = descripcion.slice(0, 2000);

  // ---- Validación mínima: ¿esto es una OC? ----
  if (!n_oc && total === null) {
    return {
      ok: false,
      error: "No se encontró el número ni el total de una orden de compra en este PDF",
    };
  }

  // ---- Fechas ----
  const { orden, ambigua } = detectarOrden(fechasCrudas, fechaOcCruda, creado);
  const f_oc = fechaOcCruda ? aISO(fechaOcCruda, orden) : null;
  const entregasISO: string[] = [];
  for (const it of items) {
    it.entrega = it.entrega ? aISO(it.entrega, orden) : null;
    if (it.entrega) entregasISO.push(it.entrega);
  }
  const f_entrega = entregasISO.length ? [...entregasISO].sort().at(-1)! : null;
  if (fechaOcCruda && !f_oc) avisos.push(`No se pudo interpretar la fecha de la OC (${fechaOcCruda})`);

  // ---- Avisos ----
  if (moneda && moneda !== "PEN") {
    avisos.push(`La OC está en ${moneda}; el monto del ticket se maneja en soles (S/), conviértelo antes de guardarlo`);
  }
  if (!moneda) avisos.push("No se pudo leer la moneda de la OC");
  if (!proveedor) avisos.push("No se pudo leer el proveedor de la OC");
  if (items.length === 0) {
    avisos.push("No se pudieron leer las líneas de la OC");
  } else if (subtotal !== null) {
    const suma = items.reduce((a, i) => a + i.importe, 0);
    if (Math.abs(suma - subtotal) > 0.05) {
      avisos.push(`La suma de las líneas (${suma.toFixed(2)}) no coincide con el subtotal (${subtotal.toFixed(2)}): revisa la OC`);
    }
  }
  if (subtotal !== null && igv !== null && total !== null && Math.abs(subtotal + igv - total) > 0.05) {
    avisos.push("El subtotal más el IGV no coincide con el total: revisa la OC");
  }
  if (total === null) avisos.push("No se pudo leer el total de la OC");

  // ---- Contrato(s): "Contract ID: 0000000000000000000001489" -> "1489" ----
  const contratos: string[] = [];
  for (const l of lineas) {
    const m = /Contract ID:\s*(\d+)/i.exec(l.texto);
    if (!m) continue;
    const idContrato = m[1].replace(/^0+(?=\d)/, "");
    if (idContrato !== "0" && !contratos.includes(idContrato)) contratos.push(idContrato);
  }
  const contrato = contratos.length > 0 ? contratos.join(", ") : null;

  return {
    ok: true,
    datos: {
      n_oc,
      f_oc,
      proveedor,
      ruc_proveedor,
      moneda,
      subtotal,
      igv,
      total,
      descripcion,
      entregar_en,
      comprador,
      condicion_pago,
      f_entrega,
      contrato,
      lineas: items,
      fecha_ambigua: ambigua,
      avisos,
    },
  };
}
