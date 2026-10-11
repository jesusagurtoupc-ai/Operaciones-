import { sql } from "@/lib/server/db";

/** Deja constancia de una acción sobre usuarios; si falla, no interrumpe la operación. */
export async function registrarUsuario(
  actor: string,
  accion: string,
  objetivo?: string,
  detalle?: string
) {
  try {
    await sql`
      INSERT INTO auditoria_usuarios (actor, accion, objetivo, detalle)
      VALUES (${actor}, ${accion}, ${objetivo ?? null}, ${detalle ? detalle.slice(0, 500) : null})
    `;
  } catch (err) {
    console.error("No se pudo registrar la acción de usuario", err);
  }
}
