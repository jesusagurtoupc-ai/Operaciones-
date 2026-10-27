// Extrae el texto de un PDF EN EL NAVEGADOR (el archivo no se sube a ningún servidor).
// pdf.js se carga solo al usarlo, para que no pese en el resto de la aplicación.

import { MAX_BYTES, MAX_MB } from "@/lib/shared/archivos";

export async function extraerTextoPdf(archivo: File): Promise<string> {
  if (archivo.size > MAX_BYTES) throw new Error(`El PDF pesa más de ${MAX_MB} MB`);
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const data = new Uint8Array(await archivo.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  try {
    const paginas: string[] = [];
    for (let n = 1; n <= Math.min(pdf.numPages, 20); n++) {
      const pagina = await pdf.getPage(n);
      const contenido = await pagina.getTextContent();
      paginas.push(
        contenido.items
          .map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : ""))
          .join("")
      );
    }
    return paginas.join("\n");
  } finally {
    await pdf.destroy();
  }
}
