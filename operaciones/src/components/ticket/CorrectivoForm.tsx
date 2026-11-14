"use client";

import { rutaUltimaLista } from "@/components/lista/filtrosLista";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ESTADOS, TIPOS_TRAB, SUB_TIPOS_TRAB, AREAS, LUGARES, formatoSoles } from "@/lib/shared";
import type { Correctivo, CorrectivoInput } from "@/lib/shared";
import { toDateOnly } from "@/lib/shared";
import { useMe } from "@/lib/client";
import { autoGuardarTicket, EVENTO_ESTADO_AUTO, EVENTO_CAMPOS_AUTO, EVENTO_TICKET_SINCRONIZADO } from "@/lib/client";
import { pendienteDe, guardarPendiente, quitarPendiente, enviarTicket } from "@/lib/client";
import type { EstadoAuto, CamposAuto } from "@/lib/client";

export default function CorrectivoForm({
  initial,
  id,
  children,
}: {
  initial: Correctivo;
  id: number;
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
      const { estado, f_fin } = (e as CustomEvent<EstadoAuto>).detail;
      setForm((f) => ({ ...f, estado, f_fin: f_fin || f.f_fin }));
      setBase((b) => ({ ...b, estado, f_fin: f_fin || b.f_fin }));
    };
    // Datos que el servidor completó (cotización leída): solo entran en campos que siguen vacíos aquí.
    const alCompletar = (e: Event) => {
      const c = (e as CustomEvent<CamposAuto>).detail;
      setForm((f) => {
        const sig = { ...f };
        for (const k of Object.keys(c) as (keyof CamposAuto)[]) {
          const actual = f[k];
          if (actual === null || actual === undefined || actual === "") (sig as Record<string, unknown>)[k] = c[k];
        }
        return sig;
      });
      // El servidor ya los guardó: no cuentan como cambios pendientes de esta persona.
      setBase((b) => {
        const sig = { ...b };
        for (const k of Object.keys(c) as (keyof CamposAuto)[]) {
          const actual = b[k];
          if (actual === null || actual === undefined || actual === "") (sig as Record<string, unknown>)[k] = c[k];
        }
        return sig;
      });
    };
    window.addEventListener(EVENTO_ESTADO_AUTO, alCambiar);
    window.addEventListener(EVENTO_CAMPOS_AUTO, alCompletar);
    return () => {
      window.removeEventListener(EVENTO_ESTADO_AUTO, alCambiar);
      window.removeEventListener(EVENTO_CAMPOS_AUTO, alCompletar);
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
              {ESTADOS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Proveedor</label>
            <input className={inputCls} value={form.proveedor ?? ""} onChange={(e) => set("proveedor", e.target.value)} />
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
