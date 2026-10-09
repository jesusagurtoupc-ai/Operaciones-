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
