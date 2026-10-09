// Límite de intentos fallidos de login (por usuario + IP). Vive en la
// memoria de cada instancia del servidor: en Vercel no es compartido
// entre instancias, así que frena fuerza bruta simple pero no es una
// defensa completa.
const MAX_FALLOS = 5;
const VENTANA_MS = 15 * 60 * 1000;

const intentos = new Map<string, { fallos: number; desde: number }>();

export function bloqueado(clave: string): boolean {
  const r = intentos.get(clave);
  if (!r) return false;
  if (Date.now() - r.desde > VENTANA_MS) {
    intentos.delete(clave);
    return false;
  }
  return r.fallos >= MAX_FALLOS;
}

export function registrarFallo(clave: string) {
  const ahora = Date.now();
  const r = intentos.get(clave);
  if (!r || ahora - r.desde > VENTANA_MS) {
    intentos.set(clave, { fallos: 1, desde: ahora });
  } else {
    r.fallos++;
  }
  if (intentos.size > 5000) {
    for (const [k, v] of intentos) if (ahora - v.desde > VENTANA_MS) intentos.delete(k);
  }
}

export function limpiarFallos(clave: string) {
  intentos.delete(clave);
}
