"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

// Diálogos propios que reemplazan confirm(), prompt() y alert() del navegador.
// Usan el elemento <dialog> nativo: el foco queda atrapado dentro, Esc cierra
// y los lectores de pantalla lo anuncian como cuadro de diálogo modal.

type OpcionesConfirmar = {
  titulo: string;
  mensaje?: string;
  /** Texto del botón de aceptar (por defecto "Aceptar"). */
  boton?: string;
  /** Pinta el botón en rojo: para acciones que no se pueden deshacer. */
  peligro?: boolean;
};

type OpcionesTexto = {
  titulo: string;
  mensaje?: string;
  boton?: string;
  /** Etiqueta del campo de texto. */
  etiqueta: string;
  /** Largo mínimo exigido antes de aceptar (por defecto 1). */
  minimo?: number;
  /** Oculta lo que se escribe (contraseñas). */
  secreto?: boolean;
};

type Peticion =
  | ({ tipo: "confirmar"; resolver: (v: boolean) => void } & OpcionesConfirmar)
  | ({ tipo: "texto"; resolver: (v: string | null) => void } & OpcionesTexto);

const btnBase =
  "rounded-md px-4 py-2 text-sm font-medium border transition-colors disabled:opacity-50";
const btnPrimario = `${btnBase} bg-amber text-white border-amber hover:bg-amber-hover hover:border-amber-hover`;
const btnSecundario = `${btnBase} bg-white text-ink border-line hover:bg-concrete-dim`;

function Dialogo({
  peticion,
  onCerrar,
}: {
  peticion: Peticion;
  onCerrar: (valor: boolean | string | null) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const tituloId = useId();
  const mensajeId = useId();
  const [texto, setTexto] = useState("");
  const [errorTexto, setErrorTexto] = useState("");
  const esTexto = peticion.tipo === "texto";

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const cancelar = () => onCerrar(esTexto ? null : false);

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (peticion.tipo === "texto") {
      const minimo = peticion.minimo ?? 1;
      const valor = peticion.secreto ? texto : texto.trim();
      if (valor.length < minimo) {
        setErrorTexto(
          minimo === 1 ? "Escribe un valor" : `Debe tener al menos ${minimo} caracteres`
        );
        return;
      }
      onCerrar(valor);
    } else {
      onCerrar(true);
    }
  }

  const peligro = peticion.tipo === "confirmar" && peticion.peligro;

  return (
    <dialog
      ref={ref}
      aria-labelledby={tituloId}
      aria-describedby={peticion.mensaje ? mensajeId : undefined}
      onCancel={(e) => {
        e.preventDefault(); // el cierre lo decide React, no el navegador
        cancelar();
      }}
      onClick={(e) => {
        // Clic en el fondo oscuro (fuera de la caja) = cancelar.
        if (e.target === ref.current) cancelar();
      }}
      className="m-auto w-[min(92vw,28rem)] rounded-lg border border-line bg-white p-0 text-ink shadow-xl backdrop:bg-black/40"
    >
      <form onSubmit={enviar} className="p-6">
        <h2 id={tituloId} className="text-base font-semibold">
          {peticion.titulo}
        </h2>
        {peticion.mensaje && (
          <p id={mensajeId} className="mt-2 text-sm text-ink-soft">
            {peticion.mensaje}
          </p>
        )}

        {peticion.tipo === "texto" && (
          <div className="mt-4">
            <label htmlFor={`${tituloId}-pw`} className="block text-xs font-medium text-ink-soft mb-1">
              {peticion.etiqueta}
            </label>
            <input
              id={`${tituloId}-pw`}
              type={peticion.secreto ? "password" : "text"}
              autoFocus
              autoComplete={peticion.secreto ? "new-password" : "off"}
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                setErrorTexto("");
              }}
              aria-invalid={errorTexto ? true : undefined}
              aria-describedby={errorTexto ? `${tituloId}-err` : undefined}
              className="w-full border border-line rounded-md px-3 py-2 bg-white text-sm focus:outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-200/70"
            />
            {errorTexto && (
              <p id={`${tituloId}-err`} role="alert" className="mt-1.5 text-xs text-danger">
                {errorTexto}
              </p>
            )}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={cancelar} className={btnSecundario}>
            Cancelar
          </button>
          <button
            type="submit"
            // En confirmaciones peligrosas el foco empieza en "Cancelar" por seguridad.
            autoFocus={peticion.tipo === "confirmar" && !peligro}
            className={
              peligro
                ? `${btnBase} bg-danger text-white border-danger hover:opacity-90`
                : btnPrimario
            }
          >
            {peticion.boton ?? "Aceptar"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/**
 * Uso:
 *   const { confirmar, pedirTexto, pedirContrasena, dialogos } = useDialogos();
 *   if (!(await confirmar({ titulo: "¿Eliminar?", peligro: true }))) return;
 *   ...
 *   return (<>… {dialogos}</>);
 */
export function useDialogos() {
  const [peticion, setPeticion] = useState<Peticion | null>(null);

  const confirmar = useCallback(
    (opciones: OpcionesConfirmar) =>
      new Promise<boolean>((resolver) => setPeticion({ tipo: "confirmar", resolver, ...opciones })),
    []
  );

  /** Devuelve el texto escrito (recortado), o null si se canceló. */
  const pedirTexto = useCallback(
    (opciones: OpcionesTexto) =>
      new Promise<string | null>((resolver) => setPeticion({ tipo: "texto", resolver, ...opciones })),
    []
  );

  /** Igual que pedirTexto, pero oculta lo que se escribe. */
  const pedirContrasena = useCallback(
    (opciones: Omit<OpcionesTexto, "etiqueta" | "secreto">) =>
      pedirTexto({ ...opciones, etiqueta: "Nueva contraseña", secreto: true }),
    [pedirTexto]
  );

  const cerrar = (valor: boolean | string | null) => {
    if (!peticion) return;
    // El tipo de la petición decide qué resolver se llama.
    if (peticion.tipo === "confirmar") peticion.resolver(valor === true);
    else peticion.resolver(typeof valor === "string" ? valor : null);
    setPeticion(null);
  };

  const dialogos: ReactNode = peticion ? <Dialogo peticion={peticion} onCerrar={cerrar} /> : null;
  return { confirmar, pedirTexto, pedirContrasena, dialogos };
}
