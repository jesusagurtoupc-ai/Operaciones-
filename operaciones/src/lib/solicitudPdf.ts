// Genera el PDF de la solicitud de materiales (A4, varias páginas si hace falta).
// Corre en el navegador: se carga solo al exportar (import dinámico) y no necesita el servidor.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { type Cabecera, type Linea, cantidadTexto, fechaCorta } from "./materiales";

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
  /** Foto de cada línea (por uid), ya en JPG: se dibuja en la columna FOTO. */
  fotos?: Record<string, Uint8Array>;
};

const A4 = { w: 595.28, h: 841.89 };
const M = 42; // margen
const ANCHO = A4.w - 2 * M;
const INK = rgb(0.075, 0.09, 0.133);
const ROJO = rgb(0.835, 0.153, 0.157); // rojo institucional (el del logo)
const GRIS = rgb(0.42, 0.45, 0.52);
const GRIS_CLARO = rgb(0.6, 0.63, 0.68);
const LINEA = rgb(0.886, 0.902, 0.925);
const CABECERA_TABLA = rgb(0.953, 0.957, 0.965);
const CEBRA = rgb(0.984, 0.985, 0.988);
const BLANCO = rgb(1, 1, 1);

const FOTO = 64; // lado del recuadro de la foto, en puntos (~2,3 cm)

// Columnas de la tabla: N°, N° Ticket, Descripción, Cantidad, Foto (suman ANCHO). Sin código ni precios.
const COL = [28, 74, ANCHO - (28 + 74 + 74 + 84), 74, 84];
// Índices de columna, para no confundirse al leer el código.
const C = { n: 0, ticket: 1, desc: 2, cant: 3, foto: 4 } as const;
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

  // Fotos: se incrustan una sola vez cada una (si alguna falla, esa línea sale sin foto).
  const imagenes = new Map<string, Awaited<ReturnType<typeof doc.embedJpg>>>();
  for (const [uid, bytes] of Object.entries(d.fotos ?? {})) {
    try {
      imagenes.set(uid, await doc.embedJpg(bytes));
    } catch {
      // foto dañada: la línea sale sin foto
    }
  }

  const paginas: PDFPage[] = [];
  const nuevaPagina = (primera: boolean): { pg: PDFPage; y: number } => {
    const pg = doc.addPage([A4.w, A4.h]);
    paginas.push(pg);
    // Franja roja fina arriba, en todas las páginas.
    pg.drawRectangle({ x: 0, y: A4.h - 6, width: A4.w, height: 6, color: ROJO });
    if (!primera) {
      texto(pg, "Solicitud de materiales", M, A4.h - 30, { size: 8, bold: true });
      texto(pg, `N° ${d.numero} · continuación`, A4.w - M, A4.h - 30, { size: 8, color: GRIS, derecha: true });
      linea(pg, M, A4.h - 38, A4.w - M, 0.6);
      return { pg, y: A4.h - 52 };
    }
    // Encabezado: título a la izquierda; N° y fecha a la derecha, en una ficha.
    const yTop = A4.h - 34;
    const xTitulo = M;
    texto(pg, "SOLICITUD DE MATERIALES", xTitulo, yTop - 12, { size: 17, bold: true });
    texto(pg, "Mantenimiento · Sistema de Correctivos", xTitulo, yTop - 28, { size: 8.5, color: GRIS });

    const wFicha = 150;
    const xFicha = A4.w - M - wFicha;
    pg.drawRectangle({ x: xFicha, y: yTop - 38, width: wFicha, height: 44, color: CABECERA_TABLA });
    pg.drawRectangle({ x: xFicha, y: yTop - 38, width: 3, height: 44, color: ROJO });
    texto(pg, "N° DE SOLICITUD", xFicha + 12, yTop - 6, { size: 6.5, bold: true, color: GRIS });
    texto(pg, d.numero, xFicha + 12, yTop - 18, { size: 10, bold: true });
    texto(pg, `Fecha: ${fechaCorta(d.cabecera.fecha || d.hoy)}`, xFicha + 12, yTop - 31, { size: 8, color: GRIS });

    linea(pg, M, yTop - 54, A4.w - M, 0.8);
    return { pg, y: yTop - 72 };
  };

  let { pg, y } = nuevaPagina(true);
  const LIMITE = 64; // por debajo de esta altura queda el pie de página
  const asegurar = (alto: number, conCabecera = false) => {
    if (y - alto >= LIMITE) return;
    ({ pg, y } = nuevaPagina(false));
    if (conCabecera) y = cabeceraTabla();
  };

  // ── Resumen ──
  texto(pg, "DETALLE DE MATERIALES", M, y - 9, { size: 9, bold: true });
  y -= 20;

  // ── Tabla ──
  function cabeceraTabla(): number {
    const h = 20;
    pg.drawRectangle({ x: M, y: y - h, width: ANCHO, height: h, color: CABECERA_TABLA });
    linea(pg, M, y - h, A4.w - M, 0.8, INK);
    const et = (t: string, x: number, alin: "izq" | "der" | "centro") => {
      const w = negrita.widthOfTextAtSize(t, 7);
      const px = alin === "der" ? x - w : alin === "centro" ? x - w / 2 : x;
      texto(pg, t, px, y - 13, { size: 7, bold: true, color: GRIS });
    };
    et("N°", X[C.n] + 6, "izq");
    et("N° TICKET", X[C.ticket] + 6, "izq");
    et("DESCRIPCIÓN", X[C.desc] + 6, "izq");
    et("CANTIDAD", X[C.cant] + COL[C.cant] / 2, "centro");
    et("FOTO", X[C.foto] + COL[C.foto] / 2, "centro");
    return y - h;
  }
  y = cabeceraTabla();

  d.lineas.forEach((l, i) => {
    const img = imagenes.get(l.uid);
    const desc = envolver(normal, 9, limpio(l.descripcion.trim()), COL[C.desc] - 14);
    const ticket = envolver(negrita, 8.5, limpio((l.ticket ?? "").trim()) || "—", COL[C.ticket] - 12).slice(0, 3);
    const altoTexto = Math.max(desc.length * 11.5, ticket.length * 11);
    const alto = Math.max(altoTexto + 16, img ? FOTO + 12 : 0, 30);
    asegurar(alto, true);

    if (i % 2 === 1) pg.drawRectangle({ x: M, y: y - alto, width: ANCHO, height: alto, color: CEBRA });
    // Texto centrado verticalmente en la fila.
    const yBase = y - (alto - altoTexto) / 2 - 8.5;
    texto(pg, String(i + 1).padStart(2, "0"), X[C.n] + 6, yBase, { size: 8, bold: true, color: GRIS_CLARO });
    const sinTicket = !(l.ticket ?? "").trim();
    ticket.forEach((r, k) =>
      texto(pg, r, X[C.ticket] + 6, yBase - k * 11, { size: 8.5, bold: !sinTicket, color: sinTicket ? LINEA : INK })
    );
    desc.forEach((r, k) => texto(pg, r, X[C.desc] + 6, yBase - k * 11.5, { size: 9 }));

    // Cantidad grande y la unidad debajo, en gris, centradas en su columna.
    const yCant = y - alto / 2;
    const centro = X[C.cant] + COL[C.cant] / 2;
    const cant = limpio(cantidadTexto(l.cantidad));
    const unidad = limpio(l.unidad.trim().toUpperCase());
    texto(pg, cant, centro - negrita.widthOfTextAtSize(cant, 12) / 2, yCant + (unidad ? 0 : -4), { size: 12, bold: true });
    if (unidad) texto(pg, unidad, centro - normal.widthOfTextAtSize(unidad, 7) / 2, yCant - 11, { size: 7, color: GRIS });

    if (img) {
      // La foto entra entera en el recuadro, sin deformarse, centrada en su columna.
      const esc = Math.min(FOTO / img.width, FOTO / img.height);
      const w = img.width * esc;
      const h = img.height * esc;
      const x0 = X[C.foto] + (COL[C.foto] - FOTO) / 2;
      const y0 = y - alto / 2 - FOTO / 2;
      pg.drawRectangle({ x: x0, y: y0, width: FOTO, height: FOTO, color: BLANCO, borderColor: LINEA, borderWidth: 0.6 });
      pg.drawImage(img, { x: x0 + (FOTO - w) / 2, y: y0 + (FOTO - h) / 2, width: w, height: h });
    } else {
      const guion = "—";
      texto(pg, guion, X[C.foto] + COL[C.foto] / 2 - normal.widthOfTextAtSize(guion, 8) / 2, y - alto / 2 - 3, { size: 8, color: LINEA });
    }
    y -= alto;
    linea(pg, M, y, A4.w - M, 0.5);
  });

  // Cierre de la tabla: total de ítems.
  asegurar(24);
  linea(pg, M, y, A4.w - M, 0.8, INK);
  texto(pg, `Total: ${d.lineas.length} ${d.lineas.length === 1 ? "ítem" : "ítems"}`, A4.w - M, y - 14, { size: 8, bold: true, derecha: true });

  // ── Pie de página ──
  paginas.forEach((p, i) => {
    linea(p, M, 42, A4.w - M, 0.6);
    texto(p, `Solicitud de materiales · N° ${d.numero}`, M, 30, { size: 7.5, color: GRIS });
    const gen = `Generado el ${d.generado}`;
    texto(p, gen, A4.w / 2 - normal.widthOfTextAtSize(limpio(gen), 7.5) / 2, 30, { size: 7.5, color: GRIS });
    texto(p, `Página ${i + 1} de ${paginas.length}`, A4.w - M, 30, { size: 7.5, color: GRIS, derecha: true });
  });

  return doc.save();
}
