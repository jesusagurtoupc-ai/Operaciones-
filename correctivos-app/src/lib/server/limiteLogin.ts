// Límite de intentos fallidos de login, guardado en la BASE DE DATOS.
//
// Antes vivía en la memoria de cada instancia del servidor. En Vercel hay
// varias instancias y se reinician solas, así que el contador no se compartía:
// quien probaba claves podía repartir los intentos entre instancias o esperar
// un reinicio. En la base de datos el contador es uno solo para todos.
//
// Hay dos límites: por usuario+IP (5 fallos: frena adivinar la clave de alguien
// y no deja que un tercero bloquee a esa persona desde otra IP) y por IP
// (30 fallos: frena probar muchos usuarios distintos desde un mismo lugar).
import { sql } from "./db";

export const MAX_FALLOS_USUARIO = 5;
export const MAX_FALLOS_IP = 30;
// La ventana (15 minutos) va escrita en las consultas con el reloj de la base de
// datos, así todas las instancias cuentan igual.

export async function bloqueado(clave: string, max: number): Promise<boolean> {
  const rows = await sql`
    SELECT fallos FROM login_intentos
    WHERE clave = ${clave} AND desde > now() - interval '15 minutes'
  `;
  return rows.length > 0 && Number(rows[0].fallos) >= max;
}

export async function registrarFallo(clave: string): Promise<void> {
  // Una sola instrucción atómica: si hay dos fallos a la vez, ninguno se pierde.
  await sql`
    INSERT INTO login_intentos (clave, fallos, desde)
    VALUES (${clave}, 1, now())
    ON CONFLICT (clave) DO UPDATE SET
      fallos = CASE WHEN login_intentos.desde < now() - interval '15 minutes'
                    THEN 1 ELSE login_intentos.fallos + 1 END,
      desde  = CASE WHEN login_intentos.desde < now() - interval '15 minutes'
                    THEN now() ELSE login_intentos.desde END
  `;
  // Limpieza ocasional de contadores viejos para que la tabla no crezca sin fin.
  if (Math.random() < 0.02) {
    await sql`DELETE FROM login_intentos WHERE desde < now() - interval '1 hour'`;
  }
}

export async function limpiarFallos(clave: string): Promise<void> {
  await sql`DELETE FROM login_intentos WHERE clave = ${clave}`;
}
