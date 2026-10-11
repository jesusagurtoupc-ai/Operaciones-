import { sql } from "@/lib/server/db";

// Límite de intentos fallidos de login. Se guarda en la tabla `intentos_login`
// de la base de datos, así vale para todas las instancias del servidor (en
// Vercel cada petición puede caer en una distinta).
const MAX_FALLOS = 5;
const VENTANA_MINUTOS = 15;

/** Un contador de fallos y su tope. */
export type Limite = { clave: string; max: number };

// Topes: por usuario+IP (el más estricto), por IP sola (barrido de muchos usuarios
// desde una misma IP) y por usuario sin importar la IP (ataque repartido en muchas IP).
// MAX_FALLOS_IP cuenta INTENTOS (no solo fallos) desde esa IP: ver `contarIntento`.
export const MAX_FALLOS_IP = 100;
// Tope por usuario desde cualquier IP. Más alto que antes (30) para que un tercero no pueda dejar
// fuera a un usuario real con unas pocas peticiones; el tope por usuario+IP sigue siendo 5.
export const MAX_FALLOS_USUARIO = 60;

const k = (s: string) => encodeURIComponent(s.slice(0, 100));

/** Los tres contadores que se consultan y se suman en cada intento de login. */
export function limitesLogin(username: string, ip: string): Limite[] {
  return [
    { clave: `u|${k(ip)}|${k(username)}`, max: MAX_FALLOS },
    { clave: `i|${k(ip)}`, max: MAX_FALLOS_IP },
    { clave: `n|${k(username)}`, max: MAX_FALLOS_USUARIO },
  ];
}

export async function bloqueado(clave: string, max: number = MAX_FALLOS): Promise<boolean> {
  const rows = await sql`
    SELECT fallos FROM intentos_login
    WHERE clave = ${clave} AND desde > now() - make_interval(mins => ${VENTANA_MINUTOS})
  `;
  return rows.length > 0 && (rows[0].fallos as number) >= max;
}

/** Suma un fallo; si la ventana anterior ya venció, empieza una nueva. Es atómico. */
export async function registrarFallo(clave: string): Promise<void> {
  await sql`
    INSERT INTO intentos_login (clave, fallos, desde) VALUES (${clave}, 1, now())
    ON CONFLICT (clave) DO UPDATE SET
      fallos = CASE
        WHEN intentos_login.desde < now() - make_interval(mins => ${VENTANA_MINUTOS}) THEN 1
        ELSE intentos_login.fallos + 1 END,
      desde = CASE
        WHEN intentos_login.desde < now() - make_interval(mins => ${VENTANA_MINUTOS}) THEN now()
        ELSE intentos_login.desde END
  `;
  // Limpieza ocasional de registros viejos para que la tabla no crezca.
  if (Math.random() < 0.05) {
    await sql`DELETE FROM intentos_login WHERE desde < now() - interval '1 day'`;
  }
}

export async function limpiarFallos(clave: string): Promise<void> {
  await sql`DELETE FROM intentos_login WHERE clave = ${clave}`;
}

/**
 * Cuenta un intento ANTES de verificar la contraseña y devuelve cuántos lleva en la ventana.
 * Es una sola sentencia atómica: 100 peticiones simultáneas reciben números distintos
 * (1, 2, 3…) y solo las primeras pasan. Comprobar primero (`bloqueado`) y sumar el fallo
 * después dejaba que todas las peticiones en paralelo pasaran el control.
 */
export async function contarIntento(clave: string): Promise<number> {
  const rows = await sql`
    INSERT INTO intentos_login (clave, fallos, desde) VALUES (${clave}, 1, now())
    ON CONFLICT (clave) DO UPDATE SET
      fallos = CASE
        WHEN intentos_login.desde < now() - make_interval(mins => ${VENTANA_MINUTOS}) THEN 1
        ELSE intentos_login.fallos + 1 END,
      desde = CASE
        WHEN intentos_login.desde < now() - make_interval(mins => ${VENTANA_MINUTOS}) THEN now()
        ELSE intentos_login.desde END
    RETURNING fallos
  `;
  if (Math.random() < 0.05) {
    await sql`DELETE FROM intentos_login WHERE desde < now() - interval '1 day'`;
  }
  return Number((rows[0] as { fallos?: number } | undefined)?.fallos ?? 0);
}

/** Cuenta un intento en cada contador y dice si alguno superó su tope. */
export async function contarIntentosLogin(limites: Limite[]): Promise<boolean> {
  const conteos = await Promise.all(limites.map((l) => contarIntento(l.clave)));
  return conteos.some((n, i) => n > limites[i].max);
}

/** Devuelve un intento (p. ej. cuando solo se pidió el código del segundo paso, sin adivinar nada). */
export async function devolverIntento(clave: string): Promise<void> {
  await sql`UPDATE intentos_login SET fallos = GREATEST(fallos - 1, 0) WHERE clave = ${clave}`;
}
