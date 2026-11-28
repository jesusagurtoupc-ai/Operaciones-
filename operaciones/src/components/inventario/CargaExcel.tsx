"use client";

/**
 * Carga de equipos al inventario desde Excel (administradores). Se usa en la página Inventario y en el Panel
 * (botón «Cargar Excel»). También tiene los tipos del inventario y las funciones que comparten.
 */

import { useMemo, useState } from "react";
import { useConfirmarEnLinea } from "@/lib/client";
import { descargarExcelInventario } from "@/lib/importarExcel";
import { CAMPUS_PRINCIPAL } from "@/lib/shared";

export type Equipo = {
  codigo: string;
  sistema: string;
  tipo?: string;
  subtipo?: string;
  nombre: string;
  pabellon?: string;
  piso?: string;
  ubicacion: string;
  marca?: string;
  modelo?: string;
  serie?: string;
  capacidad?: string;
  anio?: number | null;
  base_anio?: string;
  confianza?: string;
  vida_util?: number | null;
  meses_uso?: number | null;
  meses_excedidos?: number | null;
  informe?: string;
  estado: string;
  observaciones?: string;
  alerta: string;
  fuentes: string[];
  cod_contable?: string;
  cod_barra?: string;
  estado_contable?: string;
  precio?: number | null;
  fecha_ingreso?: string | null;
  oc?: string;
  editado_por?: string;
  editado_en?: string;
  /** Fecha del último mantenimiento registrado en la app (YYYY-MM-DD). */
  ultimo_mant?: string;
};

export type Datos = {
  generado: string;
  corte: string;
  fuentes: string[];
  leidos: Record<string, number>;
  contable_total: number;
  contable_baja: number;
  contable_enlazados: number;
  repetidos: { codigo: string; se_conserva: string | null; motivo: string }[];
  equipos: Equipo[];
  motivo?: string;
};

export const ESTADOS: Record<string, string> = {
  OPERATIVO: "Operativo",
  "OPERATIVO CON OBSERVACION": "Con observación",
  INOPERATIVO: "Inoperativo",
  "": "Sin informe",
};
export const ESTADO_CODIGO: Record<string, string> = Object.fromEntries(Object.entries(ESTADOS).map(([k, v]) => [v, k]));
export const serieMala = (s?: string) => !s || /^(ilegible|-+|n\/?a|s\/?n|0)$/i.test(s.trim());
/** Informe del Excel de depreciados: corresponde al mantenimiento de noviembre de 2025. */
export const FECHA_INFORME_EXCEL = "2025-11-15";
export const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const compacto = (s: string) => sinTildes(s).toUpperCase().replace(/[^A-Z0-9]/g, "");

const BOTON =
  "border border-line-strong rounded-md px-4 py-2 text-sm font-medium bg-white hover:bg-concrete-dim disabled:opacity-50";
const TARJETA = "bg-white border border-line rounded-lg";

/**
 * Inventario actual del campus, igual que lo muestra la página Inventario: el guardado en la app; si nunca se
 * guardó, el archivo consolidado (solo el campus principal) o un inventario vacío.
 */
export async function cargarInventarioActual(campus: string | undefined): Promise<Datos> {
  const r = await fetch("/api/inventario", { cache: "no-cache" });
  if (r.ok) return r.json();
  if (r.status !== 404) throw new Error("No se pudo cargar el inventario.");
  if (campus && campus !== CAMPUS_PRINCIPAL) {
    return { generado: new Date().toISOString(), corte: new Date().toISOString().slice(0, 10), fuentes: [], leidos: {},
      contable_total: 0, contable_baja: 0, contable_enlazados: 0, repetidos: [], equipos: [] };
  }
  const a = await fetch("/inventario-equipos.json");
  if (!a.ok) throw new Error("No se pudo cargar el inventario.");
  return a.json();
}

/* ───────── Cargar inventario desde Excel ───────── */

/**
 * Nombres de columna que se reconocen (sin importar tildes, mayúsculas ni signos). El primero de cada lista
 * es el de «Descargar Excel» y la plantilla; los demás, los de otros Excel (inventarios de proveedores,
 * del área contable…).
 */
const COLUMNAS: Record<string, string[]> = {
  codigo: ["Código", "Cód. Equipo", "Codigo de equipo", "COD_ACTIVO", "Cod activo", "Cod", "Código del equipo", "Código patrimonial", "Código de activo",
    "Código de inventario", "Cod. inventario", "N° de inventario", "Nro inventario", "Código interno", "N° activo", "Activo fijo", "Placa", "Etiqueta"],
  sistema: ["Sistema"],
  tipo: ["Tipo", "Tipo equipo", "Tipo de equipo", "Tipo de equipo (Excel)", "Clase", "Categoría", "Familia"],
  subtipo: ["Subtipo", "Sub tipo"],
  nombre: ["Equipo", "Nombre equipo", "Nombre de equipo", "Nombre", "Descripción", "Equipos", "Nombre del equipo", "Descripción del equipo",
    "Descripción del bien", "Descripción del activo", "Denominación", "Activo", "Bien", "Artículo"],
  pabellon: ["Pabellón", "Edificio / Pabellón", "Edificio", "Torre", "Bloque"],
  piso: ["Piso", "Nivel"],
  ubicacion: ["Ubicación", "Ambiente", "Area", "Lugar", "Ubicación del equipo", "Área / ambiente", "Ubicación física", "Dependencia",
    "Oficina", "Aula", "Sala", "Local", "Ambiente / área", "Zona"],
  marca: ["Marca", "Fabricante"],
  modelo: ["Modelo", "Mod."],
  serie: ["N° Serie", "Serie", "Nro serie", "Numero de serie", "N° de serie", "Nº Serie", "No. Serie", "S/N", "Serial", "N/S", "Número de serie"],
  capacidad: ["Capacidad"],
  anio: ["Año", "Año de fabricación", "Año (fabricación o ingreso)"],
  vida_util: ["Vida útil (meses)"],
  meses_uso: ["Meses de uso", "Meses de uso al corte"],
  meses_excedidos: ["Meses excedidos"],
  estado: ["Estado", "Estado en mantenimiento"],
  alerta: ["Alerta", "Alerta del informe"],
  informe: ["Informe de mantenimiento"],
  observaciones: ["Observaciones", "Observaciones del mantenimiento"],
  precio: ["Precio S/ (contable)", "Precio", "Precio S/."],
  fecha_ingreso: ["Fecha de ingreso", "Fecha Ing."],
  ultimo_mant: ["Último mantenimiento"],
  fuentes: ["Fuentes"],
};
const normCab = (s: string) => sinTildes(String(s)).toUpperCase().replace(/[^A-Z0-9]/g, "");
/** Columnas de la plantilla (las mismas de «Descargar Excel», sin las calculadas). */
const PLANTILLA = ["Código", "Sistema", "Tipo", "Subtipo", "Equipo", "Pabellón", "Piso", "Ubicación", "Marca", "Modelo",
  "N° Serie", "Capacidad", "Año", "Vida útil (meses)", "Estado", "Alerta", "Informe de mantenimiento", "Observaciones"];

/** Nombres de sistema y de marca escritos de otra forma → los unificados del inventario. */
const SISTEMAS_ALIAS: Record<string, string> = {
  AAAGUAHELADA: "Agua helada", AGUAHELADA: "Agua helada", EDEEXPANSIONDIRECTA: "Expansión directa", EXPANSIONDIRECTA: "Expansión directa",
  VENTILACIONMECANICA: "Ventilación mecánica", EXTRACTORDEMONOXIDOYJETFAN: "Monóxido y jetfan", MONOXIDOYJETFAN: "Monóxido y jetfan",
  CORTINASDEAIRE: "Cortinas de aire", EQUIPODEPRESURIZACION: "Presurización", PRESURIZACION: "Presurización",
};
const MARCAS_ALIAS: Record<string, string> = { SP: "SOLER & PALAU", SOLE: "SOLER & PALAU", SOLERPALAU: "SOLER & PALAU", FIRSTCO: "FIRST CO.", MCQUAY: "MC QUAY" };
const normSistema = (v: string) => SISTEMAS_ALIAS[normCab(v)] ?? v.trim();
function normMarca(v: string): string {
  const t = v.trim().replace(/[ .]+$/, "").toUpperCase();
  if (!t || /^(ILEGIBLE|-+|N\/?A|S\/?N)$/.test(t)) return "";
  return MARCAS_ALIAS[normCab(t)] ?? t;
}
const sinValor = (v: string) => (/^(ILEGIBLE|-+|N\/?A|S\/?N|0)$/i.test(v.trim()) ? "" : v.trim());

function normPabellon(v: string): string {
  const m = /^(?:PAB(?:ELLON)?\.?\s*)?([A-Z])$/i.exec(sinTildes(v).trim());
  return m ? `Pabellón ${m[1].toUpperCase()}` : v.trim();
}
function normPiso(v: string): string {
  const t = sinTildes(v).toUpperCase().replace(/\s+/g, " ").trim();
  let m = /^(?:PISO\s*)?(\d{1,2})$/.exec(t);
  if (m) return `Piso ${Number(m[1])}`;
  m = /^(?:SOTANO|S)\s*-?\s*(\d)$/.exec(t);
  if (m) return `Sótano ${Number(m[1])}`;
  if (t.startsWith("AZOTEA")) return "Azotea";
  return v.trim();
}

/**
 * Equipos de una tabla (filas de un Excel, de una tabla de Word o de un PDF). La fila de encabezado es la
 * primera con una columna de código o de equipo, y una de ubicación. null si la tabla no es de equipos.
 */
export function equiposDeFilas(filas: unknown[][], fuente: string): { equipos: Equipo[]; repetidos: number; columnas: string[] } | null {
  const alias = Object.fromEntries(Object.entries(COLUMNAS).map(([k, v]) => [k, v.map(normCab)]));
  // Fila de encabezado: la primera que tiene una columna de código o de equipo, y una de ubicación.
  const exacto = (r: unknown[], k: string) => r.findIndex((c) => alias[k].includes(normCab(String(c))));
  // Si no está exacto: la celda empieza con un nombre de columna conocido de 5 letras o más («UBICACIÓN ACTUAL»),
  // en una columna que no sea ya de otro dato.
  const buscar = (r: unknown[], k: string) => {
    const i = exacto(r, k);
    if (i >= 0) return i;
    const ocupadas = new Set(Object.keys(COLUMNAS).filter((o) => o !== k).map((o) => exacto(r, o)));
    return r.findIndex((c, j) => !ocupadas.has(j) && alias[k].some((a) => a.length >= 5 && normCab(String(c)).startsWith(a) && normCab(String(c)).length <= a.length + 14));
  };
  // Encabezado: una columna de código o de equipo, y además ubicación, serie, modelo o (con código) marca.
  const iCab = filas.findIndex((r) => {
    const cod = buscar(r, "codigo") >= 0;
    if (!cod && buscar(r, "nombre") < 0) return false;
    return buscar(r, "ubicacion") >= 0 || buscar(r, "serie") >= 0 || buscar(r, "modelo") >= 0 || (cod && buscar(r, "marca") >= 0);
  });
  if (iCab < 0) return null;
  const idx: Record<string, number> = Object.fromEntries(Object.keys(COLUMNAS).map((k) => [k, buscar(filas[iCab], k)]));
  // «Nombre» o «Descripción» con solo un lugar (p. ej. una lista de personas por área) no es un inventario:
  // hace falta algún dato propio de equipos.
  const generico = idx.codigo < 0 && ["NOMBRE", "DESCRIPCION"].includes(normCab(String(filas[iCab][idx.nombre] ?? "")));
  if (generico && !["marca", "modelo", "serie", "tipo", "subtipo", "sistema", "capacidad", "anio", "estado"].some((k) => idx[k] >= 0)) return null;
  const txt = (r: unknown[], k: string) => {
    const v = idx[k] >= 0 ? r[idx[k]] : "";
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v ?? "").replace(/\s+/g, " ").trim();
  };
  const largo = (r: unknown[], k: string) => (idx[k] >= 0 ? String(r[idx[k]] ?? "").trim() : "");
  const num = (r: unknown[], k: string) => {
    const v = txt(r, k).replace(",", ".");
    return v && !Number.isNaN(Number(v)) ? Number(v) : null;
  };
  const fechaDe = (r: unknown[], k: string) => (/^\d{4}-\d{2}-\d{2}/.test(txt(r, k)) ? txt(r, k).slice(0, 10) : null);
  const equipos: Equipo[] = [];
  const vistos = new Set<string>();
  let repetidos = 0;
  for (const r of filas.slice(iCab + 1)) {
    let codigo = txt(r, "codigo");
    if (/^\d{1,8}$/.test(codigo)) codigo = codigo.padStart(8, "0"); // 7674 → 00007674 (Excel quita los ceros)
    const nombre = txt(r, "nombre");
    const ubicacion = txt(r, "ubicacion");
    if (!codigo && !nombre && !ubicacion) continue;
    const serie = txt(r, "serie");
    const llaveSerie = serieMala(serie) ? "" : `${compacto(serie)}|${txt(r, "marca").toUpperCase()}|${txt(r, "modelo").toUpperCase()}`;
    // Repetido dentro del Excel: el mismo código, o una fila SIN código igual a otra.
    const llave = codigo ? `c:${codigo}` : `u:${compacto(nombre + ubicacion + serie)}`;
    if (vistos.has(llave) || (!codigo && llaveSerie && vistos.has(`s:${llaveSerie}`))) {
      repetidos++;
      continue;
    }
    vistos.add(llave);
    if (llaveSerie) vistos.add(`s:${llaveSerie}`);
    const estadoTxt = txt(r, "estado");
    const um = fechaDe(r, "ultimo_mant");
    equipos.push({
      codigo, nombre, ubicacion, serie: sinValor(serie),
      sistema: normSistema(txt(r, "sistema")), tipo: txt(r, "tipo"), subtipo: txt(r, "subtipo"),
      pabellon: normPabellon(txt(r, "pabellon")), piso: normPiso(txt(r, "piso")), marca: normMarca(txt(r, "marca")), modelo: sinValor(txt(r, "modelo")),
      capacidad: txt(r, "capacidad"), anio: num(r, "anio"), vida_util: num(r, "vida_util"),
      meses_uso: num(r, "meses_uso"), meses_excedidos: num(r, "meses_excedidos"),
      estado: ESTADO_CODIGO[estadoTxt] ?? (estadoTxt ? sinTildes(estadoTxt).toUpperCase() : ""),
      alerta: txt(r, "alerta"), informe: txt(r, "informe"),
      observaciones: largo(r, "observaciones").replace(/ · /g, "\n"), precio: num(r, "precio"),
      fecha_ingreso: fechaDe(r, "fecha_ingreso"),
      ...(um && um !== FECHA_INFORME_EXCEL ? { ultimo_mant: um } : {}),
      fuentes: txt(r, "fuentes") ? txt(r, "fuentes").split(/,\s*/) : [fuente],
    });
  }
  const columnas = Object.keys(COLUMNAS).filter((k) => idx[k] >= 0).map((k) => COLUMNAS[k][0]);
  return { equipos, repetidos, columnas };
}

/**
 * Cargar inventario (administradores): la plantilla para llenar a mano y la carga de archivos o de una
 * carpeta completa (ver CargarCarpeta). Se reconocen columnas con otros nombres (ver COLUMNAS) y pabellón
 * y piso escritos de otra forma. Solo se agregan los equipos que no están en el inventario.
 */
export function SubirExcel({ actual, alGuardar }: { actual: Datos; alGuardar: (d: Datos) => void }) {
  function plantilla() {
    descargarExcelInventario(
      PLANTILLA.map((t) => ({ titulo: t, ancho: t === "Observaciones" ? 50 : t === "Ubicación" || t === "Equipo" ? 28 : 16 })),
      [["00099001", "Bombas", "Sumergible", "Desagüe", "ELECTROBOMBA SUMERGIBLE 1", "Pabellón B", "Sótano 3", "POZO SÉPTICO",
        "PEDROLLO", "VXm 10/35", "SN-12345", "1 HP", 2019, 120, "Operativo", "", "", "Fila de ejemplo: bórrala y escribe tus equipos"]],
      { titulo: "PLANTILLA – CARGA DE EQUIPOS AL INVENTARIO", detalle: "Código, Equipo y Ubicación son los datos clave. Estado: Operativo, Con observación, Inoperativo o vacío." },
      "plantilla-inventario"
    );
  }
  return (
    <section id="cargar-inventario" className={`${TARJETA} px-4 py-3 scroll-mt-40`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-sm">Cargar equipos</h2>
          <p className="text-xs text-ink-soft mt-0.5 max-w-2xl">
            Sirve la plantilla, el Excel de «Descargar Excel» u otro inventario: se reconocen columnas como Código / Cód. Equipo / N° de
            inventario, Equipo / Descripción, Ubicación / Ambiente / Oficina, Pabellón, Piso, Marca, Modelo, Serie, Sistema, Tipo, Estado y
            Observaciones, aunque estén escritas de otra forma. Los equipos que ya están en el inventario no se vuelven a agregar.
          </p>
        </div>
        <button type="button" onClick={plantilla} className={BOTON}>Descargar plantilla</button>
      </div>
      <CargarCarpeta actual={actual} alGuardar={alGuardar} />
    </section>
  );
}

/* ───────── Cargar una carpeta completa ───────── */

const MAX_PDF = 4 * 1024 * 1024; // lo que acepta el servidor por pedido: los PDF más grandes se parten
const MAX_ARCHIVO = 150 * 1024 * 1024;

type Tabla = { nombre: string; filas: unknown[][] };
/** Lo que se pudo sacar de un archivo: sus tablas y su texto, línea por línea. */
type Contenido = { tablas: Tabla[]; lineas: string[]; nota?: string };
type Archivo = { ruta: string; nombre: string; tam: number; datos: () => Promise<ArrayBuffer> };

type ResultadoArchivo = {
  carpeta: string;
  ruta: string;
  estado: "ok" | "sin" | "omitido" | "error";
  detalle: string;
  lineas: number;
  equipos: Equipo[];
  incluir: boolean;
};

const ext = (n: string) => (/\.([a-z0-9]+)$/i.exec(n)?.[1] ?? "").toLowerCase();
const HOJAS = new Set(["xlsx", "xlsm", "xlsb", "xls", "xltx", "xltm", "ods", "fods", "csv", "tsv", "dif", "sylk", "slk", "dbf", "prn", "numbers"]);
const TEXTO = new Set(["txt", "md", "log", "json", "xml", "ini", "cfg", "yaml", "yml", "sql", "tex", "vcf"]);
const HTML = new Set(["htm", "html", "xhtml", "mht", "mhtml"]);
const SIN_TEXTO: Record<string, string> = {
  imagen: "png jpg jpeg gif webp heic heif bmp tif tiff svg ico",
  "plano de AutoCAD o 3D": "dwg dxf dwf rvt skp ifc nwd step stp",
  video: "mp4 mov avi mkv wmv webm 3gp",
  audio: "mp3 wav m4a ogg aac wma opus",
  programa: "exe msi dll bat cmd apk dmg iso",
};
const tipoSinTexto = (e: string) => Object.entries(SIN_TEXTO).find(([, v]) => v.split(" ").includes(e))?.[0] ?? null;

/** Entradas de un archivo comprimido (.zip, .docx, .pptx, .odt…) con su contenido bajo demanda. */
async function leerZip(buf: ArrayBuffer): Promise<Map<string, () => Promise<Uint8Array>>> {
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let fin = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error("no es un archivo comprimido válido");
  const n = v.getUint16(fin + 10, true);
  let p = v.getUint32(fin + 16, true);
  const out = new Map<string, () => Promise<Uint8Array>>();
  for (let k = 0; k < n && p + 46 <= buf.byteLength && v.getUint32(p, true) === 0x02014b50; k++) {
    const metodo = v.getUint16(p + 10, true);
    const tam = v.getUint32(p + 20, true);
    const largoNombre = v.getUint16(p + 28, true);
    const largoExtra = v.getUint16(p + 30, true);
    const largoComent = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const utf8 = (v.getUint16(p + 8, true) & 0x800) !== 0;
    const bytesNombre = u8.subarray(p + 46, p + 46 + largoNombre);
    const nombre = utf8 ? new TextDecoder().decode(bytesNombre) : new TextDecoder("windows-1252").decode(bytesNombre);
    out.set(nombre, async () => {
      const ini = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const datos = u8.slice(ini, ini + tam);
      if (metodo === 0) return datos;
      if (metodo !== 8) throw new Error("compresión no soportada");
      const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(flujo).arrayBuffer());
    });
    p += 46 + largoNombre + largoExtra + largoComent;
  }
  return out;
}

const xmlDe = async (zip: Map<string, () => Promise<Uint8Array>>, nombre: string) => {
  const f = zip.get(nombre);
  return f ? new DOMParser().parseFromString(new TextDecoder().decode(await f()), "application/xml") : null;
};
const textoNodo = (n: Element, ns: string, etiqueta: string) =>
  [...n.getElementsByTagNameNS(ns, etiqueta)].map((x) => x.textContent ?? "").join("").replace(/\s+/g, " ").trim();

/** Cada fila de una tabla también como línea («Marca» | «YORK» → «Marca\tYORK»), para leer fichas en tablas de dos columnas. */
const filasComoLineas = (tablas: Tabla[]) => tablas.flatMap((t) => t.filas.map((r) => r.map((c) => String(c ?? "").trim()).filter(Boolean).join("\t")));

/** Word (.docx): tablas y párrafos. */
async function contenidoWord(buf: ArrayBuffer): Promise<Contenido> {
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const zip = await leerZip(buf);
  const tablas: Tabla[] = [];
  const lineas: string[] = [];
  for (const parte of [...zip.keys()].filter((k) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(k))) {
    const xml = await xmlDe(zip, parte);
    if (!xml) continue;
    [...xml.getElementsByTagNameNS(W, "tbl")].forEach((t, k) =>
      tablas.push({
        nombre: `tabla ${tablas.length + k + 1}`,
        filas: [...t.getElementsByTagNameNS(W, "tr")].map((tr) => [...tr.getElementsByTagNameNS(W, "tc")].map((tc) => textoNodo(tc, W, "t"))),
      })
    );
    for (const p of xml.getElementsByTagNameNS(W, "p")) {
      // Párrafos con tabulaciones: cada tramo por separado («Marca:\tYORK»).
      const t = [...p.getElementsByTagNameNS(W, "*")]
        .map((x) => (x.localName === "t" ? x.textContent ?? "" : x.localName === "tab" ? "\t" : x.localName === "br" ? "\n" : ""))
        .join("");
      lineas.push(...t.split("\n"));
    }
  }
  return { tablas, lineas: [...lineas, ...filasComoLineas(tablas)] };
}

/** PowerPoint (.pptx): tablas y textos de cada diapositiva. */
async function contenidoPowerPoint(buf: ArrayBuffer): Promise<Contenido> {
  const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const zip = await leerZip(buf);
  const tablas: Tabla[] = [];
  const lineas: string[] = [];
  const diapos = [...zip.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]));
  for (const d of diapos) {
    const xml = await xmlDe(zip, d);
    if (!xml) continue;
    for (const t of xml.getElementsByTagNameNS(A, "tbl"))
      tablas.push({ nombre: `${d.replace(/^ppt\/slides\/|\.xml$/g, "")}`, filas: [...t.getElementsByTagNameNS(A, "tr")].map((tr) => [...tr.getElementsByTagNameNS(A, "tc")].map((tc) => textoNodo(tc, A, "t"))) });
    for (const p of xml.getElementsByTagNameNS(A, "p")) lineas.push(textoNodo(p, A, "t"));
  }
  return { tablas, lineas: [...lineas, ...filasComoLineas(tablas)] };
}

/** OpenDocument de texto o presentación (.odt, .odp): tablas y párrafos. */
async function contenidoOpenDocument(buf: ArrayBuffer): Promise<Contenido> {
  const T = "urn:oasis:names:tc:opendocument:xmlns:table:1.0";
  const X = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
  const xml = await xmlDe(await leerZip(buf), "content.xml");
  if (!xml) return { tablas: [], lineas: [] };
  const tablas = [...xml.getElementsByTagNameNS(T, "table")].map((t, k) => ({
    nombre: t.getAttributeNS(T, "name") || `tabla ${k + 1}`,
    filas: [...t.getElementsByTagNameNS(T, "table-row")].map((r) => [...r.getElementsByTagNameNS(T, "table-cell")].map((c) => (c.textContent ?? "").trim())),
  }));
  const lineas = [...xml.getElementsByTagNameNS(X, "p"), ...xml.getElementsByTagNameNS(X, "h")].map((p) => p.textContent ?? "");
  return { tablas, lineas: [...lineas, ...filasComoLineas(tablas)] };
}

/** Texto de un documento RTF (sin formato). */
function textoRtf(t: string): string[] {
  return t
    .replace(/\\par[d]?|\\line|\\row/g, "\n")
    .replace(/\\cell/g, "\t")
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode((Number(n) + 65536) % 65536))
    .replace(/\{\\\*[^{}]*\}|\\[a-z]+-?\d* ?|[{}]/gi, "")
    .split("\n");
}

/** Correo (.eml): el cuerpo en texto (y el HTML sin etiquetas). */
function textoCorreo(t: string): string[] {
  const qp = (x: string) => x.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return qp(t)
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "")
    .replace(/<(br|\/p|\/tr|\/div|\/li)[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .split(/\r?\n/);
}

/**
 * Formatos binarios antiguos sin un lector propio (.doc, .ppt, .msg, .pub…): se recuperan los textos que
 * guardan (en UTF-16 y en 8 bits). En Word antiguo, el carácter 7 separa las celdas de una tabla.
 */
function textoDeBinario(buf: ArrayBuffer): Contenido {
  const u8 = new Uint8Array(buf);
  const trozos: string[] = [];
  let actual = "";
  const vale = (c: number) => c === 7 || c === 9 || c === 13 || (c >= 32 && c < 0xfffe && !(c >= 0x7f && c < 0xa0));
  for (let i = 0; i + 1 < u8.length; i += 2) {
    const c = u8[i] | (u8[i + 1] << 8);
    if (vale(c)) actual += String.fromCharCode(c);
    else {
      if (actual.replace(/[\x07\t\r ]/g, "").length >= 4) trozos.push(actual);
      actual = "";
    }
  }
  if (actual.length >= 4) trozos.push(actual);
  let ascii = "";
  for (const b of u8) {
    if (b === 7 || b === 9 || b === 13 || (b >= 32 && b < 127) || b >= 0xc0) ascii += String.fromCharCode(b);
    else {
      if (ascii.replace(/[\x07\t\r ]/g, "").length >= 6) trozos.push(ascii);
      ascii = "";
    }
  }
  const lineas: string[] = [];
  const filas: string[][] = [];
  for (const t of trozos)
    for (const l of t.split("\r")) {
      if (l.includes("\x07")) filas.push(l.split("\x07").map((x) => x.trim()).filter((x, k, a) => x || k < a.length - 1));
      else lineas.push(l);
    }
  return { tablas: filas.length ? [{ nombre: "tablas", filas }] : [], lineas, nota: "lectura aproximada (formato antiguo)" };
}

/** PDF: el servidor da cada línea con la posición de sus trozos; las columnas salen del encabezado. */
async function contenidoPdf(buf: ArrayBuffer, nombre: string): Promise<Contenido> {
  // Los PDF de más de 4 MB se parten por páginas en el navegador y se leen por partes.
  const partes: Blob[] = [];
  if (buf.byteLength <= MAX_PDF) partes.push(new Blob([buf], { type: "application/pdf" }));
  else {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const total = doc.getPageCount();
    let porParte = Math.max(1, Math.floor((total * (MAX_PDF * 0.8)) / buf.byteLength));
    for (let ini = 0; ini < total; ) {
      const fin = Math.min(total, ini + porParte);
      const nuevo = await PDFDocument.create();
      (await nuevo.copyPages(doc, Array.from({ length: fin - ini }, (_, k) => ini + k))).forEach((pg) => nuevo.addPage(pg));
      const bytes = await nuevo.save();
      if (bytes.byteLength > MAX_PDF && fin - ini > 1) {
        porParte = Math.max(1, Math.floor((fin - ini) / 2));
        continue;
      }
      if (bytes.byteLength > MAX_PDF) throw new Error(`la página ${ini + 1} pesa más de 4 MB`);
      partes.push(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      ini = fin;
    }
  }
  const paginas: { x: number; t: string }[][][] = [];
  let cid = false;
  for (const parte of partes) {
    const fd = new FormData();
    fd.append("file", parte, nombre);
    const r = await fetch("/api/documentos/leer?filas=1", { method: "POST", body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d?.error || "no se pudo leer el PDF");
    paginas.push(...((d.data?.paginas ?? []) as { x: number; t: string }[][][]));
    cid ||= !!d.data?.fuentesCID;
  }
  const alias = new Set(Object.values(COLUMNAS).flat().map(normCab));
  const esCabecera = (l: { t: string }[]) => {
    const n = l.filter((c) => alias.has(normCab(c.t))).length;
    return n >= 3 || (n >= 2 && l.length <= 4);
  };
  const filas: string[][] = [];
  const lineas: string[] = [];
  let cols: number[] | null = null;
  for (const pg of paginas) {
    for (const l of pg) {
      lineas.push(l.map((c) => c.t).join("\t"));
      if (esCabecera(l)) {
        cols = l.map((c) => c.x);
        if (filas.length === 0) filas.push(l.map((c) => c.t));
        continue;
      }
      if (!cols) continue;
      const fila = new Array(cols.length).fill("");
      for (const c of l) {
        let k = 0;
        for (let i = 0; i < cols.length; i++) if (cols[i] <= c.x + 6) k = i;
        fila[k] = fila[k] ? `${fila[k]} ${c.t}` : c.t;
      }
      filas.push(fila);
    }
  }
  if (paginas.length === 0 || lineas.every((l) => !l.trim())) throw new Error("el PDF no tiene texto (puede ser escaneado)");
  return { tablas: filas.length ? [{ nombre: "", filas }] : [], lineas, nota: cid ? "algunas letras del PDF pueden leerse mal" : undefined };
}

/** Tablas y líneas de un archivo, según su tipo. null = no tiene texto que leer (imagen, video…). */
async function contenidoDe(a: Archivo): Promise<Contenido | null> {
  const e = ext(a.nombre);
  if (tipoSinTexto(e)) return null;
  const buf = await a.datos();
  if (HOJAS.has(e) || HTML.has(e)) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const tablas = wb.SheetNames.map((h) => ({ nombre: h, filas: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[h], { header: 1, defval: "" }) }));
    // Cada fila también como línea: así se leen las fichas hechas en Excel («Marca» | «YORK»).
    return { tablas, lineas: filasComoLineas(tablas.map((t) => ({ ...t, filas: t.filas.map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : c))) }))) };
  }
  if (e === "docx" || e === "docm" || e === "dotx") return contenidoWord(buf);
  if (e === "pptx" || e === "pptm" || e === "ppsx") return contenidoPowerPoint(buf);
  if (e === "odt" || e === "odp") return contenidoOpenDocument(buf);
  if (e === "pdf") return contenidoPdf(buf, a.nombre);
  const texto = () => {
    const u8 = new Uint8Array(buf);
    const utf16 = (u8[0] === 0xff && u8[1] === 0xfe) || (u8[0] === 0xfe && u8[1] === 0xff);
    const t = new TextDecoder(utf16 ? (u8[0] === 0xff ? "utf-16le" : "utf-16be") : "utf-8").decode(u8);
    return t.includes("�") && !utf16 ? new TextDecoder("windows-1252").decode(u8) : t;
  };
  if (e === "rtf") return { tablas: [], lineas: textoRtf(texto()) };
  if (e === "eml" || e === "mht") return { tablas: [], lineas: textoCorreo(texto()) };
  if (TEXTO.has(e)) return { tablas: [], lineas: texto().split(/\r?\n/) };
  // Cualquier otro: si parece texto, línea por línea; si no, los textos que guarde por dentro.
  const muestra = new Uint8Array(buf.slice(0, 4096));
  const binario = muestra.some((b) => b === 0) || muestra.filter((b) => b < 9 || (b > 13 && b < 32)).length > muestra.length * 0.05;
  return binario ? textoDeBinario(buf) : { tablas: [], lineas: texto().split(/\r?\n/) };
}

/** Etiquetas de una ficha de equipo («Marca: YORK», «N° de serie: …») → la columna que corresponde. */
const ETIQUETAS: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [k, v] of Object.entries(COLUMNAS)) for (const a of v) m[normCab(a)] = k;
  Object.assign(m, {
    CODIGODELEQUIPO: "codigo", CODIGOEQUIPO: "codigo", CODEQUIPO: "codigo", CODIGOPATRIMONIAL: "codigo", CODIGODEACTIVO: "codigo",
    EQUIPO: "nombre", NOMBREDELEQUIPO: "nombre", DESCRIPCIONDELEQUIPO: "nombre",
    UBICACIONDELEQUIPO: "ubicacion", AMBIENTE: "ubicacion", LOCAL: "ubicacion", AREA: "ubicacion",
    NSERIE: "serie", NDESERIE: "serie", NUMERODESERIE: "serie", NRODESERIE: "serie", SERIAL: "serie", SN: "serie",
    MARCA: "marca", MODELO: "modelo", CAPACIDAD: "capacidad", PABELLON: "pabellon", PISO: "piso", NIVEL: "piso",
    TIPODEEQUIPO: "tipo", SISTEMA: "sistema", ESTADO: "estado", ESTADODELEQUIPO: "estado", ANODEFABRICACION: "anio",
  });
  return m;
})();

/**
 * Equipos escritos como fichas, línea por línea: «Equipo: UC SPLIT · Marca: YORK · Serie: …». Cada línea
 * se parte en tramos (por tabulación, «|», «;» o dos espacios) y cada tramo «etiqueta: valor» (o una celda
 * con la etiqueta y la siguiente con el valor) llena un dato; cuando un dato se repite empieza otro equipo.
 */
function equiposDeLineas(lineas: string[], fuente: string): Equipo[] {
  const registros: Record<string, string>[] = [];
  let actual: Record<string, string> = {};
  let generico = false; // el nombre vino de «Nombre:» o «Descripción:» (puede ser una persona o una tarea)
  const cerrar = () => {
    const propio = actual.codigo || actual.marca || actual.serie || actual.modelo;
    if ((actual.codigo || actual.nombre) && (propio || (actual.ubicacion && !generico))) registros.push(actual);
    actual = {};
    generico = false;
  };
  for (const linea of lineas) {
    const tramos = linea.split(/\t|\s{2,}|\s\|\s|;\s/).map((x) => x.trim()).filter(Boolean);
    for (let i = 0; i < tramos.length; i++) {
      let clave = "";
      let valor = "";
      let etiqueta = "";
      const m = /^([^:=]{2,40}?)\s*[:=]\s*(.*)$/.exec(tramos[i]);
      if (m && ETIQUETAS[normCab(m[1])]) {
        etiqueta = m[1];
        clave = ETIQUETAS[normCab(m[1])];
        valor = m[2].trim();
        if (!valor && tramos[i + 1] && !ETIQUETAS[normCab(tramos[i + 1].replace(/:.*$/, ""))]) valor = tramos[++i];
      } else if (ETIQUETAS[normCab(tramos[i])] && tramos[i + 1] && !ETIQUETAS[normCab(tramos[i + 1].replace(/:.*$/, ""))]) {
        // Tabla de dos columnas: «Marca» | «YORK».
        etiqueta = tramos[i];
        clave = ETIQUETAS[normCab(tramos[i])];
        valor = tramos[++i];
      }
      if (!clave || !valor || valor.length > 120) continue;
      if (actual[clave]) cerrar();
      actual[clave] = valor;
      if (clave === "nombre") generico = ["NOMBRE", "DESCRIPCION"].includes(normCab(etiqueta));
    }
  }
  cerrar();
  if (!registros.length) return [];
  const claves = Object.keys(COLUMNAS);
  const filas: unknown[][] = [claves.map((k) => COLUMNAS[k][0]), ...registros.map((r) => claves.map((k) => r[k] ?? ""))];
  return equiposDeFilas(filas, fuente)?.equipos ?? [];
}

/** Archivos de un .zip como si fueran una subcarpeta más. */
async function archivosDeZip(a: Archivo): Promise<Archivo[]> {
  const zip = await leerZip(await a.datos());
  return [...zip.entries()]
    .filter(([n]) => !n.endsWith("/"))
    .map(([n, f]) => ({
      ruta: `${a.ruta}/${n}`,
      nombre: n.split("/").pop() ?? n,
      tam: 0,
      datos: async () => {
        const u = await f();
        return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
      },
    }));
}

/**
 * Cargar una carpeta: entra carpeta por carpeta (subcarpetas y archivos .zip incluidos) y lee cada archivo
 * de cualquier tipo, línea por línea: tablas (Excel y similares —todas las hojas—, CSV, Word, PowerPoint,
 * OpenDocument, PDF, HTML) y fichas escritas como texto. Todo archivo queda en el resumen con lo que se
 * encontró o por qué no se pudo leer. Solo se agregan los equipos que no están en el inventario (mismo
 * código; o, sin código, misma serie+marca+modelo o mismo equipo y ubicación) ni se repiten entre archivos.
 */
export function CargarCarpeta({ actual, alGuardar }: { actual: Datos; alGuardar: (d: Datos) => void }) {
  const [resultados, setResultados] = useState<ResultadoArchivo[] | null>(null);
  const [progreso, setProgreso] = useState<{ i: number; n: number; carpeta: string; ruta: string } | null>(null);
  const [carpeta, setCarpeta] = useState("");
  const [msg, setMsg] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [verTodos, setVerTodos] = useState(false);
  // Qué hacer con lo leído: se pregunta apenas termina la lectura.
  const [modo, setModo] = useState<"agregar" | "reemplazar" | null>(null);
  const confirmar = useConfirmarEnLinea();

  async function leerCarpeta(lista: FileList) {
    setMsg("");
    setResultados(null);
    setModo(null);
    const ruta = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const archivos: Archivo[] = [...lista].map((f) => ({ ruta: ruta(f), nombre: f.name, tam: f.size, datos: () => f.arrayBuffer() }));
    if (!archivos.length) {
      setMsg("La carpeta está vacía.");
      return;
    }
    setCarpeta(archivos[0].ruta.includes("/") ? archivos[0].ruta.split("/")[0] : `${archivos.length} archivo(s) seleccionado(s)`);
    // Carpeta por carpeta: primero los archivos de la carpeta principal, luego cada subcarpeta en orden.
    const dir = (r: string) => r.split("/").slice(0, -1).join("/");
    const cola = [...archivos].sort((a, b) => dir(a.ruta).localeCompare(dir(b.ruta), "es", { numeric: true }) || a.ruta.localeCompare(b.ruta, "es", { numeric: true }));
    const out: ResultadoArchivo[] = [];
    for (let i = 0; i < cola.length; i++) {
      const a = cola[i];
      const carpetaA = dir(a.ruta);
      setProgreso({ i: i + 1, n: cola.length, carpeta: carpetaA, ruta: a.ruta });
      const r: ResultadoArchivo = { carpeta: carpetaA, ruta: a.ruta, estado: "sin", detalle: "", lineas: 0, equipos: [], incluir: true };
      out.push(r);
      const e = ext(a.nombre);
      try {
        if (/^~\$/.test(a.nombre)) {
          r.estado = "omitido";
          r.detalle = "archivo temporal de Office (se crea al tener abierto el documento)";
          continue;
        }
        if (a.tam > MAX_ARCHIVO) {
          r.estado = "omitido";
          r.detalle = "pesa más de 150 MB";
          continue;
        }
        if (e === "zip") {
          // El .zip se abre y sus archivos entran a la cola como una subcarpeta más.
          const dentro = await archivosDeZip(a);
          cola.splice(i + 1, 0, ...dentro);
          r.estado = "omitido";
          r.detalle = `comprimido: ${dentro.length} archivo(s) adentro, revisados abajo`;
          continue;
        }
        if (/^(rar|7z|tar|gz)$/.test(e)) {
          r.estado = "omitido";
          r.detalle = `comprimido .${e}: descomprímelo en la carpeta para revisarlo`;
          continue;
        }
        const c = await contenidoDe(a);
        if (!c) {
          r.estado = "omitido";
          r.detalle = `${tipoSinTexto(e)}: no contiene texto que leer`;
          continue;
        }
        r.lineas = c.lineas.filter((l) => l.trim()).length + c.tablas.reduce((s, t) => s + t.filas.length, 0);
        const vistos = new Set<string>();
        const agregar = (lista: Equipo[]) => {
          for (const eq of lista) {
            const k = eq.codigo ? `c:${eq.codigo}` : `u:${compacto(eq.nombre + eq.ubicacion + (eq.serie ?? ""))}`;
            if (vistos.has(k)) continue;
            vistos.add(k);
            r.equipos.push(eq);
          }
        };
        // Hojas o tablas con datos cuyas columnas no se reconocieron: se muestran sus encabezados para corregirlos.
        const sinColumnas: string[] = [];
        for (const t of c.tablas) {
          const eqs = equiposDeFilas(t.filas, t.nombre ? `${a.ruta} › ${t.nombre}` : a.ruta)?.equipos ?? [];
          agregar(eqs);
          const llenas = t.filas.filter((f) => f.some((x) => String(x ?? "").trim()));
          if (!eqs.length && llenas.length >= 2) {
            const cab = (llenas.find((f) => f.filter((x) => String(x ?? "").trim()).length >= 2) ?? llenas[0])
              .map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 6);
            sinColumnas.push(`${t.nombre || "tabla"} (${cab.join(", ")}${cab.length === 6 ? "…" : ""})`);
          }
        }
        agregar(equiposDeLineas(c.lineas, a.ruta));
        if (r.equipos.length) {
          r.estado = "ok";
          r.detalle = `${r.equipos.length} equipo${r.equipos.length === 1 ? "" : "s"} · ${r.lineas} línea(s) leída(s)${c.nota ? ` · ${c.nota}` : ""}`;
        } else {
          r.detalle = `${r.lineas} línea(s) leída(s), ningún equipo${c.nota ? ` · ${c.nota}` : ""}`;
        }
        if (sinColumnas.length) {
          r.detalle += ` · sin columna de equipo o código reconocida en: ${sinColumnas.slice(0, 4).join("; ")}${sinColumnas.length > 4 ? ` y ${sinColumnas.length - 4} más` : ""}`;
        }
      } catch (err) {
        r.estado = "error";
        r.detalle = err instanceof Error ? err.message : "no se pudo leer";
      }
    }
    setProgreso(null);
    setResultados(out);
  }

  // Equipos nuevos: ni en el inventario ni repetidos entre los archivos elegidos.
  const calculo = useMemo(() => {
    if (!resultados) return null;
    const llaveS = (e: Equipo) => (serieMala(e.serie) ? "" : `${compacto(e.serie ?? "")}|${(e.marca ?? "").toUpperCase()}|${(e.modelo ?? "").toUpperCase()}`);
    const llaveU = (e: Equipo) => compacto(e.nombre + e.ubicacion + (e.serie ?? ""));
    const codigosInv = new Set(actual.equipos.map((e) => e.codigo).filter(Boolean));
    const seriesInv = new Set(actual.equipos.map(llaveS).filter(Boolean));
    const nombresInv = new Set(actual.equipos.map(llaveU));
    const codigos = new Set<string>();
    const series = new Set<string>();
    const nombres = new Set<string>();
    const nuevos: Equipo[] = [];
    // Para reemplazar: todos los equipos de los archivos, sin repetir entre ellos.
    const unicos: Equipo[] = [];
    let enInventario = 0;
    let entreArchivos = 0;
    let total = 0;
    for (const r of resultados) {
      if (!r.incluir) continue;
      for (const e of r.equipos) {
        total++;
        const s = llaveS(e);
        const u = llaveU(e);
        if (e.codigo ? codigos.has(e.codigo) : (s && series.has(s)) || nombres.has(u)) {
          entreArchivos++;
          continue;
        }
        if (e.codigo) codigos.add(e.codigo);
        if (s) series.add(s);
        nombres.add(u);
        const eq = { ...e, sistema: e.sistema || "Sin dato" };
        unicos.push(eq);
        if (e.codigo ? codigosInv.has(e.codigo) : (s && seriesInv.has(s)) || nombresInv.has(u)) enInventario++;
        else nuevos.push(eq);
      }
    }
    return { nuevos, unicos, enInventario, entreArchivos, total };
  }, [resultados, actual]);

  async function guardar(como: "agregar" | "reemplazar") {
    if (!calculo) return;
    const lista = como === "agregar" ? calculo.nuevos : calculo.unicos;
    if (!lista.length) return;
    setGuardando(true);
    const usados = (resultados ?? []).filter((r) => r.incluir && r.estado === "ok");
    const hoy = new Date().toISOString().slice(0, 10);
    const datos: Datos =
      como === "agregar"
        ? {
            ...actual,
            equipos: [...actual.equipos, ...calculo.nuevos],
            motivo: `Agregado desde «${carpeta}»: ${calculo.nuevos.length} equipo(s) nuevo(s) de ${usados.length} archivo(s)`,
          }
        : {
            generado: hoy,
            corte: hoy,
            fuentes: usados.map((r) => r.ruta),
            leidos: Object.fromEntries(usados.map((r) => [r.ruta, r.equipos.length])),
            contable_total: 0,
            contable_baja: 0,
            contable_enlazados: 0,
            repetidos: [],
            equipos: calculo.unicos,
            motivo: `Reemplazado por «${carpeta}»: ${calculo.unicos.length} equipo(s) de ${usados.length} archivo(s)`,
          };
    const r = await fetch("/api/inventario", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos) });
    setGuardando(false);
    if (!r.ok) {
      setMsg((await r.json().catch(() => ({}))).error || "No se pudo guardar.");
      return;
    }
    alGuardar(datos);
    setResultados(null);
    setModo(null);
    setMsg(
      como === "agregar"
        ? `✓ Agregados ${calculo.nuevos.length} equipo(s) nuevos desde «${carpeta}»`
        : `✓ Inventario reemplazado: ahora tiene ${calculo.unicos.length} equipo(s) de «${carpeta}» (antes ${actual.equipos.length})`,
    );
  }

  const porCarpeta = useMemo(() => {
    const m = new Map<string, ResultadoArchivo[]>();
    for (const r of resultados ?? []) m.set(r.carpeta, [...(m.get(r.carpeta) ?? []), r]);
    return [...m.entries()];
  }, [resultados]);
  const vista = calculo ? (modo === "reemplazar" ? calculo.unicos : calculo.nuevos) : [];
  const cuenta = (est: ResultadoArchivo["estado"]) => (resultados ?? []).filter((r) => r.estado === est).length;
  const ICONO = { ok: "✓", sin: "·", omitido: "–", error: "✕" } as const;
  const COLOR = { ok: "text-teal", sin: "text-ink-soft", omitido: "text-aviso", error: "text-danger" } as const;
  return (
    <div className="mt-3 rounded-lg border border-line bg-page/60 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 cursor-pointer rounded-md bg-ink px-3.5 py-2 text-sm font-semibold text-white hover:bg-slate-hover">
          📁 Elegir una carpeta…
          <input
            id="archivo-carpeta"
            type="file"
            multiple
            className="sr-only"
            // Atributos para elegir una carpeta completa (con todas sus subcarpetas).
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            onChange={(x) => {
              const fl = x.target.files;
              if (fl && fl.length) void leerCarpeta(fl);
              x.target.value = "";
            }}
          />
        </label>
        <label className={`${BOTON} inline-flex items-center gap-2 cursor-pointer`}>
          📄 Elegir archivos de Excel…
          <input
            id="archivo-inventario"
            type="file"
            multiple
            accept=".xlsx,.xlsm,.xlsb,.xls,.xltx,.xltm,.ods,.fods,.csv,.tsv,.dbf,.numbers,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(x) => {
              const fl = x.target.files;
              if (fl && fl.length) void leerCarpeta(fl);
              x.target.value = "";
            }}
          />
        </label>
        <p className="text-xs text-ink-soft basis-full">
          <b>Carpeta:</b> entra a cada subcarpeta (y a los .zip) y lee línea por línea todos los archivos (Excel, CSV, Word, PowerPoint, PDF,
          texto, correos, formatos antiguos). <b>Archivos de Excel:</b> elige uno o varios a la vez (Ctrl o Shift para marcar varios); se leen
          todas sus hojas. Al terminar de leer se pregunta si quieres <b>agregar</b> los equipos nuevos o <b>reemplazar</b> el inventario.
        </p>
      </div>

      {progreso && (
        <div className="mt-3" role="status" aria-live="polite">
          <div className="h-2 rounded-full bg-concrete-dim overflow-hidden">
            <div className="h-full bg-teal transition-all" style={{ width: `${(progreso.i / progreso.n) * 100}%` }} />
          </div>
          <p className="text-xs text-ink-soft mt-1 truncate">
            Archivo {progreso.i} de {progreso.n} · carpeta «{progreso.carpeta || carpeta}» · {progreso.ruta.split("/").pop()}
          </p>
        </div>
      )}

      {resultados && calculo && (
        <div className="mt-3 text-sm">
          <p className="font-semibold">
            «{carpeta}»: {porCarpeta.length} carpeta(s), {resultados.length} archivo(s) revisado(s) ·{" "}
            <span className="text-teal">{cuenta("ok")} con equipos</span> · {cuenta("sin")} sin equipos ·{" "}
            <span className="text-aviso">{cuenta("omitido")} sin texto u omitidos</span>
            {cuenta("error") > 0 && <span className="text-danger"> · {cuenta("error")} con error</span>}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
            {[
              ["Equipos encontrados", calculo.total, ""],
              ["Nuevos para agregar", calculo.nuevos.length, "text-teal"],
              ["Ya en el inventario", calculo.enInventario, "text-ink-soft"],
              ["Repetidos entre archivos", calculo.entreArchivos, "text-ink-soft"],
            ].map(([t, n, c]) => (
              <div key={t as string} className="rounded-md bg-white border border-line px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-ink-soft">{t}</p>
                <p className={`text-xl font-bold tabular-nums ${c}`}>{n}</p>
              </div>
            ))}
          </div>

          {calculo.unicos.length > 0 && (
            <fieldset className={`mt-3 rounded-lg border-2 p-3 ${modo ? "border-line bg-white" : "border-teal bg-teal-soft"}`}>
              <legend className="px-1 text-sm font-semibold">¿Qué quieres hacer con esta información?</legend>
              <div className="grid sm:grid-cols-2 gap-2">
                {([
                  ["agregar", "➕ Agregar al inventario", `Se suman ${calculo.nuevos.length} equipo(s) nuevo(s). Los ${actual.equipos.length} que ya están no cambian y los repetidos no se agregan.`],
                  ["reemplazar", "🔄 Reemplazar el inventario", `El inventario pasa a ser solo estos ${calculo.unicos.length} equipo(s) (sin repetidos). Se quitan los ${actual.equipos.length} actuales.`],
                ] as const).map(([v, t, d]) => (
                  <label
                    key={v}
                    className={`flex gap-2 cursor-pointer rounded-md border px-3 py-2 ${modo === v ? (v === "reemplazar" ? "border-danger bg-danger-soft" : "border-teal bg-teal-soft") : "border-line bg-white hover:border-line-strong"}`}
                  >
                    <input type="radio" name="modo-carga" checked={modo === v} onChange={() => setModo(v)} className="mt-1" />
                    <span>
                      <span className="block text-sm font-semibold">{t}</span>
                      <span className="block text-xs text-ink-soft">{d}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div className="mt-3 bg-white border border-line rounded-lg max-h-80 overflow-y-auto">
            {porCarpeta.map(([c, lista]) => (
              <details key={c} open={lista.some((r) => r.estado === "ok" || r.estado === "error")} className="border-b border-line last:border-b-0">
                <summary className="cursor-pointer px-3 py-1.5 text-xs font-semibold flex items-center gap-2">
                  📂 <span className="truncate">{c || carpeta}</span>
                  <span className="ml-auto font-normal text-ink-soft shrink-0">
                    {lista.length} archivo(s) · {lista.reduce((s, r) => s + r.equipos.length, 0)} equipo(s)
                  </span>
                </summary>
                <ul className="pb-1.5">
                  {lista.map((r) => (
                    <li key={r.ruta} className="flex items-start gap-2 px-3 py-0.5 text-xs">
                      {r.estado === "ok" ? (
                        <input
                          type="checkbox"
                          checked={r.incluir}
                          onChange={(e) => setResultados((rs) => rs!.map((x) => (x.ruta === r.ruta ? { ...x, incluir: e.target.checked } : x)))}
                          aria-label={`Incluir ${r.ruta}`}
                          className="mt-0.5"
                        />
                      ) : (
                        <span className={`w-3.5 text-center shrink-0 ${COLOR[r.estado]}`} aria-hidden="true">{ICONO[r.estado]}</span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="font-medium break-all">{r.ruta.split("/").pop()}</span>
                        <span className={`block ${COLOR[r.estado]}`}>{r.detalle}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>

          {(modo === "reemplazar" ? calculo.unicos : calculo.nuevos).length > 0 && (
            <div className="mt-3 bg-white border border-line rounded-lg overflow-x-auto">
              <p className="px-2 pt-1.5 text-xs font-semibold">
                {modo === "reemplazar" ? `Equipos que tendrá el inventario (${calculo.unicos.length})` : `Equipos nuevos (${calculo.nuevos.length})`}
              </p>
              <table className="w-full text-xs">
                <thead className="bg-page text-ink-soft">
                  <tr>
                    {["Código", "Equipo", "Ubicación", "Marca · modelo · serie", "Archivo"].map((t) => (
                      <th key={t} className="text-left font-semibold px-2 py-1.5">{t}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(verTodos ? vista : vista.slice(0, 15)).map((e, k) => (
                    <tr key={k} className="border-t border-line">
                      <td className="px-2 py-1 font-mono-tag">{e.codigo || "—"}</td>
                      <td className="px-2 py-1">{e.nombre || "—"}</td>
                      <td className="px-2 py-1">{[e.ubicacion, e.pabellon, e.piso].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="px-2 py-1">{[e.marca, e.modelo, e.serie].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="px-2 py-1 text-ink-soft truncate max-w-[14rem]">{e.fuentes[0]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {vista.length > 15 && (
                <button type="button" onClick={() => setVerTodos((v) => !v)} className="w-full text-xs text-teal py-1.5 hover:underline">
                  {verTodos ? "Ver menos" : `Ver los ${vista.length}`}
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-3">
            {calculo.unicos.length === 0 ? (
              <p className="text-sm text-ink-soft self-center">No se encontraron equipos en los archivos elegidos.</p>
            ) : !modo ? (
              <p className="text-sm text-ink-soft self-center">Elige arriba si quieres agregar o reemplazar.</p>
            ) : modo === "agregar" ? (
              <button
                type="button"
                onClick={() => void guardar("agregar")}
                disabled={guardando || calculo.nuevos.length === 0}
                className="rounded-md bg-teal px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {guardando ? "Guardando…" : calculo.nuevos.length ? `Agregar ${calculo.nuevos.length} equipo(s) nuevo(s)` : "No hay equipos nuevos"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => confirmar.pedir("reemplazar", () => void guardar("reemplazar"))}
                disabled={guardando}
                className={`rounded-md px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50 ${confirmar.armado === "reemplazar" ? "bg-danger ring-2 ring-danger/40" : "bg-ink"}`}
              >
                {guardando
                  ? "Guardando…"
                  : confirmar.armado === "reemplazar"
                    ? `¿Seguro? Clic otra vez: se quitan ${actual.equipos.length} y quedan ${calculo.unicos.length}`
                    : `Reemplazar el inventario con ${calculo.unicos.length} equipo(s)`}
              </button>
            )}
            <button type="button" onClick={() => { setResultados(null); setModo(null); }} className="rounded-md border border-line-strong px-3 py-2 text-sm">
              Cancelar
            </button>
          </div>
        </div>
      )}
      {msg && <p className={`text-sm mt-2 ${msg.startsWith("✓") ? "text-teal" : "text-danger"}`}>{msg}</p>}
    </div>
  );
}
