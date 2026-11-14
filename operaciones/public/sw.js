/*
 * Service worker de la app "Correctivos": permite seguir usándola SIN INTERNET en el celular o la PC.
 *
 *  - Con conexión todo funciona igual que siempre (siempre se pide primero al servidor) y, de paso, se
 *    guarda en este dispositivo una copia de lo que se va viendo: páginas, lista, tickets, panel,
 *    catálogo de materiales y documentos (hasta 8 MB cada uno).
 *  - Al ver la lista de correctivos, se guardan además en segundo plano los tickets que muestra (los que
 *    no se guardaron en el último día; máx. 15), solo en la app instalada. La lista avisa cuáles son
 *    (mensaje "guardarTickets").
 *  - Los documentos de un ticket no cambian nunca para un mismo N° de archivo: se toman del equipo si ya
 *    están, sin volver a descargarlos de Vercel.
 *  - Sin conexión se muestra la última copia guardada. Los cambios (guardar, subir, borrar) NO se pueden
 *    hacer: se responde un mensaje claro en vez de perderlos en silencio.
 *  - Al cerrar sesión, al iniciar sesión o si la sesión vence, se borra todo lo guardado (para que otra
 *    persona que use el mismo equipo no vea datos ajenos).
 *
 * Cambiar VERSION obliga a renovar las copias de la estructura de la app.
 */
const VERSION = "v2";
const ESTATICOS = "estaticos-" + VERSION; // código de la app (_next/static): nunca cambia para una misma URL
const DATOS = "datos"; // páginas y respuestas de la API, de la sesión actual
const MAX_ARCHIVO = 8 * 1024 * 1024;
const FRESCO_MS = 24 * 60 * 60 * 1000; // un ticket guardado hace menos de 1 día no se vuelve a pedir
const MAX_TICKETS = 15;
const MAX_DATOS = 400; // copias guardadas (páginas, respuestas, documentos); las más viejas se descartan
const MAX_ESTATICOS = 500;

/** Deja como máximo `max` entradas en una caché, descartando las guardadas primero. */
async function recortar(nombre, max) {
  const c = await caches.open(nombre);
  const ks = await c.keys();
  for (const k of ks.slice(0, Math.max(0, ks.length - max))) await c.delete(k);
}
let escrituras = 0;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(ESTATICOS).then((c) => c.addAll(["/logo-upc.png", "/icon.png"]).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith("estaticos-") && k !== ESTATICOS).map((k) => caches.delete(k))))
      .then(() => recortar(ESTATICOS, MAX_ESTATICOS))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.tipo === "borrar") e.waitUntil(borrarDatos());
  if (e.data && e.data.tipo === "guardarTickets" && Array.isArray(e.data.ids)) {
    e.waitUntil(guardarTickets(e.data.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0)).catch(() => {}));
  }
});

function borrarDatos() {
  return caches.delete(DATOS);
}

const jsonSinConexion = (mensaje) =>
  new Response(JSON.stringify({ error: mensaje, sinConexion: true }), {
    status: 503,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const MSG_CAMBIO =
  "Sin conexión a internet: este cambio no se guardó. Vuelve a intentarlo cuando tengas conexión.";
const MSG_LECTURA = "Sin conexión a internet y este dato no está guardado en el equipo.";

// Lo que nunca se guarda: inicio/cierre de sesión, exportaciones a Excel y lecturas de documentos con IA.
const NO_GUARDAR = /^\/api\/(auth\/|export|cotizaciones\/leer|documentos\/leer|ordenes-compra\/leer)/;

/** Quita el sello de tiempo que algunas pantallas agregan para no recibir copias viejas. */
function claveDe(url) {
  const u = new URL(url);
  u.searchParams.delete("_rsc");
  u.searchParams.delete("_");
  u.searchParams.delete("t");
  return u.toString();
}

async function guardar(req, resp, clave) {
  if (!resp || resp.status !== 200 || resp.type !== "basic" || resp.redirected) return;
  const largo = Number(resp.headers.get("Content-Length") || 0);
  if (largo > MAX_ARCHIVO) return;
  const copia = resp.clone();
  if (!largo) {
    const b = await copia.clone().blob().catch(() => null);
    if (!b || b.size > MAX_ARCHIVO) return;
  }
  const c = await caches.open(DATOS);
  // Se anota cuándo se guardó, para saber si una copia está "fresca".
  const h = new Headers(copia.headers);
  h.set("X-Guardado-En", String(Date.now()));
  const cuerpo = await copia.blob();
  const k = clave || claveDe(req.url);
  await c.delete(k); // al volver a guardarla pasa a ser la más nueva
  await c.put(k, new Response(cuerpo, { status: 200, statusText: "OK", headers: h }));
  if (++escrituras % 25 === 0) await recortar(DATOS, MAX_DATOS);
}

/** Primero el servidor; si no hay conexión, la copia guardada. */
async function redPrimero(e, siFalla) {
  const req = e.request;
  try {
    const resp = await fetch(req);
    // Sesión vencida o cerrada: lo guardado deja de ser de alguien con sesión → se borra.
    if (resp.status === 401) e.waitUntil(borrarDatos());
    else if (resp.redirected && new URL(resp.url).pathname === "/login") e.waitUntil(borrarDatos());
    else e.waitUntil(guardar(req, resp.clone()).catch(() => {}));
    return resp;
  } catch {
    const c = await caches.open(DATOS);
    const guardada = await c.match(claveDe(req.url));
    if (guardada) return guardada;
    return siFalla();
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Cambios: van directo al servidor; sin conexión, un mensaje claro (las pantallas lo muestran).
  if (req.method !== "GET") {
    e.respondWith(fetch(req).catch(() => jsonSinConexion(MSG_CAMBIO)));
    return;
  }

  // Código de la app: no cambia para una misma URL → del equipo, y si no está, del servidor.
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(
      caches.open(ESTATICOS).then(async (c) => {
        const g = await c.match(req);
        if (g) return g;
        const r = await fetch(req);
        if (r.ok) c.put(req, r.clone());
        return r;
      })
    );
    return;
  }

  if (url.pathname === "/sw.js" || url.pathname.startsWith("/_next/")) return;

  // Datos internos de navegación de Next (RSC): sin conexión, al fallar, Next abre la página completa,
  // que sí está guardada. No se guardan porque dependen de la pantalla de origen.
  if (req.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) return;

  if (url.pathname.startsWith("/api/")) {
    if (/^\/api\/correctivos\/\d+\/archivos\/\d+$/.test(url.pathname)) {
      e.respondWith(
        caches.open(DATOS).then(async (c) => (await c.match(claveDe(req.url))) || redPrimero(e, () => jsonSinConexion(MSG_LECTURA)))
      );
      return;
    }
    if (NO_GUARDAR.test(url.pathname)) {
      e.respondWith(fetch(req).catch(() => jsonSinConexion("Sin conexión a internet.")));
      return;
    }
    e.respondWith(redPrimero(e, () => jsonSinConexion(MSG_LECTURA)));
    return;
  }

  // Páginas (y archivos de public/, como el catálogo de materiales).
  if (req.mode === "navigate") {
    if (url.pathname === "/login") return;
    e.respondWith(redPrimero(e, () => paginaSinConexion(url)));
    return;
  }
  e.respondWith(redPrimero(e, () => new Response("", { status: 504 })));
});

/** Guarda en segundo plano (de a uno, sin apuro) los tickets que muestra la lista. */
let guardando = false;
async function guardarTickets(lista) {
  if (guardando) return; // ya hay una tanda en curso
  guardando = true;
  try {
    await guardarTanda([...new Set(lista)].slice(0, MAX_TICKETS));
  } finally {
    guardando = false;
  }
}

async function guardarTanda(ids) {
  const c = await caches.open(DATOS);
  const est = await caches.open(ESTATICOS);
  for (const id of ids) {
    const u = new URL("/correctivos/" + id, self.location.origin).toString();
    const g = await c.match(u);
    if (g && Date.now() - Number(g.headers.get("X-Guardado-En") || 0) < FRESCO_MS) continue;
    try {
      const r = await fetch(u, { credentials: "same-origin" });
      if (r.redirected || r.status === 401) return; // la sesión terminó: no seguir
      if (r.status !== 200) continue;
      const html = await r.clone().text();
      await guardar(new Request(u), r);
      // El código que usa la página del ticket (por si nunca se abrió un ticket en este equipo).
      for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"?#]+)"/g)) {
        if (!(await est.match(m[1]))) {
          const s = await fetch(m[1]).catch(() => null);
          if (s && s.ok) await est.put(m[1], s);
        }
      }
    } catch {
      return; // se cortó la conexión
    }
  }
}

function paginaSinConexion(url) {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Sin conexión · Correctivos</title>
<style>body{font-family:system-ui,sans-serif;margin:0;background:#f6f6f7;color:#131722;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
.c{background:#fff;border:1px solid #dcdcdf;border-top:4px solid #d0112d;max-width:420px;padding:24px}
h1{font-size:20px;margin:0 0 8px}p{font-size:14px;line-height:1.5;color:#4a4f5c}a,button{display:inline-block;margin:8px 8px 0 0;padding:10px 14px;border:1px solid #131722;background:#131722;color:#fff;text-decoration:none;font-size:14px;border-radius:6px}
a.s{background:#fff;color:#131722}</style></head><body><div class="c">
<h1>Sin conexión a internet</h1>
<p>Esta página (<b>${url.pathname.replace(/[<>&"]/g, "")}</b>) no está guardada en este equipo. Sin internet solo se pueden ver las páginas y tickets que ya se abrieron antes con conexión.</p>
<button onclick="location.reload()">Reintentar</button><a class="s" href="/correctivos">Ir a la lista guardada</a>
</div></body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
