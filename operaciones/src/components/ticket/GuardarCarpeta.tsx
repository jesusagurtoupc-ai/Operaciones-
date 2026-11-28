"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Correctivo } from "@/lib/shared";
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
  autoGuardarTicket,
} from "@/lib/client";

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
  claseBoton,
}: {
  correctivo?: Correctivo;
  cargarTodos?: () => Promise<Correctivo[]>;
  etiqueta?: string;
  /** Estilo del botón (barra del Panel): la carpeta, la opción automática y los avisos van en un menú «▾». */
  claseBoton?: string;
}) {
  const [menu, setMenu] = useState(false);
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
          : `${tickets.length} tickets guardados en «${raiz.name}», cada uno en su carpeta (${adjuntos} archivos nuevos)`,
      });
    } catch (e) {
      setMsg({ tipo: "error", texto: (e as Error).message || "No se pudo guardar" });
    } finally {
      setOcupado(false);
    }
  }

  if (soportado === null) return null;
  if (claseBoton) {
    // Versión compacta: un botón y, al lado, «▾» con la carpeta y las opciones; los avisos aparecen ahí mismo.
    const abierto = menu || !!msg;
    return (
      <div className="relative inline-flex">
        <button
          type="button"
          onClick={soportado ? guardar : () => setMenu((v) => !v)}
          disabled={ocupado}
          className={`${claseBoton} rounded-r-none`}
          title={soportado ? (carpeta ? `Guarda cada ticket en «${carpeta}»` : "La primera vez te pide elegir la carpeta") : "Solo funciona en Chrome o Edge desde un computador"}
        >
          {ocupado ? "Guardando…" : etiqueta}
        </button>
        <button
          type="button"
          onClick={() => { setMenu((v) => !v); if (abierto) setMsg(null); }}
          aria-label="Opciones de la carpeta"
          aria-expanded={abierto}
          className={`${claseBoton} rounded-l-none border-l-0 !px-2`}
        >
          ▾
        </button>
        {abierto && (
          <div className="absolute right-0 top-full mt-1 z-30 w-72 bg-white border border-line rounded-lg shadow-lg p-3 space-y-2 text-xs text-left">
            {!soportado ? (
              <p className="text-ink-soft">Guardar en carpeta solo funciona en Chrome o Edge desde un computador.</p>
            ) : (
              <>
                <p className="text-ink-soft">
                  Carpeta: <b className="text-ink">{carpeta ?? "sin elegir"}</b>{" "}
                  <button type="button" onClick={cambiar} disabled={ocupado} className="underline hover:text-ink">
                    {carpeta ? "cambiar" : "elegir"}
                  </button>
                </p>
                {carpeta && (
                  <label className="flex items-center gap-1.5 text-ink-soft">
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
              </>
            )}
            {msg && <p className={msg.tipo === "error" ? "text-danger" : "text-teal"}>{msg.texto}</p>}
          </div>
        )}
      </div>
    );
  }
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
          className="border border-line-strong rounded-md px-4 py-2 text-sm font-medium hover:bg-concrete-dim transition-colors disabled:opacity-50"
        >
          {ocupado ? "Guardando..." : etiqueta}
        </button>
        <button
          type="button"
          onClick={cambiar}
          disabled={ocupado}
          title={carpeta ? `Carpeta actual: ${carpeta}` : "Elegir carpeta de guardado"}
          className="text-xs text-ink-soft hover:text-ink underline disabled:opacity-50"
        >
          {carpeta ? `Carpeta: ${carpeta} · cambiar` : "Elegir carpeta"}
        </button>
      </div>
      {carpeta && (
        <label className="flex items-center gap-1.5 text-xs text-ink-soft cursor-pointer">
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

/**
 * Al cerrar la pestaña o el navegador, o cambiar de pestaña, intenta
 * dejar al día la carpeta local del ticket abierto. Es "mejor esfuerzo":
 * los navegadores pueden cortar tareas asíncronas al cerrarse, por eso
 * el guardado principal ocurre al guardar cada cambio.
 */
export function AutoGuardarAlSalir({ id }: { id: number }) {
  useEffect(() => {
    const alSalir = () => {
      void autoGuardarTicket(id, false);
    };
    const alOcultar = () => {
      if (document.visibilityState === "hidden") alSalir();
    };
    document.addEventListener("visibilitychange", alOcultar);
    window.addEventListener("pagehide", alSalir);
    return () => {
      document.removeEventListener("visibilitychange", alOcultar);
      window.removeEventListener("pagehide", alSalir);
    };
  }, [id]);
  return null;
}

/** Botón "Imprimir" del ticket (vive aquí para no ocupar un archivo aparte). */
export function BotonImprimir() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="border border-line-strong rounded-md px-4 py-2 text-sm font-medium hover:bg-concrete-dim transition-colors"
    >
      Imprimir
    </button>
  );
}

/**
 * Recordatorio al proveedor: abre un correo (Outlook u otro) con el ticket, la OC, el lugar y la fecha de
 * entrega ya escritos; si la entrega ya venció, dice hace cuántos días. Se envía desde el correo de quien lo usa.
 */
export function RecordatorioProveedor({ c }: { c: Correctivo }) {
  if (!c.proveedor || c.estado === "Finalizado") return null;
  const hoy = new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
  const fecha = (f?: string | null) => (f ? String(f).slice(0, 10).split("-").reverse().join("/") : "");
  const entrega = c.f_entrega ? String(c.f_entrega).slice(0, 10) : null;
  const vencida = entrega && entrega < hoy ? Math.round((Date.parse(hoy) - Date.parse(entrega)) / 86400000) : 0;
  const asunto = `Recordatorio${c.n_oc ? ` OC ${c.n_oc}` : ""} · Ticket ${c.refer ?? c.id}${vencida ? " · entrega vencida" : ""}`;
  const cuerpo = [
    `Estimados ${c.proveedor}:`,
    "",
    vencida
      ? `Les recordamos que la fecha de entrega del siguiente trabajo venció el ${fecha(entrega)} (hace ${vencida} día${vencida === 1 ? "" : "s"}). Agradeceremos confirmarnos la fecha de atención y enviarnos el informe técnico al culminar.`
      : `Les escribimos para hacer seguimiento al siguiente trabajo${entrega ? `, con fecha de entrega el ${fecha(entrega)}` : ""}. Agradeceremos confirmarnos el avance y enviarnos el informe técnico al culminar.`,
    "",
    `Ticket: ${c.refer ?? c.id}${c.ticket ? ` (${c.ticket})` : ""}`,
    c.n_oc ? `Orden de compra: ${c.n_oc}${c.f_oc ? ` del ${fecha(c.f_oc)}` : ""}` : "",
    `Trabajo: ${c.descripcion}`,
    c.lugar ? `Lugar: ${c.lugar}` : "",
    "",
    "Saludos.",
  ].filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n");
  return (
    <a
      href={`mailto:?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`}
      title="Abre un correo para el proveedor con los datos del ticket ya escritos"
      className={`border rounded-md px-4 py-2 text-sm font-medium transition-colors ${vencida ? "border-danger/40 text-danger hover:bg-danger/5" : "border-line-strong hover:bg-concrete-dim"}`}
    >
      Recordar al proveedor
    </a>
  );
}

/** Caja para agregar un comentario interno al ticket (queda en la línea de tiempo con quién y cuándo). */
export function ComentarTicket({ id }: { id: number }) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState<"" | "guardando" | "error">("");
  const [error, setError] = useState("");
  async function enviar() {
    if (texto.trim().length < 2) return;
    setEstado("guardando");
    try {
      const r = await fetch(`/api/correctivos/${id}?accion=comentar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "No se pudo guardar");
      setTexto("");
      setEstado("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
      setEstado("error");
    }
  }
  return (
    <div className="mt-4">
      <label htmlFor="comentario-ticket" className="block text-xs font-medium text-ink-soft mb-1">Agregar comentario</label>
      <div className="flex flex-col sm:flex-row gap-2">
        <textarea
          id="comentario-ticket"
          rows={2}
          maxLength={1000}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void enviar();
          }}
          placeholder="Ej.: el proveedor confirmó la visita para el jueves"
          className="flex-1 border border-line-strong rounded-md px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void enviar()}
          disabled={estado === "guardando" || texto.trim().length < 2}
          className="self-start bg-ink text-white rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {estado === "guardando" ? "Guardando…" : "Comentar"}
        </button>
      </div>
      {estado === "error" && <p className="text-xs text-danger mt-1">{error}</p>}
    </div>
  );
}

