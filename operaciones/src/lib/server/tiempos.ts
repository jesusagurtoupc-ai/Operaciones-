/**
 * Cronómetro para medir dónde se va el tiempo de una ruta del servidor. El resultado va en la cabecera
 * "Server-Timing": en el navegador (F12 → Red → clic en la petición → pestaña "Tiempos") aparece
 * desglosado por pasos. Solo son duraciones en milisegundos: no revela datos.
 */
export function cronometro() {
  const inicio = performance.now();
  let ultimo = inicio;
  const pasos: string[] = [];
  return {
    /** Cierra un paso: guarda lo que pasó desde el paso anterior. */
    paso(nombre: string) {
      const ahora = performance.now();
      pasos.push(`${nombre};dur=${(ahora - ultimo).toFixed(0)}`);
      ultimo = ahora;
    },
    /** Valor para la cabecera "Server-Timing" (incluye el total). */
    cabecera(): string {
      return [...pasos, `total;dur=${(performance.now() - inicio).toFixed(0)}`].join(", ");
    },
  };
}
