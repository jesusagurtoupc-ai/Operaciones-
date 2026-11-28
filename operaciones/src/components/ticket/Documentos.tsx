"use client";

import { useEffect, useRef, useState } from "react";
import { useMe, useConfirmarEnLinea } from "@/lib/client";
import { autoGuardarTicket } from "@/lib/client";
import { DOCUMENTOS, ESTADOS_DOC, ESTADO_DOC_COLORS, tieneInforme, compararMontos, montoDocValido, formatoSoles, formatoDolares, DOCS_CON_MONTO } from "@/lib/shared";
import { MAX_BYTES } from "@/lib/shared";
import { EVENTO_OC_GUARDAR, EVENTO_ESTADO_AUTO, emitirOcLeida, emitirEstadoAuto, emitirCamposAuto, leerOrdenCompra } from "@/lib/client";
import type { EstadoAuto } from "@/lib/client";
import { formatoFecha, toDateOnly } from "@/lib/shared";
import type { Correctivo } from "@/lib/shared";
import type { DatosOC, DocumentoClave, DocumentoLinea, Documentos, DocumentoLeido } from "@/lib/shared";

const VACIA: DocumentoLinea = { numero: "", estado: "Pendiente", url: "" };
const CON_MONTO: readonly string[] = DOCS_CON_MONTO.map((x) => x.clave);
const textoMontoDoc = (d: { monto?: number | null; moneda?: string }) =>
  montoDocValido(d.monto) === null ? "—" : d.moneda === "USD" ? formatoDolares(d.monto) : formatoSoles(d.monto as number);

/** Evento con el que Documentos avisa a la barra de avance que cambiaron los documentos del ticket. */
const EVENTO_DOCS = "correctivo:documentos";

type PasoAvance = { clave: string; nombre: string; hecho: boolean; omitido?: boolean; detalle: string[]; alerta?: boolean };

/**
 * Barra de avance del ticket: Cotización → OC → Ejecución → Informe → Certificado. Cada paso muestra si está
 * hecho, su fecha y su monto; el primero pendiente se marca como el paso actual. Se actualiza sola al cargar
 * o quitar documentos. Si los montos no coinciden, lo dice debajo con un enlace a los documentos.
 */
export function AvanceTicket({ c }: { c: Correctivo }) {
  const [docs, setDocs] = useState<Documentos>(c.documentos ?? {});
  const [estado, setEstado] = useState(c.estado ?? "");
  const [fFin, setFFin] = useState(toDateOnly(c.f_fin));
  useEffect(() => {
    const alDocs = (e: Event) => setDocs((e as CustomEvent<Documentos>).detail);
    const alEstado = (e: Event) => {
      const d = (e as CustomEvent<EstadoAuto>).detail;
      setEstado(d.estado);
      if (d.f_fin) setFFin(d.f_fin);
    };
    window.addEventListener(EVENTO_DOCS, alDocs);
    window.addEventListener(EVENTO_ESTADO_AUTO, alEstado);
    return () => {
      window.removeEventListener(EVENTO_DOCS, alDocs);
      window.removeEventListener(EVENTO_ESTADO_AUTO, alEstado);
    };
  }, []);
  const cmp = compararMontos(docs);
  const malMonto = (k: "cotizacion" | "oc" | "informe") => cmp.coinciden === false && cmp.montos.some((m) => m.clave === k);
  const monto = (k: DocumentoClave) => (montoDocValido(docs[k]?.monto) !== null ? textoMontoDoc(docs[k]!) : null);
  const f = (x: string | null | undefined) => (toDateOnly(x ?? null) ? formatoFecha(x ?? null) : null);
  const tiene = (k: DocumentoClave) => !!docs[k]?.url;
  const noAplica = (k: DocumentoClave) => docs[k]?.estado === "No aplica";
  const nOc = c.n_oc || docs.oc?.numero || "";
  const pasos: PasoAvance[] = [
    { clave: "cotizacion", nombre: "Cotización", hecho: tiene("cotizacion") || !!toDateOnly(c.f_coti), omitido: noAplica("cotizacion"),
      detalle: [f(c.f_coti), monto("cotizacion")].filter(Boolean) as string[], alerta: malMonto("cotizacion") },
    { clave: "oc", nombre: "Orden de compra", hecho: tiene("oc") || !!nOc.trim(), omitido: noAplica("oc"),
      detalle: [nOc ? `N° ${nOc}` : null, f(c.f_oc), monto("oc")].filter(Boolean) as string[], alerta: malMonto("oc") },
    { clave: "ejecucion", nombre: "Ejecución", hecho: !!fFin || estado === "Finalizado",
      detalle: [
        f(c.f_inicio) ? `inicio ${f(c.f_inicio)}` : null,
        fFin ? `fin ${f(fFin)}` : f(c.f_entrega) ? `entrega ${f(c.f_entrega)}` : null,
      ].filter(Boolean) as string[] },
    { clave: "informe", nombre: "Informe", hecho: tiene("informe"), omitido: noAplica("informe"),
      detalle: [monto("informe")].filter(Boolean) as string[], alerta: malMonto("informe") },
    { clave: "certificado", nombre: "Certificado", hecho: tiene("certificado"), omitido: noAplica("certificado"), detalle: [] },
  ];
  const actual = pasos.findIndex((p) => !p.hecho && !p.omitido);
  const hechos = pasos.filter((p) => p.hecho || p.omitido).length;
  return (
    <section aria-label="Avance del ticket" className="bg-white border border-line rounded-lg shadow-card p-4 sm:p-5 mb-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Avance</h3>
        <span className="text-xs text-ink-soft tabular-nums">{hechos} de {pasos.length} pasos</span>
      </div>
      <ol className="grid grid-cols-1 sm:grid-cols-5 gap-2 sm:gap-0">
        {pasos.map((p, i) => {
          const esActual = i === actual;
          const tono = p.alerta
            ? "border-danger bg-danger text-white"
            : p.hecho
              ? "border-teal bg-teal text-white"
              : p.omitido
                ? "border-line-strong bg-concrete-dim text-ink-soft"
                : esActual
                  ? "border-amber bg-white text-amber"
                  : "border-line-strong bg-white text-ink-soft";
          return (
            <li key={p.clave} className="relative flex sm:flex-col items-start sm:items-center gap-3 sm:gap-1.5 sm:text-center sm:px-1">
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className={`hidden sm:block absolute top-4 right-1/2 w-full h-0.5 -z-0 ${pasos[i - 1].hecho || pasos[i - 1].omitido ? "bg-teal" : "bg-line-strong"}`}
                />
              )}
              <span
                className={`relative z-10 shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full border-2 text-sm font-bold ${tono} ${esActual ? "ring-4 ring-danger-soft" : ""}`}
                aria-hidden="true"
              >
                {p.alerta ? "!" : p.hecho ? "✓" : p.omitido ? "—" : i + 1}
              </span>
              <span className="min-w-0">
                <span className={`block text-sm font-semibold leading-tight ${esActual ? "text-amber" : p.alerta ? "text-danger" : ""}`}>
                  {p.nombre}
                  <span className="sr-only">
                    {p.alerta ? " (monto distinto)" : p.hecho ? " (hecho)" : p.omitido ? " (no aplica)" : esActual ? " (paso actual)" : " (pendiente)"}
                  </span>
                </span>
                <span className="block text-xs text-ink-soft mt-0.5 tabular-nums">
                  {p.omitido ? "No aplica" : p.detalle.length ? p.detalle.join(" · ") : esActual ? "En curso" : "Pendiente"}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      {cmp.coinciden === false && (
        <a href="#documentos" className="mt-3 flex items-center gap-2 text-sm text-danger bg-danger-soft border border-danger/30 rounded-md px-3 py-2 hover:underline">
          <span aria-hidden="true">🔔</span>
          Los montos de los documentos no coinciden{cmp.diferencia !== null ? ` (diferencia ${formatoSoles(cmp.diferencia)})` : " (monedas distintas)"}
          {cmp.pareceIgv ? " · parece ser el IGV" : ""}. Ver documentos ↓
        </a>
      )}
    </section>
  );
}

/** Lee el monto total de un informe en PDF (null si no trae o no se pudo leer). No guarda nada. */
async function leerMontoInforme(archivo: File): Promise<{ total: number; moneda: "PEN" | "USD" } | null> {
  try {
    const fd = new FormData();
    fd.append("file", archivo, archivo.name);
    const r = await fetch("/api/documentos/leer", { method: "POST", body: fd });
    if (!r.ok) return null;
    const j = (await r.json().catch(() => null)) as { data?: DocumentoLeido } | null;
    return j?.data?.monto ?? null;
  } catch {
    return null;
  }
}
const ACEPTADOS = ".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx";

type Visor = {
  titulo: string;
  url: string; // enlace original (para descargar)
  estado: "cargando" | "pdf" | "imagen" | "otro" | "error";
  src: string; // URL temporal del archivo ya descargado
};

/**
 * Archivos ya abiertos en esta pestaña: volver a verlos es instantáneo. Solo en memoria (nunca en el
 * disco: el servidor los entrega con "no-store" por los equipos compartidos) y hasta ~40 MB; un archivo
 * nunca cambia (subir otro crea otra dirección), así que no hay que revalidarlo.
 */
const enMemoria = new Map<string, Blob>();
const TOPE_MEMORIA = 40 * 1024 * 1024;
async function archivoEnMemoria(url: string): Promise<Blob> {
  const ya = enMemoria.get(url);
  if (ya) return ya;
  const res = await fetch(url);
  if (!res.ok) throw new Error("No se pudo abrir el archivo");
  const blob = await res.blob();
  enMemoria.set(url, blob);
  let total = 0;
  for (const b of enMemoria.values()) total += b.size;
  for (const k of [...enMemoria.keys()]) {
    if (total <= TOPE_MEMORIA) break;
    total -= enMemoria.get(k)!.size;
    enMemoria.delete(k); // primero los más antiguos
  }
  return blob;
}

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
  const conf = useConfirmarEnLinea();
  const [docs, setDocs] = useState<Documentos>(inicial);
  const [subiendo, setSubiendo] = useState<DocumentoClave | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const claveElegida = useRef<DocumentoClave | null>(null);
  const [arrastrando, setArrastrando] = useState<DocumentoClave | null>(null);
  const [visor, setVisor] = useState<Visor | null>(null);
  const [leyendoOc, setLeyendoOc] = useState(false);
  const [leyendoCot, setLeyendoCot] = useState(false);
  const [aviso, setAviso] = useState("");
  // Monto que se está escribiendo a mano en una línea (se guarda al salir del campo).
  const [borradorMonto, setBorradorMonto] = useState<Partial<Record<DocumentoClave, string>>>({});
  const baseArchivos = `/api/correctivos/${correctivoId}/archivos`;
  // La barra de avance se entera de cada cambio de documentos.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent<Documentos>(EVENTO_DOCS, { detail: docs }));
  }, [docs]);

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
      const blob = await archivoEnMemoria(url);
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
  async function leerOc(archivo?: Blob, nombre = "oc.pdf", yaEnCurso?: Promise<DatosOC>) {
    if (leyendoOc) return;
    setError("");
    setLeyendoOc(true);
    try {
      if (yaEnCurso) {
        // La lectura se lanzó junto con la subida del archivo: aquí solo se espera su resultado.
        emitirOcLeida(await yaEnCurso);
        return;
      }
      let blob = archivo;
      if (!blob) {
        const url = docs.oc?.url ?? "";
        if (!url.startsWith("/api/")) {
          throw new Error("Solo se puede leer una OC subida como archivo PDF, no un enlace");
        }
        blob = await archivoEnMemoria(url).catch(() => {
          throw new Error("No se pudo abrir el archivo de la OC");
        });
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

  /** Lee la cotización (PDF) de este ticket y completa los datos que estén vacíos. */
  async function leerCotizacion(archivo?: File) {
    if (leyendoCot) return;
    setError("");
    setAviso("");
    setLeyendoCot(true);
    try {
      // Si se acaba de subir, se envía el mismo archivo para que el servidor no tenga que traerlo de la base.
      let cuerpo: FormData | undefined;
      if (archivo) {
        cuerpo = new FormData();
        cuerpo.append("file", archivo, archivo.name);
      }
      const res = await fetch(`/api/correctivos/${correctivoId}/aplicar-cotizacion`, { method: "POST", body: cuerpo });
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
  async function guardarDocs(nuevos: Documentos, previos: Documentos = docs): Promise<Documentos> {
    const enviar = (cuerpo: Documentos, base: Documentos) =>
      fetch(`/api/correctivos/${correctivoId}/documentos`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...cuerpo, _base: base }),
      });
    let res = await enviar(nuevos, previos);
    let data = await res.json().catch(() => ({}));
    // 409: alguien más cambió los documentos de este ticket mientras estaba abierto. Se traen los
    // actuales y se vuelve a aplicar SOLO la línea que se tocó aquí, sin borrar lo que subió el otro.
    if (res.status === 409 && data.conflicto) {
      const rt = await fetch(`/api/correctivos/${correctivoId}`);
      const jt = await rt.json().catch(() => null);
      const frescos = (jt?.data?.documentos ?? {}) as Documentos;
      const combinados: Documentos = { ...frescos };
      for (const k of Object.keys(nuevos) as DocumentoClave[]) {
        if (JSON.stringify(nuevos[k] ?? null) !== JSON.stringify(previos[k] ?? null)) combinados[k] = nuevos[k];
      }
      res = await enviar(combinados, frescos);
      data = await res.json().catch(() => ({}));
      nuevos = combinados;
    }
    if (!res.ok) throw new Error(data.error || "No se pudo guardar el documento");
    const guardados = (data.data ?? nuevos) as Documentos;
    setDocs(guardados);
    // El servidor puede haber cambiado el estado (OC → Por Ejecutar, informe → Finalizado).
    if (typeof data.estado === "string") {
      emitirEstadoAuto({ estado: data.estado, f_fin: data.f_fin ?? "", informe: tieneInforme({ documentos: (data.data ?? nuevos) as never }) });
    }
    return guardados;
  }

  /** Guarda el monto de una línea (cotización, OC o informe) escrito a mano. */
  async function guardarMonto(clave: DocumentoClave, texto: string, moneda?: "PEN" | "USD") {
    setError("");
    const l = linea(clave);
    const limpio = texto.replace(/[^\d.,]/g, "");
    // "1.234,56" o "1,234.56" → 1234.56
    const normal = /,\d{1,2}$/.test(limpio) ? limpio.replace(/\./g, "").replace(",", ".") : limpio.replace(/,/g, "");
    const monto = limpio ? montoDocValido(normal) : null;
    if (limpio && monto === null) {
      setError("El monto no es válido");
      return;
    }
    const mon = moneda ?? (l.moneda === "USD" ? "USD" : "PEN");
    if (monto === montoDocValido(l.monto) && mon === (l.moneda === "USD" ? "USD" : "PEN")) return;
    try {
      const { monto: _m, moneda: _mo, ...resto } = l;
      void _m;
      void _mo;
      await guardarDocs({ ...docs, [clave]: { ...resto, monto, ...(mon === "USD" ? { moneda: mon } : {}) } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el monto");
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

      // Una OC en PDF se lee MIENTRAS se sube (no después): así el tiempo es el de la más lenta de las dos.
      let lecturaOc: Promise<DatosOC> | undefined;
      if (clave === "oc" && /\.pdf$/i.test(original.name) && opciones?.leer !== false) {
        lecturaOc = leerOrdenCompra(original, original.name, correctivoId);
        lecturaOc.catch(() => {}); // si la subida falla, esta lectura se descarta sin avisos sueltos
      }

      // Un informe en PDF: se busca su monto total mientras se sube (para compararlo con la cotización y la OC).
      const lecturaInforme = clave === "informe" && /\.pdf$/i.test(original.name) ? leerMontoInforme(original) : null;

      // 1) Subir el archivo al ticket.
      const fd = new FormData();
      fd.append("file", original);
      const up = await fetch(baseArchivos, { method: "POST", body: fd });
      const upData = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(upData.error || "No se pudo subir el archivo");
      urlNueva = `${baseArchivos}/${upData.data.id}`;

      // 2) Guardar la línea: número = nombre del archivo, estado = Listo, enlace.
      const anterior = docs[clave]?.url ?? "";
      const guardados = await guardarDocs({
        ...docs,
        [clave]: {
          numero: original.name.replace(/\.[^.]+$/, ""),
          estado: "Listo",
          url: urlNueva,
          ...(docs[clave]?.adicionales?.length ? { adicionales: docs[clave]!.adicionales } : {}),
        },
      });

      // 3) Si la línea ya tenía un archivo propio, se quita para no dejar basura (sin hacer esperar al resto).
      const quitado = anterior && anterior !== urlNueva ? borrarArchivo(anterior) : Promise.resolve();
      // La carpeta local usa el archivo que ya tenemos: no se vuelve a bajar del servidor.
      // Se espera a que termine el borrado del anterior para que la carpeta quede con el archivo nuevo.
      void quitado.then(() => autoGuardarTicket(correctivoId, true, new Map([[upData.data.id as number, original]])));
      // Una cotización en PDF se lee sola para completar los datos vacíos del ticket.
      if (clave === "cotizacion" && /\.pdf$/i.test(original.name)) void leerCotizacion(original);
      // Una OC en PDF: se muestran los datos ya leídos para ofrecerlos al ticket (sin guardar nada).
      if (lecturaOc) void leerOc(original, original.name, lecturaOc);
      // Monto leído del PDF (OC o informe): se guarda en su línea para comparar los montos.
      const leido = lecturaOc
        ? await lecturaOc.then((o) => (o.total !== null ? { total: o.total, moneda: o.moneda === "USD" ? ("USD" as const) : ("PEN" as const) } : null)).catch(() => null)
        : lecturaInforme
          ? await lecturaInforme
          : null;
      const lineaGuardada = guardados[clave];
      if (leido && lineaGuardada && lineaGuardada.url === urlNueva && montoDocValido(leido.total) !== null) {
        await guardarDocs(
          { ...guardados, [clave]: { ...lineaGuardada, monto: montoDocValido(leido.total), ...(leido.moneda === "USD" ? { moneda: "USD" as const } : {}) } },
          guardados
        ).catch(() => {});
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
    setError("");
    const anterior = docs[clave]?.url ?? "";
    try {
      const adicionales = docs[clave]?.adicionales;
      await guardarDocs({ ...docs, [clave]: { ...VACIA, ...(adicionales?.length ? { adicionales } : {}) } });
      if (anterior) await borrarArchivo(anterior);
      void autoGuardarTicket(correctivoId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo quitar el documento");
    }
  }

  async function quitarAdicional(clave: DocumentoClave, url: string, nombre: string) {
    setError("");
    try {
      const l = linea(clave);
      await guardarDocs({ ...docs, [clave]: { ...l, adicionales: (l.adicionales ?? []).filter((a) => a.url !== url) } });
      await borrarArchivo(url);
      void autoGuardarTicket(correctivoId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo quitar el archivo");
    }
  }

  return (
    <section id="documentos" className="bg-white border border-line rounded-lg shadow-card p-6 mt-6 scroll-mt-24">
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

      {aviso && (
        <p className="text-sm bg-concrete-dim border border-line-strong px-3 py-2 mb-3 rounded-md">{aviso}</p>
      )}

      {(() => {
        const cmp = compararMontos(docs);
        if (cmp.montos.length === 0) return null;
        const ok = cmp.coinciden;
        return (
          <div
            role={ok === false ? "alert" : undefined}
            className={`text-sm px-3 py-2 mb-3 rounded-md border ${
              ok === false
                ? "bg-[var(--danger-soft)] border-danger/40 text-danger"
                : ok
                  ? "bg-teal-soft border-teal/30 text-teal"
                  : "bg-concrete-dim border-line-strong"
            }`}
          >
            <p className="font-semibold">
              {ok === false ? "🔔 Los montos no coinciden" : ok ? "✓ Los montos coinciden" : "Montos de los documentos"}
            </p>
            <p className="mt-0.5">
              {DOCS_CON_MONTO.map(({ clave, nombre }) => `${nombre}: ${textoMontoDoc(docs[clave] ?? {})}`).join(" · ")}
              {ok === false && cmp.diferencia !== null && ` · diferencia ${formatoSoles(cmp.diferencia)}`}
              {ok === false && cmp.diferencia === null && " · están en monedas distintas"}
            </p>
            {ok === false && cmp.pareceIgv && <p className="mt-0.5">La diferencia parece ser el IGV (18 %): revisa si uno de los montos está sin IGV.</p>}
            {ok === null && <p className="mt-0.5 text-ink-soft">Se comparan cuando hay al menos dos montos.</p>}
          </div>
        );
      })()}

      <ul className="space-y-2.5">
        {DOCUMENTOS.map(({ clave, nombre }) => {
          const d = linea(clave);
          const ocupado = subiendo === clave;
          const extras = d.adicionales ?? [];
          return (
            <li key={clave}>
            <div
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
                {CON_MONTO.includes(clave) && d.estado !== "No aplica" && (
                  <div className="flex items-center gap-1.5 mt-1 text-xs" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <span className="text-ink-soft">Monto total:</span>
                    {esAdmin ? (
                      <>
                        <select
                          value={d.moneda === "USD" ? "USD" : "PEN"}
                          onChange={(e) => void guardarMonto(clave, borradorMonto[clave] ?? String(d.monto ?? ""), e.target.value as "PEN" | "USD")}
                          aria-label={`Moneda del monto de ${nombre}`}
                          className="bg-white border border-line-strong rounded px-1 py-0.5 text-xs"
                        >
                          <option value="PEN">S/</option>
                          <option value="USD">US$</option>
                        </select>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={borradorMonto[clave] ?? (montoDocValido(d.monto) === null ? "" : (d.monto as number).toFixed(2))}
                          placeholder="sin monto"
                          onChange={(e) => setBorradorMonto((b) => ({ ...b, [clave]: e.target.value }))}
                          onBlur={(e) => {
                            const v = e.target.value;
                            setBorradorMonto((b) => {
                              const { [clave]: _x, ...r } = b;
                              void _x;
                              return r;
                            });
                            void guardarMonto(clave, v);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          aria-label={`Monto total de ${nombre}`}
                          title="Monto total con IGV. Se lee solo del PDF; si no, escríbelo aquí."
                          className="w-28 bg-white border border-line-strong rounded px-1.5 py-0.5 text-xs tabular-nums"
                        />
                      </>
                    ) : (
                      <span className="tabular-nums font-medium">{textoMontoDoc(d)}</span>
                    )}
                  </div>
                )}
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
                      conf.pedir(`doc-${clave}`, () => void quitarDocumento(clave, nombre));
                    }}
                    title="Quitar documento"
                    className="text-xs font-medium text-danger hover:underline"
                  >
                    {conf.armado === `doc-${clave}` ? "¿Quitar? Clic otra vez" : "Quitar"}
                  </button>
                )}
              </div>
            </div>
            {extras.length > 0 && (
              <ul className="mt-1 ml-4 space-y-1 border-l border-line pl-3">
                {extras.map((a) => (
                  <li key={a.url} className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate font-mono-tag text-ink-soft" title={a.nombre}>+ {a.nombre}</span>
                    <span className="flex shrink-0 gap-3">
                      <button
                        type="button"
                        onClick={() => verDocumento(`${nombre} · ${a.nombre}`, a.url)}
                        className="text-ink-soft hover:text-ink hover:underline"
                      >
                        Ver ↗
                      </button>
                      {esAdmin && (
                        <button
                          type="button"
                          onClick={() => conf.pedir(`adi-${a.url}`, () => void quitarAdicional(clave, a.url, a.nombre))}
                          className="font-medium text-danger hover:underline"
                        >
                          {conf.armado === `adi-${a.url}` ? "¿Quitar? Clic otra vez" : "Quitar"}
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
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
