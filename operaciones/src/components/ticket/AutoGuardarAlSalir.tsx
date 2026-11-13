"use client";

import { useEffect } from "react";
import { autoGuardarTicket } from "@/lib/client";

/**
 * Al cerrar la pestaña o el navegador, o cambiar de pestaña, intenta
 * dejar al día la carpeta local del ticket abierto. Es "mejor esfuerzo":
 * los navegadores pueden cortar tareas asíncronas al cerrarse, por eso
 * el guardado principal ocurre al guardar cada cambio.
 */
export default function AutoGuardarAlSalir({ id }: { id: number }) {
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
