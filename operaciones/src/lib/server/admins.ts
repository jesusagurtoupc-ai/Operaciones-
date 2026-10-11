import { sql } from "@/lib/server/db";

// Garantía de "siempre queda al menos un administrador activo", aplicada DENTRO de la
// propia sentencia SQL. Comprobar primero y escribir después deja una carrera: dos
// administradores que se degradan a la vez ven cada uno "queda el otro" y ambos pasan.
//
// El CTE bloquea (FOR UPDATE) todas las filas de administradores activos. Una segunda
// sentencia concurrente espera a que termine la primera, vuelve a evaluar esas filas ya
// modificadas y comprueba la condición con los datos reales.

/**
 * Cambia rol y/o estado activo del usuario. Devuelve false si el cambio dejaría el sistema
 * sin administradores activos (o si el usuario no existe); en ese caso no se modifica nada.
 */
export async function actualizarRolYActivo(id: number, rol: string, activo: boolean): Promise<boolean> {
  const sigueSiendoAdminActivo = rol === "admin" && activo;
  const rows = await sql`
    WITH admins AS (
      SELECT id FROM usuarios WHERE rol = 'admin' AND activo = true FOR UPDATE
    )
    UPDATE usuarios SET rol = ${rol}, activo = ${activo}
    WHERE id = ${id}
      AND (
        NOT (rol = 'admin' AND activo = true)
        OR ${sigueSiendoAdminActivo}::boolean
        OR (SELECT COUNT(*) FROM admins WHERE id <> ${id}) > 0
      )
    RETURNING id
  `;
  return rows.length > 0;
}

/** Elimina al usuario salvo que sea el último administrador activo. Devuelve false si no se eliminó. */
export async function eliminarUsuarioSeguro(id: number): Promise<boolean> {
  const rows = await sql`
    WITH admins AS (
      SELECT id FROM usuarios WHERE rol = 'admin' AND activo = true FOR UPDATE
    )
    DELETE FROM usuarios
    WHERE id = ${id}
      AND (
        NOT (rol = 'admin' AND activo = true)
        OR (SELECT COUNT(*) FROM admins WHERE id <> ${id}) > 0
      )
    RETURNING id
  `;
  return rows.length > 0;
}
