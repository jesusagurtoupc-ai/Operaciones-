// Importar materiales desde Excel/CSV: lectura del archivo y reglas para decidir si cada fila es del
// catálogo, fuera del catálogo o tiene un error. Las reglas (filasALineas) son puras y no usan React.
import {
  type Catalogo,
  type CatalogoFuera,
  type Linea,
  LIMITES,
  lineaDeCatalogo,
  lineaDeFuera,
  nuevoUid,
  normalizar,
} from "./materiales";

export const MAX_FILAS_EXCEL = 1000;
export const MAX_BYTES_EXCEL = 2 * 1024 * 1024;

export type FilaImportada = {
  /** Número de fila en la hoja de Excel (1 = primera). */
  fila: number;
  estado: "catalogo" | "fuera" | "error";
  linea: Linea | null;
  mensaje: string;
};

const COLUMNAS = {
  codigo: ["codigo", "cod", "articulo", "cod articulo", "codigo articulo", "sku"],
  descripcion: ["descripcion", "material", "detalle", "nombre", "producto"],
  cantidad: ["cantidad", "cant", "qty"],
  unidad: ["unidad", "und", "um", "u m", "unidad de medida"],
  precio: ["precio", "precio unitario", "p unit", "precio sin igv", "precio ref", "precio referencial"],
} as const;
type Col = keyof typeof COLUMNAS;

const limpiar = (v: unknown) => normalizar(String(v ?? "").replace(/[^\p{L}\p{N} ]/gu, " "));
const texto = (v: unknown) => String(v ?? "").trim();

/** 12, "12", "1,5" y "1,234.50" → número; vacío → null; texto raro → NaN. */
function numero(v: unknown): number | null {
  if (typeof v === "number") return v;
  let s = texto(v).replace(/\s/g, "");
  if (s === "") return null;
  s = s.includes(",") && s.includes(".") ? s.replace(/,/g, "") : s.replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

/** Lee la primera hoja de un .xlsx, .xls o .csv como matriz de filas. */
export async function leerArchivoExcel(archivo: File): Promise<unknown[][]> {
  if (archivo.size > MAX_BYTES_EXCEL) throw new Error("El archivo pesa más de 2 MB.");
  const XLSX = await import("xlsx"); // solo se descarga al importar
  const libro = XLSX.read(await archivo.arrayBuffer(), { type: "array" });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  if (!hoja) throw new Error("El archivo no tiene hojas.");
  return XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, raw: true, defval: "" });
}

/** Descarga un Excel de ejemplo con las columnas que entiende la importación. */
export async function descargarPlantilla(): Promise<void> {
  const XLSX = await import("xlsx");
  const hoja = XLSX.utils.aoa_to_sheet([
    ["Código", "Descripción", "Cantidad", "Unidad", "Precio sin IGV"],
    ["PER000000000112266", "", 2, "", ""],
    ["", "Material que no está en el catálogo", 5, "UND", 12.5],
  ]);
  hoja["!cols"] = [{ wch: 22 }, { wch: 50 }, { wch: 10 }, { wch: 10 }, { wch: 16 }];
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Materiales");
  XLSX.writeFile(libro, "plantilla-materiales.xlsx");
}

/** Convierte las filas de la hoja en líneas de solicitud (con su estado, para mostrar la vista previa). */
export function filasALineas(
  matriz: unknown[][],
  catalogo: Catalogo | null,
  fuera: CatalogoFuera | null
): { filas: FilaImportada[]; error: string } {
  // encabezado: la primera fila (de las 10 primeras) con "cantidad" y "código" o "descripción"
  let cab = -1;
  const idx: Partial<Record<Col, number>> = {};
  for (let r = 0; r < Math.min(matriz.length, 10) && cab < 0; r++) {
    const hallado: Partial<Record<Col, number>> = {};
    matriz[r].forEach((celda, c) => {
      const h = limpiar(celda);
      for (const k of Object.keys(COLUMNAS) as Col[]) {
        if (hallado[k] === undefined && (COLUMNAS[k] as readonly string[]).includes(h)) hallado[k] = c;
      }
    });
    if (hallado.cantidad !== undefined && (hallado.codigo !== undefined || hallado.descripcion !== undefined)) {
      cab = r;
      Object.assign(idx, hallado);
    }
  }
  if (cab < 0) {
    return { filas: [], error: "No encontré las columnas. La primera fila debe tener «Cantidad» y «Código» o «Descripción»." };
  }

  const porCodigo = new Map((catalogo?.items ?? []).map((it) => [it.articulo.toUpperCase(), it]));
  let porDescripcion: Map<string, Catalogo["items"][number]> | null = null;
  const get = (fila: unknown[], k: Col) => (idx[k] === undefined ? "" : fila[idx[k]!]);

  const filas: FilaImportada[] = [];
  for (let r = cab + 1; r < matriz.length && filas.length < MAX_FILAS_EXCEL; r++) {
    const f = matriz[r];
    const codigo = texto(get(f, "codigo"));
    const desc = texto(get(f, "descripcion"));
    if (!codigo && !desc) continue; // fila en blanco
    const fila = r + 1;
    const err = (mensaje: string) => filas.push({ fila, estado: "error", linea: null, mensaje });

    const cantidad = numero(get(f, "cantidad"));
    if (cantidad === null || !Number.isFinite(cantidad) || cantidad <= 0) {
      err("La cantidad debe ser un número mayor que cero.");
      continue;
    }
    const precio = numero(get(f, "precio"));
    if (precio !== null && (!Number.isFinite(precio) || precio < 0)) {
      err("El precio no es válido.");
      continue;
    }
    const unidad = texto(get(f, "unidad")).slice(0, LIMITES.unidad);

    // 1) por código del catálogo
    let aviso = "";
    if (codigo) {
      const it = porCodigo.get(codigo.toUpperCase());
      if (it) {
        filas.push({ fila, estado: "catalogo", linea: { ...lineaDeCatalogo(it, cantidad), unidad }, mensaje: "" });
        continue;
      }
      if (!desc) {
        err(`El código ${codigo} no está en el catálogo y no hay descripción.`);
        continue;
      }
      aviso = `El código ${codigo} no está en el catálogo: se agrega como fuera de catálogo.`;
    }

    // 2) por descripción exacta en el catálogo (solo si no venía un código)
    if (!codigo && catalogo) {
      porDescripcion ??= new Map(catalogo.items.map((it) => [normalizar(it.descripcion), it]));
      const it = porDescripcion.get(normalizar(desc));
      if (it) {
        filas.push({ fila, estado: "catalogo", linea: { ...lineaDeCatalogo(it, cantidad), unidad }, mensaje: "" });
        continue;
      }
    }

    // 3) fuera de catálogo: de la lista de órdenes de compra anteriores, o libre
    const recortada = desc.length > LIMITES.descripcion;
    if (recortada) aviso ||= `La descripción se recortó a ${LIMITES.descripcion} caracteres.`;
    const conocido = fuera?.items.find((x) => x.clave === `libre:${normalizar(desc)}`);
    const linea: Linea = conocido
      ? { ...lineaDeFuera(conocido, cantidad), unidad: unidad || conocido.unidad.slice(0, LIMITES.unidad), precio: precio ?? conocido.precio }
      : {
          uid: nuevoUid(), codigo: null, descripcion: desc.slice(0, LIMITES.descripcion), cantidad, unidad, precio,
          moneda: "PEN", vence: null, proveedor: null, minimo: null, entrega: null,
        };
    filas.push({ fila, estado: "fuera", linea, mensaje: aviso });
  }
  if (filas.length === 0) return { filas, error: "El archivo no tiene materiales debajo del encabezado." };
  return { filas, error: "" };
}

// ───────── Exportar a Excel los materiales DEL CATÁLOGO de la solicitud ─────────
// Hoja ordenada en tres bloques: (1) título y datos de la solicitud, (2) datos del proveedor (lo que es
// igual para todos los materiales va una sola vez), (3) la tabla de materiales con cantidad y costo total
// y, debajo, subtotal, IGV y total. Con marcos, encabezados resaltados y FÓRMULAS: si se cambia una
// cantidad o un precio en el Excel, todo se recalcula.
//
// El archivo .xlsx se escribe aquí mismo (XML + zip), sin librerías: la versión gratuita de SheetJS no
// guarda bordes ni negritas.

/** Estilos de celda (índices de styles.xml, ver ESTILOS_XML). */
export const E = {
  normal: 0,
  titulo: 1,
  gris: 2,
  encabezado: 3,
  texto: 4,
  numero: 5,
  soles: 6,
  etiquetaTotal: 7,
  solesTotal: 8,
  etiquetaFinal: 9,
  solesFinal: 10,
  centro: 11,
  bloqueEtiqueta: 12,
  bloqueValor: 13,
  seccion: 14,
} as const;

export type CeldaX = { v: string | number | null; f?: string; s: number };
export type HojaX = {
  nombre: string;
  filas: (CeldaX | null)[][];
  anchos: number[];
  combinadas: string[];
  /** Alto (en puntos) de filas concretas, base 0. */
  altos?: Record<number, number>;
  /** Fila (base 1) desde la que se desplaza: las anteriores quedan fijas. */
  fijarHasta?: number;
  /** Rango con flechas de filtro en los encabezados (como el catálogo original), p. ej. "A9:M14". */
  filtro?: string;
};

const letra = (i: number) => String.fromCharCode(65 + i); // menos de 26 columnas
const redondear = (n: number) => Math.round(n * 100) / 100;

/**
 * Arma la hoja (pura, sin descargar nada: se puede probar sola). Solo entran los materiales del catálogo.
 */
export function hojaExcelCatalogo(
  lineas: Linea[],
  catalogo: Catalogo | null,
  info: { numero: string; fecha: string; igv: number }
): { hoja: HojaX; materiales: number } {
  const porCodigo = new Map((catalogo?.items ?? []).map((it) => [it.articulo, it]));
  const items = lineas
    .filter((l) => l.codigo)
    .map((l) => {
      const it = porCodigo.get(l.codigo ?? "");
      const vence = l.vence ?? it?.vence ?? "";
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(vence);
      return {
        l,
        categoria: it?.categoria ?? "",
        categoriaCodigo: it?.categoriaCodigo ?? "",
        proveedor: l.proveedor ?? it?.proveedor ?? "",
        proveedorId: it?.proveedorId ?? "",
        minimo: l.minimo ?? it?.minimo ?? "",
        entrega: l.entrega ?? it?.entrega ?? "",
        moneda: l.moneda || it?.moneda || "PEN",
        vence: m ? `${m[3]}/${m[2]}/${m[1]}` : vence,
        precio: l.precio ?? it?.precio ?? null,
      };
    });

  // Las MISMAS columnas, con los mismos nombres y en el mismo orden que el catálogo original del
  // proveedor; al final se agregan la cantidad pedida y el costo total.
  type Col = { titulo: string; ancho: number; valor: (x: (typeof items)[number], i: number) => CeldaX };
  const t = (v: string | number | null, s: number = E.texto): CeldaX => ({ v: v === "" ? null : v, s });
  const cols: Col[] = [
    { titulo: "N°", ancho: 5, valor: (_x, i) => t(i + 1, E.centro) },
    { titulo: "Id Articulo", ancho: 21, valor: (x) => t(x.l.codigo ?? "") },
    { titulo: "Descripción", ancho: 52, valor: (x) => t(x.l.descripcion) },
    { titulo: "Categoria", ancho: 11, valor: (x) => t(x.categoriaCodigo, E.centro) },
    { titulo: "Nombre Categoria", ancho: 26, valor: (x) => t(x.categoria) },
    { titulo: "Id Proveedor", ancho: 13, valor: (x) => t(x.proveedorId, E.centro) },
    { titulo: "Nombre Proveedor", ancho: 27, valor: (x) => t(x.proveedor) },
    { titulo: "MONEDA", ancho: 9, valor: (x) => t(x.moneda, E.centro) },
  ];
  // Después de MONEDA: el precio y lo que se agrega (cantidad pedida y costo total). Sin fecha de
  // vencimiento, cantidad mínima ni tiempo de entrega.
  const colsFin = ["Precio (sin igv)", "Cantidad", "Costo total (sin igv)"];
  const iPrecio = cols.length;
  const iCant = iPrecio + 1;
  const iCosto = iPrecio + 2;
  const nCols = iCosto + 1;
  const ultimaCol = letra(iCosto);

  const filas: (CeldaX | null)[][] = [];
  const fila = (...c: (CeldaX | null)[]) => filas.push(c);
  // Fila de un bloque: etiqueta en B y valor en C (sin celdas combinadas ni color), con marco. La
  // columna A es la angosta del N° de la tabla.
  const bloque = (etiqueta: string, valor: string | number) =>
    fila(null, { v: etiqueta, s: E.bloqueEtiqueta }, { v: valor === "" ? "—" : valor, s: E.bloqueValor });
  const combinadas: string[] = [];

  // (1) Título y datos de la solicitud
  fila({ v: "SOLICITUD DE MATERIALES — MATERIALES DEL CATÁLOGO", s: E.titulo });
  combinadas.push(`A1:${ultimaCol}1`);
  fila({ v: `Catálogo: ${catalogo?.titulo ?? "—"}`, s: E.gris });
  combinadas.push(`A2:${ultimaCol}2`);
  filas.push([]);
  fila(null, { v: "DATOS DE LA SOLICITUD", s: E.seccion });
  bloque("N° de solicitud", info.numero);
  bloque("Fecha", info.fecha);
  bloque("Materiales", items.length);
  filas.push([]);

  // (3) Tabla de materiales
  fila({ v: "DETALLE DE MATERIALES", s: E.seccion });
  const filaEncabezado = filas.length; // base 0
  fila(...cols.map((c) => ({ v: c.titulo, s: E.encabezado })), ...colsFin.map((c) => ({ v: c, s: E.encabezado })));
  const primera = filas.length + 1; // fila de Excel del primer material
  // Excel no ajusta solo el alto de una fila con texto partido: se calcula por el largo de la descripción.
  const altos: Record<number, number> = { 0: 24, [filaEncabezado]: 30 };
  items.forEach((x, i) => {
    // El alto lo pone la celda que más renglones necesita (descripción, proveedor, pedido mínimo…).
    const renglones = Math.max(
      1,
      ...cols.map((c) => {
        const v = c.valor(x, i).v;
        return typeof v === "string" ? Math.ceil(v.length / Math.max(1, c.ancho * 1.1 - 3)) : 1;
      })
    );
    altos[filas.length + i] = Math.max(18, renglones * 13 + 6);
  });
  items.forEach((x, i) => {
    const r = primera + i;
    const costo = x.precio === null ? 0 : redondear(x.precio * x.l.cantidad);
    fila(
      ...cols.map((c) => c.valor(x, i)),
      { v: x.precio, s: E.soles },
      { v: x.l.cantidad, s: E.numero },
      { v: costo, f: `ROUND(${letra(iPrecio)}${r}*${letra(iCant)}${r},2)`, s: E.soles }
    );
  });
  const ultima = primera + items.length - 1;

  // Totales, debajo de "Cantidad" y "Costo total"
  const subtotal = redondear(items.reduce((s, x) => s + (x.precio ?? 0) * x.l.cantidad, 0));
  const igv = redondear(subtotal * info.igv);
  // La etiqueta ocupa "Precio" + "Cantidad" (combinadas) y el importe va en "Costo total".
  const vacias = (): (CeldaX | null)[] => Array.from({ length: iCant - 1 }, () => null);
  const etiqueta = (v: string, s: number): (CeldaX | null)[] => [{ v, s }, { v: null, s }];
  const combinarEtiqueta = () => combinadas.push(`${letra(iCant - 1)}${filas.length}:${letra(iCant)}${filas.length}`);
  filas.push([]);
  const rSub = filas.length + 1;
  filas.push([...vacias(), ...etiqueta("Subtotal (sin IGV)", E.etiquetaTotal), { v: subtotal, f: items.length ? `SUM(${letra(iCosto)}${primera}:${letra(iCosto)}${ultima})` : "0", s: E.solesTotal }]);
  combinarEtiqueta();
  const rIgv = filas.length + 1;
  filas.push([...vacias(), ...etiqueta(`IGV (${Math.round(info.igv * 100)} %)`, E.etiquetaTotal), { v: igv, f: `ROUND(${letra(iCosto)}${rSub}*${info.igv},2)`, s: E.solesTotal }]);
  combinarEtiqueta();
  filas.push([...vacias(), ...etiqueta("TOTAL (con IGV)", E.etiquetaFinal), { v: redondear(subtotal + igv), f: `${letra(iCosto)}${rSub}+${letra(iCosto)}${rIgv}`, s: E.solesFinal }]);
  combinarEtiqueta();

  const anchos = [...cols.map((c) => c.ancho), 16, 11, 20];
  return {
    hoja: {
      nombre: "Materiales del catálogo",
      filas,
      anchos: anchos.slice(0, nCols),
      combinadas,
      altos,
      fijarHasta: filaEncabezado + 1,
      filtro: items.length ? `A${filaEncabezado + 1}:${ultimaCol}${filaEncabezado + 1 + items.length}` : undefined,
    },
    materiales: items.length,
  };
}

// ───────── escritor mínimo de .xlsx ─────────
const esc = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

const ESTILOS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;S/ &quot;#,##0.00"/></numFmts>
<fonts count="5">
<font><sz val="10"/><name val="Arial"/></font>
<font><b/><sz val="14"/><name val="Arial"/></font>
<font><sz val="9"/><color rgb="FF5F6673"/><name val="Arial"/></font>
<font><b/><sz val="10"/><name val="Arial"/></font>
<font><b/><sz val="10"/><color rgb="FF000000"/><name val="Arial"/></font>
</fonts>
<fills count="5">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFA6A6A6"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFDECEC"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FF404040"/></left><right style="thin"><color rgb="FF404040"/></right><top style="thin"><color rgb="FF404040"/></top><bottom style="thin"><color rgb="FF404040"/></bottom><diagonal/></border>
<border><left style="medium"><color rgb="FF404040"/></left><right style="medium"><color rgb="FF404040"/></right><top style="medium"><color rgb="FF404040"/></top><bottom style="medium"><color rgb="FF404040"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="15">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="164" fontId="3" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="164" fontId="3" fillId="4" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function hojaXml(h: HojaX): string {
  const ultimaCol = letra(Math.max(1, ...h.filas.map((f) => f.length)) - 1);
  const filasXml = h.filas
    .map((f, r) => {
      const celdas = f
        .map((c, k) => {
          if (!c) return "";
          const ref = `${letra(k)}${r + 1}`;
          if (c.f !== undefined) {
            return `<c r="${ref}" s="${c.s}"><f>${esc(c.f)}</f>${typeof c.v === "number" ? `<v>${c.v}</v>` : ""}</c>`;
          }
          if (c.v === null || c.v === "") return `<c r="${ref}" s="${c.s}"/>`;
          if (typeof c.v === "number") return `<c r="${ref}" s="${c.s}"><v>${c.v}</v></c>`;
          return `<c r="${ref}" s="${c.s}" t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`;
        })
        .join("");
      const alto = h.altos?.[r];
      return `<row r="${r + 1}"${alto ? ` ht="${alto}" customHeight="1"` : ""}>${celdas}</row>`;
    })
    .join("");
  const fijar = h.fijarHasta
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${h.fijarHasta}" topLeftCell="A${h.fijarHasta + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${ultimaCol}${h.filas.length}"/>${fijar}
<cols>${h.anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>
<sheetData>${filasXml}</sheetData>
${h.filtro ? `<autoFilter ref="${h.filtro}"/>` : ""}
${h.combinadas.length ? `<mergeCells count="${h.combinadas.length}">${h.combinadas.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : ""}
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

// CRC-32 y zip sin compresión (STORE): suficiente para un .xlsx chico y no necesita librerías.
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = TABLA_CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zip(archivos: { nombre: string; datos: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const partes: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const a of archivos) {
    const nombre = enc.encode(a.nombre);
    const datos = enc.encode(a.datos);
    const crc = crc32(datos);
    const local = new Uint8Array(30 + nombre.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(8, 0, true); // sin compresión
    dv.setUint32(14, crc, true);
    dv.setUint32(18, datos.length, true);
    dv.setUint32(22, datos.length, true);
    dv.setUint16(26, nombre.length, true);
    local.set(nombre, 30);
    partes.push(local, datos);
    const cd = new Uint8Array(46 + nombre.length);
    const dc = new DataView(cd.buffer);
    dc.setUint32(0, 0x02014b50, true);
    dc.setUint16(4, 20, true);
    dc.setUint16(6, 20, true);
    dc.setUint32(16, crc, true);
    dc.setUint32(20, datos.length, true);
    dc.setUint32(24, datos.length, true);
    dc.setUint16(28, nombre.length, true);
    dc.setUint32(42, offset, true);
    cd.set(nombre, 46);
    central.push(cd);
    offset += local.length + datos.length;
  }
  const tamCentral = central.reduce((s, c) => s + c.length, 0);
  const fin = new Uint8Array(22);
  const df = new DataView(fin.buffer);
  df.setUint32(0, 0x06054b50, true);
  df.setUint16(8, archivos.length, true);
  df.setUint16(10, archivos.length, true);
  df.setUint32(12, tamCentral, true);
  df.setUint32(16, offset, true);
  const todo = [...partes, ...central, fin];
  const out = new Uint8Array(todo.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of todo) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Bytes del .xlsx de una hoja (con estilos, marcos, fórmulas y sus resultados). */
export function crearXlsx(h: HojaX): Uint8Array {
  return zip([
    {
      nombre: "[Content_Types].xml",
      datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      nombre: "_rels/.rels",
      datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      nombre: "xl/workbook.xml",
      datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(h.nombre.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets>${
        h.filtro
          ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${esc(h.nombre.slice(0, 31).replace(/'/g, "''"))}'!$${h.filtro.replace(":", ":$").replace(/([A-Z]+)(\d+)/g, "$1$$$2")}</definedName></definedNames>`
          : ""
      }<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    },
    {
      nombre: "xl/_rels/workbook.xml.rels",
      datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { nombre: "xl/styles.xml", datos: ESTILOS_XML },
    { nombre: "xl/worksheets/sheet1.xml", datos: hojaXml(h) },
  ]);
}

/** Descarga el Excel de los materiales del catálogo. Devuelve cuántos materiales incluyó. */
export async function descargarExcelCatalogo(
  lineas: Linea[],
  catalogo: Catalogo | null,
  info: { numero: string; fecha: string; igv: number }
): Promise<number> {
  const { hoja, materiales } = hojaExcelCatalogo(lineas, catalogo, info);
  if (materiales === 0) return 0;
  const bytes = crearXlsx(hoja);
  const url = URL.createObjectURL(
    new Blob([bytes as unknown as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `solicitud-catalogo-${info.numero}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
  return materiales;
}
