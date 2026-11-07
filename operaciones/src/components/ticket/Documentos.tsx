"use client";

import { useEffect, useRef, useState } from "react";
import { useMe } from "@/lib/client";
import { autoGuardarTicket } from "@/lib/client";
import { DOCUMENTOS, ESTADOS_DOC, ESTADO_DOC_COLORS } from "@/lib/shared";
import { MAX_BYTES } from "@/lib/shared";
import { EVENTO_OC_GUARDAR, emitirOcLeida, emitirEstadoAuto, emitirCamposAuto, leerOrdenCompra } from "@/lib/client";
import type { DocumentoClave, DocumentoLinea, Documentos } from "@/lib/shared";

const VACIA: DocumentoLinea = { numero: "", estado: "Pendiente", url: "" };
const ACEPTADOS = ".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx";

type Visor = {
  titulo: string;
  url: string; // enlace original (para descargar)
  estado: "cargando" | "pdf" | "imagen" | "otro" | "error";
  src: string; // URL temporal del archivo ya descargado
};

export default function DocumentosTicket({
  correctivoId,
  inicial,
  numeroOc,
}: {
  correctivoId: number;
  inicial: Documentos;
  numeroOc: string | null;
}) {
  const me = useMe();
  const esAdmin = me?.rol === "admin";
  const [docs, setDocs] = useState<Documentos>(inicial);
  const [subiendo, setSubiendo] = useState<DocumentoClave | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const claveElegida = useRef<DocumentoClave | null>(null);
  const [arrastrando, setArrastrando] = useState<DocumentoClave | null>(null);
  const [visor, setVisor] = useState<Visor | null>(null);
  const [zonaActiva, setZonaActiva] = useState(false);
  const [leyendoOc, setLeyendoOc] = useState(false);
  const [leyendoCot, setLeyendoCot] = useState(false);
  const [aviso, setAviso] = useState("");
  const baseArchivos = `/api/correctivos/${correctivoId}/archivos`;

  // El N° de OC del ticket se muestra en la línea de OC si no hay otro número.
  function linea(clave: DocumentoClave): DocumentoLinea {
    const d = { ...VACIA, ...(docs[clave] ?? {}) };
    if (clave === "oc" && !d.numero && numeroOc) d.numero = numeroOc;
    return d;
  }

  // Libera la URL temporal y cierra el visor.
  function cerrarVisor() {
    setVisor((v) => {
      if (v?.src) URL.revokeObjectURL(v.src);
      return null;
    });
  }

  // "Leer OC" (en el formulario) pide guardar el PDF que acaba de leer como documento de la OC.
  // La referencia evita que el oyente use un `docs` viejo.
  const subirRef = useRef(subirArchivo);
  useEffect(() => {
    subirRef.current = subirArchivo; // tras cada render, la versión que ve el `docs` actual
  });
  useEffect(() => {
    if (!esAdmin) return;
    const alGuardar = (e: Event) => {
      void subirRef.current("oc", (e as CustomEvent<File>).detail, { leer: false });
    };
    window.addEventListener(EVENTO_OC_GUARDAR, alGuardar);
    return () => window.removeEventListener(EVENTO_OC_GUARDAR, alGuardar);
  }, [esAdmin]);

  // Esc cierra el visor.
  useEffect(() => {
    if (!visor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrarVisor();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visor]);

  // Abre el documento en un visor dentro de esta misma página.
  async function verDocumento(titulo: string, url: string) {
    setVisor({ titulo, url, estado: "cargando", src: "" });
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const tipo = blob.type;
      const src = URL.createObjectURL(blob);
      const estado = tipo === "application/pdf" ? "pdf" : tipo.startsWith("image/") ? "imagen" : "otro";
      setVisor({ titulo, url, estado, src });
    } catch {
      setVisor({ titulo, url, estado: "error", src: "" });
    }
  }

  /**
   * Lee la OC (PDF) y le pasa lo leído al formulario, que muestra el panel para revisar.
   * No guarda nada. `archivo` viene ya en mano al subir; si no, se descarga el de la línea.
   */
  async function leerOc(archivo?: Blob, nombre = "oc.pdf") {
    if (leyendoOc) return;
    setError("");
    setLeyendoOc(true);
    try {
      let blob = archivo;
      if (!blob) {
        const url = docs.oc?.url ?? "";
        if (!url.startsWith("/api/")) {
          throw new Error("Solo se puede leer una OC subida como archivo PDF, no un enlace");
        }
        const res = await fetch(url);
        if (!res.ok) throw new Error("No se pudo abrir el archivo de la OC");
        blob = await res.blob();
        nombre = `${docs.oc?.numero || "oc"}.pdf`;
      }
      if (blob.type && blob.type !== "application/pdf") {
        throw new Error("La OC debe ser un PDF para poder leerla");
      }
      emitirOcLeida(await leerOrdenCompra(blob, nombre, correctivoId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer la OC");
    } finally {
      setLeyendoOc(false);
    }
  }

  /** Decide a qué línea va un archivo por su nombre y, si es PDF y no hay pista, por si se lee como OC. */
  async function clasificar(f: File): Promise<DocumentoClave | null> {
    const n = f.name.toLowerCase();
    if (/informe/.test(n)) return "informe";
    if (/certific/.test(n)) return "certificado";
    if (/cotiz|propuesta|presupuesto|proforma|^cot[-_ ]?\d|^coti[-_ 0-9]/.test(n)) return "cotizacion";
    if (/visita/.test(n)) return "visita_tecnica";
    if (/(^|[^a-z])(oc|orden)([^a-z]|$)|per0?\d/.test(n)) return "oc";
    if (/\.pdf$/i.test(f.name)) {
      try {
        await leerOrdenCompra(f, f.name, correctivoId);
        return "oc"; // se pudo leer como orden de compra
      } catch {
        /* no es una OC: se prueba como cotización */
      }
      try {
        const fd = new FormData();
        fd.append("file", f, f.name);
        const r = await fetch("/api/cotizaciones/leer", { method: "POST", body: fd });
        const j = await r.json().catch(() => ({}));
        // Más estricto que al leer: tiene que traer total y proveedor o RUC, para no confundir un informe.
        if (r.ok && j.data?.total !== null && (j.data?.ruc_proveedor || j.data?.proveedor)) return "cotizacion";
      } catch {
        /* sin clasificar */
      }
    }
    return null;
  }

  async function soltarEnZona(files: FileList | null) {
    const f = files?.[0];
    if (!f || subiendo) return;
    setError("");
    const clave = await clasificar(f);
    if (!clave) {
      setError(`No se pudo saber qué documento es "${f.name}". Arrástralo directamente a su fila.`);
      return;
    }
    await subirArchivo(clave, f);
  }

  /** Lee la cotización (PDF) de este ticket y completa los datos que estén vacíos. */
  async function leerCotizacion() {
    if (leyendoCot) return;
    setError("");
    setAviso("");
    setLeyendoCot(true);
    try {
      const res = await fetch(`/api/correctivos/${correctivoId}/aplicar-cotizacion`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo leer la cotización");
      const d = data.data as { campos: Record<string, string | number>; documentos?: Documentos; resumen: string; avisos: string[] };
      if (d.documentos) setDocs(d.documentos);
      if (Object.keys(d.campos).length > 0) emitirCamposAuto(d.campos);
      setAviso([d.resumen, ...d.avisos].join(" "));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer la cotización");
    } finally {
      setLeyendoCot(false);
    }
  }

  function elegirArchivo(clave: DocumentoClave) {
    if (subiendo) return;
    claveElegida.current = clave;
    inputRef.current?.click();
  }

  async function borrarArchivo(url: string) {
    // Solo se borran archivos subidos a este mismo ticket.
    if (url.startsWith(`${baseArchivos}/`)) {
      await fetch(url, { method: "DELETE" }).catch(() => {});
    }
  }

  /** Guarda todas las líneas en el servidor y actualiza la pantalla. */
  async function guardarDocs(nuevos: Documentos) {
    const res = await fetch(`/api/correctivos/${correctivoId}/documentos`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nuevos),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "No se pudo guardar el documento");
    setDocs(data.data ?? nuevos);
    // El servidor puede haber cambiado el estado (OC → Por Ejecutar, informe → Finalizado).
    if (typeof data.estado === "string") {
      emitirEstadoAuto({ estado: data.estado, f_fin: data.f_fin ?? "" });
    }
  }

  function alElegir(files: FileList | null) {
    const clave = claveElegida.current;
    // Primero se toma el archivo: `files` es una lista "viva" del input y
    // al limpiar el input (para poder elegir el mismo archivo otra vez) se vacía.
    const archivo = files?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (clave && archivo) void subirArchivo(clave, archivo);
  }

  async function subirArchivo(clave: DocumentoClave, original: File, opciones?: { leer?: boolean }) {
    if (subiendo) return;
    setError("");
    setAviso("");
    setSubiendo(clave);
    let urlNueva = "";
    try {
      // Se sube tal cual, sin reducir ni recomprimir.
      if (original.size > MAX_BYTES) {
        throw new Error(`${original.name}: supera el máximo de 4 MB`);
      }

      // 1) Subir el archivo al ticket.
      const fd = new FormData();
      fd.append("file", original);
      const up = await fetch(baseArchivos, { method: "POST", body: fd });
      const upData = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(upData.error || "No se pudo subir el archivo");
      urlNueva = `${baseArchivos}/${upData.data.id}`;

      // 2) Guardar la línea: número = nombre del archivo, estado = Listo, enlace.
      const anterior = docs[clave]?.url ?? "";
      await guardarDocs({
        ...docs,
        [clave]: {
          numero: original.name.replace(/\.[^.]+$/, ""),
          estado: "Listo",
          url: urlNueva,
        },
      });

      // 3) Si la línea ya tenía un archivo propio, se quita para no dejar basura.
      if (anterior && anterior !== urlNueva) await borrarArchivo(anterior);
      void autoGuardarTicket(correctivoId);
      // Una cotización en PDF se lee sola para completar los datos vacíos del ticket.
      if (clave === "cotizacion" && /\.pdf$/i.test(original.name)) void leerCotizacion();
      // Una OC en PDF se lee sola para ofrecer sus datos al ticket (sin guardar nada).
      if (clave === "oc" && /\.pdf$/i.test(original.name) && opciones?.leer !== false) {
        void leerOc(original, original.name);
      }
    } catch (e) {
      if (urlNueva) await borrarArchivo(urlNueva);
      setError(e instanceof Error ? e.message : "No se pudo subir el documento");
    } finally {
      setSubiendo(null);
    }
  }

  async function cambiarEstado(clave: DocumentoClave, estado: string) {
    setError("");
    try {
      await guardarDocs({ ...docs, [clave]: { ...linea(clave), estado } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar el estado");
    }
  }

  async function quitarDocumento(clave: DocumentoClave, nombre: string) {
    if (!confirm(`¿Quitar el documento de ${nombre}?`)) return;
    setError("");
    const anterior = docs[clave]?.url ?? "";
    try {
      await guardarDocs({ ...docs, [clave]: { ...VACIA } });
      if (anterior) await borrarArchivo(anterior);
      void autoGuardarTicket(correctivoId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo quitar el documento");
    }
  }

  return (
    <section className="bg-white border border-line rounded-lg shadow-card p-6 mt-6">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-soft border-b border-line pb-2 mb-4">
        Documentos
      </h3>

      <input
        ref={inputRef}
        type="file"
        accept={ACEPTADOS}
        className="hidden"
        onChange={(e) => alElegir(e.target.files)}
      />

      {error && (
        <p className="text-sm text-danger bg-[var(--danger-soft)] border border-danger/30 px-3 py-2 mb-3">
          {error}
        </p>
      )}

      {esAdmin && (
        <div
          onDragOver={(e) => { e.preventDefault(); setZonaActiva(true); }}
          onDragLeave={() => setZonaActiva(false)}
          onDrop={(e) => {
            e.preventDefault();
            setZonaActiva(false);
            void soltarEnZona(e.dataTransfer.files);
          }}
          className={`mb-3 rounded-lg border-2 border-dashed px-4 py-3 text-center text-xs text-ink-soft ${
            zonaActiva ? "border-ink bg-concrete-dim" : "border-line-strong"
          }`}
        >
          Suelta aquí cualquier archivo: se coloca solo en OC, informe, cotización, certificado o visita técnica
          según su nombre (un PDF de OC se reconoce por su contenido).
        </div>
      )}

      {aviso && (
        <p className="text-sm bg-concrete-dim border border-line-strong px-3 py-2 mb-3 rounded-md">{aviso}</p>
      )}

      <ul className="space-y-2.5">
        {DOCUMENTOS.map(({ clave, nombre }) => {
          const d = linea(clave);
          const ocupado = subiendo === clave;
          return (
            <li
              key={clave}
              tabIndex={esAdmin ? 0 : undefined}
              onClick={esAdmin ? () => elegirArchivo(clave) : undefined}
              onKeyDown={
                esAdmin
                  ? (e) => {
                      if (e.target === e.currentTarget && e.key === "Enter") elegirArchivo(clave);
                    }
                  : undefined
              }
              onDragOver={esAdmin ? (e) => { e.preventDefault(); setArrastrando(clave); } : undefined}
              onDragLeave={esAdmin ? () => setArrastrando(null) : undefined}
              onDrop={
                esAdmin
                  ? (e) => {
                      e.preventDefault();
                      setArrastrando(null);
                      const f = e.dataTransfer.files?.[0];
                      if (f) void subirArchivo(clave, f);
                    }
                  : undefined
              }
              title={esAdmin ? "Clic para seleccionar el documento, o arrastra un archivo aquí" : undefined}
              className={`flex items-center justify-between gap-3 rounded-lg bg-concrete-dim/60 px-4 py-3 ${
                esAdmin
                  ? "cursor-pointer hover:bg-concrete-dim focus:outline-none focus:bg-concrete-dim"
                  : ""
              } ${ocupado ? "opacity-60" : ""} ${
                arrastrando === clave ? "ring-2 ring-ink bg-concrete-dim" : ""
              }`}
            >
              <div className="min-w-0">
                <p className="font-medium leading-tight">{nombre}</p>
                <p className="font-mono-tag text-xs text-ink-soft mt-0.5 truncate">
                  {ocupado ? "Subiendo…" : d.numero || "—"}
                </p>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                {esAdmin ? (
                  <select
                    value={d.estado}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => cambiarEstado(clave, e.target.value)}
                    aria-label={`Estado de ${nombre}`}
                    className={`rounded-full px-3 py-0.5 text-xs font-medium cursor-pointer border-0 focus:outline-none focus:ring-2 focus:ring-ink ${
                      ESTADO_DOC_COLORS[d.estado] ?? ESTADO_DOC_COLORS.Pendiente
                    }`}
                  >
                    {ESTADOS_DOC.map((e) => (
                      <option key={e} value={e}>{e}</option>
                    ))}
                  </select>
                ) : (
                  <span
                    className={`rounded-full px-3 py-0.5 text-xs font-medium ${
                      ESTADO_DOC_COLORS[d.estado] ?? ESTADO_DOC_COLORS.Pendiente
                    }`}
                  >
                    {d.estado}
                  </span>
                )}
                {esAdmin && clave === "oc" && d.url.startsWith("/api/") && (
                  <button
                    type="button"
                    disabled={leyendoOc}
                    onClick={(e) => {
                      e.stopPropagation();
                      void leerOc();
                    }}
                    title="Lee el PDF de la OC y propone sus datos para el ticket"
                    className="text-sm font-medium text-teal hover:underline disabled:opacity-50"
                  >
                    {leyendoOc ? "Leyendo…" : "Leer OC"}
                  </button>
                )}
                {esAdmin && clave === "cotizacion" && d.url.startsWith("/api/") && (
                  <button
                    type="button"
                    disabled={leyendoCot}
                    onClick={(e) => {
                      e.stopPropagation();
                      void leerCotizacion();
                    }}
                    title="Lee el PDF de la cotización y completa proveedor, RUC, fecha y monto si están vacíos"
                    className="text-sm font-medium text-teal hover:underline disabled:opacity-50"
                  >
                    {leyendoCot ? "Leyendo…" : "Leer cotización"}
                  </button>
                )}
                {d.url ? (
                  d.url.startsWith("/api/") ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        verDocumento(`${nombre} · ${d.numero}`, d.url);
                      }}
                      className="text-sm text-ink-soft hover:text-ink hover:underline"
                    >
                      Ver documento ↗
                    </button>
                  ) : (
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-sm text-ink-soft hover:text-ink hover:underline"
                    >
                      Ver documento ↗
                    </a>
                  )
                ) : (
                  <span className="text-sm text-ink-soft/50">
                    {d.estado === "No aplica"
                      ? "—"
                      : esAdmin
                      ? "Seleccionar documento"
                      : "Sin documento"}
                  </span>
                )}
                {esAdmin && d.url && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      quitarDocumento(clave, nombre);
                    }}
                    title="Quitar documento"
                    className="text-xs font-medium text-danger hover:underline"
                  >
                    Quitar
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {esAdmin && (
        <p className="text-xs text-ink-soft mt-3">
          PDF, imágenes, Word o Excel. Clic en la fila o arrastra un archivo. Máximo 4 MB, se guarda con su tamaño original.
          El nombre pasa a ser el número y el estado cambia a Listo; después puedes cambiarlo
          en la etiqueta de estado.
        </p>
      )}

      {visor && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={cerrarVisor}
          role="dialog"
          aria-modal="true"
          aria-label={visor.titulo}
        >
          <div
            className="bg-white border border-line rounded-lg shadow-xl w-full max-w-5xl h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-line">
              <p className="text-xs font-medium truncate">
                {visor.titulo}
              </p>
              <div className="flex items-center gap-3 shrink-0">
                <a
                  href={visor.url}
                  download
                  className="text-xs font-medium text-teal hover:underline"
                >
                  Descargar
                </a>
                <button
                  type="button"
                  onClick={cerrarVisor}
                  className="border border-line-strong rounded-md px-3 py-0.5 text-xs font-medium hover:bg-concrete-dim transition-colors"
                >
                  Cerrar
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 bg-concrete-dim flex items-center justify-center">
              {visor.estado === "cargando" && (
                <p className="text-sm text-ink-soft">Cargando documento…</p>
              )}
              {visor.estado === "pdf" && (
                <iframe src={visor.src} title={visor.titulo} className="w-full h-full" />
              )}
              {visor.estado === "imagen" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={visor.src} alt={visor.titulo} className="max-w-full max-h-full object-contain" />
              )}
              {visor.estado === "otro" && (
                <p className="text-sm text-ink-soft px-6 text-center">
                  Este tipo de archivo (Word o Excel) no se puede mostrar aquí. Usa
                  &quot;Descargar&quot; para abrirlo.
                </p>
              )}
              {visor.estado === "error" && (
                <p className="text-sm text-danger px-6 text-center">
                  No se pudo cargar el documento.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
