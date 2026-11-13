// Lectura de una orden de compra en PDF: punto único que usan "Leer OC" (/api/ordenes-compra/leer)
// y la creación de tickets (/api/correctivos/desde-oc), para que ambas se comporten igual.
import type { DatosOC } from "@/lib/shared";
import { extraerPaginasPdf, localizarPdf } from "./pdfTexto";
import { parsearOC } from "./parsearOC";
import { tituloDeInforme } from "./parsearInforme";

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
    // Un informe técnico cita el N° de la OC, pero no es una OC: no debe crear ni actualizar tickets.
    const informe = tituloDeInforme(pdf.paginas);
    if (informe) return { ok: false, error: `Este PDF es un ${informe.toLowerCase()}, no una orden de compra` };
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

export type DatosLeidos = Extract<LecturaOC, { ok: true }>["datos"];

/**
 * Valores que la OC aporta al ticket, con las reglas de siempre (las usan tanto "crear desde OC"
 * como "actualizar con una OC nueva"):
 *  - monto: el que se pidió (total o subtotal). Sin alternar: si no se leyó, queda vacío. Si la OC
 *    no está en soles tampoco se guarda (se convierte a mano en el ticket).
 *  - fechas (OC y entrega): si el PDF las deja ambiguas (mes/día o día/mes) solo valen si la persona
 *    las confirmó.
 */
export function valoresDeOC(
  d: DatosLeidos,
  opciones: { base: "total" | "subtotal"; fechaOk: boolean }
) {
  const n_oc = d.n_oc?.trim().slice(0, 200) || null;
  const proveedor = d.proveedor?.trim().slice(0, 200) || null;
  const descripcionLeida = d.descripcion?.trim().slice(0, 2000) || null;
  const montoLeido = opciones.base === "subtotal" ? d.subtotal : d.total;
  const enSoles = !d.moneda || d.moneda === "PEN";
  const monto =
    enSoles && montoLeido !== null && Number.isFinite(montoLeido) && montoLeido >= 0 && montoLeido < 1e10
      ? Math.round(montoLeido * 100) / 100
      : null;
  const fechaConfirmada = !d.fecha_ambigua || opciones.fechaOk;
  return {
    n_oc,
    proveedor,
    /** Descripción tal como viene en la OC (null si no trae). */
    descripcionLeida,
    /** Para un ticket NUEVO: la de la OC o, si no trae, "OC <n°> – <proveedor>". */
    descripcion: descripcionLeida ?? (n_oc ? `OC ${n_oc}${proveedor ? ` – ${proveedor}` : ""}` : null),
    ruc_proveedor: d.ruc_proveedor?.trim().slice(0, 200) || null,
    contrato: d.contrato?.trim().slice(0, 200) || null,
    monto,
    enSoles,
    fechaConfirmada,
    f_oc: fechaConfirmada ? d.f_oc : null,
    f_entrega: fechaConfirmada ? d.f_entrega : null,
  };
}
