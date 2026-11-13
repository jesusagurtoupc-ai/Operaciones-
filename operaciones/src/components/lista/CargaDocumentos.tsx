"use client";

import { useRef, useState } from "react";
import type { Correctivo, DocumentoClave, TipoDocumento } from "@/lib/shared";
import { formatoSoles, normNumCotizacion, numeroOc } from "@/lib/shared";
import { prepararAutoguardado, autoGuardarTicket } from "@/lib/client";
import { agruparDocumentos, destinoDeTicket, type Agrupacion, type DocCarga, type Destino } from "@/lib/agruparDocumentos";
import {
  agregarAdicional,
  crearTicketDesdeCotizacion,
  guardarCotizacionEnTicket,
  guardarDocumentoEnTicket,
  leerDocumentoArchivo,
  traerTickets,
  vincularOc,
} from "./CargaOC";

/**
 * Botón "+ Documentos": se eligen muchos PDF sueltos (o carpetas) de una vez —OC, cotizaciones, informes
 * técnicos, actas, certificados, guías— y la app los JUNTA POR TRABAJO comparando N° de OC, N° de
 * cotización, RUC, montos, fechas, descripción y carpeta (ver lib/agruparDocumentos.ts). Cada trabajo
 * queda en UN ticket: se crea con su OC (o con su cotización si no hay OC), o se usa el que ya existe,
 * y se le guardan todas sus cotizaciones, el informe (→ "Finalizado"), el certificado y el resto.
 * Antes de aplicar se revisa todo y se puede mover cualquier documento a otro trabajo.
 */

type Fase = "cerrado" | "leyendo" | "revision" | "aplicando" | "listo";
const NO_CARGAR = "__no__";

const ETIQUETA: Record<TipoDocumento, string> = {
  oc: "OC", cotizacion: "Cotización", informe: "Informe", certificado: "Certificado", guia: "Guía", otro: "Otro",
};
const COLOR: Record<TipoDocumento, string> = {
  oc: "bg-amber-50 text-amber-800", cotizacion: "bg-concrete-dim text-ink", informe: "bg-emerald-50 text-emerald-800",
  certificado: "bg-emerald-50 text-emerald-800", guia: "bg-concrete-dim text-ink-soft", otro: "bg-concrete-dim text-ink-soft",
};

async function huellaDe(f: File): Promise<string> {
  try {
    const h = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
    return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return `${f.name}|${f.size}`;
  }
}

/** Carpeta del trabajo: la subcarpeta del primer nivel bajo la carpeta elegida (o null si son archivos sueltos). */
function carpetaDe(ruta: string): string | null {
  const partes = ruta.split("/").filter(Boolean);
  if (partes.length < 2) return null;
  return partes.length >= 3 ? partes.slice(0, 2).join("/") : partes[0];
}

/** Recorre lo arrastrado (archivos y carpetas). */
async function archivosArrastrados(items: DataTransferItemList) {
  type Entrada = {
    isFile: boolean; isDirectory: boolean; fullPath: string;
    file?: (ok: (f: File) => void, mal: (e: unknown) => void) => void;
    createReader?: () => { readEntries: (ok: (e: Entrada[]) => void, mal: (e: unknown) => void) => void };
  };
  const salida: { file: File; ruta: string }[] = [];
  const visitar = async (e: Entrada): Promise<void> => {
    if (e.isFile && e.file) {
      const f = await new Promise<File>((ok, mal) => e.file!(ok, mal));
      salida.push({ file: f, ruta: e.fullPath.split("/").filter(Boolean).length > 1 ? `arrastradas${e.fullPath}` : f.name });
    } else if (e.isDirectory && e.createReader) {
      const lector = e.createReader();
      for (;;) {
        const lote = await new Promise<Entrada[]>((ok, mal) => lector.readEntries(ok, mal));
        if (lote.length === 0) break;
        for (const x of lote) await visitar(x);
      }
    }
  };
  const entradas = Array.from(items)
    .map((it) => (it as unknown as { webkitGetAsEntry?: () => Entrada | null }).webkitGetAsEntry?.() ?? null)
    .filter((e): e is Entrada => !!e);
  for (const e of entradas) await visitar(e);
  return salida;
}

/** Qué se hará con el ticket del trabajo. */
function accionDe(d: Destino): "vincular" | "existente" | "crear_oc" | "crear_cot" {
  if (d.ticket) return d.oc && !numeroOc(d.ticket.n_oc) ? "vincular" : "existente";
  return d.oc ? "crear_oc" : "crear_cot";
}

function tituloDestino(d: Destino): string {
  const t = d.ticket;
  const ref = t ? `#${t.refer ?? t.id}` : "";
  const oc = d.oc?.leido?.oc;
  const prov = oc?.proveedor ?? d.cotNueva?.leido?.cotizacion?.proveedor ?? t?.proveedor ?? "";
  const desc = (oc?.descripcion ?? d.cotNueva?.leido?.cotizacion?.solicitud ?? t?.descripcion ?? "").split(/;\s*atender/i)[0];
  switch (accionDe(d)) {
    case "crear_oc": return `Ticket nuevo con la OC ${oc?.n_oc ?? ""} · ${prov} · ${d.monto !== null ? formatoSoles(d.monto) : ""} · ${desc.slice(0, 60)}`;
    case "vincular": return `Ticket ${ref} (${d.motivoTicket ?? "espera su OC"}) ← OC ${oc?.n_oc ?? ""} · ${desc.slice(0, 50)}`;
    case "crear_cot": return `Ticket nuevo con la cotización N° ${d.cotNueva?.leido?.cotizacion?.numero ?? "?"} · ${prov} · ${d.monto !== null ? formatoSoles(d.monto) : ""} · ${desc.slice(0, 50)}`;
    default: return `Ticket ${ref} · ${t?.estado || "sin estado"} · ${prov} · ${(t?.descripcion ?? "").slice(0, 60)}`;
  }
}

export default function CargaDocumentos({ onTerminado }: { onTerminado: () => void }) {
  const archivosRef = useRef<HTMLInputElement>(null);
  const carpetaRef = useRef<HTMLInputElement>(null);
  const [fase, setFase] = useState<Fase>("cerrado");
  const [avance, setAvance] = useState({ hechos: 0, total: 0 });
  const [agr, setAgr] = useState<Agrupacion | null>(null);
  const [tickets, setTickets] = useState<Correctivo[]>([]);
  /** Destino elegido para cada documento (id → clave de destino o NO_CARGAR). */
  const [eleccion, setEleccion] = useState<Record<number, string>>({});
  const [excluidos, setExcluidos] = useState<Set<string>>(new Set());
  const [resultados, setResultados] = useState<Record<string, { ok: boolean; texto: string }>>({});
  const [encima, setEncima] = useState(false);
  const [ignorados, setIgnorados] = useState(0);
  const archivos = useRef(new Map<number, File>());

  async function procesar(lista: { file: File; ruta: string }[]) {
    if (lista.length === 0) return;
    const pdfs = lista.filter((a) => /\.pdf$/i.test(a.file.name) || a.file.type === "application/pdf");
    setIgnorados(lista.length - pdfs.length);
    setAgr(null);
    setResultados({});
    setExcluidos(new Set());
    setFase("leyendo");
    setAvance({ hechos: 0, total: pdfs.length });
    const ticketsP = traerTickets().catch(() => [] as Correctivo[]);

    const docs: DocCarga[] = new Array(pdfs.length);
    let siguiente = 0;
    const trabajador = async () => {
      for (;;) {
        const i = siguiente++;
        if (i >= pdfs.length) return;
        const { file, ruta } = pdfs[i];
        const doc: DocCarga = { id: i, nombre: file.name, carpeta: carpetaDe(ruta), huella: await huellaDe(file), leido: null };
        try {
          doc.leido = await leerDocumentoArchivo(file);
        } catch (e) {
          doc.error = e instanceof Error ? e.message : "No se pudo leer";
        }
        docs[i] = doc;
        archivos.current.set(i, file);
        setAvance((a) => ({ ...a, hechos: a.hechos + 1 }));
      }
    };
    archivos.current = new Map();
    await Promise.all([trabajador(), trabajador(), trabajador()]);
    const ts = await ticketsP;
    const g = agruparDocumentos(docs, ts);
    setTickets(ts);
    setAgr(g);
    const el: Record<number, string> = {};
    for (const a of g.asignaciones) el[a.doc.id] = a.destino ?? NO_CARGAR;
    setEleccion(el);
    setFase("revision");
  }
  /** Destinos (los de la carga + tickets elegidos a mano) por clave. */
  const destinos = new Map<string, Destino>((agr?.destinos ?? []).map((d) => [d.clave, d]));
  const destinoPorClave = (clave: string): Destino | null => {
    if (destinos.has(clave)) return destinos.get(clave)!;
    const m = /^t:(\d+)$/.exec(clave);
    const t = m ? tickets.find((x) => x.id === Number(m[1])) : undefined;
    return t ? destinoDeTicket(t) : null;
  };
  const docsDe = (clave: string) => (agr?.asignaciones ?? []).filter((a) => eleccion[a.doc.id] === clave);
  // Trabajos con algo que hacer (una OC que ya está completa en su ticket, sin más documentos, se omite).
  const activos = (agr?.destinos ?? []).filter(
    (d) => docsDe(d.clave).some((a) => a.doc !== d.cotNueva) || accionDe(d) !== "existente" || (d.oc && !d.ticket?.documentos?.oc?.url)
  );
  // Tickets elegidos a mano que no estaban en la propuesta.
  const extra = [...new Set(Object.values(eleccion))]
    .filter((c) => c !== NO_CARGAR && !destinos.has(c))
    .map(destinoPorClave)
    .filter((d): d is Destino => !!d);
  const todosDestinos = [...activos, ...extra];
  const sueltos = (agr?.asignaciones ?? []).filter((a) => eleccion[a.doc.id] === NO_CARGAR);

  async function aplicar() {
    if (!agr) return;
    const lista = todosDestinos.filter((d) => !excluidos.has(d.clave));
    if (lista.length === 0) return;
    setFase("aplicando");
    setAvance({ hechos: 0, total: lista.length });
    await prepararAutoguardado();
    for (const d of lista) {
      const hecho: string[] = [];
      let id = d.ticket?.id;
      try {
        const accion = accionDe(d);
        const file = (doc: DocCarga) => archivos.current.get(doc.id)!;
        if (accion === "crear_oc" && d.oc) {
          const fd = new FormData();
          fd.append("file", file(d.oc), d.oc.nombre);
          fd.append("base", "total");
          const r = await fetch("/api/correctivos/desde-oc", { method: "POST", body: fd });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || "No se pudo crear el ticket desde la OC");
          id = j.data.id as number;
          hecho.push(`ticket #${j.data.refer ?? id} creado con la OC`);
        } else if (accion === "vincular" && d.oc && id) {
          await vincularOc(id, file(d.oc), ["f_oc", "f_entrega", "contrato", "monto"]);
          hecho.push(`OC vinculada al ticket #${d.ticket?.refer ?? id}`);
        } else if (accion === "crear_cot" && d.cotNueva) {
          const t = await crearTicketDesdeCotizacion(file(d.cotNueva));
          id = t.id;
          hecho.push(`ticket #${t.refer ?? t.id} creado con la cotización`);
        } else if (id) {
          hecho.push(`ticket #${d.ticket?.refer ?? id}`);
          // Ticket con su OC pero sin el PDF: se guarda.
          if (d.oc && !d.ticket?.documentos?.oc?.url) {
            await guardarDocumentoEnTicket(id, file(d.oc), "oc");
            hecho.push("PDF de la OC guardado");
          }
        }
        if (!id) throw new Error("No hay ticket");

        // Lo que ya tiene el ticket (para no repetir y para no reemplazar sus documentos).
        const tiene = {
          cotizacion: accion === "crear_cot" || !!d.ticket?.documentos?.cotizacion?.url,
          informe: !!d.ticket?.documentos?.informe?.url,
          certificado: !!d.ticket?.documentos?.certificado?.url,
        };
        const cotsDelTicket = new Set(
          [d.ticket?.documentos?.cotizacion?.numero, d.ticket?.condiciones?.numero].map(normNumCotizacion).filter(Boolean)
        );
        const asignados = docsDe(d.clave)
          .filter((a) => a.doc !== d.cotNueva)
          .sort((a, b) => b.puntos - a.puntos);
        const n = { cot: 0, inf: 0, cert: 0, otros: 0, ya: 0 };
        let finaliza = false;
        for (const a of asignados) {
          const l = a.doc.leido!;
          const f = file(a.doc);
          if (l.tipo === "cotizacion") {
            const num = normNumCotizacion(l.cotizacion?.numero);
            if (num && cotsDelTicket.has(num)) { n.ya++; continue; }
            if (!tiene.cotizacion && l.cotizacion) {
              await guardarCotizacionEnTicket(id, f);
              tiene.cotizacion = true;
            } else await agregarAdicional(id, f, "cotizacion");
            if (num) cotsDelTicket.add(num);
            n.cot++;
          } else if (l.tipo === "informe" || l.tipo === "certificado") {
            const linea: DocumentoClave = l.tipo;
            if (!tiene[linea]) {
              await guardarDocumentoEnTicket(id, f, linea);
              tiene[linea] = true;
              if (linea === "informe") finaliza = true;
            } else await agregarAdicional(id, f, linea);
            if (l.tipo === "informe") n.inf++; else n.cert++;
          } else {
            await agregarAdicional(id, f, l.tipo === "guia" ? "oc" : "informe");
            n.otros++;
          }
        }
        if (n.cot) hecho.push(`${n.cot} cotización${n.cot > 1 ? "es" : ""}`);
        if (n.inf) hecho.push(`${n.inf} informe${n.inf > 1 ? "s" : ""}${finaliza ? ' → "Finalizado"' : ""}`);
        if (n.cert) hecho.push(`${n.cert} certificado${n.cert > 1 ? "s" : ""}`);
        if (n.otros) hecho.push(`${n.otros} documento${n.otros > 1 ? "s" : ""} más`);
        if (n.ya) hecho.push(`${n.ya} cotización${n.ya > 1 ? "es" : ""} que ya tenía`);
        setResultados((r) => ({ ...r, [d.clave]: { ok: true, texto: hecho.join(" · ") } }));
        void autoGuardarTicket(id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Error";
        setResultados((r) => ({ ...r, [d.clave]: { ok: false, texto: hecho.length ? `${hecho.join(" · ")} · luego falló: ${msg}` : msg } }));
        if (id) void autoGuardarTicket(id);
      }
      setAvance((a) => ({ ...a, hechos: a.hechos + 1 }));
    }
    setFase("listo");
    onTerminado();
  }

  const ocupado = fase === "leyendo" || fase === "aplicando";
  const atributosCarpeta = { webkitdirectory: "", directory: "" } as Record<string, string>;
  const deInput = (files: FileList | null) =>
    Array.from((files ?? []) as ArrayLike<File>).map((f: File) => ({
      file: f,
      ruta: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
    }));

  /** Opciones del selector de un documento: los trabajos de la carga y sus alternativas. */
  function opciones(docId: number) {
    const a = agr?.asignaciones.find((x) => x.doc.id === docId);
    const claves = new Map<string, string>();
    for (const d of todosDestinos) claves.set(d.clave, tituloDestino(d));
    for (const alt of a?.alternativas ?? []) {
      if (claves.has(alt.destino)) continue;
      const d = destinoPorClave(alt.destino);
      if (d) claves.set(alt.destino, `${tituloDestino(d)} (posible: ${alt.motivo})`);
    }
    return [...claves.entries()];
  }

  function filaDoc(a: Agrupacion["asignaciones"][number]) {
    const l = a.doc.leido!;
    const sel = eleccion[a.doc.id] ?? NO_CARGAR;
    return (
      <li key={a.doc.id} className="py-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${COLOR[l.tipo]}`}>{ETIQUETA[l.tipo]}</span>
          <span className="truncate font-mono-tag" title={a.doc.nombre}>{a.doc.nombre}</span>
          {sel !== NO_CARGAR && sel === a.destino && !a.seguro && <span className="text-amber-800">⚠ revisar</span>}
        </div>
        {sel === a.destino && a.motivo && <p className="mt-0.5 text-ink-soft">{a.motivo}</p>}
        {fase === "revision" && (
          <select
            className="mt-1 w-full rounded-md border border-line-strong px-2 py-1 text-xs text-ink"
            value={sel}
            onChange={(e) => setEleccion((x) => ({ ...x, [a.doc.id]: e.target.value }))}
            aria-label={`Trabajo de ${a.doc.nombre}`}
          >
            <option value={NO_CARGAR}>No cargar este documento</option>
            {opciones(a.doc.id).map(([k, t]) => (
              <option key={k} value={k}>{t}</option>
            ))}
          </select>
        )}
      </li>
    );
  }

  const aProcesar = todosDestinos.filter((d) => !excluidos.has(d.clave)).length;
  const hechosOk = Object.values(resultados).filter((r) => r.ok).length;
  const hechosMal = Object.values(resultados).filter((r) => !r.ok).length;

  return (
    <>
      <input ref={archivosRef} type="file" multiple accept="application/pdf,.pdf" className="hidden"
        onChange={(e) => { const l = deInput(e.target.files); e.target.value = ""; void procesar(l); }} />
      <input ref={carpetaRef} type="file" multiple className="hidden" {...atributosCarpeta}
        onChange={(e) => { const l = deInput(e.target.files); e.target.value = ""; void procesar(l); }} />
      <span
        className={`inline-flex rounded-md border ${encima ? "border-amber bg-amber-50" : "border-amber"}`}
        onDragOver={(e) => { e.preventDefault(); setEncima(true); }}
        onDragLeave={() => setEncima(false)}
        onDrop={(e) => {
          e.preventDefault();
          setEncima(false);
          if (!ocupado) void archivosArrastrados(e.dataTransfer.items).then(procesar);
        }}
      >
        <button
          type="button"
          disabled={ocupado}
          onClick={() => archivosRef.current?.click()}
          title="Elige (o arrastra aquí) muchos PDF a la vez: OC, cotizaciones, informes, actas, certificados, guías. La app los junta por trabajo y guarda cada trabajo en un solo ticket"
          className="px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50 rounded-l-md"
        >
          {fase === "leyendo" ? `Leyendo ${avance.hechos}/${avance.total}…` : "+ Documentos"}
        </button>
        <button
          type="button"
          disabled={ocupado}
          onClick={() => carpetaRef.current?.click()}
          title="Elegir una carpeta (cada subcarpeta = un trabajo)"
          aria-label="Cargar una carpeta"
          className="border-l border-amber px-2.5 py-2 text-sm text-amber-800 hover:bg-amber-50 disabled:opacity-50 rounded-r-md"
        >
          📁
        </button>
      </span>

      {fase !== "cerrado" && fase !== "leyendo" && agr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Cargar documentos">
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-lg border border-line bg-white shadow-card">
            <div className="border-b border-line px-6 py-4">
              <h2 className="font-display font-bold text-xl tracking-tight">
                {fase === "listo" ? "Resultado de la carga" : `${todosDestinos.length} trabajo${todosDestinos.length === 1 ? "" : "s"} encontrado${todosDestinos.length === 1 ? "" : "s"}`}
              </h2>
              <p className="mt-1 text-xs text-ink-soft">
                {fase === "listo"
                  ? `${hechosOk} ticket${hechosOk === 1 ? "" : "s"} listo${hechosOk === 1 ? "" : "s"}${hechosMal ? ` · ${hechosMal} con error` : ""}.`
                  : `Se compararon N° de OC, N° de cotización, RUC, montos, fechas y descripciones. Cada trabajo queda en un solo ticket. ⚠ = coincidencia por descripción: revísala. Puedes mover cualquier documento con su selector.`}
                {agr.duplicados.length > 0 && ` ${agr.duplicados.length} archivo${agr.duplicados.length === 1 ? "" : "s"} repetido${agr.duplicados.length === 1 ? "" : "s"} (se omite${agr.duplicados.length === 1 ? "" : "n"}).`}
                {ignorados > 0 && ` ${ignorados} archivo${ignorados === 1 ? "" : "s"} que no son PDF (se omiten).`}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-2">
              <ul className="divide-y divide-line">
                {todosDestinos.map((d) => {
                  const r = resultados[d.clave];
                  const docs = docsDe(d.clave).filter((a) => a.doc !== d.cotNueva);
                  return (
                    <li key={d.clave} className="flex items-start gap-3 py-3 text-sm">
                      {fase === "revision" ? (
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={!excluidos.has(d.clave)}
                          onChange={(e) =>
                            setExcluidos((x) => {
                              const n = new Set(x);
                              if (e.target.checked) n.delete(d.clave); else n.add(d.clave);
                              return n;
                            })
                          }
                          aria-label={`Aplicar ${tituloDestino(d)}`}
                        />
                      ) : (
                        <span className={`mt-0.5 w-4 shrink-0 text-center ${r ? (r.ok ? "text-emerald-700" : "text-danger") : "text-ink-soft"}`} aria-hidden="true">
                          {r ? (r.ok ? "✓" : "✗") : "·"}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium break-words">{tituloDestino(d)}</p>
                        {(d.oc || d.cotNueva) && (
                          <p className="text-xs text-ink-soft">
                            <span className={`mr-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${COLOR[d.oc ? "oc" : "cotizacion"]}`}>{d.oc ? "OC" : "Cotización"}</span>
                            <span className="font-mono-tag">{(d.oc ?? d.cotNueva)!.nombre}</span>
                          </p>
                        )}
                        {docs.length > 0 && <ul className="mt-1 divide-y divide-line/60">{docs.map(filaDoc)}</ul>}
                        {r && <p className={`mt-1 text-xs ${r.ok ? "text-emerald-700" : "text-danger"}`}>{r.texto}</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {sueltos.length > 0 && (
                <div className="mt-3 rounded-md border border-amber/40 bg-amber-50/40 px-4 py-3">
                  <p className="text-sm font-medium">Sin trabajo identificado ({sueltos.length})</p>
                  <p className="text-xs text-ink-soft">No citan su OC ni su cotización y la descripción no alcanzó. Elige a qué trabajo van, o déjalos sin cargar.</p>
                  <ul className="mt-1 divide-y divide-line/60">{sueltos.map(filaDoc)}</ul>
                </div>
              )}
              {agr.errores.length > 0 && (
                <p className="mt-3 text-xs text-danger">
                  No se pudieron leer: {agr.errores.map((d) => `${d.nombre} (${d.error})`).join(" · ")}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-line px-6 py-4">
              <span className="text-xs text-ink-soft">
                {fase === "aplicando" ? `Procesando ${avance.hechos}/${avance.total}…` : fase === "revision" ? `${aProcesar} ticket${aProcesar === 1 ? "" : "s"} por procesar` : ""}
              </span>
              <div className="flex gap-3">
                {fase === "revision" && (
                  <>
                    <button type="button" onClick={() => setFase("cerrado")}
                      className="border border-line-strong rounded-md px-5 py-2 text-sm font-medium hover:bg-concrete-dim transition-colors">
                      Cancelar
                    </button>
                    <button type="button" disabled={aProcesar === 0} onClick={() => void aplicar()}
                      className="bg-amber border border-amber text-white rounded-md px-5 py-2 text-sm font-medium hover:bg-amber-hover hover:border-amber-hover transition-colors disabled:opacity-50">
                      Aplicar ({aProcesar})
                    </button>
                  </>
                )}
                {fase === "listo" && (
                  <button type="button" onClick={() => setFase("cerrado")}
                    className="bg-amber border border-amber text-white rounded-md px-5 py-2 text-sm font-medium hover:bg-amber-hover hover:border-amber-hover transition-colors">
                    Cerrar
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
