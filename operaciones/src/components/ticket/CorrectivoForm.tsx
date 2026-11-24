"use client";

import { rutaUltimaLista } from "@/components/lista/filtrosLista";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ESTADOS, TIPOS_TRAB, SUB_TIPOS_TRAB, AREAS, LUGARES, formatoSoles } from "@/lib/shared";
import type { Correctivo, CorrectivoInput, DatosOC } from "@/lib/shared";
import { toDateOnly, slaCotiOc, solesDeDolares, TC_MIN, TC_MAX, tieneInforme } from "@/lib/shared";
import { useMe } from "@/lib/client";
import { autoGuardarTicket, EVENTO_ESTADO_AUTO, EVENTO_CAMPOS_AUTO, EVENTO_OC_LEIDA, EVENTO_TICKET_SINCRONIZADO } from "@/lib/client";
import { pendienteDe, guardarPendiente, quitarPendiente, enviarTicket } from "@/lib/client";
import type { EstadoAuto, CamposAuto } from "@/lib/client";

export default function CorrectivoForm({
  initial,
  id,
  tcReferencia = null,
  children,
}: {
  initial: Correctivo;
  id: number;
  /** Último tipo de cambio usado: se propone al pasar el ticket a dólares. */
  tcReferencia?: number | null;
  /** Secciones que van debajo del formulario y arriba de los botones. */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const me = useMe();
  const soloLectura = me?.rol === "lectura";
  // Mientras se averigua quién es el usuario, el formulario queda bloqueado (antes aparecía editable
  // un instante también para los de solo lectura).
  const puedeEditar = me?.rol === "admin";
  const [form, setForm] = useState<CorrectivoInput>(() => ({
    refer: initial.refer,
    ticket: initial.ticket || "",
    f_reg: toDateOnly(initial.f_reg),
    descripcion: initial.descripcion,
    lugar: initial.lugar || "",
    estado: initial.estado,
    proveedor: initial.proveedor || "",
    monto: initial.monto,
    moneda: initial.moneda === "USD" ? "USD" : "PEN",
    monto_usd: initial.monto_usd ?? null,
    tipo_cambio: initial.tipo_cambio ?? null,
    f_coti: toDateOnly(initial.f_coti),
    f_oc: toDateOnly(initial.f_oc),
    f_inicio: toDateOnly(initial.f_inicio),
    f_fin: toDateOnly(initial.f_fin),
    cuenta: initial.cuenta || "",
    tipo_trab: initial.tipo_trab || "",
    sub_tipo_trab: initial.sub_tipo_trab || "",
    n_oc: initial.n_oc || "",
    area: initial.area || "",
    ruc_proveedor: initial.ruc_proveedor || "",
    f_entrega: toDateOnly(initial.f_entrega),
    contrato: initial.contrato || "",
  }));
  // Cómo estaba el ticket al abrirlo (más lo que el servidor cambió solo después). Se envía al guardar
  // para que el servidor guarde solo lo que esta persona cambió y detecte choques con otra persona.
  const [base, setBase] = useState<CorrectivoInput>(form);
  // Regla del informe: sin informe no se puede elegir «Finalizado» (se actualiza al cargar o quitar el informe).
  const [informeOk, setInformeOk] = useState(() => tieneInforme(initial));
  const hayCambios = JSON.stringify(form) !== JSON.stringify(base);
  const [error, setError] = useState("");
  /** Estado del guardado automático, solo para la línea discreta junto a "Volver". */
  const [estadoGuardado, setEstadoGuardado] = useState<"" | "guardando" | "guardado" | "pendiente">("");
  const formRef = useRef(form);
  const baseRef = useRef(base);
  formRef.current = form;
  baseRef.current = base;
  const enviando = useRef<Promise<void> | null>(null);

  // Cambios que quedaron en este equipo sin llegar al servidor (sin internet o al cerrar la app):
  // se muestran de nuevo y se envían solos.
  useEffect(() => {
    const p = pendienteDe(id);
    if (!p) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setForm((f) => ({ ...f, ...(p.form as Partial<CorrectivoInput>) }));
    setBase((b) => ({ ...b, ...(p.base as Partial<CorrectivoInput>) }));
    if (p.error) setError(p.error);
    /* eslint-enable react-hooks/set-state-in-effect */
    const alSincronizar = (e: Event) => {
      const d = (e as CustomEvent<{ id: number; form: CorrectivoInput }>).detail;
      if (d.id === id) setBase(d.form);
    };
    window.addEventListener(EVENTO_TICKET_SINCRONIZADO, alSincronizar);
    return () => window.removeEventListener(EVENTO_TICKET_SINCRONIZADO, alSincronizar);
  }, [id]);

  // Cuando el servidor cambia el estado solo (al cargar la OC o el informe), el formulario lo refleja
  // para que un "Guardar" posterior no lo devuelva al valor anterior.
  useEffect(() => {
    const alCambiar = (e: Event) => {
      const { estado, f_fin, informe } = (e as CustomEvent<EstadoAuto>).detail;
      if (typeof informe === "boolean") setInformeOk(informe);
      setForm((f) => ({ ...f, estado, f_fin: f_fin || f.f_fin }));
      setBase((b) => ({ ...b, estado, f_fin: f_fin || b.f_fin }));
    };
    // Datos que el servidor completó (cotización leída): solo entran en campos que siguen vacíos aquí.
    const alCompletar = (e: Event) => {
      const c = (e as CustomEvent<CamposAuto>).detail;
      // Cotización en dólares: la moneda cambia aunque el formulario ya diga "S/" (el monto estaba vacío).
      const dolares = c.moneda === "USD" ? { moneda: "USD", monto_usd: c.monto_usd ?? null, tipo_cambio: c.tipo_cambio ?? null } : null;
      setForm((f) => {
        const sig = { ...f };
        for (const k of Object.keys(c) as (keyof CamposAuto)[]) {
          const actual = f[k];
          if (actual === null || actual === undefined || actual === "") (sig as Record<string, unknown>)[k] = c[k];
        }
        return dolares ? { ...sig, ...dolares } : sig;
      });
      // El servidor ya los guardó: no cuentan como cambios pendientes de esta persona.
      setBase((b) => {
        const sig = { ...b };
        for (const k of Object.keys(c) as (keyof CamposAuto)[]) {
          const actual = b[k];
          if (actual === null || actual === undefined || actual === "") (sig as Record<string, unknown>)[k] = c[k];
        }
        return dolares ? { ...sig, ...dolares } : sig;
      });
    };
    // OC leída en "Documentos": completa los datos VACÍOS del ticket (nunca pisa lo escrito) y se guardan
    // solos. En dólares: moneda US$, monto en dólares y tipo de cambio (el de la OC o el último usado).
    const alLeerOc = (e: Event) => {
      const d = (e as CustomEvent<DatosOC>).detail;
      const vacio = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
      setForm((f) => {
        const sig = { ...f };
        if (vacio(f.n_oc) && d.n_oc && d.otros_tickets.length === 0) sig.n_oc = d.n_oc;
        if (vacio(f.proveedor) && d.proveedor) sig.proveedor = d.proveedor;
        if (vacio(f.ruc_proveedor) && d.ruc_proveedor) sig.ruc_proveedor = d.ruc_proveedor;
        if (vacio(f.contrato) && d.contrato) sig.contrato = d.contrato;
        if (!d.fecha_ambigua && vacio(f.f_oc) && d.f_oc) sig.f_oc = d.f_oc;
        if (!d.fecha_ambigua && vacio(f.f_entrega) && d.f_entrega) sig.f_entrega = d.f_entrega;
        if (vacio(f.monto) && vacio(f.monto_usd) && d.total !== null) {
          if (d.moneda === "USD") {
            const tc = d.tipo_cambio ?? f.tipo_cambio ?? tcReferencia ?? null;
            Object.assign(sig, { moneda: "USD", monto_usd: d.total, tipo_cambio: tc, monto: solesDeDolares(d.total, tc) });
          } else if (!d.moneda || d.moneda === "PEN") sig.monto = d.total;
        }
        return sig;
      });
    };
    window.addEventListener(EVENTO_ESTADO_AUTO, alCambiar);
    window.addEventListener(EVENTO_CAMPOS_AUTO, alCompletar);
    window.addEventListener(EVENTO_OC_LEIDA, alLeerOc);
    return () => {
      window.removeEventListener(EVENTO_ESTADO_AUTO, alCambiar);
      window.removeEventListener(EVENTO_CAMPOS_AUTO, alCompletar);
      window.removeEventListener(EVENTO_OC_LEIDA, alLeerOc);
    };
  }, []);

  /**
   * Guardado automático: cada cambio queda al instante en este equipo y, un momento después, se envía
   * al servidor (solo los campos cambiados). Sin internet queda en cola y se envía solo al volver la
   * conexión. No hay botón "Guardar" ni ventanas de confirmación.
   */
  async function guardarAhora() {
    if (enviando.current) await enviando.current;
    const enviado = formRef.current;
    const antes = baseRef.current;
    if (JSON.stringify(enviado) === JSON.stringify(antes)) return;
    if (!enviado.descripcion.trim()) {
      setError("La descripción es obligatoria: el ticket se guardará cuando la completes.");
      return;
    }
    const tarea = (async () => {
      setEstadoGuardado("guardando");
      const r = await enviarTicket(id, enviado as unknown as Record<string, unknown>, antes as unknown as Record<string, unknown>);
      if (r === "ok") {
        setError("");
        setBase(enviado);
        baseRef.current = enviado;
        quitarPendiente(id); // lo enviado ya está en el servidor; lo que se cambió después parte de ahí
        if (JSON.stringify(formRef.current) !== JSON.stringify(enviado)) guardarPendiente(id, formRef.current as unknown as Record<string, unknown>, enviado as unknown as Record<string, unknown>);
        setEstadoGuardado("guardado");
        // Copia en la carpeta del equipo (si se eligió una), en segundo plano.
        void autoGuardarTicket(id);
      } else if (r === "sinRed") {
        setEstadoGuardado("pendiente"); // queda en la cola de este equipo
      } else {
        setError(r.error);
        guardarPendiente(id, enviado as unknown as Record<string, unknown>, antes as unknown as Record<string, unknown>, r.error);
        setEstadoGuardado("");
      }
    })();
    enviando.current = tarea;
    await tarea;
    enviando.current = null;
  }

  // Cada cambio: copia inmediata en el equipo y envío al servidor tras una pausa breve al escribir.
  useEffect(() => {
    if (!puedeEditar || !hayCambios) return;
    guardarPendiente(id, form as unknown as Record<string, unknown>, base as unknown as Record<string, unknown>);
    const t = setTimeout(() => void guardarAhora(), 2500); // una sola petición por pausa al escribir
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, base, puedeEditar, hayCambios, id]);

  // Al cerrar la app o cambiar de pestaña con algo sin enviar: se intenta enviar igual (y si no se
  // puede, ya está en la cola del equipo).
  useEffect(() => {
    if (!puedeEditar) return;
    const alSalir = (e: Event) => {
      if (e.type === "visibilitychange" && document.visibilityState !== "hidden") return;
      if (JSON.stringify(formRef.current) === JSON.stringify(baseRef.current)) return;
      void enviarTicket(id, formRef.current as unknown as Record<string, unknown>, baseRef.current as unknown as Record<string, unknown>, true);
    };
    document.addEventListener("visibilitychange", alSalir);
    window.addEventListener("pagehide", alSalir);
    return () => {
      document.removeEventListener("visibilitychange", alSalir);
      window.removeEventListener("pagehide", alSalir);
    };
  }, [puedeEditar, id]);

  // Proveedores que más hicieron este tipo de trabajo (primero en este lugar), con su precio y plazo
  // promedio: para comparar o completar el proveedor con un toque.
  type Sugerido = { proveedor: string; ruc: string | null; trabajos: number; en_lugar: number; monto_prom: number | null; dias_prom: number | null };
  const [sugeridos, setSugeridos] = useState<Sugerido[]>([]);
  useEffect(() => {
    if (!puedeEditar || (!form.tipo_trab && !form.sub_tipo_trab)) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ sugerir: "1", tipo: form.tipo_trab ?? "", sub: form.sub_tipo_trab ?? "", lugar: form.lugar ?? "", id: String(id) });
      fetch(`/api/proveedores?${qs}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((d) => setSugeridos(Array.isArray(d.data) ? d.data : []))
        .catch(() => undefined);
    }, 600);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [puedeEditar, form.tipo_trab, form.sub_tipo_trab, form.lugar, id]);
  const otrosSugeridos = sugeridos.filter((x) => x.proveedor !== form.proveedor);

  async function volver() {
    if (puedeEditar && hayCambios) await guardarAhora();
    router.push(rutaUltimaLista()); // vuelve a la lista con los filtros que tenía
  }

  function set<K extends keyof CorrectivoInput>(key: K, value: CorrectivoInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); // Enter en un campo: guarda ya, sin salir del ticket
    void guardarAhora();
  }

  const inputCls =
    "w-full border border-line rounded-md px-3 py-2 bg-white text-sm focus:outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-200/70";
  const labelCls = "block text-xs font-medium text-ink-soft mb-1";

  return (
    <>
    <form
      id="correctivo-form"
      onSubmit={handleSubmit}
      className="bg-white border border-line rounded-lg shadow-card p-6"
    >
      <fieldset disabled={!puedeEditar} className="space-y-6 min-w-0 border-0 p-0 m-0">
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
        <div className="grid md:grid-cols-4 gap-4">
          <div>
            <label className={labelCls}>Lugar</label>
            <select className={inputCls} value={form.lugar ?? ""} onChange={(e) => set("lugar", e.target.value)}>
              <option value="">—</option>
              {LUGARES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Área</label>
            <select className={inputCls} value={form.area ?? ""} onChange={(e) => set("area", e.target.value)}>
              <option value="">—</option>
              {AREAS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Tipo de trabajo</label>
            <select className={inputCls} value={form.tipo_trab ?? ""} onChange={(e) => set("tipo_trab", e.target.value)}>
              <option value="">—</option>
              {TIPOS_TRAB.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Sub tipo de trabajo</label>
            <select className={inputCls} value={form.sub_tipo_trab ?? ""} onChange={(e) => set("sub_tipo_trab", e.target.value)}>
              <option value="">—</option>
              {SUB_TIPOS_TRAB.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-soft mb-3 border-b border-line pb-2">
          Estado y proveedor
        </h3>
        <div className="grid md:grid-cols-4 gap-4">
          <div>
            <label className={labelCls}>Estado</label>
            <select className={inputCls} value={form.estado} onChange={(e) => set("estado", e.target.value)}>
              {ESTADOS.map((v) => (
                <option key={v} value={v} disabled={v === "Finalizado" && form.estado !== "Finalizado" && !informeOk}>
                  {v}{v === "Finalizado" && form.estado !== "Finalizado" && !informeOk ? " (falta el informe)" : ""}
                </option>
              ))}
            </select>
            {form.estado !== "Finalizado" && !informeOk && (
              <p className="mt-1 text-[11px] text-ink-soft">Se finaliza al cargar el informe.</p>
            )}
          </div>
          <div>
            <label className={labelCls}>Proveedor</label>
            <input className={inputCls} value={form.proveedor ?? ""} onChange={(e) => set("proveedor", e.target.value)} />
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className={labelCls}>Monto ({form.moneda === "USD" ? "US$" : "S/"})</label>
              {/* Moneda de la OC o cotización: en dólares, el monto en soles se calcula con el tipo de cambio. */}
              <select
                aria-label="Moneda"
                className="text-xs border border-line rounded px-1 py-0.5 bg-white mb-1"
                value={form.moneda === "USD" ? "USD" : "PEN"}
                onChange={(e) => {
                  const usd = e.target.value === "USD";
                  setForm((f) => {
                    if (usd) {
                      const tc = f.tipo_cambio ?? tcReferencia ?? null;
                      return { ...f, moneda: "USD", tipo_cambio: tc, monto: solesDeDolares(f.monto_usd ?? null, tc) };
                    }
                    return { ...f, moneda: "PEN", monto_usd: null, tipo_cambio: null };
                  });
                }}
              >
                <option value="PEN">S/ soles</option>
                <option value="USD">US$ dólares</option>
              </select>
            </div>
            {form.moneda === "USD" ? (
              <>
                <input
                  type="number"
                  step="0.01"
                  className={inputCls}
                  placeholder="US$"
                  value={form.monto_usd ?? ""}
                  onChange={(e) => {
                    const usd = e.target.value ? Number(e.target.value) : null;
                    setForm((f) => ({ ...f, monto_usd: usd, monto: solesDeDolares(usd, f.tipo_cambio ?? null) }));
                  }}
                />
                <div className="mt-1 flex items-center gap-1 text-[11px] text-ink-soft">
                  <span>T.C.</span>
                  <input
                    type="number"
                    step="0.001"
                    min={TC_MIN}
                    max={TC_MAX}
                    aria-label="Tipo de cambio (soles por dólar)"
                    className="w-20 border border-line rounded px-1 py-0.5 bg-white text-ink"
                    placeholder={tcReferencia ? String(tcReferencia) : "3.75"}
                    value={form.tipo_cambio ?? ""}
                    onChange={(e) => {
                      const tc = e.target.value ? Number(e.target.value) : null;
                      setForm((f) => ({ ...f, tipo_cambio: tc, monto: solesDeDolares(f.monto_usd ?? null, tc) }));
                    }}
                  />
                  <span className="truncate">= {form.monto !== null && form.monto !== undefined ? formatoSoles(form.monto) : "S/ —"}</span>
                </div>
              </>
            ) : (
              <input
                type="number"
                step="0.01"
                className={inputCls}
                value={form.monto ?? ""}
                onChange={(e) => set("monto", e.target.value ? Number(e.target.value) : null)}
              />
            )}
          </div>
          <div>
            <label className={labelCls}>N° OC</label>
            <input className={inputCls} value={form.n_oc ?? ""} onChange={(e) => set("n_oc", e.target.value)} />
          </div>
        </div>
        {puedeEditar && sugeridos.length > 0 && (form.tipo_trab || form.sub_tipo_trab) && (
          <div className="mt-2 text-xs text-ink-soft">
            <span className="mr-1">
              {form.proveedor ? "Otros que hicieron" : "Sugeridos para"} {form.sub_tipo_trab || form.tipo_trab}
              {form.lugar ? ` (primero en ${form.lugar})` : ""}:
            </span>
            {(form.proveedor ? otrosSugeridos : sugeridos).map((x) => (
              <button
                key={x.proveedor}
                type="button"
                onClick={() => setForm((f) => ({ ...f, proveedor: x.proveedor, ruc_proveedor: x.ruc ?? f.ruc_proveedor }))}
                className="inline-flex items-center gap-1 mr-1.5 mt-1 px-2 py-0.5 border border-line rounded-full bg-white hover:bg-slate-50 text-ink"
                title="Usar este proveedor en el ticket"
              >
                <b className="font-medium">{x.proveedor}</b>
                <span className="text-ink-soft">
                  · {x.trabajos} trabajo(s){x.en_lugar ? `, ${x.en_lugar} aquí` : ""}
                  {x.monto_prom ? ` · prom. ${formatoSoles(x.monto_prom, 0)}` : ""}
                  {x.dias_prom !== null ? ` · ${x.dias_prom} d` : ""}
                </span>
              </button>
            ))}
            {form.proveedor && otrosSugeridos.length === 0 && <span>es quien más lo ha hecho.</span>}
          </div>
        )}
        <div className="grid md:grid-cols-4 gap-4 mt-4">
          <div>
            <label className={labelCls}>RUC proveedor</label>
            <input className={inputCls} value={form.ruc_proveedor ?? ""} onChange={(e) => set("ruc_proveedor", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Contrato</label>
            <input className={inputCls} value={form.contrato ?? ""} onChange={(e) => set("contrato", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>F. Entrega</label>
            <input type="date" className={inputCls} value={form.f_entrega ?? ""} onChange={(e) => set("f_entrega", e.target.value)} />
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-soft mb-3 border-b border-line pb-2">
          Fechas del proceso
        </h3>
        <div className="grid md:grid-cols-4 gap-4">
          <div>
            <label className={labelCls}>F. Cotización</label>
            <input type="date" className={inputCls} value={form.f_coti ?? ""} onChange={(e) => set("f_coti", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>F. OC</label>
            <input type="date" className={inputCls} value={form.f_oc ?? ""} onChange={(e) => set("f_oc", e.target.value)} />
            <SlaOc f_coti={form.f_coti} f_oc={form.f_oc} n_oc={form.n_oc} estado={form.estado} />
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

    <div className="no-print sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] sm:bottom-0 z-10 mt-6 flex gap-3 border-t border-line bg-white sm:bg-white/95 sm:backdrop-blur px-4 py-3 rounded-b-lg">
      <button
        type="button"
        onClick={() => void volver()}
        className="border border-line-strong rounded-md px-6 py-2.5 text-sm font-medium hover:bg-concrete-dim transition-colors"
      >
        Volver
      </button>
      {puedeEditar && (
        <span className="self-center text-xs text-ink-soft" aria-live="polite">
          {estadoGuardado === "guardando" || (hayCambios && estadoGuardado !== "pendiente")
            ? "Guardando…"
            : estadoGuardado === "pendiente"
              ? "Guardado en el equipo · se envía solo al volver internet"
              : estadoGuardado === "guardado"
                ? "✓ Guardado"
                : "Los cambios se guardan solos"}
        </span>
      )}
    </div>
    </>
  );
}

/* ───────── Equipo del inventario al que corresponde el ticket ───────── */

type EquipoCorto = { codigo: string; nombre: string; ubicacion: string; pabellon?: string | null; piso?: string | null };
let listaEquipos: Promise<EquipoCorto[]> | null = null;
/** Lista corta de equipos (la guardada en la app o, si no hay, la del archivo consolidado). */
function cargarEquipos(campus: string | undefined): Promise<EquipoCorto[]> {
  listaEquipos ??= fetch("/api/inventario?equipos=1")
    .then(async (r) => {
      if (r.ok) return (await r.json()) as EquipoCorto[];
      // El archivo consolidado es el inventario del campus principal: otro campus sin inventario no tiene lista.
      if (campus && campus !== "principal") return [];
      const a = await fetch("/inventario-equipos.json");
      if (!a.ok) return [];
      const d = (await a.json()) as { equipos: EquipoCorto[] };
      return d.equipos.filter((e) => e.codigo);
    })
    .catch(() => []);
  return listaEquipos;
}
/** Código de equipo dentro de lo que leyó la cámara: la dirección del QR (…?equipo=X) o el código solo. */
function codigoDeQr(texto: string): string {
  try {
    const u = new URL(texto);
    return u.searchParams.get("equipo") ?? "";
  } catch {
    return /^[\w.-]{1,40}$/.test(texto.trim()) ? texto.trim() : "";
  }
}

/**
 * Enlaza el ticket con el equipo exacto del inventario (código), para saber cuánto se gastó en cada
 * equipo. Se elige escribiendo (código, nombre o ubicación) o escaneando su QR con la cámara (en los
 * navegadores que lo permiten). Cada cambio queda en el historial del ticket. Solo administradores editan.
 */
export function EquipoDelTicket({ id }: { id: number }) {
  const me = useMe();
  const editable = me?.rol === "admin";
  const [codigo, setCodigo] = useState<string | null | undefined>(undefined);
  const [texto, setTexto] = useState("");
  const [equipos, setEquipos] = useState<EquipoCorto[]>([]);
  const [msg, setMsg] = useState("");
  const [escaneando, setEscaneando] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    fetch(`/api/inventario?ticket=${id}`)
      .then((r) => (r.ok ? r.json() : { codigo: null }))
      .then((d) => setCodigo(d.codigo ?? null))
      .catch(() => setCodigo(null));
    void cargarEquipos(me?.campus).then(setEquipos);
  }, [id]);

  const equipo = codigo ? equipos.find((e) => e.codigo === codigo) : undefined;
  const puedeEscanear = typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices;

  async function guardar(nuevo: string | null) {
    setMsg("");
    const r = await fetch("/api/inventario?accion=enlazar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correctivo_id: id, codigo: nuevo }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMsg(d.error || "No se pudo guardar");
      return;
    }
    setCodigo(nuevo);
    setTexto("");
  }
  function elegir(valor: string) {
    setTexto(valor);
    const cod = valor.split(" · ")[0].trim();
    if (equipos.some((e) => e.codigo === cod)) void guardar(cod);
  }

  // Cámara: busca un QR cada 300 ms hasta encontrar un código de equipo.
  useEffect(() => {
    if (!escaneando) return;
    let flujo: MediaStream | null = null;
    let vivo = true;
    (async () => {
      try {
        flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = flujo;
        await video.current.play();
        const Detector = (window as unknown as { BarcodeDetector: new (o: object) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
        const det = new Detector({ formats: ["qr_code"] });
        while (vivo) {
          const r = await det.detect(video.current).catch(() => []);
          const cod = r.map((x) => codigoDeQr(x.rawValue)).find(Boolean);
          if (cod) {
            setEscaneando(false);
            if (equipos.length && !equipos.some((e) => e.codigo === cod)) setMsg(`El código ${cod} no está en el inventario`);
            else void guardar(cod);
            break;
          }
          await new Promise((res) => setTimeout(res, 300));
        }
      } catch {
        setMsg("No se pudo usar la cámara. Escribe el código o el nombre del equipo.");
        setEscaneando(false);
      }
    })();
    return () => {
      vivo = false;
      flujo?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escaneando]);

  if (codigo === undefined) return null;
  if (!codigo && !editable) return null;
  return (
    <section className="mt-6 border border-line rounded-lg bg-white px-4 py-3">
      <h2 className="font-semibold text-xs uppercase tracking-wider text-ink-soft mb-1">Equipo del inventario</h2>
      {codigo ? (
        <p className="text-sm">
          <a href={`/inventario?equipo=${encodeURIComponent(codigo)}`} className="font-mono font-medium hover:underline">{codigo}</a>
          {equipo && (
            <span className="text-ink-soft"> · {equipo.nombre} · {[equipo.pabellon, equipo.piso, equipo.ubicacion].filter(Boolean).join(" · ")}</span>
          )}
          {editable && (
            <button type="button" onClick={() => void guardar(null)} className="ml-3 text-xs underline text-ink-soft">Quitar</button>
          )}
        </p>
      ) : (
        <p className="text-xs text-ink-soft">Sin equipo enlazado: elígelo para que su costo cuente en el inventario.</p>
      )}
      {editable && (
        <div className="mt-2 flex flex-wrap gap-2 items-center">
          <input
            list={`equipos-${id}`}
            value={texto}
            onChange={(e) => elegir(e.target.value)}
            placeholder={codigo ? "Cambiar: código, equipo o ubicación…" : "Código, equipo o ubicación…"}
            className="flex-1 min-w-[220px] border border-line-strong rounded-md px-3 py-1.5 text-sm"
          />
          <datalist id={`equipos-${id}`}>
            {equipos.slice(0, 2000).map((e) => (
              <option key={e.codigo} value={`${e.codigo} · ${e.nombre} · ${[e.pabellon, e.piso, e.ubicacion].filter(Boolean).join(" · ")}`} />
            ))}
          </datalist>
          {puedeEscanear && (
            <button type="button" onClick={() => setEscaneando((x) => !x)} className="border border-line-strong rounded-md px-3 py-1.5 text-sm">
              {escaneando ? "Cancelar" : "Escanear QR"}
            </button>
          )}
        </div>
      )}
      {escaneando && <video ref={video} className="mt-2 w-full max-w-sm rounded border border-line" muted playsInline />}
      {msg && <p className="text-xs text-danger mt-1">{msg}</p>}
    </section>
  );
}

/** Aviso en la ficha del ticket: el trabajo puede estar cubierto por la garantía de uno anterior (mismo equipo
 *  o ambiente y especialidad). Lo calcula /api/gestion/garantias?ticket=ID; sin acceso o sin datos, no muestra nada. */
export function AvisoGarantia({ id }: { id: number }) {
  type Cubre = { id: number; refer: number | null; ticket: string | null; proveedor: string | null; descripcion: string; hasta: string; meses: number };
  const [cubre, setCubre] = useState<Cubre[]>([]);
  useEffect(() => {
    let vivo = true;
    fetch(`/api/gestion/garantias?ticket=${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => vivo && setCubre(d?.data?.cubre ?? []))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [id]);
  if (cubre.length === 0) return null;
  const fecha = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
  return (
    <div className="border border-amber-300 bg-amber-50 rounded-md p-3 text-sm">
      <p className="font-medium">🛡 Este trabajo podría estar en garantía</p>
      <ul className="mt-1 space-y-1">
        {cubre.map((g) => (
          <li key={g.id}>
            <a href={`/correctivos/${g.id}`} className="font-mono text-xs underline">#{g.refer ?? g.id}</a>{" "}
            {g.proveedor && <b>{g.proveedor}</b>} · garantía de {g.meses} meses hasta <b>{fecha(g.hasta)}</b> ·{" "}
            <span className="text-ink-soft">{g.descripcion.length > 110 ? g.descripcion.slice(0, 109) + "…" : g.descripcion}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-ink-soft">
        Mismo equipo o ambiente y especialidad. Antes de pagar otra vez, pide al proveedor que lo atienda por garantía.{" "}
        <a href="/gestion/garantias" className="underline">Ver garantías</a>
      </p>
    </div>
  );
}

/** SLA cotización → OC del ticket, debajo de la fecha de OC: días hábiles y si cumple la meta. */
function SlaOc(p: { f_coti?: string | null; f_oc?: string | null; n_oc?: string | null; estado?: string | null }) {
  const sla = slaCotiOc(p);
  if (!sla) {
    const coti = toDateOnly(p.f_coti ?? null);
    const oc = toDateOnly(p.f_oc ?? null);
    return coti && oc && oc < coti ? <p className="text-[11px] text-danger mt-1">La fecha de OC es anterior a la cotización</p> : null;
  }
  const color = sla.cumple ? "text-teal" : sla.dias > sla.meta * 2 ? "text-danger" : "text-amber-700";
  return (
    <p className={`text-[11px] mt-1 ${color}`} title={`SLA: días hábiles (lunes a viernes) desde la cotización hasta la OC. Meta: ${sla.meta}.`}>
      SLA {sla.enCurso ? "en curso" : "cotización → OC"}: <b>{sla.dias}</b> día{sla.dias === 1 ? "" : "s"} háb. {sla.cumple ? "✓" : `· meta ${sla.meta}`}
    </p>
  );
}
