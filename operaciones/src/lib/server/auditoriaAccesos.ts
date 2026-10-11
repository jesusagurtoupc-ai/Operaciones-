import { sql } from "@/lib/server/db";
import { ipCliente } from "@/lib/server/ip";

export type EventoAcceso =
  | "login_ok"
  | "login_fallo"
  | "logout"
  | "logout_todas"
  | "export";

const RETENCION_DIAS = 180;

/**
 * Deja constancia de un acceso (ingreso, salida, exportación) con IP y navegador.
 * Nunca guarda contraseñas. Si falla, no interrumpe la operación.
 */
export async function registrarAcceso(
  evento: EventoAcceso,
  usuario: string | null,
  req: Request,
  detalle?: string
) {
  try {
    await sql`
      INSERT INTO auditoria_accesos (usuario, evento, ip, user_agent, detalle)
      VALUES (${usuario ? usuario.slice(0, 100) : null}, ${evento}, ${ipCliente(req).slice(0, 100)},
              ${(req.headers.get("user-agent") ?? "").slice(0, 300) || null},
              ${detalle ? detalle.slice(0, 500) : null})
    `;
    // Retención: se borran los registros de más de 180 días (limpieza ocasional).
    if (Math.random() < 0.02) {
      await sql`DELETE FROM auditoria_accesos WHERE created_at < now() - make_interval(days => ${RETENCION_DIAS})`;
    }
  } catch (err) {
    console.error("No se pudo registrar el acceso", err);
  }
}
