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

/**
 * Comprobación rápida (una sola vuelta a la base): ¿ya está todo el esquema al día? Si es así, se
 * omiten las ~15 sentencias DDL de `aplicarEsquema`, que antes corrían en CADA arranque en frío de
 * cada instancia (proxy y cada ruta de la API) y eran la mayor parte del retraso del primer acceso.
 * Los índices únicos de Ref/ticket no se exigen aquí: si la base trae duplicados no se pueden crear
 * y, de exigirlos, el esquema completo se reaplicaría en cada arranque.
 */
async function esquemaAlDia(): Promise<{ alDia: boolean; indiceOc: boolean; indiceOrden: boolean; extras: boolean }> {
  try {
    const [chk, usuarios] = await Promise.all([
      sql`
        SELECT
          (SELECT COUNT(*) FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND ((table_name = 'correctivos' AND column_name IN ('documentos','estado_desde','eliminado_en','eliminado_por',
                                                                        'ruc_proveedor','f_entrega','contrato'))
                OR (table_name = 'usuarios' AND column_name IN ('sesiones_desde','paginas')))) = 9
          AND (SELECT COUNT(*) FROM information_schema.tables
                WHERE table_schema = current_schema()
                  AND table_name IN ('usuarios','archivos','historial','login_intentos')) = 4
          AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema()
                           AND indexname IN ('uq_correctivos_refer','uq_correctivos_ticket_ci'))
          AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema()
                       AND indexname IN ('idx_correctivos_eliminado','idx_historial_correctivo','idx_archivos_correctivo')
                     HAVING COUNT(*) = 3) AS ok,
          EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema()
                   AND indexname = 'uq_correctivos_n_oc_activos') AS oc,
          EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema()
                   AND indexname = 'idx_correctivos_orden_ref') AS orden,
          (SELECT COUNT(*) FROM information_schema.tables
            WHERE table_schema = current_schema()
              AND table_name IN ('sesiones_cerradas','cotizaciones_tickets')) = 2
          AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
                       AND table_name = 'correctivos' AND column_name = 'condiciones') AS extras
      `,
      sql`SELECT 1 FROM usuarios LIMIT 1`.catch(() => []),
    ]);
    return {
      alDia: chk[0]?.ok === true && (usuarios as unknown[]).length > 0,
      indiceOc: chk[0]?.oc === true,
      indiceOrden: chk[0]?.orden === true,
      extras: chk[0]?.extras === true,
    };
  } catch (e) {
    console.warn("No se pudo comprobar el esquema; se aplicará completo.", e instanceof Error ? e.message : e);
    return { alDia: false, indiceOc: false, indiceOrden: false, extras: false };
  }
}

/**
 * Tablas agregadas después (no pueden fallar por datos existentes: son nuevas):
 *  - sesiones_cerradas: sesiones cerradas con "Cerrar sesión". Su token deja de valer en el servidor
 *    aunque alguien hubiera copiado la cookie. Se guarda hasta que el token vencería (7 días).
 *  - cotizaciones_tickets: qué cotización (proveedor + N°) creó cada ticket. Su clave única impide
 *    que la misma cotización cree dos tickets, incluso si se sube dos veces al mismo tiempo.
 *  - correctivos.condiciones: condiciones leídas de la cotización (plazo, validez, garantía, pago, partidas).
 */
async function crearTablasExtra(): Promise<void> {
  await sql`ALTER TABLE correctivos ADD COLUMN IF NOT EXISTS condiciones JSONB`;
  await sql`
    CREATE TABLE IF NOT EXISTS sesiones_cerradas (
      jti      TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      expira   TIMESTAMPTZ NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_sesiones_cerradas_usuario ON sesiones_cerradas (username, expira)`;
  await sql`
    CREATE TABLE IF NOT EXISTS cotizaciones_tickets (
      clave         TEXT PRIMARY KEY,
      correctivo_id INTEGER NOT NULL REFERENCES correctivos(id) ON DELETE CASCADE
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_cotizaciones_tickets_correctivo ON cotizaciones_tickets (correctivo_id)`;
}

// Una OC solo puede estar en un correctivo activo (sin distinguir mayúsculas ni espacios).
const DDL_INDICE_OC =
  "CREATE UNIQUE INDEX IF NOT EXISTS uq_correctivos_n_oc_activos ON correctivos (LOWER(BTRIM(n_oc))) " +
  "WHERE n_oc IS NOT NULL AND BTRIM(n_oc) <> '' AND eliminado_en IS NULL";

// Orden por defecto de la lista (N° Ref de mayor a menor): con este índice la base entrega las primeras filas
// ya ordenadas, en vez de calcular el orden de TODOS los tickets en cada consulta (con 20 000 tickets bajó de
// ~80 ms a ~1 ms). Es un índice normal: no restringe datos y no puede fallar por duplicados.
const DDL_INDICE_ORDEN =
  "CREATE INDEX IF NOT EXISTS idx_correctivos_orden_ref ON correctivos (refer DESC NULLS LAST, id DESC)";

async function crearIndiceOrden(): Promise<void> {
  try {
    await sql.query(DDL_INDICE_ORDEN);
  } catch (e) {
    console.warn("No se pudo crear el índice de orden de la lista.", e instanceof Error ? e.message : e);
  }
}

/**
 * Crea el índice único de OC. Si la base ya trae OC repetidas no se puede crear: se avisa en el log
 * y la app sigue funcionando (las altas y cambios nuevos igual se validan en las rutas).
 */
async function crearIndiceOc(): Promise<void> {
  try {
    await sql.query(DDL_INDICE_OC);
  } catch (e) {
    console.warn(
      "No se pudo crear el índice único uq_correctivos_n_oc_activos (¿hay OC repetidas en la base?). " +
        "Corrige los duplicados y reinicia para activarlo.",
      e instanceof Error ? e.message : e
    );
  }
}

export function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const estado = await esquemaAlDia();
      if (!estado.alDia) {
        await aplicarEsquema();
        return;
      }
      // Bases que ya estaban al día pero aún no tienen el índice de OC: solo se crea ese.
      if (!estado.indiceOc) await crearIndiceOc();
      if (!estado.indiceOrden) await crearIndiceOrden();
      if (!estado.extras) await crearTablasExtra();
    })().catch((err) => {
      schemaPromise = null; // permite reintentar en la próxima petición
      throw err;
    });
  }
  return schemaPromise;
}

async function aplicarEsquema(): Promise<void> {
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
      // Líneas de documentos del ticket (visita técnica, cotización, OC, informe, certificado).
      await sql`
        ALTER TABLE correctivos
        ADD COLUMN IF NOT EXISTS documentos JSONB NOT NULL DEFAULT '{}'::jsonb
      `;
      // Desde cuándo está el ticket en su estado actual (para detectar atrasos).
      await sql`
        ALTER TABLE correctivos ADD COLUMN IF NOT EXISTS estado_desde TIMESTAMPTZ
      `;
      // Datos que vienen de la OC: RUC del proveedor, fecha de entrega y contrato.
      await sql`ALTER TABLE correctivos ADD COLUMN IF NOT EXISTS ruc_proveedor TEXT`;
      await sql`ALTER TABLE correctivos ADD COLUMN IF NOT EXISTS f_entrega DATE`;
      await sql`ALTER TABLE correctivos ADD COLUMN IF NOT EXISTS contrato TEXT`;
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

      // Momento desde el cual valen las sesiones de cada usuario: al cambiar su contraseña se
      // actualiza, y los tokens emitidos antes (con `iat` anterior) dejan de valer. Antes una
      // sesión duraba 7 días aunque se cambiara la clave.
      await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sesiones_desde TIMESTAMPTZ`;
      // Páginas a las que puede entrar el usuario (null = todas).
      await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS paginas TEXT[]`;

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
      // Papelera: eliminar un correctivo ya no lo borra; lo marca con la fecha y quién lo hizo, y
      // se puede restaurar. Los índices únicos de abajo solo miran los NO eliminados, para que un
      // Ref o ticket de un correctivo en la papelera pueda volver a usarse.
      await sql`ALTER TABLE correctivos ADD COLUMN IF NOT EXISTS eliminado_en TIMESTAMPTZ`;
      await sql`ALTER TABLE correctivos ADD COLUMN IF NOT EXISTS eliminado_por TEXT`;
      await sql`DROP INDEX IF EXISTS uq_correctivos_refer`;
      await sql`DROP INDEX IF EXISTS uq_correctivos_ticket_ci`;
      await sql`CREATE INDEX IF NOT EXISTS idx_correctivos_eliminado ON correctivos (eliminado_en) WHERE eliminado_en IS NOT NULL`;
      for (const [nombre, ddl] of [
        ["uq_correctivos_refer_activos",
          "CREATE UNIQUE INDEX IF NOT EXISTS uq_correctivos_refer_activos ON correctivos (refer) WHERE refer IS NOT NULL AND eliminado_en IS NULL"],
        ["uq_correctivos_ticket_activos",
          "CREATE UNIQUE INDEX IF NOT EXISTS uq_correctivos_ticket_activos ON correctivos (LOWER(BTRIM(ticket))) WHERE ticket IS NOT NULL AND BTRIM(ticket) <> '' AND eliminado_en IS NULL"],
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
      await crearIndiceOc();
      await crearIndiceOrden();
      await crearTablasExtra();
      const existentes = await sql`SELECT 1 FROM usuarios LIMIT 1`;
      if (existentes.length === 0) {
        // En producción no se crea un administrador con la clave "admin": cualquiera que conozca la
        // dirección podría entrar antes que tú. Hay que definir INITIAL_ADMIN_PASSWORD (8+ caracteres).
        const inicial = process.env.INITIAL_ADMIN_PASSWORD ?? "";
        if (process.env.NODE_ENV === "production" && inicial.length < 8) {
          console.error(
            "No se creó el usuario admin: define INITIAL_ADMIN_PASSWORD (mínimo 8 caracteres) en Vercel y vuelve a desplegar."
          );
          return;
        }
        const hash = await bcrypt.hash(inicial || "admin", 10);
        await sql`
          INSERT INTO usuarios (username, password_hash, rol)
          VALUES ('admin', ${hash}, 'admin')
          ON CONFLICT (username) DO NOTHING
        `;
      }
}

// ───── Vaciado automático de la papelera ─────
// Los correctivos eliminados se conservan DIAS_PAPELERA días; pasado ese plazo se borran
// definitivamente (sus archivos e historial caen en cascada). Se ejecuta al cargar la lista,
// como mucho una vez por hora por instancia, y nunca interrumpe la carga si falla.
export const DIAS_PAPELERA = 30;
const UNA_HORA_MS = 60 * 60 * 1000;
const gPap = globalThis as typeof globalThis & { __correctivosPurgaPapelera?: number };

export async function purgarPapelera(): Promise<void> {
  const ahora = Date.now();
  if (gPap.__correctivosPurgaPapelera && ahora - gPap.__correctivosPurgaPapelera < UNA_HORA_MS) return;
  gPap.__correctivosPurgaPapelera = ahora;
  try {
    const borrados = await sql.query(
      `DELETE FROM correctivos
       WHERE eliminado_en IS NOT NULL AND eliminado_en < now() - ($1 || ' days')::interval
       RETURNING id`,
      [String(DIAS_PAPELERA)]
    );
    if ((borrados as unknown[]).length > 0) {
      console.log(`[papelera] ${(borrados as unknown[]).length} correctivo(s) eliminados definitivamente (más de ${DIAS_PAPELERA} días en la papelera).`);
    }
  } catch (e) {
    gPap.__correctivosPurgaPapelera = 0; // reintenta en la próxima carga
    console.warn("[papelera] no se pudo vaciar la papelera:", e instanceof Error ? e.message : e);
  }
}
