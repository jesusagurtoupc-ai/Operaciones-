// Registro de actividad de seguridad: inicios de sesión (correctos, fallidos y bloqueados), cierres
// de sesión, cambios de contraseña y cambios en los usuarios. Lo ve el administrador en la página
// Usuarios. Nunca interrumpe la operación: si falla, solo se anota en el log del servidor.
// La tabla se crea sola la primera vez (una vez por instancia) y se conservan DIAS_AUDITORIA días.
import { sql } from "./db";

export type Evento =
  | "login_ok"
  | "login_fallo"
  | "login_bloqueado"
  | "logout"
  | "clave_cambiada"
  | "usuario_creado"
  | "usuario_editado"
  | "usuario_eliminado";

export const DIAS_AUDITORIA = 180;

const g = globalThis as typeof globalThis & { __auditoriaTabla?: Promise<void> };

function asegurarTabla(): Promise<void> {
  if (!g.__auditoriaTabla) {
    g.__auditoriaTabla = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS auditoria (
          id         BIGSERIAL PRIMARY KEY,
          evento     TEXT NOT NULL,
          usuario    TEXT,
          detalle    TEXT,
          ip         TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_auditoria_fecha ON auditoria (created_at DESC)`;
    })().catch((e) => {
      g.__auditoriaTabla = undefined; // permite reintentar
      throw e;
    });
  }
  return g.__auditoriaTabla;
}

/** IP del cliente (en Vercel, la primera de x-forwarded-for la pone la propia plataforma). */
export function ipDe(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim().slice(0, 64) || "local";
}

/** Anota un evento. No lanza errores. */
export async function registrarEvento(
  evento: Evento,
  usuario: string | null | undefined,
  detalle = "",
  ip: string | null = null
): Promise<void> {
  try {
    await asegurarTabla();
    await sql`
      INSERT INTO auditoria (evento, usuario, detalle, ip)
      VALUES (${evento}, ${usuario?.slice(0, 100) ?? null}, ${detalle.slice(0, 500) || null}, ${ip})
    `;
    // Limpieza ocasional de lo más antiguo, para que la tabla no crezca sin fin.
    if (Math.random() < 0.01) {
      await sql.query(`DELETE FROM auditoria WHERE created_at < now() - ($1 || ' days')::interval`, [
        String(DIAS_AUDITORIA),
      ]);
    }
  } catch (e) {
    console.error("[auditoria] no se pudo registrar el evento", evento, e instanceof Error ? e.message : e);
  }
}

export type FilaAuditoria = {
  id: number;
  evento: Evento;
  usuario: string | null;
  detalle: string | null;
  ip: string | null;
  created_at: string;
};

/** Últimos eventos (más recientes primero). */
export async function ultimosEventos(limite = 200): Promise<FilaAuditoria[]> {
  await asegurarTabla();
  const filas = await sql`
    SELECT id, evento, usuario, detalle, ip, created_at
    FROM auditoria ORDER BY created_at DESC, id DESC
    LIMIT ${Math.min(Math.max(1, limite), 500)}
  `;
  return filas as FilaAuditoria[];
}
