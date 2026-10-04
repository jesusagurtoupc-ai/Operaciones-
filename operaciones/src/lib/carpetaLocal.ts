"use client";

import type { Correctivo } from "@/lib/types";
import { toDateOnly } from "@/lib/types";
import type { Archivo } from "@/lib/archivos";

// Guardado en una carpeta del equipo con la File System Access API
// (Chrome / Edge en computador). La carpeta elegida se recuerda en
// IndexedDB, así que solo se escoge una vez.

type PermisoModo = { mode: "readwrite" };
type DirHandle = FileSystemDirectoryHandle & {
  queryPermission(d: PermisoModo): Promise<PermissionState>;
  requestPermission(d: PermisoModo): Promise<PermissionState>;
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

const DB = "correctivos-carpeta";
const STORE = "handles";
const KEY = "raiz";

export function carpetaSoportada(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

function abrirDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function leerHandle(): Promise<DirHandle | null> {
  const db = await abrirDB();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE).objectStore(STORE).get(KEY);
    r.onsuccess = () => res((r.result as DirHandle) ?? null);
    r.onerror = () => rej(r.error);
  });
}

async function guardarHandle(h: DirHandle | null): Promise<void> {
  const db = await abrirDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    if (h) tx.objectStore(STORE).put(h, KEY);
    else tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

/** Nombre de la carpeta guardada, o null si todavía no se eligió. */
export async function nombreCarpetaGuardada(): Promise<string | null> {
  try {
    return (await leerHandle())?.name ?? null;
  } catch {
    return null;
  }
}

/** Abre el selector de carpetas del sistema y la deja guardada. */
export async function elegirCarpeta(): Promise<string | null> {
  try {
    const h = (await (
      window as unknown as {
        showDirectoryPicker(o: { mode: "readwrite" }): Promise<DirHandle>;
      }
    ).showDirectoryPicker({ mode: "readwrite" })) as DirHandle;
    await guardarHandle(h);
    return h.name;
  } catch (e) {
    if ((e as DOMException).name === "AbortError") return null; // canceló
    throw e;
  }
}

export async function olvidarCarpeta() {
  await guardarHandle(null);
}

/**
 * Devuelve la carpeta lista para escribir. Si el navegador pide
 * confirmar el permiso (pasa al reabrirlo), se pide aquí: debe
 * llamarse desde un clic del usuario.
 */
export async function carpetaLista(): Promise<DirHandle | null> {
  const h = await leerHandle();
  if (!h) return null;
  const opts: PermisoModo = { mode: "readwrite" };
  if ((await h.queryPermission(opts)) === "granted") return h;
  if ((await h.requestPermission(opts)) === "granted") return h;
  throw new Error("Sin permiso para escribir en la carpeta");
}

function limpiarNombre(s: string): string {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 120) || "archivo";
}

async function escribir(dir: FileSystemDirectoryHandle, nombre: string, data: Blob | string) {
  const fh = await dir.getFileHandle(nombre, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}

async function tamanoActual(dir: FileSystemDirectoryHandle, nombre: string): Promise<number | null> {
  try {
    return (await (await dir.getFileHandle(nombre)).getFile()).size;
  } catch {
    return null;
  }
}

const ETIQUETAS: [keyof Correctivo, string][] = [
  ["refer", "N° Refer."],
  ["ticket", "Ticket"],
  ["f_reg", "Fecha de registro"],
  ["descripcion", "Descripción"],
  ["lugar", "Lugar"],
  ["area", "Área"],
  ["tipo_trab", "Tipo de trabajo"],
  ["sub_tipo_trab", "Sub tipo de trabajo"],
  ["estado", "Estado"],
  ["proveedor", "Proveedor"],
  ["monto", "Monto (S/)"],
  ["n_oc", "N° OC"],
  ["cuenta", "Cuenta"],
  ["f_coti", "F. Cotización"],
  ["f_ps", "F. PS"],
  ["f_oc", "F. OC"],
  ["f_inicio", "F. Inicio"],
  ["f_fin", "F. Fin"],
  ["obs_cot", "Observaciones de cotización"],
  ["evaluacion", "Evaluación"],
];

const FECHAS = new Set(["f_reg", "f_coti", "f_ps", "f_oc", "f_inicio", "f_fin"]);

function fichaTexto(c: Correctivo): string {
  const lineas = ETIQUETAS.map(([k, etiqueta]) => {
    const v = c[k];
    const texto = FECHAS.has(k) ? toDateOnly(v) : v === null || v === undefined ? "" : String(v);
    return `${etiqueta}: ${texto || "—"}`;
  });
  return `FICHA DEL TICKET #${c.refer ?? c.id}\r\n${"=".repeat(40)}\r\n${lineas.join("\r\n")}\r\n`;
}

export function nombreCarpetaTicket(c: Correctivo): string {
  return limpiarNombre(`Ticket ${c.refer ?? c.id}`);
}

/**
 * Crea (o actualiza) la carpeta independiente del ticket dentro de la
 * carpeta elegida: ficha.txt + datos.json + adjuntos/ con sus archivos.
 * Los adjuntos que ya están con el mismo tamaño no se vuelven a bajar.
 * Devuelve cuántos adjuntos se guardaron.
 */
export async function guardarTicket(
  raiz: DirHandle,
  c: Correctivo,
  archivos: Archivo[]
): Promise<number> {
  const dir = await raiz.getDirectoryHandle(nombreCarpetaTicket(c), { create: true });
  await escribir(dir, "ficha.txt", fichaTexto(c));
  await escribir(dir, "datos.json", JSON.stringify(c, null, 2));

  let guardados = 0;
  if (archivos.length > 0) {
    const adj = await dir.getDirectoryHandle("adjuntos", { create: true });
    const usados = new Set<string>();
    for (const a of archivos) {
      let nombre = limpiarNombre(a.nombre);
      if (usados.has(nombre.toLowerCase())) nombre = `${a.id}_${nombre}`;
      usados.add(nombre.toLowerCase());
      if ((await tamanoActual(adj, nombre)) === a.tamano) continue;
      const res = await fetch(`/api/correctivos/${c.id}/archivos/${a.id}`);
      if (!res.ok) throw new Error(`No se pudo bajar "${a.nombre}"`);
      await escribir(adj, nombre, await res.blob());
      guardados++;
    }
  }
  return guardados;
}

export async function listarArchivos(id: number): Promise<Archivo[]> {
  const res = await fetch(`/api/correctivos/${id}/archivos`);
  if (!res.ok) throw new Error("No se pudo leer la lista de archivos");
  return (await res.json()).data as Archivo[];
}

// ───────────── Guardado automático ─────────────

const AUTO_KEY = "correctivos-autoguardado";

/** Activado por defecto; solo tiene efecto si ya hay una carpeta elegida. */
export function autoActivado(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setAutoActivado(v: boolean) {
  try {
    localStorage.setItem(AUTO_KEY, v ? "1" : "0");
  } catch {
    /* sin almacenamiento disponible: se queda en el valor por defecto */
  }
}

/**
 * Se llama justo al hacer clic en "Guardar": si el navegador había
 * quitado el permiso (pasa al reabrirlo), lo vuelve a pedir en ese
 * momento, que es cuando el navegador lo permite. Nunca lanza error.
 */
export async function prepararAutoguardado(): Promise<boolean> {
  if (!carpetaSoportada() || !autoActivado()) return false;
  try {
    return (await carpetaLista()) !== null;
  } catch {
    return false;
  }
}

let ultimoAuto = 0;

/**
 * Guarda el ticket en la carpeta elegida SIN mostrar ningún aviso del
 * navegador. Si no hay carpeta, está desactivado o falta el permiso,
 * simplemente no hace nada. Con `forzar` ignora el intervalo mínimo.
 */
export async function autoGuardarTicket(
  id: number,
  forzar = true
): Promise<"ok" | "omitido" | "error"> {
  try {
    if (!carpetaSoportada() || !autoActivado()) return "omitido";
    if (!forzar && Date.now() - ultimoAuto < 20_000) return "omitido";
    const h = await leerHandle();
    if (!h) return "omitido";
    if ((await h.queryPermission({ mode: "readwrite" })) !== "granted") return "omitido";

    const res = await fetch(`/api/correctivos/${id}`);
    if (!res.ok) return "error";
    const c = (await res.json()).data as Correctivo;
    await guardarTicket(h, c, await listarArchivos(id));
    ultimoAuto = Date.now();
    return "ok";
  } catch {
    return "error";
  }
}
