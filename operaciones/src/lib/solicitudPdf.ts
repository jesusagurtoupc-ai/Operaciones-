// Genera el PDF de la solicitud de materiales (A4, varias páginas si hace falta).
// Corre en el navegador: se carga solo al exportar (import dinámico) y no necesita el servidor.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import {
  type Cabecera,
  type Linea,
  IGV,
  calcularTotales,
  cantidadTexto,
  fechaCorta,
  numero2,
  precioUnitario,
  preciosVencidos,
  simbolo,
  subtotalLinea,
} from "./materiales";

export type DatosPdf = {
  /** Referencia de la solicitud (p. ej. SM-20261107-1530). */
  numero: string;
  cabecera: Cabecera;
  lineas: Linea[];
  /** Nombre del catálogo de donde salen los precios. */
  catalogoTitulo?: string;
  /** Hoy en Lima (YYYY-MM-DD): sirve para marcar precios vencidos. */
  hoy: string;
  /** Texto de fecha y hora de generación para el pie. */
  generado: string;
};

const A4 = { w: 595.28, h: 841.89 };
const M = 40; // margen
const ANCHO = A4.w - 2 * M;
const INK = rgb(0.075, 0.09, 0.133);
const ROJO = rgb(0.816, 0.067, 0.176);
const GRIS = rgb(0.337, 0.376, 0.455);
const LINEA = rgb(0.867, 0.886, 0.918);
const FONDO = rgb(0.937, 0.949, 0.969);
const BLANCO = rgb(1, 1, 1);

// Columnas de la tabla: N°, Código, Descripción, Cantidad, P. unit., Subtotal (suman ANCHO).
const COL = [24, 92, 188, 54, 78, ANCHO - (24 + 92 + 188 + 54 + 78)];
const X = COL.reduce<number[]>((acc, w, i) => [...acc, (acc[i] ?? M) + w], [M]); // x de cada borde

/** Cambia los caracteres que la fuente estándar (WinAnsi) no puede dibujar, para que nunca falle. */
const EQUIVALENTES: Record<string, string> = {
  Ø: "diám. ", ø: "diám. ", "⌀": "diám. ", "≥": ">=", "≤": "<=", "≠": "<>", "’": "'", "‘": "'", "“": '"', "”": '"', "…": "...", "−": "-",
};

function limpiador(font: PDFFont) {
  const permitidos = new Set(font.getCharacterSet());
  return (t: string): string => {
    let out = "";
    for (const ch of t.normalize("NFC").replace(/[\u00a0\t\r\n]+/g, " ")) {
      if (EQUIVALENTES[ch] !== undefined && !permitidos.has(ch.codePointAt(0)!)) {
        out += EQUIVALENTES[ch];
        continue;
      }
      const cp = ch.codePointAt(0)!;
      if (permitidos.has(cp)) {
        out += ch;
        continue;
      }
      const base = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      out += base && base.length === 1 && permitidos.has(base.codePointAt(0)!) ? base : "?";
    }
    return out;
  };
}

/** Parte un texto en renglones que quepan en `ancho` (corta palabras demasiado largas). */
function envolver(font: PDFFont, size: number, texto: string, ancho: number): string[] {
  const out: string[] = [];
  let actual = "";
  const cabe = (s: string) => font.widthOfTextAtSize(s, size) <= ancho;
  for (const palabra of texto.split(" ").filter(Boolean)) {
    let p = palabra;
    while (!cabe(p) && p.length > 1) {
      // palabra más ancha que la columna: se corta por caracteres
      let n = p.length - 1;
      while (n > 1 && !cabe(p.slice(0, n))) n--;
      if (actual) {
        out.push(actual);
        actual = "";
      }
      out.push(p.slice(0, n));
      p = p.slice(n);
    }
    const prueba = actual ? `${actual} ${p}` : p;
    if (cabe(prueba)) actual = prueba;
    else {
      if (actual) out.push(actual);
      actual = p;
    }
  }
  if (actual) out.push(actual);
  return out.length ? out : [""];
}

/** Como `envolver`, pero con un máximo de renglones (el último termina en "…" si se recorta). */
function recortar(font: PDFFont, size: number, texto: string, ancho: number, maxLineas: number): string[] {
  const l = envolver(font, size, texto, ancho);
  if (l.length <= maxLineas) return l;
  const res = l.slice(0, maxLineas);
  let ult = res[maxLineas - 1];
  while (ult.length > 1 && font.widthOfTextAtSize(`${ult}…`, size) > ancho) ult = ult.slice(0, -1);
  res[maxLineas - 1] = `${ult}…`;
  return res;
}

export async function crearPdfSolicitud(d: DatosPdf): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Solicitud de materiales ${d.numero}`);
  doc.setSubject("Solicitud de materiales");
  doc.setCreationDate(new Date());
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const limpio = limpiador(normal);

  const texto = (
    pg: PDFPage,
    t: string,
    x: number,
    y: number,
    o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; derecha?: boolean } = {}
  ) => {
    const f = o.bold ? negrita : normal;
    const size = o.size ?? 8;
    const s = limpio(t);
    const px = o.derecha ? x - f.widthOfTextAtSize(s, size) : x;
    pg.drawText(s, { x: px, y, size, font: f, color: o.color ?? INK });
  };
  const linea = (pg: PDFPage, x1: number, y: number, x2: number, grosor = 0.5, color = LINEA) =>
    pg.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: grosor, color });

  const paginas: PDFPage[] = [];
  const nuevaPagina = (primera: boolean): { pg: PDFPage; y: number } => {
    const pg = doc.addPage([A4.w, A4.h]);
    paginas.push(pg);
    if (primera) {
      pg.drawRectangle({ x: 0, y: A4.h - 64, width: A4.w, height: 64, color: INK });
      pg.drawRectangle({ x: 0, y: A4.h - 68, width: A4.w, height: 4, color: ROJO });
      texto(pg, "SOLICITUD DE MATERIALES", M, A4.h - 36, { size: 17, bold: true, color: BLANCO });
      texto(pg, `N° ${d.numero}`, A4.w - M, A4.h - 30, { size: 10, bold: true, color: BLANCO, derecha: true });
      texto(pg, `Fecha: ${fechaCorta(d.cabecera.fecha || d.hoy)}`, A4.w - M, A4.h - 46, { size: 9, color: BLANCO, derecha: true });
      return { pg, y: A4.h - 92 };
    }
    texto(pg, `Solicitud de materiales — N° ${d.numero} (continuación)`, M, A4.h - 30, { size: 8, color: GRIS });
    linea(pg, M, A4.h - 36, A4.w - M, 0.6);
    return { pg, y: A4.h - 56 };
  };

  let { pg, y } = nuevaPagina(true);
  const LIMITE = 62; // por debajo de esta altura queda el pie de página
  const asegurar = (alto: number, conCabecera = false) => {
    if (y - alto >= LIMITE) return;
    ({ pg, y } = nuevaPagina(false));
    if (conCabecera) y = cabeceraTabla();
  };

  // ── Datos generales ──
  const c = d.cabecera;
  const provs = [...new Set(d.lineas.map((l) => l.proveedor).filter((x): x is string => !!x))];
  const campos: [string, string][] = [
    ["SOLICITANTE", c.solicitante],
    ["ÁREA", c.area],
    ["TICKET / N° REFER.", c.ticket],
    ["LUGAR / DESTINO", c.lugar],
    ["PROVEEDOR (CATÁLOGO)", provs.join(" · ")],
    ["FECHA DE SOLICITUD", fechaCorta(c.fecha || d.hoy)],
  ];
  const anchoCampo = ANCHO / 2 - 12;
  for (let i = 0; i < campos.length; i += 2) {
    const fila = campos.slice(i, i + 2).map(([et, val]) => ({
      et,
      lineas: recortar(normal, 9.5, limpio(val.trim()) || "—", anchoCampo, 2),
    }));
    const alto = 12 + Math.max(...fila.map((f) => f.lineas.length)) * 12 + 6;
    asegurar(alto);
    fila.forEach((f, j) => {
      const x = M + j * (ANCHO / 2 + 12);
      texto(pg, f.et, x, y - 8, { size: 6.5, bold: true, color: GRIS });
      f.lineas.forEach((l, k) => texto(pg, l, x, y - 21 - k * 12, { size: 9.5 }));
    });
    y -= alto;
  }
  linea(pg, M, y + 2, A4.w - M, 0.8);
  y -= 12;

  if (c.observaciones.trim()) {
    const obs = recortar(normal, 8.5, limpio(c.observaciones.trim()), ANCHO - 16, 8);
    const alto = 22 + obs.length * 11;
    asegurar(alto);
    pg.drawRectangle({ x: M, y: y - alto, width: ANCHO, height: alto, color: FONDO });
    texto(pg, "OBSERVACIONES", M + 8, y - 12, { size: 6.5, bold: true, color: GRIS });
    obs.forEach((l, k) => texto(pg, l, M + 8, y - 24 - k * 11, { size: 8.5 }));
    y -= alto + 12;
  }

  // ── Tabla ──
  function cabeceraTabla(): number {
    pg.drawRectangle({ x: M, y: y - 16, width: ANCHO, height: 16, color: INK });
    const t = ["N°", "CÓDIGO", "DESCRIPCIÓN", "CANT.", "P. UNIT. (s/IGV)", "SUBTOTAL"];
    t.forEach((h, i) => {
      const der = i >= 3;
      texto(pg, h, der ? X[i + 1] - 4 : X[i] + 4, y - 11, { size: 7, bold: true, color: BLANCO, derecha: der });
    });
    return y - 16;
  }
  asegurar(60);
  texto(pg, `DETALLE DE MATERIALES (${d.lineas.length})`, M, y - 8, { size: 8, bold: true });
  y -= 16;
  y = cabeceraTabla();

  d.lineas.forEach((l, i) => {
    const desc = envolver(normal, 8, limpio(l.descripcion.trim()), COL[2] - 8);
    const alto = Math.max(desc.length * 10, 12) + 8;
    asegurar(alto, true);
    const yTexto = y - 12;
    texto(pg, String(i + 1), X[0] + 4, yTexto, { size: 8, color: GRIS });
    texto(pg, l.codigo ?? "—", X[1] + 4, yTexto, { size: 7, color: l.codigo ? INK : GRIS });
    desc.forEach((r, k) => texto(pg, r, X[2] + 4, yTexto - k * 10, { size: 8 }));
    const cant = `${cantidadTexto(l.cantidad)}${l.unidad.trim() ? ` ${l.unidad.trim()}` : ""}`;
    texto(pg, cant, X[4] - 4, yTexto, { size: 8, bold: true, derecha: true });
    const sub = subtotalLinea(l);
    texto(pg, l.precio === null ? "—" : `${simbolo(l.moneda)} ${precioUnitario(l.precio)}`, X[5] - 4, yTexto, { size: 8, derecha: true, color: l.precio === null ? GRIS : INK });
    texto(pg, sub === null ? "—" : `${simbolo(l.moneda)} ${numero2(sub)}`, X[6] - 4, yTexto, { size: 8, bold: true, derecha: true, color: sub === null ? GRIS : INK });
    y -= alto;
    linea(pg, M, y, A4.w - M);
  });

  // ── Totales ──
  const { porMoneda, sinPrecio } = calcularTotales(d.lineas);
  y -= 14;
  const xEt = A4.w - M - 210;
  if (porMoneda.length === 0) {
    asegurar(24);
    texto(pg, "Ninguna línea tiene precio: no se calculan totales.", A4.w - M, y - 8, { size: 8, color: GRIS, derecha: true });
    y -= 22;
  }
  for (const t of porMoneda) {
    asegurar(70);
    if (porMoneda.length > 1) {
      texto(pg, `Moneda: ${t.moneda}`, xEt, y - 8, { size: 7.5, bold: true, color: GRIS });
      y -= 13;
    }
    const s = simbolo(t.moneda);
    texto(pg, "Subtotal (sin IGV)", xEt, y - 8, { size: 8.5 });
    texto(pg, `${s} ${numero2(t.subtotal)}`, A4.w - M - 4, y - 8, { size: 8.5, derecha: true });
    texto(pg, `IGV (${Math.round(IGV * 100)} %)`, xEt, y - 22, { size: 8.5 });
    texto(pg, `${s} ${numero2(t.igv)}`, A4.w - M - 4, y - 22, { size: 8.5, derecha: true });
    pg.drawRectangle({ x: xEt - 6, y: y - 46, width: 216, height: 18, color: FONDO });
    texto(pg, "TOTAL (con IGV)", xEt, y - 40, { size: 9.5, bold: true });
    texto(pg, `${s} ${numero2(t.total)}`, A4.w - M - 4, y - 40, { size: 10, bold: true, derecha: true });
    y -= 58;
  }

  // ── Notas ──
  const notas: { t: string; rojo?: boolean }[] = [];
  const conCatalogo = d.lineas.some((l) => l.codigo);
  if (conCatalogo) notas.push({ t: `Precios unitarios sin IGV, tomados del catálogo "${d.catalogoTitulo ?? "de materiales"}".` });
  const vencidos = preciosVencidos(d.lineas, d.hoy);
  if (vencidos.length > 0) {
    notas.push({
      t: `ATENCIÓN: los precios del catálogo vencieron el ${vencidos.map(fechaCorta).join(", ")}. Confirmar su vigencia con el proveedor antes de hacer el pedido.`,
      rojo: true,
    });
  }
  if (sinPrecio > 0) {
    notas.push({ t: `${sinPrecio} línea(s) sin precio no están incluidas en los totales.` });
  }
  const vistos = new Set<string>();
  for (const l of d.lineas) {
    if (!l.proveedor || vistos.has(l.proveedor)) continue;
    vistos.add(l.proveedor);
    const partes = [l.minimo && `Pedido mínimo: ${l.minimo}`, l.entrega && `Entrega: ${l.entrega}`].filter(Boolean);
    if (partes.length) notas.push({ t: `${l.proveedor} — ${partes.join(". ")}.` });
  }
  for (const n of notas) {
    const ls = envolver(n.rojo ? negrita : normal, 7.5, limpio(n.t), ANCHO);
    asegurar(ls.length * 10 + 4);
    ls.forEach((r, k) => texto(pg, r, M, y - 8 - k * 10, { size: 7.5, bold: n.rojo, color: n.rojo ? ROJO : GRIS }));
    y -= ls.length * 10 + 4;
  }

  // ── Firmas ──
  asegurar(78);
  y -= 40;
  const wFirma = 200;
  linea(pg, M, y, M + wFirma, 0.8, INK);
  linea(pg, A4.w - M - wFirma, y, A4.w - M, 0.8, INK);
  texto(pg, "Solicitado por", M, y - 12, { size: 8, bold: true });
  if (c.solicitante.trim()) texto(pg, recortar(normal, 8, limpio(c.solicitante.trim()), wFirma, 1)[0], M, y - 23, { size: 8, color: GRIS });
  texto(pg, "Aprobado por", A4.w - M - wFirma, y - 12, { size: 8, bold: true });

  // ── Pie de página ──
  paginas.forEach((p, i) => {
    linea(p, M, 44, A4.w - M, 0.6);
    texto(p, `Solicitud de materiales N° ${d.numero}`, M, 32, { size: 7.5, color: GRIS });
    const gen = `Generado el ${d.generado}`;
    texto(p, gen, A4.w / 2 - normal.widthOfTextAtSize(limpio(gen), 7.5) / 2, 32, { size: 7.5, color: GRIS });
    texto(p, `Página ${i + 1} de ${paginas.length}`, A4.w - M, 32, { size: 7.5, color: GRIS, derecha: true });
  });

  return doc.save();
}
