"use client";

import { useRef, useState } from "react";
import type { Correctivo, DatosOC, DatosCotizacion } from "@/lib/shared";
import { formatoFecha, formatoSoles, toDateOnly } from "@/lib/shared";
import { leerOrdenCompra, prepararAutoguardado, autoGuardarTicket } from "@/lib/client";

/* ───────── Qué datos de un ticket existente puede actualizar una OC ───────── */
type CampoAct = "f_oc" | "proveedor" | "ruc_proveedor" | "monto" | "contrato" | "f_entrega" | "descripcion";
const CAMPOS_ACT: { k: CampoAct; etiqueta: string }[] = [
  { k: "f_oc", etiqueta: "F. OC" },
  { k: "proveedor", etiqueta: "Proveedor" },
  { k: "ruc_proveedor", etiqueta: "RUC" },
  { k: "monto", etiqueta: "Monto" },
  { k: "contrato", etiqueta: "Contrato" },
  { k: "f_entrega", etiqueta: "F. entrega" },
  { k: "descripcion", etiqueta: "Descripción" },
];

type Fila = {
  id: number;
  archivo: File;
  tipo: "nueva" | "actualizar" | "cotizacion" | "error";
  n_oc: string | null;
  /** Cotización: lo que se leyó del PDF y el ticket al que va (null = falta elegirlo a mano). */
  datosCot?: DatosCotizacion;
  ticketId?: number | null;
  asignado?: "nombre" | "manual";
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
const PISTA_COTIZACION = /cotiz|propuesta|presupuesto|proforma|^cot[-_ ]?\d|^coti[-_ 0-9]/i;
const vacio = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function leerComoCotizacion(f: File): Promise<DatosCotizacion> {
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

/** Trae todos los tickets activos (de 200 en 200) para buscar a cuál pertenece cada cotización. */
async function traerTickets(): Promise<Correctivo[]> {
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
async function guardarCotizacionEnTicket(id: number, archivo: File): Promise<{ ok: boolean; texto: string }> {
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
      cotizacion: { numero: archivo.name.replace(/\.[^.]+$/, ""), estado: "Listo", url: urlNueva },
    }),
  });
  if (!put.ok) {
    const pd = await put.json().catch(() => ({}));
    await fetch(urlNueva, { method: "DELETE" }).catch(() => {});
    throw new Error(pd.error || "No se pudo guardar el documento");
  }
  // Si el ticket ya tenía una cotización propia, se quita para no dejar archivos sueltos.
  const anterior = docs.cotizacion?.url ?? "";
  if (anterior && anterior !== urlNueva && anterior.startsWith(`${base}/`)) {
    await fetch(anterior, { method: "DELETE" }).catch(() => {});
  }

  const ref = c.refer ?? id;
  const ra = await fetch(`/api/correctivos/${id}/aplicar-cotizacion`, { method: "POST" });
  const ja = await ra.json().catch(() => ({}));
  if (!ra.ok) {
    return { ok: true, texto: `Ticket #${ref}: cotización guardada, pero no se pudo leer (${ja.error || "error"})` };
  }
  return { ok: true, texto: `Ticket #${ref}: ${ja.data?.resumen ?? "cotización guardada"}` };
}

/**
 * Botón "+ OC" de la lista. Al presionarlo se eligen uno o varios PDF de órdenes de compra:
 *  - OC que aún no está registrada → se crea un ticket (monto con IGV).
 *  - OC que ya está en un ticket → se actualiza ese ticket con los datos del PDF y se reemplaza su PDF.
 *  - Cotización (PDF que no es una OC) → se guarda en el ticket y completa sus datos vacíos. El ticket se
 *    busca por el nombre del archivo (N° de ticket o Ref); si no coincide, se elige a mano en la revisión.
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
        const pruebaCot = async () => {
          try {
            cot = await leerComoCotizacion(archivo);
          } catch {
            /* no es una cotización */
          }
        };
        if (PISTA_COTIZACION.test(archivo.name)) {
          await pruebaCot();
          if (!cot) await pruebaOc();
        } else {
          await pruebaOc();
          if (!oc && /\.pdf$/i.test(archivo.name)) await pruebaCot();
        }

        if (cot) {
          const d: DatosCotizacion = cot;
          const todos = await conTickets();
          const c = emparejarPorNombre(archivo.name, todos);
          base.tipo = "cotizacion";
          base.datosCot = d;
          base.ticketId = c ? c.id : null;
          base.asignado = c ? "nombre" : undefined;
          base.incluir = !!c;
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
            base.tipo = "nueva";
            base.incluir = true;
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
              ? `No se reconoció como OC ni como cotización (${errOc})`
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
    for (const f of elegidas) {
      try {
        if (f.tipo === "cotizacion") {
          if (!f.ticketId) throw new Error("Falta elegir el ticket");
          resultados.set(f.id, await guardarCotizacionEnTicket(f.ticketId, f.archivo));
          void autoGuardarTicket(f.ticketId);
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
          ? { ...x, ticketId: c ? c.id : null, asignado: c ? "manual" : undefined, incluir: !!c }
          : x
      )
    );
  }

  function cerrar() {
    setFase("cerrado");
    setFilas([]);
  }

  const nuevas = filas.filter((f) => f.tipo === "nueva" && f.incluir).length;
  const actualizar = filas.filter((f) => f.tipo === "actualizar" && f.incluir).length;
  const cotizaciones = filas.filter((f) => f.tipo === "cotizacion" && f.incluir).length;
  const aProcesar = nuevas + actualizar + cotizaciones;
  const porLabel = new Map(tickets.map((c) => [etiquetaTicket(c), c]));
  const porId = new Map(tickets.map((c) => [c.id, c]));
  const sinTicket = filas.filter((f) => f.tipo === "cotizacion" && !f.ticketId).length;
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
        title="Elige uno o varios PDF: OC (crea tickets nuevos o actualiza los de OC ya registradas) y cotizaciones (se guardan en su ticket)"
        aria-label="Cargar órdenes de compra y cotizaciones"
        className="bg-amber text-white border border-amber rounded-md px-4 py-2 text-sm font-medium hover:bg-amber-hover hover:border-amber-hover transition-colors disabled:opacity-50"
      >
        {fase === "leyendo" ? `Leyendo ${avance.hechos}/${avance.total}…` : "+ OC"}
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
              <h2 className="font-display font-700 text-xl tracking-tight">
                {fase === "listo" ? "Resultado de la carga" : "Archivos seleccionados"}
              </h2>
              <p className="mt-1 text-xs text-ink-soft">
                {fase === "listo"
                  ? `${hechosOk} procesada${hechosOk === 1 ? "" : "s"} correctamente${hechosMal > 0 ? ` · ${hechosMal} con error` : ""}.`
                  : "Las OC nuevas crean un ticket; las ya registradas actualizan su ticket y reemplazan su PDF; las cotizaciones se guardan en su ticket y completan sus datos vacíos. Desmarca lo que no quieras aplicar."}
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
                      disabled={f.tipo === "error" || (f.tipo === "cotizacion" && !f.ticketId)}
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
                          f.tipo === "nueva"
                            ? "bg-emerald-50 text-emerald-800"
                            : f.tipo === "actualizar"
                              ? "bg-amber-50 text-amber-800"
                              : f.tipo === "cotizacion"
                                ? "bg-concrete-dim text-ink"
                                : "bg-danger-soft text-danger"
                        }`}
                      >
                        {f.tipo === "nueva"
                          ? "Nueva · crea ticket"
                          : f.tipo === "actualizar"
                            ? `Actualiza ticket #${f.destinoRef ?? f.destinoId}`
                            : f.tipo === "cotizacion"
                              ? "Cotización"
                              : "No se puede procesar"}
                      </span>
                    </div>

                    {f.tipo === "error" && <p className="mt-1 text-xs text-danger">{f.detalle}</p>}
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
                        {f.ticketId && porId.get(f.ticketId) ? (
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
                              No se encontró el ticket por el nombre del archivo: elige a cuál va.
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
                    ? `${nuevas} nueva${nuevas === 1 ? "" : "s"} · ${actualizar} por actualizar · ${cotizaciones} cotizaci${cotizaciones === 1 ? "ón" : "ones"}${sinTicket > 0 ? ` · ${sinTicket} sin ticket` : ""}`
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
