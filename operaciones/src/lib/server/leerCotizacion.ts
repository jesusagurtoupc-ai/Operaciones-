// Lectura de una cotización en PDF sin lanzar excepciones (igual que leerPdfDeOC).
import type { DatosCotizacion } from "@/lib/shared";
import { extraerPaginasPdf, localizarPdf } from "./pdfTexto";
import { parsearCotizacion } from "./parsearCotizacion";
import { tituloDeInforme } from "./parsearInforme";

export type LecturaCotizacion =
  | { ok: true; datos: DatosCotizacion }
  | { ok: false; error: string; noEsPdf?: boolean };

export function leerPdfDeCotizacion(buf: Buffer): LecturaCotizacion {
  try {
    if (localizarPdf(buf) === null) return { ok: false, error: "El archivo no es un PDF válido", noEsPdf: true };
    const pdf = extraerPaginasPdf(buf);
    if (!pdf.ok) return { ok: false, error: pdf.error };
    const informe = tituloDeInforme(pdf.paginas);
    if (informe) return { ok: false, error: `Este PDF es un ${informe.toLowerCase()}, no una cotización` };
    const r = parsearCotizacion(pdf.paginas, pdf.creado);
    if (!r.ok) {
      return {
        ok: false,
        error: pdf.usaFuentesCID
          ? "No se pudo leer el texto de este PDF (sus letras están incrustadas de una forma que no se puede interpretar)"
          : r.error,
      };
    }
    return r;
  } catch (e) {
    console.error("Error al interpretar el PDF de la cotización", e);
    return { ok: false, error: "No se pudo interpretar este PDF de cotización" };
  }
}
