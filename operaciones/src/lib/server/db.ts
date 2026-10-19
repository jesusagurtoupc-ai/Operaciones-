import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";

// La variable DATABASE_URL la provee automáticamente la integración de
// Vercel Postgres / Neon cuando conectas la base de datos a tu proyecto
// en Vercel. En local, defínela en .env.local
if (!process.env.DATABASE_URL) {
  throw new Error(
    "Falta la variable de entorno DATABASE_URL. Configúrala en .env.local o en Vercel (Storage → conectar la base de datos)."
  );
}

export const sql = neon(process.env.DATABASE_URL);

/**
 * Crea (si no existen) las tablas `usuarios` y `archivos`, y deja el
 * usuario inicial admin/admin la primera vez que la tabla está vacía.
 * Se ejecuta sola, una vez por instancia del servidor, así que no hace
 * falta correr ninguna migración a mano después de desplegar.
 */
let schemaPromise: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS usuarios (
          id            SERIAL PRIMARY KEY,
          username      TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          rol           TEXT NOT NULL DEFAULT 'lectura' CHECK (rol IN ('admin', 'lectura')),
          activo        BOOLEAN NOT NULL DEFAULT true,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS archivos (
          id           SERIAL PRIMARY KEY,
          correctivo_id INTEGER NOT NULL REFERENCES correctivos(id) ON DELETE CASCADE,
          nombre       TEXT NOT NULL,
          tipo         TEXT NOT NULL,
          tamano       INTEGER NOT NULL,
          data         BYTEA NOT NULL,
          subido_por   TEXT,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_archivos_correctivo ON archivos (correctivo_id)
      `;
      // Líneas de documentos del ticket (cotización, OC, informe, certificado).
      await sql`
        ALTER TABLE correctivos
        ADD COLUMN IF NOT EXISTS documentos JSONB NOT NULL DEFAULT '{}'::jsonb
      `;
      // Desde cuándo está el ticket en su estado actual (para detectar atrasos).
      await sql`
        ALTER TABLE correctivos ADD COLUMN IF NOT EXISTS estado_desde TIMESTAMPTZ
      `;
      // Historial de cambios de cada ticket.
      await sql`
        CREATE TABLE IF NOT EXISTS historial (
          id            SERIAL PRIMARY KEY,
          correctivo_id INTEGER NOT NULL REFERENCES correctivos(id) ON DELETE CASCADE,
          usuario       TEXT,
          detalle       TEXT NOT NULL,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_historial_correctivo ON historial (correctivo_id, created_at DESC)
      `;

      // Contadores del límite de intentos de login (compartidos entre instancias).
      await sql`
        CREATE TABLE IF NOT EXISTS login_intentos (
          clave  TEXT PRIMARY KEY,
          fallos INTEGER NOT NULL,
          desde  TIMESTAMPTZ NOT NULL
        )
      `;

      // Ref y ticket no se pueden repetir. Los índices únicos son lo que de verdad lo
      // garantiza (antes, dos altas simultáneas podían recibir el mismo Ref, y el
      // ticket se podía repetir sin aviso). Si la base ya trae duplicados antiguos el
      // índice no se puede crear: se avisa en el log y la app sigue funcionando.
      for (const [nombre, ddl] of [
        ["uq_correctivos_refer",
          "CREATE UNIQUE INDEX IF NOT EXISTS uq_correctivos_refer ON correctivos (refer) WHERE refer IS NOT NULL"],
        ["uq_correctivos_ticket_ci",
          "CREATE UNIQUE INDEX IF NOT EXISTS uq_correctivos_ticket_ci ON correctivos (LOWER(BTRIM(ticket))) WHERE ticket IS NOT NULL AND BTRIM(ticket) <> ''"],
      ]) {
        try {
          await sql.query(ddl);
        } catch (e) {
          console.warn(
            `No se pudo crear el índice único ${nombre} (¿hay valores repetidos en la base?). ` +
              "Corrige los duplicados y reinicia para activarlo.",
            e instanceof Error ? e.message : e
          );
        }
      }
      const existentes = await sql`SELECT 1 FROM usuarios LIMIT 1`;
      if (existentes.length === 0) {
        const hash = await bcrypt.hash(process.env.INITIAL_ADMIN_PASSWORD || "admin", 10);
        await sql`
          INSERT INTO usuarios (username, password_hash, rol)
          VALUES ('admin', ${hash}, 'admin')
          ON CONFLICT (username) DO NOTHING
        `;
      }
    })().catch((err) => {
      schemaPromise = null; // permite reintentar en la próxima petición
      throw err;
    });
  }
  return schemaPromise;
}
