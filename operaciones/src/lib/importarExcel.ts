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
