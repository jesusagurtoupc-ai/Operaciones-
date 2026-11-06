// Lectura de una orden de compra en PDF: punto único que usan "Leer OC" (/api/ordenes-compra/leer)
// y la creación de tickets (/api/correctivos/desde-oc), para que ambas se comporten igual.
import type { DatosOC } from "@/lib/shared";
import { extraerPaginasPdf, localizarPdf } from "./pdfTexto";
import { parsearOC } from "./parsearOC";

export type LecturaOC =
  | { ok: true; datos: Omit<DatosOC, "otros_tickets"> }
  | { ok: false; error: string; noEsPdf?: boolean };

const MSG_FUENTES =
  "No se pudo leer el texto de este PDF (sus letras están incrustadas de una forma que no se puede interpretar). " +
  "Suele pasar con PDF guardados con «Imprimir como PDF». Usa el PDF original de la OC que envía el sistema de compras";

/** ¿Los bytes son un PDF? Mira el contenido, no el nombre ni la extensión del archivo. */
export const esPdf = (buf: Buffer) => localizarPdf(buf) !== null;

/**
 * Lee un PDF de OC sin lanzar excepciones: cualquier falla inesperada del lector se registra en el
 * log y se devuelve como un mensaje claro, nunca como un error 500.
 */
export function leerPdfDeOC(buf: Buffer, nombreArchivo?: string | null): LecturaOC {
  try {
    if (!esPdf(buf)) return { ok: false, error: "El archivo no es un PDF válido", noEsPdf: true };
    const pdf = extraerPaginasPdf(buf);
    if (!pdf.ok) return { ok: false, error: pdf.error };
    const oc = parsearOC(pdf.paginas, pdf.creado, nombreArchivo ?? null);
    if (!oc.ok) {
      return { ok: false, error: pdf.usaFuentesCID ? MSG_FUENTES : oc.error };
    }
    return { ok: true, datos: oc.datos };
  } catch (e) {
    console.error("Error al interpretar el PDF de la OC", e);
    return {
      ok: false,
      error: "No se pudo interpretar este PDF. Verifica que sea el PDF original de la orden de compra",
    };
  }
}
