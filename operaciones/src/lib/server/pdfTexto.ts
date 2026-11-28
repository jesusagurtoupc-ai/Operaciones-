// Extractor mínimo de texto de PDF, SIN dependencias externas (solo zlib de Node).
//
// Está pensado para las órdenes de compra que genera PeopleSoft/SQR (fuentes
// estándar Helvetica y Courier, texto normal, sin escanear). No es un lector de
// PDF general: no entiende fuentes incrustadas con codificación propia (CID),
// ni PDFs escaneados, ni cifrados. En esos casos devuelve pocas o ninguna línea
// y quien lo llama muestra un mensaje claro para que se capture a mano.
//
// Por qué no una librería: el proyecto se despliega subiendo archivos a GitHub y
// una dependencia nueva exige regenerar package-lock.json y configurar el bundler
// de Next. Para este formato basta con inflar los streams y leer los operadores
// de texto (Td, Tj, TJ...).
import { inflateSync } from "node:zlib";

export type Corrida = {
  x: number;
  y: number;
  texto: string; // sin recortar (el largo importa para detectar texto pegado)
  fuente: string; // BaseFont, p. ej. "Courier"
  tamano: number;
  /** Ancho real del texto (con los anchos de letra de la fuente). Solo si el PDF los trae. */
  ancho?: number;
};

/** Anchos de letra de una fuente (milésimas de em), tal como vienen en el PDF. */
type Anchos =
  | { tipo: "simple"; primero: number; w: number[]; defecto: number }
  | { tipo: "cid"; w: Map<number, number>; defecto: number };

export type Linea = {
  y: number;
  corridas: Corrida[]; // de izquierda a derecha
  texto: string; // corridas unidas con espacio, salvo las pegadas
};

export type Pagina = { lineas: Linea[] };

const MAX_STREAMS = 2000;
const MAX_STREAM_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

// cp1252 (WinAnsi) para 0x80-0x9F; el resto coincide con Latin-1.
const CP1252: Record<number, string> = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡",
  0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘",
  0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜",
  0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};

function decodificar(bytes: number[]): string {
  let s = "";
  for (const b of bytes) s += CP1252[b] ?? String.fromCharCode(b);
  return s;
}

// ---------- Tokenizador del content stream ----------

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string; b: number[] }
  | { t: "name"; v: string }
  | { t: "arr"; v: Tok[] }
  | { t: "op"; v: string };

const ESPACIO = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set(["(", ")", "<", ">", "[", "]", "{", "}", "/", "%"]);

function tokenizar(s: string): Tok[] {
  const raiz: Tok[] = [];
  const pila: Tok[][] = [raiz];
  const push = (t: Tok) => pila[pila.length - 1].push(t);
  let i = 0;
  const n = s.length;

  while (i < n) {
    const c = s[i];
    const cc = s.charCodeAt(i);
    if (ESPACIO.has(cc)) { i++; continue; }
    if (c === "%") { while (i < n && s[i] !== "\n" && s[i] !== "\r") i++; continue; }

    if (c === "(") {
      // Cadena literal con paréntesis anidados y escapes.
      const bytes: number[] = [];
      let prof = 1;
      i++;
      while (i < n && prof > 0) {
        const ch = s[i];
        if (ch === "\\") {
          const nx = s[i + 1];
          if (nx === undefined) { i++; break; }
          if (nx >= "0" && nx <= "7") {
            let oct = nx;
            let k = i + 2;
            while (oct.length < 3 && s[k] >= "0" && s[k] <= "7") { oct += s[k]; k++; }
            bytes.push(parseInt(oct, 8) & 0xff);
            i = k;
            continue;
          }
          const mapa: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };
          if (nx in mapa) bytes.push(mapa[nx]);
          else if (nx === "\n") { /* continuación de línea */ }
          else if (nx === "\r") { if (s[i + 2] === "\n") i++; }
          else bytes.push(nx.charCodeAt(0) & 0xff);
          i += 2;
          continue;
        }
        if (ch === "(") prof++;
        else if (ch === ")") { prof--; if (prof === 0) { i++; break; } }
        bytes.push(s.charCodeAt(i) & 0xff);
        i++;
      }
      push({ t: "str", v: decodificar(bytes), b: bytes });
      continue;
    }

    if (c === "<") {
      if (s[i + 1] === "<") {
        // Diccionario inline: se salta completo.
        let prof = 1;
        i += 2;
        while (i < n && prof > 0) {
          if (s[i] === "<" && s[i + 1] === "<") { prof++; i += 2; }
          else if (s[i] === ">" && s[i + 1] === ">") { prof--; i += 2; }
          else i++;
        }
        continue;
      }
      const fin = s.indexOf(">", i);
      const hex = s.slice(i + 1, fin < 0 ? n : fin).replace(/\s+/g, "");
      const bytes: number[] = [];
      for (let k = 0; k < hex.length; k += 2) {
        bytes.push(parseInt(hex.slice(k, k + 2).padEnd(2, "0"), 16) & 0xff);
      }
      push({ t: "str", v: decodificar(bytes), b: bytes });
      i = fin < 0 ? n : fin + 1;
      continue;
    }

    if (c === "[") { const a: Tok[] = []; pila.push(a); i++; continue; }
    if (c === "]") {
      if (pila.length > 1) { const a = pila.pop()!; push({ t: "arr", v: a }); }
      i++;
      continue;
    }

    if (c === "/") {
      let j = i + 1;
      while (j < n && !ESPACIO.has(s.charCodeAt(j)) && !DELIM.has(s[j])) j++;
      push({ t: "name", v: s.slice(i + 1, j) });
      i = j;
      continue;
    }

    // Número u operador.
    let j = i;
    while (j < n && !ESPACIO.has(s.charCodeAt(j)) && !DELIM.has(s[j])) j++;
    if (j === i) { i++; continue; }
    const palabra = s.slice(i, j);
    i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(palabra)) {
      push({ t: "num", v: parseFloat(palabra) });
    } else if (palabra === "BI") {
      // Imagen inline: se salta hasta EI.
      const ei = s.indexOf("EI", i);
      i = ei < 0 ? n : ei + 2;
    } else {
      push({ t: "op", v: palabra });
    }
  }
  return raiz;
}

// ---------- CMap ToUnicode (fuentes CID incrustadas) ----------

/** Tabla código -> texto de una fuente de 2 bytes por carácter (Type0 / Identity-H). */
export type CMap = Map<number, string>;

const hexAUtf16 = (h: string): string => {
  let out = "";
  for (let i = 0; i + 3 < h.length + 1; i += 4) {
    const u = parseInt(h.slice(i, i + 4), 16);
    if (Number.isFinite(u)) out += String.fromCharCode(u);
  }
  return out;
};

/** Lee un flujo ToUnicode (bfchar / bfrange). Devuelve null si no es de 2 bytes por código. */
function parsearCMap(texto: string): CMap | null {
  if (!/beginbf(char|range)/.test(texto)) return null;
  const cs = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(texto);
  if (cs && cs[1].length !== 4) return null;
  const mapa: CMap = new Map();
  for (const bloque of texto.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of bloque[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
      mapa.set(parseInt(m[1], 16), hexAUtf16(m[2]));
    }
  }
  for (const bloque of texto.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]*)>|\[([^\]]*)\])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(bloque[1]))) {
      const lo = parseInt(m[1], 16);
      const hi = Math.min(parseInt(m[2], 16), lo + 0xffff);
      if (m[3] !== undefined) {
        const base = hexAUtf16(m[3]);
        for (let c = lo; c <= hi; c++) {
          mapa.set(c, base.length ? base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (c - lo)) : "");
        }
      } else if (m[4] !== undefined) {
        const dst = [...m[4].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => hexAUtf16(x[1]));
        for (let c = lo; c <= hi && c - lo < dst.length; c++) mapa.set(c, dst[c - lo]);
      }
    }
  }
  return mapa.size > 0 ? mapa : null;
}

// ---------- Fuentes ----------

/**
 * nombre de recurso (F0, F1...) -> BaseFont, a partir de todos los objetos del PDF.
 * Los objetos pueden estar sueltos ("12 0 obj ... endobj") o empaquetados dentro de un flujo de
 * objetos (ObjStm), que es como guardan los PDF muchos programas (Acrobat, Ghostscript, qpdf...).
 */
/** Arreglo de un diccionario ("/Widths [ ... ]" o "/Widths 12 0 R"), como lista de números y corchetes. */
function arregloDe(cuerpo: string, clave: string, objetos: Map<number, string>): (number | "[" | "]")[] | null {
  const re = new RegExp(`/${clave}\\s*(?:(\\[)|(\\d+)\\s+\\d+\\s+R)`);
  const m = re.exec(cuerpo);
  if (!m) return null;
  let txt: string;
  if (m[1]) txt = cuerpo.slice(m.index + m[0].length - 1);
  else {
    const ref = objetos.get(Number(m[2]));
    if (!ref) return null;
    txt = ref.slice(ref.indexOf("["));
  }
  const out: (number | "[" | "]")[] = [];
  let nivel = 0;
  for (const t of txt.slice(0, 200_000).matchAll(/\[|\]|-?\d+(?:\.\d+)?/g)) {
    if (t[0] === "[") { nivel++; out.push("["); }
    else if (t[0] === "]") { nivel--; out.push("]"); if (nivel <= 0) break; }
    else out.push(Number(t[0]));
    if (out.length > 60_000) break;
  }
  return out;
}

/** Anchos de una fuente simple (/FirstChar + /Widths) o CID (/DescendantFonts → /W y /DW). */
function anchosDeFuente(cuerpo: string, objetos: Map<number, string>): Anchos | null {
  const ws = arregloDe(cuerpo, "Widths", objetos);
  if (ws) {
    const primero = Number(/\/FirstChar\s+(\d+)/.exec(cuerpo)?.[1] ?? 0);
    const w = ws.filter((x): x is number => typeof x === "number");
    return w.length > 0 ? { tipo: "simple", primero, w, defecto: 500 } : null;
  }
  const desc = /\/DescendantFonts\s*(?:\[\s*(\d+)\s+\d+\s+R|(\d+)\s+\d+\s+R)/.exec(cuerpo);
  if (!desc) return null;
  let cid = objetos.get(Number(desc[1] ?? desc[2])) ?? "";
  if (!desc[1]) {
    // /DescendantFonts 9 0 R → el objeto 9 es "[ 10 0 R ]"
    const r = /(\d+)\s+\d+\s+R/.exec(cid);
    cid = r ? objetos.get(Number(r[1])) ?? "" : "";
  }
  if (!cid) return null;
  const defecto = Number(/\/DW\s+(\d+)/.exec(cid)?.[1] ?? 1000);
  const w = new Map<number, number>();
  const arr = arregloDe(cid, "W", objetos) ?? [];
  // Formato /W: "c [w1 w2 ...]" (desde c, uno por código) o "c1 c2 w" (todos del rango con w).
  for (let i = 1; i < arr.length - 1 && w.size < 70_000; ) {
    const c = arr[i];
    if (typeof c !== "number") { i++; continue; }
    if (arr[i + 1] === "[") {
      let k = i + 2;
      let cod = c;
      while (k < arr.length && arr[k] !== "]") { const v = arr[k]; if (typeof v === "number") w.set(cod++, v); k++; }
      i = k + 1;
    } else if (typeof arr[i + 1] === "number" && typeof arr[i + 2] === "number") {
      const hasta = Math.min(arr[i + 1] as number, c + 65_536);
      for (let cod = c; cod <= hasta; cod++) w.set(cod, arr[i + 2] as number);
      i += 3;
    } else i++;
  }
  return { tipo: "cid", w, defecto };
}

function mapaDeFuentes(objetos: Map<number, string>): {
  porNombre: Map<string, string>;
  cmapDe: Map<string, number>;
  anchos: Map<string, Anchos>;
} {
  // objeto -> BaseFont (sin el prefijo de subconjunto "ABCDEF+")
  const baseDe = new Map<number, string>();
  const toUniDe = new Map<number, number>(); // objeto de fuente -> objeto del flujo ToUnicode
  for (const [num, cuerpo] of objetos) {
    const m = /\/BaseFont\s*\/([^\s/<>[\]()]+)/.exec(cuerpo);
    if (m) baseDe.set(num, m[1].replace(/^[A-Z]{6}\+/, ""));
    const u = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(cuerpo);
    if (u) toUniDe.set(num, Number(u[1]));
  }
  const porNombre = new Map<string, string>();
  const cmapDe = new Map<string, number>();
  const anchos = new Map<string, Anchos>();
  const anchosPorObjeto = new Map<number, Anchos | null>();
  const asociar = (dict: string) => {
    const reRef = /\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g;
    let r: RegExpExecArray | null;
    while ((r = reRef.exec(dict))) {
      const num = Number(r[2]);
      const base = baseDe.get(num);
      if (base) {
        porNombre.set(r[1], base);
        if (!anchosPorObjeto.has(num)) anchosPorObjeto.set(num, anchosDeFuente(objetos.get(num) ?? "", objetos));
        const a = anchosPorObjeto.get(num);
        if (a) anchos.set(r[1], a);
      }
      const tu = toUniDe.get(num);
      if (tu !== undefined) cmapDe.set(r[1], tu);
    }
  };
  // "/Font << /F1 5 0 R ... >>" (en línea) o "/Font 8 0 R" (el diccionario está en otro objeto)
  const reFont = /\/Font\s*(?:<<([^>]*)>>|(\d+)\s+\d+\s+R)/g;
  for (const cuerpo of objetos.values()) {
    reFont.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = reFont.exec(cuerpo))) {
      if (m[1] !== undefined) asociar(m[1]);
      else {
        const ref = objetos.get(Number(m[2]));
        if (ref) asociar(ref);
      }
    }
  }
  return { porNombre, cmapDe, anchos };
}

const esMonoespaciada = (fuente: string) => /courier|mono|consolas/i.test(fuente);
const ANCHO_COURIER = 0.6; // em por carácter
const ANCHO_PROPORCIONAL = 0.5; // aproximación para ordenar corridas

// ---------- Content stream -> corridas ----------

function corridasDeStream(
  contenido: string,
  fuentes: Map<string, string>,
  cmaps: Map<string, CMap> = new Map(),
  anchos: Map<string, Anchos> = new Map()
): Corrida[] {
  const toks = tokenizar(contenido);
  const out: Corrida[] = [];

  let nombreFuente = "";
  let tamano = 10;
  let tl = 0;
  let lx = 0, ly = 0; // origen de la línea actual (Tlm)
  let cx = 0; // posición X actual (avanza al mostrar texto)
  let operandos: Tok[] = [];
  // Espaciado de caracteres (Tc), de palabras (Tw), escala horizontal (Tz) y escala de la matriz de texto.
  let tc = 0, tw = 0, tz = 1, escala = 1;

  const nums = () => operandos.filter((o): o is { t: "num"; v: number } => o.t === "num").map((o) => o.v);
  const fuenteActual = () => fuentes.get(nombreFuente) ?? "";

  /**
   * Ancho real de lo mostrado, con los anchos de letra de la fuente (null si el PDF no los trae).
   * `codigos` = códigos de carácter tal como están en el PDF; `ajustes` = números de TJ (milésimas de em).
   */
  function anchoReal(codigos: number[], espacios: number, ajustes: number): number | null {
    const a = anchos.get(nombreFuente);
    if (!a) return null;
    let suma = 0;
    for (const c of codigos) {
      const w = a.tipo === "simple" ? a.w[c - a.primero] : a.w.get(c);
      suma += w ?? a.defecto;
    }
    const t = tamano * escala;
    return ((suma - ajustes) / 1000) * t * tz + (codigos.length * tc + espacios * tw) * tz * escala;
  }

  function mostrar(texto: string, ancho: number | null = null) {
    if (!texto) return;
    const fuente = fuenteActual();
    const t = tamano * escala;
    out.push({ x: cx, y: ly, texto, fuente, tamano: t, ...(ancho !== null ? { ancho } : {}) });
    cx += ancho ?? texto.length * t * (esMonoespaciada(fuente) ? ANCHO_COURIER : ANCHO_PROPORCIONAL);
  }

  /** Códigos de carácter de una cadena: 2 bytes por carácter si la fuente es CID, 1 si no. */
  function codigosDe(e: { v: string; b: number[] }): number[] {
    if (cmaps.has(nombreFuente) || anchos.get(nombreFuente)?.tipo === "cid") {
      const r: number[] = [];
      for (let k = 0; k + 1 < e.b.length; k += 2) r.push((e.b[k] << 8) | e.b[k + 1]);
      return r;
    }
    return e.b.length ? e.b : [...e.v].map((ch) => ch.charCodeAt(0) & 0xff);
  }

  function mostrarCadena(e: { v: string; b: number[] }) {
    const cods = codigosDe(e);
    const esp = anchos.get(nombreFuente)?.tipo === "simple" ? cods.filter((c) => c === 32).length : 0;
    mostrar(textoDe(e), anchoReal(cods, esp, 0));
  }

  /** Texto de una cadena: con el CMap de la fuente si es CID (2 bytes por carácter); si no, tal cual. */
  function textoDe(e: { v: string; b: number[] }): string {
    const cm = cmaps.get(nombreFuente);
    if (!cm) return e.v;
    let r = "";
    for (let k = 0; k + 1 < e.b.length; k += 2) r += cm.get((e.b[k] << 8) | e.b[k + 1]) ?? "";
    return r;
  }

  function mostrarArreglo(arr: Tok[]) {
    let texto = "";
    const cods: number[] = [];
    let ajustes = 0;
    for (const e of arr) {
      if (e.t === "str") { texto += textoDe(e); cods.push(...codigosDe(e)); }
      else if (e.t === "num") {
        ajustes += e.v;
        if (e.v < -250) texto += " "; // hueco grande = espacio
      }
    }
    const esp = anchos.get(nombreFuente)?.tipo === "simple" ? cods.filter((c) => c === 32).length : 0;
    mostrar(texto, anchoReal(cods, esp, ajustes));
  }

  function siguienteLinea() {
    ly -= tl;
    cx = lx;
  }

  for (const tk of toks) {
    if (tk.t !== "op") { operandos.push(tk); if (operandos.length > 64) operandos.shift(); continue; }
    const op = tk.v;
    const n = nums();
    switch (op) {
      case "BT": lx = 0; ly = 0; cx = 0; break;
      case "Tf": {
        const nom = operandos.find((o) => o.t === "name");
        if (nom && nom.t === "name") nombreFuente = nom.v;
        if (n.length) tamano = Math.abs(n[n.length - 1]) || tamano;
        break;
      }
      case "TL": if (n.length) tl = n[n.length - 1]; break;
      case "Tc": if (n.length) tc = n[n.length - 1]; break;
      case "Tw": if (n.length) tw = n[n.length - 1]; break;
      case "Tz": if (n.length) tz = n[n.length - 1] / 100; break;
      case "Td": if (n.length >= 2) { lx += n[n.length - 2]; ly += n[n.length - 1]; cx = lx; } break;
      case "TD": if (n.length >= 2) { tl = -n[n.length - 1]; lx += n[n.length - 2]; ly += n[n.length - 1]; cx = lx; } break;
      case "Tm": if (n.length >= 6) { lx = n[4]; ly = n[5]; cx = lx; escala = Math.abs(n[n.length - 6]) || 1; } break;
      case "T*": siguienteLinea(); break;
      case "Tj": { const s = operandos[operandos.length - 1]; if (s?.t === "str") mostrarCadena(s); break; }
      case "TJ": { const a = operandos[operandos.length - 1]; if (a?.t === "arr") mostrarArreglo(a.v); break; }
      case "'": { siguienteLinea(); const s = operandos[operandos.length - 1]; if (s?.t === "str") mostrarCadena(s); break; }
      case '"': {
        // a w c (string) " → fija Tw y Tc, salta de línea y muestra.
        if (n.length >= 2) { tw = n[n.length - 2]; tc = n[n.length - 1]; }
        siguienteLinea();
        const s = operandos[operandos.length - 1];
        if (s?.t === "str") mostrarCadena(s);
        break;
      }
      default: break;
    }
    operandos = [];
  }
  return out;
}

// ---------- Corridas -> líneas ----------

function armarLineas(corridas: Corrida[]): Linea[] {
  const ordenadas = corridas
    .filter((c) => c.texto.trim() !== "")
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const lineas: Linea[] = [];
  for (const c of ordenadas) {
    const ultima = lineas[lineas.length - 1];
    if (ultima && Math.abs(ultima.y - c.y) <= 1.5) ultima.corridas.push(c);
    else lineas.push({ y: c.y, corridas: [c], texto: "" });
  }
  for (const l of lineas) {
    l.corridas.sort((a, b) => a.x - b.x);
    let texto = "";
    l.corridas.forEach((c, i) => {
      const t = c.texto.trim();
      if (i === 0) { texto = t; return; }
      const prev = l.corridas[i - 1];
      // Courier es de ancho fijo: si la corrida empieza justo donde termina la
      // anterior, es texto pegado (PeopleSoft dibuja algunos números carácter a carácter).
      const finPrev = prev.x + prev.texto.length * prev.tamano * ANCHO_COURIER;
      let pegado = esMonoespaciada(prev.fuente) && Math.abs(c.x - finPrev) < 0.5;
      // Con anchos reales (PDF de Word, Excel…): si la corrida empieza donde termina la anterior es la
      // misma palabra ("C" "O" "T" "I" "ZA" "CIÓN" → "COTIZACIÓN"); un espacio mide ~0,25 em.
      // Si la anterior ya termina en espacio (o esta empieza con uno), el espacio va igual.
      if (!pegado && prev.ancho !== undefined && !/\s$/.test(prev.texto) && !/^\s/.test(c.texto)) {
        const hueco = c.x - (prev.x + prev.ancho);
        pegado = hueco < 0.12 * Math.max(prev.tamano, c.tamano) && hueco > -0.5 * prev.tamano;
      }
      texto += (pegado ? "" : " ") + t;
    });
    l.texto = texto;
  }
  return lineas;
}

// ---------- API ----------

export type ResultadoPdf =
  | {
      ok: true;
      paginas: Pagina[];
      creado: string | null; // YYYY-MM-DD del metadato del PDF
      /** El PDF usa fuentes incrustadas con codificación propia (CID): su texto no se puede leer bien. */
      usaFuentesCID: boolean;
    }
  | { ok: false; error: string };

/** Fecha de creación que declara el PDF (/CreationDate (D:AAAAMMDD...)), o null. */
function fechaDeCreacion(textos: Iterable<string>): string | null {
  for (const t of textos) {
    const m = /\/CreationDate\s*\(D:(\d{4})(\d{2})(\d{2})/.exec(t);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return null;
}

/**
 * Ubica el inicio real del PDF. Algunas descargas o correos dejan bytes de más (BOM, saltos de
 * línea) antes de "%PDF-"; el estándar permite hasta 1024. Devuelve null si no es un PDF.
 */
export function localizarPdf(buf: Buffer): Buffer | null {
  const i = buf.subarray(0, 1024).indexOf("%PDF-", 0, "latin1");
  if (i < 0 || buf.length - i < 8) return null;
  return i === 0 ? buf : buf.subarray(i);
}

export function extraerPaginasPdf(entrada: Buffer): ResultadoPdf {
  const buf = localizarPdf(entrada);
  if (!buf) return { ok: false, error: "El archivo no es un PDF válido" };
  const s = buf.toString("latin1");
  if (!s.includes("%%EOF")) {
    return {
      ok: false,
      error: "El PDF está incompleto o dañado (¿se cortó la descarga?). Descárgalo de nuevo y vuelve a intentarlo",
    };
  }
  if (/\/Encrypt\b/.test(s)) {
    return {
      ok: false,
      error: "El PDF está protegido y no se puede leer. Usa el PDF original de la OC, sin contraseña ni restricciones",
    };
  }

  // Objetos del PDF: sueltos y los empaquetados en flujos de objetos (ObjStm).
  const objetos = new Map<number, string>();
  const reObj = /(?<![\d.])(\d+)\s+\d+\s+obj\b/g;
  let mo: RegExpExecArray | null;
  while ((mo = reObj.exec(s))) {
    const ini = mo.index + mo[0].length;
    const fin = s.indexOf("endobj", ini);
    if (fin < 0) break;
    let cuerpo = s.slice(ini, fin);
    const st = cuerpo.search(/(?<!end)stream\r?\n/);
    if (st >= 0) cuerpo = cuerpo.slice(0, st); // solo el diccionario, sin los datos del flujo
    objetos.set(Number(mo[1]), cuerpo);
    reObj.lastIndex = fin + 6;
  }

  const contenidos: string[] = [];
  const cmapsPorObjeto = new Map<number, CMap>();
  const re = /(?<!end)stream\r?\n/g;
  let m: RegExpExecArray | null;
  let revisados = 0;
  let total = 0;
  let hayImagenes = false;

  while ((m = re.exec(s))) {
    const ini = m.index + m[0].length;
    const fin = s.indexOf("endstream", ini);
    if (fin < 0) break;
    re.lastIndex = fin + 9;
    if (++revisados > MAX_STREAMS) break;

    // Diccionario del flujo (desde el "obj" que lo abre hasta "stream").
    const dict = s.slice(Math.max(0, s.lastIndexOf("obj", m.index)), m.index);
    if (/\/Subtype\s*\/Image\b/.test(dict)) hayImagenes = true;

    let texto: string;
    try {
      texto = inflateSync(buf.subarray(ini, fin), { maxOutputLength: MAX_STREAM_BYTES }).toString("latin1");
    } catch {
      // Sin comprimir (o con otro filtro): solo sirve si parece texto de contenido.
      const crudo = s.slice(ini, fin);
      if (!/^\s*(q\s|BT\s|\d)/.test(crudo) && !/beginbf(char|range)/.test(crudo)) continue;
      texto = crudo;
    }
    total += texto.length;
    if (total > MAX_TOTAL_BYTES) {
      return { ok: false, error: "El PDF es demasiado grande para leerlo" };
    }

    // Flujo ToUnicode de una fuente CID: tabla código -> texto.
    if (texto.length < 400_000 && /beginbf(char|range)/.test(texto)) {
      const posObj = s.lastIndexOf("obj", m.index);
      const num = /(\d+)\s+\d+\s*$/.exec(s.slice(Math.max(0, posObj - 24), posObj));
      const cm = parsearCMap(texto);
      if (num && cm) cmapsPorObjeto.set(Number(num[1]), cm);
      continue;
    }

    // Flujo de objetos: se desempaqueta para poder leer sus fuentes y metadatos.
    if (/\/Type\s*\/ObjStm\b/.test(dict)) {
      const n = Number(/\/N\s+(\d+)/.exec(dict)?.[1] ?? 0);
      const primero = Number(/\/First\s+(\d+)/.exec(dict)?.[1] ?? 0);
      const cab = texto.slice(0, primero).trim().split(/\s+/).map(Number);
      for (let k = 0; k < n && 2 * k + 1 < cab.length; k++) {
        const num = cab[2 * k];
        const desde = primero + cab[2 * k + 1];
        const hasta = 2 * k + 3 < cab.length ? primero + cab[2 * k + 3] : texto.length;
        if (Number.isFinite(num) && Number.isFinite(desde)) objetos.set(num, texto.slice(desde, hasta));
      }
      continue;
    }

    if (/\bBT\b/.test(texto) && /\b(Tj|TJ)\b/.test(texto) && !texto.startsWith("\u0000")) {
      contenidos.push(texto);
    }
  }

  const hayCID =
    /\/Identity-H\b/.test(s) ||
    [...objetos.values()].some((c) => /\/Subtype\s*\/Type0\b|\/Identity-H\b/.test(c));

  if (contenidos.length === 0) {
    return {
      ok: false,
      error: hayImagenes
        ? "El PDF es una imagen escaneada y no tiene texto que se pueda leer. Usa el PDF original de la OC"
        : "El PDF no tiene texto que se pueda leer",
    };
  }

  const { porNombre: fuentes, cmapDe, anchos } = mapaDeFuentes(objetos);
  const cmaps = new Map<string, CMap>();
  for (const [nombre, obj] of cmapDe) {
    const cm = cmapsPorObjeto.get(obj);
    if (cm) cmaps.set(nombre, cm);
  }
  const paginas = contenidos.map((c) => ({ lineas: armarLineas(corridasDeStream(c, fuentes, cmaps, anchos)) }));
  if (paginas.every((p) => p.lineas.length === 0)) {
    return { ok: false, error: "El PDF no tiene texto que se pueda leer" };
  }
  // Con CMap ToUnicode el texto CID sí se pudo leer: el aviso solo vale si quedó sin traducir.
  const usaFuentesCID = hayCID && cmaps.size === 0;
  return { ok: true, paginas, creado: fechaDeCreacion([s, ...objetos.values()]), usaFuentesCID };
}
