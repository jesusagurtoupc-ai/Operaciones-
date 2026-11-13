"use client";

import { useRef, useState } from "react";
import type { Correctivo, DatosOC, DatosCotizacion, DocumentoClave, DocumentoLeido } from "@/lib/shared";
import { ticketsParaDocumento } from "@/lib/agruparDocumentos";
import { MAX_ADICIONALES, formatoFecha, formatoSoles, toDateOnly } from "@/lib/shared";
import { leerOrdenCompra, prepararAutoguardado, autoGuardarTicket } from "@/lib/client";
import { candidatosParaOc, claveCotizacion, cotizacionRegistrada, mismoMonto, mismoProveedor } from "./emparejarCarga";

/* ───────── Qué datos de un ticket existente puede actualizar una OC ───────── */
export type CampoAct = "f_oc" | "proveedor" | "ruc_proveedor" | "monto" | "contrato" | "f_entrega" | "descripcion";
const CAMPOS_ACT: { k: CampoAct; etiqueta: string }[] = [
  { k: "f_oc", etiqueta: "F. OC" },
  { k: "proveedor", etiqueta: "Proveedor" },
  { k: "ruc_proveedor", etiqueta: "RUC" },
  { k: "monto", etiqueta: "Monto" },
  { k: "contrato", etiqueta: "Contrato" },
  { k: "f_entrega", etiqueta: "F. entrega" },
  { k: "descripcion", etiqueta: "Descripción" },
];

/** A dónde puede ir una OC que aún no está registrada: un ticket sin OC o la cotización de esta misma carga. */
type OpcionOc = {
  destino: { ticket: number } | { fila: number };
  etiqueta: string;
  /** Mismo proveedor Y mismo monto (la coincidencia fuerte). */
  coincideMonto: boolean;
  campos: CampoAct[];
  cambios: string[];
};

type Fila = {
  id: number;
  archivo: File;
  /** "repetida" = cotización que ya está en un ticket: no se procesa. */
  tipo: "nueva" | "actualizar" | "cotizacion" | "informe" | "repetida" | "error";
  /** Informe técnico: lo leído y los tickets de su OC (ticketId = el elegido). */
  datosInf?: DatosInformeLeido;
  n_oc: string | null;
  /** Cotización: lo que se leyó del PDF y el ticket al que va (null = falta elegirlo a mano). */
  datosCot?: DatosCotizacion;
  ticketId?: number | null;
  asignado?: "nombre" | "manual";
  /** Cotización sin ticket: crear uno nuevo con ella (si no, se asigna a uno existente). */
  crearNueva?: boolean;
  /** OC no registrada: lo leído y a qué ticket podría vincularse (eleccionOc: "nueva" = crear ticket; número = opción; null = falta elegir). */
  datosOc?: DatosOC;
  opcionesOc?: OpcionOc[];
  eleccionOc?: "nueva" | number | null;
  /** Ticket que se actualiza (solo tipo "actualizar"). */
  destinoId?: number;
  destinoRef?: number | null;
  campos: CampoAct[];
  cambios: string[];
  avisos: string[];
  incluir: boolean;
  /** Motivo del error (tipo "error"). */
  detalle?: string;
  /** Lo que pasó al aplicar. */
  resultado?: { ok: boolean; texto: string };
};

/** Informe leído (con /api/documentos/leer) y sus tickets posibles. */
type TicketDeInforme = { id: number; refer: number | null; n_oc: string | null; estado: string | null; descripcion: string | null; tiene_informe: boolean };
export type DatosInformeLeido = {
  titulo: string; ocs: string[]; cotizaciones: string[]; ruc: string | null; fecha: string | null; referencia: string | null;
  tickets: TicketDeInforme[]; por: "oc" | "cotizacion" | "descripcion" | null;
  /** Por qué se eligió el primer ticket; claro = sin otro ticket casi igual de probable. */
  motivo: string; claro: boolean;
};

type Fase = "cerrado" | "leyendo" | "revision" | "aplicando" | "listo";

const claveOc = (v: string | null) => (v ?? "").trim().toLowerCase();

/** Valor que trae el PDF para cada dato (null = no lo trae o no vale todavía). Monto con IGV, fechas ambiguas sin confirmar. */
function nuevoDe(d: DatosOC, k: CampoAct): string | number | null {
  const enSoles = !d.moneda || d.moneda === "PEN";
  const fechasValen = !d.fecha_ambigua;
  switch (k) {
    case "f_oc": return fechasValen ? d.f_oc : null;
    case "f_entrega": return fechasValen ? d.f_entrega : null;
    case "proveedor": return d.proveedor;
    case "ruc_proveedor": return d.ruc_proveedor;
    case "contrato": return d.contrato;
    case "descripcion": return d.descripcion;
    case "monto": return enSoles ? d.total : null;
  }
}

function actualDe(c: Correctivo, k: CampoAct): string | number | null {
  if (k === "f_oc" || k === "f_entrega") return toDateOnly(c[k]) || null;
  const v = c[k];
  return v === undefined || v === "" ? null : (v as string | number | null);
}

function iguales(a: string | number | null, n: string | number | null, k: CampoAct) {
  if (k === "monto") return (a === null ? null : Number(a)) === (n === null ? null : Number(n));
  return String(a ?? "").trim() === String(n ?? "").trim();
}

function mostrar(k: CampoAct, v: string | number | null) {
  if (v === null) return "—";
  if (k === "monto") return formatoSoles(Number(v));
  if (k === "f_oc" || k === "f_entrega") return formatoFecha(String(v));
  const t = String(v);
  return t.length > 40 ? t.slice(0, 40) + "…" : t;
}

/** Compara el ticket con el PDF: qué datos cambiarían. La descripción solo se completa si está vacía (suele estar editada a mano). */
function compararConTicket(d: DatosOC, c: Correctivo) {
  const campos: CampoAct[] = [];
  const cambios: string[] = [];
  for (const { k, etiqueta } of CAMPOS_ACT) {
    const nuevo = nuevoDe(d, k);
    if (nuevo === null) continue;
    const antes = actualDe(c, k);
    if (iguales(antes, nuevo, k)) continue;
    if (k === "descripcion" && antes !== null) continue;
    campos.push(k);
    cambios.push(`${etiqueta}: ${mostrar(k, antes)} → ${mostrar(k, nuevo)}`);
  }
  return { campos, cambios };
}


/* ───────── Cotizaciones: reconocerlas y asignarlas a un ticket ───────── */
export const PISTA_COTIZACION = /cotiz|propuesta|presupuesto|proforma|^cot[-_ ]?\d|^coti[-_ 0-9]/i;
const vacio = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function leerComoCotizacion(f: File): Promise<DatosCotizacion> {
  const fd = new FormData();
  fd.append("file", f, f.name);
  const r = await fetch("/api/cotizaciones/leer", { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "No se pudo leer la cotización");
  const d = j.data as DatosCotizacion;
  // Estricto, para no confundir con un informe u otro documento.
  if (d.total === null || !(d.ruc_proveedor || d.proveedor)) throw new Error("No parece una cotización");
  return d;
}

/* ───────── Informes técnicos: se guardan en la línea "Informe" del ticket de su OC ───────── */
export const PISTA_INFORME = /informe|conformidad|\bacta\b|^it[\s_-]*n?[°º_]?\s*\d/i;

/** Lee cualquier documento (OC, cotización, informe, certificado, guía…) con sus pistas. */
export async function leerDocumentoArchivo(f: File): Promise<DocumentoLeido> {
  const fd = new FormData();
  fd.append("file", f, f.name);
  const r = await fetch("/api/documentos/leer", { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "No se pudo leer el documento");
  return j.data as DocumentoLeido;
}

/** Lee un informe técnico y busca sus tickets (por OC, N° de cotización, proveedor y descripción). */
export async function leerComoInforme(f: File, tickets: Correctivo[]): Promise<DatosInformeLeido> {
  const d = await leerDocumentoArchivo(f);
  if (d.tipo !== "informe") throw new Error("No es un informe técnico");
  const posibles = ticketsParaDocumento({ id: 0, nombre: f.name, carpeta: null, huella: "", leido: d }, tickets);
  const [mejor, segundo] = posibles;
  const claro = !!mejor && (mejor.fuerte || !segundo || mejor.puntos - segundo.puntos >= 15);
  return {
    titulo: d.titulo ?? "Informe técnico",
    ocs: d.pistas.ocs,
    cotizaciones: d.pistas.cotizaciones,
    ruc: d.pistas.ruc,
    fecha: d.pistas.fecha,
    referencia: d.pistas.resumen.split(" · ")[1]?.slice(0, 120) ?? null,
    tickets: posibles.slice(0, 8).map(({ t }) => ({
      id: t.id, refer: t.refer, n_oc: t.n_oc, estado: t.estado, descripcion: t.descripcion,
      tiene_informe: !!t.documentos?.informe?.url,
    })),
    por: mejor ? (/OC/.test(mejor.motivo) ? "oc" : /cotizaci/.test(mejor.motivo) ? "cotizacion" : "descripcion") : null,
    motivo: mejor?.motivo ?? "",
    claro,
  };
}

/** Sube un archivo al ticket y lo deja como el documento de esa línea; si había otro propio, lo borra. */
export async function guardarDocumentoEnTicket(id: number, archivo: File, linea: DocumentoClave, fechaInforme?: string | null) {
  const rt = await fetch(`/api/correctivos/${id}`);
  const jt = await rt.json().catch(() => null);
  if (!rt.ok || !jt?.data) throw new Error("No se pudo leer el ticket");
  const c = jt.data as Correctivo;
  const docs = c.documentos ?? {};
  const base = `/api/correctivos/${id}/archivos`;

  const fd = new FormData();
  fd.append("file", archivo, archivo.name);
  const up = await fetch(base, { method: "POST", body: fd });
  const upData = await up.json().catch(() => ({}));
  if (!up.ok) throw new Error(upData.error || "No se pudo subir el archivo");
  const urlNueva = `${base}/${upData.data.id}`;

  const put = await fetch(`/api/correctivos/${id}/documentos`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...docs,
      [linea]: {
        numero: archivo.name.replace(/\.[^.]+$/, ""),
        estado: "Listo",
        url: urlNueva,
        ...(docs[linea]?.adicionales?.length ? { adicionales: docs[linea]!.adicionales } : {}),
      },
      ...(fechaInforme ? { _fecha_informe: fechaInforme } : {}),
    }),
  });
  const pd = await put.json().catch(() => ({}));
  if (!put.ok) {
    await fetch(urlNueva, { method: "DELETE" }).catch(() => {});
    throw new Error(pd.error || "No se pudo guardar el documento");
  }
  const anterior = docs[linea]?.url ?? "";
  if (anterior && anterior !== urlNueva && anterior.startsWith(`${base}/`)) {
    await fetch(anterior, { method: "DELETE" }).catch(() => {});
  }
  return { c, estado: (pd.estado ?? null) as string | null };
}

/**
 * Agrega un archivo a una línea de documentos SIN reemplazar el que ya tiene (otra cotización, una guía
 * de remisión, un acta…). No cambia el estado del ticket.
 */
export async function agregarAdicional(id: number, archivo: File, linea: DocumentoClave) {
  const rt = await fetch(`/api/correctivos/${id}`);
  const jt = await rt.json().catch(() => null);
  if (!rt.ok || !jt?.data) throw new Error("No se pudo leer el ticket");
  const docs = (jt.data as Correctivo).documentos ?? {};
  const base = `/api/correctivos/${id}/archivos`;
  const fd = new FormData();
  fd.append("file", archivo, archivo.name);
  const up = await fetch(base, { method: "POST", body: fd });
  const upData = await up.json().catch(() => ({}));
  if (!up.ok) throw new Error(upData.error || "No se pudo subir el archivo");
  const urlNueva = `${base}/${upData.data.id}`;
  const actual = docs[linea] ?? { numero: "", estado: "Pendiente", url: "" };
  const adicionales = [...(actual.adicionales ?? []), { nombre: archivo.name, url: urlNueva }];
  if (adicionales.length > MAX_ADICIONALES) {
    await fetch(urlNueva, { method: "DELETE" }).catch(() => {});
    throw new Error(`La línea ya tiene ${MAX_ADICIONALES} archivos adicionales`);
  }
  const put = await fetch(`/api/correctivos/${id}/documentos`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...docs, [linea]: { ...actual, adicionales } }),
  });
  if (!put.ok) {
    const pd = await put.json().catch(() => ({}));
    await fetch(urlNueva, { method: "DELETE" }).catch(() => {});
    throw new Error(pd.error || "No se pudo guardar el documento");
  }
}

/** Trae todos los tickets activos (de 200 en 200) para buscar a cuál pertenece cada cotización. */
export async function traerTickets(): Promise<Correctivo[]> {
  const todos: Correctivo[] = [];
  for (let p = 1; ; p++) {
    const res = await fetch(`/api/correctivos?page=${p}&pageSize=200&facetas=0`);
    if (!res.ok) throw new Error("No se pudo leer la lista de tickets");
    const d = await res.json();
    todos.push(...(d.data as Correctivo[]));
    if (p >= (d.pagination?.totalPages ?? 1)) break;
  }
  return todos;
}

/**
 * Busca el ticket por el nombre del archivo: primero el N° de ticket (completo, entre separadores) y,
 * si no, la Ref (“ref 123”, “#123” o un número al inicio del nombre). Si hay duda (dos tickets
 * posibles) devuelve null y se elige a mano.
 */
function emparejarPorNombre(nombre: string, tickets: Correctivo[]): Correctivo | null {
  const n = nombre.replace(/\.[^.]+$/, "").toLowerCase();
  const porCodigo: { c: Correctivo; largo: number }[] = [];
  for (const c of tickets) {
    const cod = (c.ticket ?? "").trim().toLowerCase();
    if (cod.length < 3) continue;
    const re = new RegExp(`(^|[^a-z0-9])${escapar(cod).replace(/\s+/g, "[\\s_-]*")}(?![a-z0-9])`);
    if (re.test(n)) porCodigo.push({ c, largo: cod.length });
  }
  if (porCodigo.length > 0) {
    const mayor = Math.max(...porCodigo.map((x) => x.largo));
    const mejores = porCodigo.filter((x) => x.largo === mayor);
    return mejores.length === 1 ? mejores[0].c : null;
  }
  const m = /(?:ref(?:erencia)?|#)[\s._-]*(\d+)/i.exec(n) ?? /^(\d{1,6})(?=[\s._-]|$)/.exec(n);
  if (m) {
    const ref = Number(m[1]);
    const coinciden = tickets.filter((c) => c.refer === ref);
    if (coinciden.length === 1) return coinciden[0];
  }
  return null;
}

/** Qué datos vacíos del ticket completaría la cotización (nunca pisa lo ya escrito). */
function completaCotizacion(d: DatosCotizacion, c: Correctivo): string[] {
  const out: string[] = [];
  if (vacio(c.proveedor) && d.proveedor) out.push(`Proveedor: ${d.proveedor}`);
  if (vacio(c.ruc_proveedor) && d.ruc_proveedor) out.push(`RUC: ${d.ruc_proveedor}`);
  if (vacio(toDateOnly(c.f_coti)) && d.fecha && !d.fecha_ambigua) out.push(`F. cotización: ${formatoFecha(d.fecha)}`);
  if ((c.monto === null || c.monto === undefined) && d.moneda !== "USD" && d.total !== null) {
    out.push(`Monto: ${formatoSoles(d.total)}`);
  }
  return out;
}

const etiquetaTicket = (c: Correctivo) =>
  `#${c.refer ?? c.id} · ${c.ticket || "sin ticket"} · ${c.proveedor || "sin proveedor"} · ${(c.descripcion ?? "").slice(0, 50)}`;

/** Sube la cotización al ticket, la deja como su documento y completa los datos vacíos. */
export async function guardarCotizacionEnTicket(id: number, archivo: File): Promise<{ ok: boolean; texto: string }> {
  const { c } = await guardarDocumentoEnTicket(id, archivo, "cotizacion");
  const ref = c.refer ?? id;
  const ra = await fetch(`/api/correctivos/${id}/aplicar-cotizacion`, { method: "POST" });
  const ja = await ra.json().catch(() => ({}));
  if (!ra.ok) {
    return { ok: true, texto: `Ticket #${ref}: cotización guardada, pero no se pudo leer (${ja.error || "error"})` };
  }
  return { ok: true, texto: `Ticket #${ref}: ${ja.data?.resumen ?? "cotización guardada"}` };
}

/** Crea un ticket nuevo con la cotización (los datos los lee el servidor del PDF). */
export async function crearTicketDesdeCotizacion(archivo: File): Promise<{ id: number; refer: number | null }> {
  const fd = new FormData();
  fd.append("file", archivo, archivo.name);
  const r = await fetch("/api/correctivos/desde-cotizacion", { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "No se pudo crear el ticket desde la cotización");
  return { id: j.data.id, refer: j.data.refer ?? null };
}

/** Asigna la OC a un ticket que aún no tiene OC (creado desde su cotización): pasa a "Por Ejecutar". */
export async function vincularOc(ticketId: number, archivo: File, campos: CampoAct[]) {
  const fd = new FormData();
  fd.append("file", archivo, archivo.name);
  fd.append("base", "total");
  fd.append("vincular", "1");
  for (const k of campos) fd.append("campo", k);
  const r = await fetch(`/api/correctivos/${ticketId}/actualizar-oc`, { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "No se pudo vincular la OC");
  return { id: ticketId, refer: (j.data?.refer ?? null) as number | null, estado: (j.estado ?? null) as string | null };
}

const etiquetaOpcion = (c: Correctivo) =>
  `#${c.refer ?? c.id} · ${c.estado || "sin estado"} · ${c.monto !== null && c.monto !== undefined ? formatoSoles(Number(c.monto)) : "sin monto"} · ${(c.descripcion ?? "").slice(0, 45)}`;

/** Elección inicial: si hay UNA sola coincidencia fuerte (proveedor y monto) se vincula; si hay varias, se elige a mano; si no hay, se crea ticket. */
function eleccionInicial(opciones: OpcionOc[]): "nueva" | number | null {
  const fuertes = opciones.map((o, i) => (o.coincideMonto ? i : -1)).filter((i) => i >= 0);
  if (fuertes.length === 1) return fuertes[0];
  if (fuertes.length > 1) return null;
  return "nueva";
}

/**
 * Botón "+ OC" de la lista. Al presionarlo se eligen uno o varios PDF de órdenes de compra:
 *  - OC que aún no está registrada → se crea un ticket (monto con IGV).
 *  - OC que ya está en un ticket → se actualiza ese ticket con los datos del PDF y se reemplaza su PDF.
 *  - OC no registrada pero que coincide (mismo proveedor y monto) con un ticket que aún no tiene OC —p. ej.
 *    uno creado desde su cotización, o la cotización de esta misma carga— → se VINCULA a ese ticket
 *    (pasa a "Por Ejecutar") en vez de crear uno repetido. Se puede cambiar a "crear ticket nuevo".
 *  - Cotización (PDF que no es una OC) → si el nombre del archivo indica su ticket (N° de ticket o Ref),
 *    se guarda en él y completa sus datos vacíos. Si no, CREA UN TICKET NUEVO con ella (estado "enviado");
 *    también se puede asignar a mano a un ticket existente. Si esa cotización ya está en un ticket, se omite.
 * Antes de tocar nada se muestra una revisión donde se puede desmarcar lo que no se quiere aplicar.
 * Las fechas que el PDF deja ambiguas (mes/día) no se usan: se completan después en el ticket.
 */
export default function CargaOC({ onTerminado }: { onTerminado: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fase, setFase] = useState<Fase>("cerrado");
  const [avance, setAvance] = useState({ hechos: 0, total: 0 });
  const [filas, setFilas] = useState<Fila[]>([]);
  // Tickets activos, para asignar las cotizaciones (se cargan solo si hay alguna).
  const [tickets, setTickets] = useState<Correctivo[]>([]);

  async function alElegir(files: FileList | null) {
    const lista = files ? Array.from(files) : [];
    if (inputRef.current) inputRef.current.value = "";
    if (lista.length === 0) return;

    setFilas([]);
    setAvance({ hechos: 0, total: lista.length });
    setFase("leyendo");

    const salida: Fila[] = [];
    const vistas = new Map<string, string>(); // OC → archivo donde ya apareció
    const cotVistas = new Map<string, string>(); // proveedor + N° de cotización → archivo
    let ticketsP: Promise<Correctivo[]> | null = null;
    const conTickets = () => (ticketsP ??= traerTickets());

    for (let i = 0; i < lista.length; i++) {
      const archivo = lista[i];
      const base: Fila = { id: i, archivo, tipo: "error", n_oc: null, campos: [], cambios: [], avisos: [], incluir: false };
      try {
        // ¿OC o cotización? Si el nombre dice cotización se prueba primero como cotización; si no, como OC.
        let oc: DatosOC | null = null;
        let cot: DatosCotizacion | null = null;
        let errOc = "";
        const pruebaOc = async () => {
          try {
            oc = await leerOrdenCompra(archivo, archivo.name);
          } catch (e) {
            errOc = e instanceof Error ? e.message : "No se pudo leer la OC";
          }
        };
        let inf: DatosInformeLeido | null = null;
        const pruebaInf = async () => {
          try {
            inf = await leerComoInforme(archivo, await conTickets());
          } catch {
            /* no es un informe */
          }
        };
        const pruebaCot = async () => {
          try {
            cot = await leerComoCotizacion(archivo);
          } catch {
            /* no es una cotización */
          }
        };
        // Informe técnico: se reconoce por su título (el lector de OC lo rechaza aunque cite el N° de OC).
        if (PISTA_INFORME.test(archivo.name)) await pruebaInf();
        if (!inf) {
          if (PISTA_COTIZACION.test(archivo.name)) {
            await pruebaCot();
            if (!cot) await pruebaOc();
          } else {
            await pruebaOc();
            if (!oc && /informe|acta|conformidad/i.test(errOc)) await pruebaInf();
            if (!oc && !inf && /\.pdf$/i.test(archivo.name)) await pruebaCot();
          }
        }

        if (inf) {
          const d: DatosInformeLeido = inf;
          base.tipo = "informe";
          base.datosInf = d;
          base.n_oc = d.ocs[0] ?? null;
          if (d.tickets.length === 0) {
            const cita = [d.ocs.length ? `OC ${d.ocs.join(", ")}` : "", d.cotizaciones.length ? `cotización ${d.cotizaciones.join(", ")}` : ""]
              .filter(Boolean)
              .join(" / ");
            throw new Error(
              cita
                ? `${d.titulo} (${cita}): no hay ningún ticket con esa ${d.ocs.length ? "OC" : "cotización"}. Cárgalo junto con su OC usando "Carpetas"`
                : `${d.titulo}: no cita su OC ni su cotización. Cárgalo junto con su OC usando "Carpetas", o súbelo desde el ticket`
            );
          }
          if (d.motivo) base.avisos.push(`Ticket encontrado porque: ${d.motivo}`);
          base.ticketId = d.claro ? d.tickets[0].id : null;
          base.incluir = base.ticketId !== null;
          if (!d.claro) base.avisos.push("Hay varios tickets posibles: elige a cuál va");
          const t = d.tickets.find((x) => x.id === base.ticketId);
          if (t?.tiene_informe) base.avisos.push("Reemplaza el informe actual del ticket");
        } else if (cot) {
          const d: DatosCotizacion = cot;
          const todos = await conTickets();
          const c = emparejarPorNombre(archivo.name, todos);
          const ya = c ? null : cotizacionRegistrada(d, todos);
          const clave = claveCotizacion(d);
          if (ya) {
            base.tipo = "repetida";
            base.datosCot = d;
            base.detalle = `La cotización N° ${d.numero} ya está en el ticket #${ya.refer ?? ya.id}: no se procesa`;
            base.incluir = false;
            salida.push(base);
            setAvance((a) => ({ ...a, hechos: a.hechos + 1 }));
            continue;
          }
          if (clave && cotVistas.has(clave)) throw new Error(`Repetida en la selección (misma cotización que ${cotVistas.get(clave)})`);
          if (clave) cotVistas.set(clave, archivo.name);
          base.tipo = "cotizacion";
          base.datosCot = d;
          base.ticketId = c ? c.id : null;
          base.asignado = c ? "nombre" : undefined;
          base.crearNueva = !c; // sin ticket por el nombre: se crea uno nuevo con la cotización
          base.incluir = true;
          if (d.fecha_ambigua) base.avisos.push("Fecha ambigua: no se guarda");
          if (d.moneda === "USD") base.avisos.push("Cotización en USD: sin monto");
        } else if (oc) {
          const d: DatosOC = oc;
          base.n_oc = d.n_oc;
          if (!d.n_oc) throw new Error("No se pudo leer el N° de la orden de compra");
          const previa = vistas.get(claveOc(d.n_oc));
          if (previa) throw new Error(`Repetida en la selección (misma OC que ${previa})`);
          vistas.set(claveOc(d.n_oc), archivo.name);

          if (d.fecha_ambigua) base.avisos.push("Fechas ambiguas: no se guardan");
          if (d.moneda && d.moneda !== "PEN") base.avisos.push(`OC en ${d.moneda}: sin monto`);

          if (d.otros_tickets.length === 0) {
            // ¿Hay un ticket que la espera (sin OC, mismo proveedor; mejor si es el mismo monto)?
            const { conMonto, soloProveedor } = candidatosParaOc(d, await conTickets());
            const aOpcion = (c: Correctivo, coincideMonto: boolean): OpcionOc => {
              const { campos, cambios } = compararConTicket(d, c);
              return { destino: { ticket: c.id }, etiqueta: etiquetaOpcion(c), coincideMonto, campos, cambios };
            };
            base.tipo = "nueva";
            base.datosOc = d;
            base.opcionesOc = [...conMonto.map((c) => aOpcion(c, true)), ...soloProveedor.map((c) => aOpcion(c, false))];
            base.eleccionOc = eleccionInicial(base.opcionesOc);
            base.incluir = base.eleccionOc !== null;
          } else if (d.otros_tickets.length > 1) {
            const refs = d.otros_tickets.map((t) => `#${t.refer ?? t.id}`).join(", ");
            throw new Error(`La OC está en varios tickets (${refs}); actualízala desde el ticket`);
          } else {
            const t = d.otros_tickets[0];
            const res = await fetch(`/api/correctivos/${t.id}`);
            const json = await res.json().catch(() => null);
            if (!res.ok || !json?.data) throw new Error("No se pudo leer el ticket que tiene esta OC");
            const { campos, cambios } = compararConTicket(d, json.data as Correctivo);
            base.tipo = "actualizar";
            base.destinoId = t.id;
            base.destinoRef = t.refer;
            base.campos = campos;
            base.cambios = cambios;
            base.incluir = cambios.length > 0; // sin cambios en los datos: solo se reemplazaría el PDF
          }
        } else {
          throw new Error(
            /\.pdf$/i.test(archivo.name)
              ? `No se reconoció como OC, cotización ni informe técnico (${errOc})`
              : errOc || "No se pudo leer el archivo"
          );
        }
      } catch (e) {
        base.tipo = "error";
        base.incluir = false;
        base.detalle = e instanceof Error ? e.message : "No se pudo leer el archivo";
      }
      salida.push(base);
      setAvance((a) => ({ ...a, hechos: a.hechos + 1 }));
    }
    // OC y cotización del mismo trabajo en la MISMA carga: la OC se vincula al ticket que creará la cotización.
    for (const f of salida) {
      if (f.tipo !== "nueva" || !f.datosOc) continue;
      const d = f.datosOc;
      const enSoles = !d.moneda || d.moneda === "PEN";
      const extra: OpcionOc[] = salida
        .filter(
          (x) =>
            x.tipo === "cotizacion" && x.crearNueva && x.datosCot &&
            mismoProveedor(
              { ruc: d.ruc_proveedor, nombre: d.proveedor },
              { ruc: x.datosCot.ruc_proveedor, nombre: x.datosCot.proveedor }
            )
        )
        .map((x) => {
          const coincideMonto = enSoles && mismoMonto(x.datosCot!.total, d.total);
          const campos: CampoAct[] = ["f_oc", "f_entrega", "contrato", "monto"];
          return {
            destino: { fila: x.id },
            etiqueta: `Ticket que creará la cotización ${x.archivo.name}`,
            coincideMonto,
            campos,
            cambios: ["Se vincula al ticket que se crea con esa cotización: F. OC, F. entrega, contrato y monto de la OC"],
          };
        });
      if (extra.length === 0) continue;
      f.opcionesOc = [...extra.filter((o) => o.coincideMonto), ...(f.opcionesOc ?? []), ...extra.filter((o) => !o.coincideMonto)];
      f.eleccionOc = eleccionInicial(f.opcionesOc);
      f.incluir = f.eleccionOc !== null;
    }

    if (ticketsP) {
      try {
        setTickets(await ticketsP);
      } catch {
        /* sin lista no se puede elegir a mano */
      }
    }
    setFilas(salida);
    setFase("revision");
  }

  async function aplicar() {
    const elegidas = filas.filter((f) => f.incluir && f.tipo !== "error");
    if (elegidas.length === 0) return;
    setFase("aplicando");
    setAvance({ hechos: 0, total: elegidas.length });
    await prepararAutoguardado(); // es un clic de la persona: buen momento para el permiso de la carpeta local

    const resultados = new Map<number, { ok: boolean; texto: string }>();
    const creadosDesdeCot = new Map<number, { id: number; refer: number | null }>(); // fila → ticket creado
    // Primero las cotizaciones que crean ticket: así una OC de la misma carga ya tiene a qué vincularse.
    const crea = (f: Fila) => f.tipo === "cotizacion" && f.crearNueva && !f.ticketId;
    const orden = [...elegidas.filter(crea), ...elegidas.filter((f) => !crea(f))];
    for (const f of orden) {
      try {
        if (crea(f)) {
          const t = await crearTicketDesdeCotizacion(f.archivo);
          creadosDesdeCot.set(f.id, t);
          resultados.set(f.id, { ok: true, texto: `Ticket #${t.refer ?? t.id} creado desde la cotización (estado "enviado")` });
          void autoGuardarTicket(t.id);
        } else if (f.tipo === "informe") {
          if (!f.ticketId) throw new Error("Falta elegir el ticket");
          const { c, estado } = await guardarDocumentoEnTicket(f.ticketId, f.archivo, "informe", f.datosInf?.fecha ?? null);
          const pasa = estado;
          resultados.set(f.id, {
            ok: true,
            texto: `Informe guardado en el ticket #${c.refer ?? c.id}${pasa && pasa !== c.estado ? ` (pasa a "${pasa}")` : ""}`,
          });
          void autoGuardarTicket(f.ticketId);
        } else if (f.tipo === "cotizacion") {
          if (!f.ticketId) throw new Error("Falta elegir el ticket");
          resultados.set(f.id, await guardarCotizacionEnTicket(f.ticketId, f.archivo));
          void autoGuardarTicket(f.ticketId);
        } else if (f.tipo === "nueva" && typeof f.eleccionOc === "number") {
          const op = f.opcionesOc?.[f.eleccionOc];
          if (!op) throw new Error("Falta elegir el ticket");
          let destino: number | undefined;
          if ("ticket" in op.destino) destino = op.destino.ticket;
          else {
            destino = creadosDesdeCot.get(op.destino.fila)?.id;
            if (destino === undefined) throw new Error("No se creó el ticket de su cotización: vincúlala después desde el ticket");
          }
          const t = await vincularOc(destino, f.archivo, op.campos);
          resultados.set(f.id, {
            ok: true,
            texto: `OC vinculada al ticket #${t.refer ?? t.id}${t.estado ? ` (pasa a "${t.estado}")` : ""}`,
          });
          void autoGuardarTicket(destino);
        } else {
          const fd = new FormData();
          fd.append("file", f.archivo, f.archivo.name);
          fd.append("base", "total");
          let url = "/api/correctivos/desde-oc";
          if (f.tipo === "actualizar" && f.destinoId !== undefined) {
            url = `/api/correctivos/${f.destinoId}/actualizar-oc`;
            fd.append("reemplazar_pdf", "1");
            for (const k of f.campos) fd.append("campo", k);
          }
          const res = await fetch(url, { method: "POST", body: fd });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "No se pudo procesar");
          const id: number = data.data.id;
          const ref = data.data.refer ?? id;
          resultados.set(f.id, {
            ok: true,
            texto: f.tipo === "nueva" ? `Ticket #${ref} creado` : `Ticket #${ref} actualizado`,
          });
          void autoGuardarTicket(id);
        }
      } catch (e) {
        resultados.set(f.id, { ok: false, texto: e instanceof Error ? e.message : "Error" });
      }
      setAvance((a) => ({ ...a, hechos: a.hechos + 1 }));
      setFilas((prev) => prev.map((x) => (resultados.has(x.id) ? { ...x, resultado: resultados.get(x.id) } : x)));
    }
    setFase("listo");
    onTerminado();
  }

  /** Elige (o quita) a mano el ticket de una cotización. */
  function asignarTicket(filaId: number, c: Correctivo | null) {
    setFilas((prev) =>
      prev.map((x) =>
        x.id === filaId
          ? { ...x, ticketId: c ? c.id : null, asignado: c ? "manual" : undefined, crearNueva: false, incluir: !!c }
          : x
      )
    );
  }

  /** Cotización sin ticket: crear uno nuevo con ella (true) o asignarla a uno existente (false). */
  function crearConCotizacion(filaId: number, crear: boolean) {
    setFilas((prev) =>
      prev.map((x) => (x.id === filaId ? { ...x, crearNueva: crear, ticketId: null, asignado: undefined, incluir: crear } : x))
    );
  }

  /** OC no registrada: crear ticket nuevo ("nueva") o vincularla a una de sus opciones. */
  function elegirDestinoOc(filaId: number, eleccion: "nueva" | number) {
    setFilas((prev) => prev.map((x) => (x.id === filaId ? { ...x, eleccionOc: eleccion, incluir: true } : x)));
  }

  function cerrar() {
    setFase("cerrado");
    setFilas([]);
  }

  const nuevas = filas.filter((f) => f.tipo === "nueva" && f.eleccionOc === "nueva" && f.incluir).length;
  const vinculadas = filas.filter((f) => f.tipo === "nueva" && typeof f.eleccionOc === "number" && f.incluir).length;
  const actualizar = filas.filter((f) => f.tipo === "actualizar" && f.incluir).length;
  const desdeCot = filas.filter((f) => f.tipo === "cotizacion" && f.crearNueva && !f.ticketId && f.incluir).length;
  const cotizaciones = filas.filter((f) => f.tipo === "cotizacion" && !!f.ticketId && f.incluir).length;
  const informes = filas.filter((f) => f.tipo === "informe" && !!f.ticketId && f.incluir).length;
  const aProcesar = nuevas + vinculadas + actualizar + desdeCot + cotizaciones + informes;
  const porLabel = new Map(tickets.map((c) => [etiquetaTicket(c), c]));
  const porId = new Map(tickets.map((c) => [c.id, c]));
  const sinTicket = filas.filter((f) => f.tipo === "cotizacion" && !f.ticketId && !f.crearNueva).length;
  const porElegir = filas.filter((f) => f.tipo === "nueva" && f.eleccionOc === null).length;
  const ocupado = fase === "leyendo" || fase === "aplicando";

  const hechosOk = filas.filter((f) => f.resultado?.ok).length;
  const hechosMal = filas.filter((f) => f.resultado && !f.resultado.ok).length;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => void alElegir(e.target.files)}
      />
      <button
        type="button"
        disabled={ocupado}
        onClick={() => inputRef.current?.click()}
        title="Elige uno o varios PDF: OC (crean o actualizan tickets), cotizaciones (crean un ticket nuevo o se guardan en el suyo) e informes técnicos (se guardan en el ticket de su OC y lo finalizan)"
        aria-label="Cargar órdenes de compra y cotizaciones"
        className="bg-amber text-white border border-amber rounded-md px-4 py-2 text-sm font-medium hover:bg-amber-hover hover:border-amber-hover transition-colors disabled:opacity-50"
      >
        {fase === "leyendo" ? `Leyendo ${avance.hechos}/${avance.total}…` : "+ OC / Cotización / Informe"}
      </button>

      {fase !== "cerrado" && fase !== "leyendo" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Cargar órdenes de compra y cotizaciones"
        >
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-line bg-white shadow-card">
            <div className="border-b border-line px-6 py-4">
              <h2 className="font-display font-bold text-xl tracking-tight">
                {fase === "listo" ? "Resultado de la carga" : "Archivos seleccionados"}
              </h2>
              <p className="mt-1 text-xs text-ink-soft">
                {fase === "listo"
                  ? `${hechosOk} procesada${hechosOk === 1 ? "" : "s"} correctamente${hechosMal > 0 ? ` · ${hechosMal} con error` : ""}.`
                  : "Las cotizaciones crean un ticket nuevo (o se guardan en el suyo). Las OC crean un ticket, se vinculan al ticket de su cotización o actualizan el de su OC. Los informes técnicos se guardan en el ticket de su OC y lo finalizan. Revisa y desmarca lo que no quieras aplicar."}
              </p>
            </div>

            <datalist id="tickets-para-cotizaciones">
              {tickets.map((c) => (
                <option key={c.id} value={etiquetaTicket(c)} />
              ))}
            </datalist>

            <ul className="flex-1 divide-y divide-line overflow-y-auto px-2">
              {filas.map((f) => (
                <li key={f.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                  {fase === "revision" ? (
                    <input
                      type="checkbox"
                      className="mt-1"
                      disabled={
                        f.tipo === "error" ||
                        f.tipo === "repetida" ||
                        (f.tipo === "cotizacion" && !f.ticketId && !f.crearNueva) ||
                        (f.tipo === "informe" && !f.ticketId) ||
                        (f.tipo === "nueva" && f.eleccionOc === null)
                      }
                      checked={f.incluir}
                      onChange={(e) =>
                        setFilas((prev) => prev.map((x) => (x.id === f.id ? { ...x, incluir: e.target.checked } : x)))
                      }
                      aria-label={`Aplicar ${f.archivo.name}`}
                    />
                  ) : (
                    <span
                      className={`mt-0.5 w-4 shrink-0 text-center ${
                        f.resultado ? (f.resultado.ok ? "text-emerald-700" : "text-danger") : "text-ink-soft"
                      }`}
                      aria-hidden="true"
                    >
                      {f.resultado ? (f.resultado.ok ? "✓" : "✗") : "·"}
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate font-mono-tag text-xs" title={f.archivo.name}>
                        {f.archivo.name}
                      </span>
                      {f.n_oc && <span className="text-xs text-ink-soft">OC {f.n_oc}</span>}
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                          (f.tipo === "nueva" && f.eleccionOc === "nueva") || (f.tipo === "cotizacion" && f.crearNueva && !f.ticketId)
                            ? "bg-emerald-50 text-emerald-800"
                            : f.tipo === "actualizar" || (f.tipo === "nueva" && f.eleccionOc !== "nueva")
                              ? "bg-amber-50 text-amber-800"
                              : f.tipo === "cotizacion" || f.tipo === "repetida" || f.tipo === "informe"
                                ? "bg-concrete-dim text-ink"
                                : "bg-danger-soft text-danger"
                        }`}
                      >
                        {f.tipo === "nueva"
                          ? f.eleccionOc === "nueva"
                            ? "OC nueva · crea ticket"
                            : f.eleccionOc === null
                              ? "OC · elige a qué ticket va"
                              : "OC · se vincula a un ticket sin OC"
                          : f.tipo === "actualizar"
                            ? `Actualiza ticket #${f.destinoRef ?? f.destinoId}`
                            : f.tipo === "cotizacion"
                              ? f.crearNueva && !f.ticketId
                                ? "Cotización · crea ticket"
                                : "Cotización"
                              : f.tipo === "informe"
                                ? "Informe técnico · finaliza el ticket"
                                : f.tipo === "repetida"
                                ? "Ya registrada"
                                : "No se puede procesar"}
                      </span>
                    </div>

                    {f.tipo === "error" && <p className="mt-1 text-xs text-danger">{f.detalle}</p>}
                    {f.tipo === "repetida" && <p className="mt-1 text-xs text-ink-soft">{f.detalle}</p>}
                    {f.tipo === "nueva" && (f.opcionesOc?.length ?? 0) > 0 && (
                      <div className="mt-1 space-y-1 text-xs text-ink-soft">
                        {fase === "revision" ? (
                          <>
                            <p className={f.eleccionOc === null ? "text-amber-800" : ""}>
                              {f.eleccionOc === null
                                ? "Hay varios tickets sin OC de este proveedor por el mismo monto: elige a cuál va."
                                : "Hay tickets de este proveedor que aún esperan su OC (★ = mismo monto)."}
                            </p>
                            <select
                              className="w-full rounded-md border border-line-strong px-2 py-1.5 text-sm text-ink"
                              value={f.eleccionOc === null ? "" : String(f.eleccionOc)}
                              onChange={(e) =>
                                e.target.value !== "" &&
                                elegirDestinoOc(f.id, e.target.value === "nueva" ? "nueva" : Number(e.target.value))
                              }
                              aria-label={`Destino de ${f.archivo.name}`}
                            >
                              {f.eleccionOc === null && <option value="">Elige…</option>}
                              <option value="nueva">Crear un ticket nuevo con esta OC</option>
                              {f.opcionesOc!.map((o, i) => (
                                <option key={i} value={String(i)}>
                                  {o.coincideMonto ? "★ " : ""}Vincular a {o.etiqueta}
                                </option>
                              ))}
                            </select>
                          </>
                        ) : null}
                        {typeof f.eleccionOc === "number" && f.opcionesOc![f.eleccionOc] && (
                          <ul className="space-y-0.5">
                            <li>Pasa a "Por Ejecutar" y guarda el PDF como su OC.</li>
                            {f.opcionesOc![f.eleccionOc].cambios.map((c) => (
                              <li key={c} className="break-words">{c}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                    {f.tipo === "actualizar" &&
                      (f.cambios.length > 0 ? (
                        <ul className="mt-1 space-y-0.5 text-xs text-ink-soft">
                          {f.cambios.map((c) => (
                            <li key={c} className="break-words">{c}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-xs text-ink-soft">Sin cambios en los datos; solo reemplazaría el PDF.</p>
                      ))}
                    {f.tipo === "informe" && f.datosInf && (
                      <div className="mt-1 space-y-1 text-xs text-ink-soft">
                        <p className="break-words">
                          {[f.datosInf.titulo, f.datosInf.fecha ? formatoFecha(f.datosInf.fecha) : null, f.datosInf.referencia]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {fase === "revision" && (f.datosInf.tickets.length > 1 || !f.ticketId) ? (
                          <select
                            className="w-full rounded-md border border-line-strong px-2 py-1.5 text-sm text-ink"
                            value={f.ticketId ? String(f.ticketId) : ""}
                            onChange={(e) => {
                              const id = Number(e.target.value) || null;
                              setFilas((prev) => prev.map((x) => (x.id === f.id ? { ...x, ticketId: id, incluir: !!id } : x)));
                            }}
                            aria-label={`Ticket de ${f.archivo.name}`}
                          >
                            <option value="">Elige el ticket…</option>
                            {f.datosInf.tickets.map((t) => (
                              <option key={t.id} value={String(t.id)}>
                                #{t.refer ?? t.id} · {t.estado || "sin estado"} · {(t.descripcion ?? "").slice(0, 50)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          (() => {
                            const t = f.datosInf!.tickets.find((x) => x.id === f.ticketId);
                            return t ? (
                              <p>
                                <span className="font-medium text-ink">Ticket #{t.refer ?? t.id}</span> · {t.estado || "sin estado"}
                                {t.estado !== "Finalizado" ? ' → se guarda como su informe y pasa a "Finalizado"' : " · se guarda como su informe"}
                              </p>
                            ) : null;
                          })()
                        )}
                      </div>
                    )}
                    {f.tipo === "cotizacion" && f.datosCot && (
                      <div className="mt-1 space-y-1 text-xs text-ink-soft">
                        <p className="break-words">
                          {[
                            f.datosCot.numero ? `N° ${f.datosCot.numero}` : null,
                            f.datosCot.proveedor,
                            f.datosCot.total !== null ? formatoSoles(f.datosCot.total) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {f.crearNueva && !f.ticketId ? (
                          <>
                            <p>
                              <span className="font-medium text-ink">Ticket nuevo:</span>{" "}
                              {f.datosCot.solicitud || "descripción tomada del nombre del archivo"} · estado &quot;enviado&quot;
                              {f.datosCot.total_calculado ? " · monto = subtotal + IGV" : ""}
                            </p>
                            {fase === "revision" && (
                              <button
                                type="button"
                                className="text-teal hover:underline"
                                onClick={() => crearConCotizacion(f.id, false)}
                              >
                                Mejor asignarla a un ticket existente
                              </button>
                            )}
                          </>
                        ) : f.ticketId && porId.get(f.ticketId) ? (
                          <>
                            <p>
                              <span className="font-medium text-ink">
                                Ticket {etiquetaTicket(porId.get(f.ticketId)!).split(" · ").slice(0, 2).join(" · ")}
                              </span>
                              {f.asignado === "nombre" ? " · asignado por el nombre del archivo" : " · elegido a mano"}
                              {fase === "revision" && (
                                <>
                                  {" · "}
                                  <button
                                    type="button"
                                    className="text-teal hover:underline"
                                    onClick={() => asignarTicket(f.id, null)}
                                  >
                                    Cambiar
                                  </button>
                                </>
                              )}
                            </p>
                            <p>
                              {(() => {
                                const c = porId.get(f.ticketId!)!;
                                const completa = completaCotizacion(f.datosCot!, c);
                                const reemplaza = !!c.documentos?.cotizacion?.url;
                                return (
                                  (completa.length > 0
                                    ? `Completará: ${completa.join(" · ")}.`
                                    : "No hay datos vacíos que completar; solo guarda el PDF.") +
                                  (reemplaza ? " Reemplaza la cotización actual del ticket." : "")
                                );
                              })()}
                            </p>
                          </>
                        ) : fase === "revision" ? (
                          <div>
                            <p className="mb-1 text-amber-800">
                              Elige a qué ticket va esta cotización.
                            </p>
                            <input
                              type="search"
                              list="tickets-para-cotizaciones"
                              placeholder="Buscar ticket por Ref, N° de ticket, proveedor o descripción…"
                              className="w-full rounded-md border border-line-strong px-2.5 py-1.5 text-sm text-ink"
                              aria-label={`Ticket de ${f.archivo.name}`}
                              onChange={(e) => {
                                const c = porLabel.get(e.target.value);
                                if (c) asignarTicket(f.id, c);
                              }}
                            />
                            <button
                              type="button"
                              className="mt-1 text-teal hover:underline"
                              onClick={() => crearConCotizacion(f.id, true)}
                            >
                              O crear un ticket nuevo con esta cotización
                            </button>
                          </div>
                        ) : null}
                      </div>
                    )}
                    {f.avisos.length > 0 && <p className="mt-1 text-xs text-ink-soft">{f.avisos.join(" · ")}</p>}
                    {f.resultado && (
                      <p className={`mt-1 text-xs ${f.resultado.ok ? "text-emerald-700" : "text-danger"}`}>
                        {f.resultado.texto}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex items-center justify-between gap-3 border-t border-line px-6 py-4">
              <span className="text-xs text-ink-soft">
                {fase === "aplicando"
                  ? `Procesando ${avance.hechos}/${avance.total}…`
                  : fase === "revision"
                    ? [
                        desdeCot > 0 && `${desdeCot} ticket${desdeCot === 1 ? "" : "s"} desde cotización`,
                        nuevas > 0 && `${nuevas} desde OC`,
                        vinculadas > 0 && `${vinculadas} OC por vincular`,
                        actualizar > 0 && `${actualizar} por actualizar`,
                        cotizaciones > 0 && `${cotizaciones} cotizaci${cotizaciones === 1 ? "ón" : "ones"} a su ticket`,
                        informes > 0 && `${informes} informe${informes === 1 ? "" : "s"} a su ticket`,
                        sinTicket > 0 && `${sinTicket} sin ticket`,
                        porElegir > 0 && `${porElegir} OC por elegir`,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Nada que aplicar"
                    : ""}
              </span>
              <div className="flex gap-3">
                {fase === "revision" && (
                  <>
                    <button
                      type="button"
                      onClick={cerrar}
                      className="border border-line-strong rounded-md px-5 py-2 text-sm font-medium hover:bg-concrete-dim transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={aProcesar === 0}
                      onClick={() => void aplicar()}
                      className="bg-amber border border-amber text-white rounded-md px-5 py-2 text-sm font-medium hover:bg-amber-hover hover:border-amber-hover transition-colors disabled:opacity-50"
                    >
                      Aplicar ({aProcesar})
                    </button>
                  </>
                )}
                {fase === "listo" && (
                  <button
                    type="button"
                    onClick={cerrar}
                    className="bg-amber border border-amber text-white rounded-md px-5 py-2 text-sm font-medium hover:bg-amber-hover hover:border-amber-hover transition-colors"
                  >
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
