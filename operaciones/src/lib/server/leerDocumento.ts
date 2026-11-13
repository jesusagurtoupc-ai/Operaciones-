// Lectura de CUALQUIER documento de un trabajo (OC, cotización, informe técnico, certificado, guía…):
// dice qué es y saca las "pistas" que sirven para juntarlo con los demás documentos del mismo trabajo
// (N° de OC citado, N° de cotización, RUC del proveedor, fecha y un resumen de qué se hizo).
// Todo es "mejor esfuerzo": lo que no se encuentra queda vacío y nunca se inventa.
import type { DocumentoLeido, TipoDocumento, PistasDocumento } from "@/lib/shared";
import { numeroOc } from "@/lib/shared";
import type { Pagina } from "./pdfTexto";
import { extraerPaginasPdf, localizarPdf } from "./pdfTexto";
import { parsearOC } from "./parsearOC";
import { parsearCotizacion, RUC_PROPIOS } from "./parsearCotizacion";


const limpiar = (t: string) => t.replace(/\s+/g, " ").trim();

// Títulos que se buscan en las primeras (y últimas: algunos PDF guardan las líneas al revés) líneas de la 1ª página.
const TITULOS: { tipo: TipoDocumento; re: RegExp }[] = [
  {
    tipo: "informe",
    re: /^(?:t[ií]tulo\s*:\s*)?(?:informe|reporte)\s+(?:t[eé]cnico|de\s+(?:atenci[oó]n|servicio|mantenimiento|trabajos?|conformidad|cierre|requerimiento|correctivo|preventivo|actividades|intervenci[oó]n)|correctivo|preventivo|final|n[°º.])|^acta\s+de\s+(?:conformidad|entrega|recepci[oó]n)|^conformidad\s+de\s+servicio|^ficha\s+de\s+(?:atenci[oó]n|servicio)/i,
  },
  { tipo: "certificado", re: /^certificad[oa]\s+(?:de\s+)?[a-záéíóú]{4,}/i },
  { tipo: "guia", re: /^gu[ií]a\s+de\s+remisi[oó]n/i },
  { tipo: "cotizacion", re: /^(?:cotizaci[oó]n|proforma|presupuesto|propuesta\s+(?:t[eé]cnica|econ[oó]mica))\b/i },
];

/** Qué dice el título del documento (o null si no tiene uno reconocible). */
export function tituloDeDocumento(paginas: Pagina[]): { tipo: TipoDocumento; titulo: string } | null {
  const lineas = (paginas[0]?.lineas ?? []).map((l) => limpiar(l.texto));
  const zonas = [...lineas.slice(0, 15).map((t, i) => ({ t, i })), ...lineas.slice(-10).map((t, i) => ({ t, i: 100 + i }))];
  let mejor: { tipo: TipoDocumento; titulo: string; i: number } | null = null;
  for (const { t, i } of zonas) {
    if (t.length > 110) continue;
    for (const { tipo, re } of TITULOS) {
      if (re.test(t) && (!mejor || i < mejor.i)) mejor = { tipo, titulo: t.replace(/^t[ií]tulo\s*:\s*/i, "").slice(0, 120), i };
    }
  }
  return mejor ? { tipo: mejor.tipo, titulo: mejor.titulo } : null;
}

/** Qué sugiere el nombre del archivo (para PDF escaneados o sin título). */
export function tipoPorNombre(nombre: string): TipoDocumento | null {
  const n = nombre.replace(/[_]+/g, " ");
  if (/certificad/i.test(n)) return "certificado";
  if (/\bgu.?a\b|gu[ií]a\s+de\s+remisi/i.test(n)) return "guia";
  if (/informe|reporte|ficha|\bit\s*(?:mc|n)?\s*[\d°º]|\brt\b|\bacta\b|conformidad/i.test(n)) return "informe";
  if (/cotiz|proforma|presupuesto|propuesta|\bcot\b/i.test(n)) return "cotizacion";
  if (/^\s*0*\d{6,10}\s*per05|^\s*per05|^\s*oc\b/i.test(n)) return "oc";
  return null;
}

/** Pistas (OC, cotización, RUC, fecha y resumen) de un texto y del nombre del archivo. */
export function pistasDe(texto: string, nombre: string, resumenBase: string[]): PistasDocumento {
  // En los nombres de archivo las letras con tilde o la ñ suelen quedar como "_" ("FILTRACI_N", "BA_O"): se unen.
  const nom = nombre
    .replace(/\.[^.]+$/, "")
    .replace(/([A-Za-z][aeiouAEIOU])_([nNoO])(?=_|\.|-|\s|$)/g, "$1$2")
    .replace(/[_]+/g, " ");
  const fuente = `${texto}\n${nom}`;
  const ocs = new Set<string>();
  for (const m of fuente.matchAll(/\b[A-Z]{3}\d{2}\s?-?\s?0*(\d{5,10})\b/g)) ocs.add(m[1]);
  for (const m of fuente.matchAll(/\b(?:O\.?\s?C\.?|orden\s+de\s+(?:compra|servicio))\s*(?:N[°ºo.]*\s*)?[:#-]?\s*(?:[A-Z]{3}\d{2}-?)?0*(\d{5,10})\b/gi)) ocs.add(m[1]);

  // Números sueltos del nombre del archivo (p. ej. "…SALAVERRY - 165160"): solo valen si coinciden con una OC conocida.
  const numeros = new Set<string>();
  for (const m of nom.matchAll(/(?<![\d.])0*(\d{6,10})(?![\d.])/g)) if (!ocs.has(m[1])) numeros.add(m[1]);

  const cotizaciones = new Set<string>();
  const reCot = [
    /cotizaci[oó]n\s*(?:n[°º.o]*|n[uú]mero|nro\.?)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/]{1,20}(?:\s?-\s?\d{2,4})?)/gi,
    /n[°º.]\s*(?:de\s+)?cotizaci[oó]n\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/]{1,20}(?:\s?-\s?\d{2,4})?)/gi,
  ];
  for (const re of reCot) {
    for (const m of texto.matchAll(re)) {
      const v = m[1].replace(/[-/]+$/, "").toUpperCase();
      if (/\d/.test(v) && !/^(19|20)\d{2}$/.test(v) && (v.replace(/\D/g, "").length >= 4 || /[A-Z]/.test(v))) cotizaciones.add(v);
      if (cotizaciones.size >= 6) break;
    }
  }

  let ruc: string | null = null;
  for (const m of texto.matchAll(/(?<!\d)((?:10|15|16|17|20)\d{9})(?!\d)/g)) {
    if (!RUC_PROPIOS.has(m[1])) { ruc = m[1]; break; }
  }

  let fecha: string | null = null;
  const mf = /fecha[^:\n]{0,20}[:.]?\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2,4})/i.exec(texto);
  if (mf) {
    const d = Number(mf[1]), mes = Number(mf[2]);
    let a = Number(mf[3]);
    if (a < 100) a += 2000;
    if (d >= 1 && d <= 31 && mes >= 1 && mes <= 12 && a >= 2015 && a <= 2100) {
      fecha = `${a}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  const resumen = limpiar([...resumenBase, nom].filter(Boolean).join(" · ")).slice(0, 600);
  return { ocs: [...ocs].slice(0, 6), numeros: [...numeros].slice(0, 6), cotizaciones: [...cotizaciones], ruc, fecha, resumen };
}

/** Valor de una etiqueta ("Asunto:", "Referencia:", "Servicio:"…), en la misma línea o en la siguiente. */
function etiquetas(lineas: string[]): string[] {
  const out: string[] = [];
  const re = /^(?:asunto|referencia|ref\.?|servicio|solicitud|t[ií]tulo|trabajo|descripci[oó]n del servicio|motivo)\s*[:.]\s*(.*)$/i;
  for (let i = 0; i < Math.min(lineas.length, 60) && out.length < 4; i++) {
    const m = re.exec(lineas[i]);
    if (!m) continue;
    // Sin valor en la misma línea: el valor son las 1-2 líneas siguientes (si no son otra etiqueta).
    const sig = [lineas[i + 1], lineas[i + 2]].filter((x) => x && !/^[A-Za-zÁÉÍÓÚáéíóúñÑ .]{2,25}\s*:/.test(x) && x.length <= 70);
    const v = limpiar(m[1]) || limpiar(sig.join(" "));
    if (v.length >= 4) out.push(v.slice(0, 160));
  }
  return out;
}

/** Lee el PDF y dice qué documento es, con sus pistas. Nunca lanza excepciones. */
export function leerDocumento(buf: Buffer, nombre: string): { ok: true; datos: DocumentoLeido } | { ok: false; error: string; noEsPdf?: boolean } {
  try {
    if (localizarPdf(buf) === null) return { ok: false, error: "El archivo no es un PDF válido", noEsPdf: true };
    const pdf = extraerPaginasPdf(buf);
    if (!pdf.ok) {
      // Escaneado o ilegible: solo queda el nombre del archivo.
      return {
        ok: true,
        datos: { tipo: tipoPorNombre(nombre) ?? "otro", titulo: null, escaneado: true, pistas: pistasDe("", nombre, []) },
      };
    }
    const lineas = pdf.paginas.flatMap((p) => p.lineas).map((l) => limpiar(l.texto));
    const texto = lineas.join("\n");
    const titulo = tituloDeDocumento(pdf.paginas);

    if (!titulo || titulo.tipo === "cotizacion") {
      const oc = titulo ? null : parsearOC(pdf.paginas, pdf.creado, nombre);
      if (oc?.ok && oc.datos.n_oc && oc.datos.total !== null) {
        const d = oc.datos;
        const desc = (d.descripcion ?? "").split(/;\s*atender en|;\s*contacto/i)[0];
        const pistas = pistasDe(d.descripcion ?? "", nombre, [desc]);
        pistas.ruc = d.ruc_proveedor ?? pistas.ruc;
        pistas.fecha = d.f_oc ?? pistas.fecha;
        pistas.ocs = pistas.ocs.filter((o) => o !== numeroOc(d.n_oc));
        return { ok: true, datos: { tipo: "oc", titulo: null, escaneado: false, pistas, oc: d } };
      }
      const cot = parsearCotizacion(pdf.paginas, pdf.creado);
      if (cot.ok && (cot.datos.total !== null || cot.datos.numero || titulo)) {
        const d = cot.datos;
        const pistas = pistasDe(texto, nombre, [d.solicitud ?? "", ...etiquetas(lineas)]);
        pistas.ruc = d.ruc_proveedor ?? pistas.ruc;
        pistas.fecha = d.fecha ?? pistas.fecha;
        // Su propio N° no es una "cita" a otra cotización.
        const propio = (d.numero ?? "").toUpperCase();
        pistas.cotizaciones = pistas.cotizaciones.filter((c) => c !== propio);
        return { ok: true, datos: { tipo: "cotizacion", titulo: titulo?.titulo ?? null, escaneado: false, pistas, cotizacion: d } };
      }
    }
    const tipo = titulo && titulo.tipo !== "cotizacion" ? titulo.tipo : tipoPorNombre(nombre) ?? "otro";
    const pistas = pistasDe(texto, nombre, [titulo?.titulo ?? "", ...etiquetas(lineas)]);
    return { ok: true, datos: { tipo, titulo: titulo?.titulo ?? null, escaneado: false, pistas } };
  } catch (e) {
    console.error("Error al interpretar el documento", e);
    return { ok: false, error: "No se pudo interpretar este PDF" };
  }
}
