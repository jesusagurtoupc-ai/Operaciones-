import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import { BCRYPT_COSTO, MIN_PASSWORD } from "@/lib/shared/passwords";
import { esValorDeEjemplo, nombreAdminInicial } from "@/lib/server/secretos";

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
 * Comprueba que la base esté migrada (las tablas y columnas las crea
 * `npm run db:migrate`, ya no la app al arrancar) y deja el usuario
 * inicial admin la primera vez que la tabla de usuarios está vacía.
 * Se ejecuta una vez por instancia del servidor.
 */
let schemaPromise: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const estado = (await sql`
        SELECT
          (SELECT COUNT(*) FROM information_schema.tables
            WHERE table_schema = current_schema()
              AND table_name IN ('correctivos', 'usuarios', 'archivos', 'historial', 'intentos_login', 'auditoria_usuarios', 'auditoria_accesos', 'sesiones_revocadas'))::int AS tablas,
          (SELECT COUNT(*) FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND ((table_name = 'correctivos' AND column_name IN ('documentos', 'estado_desde', 'eliminado_en', 'eliminado_por'))
                OR (table_name = 'usuarios' AND column_name IN ('sesion_version', 'debe_cambiar_clave', 'mfa_secreto', 'mfa_activo', 'mfa_ultimo_paso', 'mfa_respaldo'))))::int AS columnas
      `)[0] as { tablas: number; columnas: number };
      if (estado.tablas < 8 || estado.columnas < 10) {
        throw new Error(
          "La base de datos no está al día. Ejecuta `npm run db:migrate` (o pega scripts/schema.sql en el SQL Editor de Neon) y vuelve a intentar."
        );
      }
      const existentes = await sql`SELECT 1 FROM usuarios LIMIT 1`;
      if (existentes.length === 0) {
        // Sin usuarios todavía: se crea el admin inicial. En producción NO se
        // permite la contraseña por defecto "admin": hay que definirla.
        const inicial = process.env.INITIAL_ADMIN_PASSWORD;
        if (
          process.env.NODE_ENV === "production" &&
          (!inicial || inicial.length < MIN_PASSWORD || esValorDeEjemplo(inicial))
        ) {
          throw new Error(
            `Define INITIAL_ADMIN_PASSWORD (mínimo ${MIN_PASSWORD} caracteres, no un valor de ejemplo) antes del primer ingreso en producción.`
          );
        }
        const hash = await bcrypt.hash(inicial || "admin", BCRYPT_COSTO);
        // La clave inicial es temporal: el sistema obliga a cambiarla en el primer ingreso.
        await sql`
          INSERT INTO usuarios (username, password_hash, rol, debe_cambiar_clave)
          VALUES (${nombreAdminInicial(process.env.INITIAL_ADMIN_USER)}, ${hash}, 'admin', true)
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
