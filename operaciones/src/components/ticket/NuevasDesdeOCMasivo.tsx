"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Resultado = { nombre: string; estado: "creado" | "error"; detalle: string; id?: number };

/**
 * Carga masiva: se eligen varios PDF de OC y se crea un ticket por cada uno (uno tras otro).
 * Usa las mismas reglas que el alta individual: monto con IGV y fechas ambiguas sin confirmar
 * (el ticket se crea sin esas fechas, que se pueden completar después). Las OC repetidas o
 * ilegibles no se crean y quedan indicadas en el resumen.
 */
export default function NuevasDesdeOCMasivo() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [procesando, setProcesando] = useState(false);
  const [avance, setAvance] = useState({ hechos: 0, total: 0 });
  const [resultados, setResultados] = useState<Resultado[]>([]);

  async function procesar(files: FileList | null) {
    const lista = files ? Array.from(files) : [];
    if (inputRef.current) inputRef.current.value = "";
    if (lista.length === 0) return;
    setProcesando(true);
    setResultados([]);
    setAvance({ hechos: 0, total: lista.length });
    const salida: Resultado[] = [];
    for (const f of lista) {
      try {
        const fd = new FormData();
        fd.append("file", f, f.name);
        fd.append("base", "total");
        const res = await fetch("/api/correctivos/desde-oc", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "No se pudo crear el ticket");
        salida.push({ nombre: f.name, estado: "creado", detalle: `Ticket #${data.data.refer ?? data.data.id}`, id: data.data.id });
      } catch (e) {
        salida.push({ nombre: f.name, estado: "error", detalle: e instanceof Error ? e.message : "Error" });
      }
      setAvance((a) => ({ ...a, hechos: a.hechos + 1 }));
      setResultados([...salida]);
    }
    setProcesando(false);
    router.refresh();
  }

  const creados = resultados.filter((r) => r.estado === "creado").length;

  return (
    <div className="bg-white border border-line rounded-lg shadow-card p-6 mt-6 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-soft border-b border-line pb-2">
        Carga masiva de OC
      </h3>
      <p className="text-sm text-ink-soft">
        Elige varios PDF de órdenes de compra a la vez: se crea un ticket por cada uno (monto con IGV).
        Las OC ya registradas o que no se puedan leer se omiten y aparecen en el resumen. Las fechas que el PDF
        deja ambiguas (mes/día) no se guardan: complétalas después en cada ticket.
      </p>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => void procesar(e.target.files)}
      />
      <button
        type="button"
        disabled={procesando}
        onClick={() => inputRef.current?.click()}
        className="border border-line-strong rounded-md px-5 py-2.5 text-sm font-medium hover:bg-concrete-dim transition-colors disabled:opacity-50"
      >
        {procesando ? `Procesando ${avance.hechos}/${avance.total}…` : "Elegir varios PDF de OC"}
      </button>

      {resultados.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {creados} de {avance.total} tickets creados
          </p>
          <ul className="divide-y divide-line border border-line rounded-md text-sm">
            {resultados.map((r, i) => (
              <li key={i} className="flex justify-between gap-3 px-3 py-2">
                <span className="truncate font-mono-tag text-xs" title={r.nombre}>{r.nombre}</span>
                <span className={`shrink-0 text-xs ${r.estado === "creado" ? "text-emerald-700" : "text-danger"}`}>
                  {r.estado === "creado" ? "✓ " : "✗ "}
                  {r.detalle}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => router.push("/correctivos")}
            className="text-sm text-ink-soft hover:text-ink hover:underline"
          >
            Ir a la lista
          </button>
        </div>
      )}
    </div>
  );
}
