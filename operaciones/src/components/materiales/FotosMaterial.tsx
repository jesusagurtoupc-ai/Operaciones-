"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Fotos de un material fuera del catálogo: miniatura junto al material y visor a pantalla completa
 * (igual que el de los documentos del ticket), con flechas para pasar de una foto a otra.
 * Los administradores pueden agregar (desde el celular abre la cámara) y borrar fotos.
 *
 * Las fotos de todos los materiales visibles se piden juntas en UNA consulta (no una por fila), y se
 * recuerdan mientras la página está abierta.
 */

export type Foto = { id: number; nombre: string };

const urlFoto = (id: number) => `/api/materiales/fotos?id=${id}`;

/** Búsqueda de imágenes del material en Google (en otra pestaña): para encontrar la foto real del
 *  producto, guardarla y subirla con "📷 Foto". Se quitan textos internos que no ayudan a buscar. */
export function urlBuscarFoto(descripcion: string) {
  const q = descripcion
    .replace(/\bC[OÓ]DIGO\s*:?/gi, " ")
    .replace(/\bUPC\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`;
}

// ───────── índice compartido: clave del material → sus fotos ─────────
const indice = new Map<string, Foto[]>();
const oyentes = new Set<() => void>();
let version = 0;
const pendientes = new Set<string>();
let temporizador: ReturnType<typeof setTimeout> | null = null;

function avisar() {
  version++;
  oyentes.forEach((f) => f());
}

function pedir(clave: string) {
  if (indice.has(clave) || pendientes.has(clave)) return;
  pendientes.add(clave);
  if (temporizador) return;
  // Junta lo que pidan todas las filas que se dibujan a la vez y hace una sola consulta.
  temporizador = setTimeout(async () => {
    temporizador = null;
    const claves = [...pendientes];
    pendientes.clear();
    for (let i = 0; i < claves.length; i += 200) {
      const lote = claves.slice(i, i + 200);
      const qs = new URLSearchParams();
      lote.forEach((c) => qs.append("clave", c));
      try {
        const res = await fetch(`/api/materiales/fotos?${qs}`);
        const d = await res.json().catch(() => ({}));
        if (!res.ok) continue;
        for (const c of lote) indice.set(c, d.data?.[c] ?? []);
      } catch {
        // sin conexión: se vuelve a intentar la próxima vez que se dibuje
      }
    }
    avisar();
  }, 60);
}

function suscribir(f: () => void) {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

function useFotos(clave: string): Foto[] | undefined {
  useSyncExternalStore(suscribir, () => version, () => 0);
  useEffect(() => {
    if (clave) pedir(clave);
  }, [clave]);
  return indice.get(clave);
}

/** Reduce la foto antes de subirla (máx. 1600 px, JPG): sube rápido aunque venga del celular. */
async function reducir(f: File): Promise<Blob> {
  try {
    const img = await createImageBitmap(f);
    const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * escala);
    canvas.height = Math.round(img.height * escala);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.82));
    if (blob && blob.size > 0) return blob;
  } catch {
    // formato que el navegador no puede abrir (p. ej. HEIC): se intenta subir tal cual
  }
  return f;
}

async function subir(clave: string, archivos: File[]): Promise<string> {
  const errores: string[] = [];
  for (const f of archivos) {
    const datos = await reducir(f);
    const fd = new FormData();
    fd.append("clave", clave);
    fd.append("file", datos, f.name.replace(/\.[^.]+$/, "") + (datos === f ? "" : ".jpg"));
    const res = await fetch("/api/materiales/fotos", { method: "POST", body: fd });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      errores.push(`${f.name}: ${d.error || "no se pudo subir"}`);
    }
  }
  indice.delete(clave);
  pedir(clave);
  return errores.join(" · ");
}

// ───────── fotos para el PDF de la solicitud ─────────

/** Convierte una imagen (JPG, PNG o WEBP) a JPG chico (máx. 500 px): así el PDF no pesa de más. */
async function aJpgChico(blob: Blob): Promise<Uint8Array | null> {
  try {
    const img = await createImageBitmap(blob);
    const escala = Math.min(1, 500 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * escala));
    canvas.height = Math.max(1, Math.round(img.height * escala));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff"; // fondo blanco para las PNG con transparencia
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.close();
    const jpg = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.8));
    return jpg ? new Uint8Array(await jpg.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/**
 * La primera foto de cada material fuera del catálogo de la solicitud, lista para el PDF
 * (uid de la línea → JPG). Los materiales sin foto, o si algo falla, simplemente no la llevan.
 */
export async function fotosParaPdf(lineas: { uid: string; clave: string }[]): Promise<Record<string, Uint8Array>> {
  const res: Record<string, Uint8Array> = {};
  const claves = [...new Set(lineas.map((l) => l.clave))].filter((c) => c.startsWith("libre:"));
  if (claves.length === 0) return res;
  // Índice de fotos de esos materiales (lo que ya está en memoria no se vuelve a pedir).
  const faltan = claves.filter((c) => !indice.has(c));
  for (let i = 0; i < faltan.length; i += 200) {
    const qs = new URLSearchParams();
    faltan.slice(i, i + 200).forEach((c) => qs.append("clave", c));
    try {
      const r = await fetch(`/api/materiales/fotos?${qs}`);
      const d = await r.json().catch(() => ({}));
      if (r.ok) for (const c of faltan.slice(i, i + 200)) indice.set(c, d.data?.[c] ?? []);
    } catch {
      // sin conexión: el PDF sale sin fotos
    }
  }
  const porClave = new Map<string, Promise<Uint8Array | null>>();
  await Promise.all(
    lineas.map(async (l) => {
      const primera = indice.get(l.clave)?.[0];
      if (!primera) return;
      if (!porClave.has(l.clave)) {
        porClave.set(
          l.clave,
          fetch(urlFoto(primera.id))
            .then((r) => (r.ok ? r.blob() : null))
            .then((b) => (b ? aJpgChico(b) : null))
            .catch(() => null)
        );
      }
      const jpg = await porClave.get(l.clave);
      if (jpg) res[l.uid] = jpg;
    })
  );
  return res;
}

// ───────── miniatura + visor ─────────

export default function FotosMaterial({
  clave,
  descripcion,
  editable,
}: {
  clave: string;
  descripcion: string;
  /** Administradores: pueden agregar y borrar fotos. */
  editable: boolean;
}) {
  const fotos = useFotos(clave);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const entrada = useRef<HTMLInputElement>(null);

  const lista = fotos ?? [];
  const actual = abierto !== null && lista.length > 0 ? Math.min(abierto, lista.length - 1) : null;

  // Teclado en el visor: ← → para pasar de foto, Esc para cerrar.
  useEffect(() => {
    if (actual === null) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(null);
      if (e.key === "ArrowRight") setAbierto((i) => ((i ?? 0) + 1) % lista.length);
      if (e.key === "ArrowLeft") setAbierto((i) => ((i ?? 0) - 1 + lista.length) % lista.length);
    };
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [actual, lista.length]);

  async function alElegir(e: React.ChangeEvent<HTMLInputElement>) {
    const archivos: File[] = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (archivos.length === 0) return;
    setOcupado(true);
    setError("");
    const err = await subir(clave, archivos);
    setOcupado(false);
    if (err) setError(err);
    else if (abierto === null) setAbierto(lista.length); // abre el visor en la foto recién subida
  }

  async function borrar(f: Foto) {
    if (!confirm(`¿Borrar la foto «${f.nombre}» de este material?`)) return;
    setOcupado(true);
    const res = await fetch(`/api/materiales/fotos?id=${f.id}`, { method: "DELETE" });
    setOcupado(false);
    if (!res.ok) {
      setError("No se pudo borrar la foto");
      return;
    }
    indice.set(clave, lista.filter((x) => x.id !== f.id));
    avisar();
    if (lista.length <= 1) setAbierto(null);
  }

  const selector = (
    <input
      ref={entrada}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/*"
      multiple
      className="hidden"
      onChange={alElegir}
      aria-label={`Agregar fotos de ${descripcion}`}
    />
  );

  return (
    <>
      {selector}
      {lista.length > 0 ? (
        <button
          type="button"
          onClick={() => setAbierto(0)}
          className="relative shrink-0 rounded-md border border-line bg-white p-0.5 hover:border-slate-ink/50"
          title={`Ver ${lista.length} foto${lista.length === 1 ? "" : "s"} de ${descripcion}`}
          aria-label={`Ver fotos de ${descripcion}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={urlFoto(lista[0].id)} alt="" loading="lazy" className="h-10 w-10 rounded object-cover" />
          {lista.length > 1 && (
            <span className="absolute -right-1.5 -top-1.5 rounded-full bg-ink px-1 text-[10px] font-mono-tag text-white">
              {lista.length}
            </span>
          )}
        </button>
      ) : editable ? (
        <span className="flex shrink-0 flex-col items-center gap-0.5">
          <button
            type="button"
            disabled={ocupado || fotos === undefined}
            onClick={() => entrada.current?.click()}
            className="flex h-11 w-11 flex-col items-center justify-center rounded-md border border-dashed border-line-strong text-[10px] leading-tight text-ink-soft hover:border-slate-ink/50 hover:text-ink disabled:opacity-40"
            title={`Agregar fotos de ${descripcion}`}
          >
            <span aria-hidden="true">📷</span>
            {ocupado ? "…" : "Foto"}
          </button>
          <a
            href={urlBuscarFoto(descripcion)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-teal hover:underline"
            title="Buscar la foto real de este producto en internet (se abre en otra pestaña). Guárdala y súbela con «📷 Foto»."
          >
            🔎 Buscar
          </a>
        </span>
      ) : null}
      {error && actual === null && (
        <span className="text-[11px] text-danger" role="alert">
          {error}
        </span>
      )}

      {actual !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setAbierto(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Fotos de ${descripcion}`}
        >
          <div
            className="flex h-[90vh] w-full max-w-5xl flex-col rounded-lg border border-line bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
              <p className="truncate text-xs font-medium">
                {descripcion} <span className="text-ink-soft">· foto {actual + 1} de {lista.length}</span>
              </p>
              <div className="flex shrink-0 items-center gap-3">
                {editable && (
                  <>
                    <a
                      href={urlBuscarFoto(descripcion)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-ink-soft hover:underline"
                      title="Buscar más fotos de este producto en internet"
                    >
                      🔎 Buscar en internet
                    </a>
                    <button
                      type="button"
                      disabled={ocupado}
                      onClick={() => entrada.current?.click()}
                      className="text-xs font-medium text-teal hover:underline disabled:opacity-40"
                    >
                      {ocupado ? "Subiendo…" : "+ Agregar fotos"}
                    </button>
                    <button
                      type="button"
                      disabled={ocupado}
                      onClick={() => borrar(lista[actual])}
                      className="text-xs text-ink-soft hover:text-danger hover:underline disabled:opacity-40"
                    >
                      Borrar
                    </button>
                  </>
                )}
                <a href={urlFoto(lista[actual].id)} download={lista[actual].nombre} className="text-xs font-medium text-teal hover:underline">
                  Descargar
                </a>
                <button
                  type="button"
                  onClick={() => setAbierto(null)}
                  className="rounded-md border border-line-strong px-3 py-0.5 text-xs font-medium transition-colors hover:bg-concrete-dim"
                >
                  Cerrar
                </button>
              </div>
            </div>
            {error && <p className="border-b border-line px-4 py-1.5 text-xs text-danger">{error}</p>}
            <div className="relative flex min-h-0 flex-1 items-center justify-center bg-concrete-dim">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={urlFoto(lista[actual].id)} alt={`${descripcion} (${actual + 1})`} className="max-h-full max-w-full object-contain" />
              {lista.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setAbierto((actual - 1 + lista.length) % lista.length)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 px-3 py-2 text-lg shadow hover:bg-white"
                    aria-label="Foto anterior"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={() => setAbierto((actual + 1) % lista.length)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 px-3 py-2 text-lg shadow hover:bg-white"
                    aria-label="Foto siguiente"
                  >
                    ›
                  </button>
                </>
              )}
            </div>
            {lista.length > 1 && (
              <div className="flex gap-2 overflow-x-auto border-t border-line px-4 py-2">
                {lista.map((f, i) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setAbierto(i)}
                    className={`shrink-0 rounded border-2 ${i === actual ? "border-amber" : "border-transparent"}`}
                    aria-label={`Foto ${i + 1}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={urlFoto(f.id)} alt="" loading="lazy" className="h-14 w-14 rounded object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
