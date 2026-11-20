"use client";

import type { Correctivo, DatosOC } from "@/lib/shared";
import { DOCUMENTOS } from "@/lib/shared";
import type { Archivo } from "@/lib/shared";
import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";

// ───────── carpetaLocal.ts ─────────
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

/** Nombre de la carpeta del ticket: "<N° Refer.>_<descripción>", ej. "1_Cambio de luminarias". */
export function nombreCarpetaTicket(c: Correctivo): string {
  const numero = c.refer ?? c.id;
  const desc = (c.descripcion ?? "").replace(/\s+/g, " ").trim().slice(0, 60).trim();
  // Windows no admite nombres que terminen en punto o espacio.
  return limpiarNombre(desc ? `${numero}_${desc}` : String(numero)).replace(/[. ]+$/, "");
}

/**
 * Crea (o actualiza) la carpeta del ticket dentro de la carpeta elegida:
 *
 *   123_Descripción del ticket/
 *     visita_tecnica/ <- archivo de la línea Visita técnica
 *     cotizacion/  <- archivo de la línea Cotización
 *     oc/          <- archivo de la línea OC
 *     informe/     <- archivo de la línea Informe
 *     certificado/ <- archivo de la línea Certificado
 *
 * Solo se guardan los archivos subidos a cada línea de documentos (no
 * hay fichas ni datos sueltos). Si una línea cambia de archivo, el
 * anterior se quita de su subcarpeta. Si el archivo ya está con el mismo
 * tamaño no se vuelve a bajar. Devuelve cuántos archivos se guardaron.
 */
export async function guardarTicket(
  raiz: DirHandle,
  c: Correctivo,
  archivos: Archivo[],
  /** Archivos que ya están en memoria (recién subidos), por id: no se vuelven a bajar del servidor. */
  locales?: Map<number, Blob>
): Promise<number> {
  const dir = await raiz.getDirectoryHandle(nombreCarpetaTicket(c), { create: true });
  let guardados = 0;

  for (const { clave } of DOCUMENTOS) {
    // Solo cuentan los archivos subidos a este ticket (no los enlaces web): el de la línea y sus adicionales.
    const linea = c.documentos?.[clave];
    const urls = [linea?.url ?? "", ...(linea?.adicionales ?? []).map((a) => a.url)];
    const delaLinea = urls
      .map((url) => url.match(/^\/api\/correctivos\/\d+\/archivos\/(\d+)$/))
      .map((m) => (m ? archivos.find((a) => a.id === Number(m[1])) : undefined))
      .filter((a): a is Archivo => !!a);
    if (delaLinea.length === 0) continue; // línea sin archivo: no se crea la subcarpeta

    const sub = await dir.getDirectoryHandle(clave, { create: true });
    // Dos archivos con el mismo nombre en la línea: al segundo se le antepone su id para no pisarlo.
    const nombreDe = new Map<number, string>();
    for (const a of delaLinea) {
      let n = limpiarNombre(a.nombre);
      if ([...nombreDe.values()].includes(n)) n = `${a.id}-${n}`;
      nombreDe.set(a.id, n);
    }
    const nombres = new Set(nombreDe.values());

    // Quita lo que ya no corresponde a la línea (archivos anteriores).
    const sobrantes: string[] = [];
    for await (const [existente] of (sub as DirHandle).entries()) {
      if (!nombres.has(existente)) sobrantes.push(existente);
    }
    for (const x of sobrantes) {
      await sub.removeEntry(x, { recursive: true }).catch(() => {});
    }

    for (const archivo of delaLinea) {
      const nombre = nombreDe.get(archivo.id)!;
      if ((await tamanoActual(sub, nombre)) === archivo.tamano) continue;
      const local = locales?.get(archivo.id);
      if (local) {
        await escribir(sub, nombre, local);
      } else {
        const res = await fetch(`/api/correctivos/${c.id}/archivos/${archivo.id}`);
        if (!res.ok) throw new Error(`No se pudo bajar "${archivo.nombre}"`);
        await escribir(sub, nombre, await res.blob());
      }
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
  forzar = true,
  locales?: Map<number, Blob>
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
    await guardarTicket(h, c, await listarArchivos(id), locales);
    ultimoAuto = Date.now();
    return "ok";
  } catch {
    return "error";
  }
}

// ───────── leerOC.ts ─────────
/** Evento con el que la sección Documentos le pasa al formulario la OC que acaba de leer. */
export const EVENTO_OC_LEIDA = "correctivo:oc-leida";

export function emitirOcLeida(datos: DatosOC) {
  window.dispatchEvent(new CustomEvent<DatosOC>(EVENTO_OC_LEIDA, { detail: datos }));
}

/**
 * Evento con el que "Leer OC" le pide a la sección Documentos que guarde el PDF leído como el
 * documento de la línea "Orden de compra" (así queda en el ticket y en la carpeta local).
 */
export const EVENTO_OC_GUARDAR = "correctivo:oc-guardar";

export function emitirOcGuardar(archivo: File) {
  // El servidor decide el tipo por la extensión: un PDF sin ".pdf" en el nombre se guarda con ella.
  const nombre = /\.pdf$/i.test(archivo.name) ? archivo.name : `${archivo.name || "oc"}.pdf`;
  const pdf = new File([archivo], nombre, { type: "application/pdf" });
  window.dispatchEvent(new CustomEvent<File>(EVENTO_OC_GUARDAR, { detail: pdf }));
}

/** Manda el PDF de la OC al servidor y devuelve lo que se leyó. Lanza Error con un mensaje claro. */
export async function leerOrdenCompra(archivo: Blob, nombre: string, excluirId?: number): Promise<DatosOC> {
  const fd = new FormData();
  fd.append("file", archivo, nombre);
  if (excluirId) fd.append("excluir", String(excluirId));
  const res = await fetch("/api/ordenes-compra/leer", { method: "POST", body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "No se pudo leer la orden de compra");
  return data.data as DatosOC;
}

// ───────── estado automático ─────────
/** Evento con el que Documentos avisa al formulario que el servidor cambió el estado (y la fecha de fin). */
export const EVENTO_ESTADO_AUTO = "correctivo:estado-auto";
export type EstadoAuto = { estado: string; f_fin: string };

export function emitirEstadoAuto(d: EstadoAuto) {
  window.dispatchEvent(new CustomEvent<EstadoAuto>(EVENTO_ESTADO_AUTO, { detail: d }));
}

/** Evento con el que Documentos avisa al formulario que el servidor completó datos vacíos (cotización leída). */
export const EVENTO_CAMPOS_AUTO = "correctivo:campos-auto";
export type CamposAuto = Partial<{ proveedor: string; ruc_proveedor: string; f_coti: string; monto: number; moneda: string; monto_usd: number; tipo_cambio: number }>;

export function emitirCamposAuto(c: CamposAuto) {
  window.dispatchEvent(new CustomEvent<CamposAuto>(EVENTO_CAMPOS_AUTO, { detail: c }));
}

// ───────── useMe.ts ─────────
export type Me = {
  username: string;
  rol: "admin" | "lectura";
  /** null = todas las páginas */
  paginas?: string[] | null;
  /** Campus de los datos que se ven ahora, los que puede ver y lo asignado ("*" = todos). */
  campus?: string;
  campusPermitidos?: string[];
  campusAsignado?: string;
};

let cache: Promise<Me | null> | null = null;

/** Olvida el usuario guardado (se llama al iniciar o cerrar sesión). */
export function resetMe() {
  cache = null;
}

/**
 * Usuario que el servidor ya conoce al armar la página (lo pone el layout): así el menú y los botones de
 * administrador salen en el primer dibujo, sin esperar a /api/auth/me. Va por contexto (no en una variable
 * global) para que en el servidor nunca se mezclen las sesiones de dos personas.
 */
const ContextoMe = createContext<Me | null>(null);
export function ProveedorMe({ me, children }: { me: Me | null; children: ReactNode }) {
  return createElement(ContextoMe.Provider, { value: me }, children, createElement(AvisoSinConexion));
}

/** Devuelve el usuario en sesión (null mientras carga). */
export function useMe(): Me | null {
  const delServidor = useContext(ContextoMe);
  const [me, setMe] = useState<Me | null>(delServidor);
  useEffect(() => {
    // El servidor ya lo dio (y tras iniciar/cerrar sesión la página se refresca con el nuevo).
    if (delServidor) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMe(delServidor);
      return;
    }
    if (!cache) {
      cache = fetch("/api/auth/me")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (d?.user as Me) ?? null)
        .catch(() => null);
    }
    let vivo = true;
    cache.then((u) => vivo && setMe(u));
    return () => {
      vivo = false;
    };
  }, [delServidor]);
  return me;
}

// ───────── Uso sin internet (public/sw.js) ─────────

/**
 * Borra todo lo que el equipo guardó para usar la app sin internet. Se llama al iniciar y al cerrar
 * sesión, para que otra persona que use el mismo equipo no vea datos ajenos.
 */
export async function borrarDatosSinConexion() {
  try {
    navigator.serviceWorker?.controller?.postMessage({ tipo: "borrar" });
    if ("caches" in window) await caches.delete("datos");
  } catch {
    /* el navegador no lo permite: nada que borrar */
  }
}

/** La lista avisa qué tickets muestra, para guardarlos en segundo plano y verlos luego sin internet. */
export function guardarTicketsSinConexion(ids: number[]) {
  try {
    // Solo en la app instalada (celular en campo): en el navegador de la PC no se precargan tickets,
    // porque cada uno es una ejecución en Vercel.
    const instalada = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    if (instalada && navigator.onLine && ids.length) navigator.serviceWorker?.controller?.postMessage({ tipo: "guardarTickets", ids });
  } catch {
    /* sin service worker: no pasa nada */
  }
}

/**
 * Registra el service worker y, cada vez que vuelve la conexión, envía solos los cambios de tickets que
 * quedaron pendientes en el equipo. Sin mensajes ni ventanas: todo pasa en segundo plano.
 */
function AvisoSinConexion() {
  useEffect(() => {
    // Solo en producción: en desarrollo guardaría código viejo y confundiría al programar.
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e) => console.warn("Sin modo sin conexión", e));
    }
    const enviar = () => void sincronizarPendientes();
    enviar();
    window.addEventListener("online", enviar);
    const cada = setInterval(enviar, 60_000); // por si el aviso "online" no llega (pasa en algunos celulares)
    return () => {
      window.removeEventListener("online", enviar);
      clearInterval(cada);
    };
  }, []);
  return null;
}

// ───────── Guardado automático de tickets (con cola para cuando no hay internet) ─────────

const CLAVE_PENDIENTES = "correctivos-cambios-pendientes";
type Datos = Record<string, unknown>;
/** Cambios de un ticket aún no confirmados por el servidor: cómo quedó el formulario y cómo estaba antes. */
export type Pendiente = { form: Datos; base: Datos; t: number; error?: string };

function leerPendientes(): Record<string, Pendiente> {
  try {
    const d = JSON.parse(localStorage.getItem(CLAVE_PENDIENTES) || "{}");
    return d && typeof d === "object" && !Array.isArray(d) ? d : {};
  } catch {
    return {};
  }
}
function escribirPendientes(p: Record<string, Pendiente>) {
  try {
    if (Object.keys(p).length) localStorage.setItem(CLAVE_PENDIENTES, JSON.stringify(p));
    else localStorage.removeItem(CLAVE_PENDIENTES);
  } catch {
    /* sin almacenamiento */
  }
}
export function pendienteDe(id: number): Pendiente | null {
  return leerPendientes()[id] ?? null;
}
export function guardarPendiente(id: number, form: Datos, base: Datos, error?: string) {
  const p = leerPendientes();
  // Si ya había uno, se conserva su "antes" original: así el servidor recibe todo lo cambiado.
  p[id] = { form, base: p[id]?.base ?? base, t: Date.now(), ...(error ? { error } : {}) };
  escribirPendientes(p);
}
export function quitarPendiente(id: number) {
  const p = leerPendientes();
  delete p[id];
  escribirPendientes(p);
}

/** Envía los cambios de un ticket. "sinRed" = no hay conexión (quedan en la cola y se envían luego). */
export async function enviarTicket(id: number, form: Datos, base: Datos, keepalive = false): Promise<"ok" | "sinRed" | { error: string }> {
  try {
    const res = await fetch(`/api/correctivos/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, _original: base }),
      keepalive,
    });
    if (res.ok) return "ok";
    const d = (await res.json().catch(() => ({}))) as { error?: string; sinConexion?: boolean };
    if (d.sinConexion || res.status >= 502) return "sinRed";
    return { error: d.error || "No se pudo guardar el registro" };
  } catch {
    return "sinRed";
  }
}

let sincronizando = false;
/** Envía, de uno en uno, los cambios que quedaron pendientes (sin conexión o al cerrar la app). */
export async function sincronizarPendientes() {
  if (sincronizando || typeof navigator === "undefined" || !navigator.onLine) return;
  sincronizando = true;
  try {
    for (const [k, p] of Object.entries(leerPendientes())) {
      if (p.error) continue; // necesita que alguien lo revise en el ticket
      const id = Number(k);
      const r = await enviarTicket(id, p.form, p.base);
      if (r === "sinRed") return;
      const ahora = leerPendientes()[k];
      if (!ahora || ahora.t !== p.t) continue; // mientras tanto hubo otro cambio: se envía en la próxima vuelta
      if (r === "ok") {
        quitarPendiente(id);
        window.dispatchEvent(new CustomEvent(EVENTO_TICKET_SINCRONIZADO, { detail: { id, form: p.form } }));
      } else guardarPendiente(id, p.form, p.base, r.error);
    }
  } finally {
    sincronizando = false;
  }
}
export const EVENTO_TICKET_SINCRONIZADO = "correctivos:ticket-sincronizado";

// ───────── "Crear ticket" desde la solicitud de materiales ─────────

/**
 * Un material lleva un N° de ticket que aún no existe: se anota aquí (2 horas) y el próximo ticket que
 * se cree desde una OC o cotización nace con ese N°, así la solicitud queda enlazada sola.
 */
const CLAVE_TICKET_POR_CREAR = "correctivos-ticket-por-crear";
export function marcarTicketPorCrear(codigo: string | null) {
  try {
    if (codigo) sessionStorage.setItem(CLAVE_TICKET_POR_CREAR, JSON.stringify({ codigo: codigo.slice(0, 40), t: Date.now() }));
    else sessionStorage.removeItem(CLAVE_TICKET_POR_CREAR);
  } catch {
    /* sin almacenamiento */
  }
}
export function ticketPorCrear(): string | null {
  try {
    const d = JSON.parse(sessionStorage.getItem(CLAVE_TICKET_POR_CREAR) || "null") as { codigo?: string; t?: number } | null;
    if (!d?.codigo || Date.now() - (d.t ?? 0) > 2 * 60 * 60_000) return null;
    return d.codigo;
  } catch {
    return null;
  }
}
/** Agrega el N° pendiente al envío que crea un ticket. Devuelve una función para darlo por usado. */
export function conTicketPorCrear(fd: FormData): () => void {
  const codigo = ticketPorCrear();
  if (!codigo) return () => undefined;
  fd.append("ticket", codigo);
  return () => marcarTicketPorCrear(null);
}
