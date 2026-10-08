"use client";

import { useEffect } from "react";
import { autoGuardarTicket } from "@/lib/carpetaLocal";

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
