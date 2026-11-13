// Lectura de un INFORME TÉCNICO (o acta de conformidad) en PDF: se reconoce por su título y se busca
// a qué orden de compra corresponde, para guardarlo en la línea "Informe" del ticket de esa OC.
// Todo es "mejor esfuerzo": lo que no se encuentra queda vacío y nunca se inventa.
import type { Pagina } from "./pdfTexto";
import { extraerPaginasPdf } from "./pdfTexto";

export type DatosInforme = {
  /** Título tal como aparece ("INFORME TÉCNICO"). */
  titulo: string;
  /** N° de OC que menciona (puede haber más de uno). */
  ocs: string[];
  fecha: string | null; // YYYY-MM-DD
  referencia: string | null;
};

const limpiar = (t: string) => t.replace(/\s+/g, " ").trim();

// El título debe estar arriba y ocupar la línea: así "• INFORME TÉCNICO" dentro de las partidas de una
// cotización (un entregable) no la convierte en informe.
const RE_TITULO =
  /^(?:informe\s+t[eé]cnico|informe\s+de\s+(?:servicio|mantenimiento|trabajos?|conformidad|cierre)|acta\s+de\s+(?:conformidad|entrega|recepci[oó]n)|conformidad\s+de\s+servicio)\b.{0,40}$/i;
const LINEAS_TITULO = 8;

/** ¿El documento es un informe técnico / acta? Devuelve su título o null. */
export function tituloDeInforme(paginas: Pagina[]): string | null {
  const primeras = (paginas[0]?.lineas ?? []).slice(0, LINEAS_TITULO);
  for (const l of primeras) {
    const t = limpiar(l.texto);
    if (RE_TITULO.test(t)) return t;
  }
  return null;
}

export function parsearInforme(paginas: Pagina[]): { ok: true; datos: DatosInforme } | { ok: false; error: string } {
  const titulo = tituloDeInforme(paginas);
  if (!titulo) return { ok: false, error: "No es un informe técnico" };
  const lineas = paginas.flatMap((p) => p.lineas).map((l) => limpiar(l.texto));
  const todo = lineas.join("\n");

  // N° de OC: formato PeopleSoft (PER05-0000159613) o "OC N° …" / "orden de compra …".
  const ocs = new Set<string>();
  for (const m of todo.matchAll(/\b([A-Z]{3}\d{2}-\d{6,12})\b/g)) ocs.add(m[1]);
  for (const m of todo.matchAll(/\b(?:O\.?\s?C\.?|orden\s+de\s+(?:compra|servicio))\s*(?:N[°ºo.]*\s*)?[:#]?\s*([A-Z0-9][A-Z0-9\-/]{3,24})/gi)) {
    const v = m[1].replace(/[-/]+$/, "");
    if (/\d{4,}/.test(v)) ocs.add(v.toUpperCase());
    if (ocs.size >= 5) break;
  }

  let fecha: string | null = null;
  const mf = /fecha\s*[:.]?\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/i.exec(todo);
  if (mf) {
    const d = Number(mf[1]), mes = Number(mf[2]), a = Number(mf[3]);
    if (d >= 1 && d <= 31 && mes >= 1 && mes <= 12) fecha = `${a}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const mr = /^(?:referencia|asunto)\s*[:.]\s*(.+)$/im.exec(todo);
  const referencia = mr ? limpiar(mr[1]).slice(0, 200) : null;

  return { ok: true, datos: { titulo, ocs: [...ocs], fecha, referencia } };
}

export type LecturaInforme = { ok: true; datos: DatosInforme } | { ok: false; error: string; noEsPdf?: boolean };

/** Lee un PDF como informe técnico. */
export function leerPdfDeInforme(buf: Buffer): LecturaInforme {
  try {
    const pdf = extraerPaginasPdf(buf);
    if (!pdf.ok) return { ok: false, error: pdf.error, noEsPdf: pdf.error.includes("no es un PDF") };
    return parsearInforme(pdf.paginas);
  } catch (e) {
    console.error("Error al interpretar el PDF del informe", e);
    return { ok: false, error: "No se pudo interpretar este PDF" };
  }
}
