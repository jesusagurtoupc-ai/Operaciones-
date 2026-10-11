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
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    inline: false,
  },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    inline: false,
  },
};

// Vercel rechaza cuerpos de petición de más de 4.5 MB en funciones.
export const MAX_BYTES = 4 * 1024 * 1024;
export const MAX_ARCHIVOS_POR_TICKET = 20;

export function extensionDe(nombre: string): string {
  const i = nombre.lastIndexOf(".");
  return i === -1 ? "" : nombre.slice(i + 1).toLowerCase();
}

const ascii = (b: Uint8Array, desde: number, texto: string) =>
  texto.length + desde <= b.length &&
  [...texto].every((c, i) => b[desde + i] === c.charCodeAt(0));
const bytes = (b: Uint8Array, desde: number, esperado: number[]) =>
  desde + esperado.length <= b.length && esperado.every((v, i) => b[desde + i] === v);

/**
 * Comprueba que el contenido del archivo corresponda a su extensión mirando
 * los primeros bytes ("firma"). Evita que un ejecutable o un HTML se guarde
 * con el nombre "informe.pdf". `inicio` son los primeros bytes del archivo
 * (basta con 1024).
 */
export function firmaCoincide(extension: string, inicio: Uint8Array): boolean {
  switch (extension) {
    case "pdf": {
      // Algunos PDF traen unos bytes basura antes de "%PDF-"; el estándar admite hasta 1024.
      const limite = Math.min(inicio.length, 1024) - 5;
      for (let i = 0; i <= limite; i++) if (ascii(inicio, i, "%PDF-")) return true;
      return false;
    }
    case "jpg":
    case "jpeg":
      return bytes(inicio, 0, [0xff, 0xd8, 0xff]);
    case "png":
      return bytes(inicio, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "gif":
      return ascii(inicio, 0, "GIF87a") || ascii(inicio, 0, "GIF89a");
    case "webp":
      return ascii(inicio, 0, "RIFF") && ascii(inicio, 8, "WEBP");
    case "docx":
    case "xlsx":
      // Los formatos nuevos de Office son archivos ZIP.
      return bytes(inicio, 0, [0x50, 0x4b, 0x03, 0x04]);
    default:
      return false;
  }
}

export type Archivo = {
  id: number;
  nombre: string;
  tipo: string;
  tamano: number;
  subido_por: string | null;
  created_at: string;
};

/**
 * Enlace de un documento que se puede mostrar: un archivo del propio ticket
 * (/api/correctivos/<id>/archivos/<n>) o una dirección http(s)://, igual que lo que
 * acepta el servidor al guardar. Cualquier otra cosa (javascript:, data:, rutas ajenas) devuelve null y no se pinta como enlace.
 */
export function urlDocumentoSegura(url: string, ticketId?: number | string): string | null {
  const u = (url ?? "").trim();
  if (!u) return null;
  const propio = /^\/api\/correctivos\/(\d+)\/archivos\/\d+$/.exec(u);
  if (propio) return ticketId === undefined || String(ticketId) === propio[1] ? u : null;
  try {
    const { protocol } = new URL(u);
    return protocol === "https:" || protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

/**
 * Detecta PDF con scripts o acciones activas (/JavaScript, /JS, /Launch, /RichMedia): los visores
 * los ejecutan al abrirlos. Es una comprobación de la estructura visible del archivo (los
 * nombres con #xx se decodifican), no un antivirus: no ve contenido dentro de flujos comprimidos.
 */
export function pdfTieneContenidoActivo(bytes: Uint8Array): boolean {
  const texto = new TextDecoder("latin1")
    .decode(bytes)
    .replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  return /\/(JavaScript|JS|Launch|RichMedia)(?![A-Za-z])/.test(texto);
}
