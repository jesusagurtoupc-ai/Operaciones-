"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ESTADOS, TIPOS_TRAB, SUB_TIPOS_TRAB } from "@/lib/shared/opciones";
import type { Correctivo, CorrectivoInput, Documentos } from "@/lib/shared/types";
import { MAX_BYTES, MAX_MB } from "@/lib/shared/archivos";
import { subirArchivoTicket } from "@/lib/client/archivosGrandes";
import { toDateOnly } from "@/lib/shared/types";
import { useMe } from "@/lib/client/useMe";
import { prepararAutoguardado, autoGuardarTicket } from "@/lib/client/carpetaLocal";
import { extraerTextoPdf } from "@/lib/client/leerPdf";
import { parsearOrdenCompra, MONTO_DESDE_OC, fechaLegible } from "@/lib/shared/ordenCompra";
import { parsearCotizacion } from "@/lib/shared/cotizacion";
import { sugerirClasificacion } from "@/lib/shared/clasificacion";

const VACIO: CorrectivoInput = {
  refer: null,
  ticket: "",
  f_reg: "", // vacío: el servidor pone el día de creación
  descripcion: "",
  estado: "cotizar",
  proveedor: "",
  proveedor_ruc: "",
  monto: null,
  f_coti: "",
  f_oc: "",
  f_entrega: "",
  f_inicio: "",
  f_fin: "",
  cuenta: "",
  tipo_trab: "",
  sub_tipo_trab: "",
  n_oc: "",
};

export default function CorrectivoForm({
  initial,
  id,
  children,
}: {
  initial?: Correctivo;
  id?: number;
  /** Secciones que van debajo del formulario y arriba de los botones. */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const me = useMe();
  const soloLectura = me?.rol === "lectura";
  const [form, setForm] = useState<CorrectivoInput>(
    initial
      ? {
          refer: initial.refer,
          ticket: initial.ticket || "",
          f_reg: toDateOnly(initial.f_reg),
          descripcion: initial.descripcion,
          estado: initial.estado,
          proveedor: initial.proveedor || "",
          proveedor_ruc: initial.proveedor_ruc || "",
          monto: initial.monto,
          f_coti: toDateOnly(initial.f_coti),
          f_oc: toDateOnly(initial.f_oc),
          f_entrega: toDateOnly(initial.f_entrega),
          f_inicio: toDateOnly(initial.f_inicio),
          f_fin: toDateOnly(initial.f_fin),
          cuenta: initial.cuenta || "",
          tipo_trab: initial.tipo_trab || "",
          sub_tipo_trab: initial.sub_tipo_trab || "",
          n_oc: initial.n_oc || "",
        }
      : VACIO
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const inputPdf = useRef<HTMLInputElement>(null);
  const inputCotiPdf = useRef<HTMLInputElement>(null);
  const [leyendoOc, setLeyendoOc] = useState(false);
  const [avisoOc, setAvisoOc] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  // Tipo / Sub tipo que el sistema llenó por la descripción (no vienen en la OC ni en la cotización).
  // Se marcan "sugerido" hasta que la persona los confirme o los cambie.
  const [sugeridos, setSugeridos] = useState({ tipo_trab: false, sub_tipo_trab: false });

  // PDFs leídos con "Cargar OC / cotización desde PDF". Se adjuntan a la línea de Documentos
  // correspondiente cuando se pulsa Guardar (así, si se cancela, no queda ningún archivo suelto).
  const pendientes = useRef<Partial<Record<"oc" | "cotizacion", { archivo: File; numero: string }>>>({});

  /** Si esa OC ya está en otro ticket activo devuelve el aviso; si está libre (o no se pudo revisar), null. */
  async function avisoOcRepetida(oc: string): Promise<string | null> {
    const valor = oc.trim();
    if (!valor) return null;
    try {
      const res = await fetch(
        `/api/correctivos/oc?n_oc=${encodeURIComponent(valor)}${id ? `&excluir=${id}` : ""}`
      );
      if (!res.ok) return null; // el servidor vuelve a revisarlo al guardar
      const dup = (await res.json()).data as { id: number; refer: number | null } | null;
      return dup ? `La OC ${valor} ya está registrada en el ticket #${dup.refer ?? dup.id}.` : null;
    } catch {
      return null;
    }
  }

  /** Anota el PDF para adjuntarlo al guardar. Devuelve una nota para el aviso (vacía si todo bien). */
  function recordarPdf(clave: "oc" | "cotizacion", archivo: File, numero: string): string {
    const linea = clave === "oc" ? "OC" : "Cotización";
    if (me?.rol !== "admin") {
      delete pendientes.current[clave];
      return ` El PDF no se guardará: solo un administrador puede adjuntar documentos.`;
    }
    if (archivo.size > MAX_BYTES) {
      delete pendientes.current[clave];
      return ` El PDF pesa más de ${MAX_MB} MB, así que no se podrá adjuntar a Documentos (${linea}); el archivo no se guardará.`;
    }
    pendientes.current[clave] = { archivo, numero };
    return ` El PDF se adjuntará a Documentos (${linea}) al guardar.`;
  }

  /** Sube los PDFs pendientes al ticket y los deja en su línea de Documentos. Lanza Error si algo falla. */
  async function adjuntarPendientes(cid: number) {
    const claves = Object.keys(pendientes.current) as ("oc" | "cotizacion")[];
    if (claves.length === 0) return;
    const base = `/api/correctivos/${cid}/archivos`;

    // El servidor reemplaza TODAS las líneas de documentos al guardar, así que se parte de las actuales.
    const actual = await fetch(`/api/correctivos/${cid}`);
    if (!actual.ok) throw new Error("No se pudieron leer los documentos del ticket");
    let docs: Documentos = (await actual.json()).data?.documentos ?? {};

    for (const clave of claves) {
      const pend = pendientes.current[clave];
      if (!pend) continue;
      // Sube el PDF (si es pesado, por trozos: lo resuelve esta función).
      const urlNueva = (await subirArchivoTicket(cid, pend.archivo)).url;

      const anterior = docs[clave]?.url ?? "";
      const estadoPrevio = docs[clave]?.estado;
      const nuevos: Documentos = {
        ...docs,
        [clave]: {
          numero: pend.numero,
          // Si el documento ya estaba Aprobado se respeta; en otro caso pasa a Listo.
          estado: estadoPrevio === "Aprobado" ? "Aprobado" : "Listo",
          url: urlNueva,
        },
      };
      const put = await fetch(`/api/correctivos/${cid}/documentos`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nuevos),
      });
      const putData = await put.json().catch(() => ({}));
      if (!put.ok) {
        await fetch(urlNueva, { method: "DELETE" }).catch(() => {});
        throw new Error(putData.error || "No se pudo guardar el documento");
      }
      docs = putData.data ?? nuevos;
      delete pendientes.current[clave];
      // Si la línea ya tenía un archivo propio, se quita para no dejar archivos sueltos.
      if (anterior && anterior !== urlNueva && anterior.startsWith(`${base}/`)) {
        await fetch(anterior, { method: "DELETE" }).catch(() => {});
      }
    }
  }

  function set<K extends keyof CorrectivoInput>(key: K, value: CorrectivoInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (key === "tipo_trab" || key === "sub_tipo_trab") {
      setSugeridos((s) => ({ ...s, [key]: false }));
    }
  }

  /**
   * Sugiere Tipo y Sub tipo según la descripción, pero solo para los campos que están vacíos
   * (nunca pisa lo que la persona ya eligió). Devuelve los valores a cargar y un texto para el aviso.
   */
  function sugerirVacios(descripcion: string | null | undefined): {
    nuevos: Partial<CorrectivoInput>;
    aviso: string;
  } {
    const sug = sugerirClasificacion(descripcion);
    const nuevos: Partial<CorrectivoInput> = {};
    const marcas = { tipo_trab: false, sub_tipo_trab: false };
    const partes: string[] = [];
    if (!form.tipo_trab && sug.tipo_trab) {
      nuevos.tipo_trab = sug.tipo_trab;
      marcas.tipo_trab = true;
      partes.push(`Tipo = ${sug.tipo_trab}`);
    }
    if (!form.sub_tipo_trab && sug.sub_tipo_trab) {
      nuevos.sub_tipo_trab = sug.sub_tipo_trab;
      marcas.sub_tipo_trab = true;
      partes.push(`Sub tipo = ${sug.sub_tipo_trab}`);
    }
    if (partes.length === 0) return { nuevos, aviso: "" };
    setSugeridos((s) => ({
      tipo_trab: s.tipo_trab || marcas.tipo_trab,
      sub_tipo_trab: s.sub_tipo_trab || marcas.sub_tipo_trab,
    }));
    return { nuevos, aviso: ` Sugerí ${partes.join(" y ")} según la descripción: verifícalo.` };
  }

  /** Si ya hay datos distintos en los campos que se van a llenar, pide confirmación antes de reemplazarlos. */
  function confirmarReemplazo(nuevos: Partial<CorrectivoInput>): boolean {
    const pisa = (Object.keys(nuevos) as (keyof CorrectivoInput)[]).filter((k) => {
      const actual = form[k];
      return actual !== null && actual !== "" && actual !== undefined && actual !== nuevos[k];
    });
    if (pisa.length === 0) return true;
    const nombres: Record<string, string> = {
      n_oc: "N° OC", f_oc: "F. OC", f_entrega: "F. Entrega", f_coti: "F. Cotización",
      proveedor: "Proveedor", proveedor_ruc: "RUC", monto: "Monto",
    };
    return confirm(`Se reemplazarán: ${pisa.map((k) => nombres[k] ?? k).join(", ")}. ¿Continuar?`);
  }

  /** Lee una cotización en PDF (en el navegador) y llena F. Cotización, proveedor y, si está en soles, el monto. */
  async function cargarCotizacionDesdePdf(archivo: File) {
    setAvisoOc(null);
    setLeyendoOc(true);
    try {
      const texto = await extraerTextoPdf(archivo);
      const r = parsearCotizacion(texto);
      if (!r.ok) {
        setAvisoOc({ tipo: "error", texto: r.error });
        return;
      }
      const d = r.datos;
      const nuevos: Partial<CorrectivoInput> = {
        ...(d.f_coti ? { f_coti: d.f_coti } : {}),
        ...(d.proveedor ? { proveedor: d.proveedor } : {}),
        ...(d.monto !== null ? { monto: d.monto } : {}),
      };
      if (!confirmarReemplazo(nuevos)) return;
      const sugCoti = sugerirVacios(form.descripcion.trim() ? form.descripcion : d.descripcion);
      const notaPdfCoti = recordarPdf("cotizacion", archivo, archivo.name.replace(/\.[^.]+$/, ""));
      setForm((f) => ({
        ...f,
        ...nuevos,
        ...sugCoti.nuevos,
        descripcion: f.descripcion.trim() ? f.descripcion : d.descripcion ?? f.descripcion,
      }));

      const simbolo = d.moneda === "USD" ? "US$" : "S/";
      const importe = (n: number) => `${simbolo} ${n.toLocaleString("es-PE", { minimumFractionDigits: 2 })}`;
      const elegido = MONTO_DESDE_OC === "total" ? d.total : d.subtotal;
      const partes = [
        d.proveedor,
        d.f_coti ? fechaLegible(d.f_coti) : null,
        elegido !== null
          ? `${importe(elegido)} (${MONTO_DESDE_OC === "total" ? "total con IGV" : "subtotal sin IGV"})${
              d.monto === null ? " — no se cargó el monto: no está en soles" : ""
            }`
          : null,
      ].filter(Boolean);
      const notas: string[] = [];
      if (d.vigencia_dias !== null) {
        notas.push(
          d.vigencia_hasta
            ? `Vigencia: ${d.vigencia_dias} días, hasta el ${fechaLegible(d.vigencia_hasta)}.`
            : `Vigencia: ${d.vigencia_dias} días.`
        );
        // Si la OC ya está cargada y es posterior al vencimiento de la cotización, se avisa.
        if (d.vigencia_hasta && form.f_oc && form.f_oc > d.vigencia_hasta) {
          notas.push(`La OC (${fechaLegible(form.f_oc)}) es posterior al vencimiento de la cotización.`);
        }
      }
      if (d.condicion_pago) notas.push(`Pago: ${d.condicion_pago}.`);
      setAvisoOc({
        tipo: "ok",
        texto: `Cotización cargada: ${partes.join(" · ")}. ${notas.join(" ")} Revisa los datos y pulsa Guardar.${sugCoti.aviso}${notaPdfCoti}${
          r.avisos.length ? " Ojo: " + r.avisos.join(" ") : ""
        }`,
      });
    } catch (err) {
      console.error(err);
      setAvisoOc({
        tipo: "error",
        texto: err instanceof Error && err.message.includes("pesa más de")
          ? err.message
          : "No se pudo leer el PDF. Llena los datos a mano.",
      });
    } finally {
      setLeyendoOc(false);
    }
  }

  /** Lee una OC en PDF (en el navegador) y llena N° OC, F. OC, proveedor y monto. No guarda nada. */
  async function cargarOcDesdePdf(archivo: File) {
    setAvisoOc(null);
    setLeyendoOc(true);
    try {
      const texto = await extraerTextoPdf(archivo);
      const r = parsearOrdenCompra(texto);
      if (!r.ok) {
        setAvisoOc({ tipo: "error", texto: r.error });
        return;
      }
      const d = r.datos;
      const repetida = await avisoOcRepetida(d.n_oc);
      if (repetida) {
        setAvisoOc({ tipo: "error", texto: `${repetida} No se cargó nada: una OC no puede repetirse.` });
        return;
      }
      const nuevos: Partial<CorrectivoInput> = {
        n_oc: d.n_oc,
        ...(d.f_oc ? { f_oc: d.f_oc } : {}),
        ...(d.proveedor ? { proveedor: d.proveedor } : {}),
        ...(d.proveedor_ruc ? { proveedor_ruc: d.proveedor_ruc } : {}),
        ...(d.f_entrega ? { f_entrega: d.f_entrega } : {}),
        ...(d.monto !== null ? { monto: d.monto } : {}),
      };
      if (!confirmarReemplazo(nuevos)) return;
      const sugOc = sugerirVacios(form.descripcion.trim() ? form.descripcion : d.descripcion);
      const notaPdfOc = recordarPdf("oc", archivo, d.n_oc);
      setForm((f) => ({
        ...f,
        ...nuevos,
        ...sugOc.nuevos,
        // La descripción de la OC solo se usa si el ticket todavía no tiene una.
        descripcion: f.descripcion.trim() ? f.descripcion : d.descripcion ?? f.descripcion,
      }));
      const partes = [
        d.n_oc,
        d.proveedor,
        d.proveedor_ruc ? `RUC ${d.proveedor_ruc}` : null,
        d.monto !== null
          ? `S/ ${d.monto.toLocaleString("es-PE", { minimumFractionDigits: 2 })} (${
              MONTO_DESDE_OC === "total" ? "total con IGV" : "subtotal sin IGV"
            })`
          : null,
      ].filter(Boolean);
      setAvisoOc({
        tipo: "ok",
        texto: `OC cargada: ${partes.join(" · ")}. Revisa los datos y pulsa Guardar.${sugOc.aviso}${notaPdfOc}${
          r.avisos.length ? " Ojo: " + r.avisos.join(" ") : ""
        }`,
      });
    } catch (err) {
      console.error(err);
      setAvisoOc({
        tipo: "error",
        texto: err instanceof Error && err.message.includes("pesa más de")
          ? err.message
          : "No se pudo leer el PDF. Llena los datos a mano.",
      });
    } finally {
      setLeyendoOc(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.descripcion.trim()) {
      setError("La descripción es obligatoria");
      return;
    }
    setSaving(true);
    // Si el navegador había quitado el permiso de la carpeta local, este
    // es el momento (clic del usuario) para volver a pedirlo.
    await prepararAutoguardado();
    const url = id ? `/api/correctivos/${id}` : "/api/correctivos";
    const method = id ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo guardar el registro");
      setSaving(false);
      return;
    }
    const guardado = await res.json().catch(() => null);
    const idGuardado: number | undefined = id ?? guardado?.data?.id;
    if (idGuardado) {
      try {
        await adjuntarPendientes(idGuardado);
      } catch (err) {
        // El ticket ya quedó guardado; solo falló el adjunto. Se avisa y se abre el ticket para reintentar.
        alert(
          `El ticket se guardó, pero no se pudo adjuntar el PDF: ${
            err instanceof Error ? err.message : "error desconocido"
          }. Puedes subirlo en la sección Documentos.`
        );
        router.push(`/correctivos/${idGuardado}`);
        router.refresh();
        return;
      }
      await autoGuardarTicket(idGuardado);
    }
    router.push("/correctivos");
    router.refresh();
  }

  const inputCls =
    "w-full border border-line rounded-md px-3 py-2 bg-white text-sm focus:outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-200/70";
  const labelCls = "block text-xs font-medium text-ink-soft mb-1";
  const tagSugerido = "font-semibold text-amber";

  return (
    <>
    <form
      id="correctivo-form"
      onSubmit={handleSubmit}
      className="bg-white border border-line rounded-lg shadow-card p-6"
    >
      <fieldset disabled={soloLectura} className="space-y-6 min-w-0 border-0 p-0 m-0">
      {soloLectura && (
        <p className="text-sm bg-concrete-dim border border-line rounded-md px-3 py-2">
          Tu usuario es de solo lectura: puedes ver este ticket, pero no modificarlo.
        </p>
      )}
      {error && (
        <p className="text-sm text-danger bg-[var(--danger-soft)] border border-danger/30 px-3 py-2">
          {error}
        </p>
      )}

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-soft mb-3 border-b border-line pb-2">
          Datos del ticket
        </h3>
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>N° Refer.</label>
            <input
              type="number"
              className={inputCls}
              value={form.refer ?? ""}
              placeholder={id ? undefined : "Automático (siguiente de la lista)"}
              onChange={(e) => set("refer", e.target.value ? Number(e.target.value) : null)}
            />
          </div>
          <div>
            <label className={labelCls}>Ticket</label>
            <input
              className={inputCls}
              value={form.ticket ?? ""}
              onChange={(e) => set("ticket", e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Fecha de registro</label>
            <input
              type="date"
              className={inputCls}
              value={form.f_reg ?? ""}
              title={id ? undefined : "Si lo dejas vacío se usa el día de creación"}
              onChange={(e) => set("f_reg", e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4">
          <label className={labelCls}>Descripción *</label>
          <textarea
            required
            rows={2}
            className={inputCls}
            value={form.descripcion}
            onChange={(e) => set("descripcion", e.target.value)}
          />
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-soft mb-3 border-b border-line pb-2">
          Clasificación
        </h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Tipo de trabajo{sugeridos.tipo_trab && <span className={tagSugerido} title="Llenado según la descripción: confírmalo o cámbialo"> · sugerido</span>}</label>
            <select className={inputCls} value={form.tipo_trab ?? ""} onChange={(e) => set("tipo_trab", e.target.value)}>
              <option value="">—</option>
              {TIPOS_TRAB.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Sub tipo de trabajo{sugeridos.sub_tipo_trab && <span className={tagSugerido} title="Llenado según la descripción: confírmalo o cámbialo"> · sugerido</span>}</label>
            <select className={inputCls} value={form.sub_tipo_trab ?? ""} onChange={(e) => set("sub_tipo_trab", e.target.value)}>
              <option value="">—</option>
              {SUB_TIPOS_TRAB.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 border-b border-line pb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
            Estado y proveedor
          </h3>
          <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputPdf}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const archivo = e.target.files?.[0];
              e.target.value = ""; // permite volver a elegir el mismo archivo
              if (archivo) cargarOcDesdePdf(archivo);
            }}
          />
          <button
            type="button"
            disabled={leyendoOc}
            onClick={() => inputPdf.current?.click()}
            title="Lee el PDF de la orden de compra y llena N° OC, F. OC, proveedor y monto"
            className="border border-line-strong rounded-md px-3 py-1.5 text-xs font-medium hover:bg-concrete-dim transition-colors disabled:opacity-50"
          >
            {leyendoOc ? "Leyendo PDF..." : "Cargar OC desde PDF"}
          </button>
          <input
            ref={inputCotiPdf}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const archivo = e.target.files?.[0];
              e.target.value = "";
              if (archivo) cargarCotizacionDesdePdf(archivo);
            }}
          />
          <button
            type="button"
            disabled={leyendoOc}
            onClick={() => inputCotiPdf.current?.click()}
            title="Lee el PDF de la cotización y llena F. Cotización, proveedor y descripción (el monto solo si está en soles)"
            className="border border-line-strong rounded-md px-3 py-1.5 text-xs font-medium hover:bg-concrete-dim transition-colors disabled:opacity-50"
          >
            Cargar cotización desde PDF
          </button>
          </div>
        </div>
        {avisoOc && (
          <p
            className={`mb-3 text-sm rounded-md px-3 py-2 border ${
              avisoOc.tipo === "ok"
                ? "bg-concrete-dim border-line"
                : "text-danger bg-[var(--danger-soft)] border-danger/30"
            }`}
          >
            {avisoOc.texto}
          </p>
        )}
        <div className="grid md:grid-cols-5 gap-4">
          <div>
            <label className={labelCls}>Estado</label>
            <select className={inputCls} value={form.estado} onChange={(e) => set("estado", e.target.value)}>
              {ESTADOS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Proveedor</label>
            <input className={inputCls} value={form.proveedor ?? ""} onChange={(e) => set("proveedor", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>RUC proveedor</label>
            <input
              className={inputCls}
              inputMode="numeric"
              maxLength={11}
              placeholder="11 dígitos"
              value={form.proveedor_ruc ?? ""}
              onChange={(e) => set("proveedor_ruc", e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Monto (S/)</label>
            <input
              type="number"
              step="0.01"
              className={inputCls}
              value={form.monto ?? ""}
              onChange={(e) => set("monto", e.target.value ? Number(e.target.value) : null)}
            />
          </div>
          <div>
            <label className={labelCls}>N° OC</label>
            <input
              className={inputCls}
              value={form.n_oc ?? ""}
              onChange={(e) => set("n_oc", e.target.value)}
              onBlur={async (e) => {
                const repetida = await avisoOcRepetida(e.target.value);
                if (repetida) setAvisoOc({ tipo: "error", texto: `${repetida} No podrás guardar el ticket con esa OC.` });
              }}
            />
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-soft mb-3 border-b border-line pb-2">
          Fechas del proceso
        </h3>
        <div className="grid md:grid-cols-5 gap-4">
          <div>
            <label className={labelCls}>F. Cotización</label>
            <input type="date" className={inputCls} value={form.f_coti ?? ""} onChange={(e) => set("f_coti", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>F. OC</label>
            <input type="date" className={inputCls} value={form.f_oc ?? ""} onChange={(e) => set("f_oc", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>F. Entrega (OC)</label>
            <input type="date" className={inputCls} value={form.f_entrega ?? ""} onChange={(e) => set("f_entrega", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>F. Inicio</label>
            <input type="date" className={inputCls} value={form.f_inicio ?? ""} onChange={(e) => set("f_inicio", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>F. Fin</label>
            <input type="date" className={inputCls} value={form.f_fin ?? ""} onChange={(e) => set("f_fin", e.target.value)} />
          </div>
        </div>
      </div>

      </fieldset>
    </form>

    {children}

    <div className="no-print sticky bottom-0 z-10 mt-6 flex gap-3 border-t border-line bg-white/95 backdrop-blur px-4 py-3 rounded-b-lg">
      {!soloLectura && (
        <button
          type="submit"
          form="correctivo-form"
          disabled={saving}
          className="bg-amber border border-amber text-white rounded-md px-6 py-2.5 text-sm font-medium hover:bg-amber-hover hover:border-amber-hover transition-colors disabled:opacity-50"
        >
          {saving ? "Guardando..." : id ? "Guardar cambios" : "Crear ticket"}
        </button>
      )}
      <button
        type="button"
        onClick={() => router.push("/correctivos")}
        className="border border-line-strong rounded-md px-6 py-2.5 text-sm font-medium hover:bg-concrete-dim transition-colors"
      >
        {soloLectura ? "Volver" : "Cancelar"}
      </button>
    </div>
    </>
  );
}
