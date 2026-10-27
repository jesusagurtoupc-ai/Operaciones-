// Tipos permitidos como adjunto. Se decide por extensión (no por el tipo
// que declara el navegador) y se excluyen a propósito SVG y HTML, que
// podrían ejecutar scripts al abrirse desde la propia página.
export const TIPOS_PERMITIDOS: Record<string, { mime: string; inline: boolean }> = {
  pdf: { mime: "application/pdf", inline: true },
  jpg: { mime: "image/jpeg", inline: true },
  jpeg: { mime: "image/jpeg", inline: true },
  png: { mime: "image/png", inline: true },
  webp: { mime: "image/webp", inline: true },
  gif: { mime: "image/gif", inline: true },
  doc: { mime: "application/msword", inline: false },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    inline: false,
  },
  xls: { mime: "application/vnd.ms-excel", inline: false },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    inline: false,
  },
};

// Vercel rechaza cuerpos de petición (y respuestas) de más de 4.5 MB en funciones. Por eso:
//  - hasta MAX_BYTES_DIRECTO el archivo se sube en una sola petición;
//  - los más pesados se parten en trozos de TAMANO_PARTE, que se suben (y se bajan) de a uno
//    y se guardan en la tabla `archivo_partes`. Quien los usa no nota la diferencia.
export const MAX_BYTES = 25 * 1024 * 1024; // máximo por archivo
export const MAX_MB = MAX_BYTES / (1024 * 1024);
export const MAX_BYTES_DIRECTO = 4 * 1024 * 1024;
export const TAMANO_PARTE = 3 * 1024 * 1024;
export const MAX_ARCHIVOS_POR_TICKET = 20;

/** Cuántos trozos de TAMANO_PARTE hacen falta para `tamano` bytes. */
export function numeroDePartes(tamano: number): number {
  return Math.ceil(tamano / TAMANO_PARTE);
}

/** Tamaño exacto que debe tener el trozo número `orden` (el último suele ser más corto). */
export function tamanoDeParte(tamano: number, orden: number): number {
  return Math.min(TAMANO_PARTE, tamano - orden * TAMANO_PARTE);
}

export function extensionDe(nombre: string): string {
  const i = nombre.lastIndexOf(".");
  return i === -1 ? "" : nombre.slice(i + 1).toLowerCase();
}

export type Archivo = {
  id: number;
  nombre: string;
  tipo: string;
  tamano: number;
  /** null = archivo en una sola pieza; N = guardado en N trozos. */
  partes?: number | null;
  subido_por: string | null;
  created_at: string;
};
