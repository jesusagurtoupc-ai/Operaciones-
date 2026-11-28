// Dónde se guardan los ADJUNTOS de los tickets.
//  - Con Vercel Blob conectado al proyecto (almacén PRIVADO): el archivo va a Blob y la base solo guarda
//    su ubicación. Abrir un PDF es mucho más rápido (llega tal cual, sin pasar por la base codificado en
//    base64) y la base de datos ya no se llena con los adjuntos.
//  - Sin Blob (o si Blob falla en ese momento): el archivo se guarda dentro de la base, como siempre.
// Los archivos nunca quedan públicos: el almacén es privado y solo esta app (con la sesión validada) los lee.
import { sql } from "./db";

/** ¿Hay un almacén de Vercel Blob conectado? (Vercel pone estas variables al conectarlo al proyecto). */
export function usaBlob(): boolean {
  return !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

const sdk = () => import("@vercel/blob");

/** Nombre seguro para la ruta dentro del almacén (el nombre real se guarda en la base). */
function rutaPara(nombre: string): string {
  const limpio = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(-80) || "archivo";
  return `adjuntos/${globalThis.crypto.randomUUID()}/${limpio}`;
}

export type EnBlob = { path: string; url: string };

/**
 * Sube el archivo a Blob. Devuelve su ubicación, o null si no hay Blob o falló (entonces el que llama lo
 * guarda en la base: el usuario nunca pierde la subida).
 */
export async function guardarEnBlob(nombre: string, tipo: string, buf: Buffer): Promise<EnBlob | null> {
  if (!usaBlob()) return null;
  try {
    const { put } = await sdk();
    const r = (await put(rutaPara(nombre), buf, { access: "private", contentType: tipo, addRandomSuffix: true })) as unknown as {
      pathname?: string; url?: string;
    };
    if (!r?.pathname || !r.url) throw new Error("respuesta inesperada de Blob");
    return { path: r.pathname, url: r.url };
  } catch (e) {
    console.error("[blob] no se pudo subir; se guarda en la base", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Borra archivos de Blob (mejor esfuerzo: si falla, solo queda un archivo huérfano en el almacén). */
export async function borrarDeBlob(urls: (string | null | undefined)[]): Promise<void> {
  const lista = urls.filter((u): u is string => typeof u === "string" && u.length > 0);
  if (lista.length === 0 || !usaBlob()) return;
  try {
    const { del } = await sdk();
    await del(lista);
  } catch (e) {
    console.warn("[blob] no se pudo borrar", lista.length, "archivo(s)", e instanceof Error ? e.message : e);
  }
}

/** Abre un archivo guardado en Blob como flujo (para enviarlo al navegador sin cargarlo entero). */
export async function abrirDeBlob(path: string): Promise<ReadableStream<Uint8Array> | null> {
  try {
    const { get } = await sdk();
    // (se lee la respuesta con una forma propia para no depender de los tipos exactos del SDK)
    const r = (await get(path, { access: "private" })) as unknown as {
      statusCode?: number; stream?: ReadableStream<Uint8Array> | null;
    } | null;
    if (!r || (r.statusCode !== undefined && r.statusCode !== 200) || !r.stream) return null;
    return r.stream;
  } catch (e) {
    console.error("[blob] no se pudo leer", path, e instanceof Error ? e.message : e);
    return null;
  }
}

/** El contenido completo de un adjunto (esté en Blob o en la base). */
export async function bytesDeArchivo(idArchivo: number, correctivoId: number): Promise<{ nombre: string; tipo: string; buf: Buffer } | null> {
  const filas = (await sql`
    SELECT nombre, tipo, blob_path, CASE WHEN blob_path IS NULL THEN encode(data, 'base64') END AS b64
    FROM archivos WHERE id = ${idArchivo} AND correctivo_id = ${correctivoId}
  `) as { nombre: string; tipo: string; blob_path: string | null; b64: string | null }[];
  const f = filas[0];
  if (!f) return null;
  if (f.blob_path) {
    const flujo = await abrirDeBlob(f.blob_path);
    if (!flujo) return null;
    return { nombre: f.nombre, tipo: f.tipo, buf: Buffer.from(await new Response(flujo).arrayBuffer()) };
  }
  return f.b64 === null ? null : { nombre: f.nombre, tipo: f.tipo, buf: Buffer.from(f.b64, "base64") };
}

// ───────── Traslado automático de los adjuntos antiguos (de la base a Blob) ─────────
// Al conectar Blob, los archivos que ya estaban en la base se mueven solos, de a poco y en segundo plano
// (al abrir la lista, como mucho cada 5 minutos por instancia, LOTE archivos por vez): nadie espera y la
// app funciona igual mientras tanto (un archivo se lee de donde esté).
const LOTE = 25;
const CADA_MS = 5 * 60 * 1000;
const gMig = globalThis as typeof globalThis & { __correctivosMigracionBlob?: number };

export async function trasladarABlob(): Promise<void> {
  if (!usaBlob()) return;
  const ahora = Date.now();
  if (gMig.__correctivosMigracionBlob && ahora - gMig.__correctivosMigracionBlob < CADA_MS) return;
  gMig.__correctivosMigracionBlob = ahora;
  try {
    // Primero solo cuáles (sin el contenido: 25 archivos de 4 MB juntos serían más de 100 MB en una
    // respuesta); después cada uno por separado.
    const pendientes = (await sql`
      SELECT id FROM archivos WHERE blob_path IS NULL AND data IS NOT NULL
      ORDER BY id LIMIT ${LOTE}
    `) as { id: number }[];
    let movidos = 0;
    for (const { id } of pendientes) {
      const filas = (await sql`
        SELECT nombre, tipo, encode(data, 'base64') AS b64 FROM archivos
        WHERE id = ${id} AND blob_path IS NULL AND data IS NOT NULL
      `) as { nombre: string; tipo: string; b64: string }[];
      const p = filas[0];
      if (!p) continue; // se borró o ya se movió mientras tanto
      const enBlob = await guardarEnBlob(p.nombre, p.tipo, Buffer.from(p.b64, "base64"));
      if (!enBlob) break; // Blob no responde: se reintenta en la próxima vuelta
      const r = await sql`
        UPDATE archivos SET blob_path = ${enBlob.path}, blob_url = ${enBlob.url}, data = NULL
        WHERE id = ${id} AND blob_path IS NULL
        RETURNING id
      `;
      if (r.length === 0) await borrarDeBlob([enBlob.url]); // alguien lo cambió o borró mientras tanto
      else movidos++;
    }
    if (movidos > 0) console.log(`[blob] ${movidos} adjunto(s) trasladados de la base a Blob`);
  } catch (e) {
    gMig.__correctivosMigracionBlob = 0;
    console.warn("[blob] traslado pausado:", e instanceof Error ? e.message : e);
  }
}
