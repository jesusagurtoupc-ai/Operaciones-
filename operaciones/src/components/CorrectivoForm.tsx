"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ESTADOS, TIPOS_TRAB, SUB_TIPOS_TRAB, AREAS, LUGARES } from "@/lib/opciones";
import type { Correctivo, CorrectivoInput } from "@/lib/types";
import { toDateOnly } from "@/lib/types";
import { useMe } from "@/lib/useMe";
import { prepararAutoguardado, autoGuardarTicket } from "@/lib/carpetaLocal";

const VACIO: CorrectivoInput = {
  refer: null,
  ticket: "",
  f_reg: new Date().toISOString().slice(0, 10),
  descripcion: "",
  lugar: "",
  estado: "cotizar",
  proveedor: "",
  monto: null,
  f_coti: "",
  obs_cot: "",
  f_ps: "",
  f_oc: "",
  f_inicio: "",
  f_fin: "",
  cuenta: "",
  tipo_trab: "",
  sub_tipo_trab: "",
  evaluacion: "",
  n_oc: "",
  area: "Mantenimiento",
};

export default function CorrectivoForm({
  initial,
  id,
}: {
  initial?: Correctivo;
  id?: number;
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
          lugar: initial.lugar || "",
          estado: initial.estado,
          proveedor: initial.proveedor || "",
          monto: initial.monto,
          f_coti: toDateOnly(initial.f_coti),
          obs_cot: initial.obs_cot || "",
          f_ps: toDateOnly(initial.f_ps),
          f_oc: toDateOnly(initial.f_oc),
          f_inicio: toDateOnly(initial.f_inicio),
          f_fin: toDateOnly(initial.f_fin),
          cuenta: initial.cuenta || "",
          tipo_trab: initial.tipo_trab || "",
          sub_tipo_trab: initial.sub_tipo_trab || "",
          evaluacion: initial.evaluacion || "",
          n_oc: initial.n_oc || "",
          area: initial.area || "",
        }
      : VACIO
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function set<K extends keyof CorrectivoInput>(key: K, value: CorrectivoInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
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
    if (idGuardado) await autoGuardarTicket(idGuardado);
    router.push("/correctivos");
    router.refresh();
  }

  const inputCls =
    "w-full border border-line px-3 py-2 bg-white text-sm focus:outline-none focus:border-ink";
  const labelCls = "block text-[10px] font-mono-tag uppercase tracking-widest text-ink-soft mb-1";

  return (
    <form onSubmit={handleSubmit} className="bg-white border-2 border-ink p-6">
      <fieldset disabled={soloLectura} className="space-y-6 min-w-0 border-0 p-0 m-0">
      {soloLectura && (
        <p className="text-sm bg-concrete-dim border border-line px-3 py-2">
          Tu usuario es de solo lectura: puedes ver este ticket, pero no modificarlo.
        </p>
      )}
      {error && (
        <p className="text-sm text-danger bg-[var(--danger-soft)] border border-danger/30 px-3 py-2">
          {error}
        </p>
      )}

      <div>
        <h3 className="font-mono-tag text-xs uppercase tracking-widest text-ink-soft mb-3 border-b border-line pb-2">
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
        <h3 className="font-mono-tag text-xs uppercase tracking-widest text-ink-soft mb-3 border-b border-line pb-2">
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
        <h3 className="font-mono-tag text-xs uppercase tracking-widest text-ink-soft mb-3 border-b border-line pb-2">
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
      </div>

      <div>
        <h3 className="font-mono-tag text-xs uppercase tracking-widest text-ink-soft mb-3 border-b border-line pb-2">
          Fechas del proceso
        </h3>
        <div className="grid md:grid-cols-5 gap-4">
          <div>
            <label className={labelCls}>F. Cotización</label>
            <input type="date" className={inputCls} value={form.f_coti ?? ""} onChange={(e) => set("f_coti", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>F. PS</label>
            <input type="date" className={inputCls} value={form.f_ps ?? ""} onChange={(e) => set("f_ps", e.target.value)} />
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
        <div className="mt-4">
          <label className={labelCls}>Observaciones de cotización</label>
          <textarea
            rows={2}
            className={inputCls}
            value={form.obs_cot ?? ""}
            onChange={(e) => set("obs_cot", e.target.value)}
          />
        </div>
        <div className="mt-4">
          <label className={labelCls}>Evaluación</label>
          <textarea
            rows={2}
            className={inputCls}
            value={form.evaluacion ?? ""}
            onChange={(e) => set("evaluacion", e.target.value)}
          />
        </div>
      </div>

      </fieldset>

      <div className="flex gap-3 pt-6">
        {!soloLectura && (
          <button
            type="submit"
            disabled={saving}
            className="bg-amber border-2 border-ink px-6 py-2.5 text-sm font-mono-tag uppercase tracking-wide hover:bg-ink hover:text-amber transition-colors disabled:opacity-50"
          >
            {saving ? "Guardando..." : id ? "Guardar cambios" : "Crear ticket"}
          </button>
        )}
        <button
          type="button"
          onClick={() => router.push("/correctivos")}
          className="border border-line px-6 py-2.5 text-sm font-mono-tag uppercase tracking-wide hover:border-ink transition-colors"
        >
          {soloLectura ? "Volver" : "Cancelar"}
        </button>
      </div>
    </form>
  );
}
