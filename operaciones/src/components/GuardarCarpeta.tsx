"use client";

import { useEffect, useState } from "react";
import type { Correctivo } from "@/lib/types";
import {
  carpetaSoportada,
  carpetaLista,
  elegirCarpeta,
  guardarTicket,
  listarArchivos,
  nombreCarpetaGuardada,
  nombreCarpetaTicket,
  autoActivado,
  setAutoActivado,
} from "@/lib/carpetaLocal";

/**
 * Botón "Guardar en carpeta". Con `correctivo` guarda ese ticket; con
 * `cargarTodos` guarda todos los que devuelva esa función (lista
 * filtrada), cada uno en su propia carpeta. La carpeta elegida se
 * recuerda, así que solo se pide la primera vez.
 */
export default function GuardarCarpeta({
  correctivo,
  cargarTodos,
  etiqueta = "Guardar en carpeta",
}: {
  correctivo?: Correctivo;
  cargarTodos?: () => Promise<Correctivo[]>;
  etiqueta?: string;
}) {
  const [soportado, setSoportado] = useState<boolean | null>(null);
  const [carpeta, setCarpeta] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [auto, setAuto] = useState(true);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  useEffect(() => {
    const ok = carpetaSoportada();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSoportado(ok);
    if (ok) {
      nombreCarpetaGuardada().then(setCarpeta);
      setAuto(autoActivado());
    }
  }, []);

  async function cambiar() {
    setMsg(null);
    try {
      const n = await elegirCarpeta();
      if (n) setCarpeta(n);
    } catch {
      setMsg({ tipo: "error", texto: "No se pudo elegir la carpeta" });
    }
  }

  async function guardar() {
    setMsg(null);
    setOcupado(true);
    try {
      let raiz = await carpetaLista();
      if (!raiz) {
        const n = await elegirCarpeta();
        if (!n) return; // canceló
        setCarpeta(n);
        raiz = await carpetaLista();
        if (!raiz) return;
      }
      const tickets = correctivo ? [correctivo] : await cargarTodos!();
      let adjuntos = 0;
      for (let i = 0; i < tickets.length; i++) {
        if (!correctivo) {
          setMsg({ tipo: "ok", texto: `Guardando ${i + 1} de ${tickets.length}…` });
        }
        const t = tickets[i];
        adjuntos += await guardarTicket(raiz, t, await listarArchivos(t.id));
      }
      setMsg({
        tipo: "ok",
        texto: correctivo
          ? `Guardado en «${raiz.name}/${nombreCarpetaTicket(correctivo)}»`
          : `${tickets.length} tickets guardados en «${raiz.name}», cada uno en su carpeta (${adjuntos} adjuntos nuevos)`,
      });
    } catch (e) {
      setMsg({ tipo: "error", texto: (e as Error).message || "No se pudo guardar" });
    } finally {
      setOcupado(false);
    }
  }

  if (soportado === null) return null;
  if (!soportado) {
    return (
      <span
        className="text-xs text-ink-soft max-w-56"
        title="Guardar en carpeta solo funciona en Chrome o Edge desde un computador"
      >
        Guardar en carpeta: usa Chrome o Edge en computador
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={guardar}
          disabled={ocupado}
          className="border-2 border-ink px-4 py-2 text-sm font-mono-tag uppercase tracking-wide hover:bg-ink hover:text-concrete transition-colors disabled:opacity-50"
        >
          {ocupado ? "Guardando..." : etiqueta}
        </button>
        <button
          type="button"
          onClick={cambiar}
          disabled={ocupado}
          title={carpeta ? `Carpeta actual: ${carpeta}` : "Elegir carpeta de guardado"}
          className="text-[11px] font-mono-tag uppercase tracking-wide text-ink-soft hover:text-ink underline disabled:opacity-50"
        >
          {carpeta ? `Carpeta: ${carpeta} · cambiar` : "Elegir carpeta"}
        </button>
      </div>
      {carpeta && (
        <label className="flex items-center gap-1.5 text-[11px] font-mono-tag uppercase tracking-wide text-ink-soft cursor-pointer">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => {
              setAuto(e.target.checked);
              setAutoActivado(e.target.checked);
            }}
          />
          Guardar solo al editar y al salir
        </label>
      )}
      {msg && (
        <p className={`text-xs ${msg.tipo === "error" ? "text-danger" : "text-teal"}`}>
          {msg.texto}
        </p>
      )}
    </div>
  );
}
