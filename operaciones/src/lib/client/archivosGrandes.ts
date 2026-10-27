"use client";

import {
  MAX_BYTES,
  MAX_BYTES_DIRECTO,
  MAX_MB,
  TAMANO_PARTE,
  numeroDePartes,
} from "@/lib/shared/archivos";

// Subir y bajar archivos de un ticket, de cualquier tamaño hasta MAX_BYTES.
// Vercel limita cada petición/respuesta a 4.5 MB, así que los archivos pesados viajan partidos en
// trozos (ver src/lib/shared/archivos.ts); estas dos funciones lo esconden: quien las llama pasa
// o recibe el archivo entero.

/**
 * Sube un archivo al ticket y devuelve su id y su enlace (/api/correctivos/<id>/archivos/<n>).
 * Si algo falla a mitad de camino, borra lo que alcanzó a subir y lanza un Error con el motivo.
 */
export async function subirArchivoTicket(
  correctivoId: number,
  archivo: File
): Promise<{ id: number; url: string }> {
  if (archivo.size > MAX_BYTES) {
    throw new Error(`${archivo.name}: supera el máximo de ${MAX_MB} MB`);
  }
  const base = `/api/correctivos/${correctivoId}/archivos`;

  // Archivo normal: una sola petición.
  if (archivo.size <= MAX_BYTES_DIRECTO) {
    const fd = new FormData();
    fd.append("file", archivo);
    const up = await fetch(base, { method: "POST", body: fd });
    const datos = await up.json().catch(() => ({}));
    if (!up.ok) throw new Error(datos.error || "No se pudo subir el archivo");
    return { id: datos.data.id, url: `${base}/${datos.data.id}` };
  }

  // Archivo pesado: primero se abre la subida y luego se mandan los trozos uno por uno.
  const ini = await fetch(base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre: archivo.name, tamano: archivo.size }),
  });
  const iniDatos = await ini.json().catch(() => ({}));
  if (!ini.ok) throw new Error(iniDatos.error || "No se pudo iniciar la subida del archivo");
  const id: number = iniDatos.data.id;
  const url = `${base}/${id}`;

  try {
    const total = numeroDePartes(archivo.size);
    let completo = false;
    for (let i = 0; i < total; i++) {
      const trozo = archivo.slice(i * TAMANO_PARTE, Math.min(archivo.size, (i + 1) * TAMANO_PARTE));
      completo = (await subirTrozo(`${url}/partes/${i}`, trozo)).completo === true;
    }
    if (!completo) throw new Error("La subida del archivo quedó incompleta");
  } catch (e) {
    await fetch(url, { method: "DELETE" }).catch(() => {});
    throw e;
  }
  return { id, url };
}

/** Manda un trozo. Reintenta si falló la conexión o el servidor (es seguro repetirlo). */
async function subirTrozo(url: string, trozo: Blob): Promise<{ completo?: boolean }> {
  let ultimo = "No se pudo subir el archivo";
  for (let intento = 0; intento < 3; intento++) {
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: trozo,
      });
      const datos = await res.json().catch(() => ({}));
      if (res.ok) return datos;
      ultimo = datos.error || ultimo;
      if (res.status < 500) break; // un error 4xx no se arregla repitiendo
    } catch {
      ultimo = "Se cortó la conexión al subir el archivo";
    }
  }
  throw new Error(ultimo);
}

/** Baja un archivo del ticket (de una pieza o en trozos) y lo entrega completo. */
export async function bajarArchivo(url: string): Promise<{ blob: Blob; nombre: string }> {
  const primera = await fetch(`${url}?parte=0`);
  if (!primera.ok) throw new Error("No se pudo bajar el archivo");
  const total = Number(primera.headers.get("X-Partes") ?? "1") || 1;
  const tipo = primera.headers.get("Content-Type") ?? "";
  let nombre = "archivo";
  try {
    nombre = decodeURIComponent(primera.headers.get("X-Archivo-Nombre") ?? "") || nombre;
  } catch {
    /* nombre mal codificado: se queda el genérico */
  }

  const trozos: Blob[] = [await primera.blob()];
  for (let i = 1; i < total; i++) {
    const res = await fetch(`${url}?parte=${i}`);
    if (!res.ok) throw new Error("No se pudo bajar el archivo completo");
    trozos.push(await res.blob());
  }
  return { blob: new Blob(trozos, { type: tipo }), nombre };
}
