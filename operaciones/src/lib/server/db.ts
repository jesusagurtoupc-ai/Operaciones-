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
              AND table_name IN ('sesiones_cerradas','cotizaciones_tickets','refer_tope','proveedores','materiales_fotos','solicitudes_materiales','catalogo_materiales','inventario_equipos',
                                 'inventario_bitacora','inventario_kpi_mensual','inventario_config','equipo_correctivos','gestion_registros')) = 13
          AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
                       AND table_name = 'correctivos' AND column_name = 'condiciones')
          AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
                       AND table_name = 'archivos' AND column_name = 'blob_url')
          AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
                       AND table_name = 'proveedores' AND column_name = 'fuente')
          AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema()
                       AND indexname = 'uq_correctivos_refer_campus')
          AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema()
                       AND table_name = 'ajustes') AS extras
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
 *  - archivos.blob_path / blob_url: el adjunto está en Vercel Blob (y `data` queda vacío).
 */
async function crearTablasExtra(): Promise<void> {
  await sql`ALTER TABLE correctivos ADD COLUMN IF NOT EXISTS condiciones JSONB`;
  // Adjuntos en Vercel Blob (ver almacen.ts): la base guarda dónde está y deja `data` vacío.
  await sql`ALTER TABLE archivos ADD COLUMN IF NOT EXISTS blob_path TEXT`;
  await sql`ALTER TABLE archivos ADD COLUMN IF NOT EXISTS blob_url TEXT`;
  await sql`ALTER TABLE archivos ALTER COLUMN data DROP NOT NULL`;
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
  // El N° Ref más alto que tuvo un ticket ya eliminado para siempre (ver purgarPapelera).
  // Contador del N° de solicitud de materiales (SI-<año>-<n>); también lo crea la ruta del borrador.
  await sql`CREATE TABLE IF NOT EXISTS solicitudes_numeracion (anio INTEGER PRIMARY KEY, ultimo INTEGER NOT NULL)`;
  // Catálogo de materiales cargado desde la app (ver /api/materiales/catalogo); se guardan los 5 últimos.
  await sql`
    CREATE TABLE IF NOT EXISTS catalogo_materiales (
      id         SERIAL PRIMARY KEY,
      titulo     TEXT NOT NULL,
      items      INTEGER NOT NULL,
      vence      DATE,
      datos      TEXT NOT NULL,
      subido_por TEXT,
      subido_en  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Inventario de equipos guardado desde la página Inventario (ver /api/inventario); se guardan los 5 últimos.
  await sql`
    CREATE TABLE IF NOT EXISTS inventario_equipos (
      id         SERIAL PRIMARY KEY,
      datos      JSONB NOT NULL,
      equipos    INTEGER NOT NULL,
      motivo     TEXT,
      version    INTEGER NOT NULL DEFAULT 0,
      subido_por TEXT,
      subido_en  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Inventario: bitácora de cada equipo (cambios de estado, mantenimientos, verificaciones en campo).
  await sql`
    CREATE TABLE IF NOT EXISTS inventario_bitacora (
      id        SERIAL PRIMARY KEY,
      codigo    TEXT NOT NULL,
      tipo      TEXT NOT NULL,
      detalle   JSONB NOT NULL DEFAULT '{}'::jsonb,
      usuario   TEXT,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_inventario_bitacora_codigo ON inventario_bitacora (codigo, creado_en DESC)`;
  // Foto mensual de los KPI del inventario (evolución en el tiempo).
  await sql`
    CREATE TABLE IF NOT EXISTS inventario_kpi_mensual (
      mes        TEXT PRIMARY KEY,
      datos      JSONB NOT NULL,
      actualizado TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Configuración compartida del inventario: precios de referencia, presupuesto anual, frecuencias.
  await sql`CREATE TABLE IF NOT EXISTS inventario_config (clave TEXT PRIMARY KEY, valor JSONB NOT NULL, usuario TEXT, actualizado TIMESTAMPTZ NOT NULL DEFAULT now())`;
  // Ticket enlazado al equipo exacto del inventario (un equipo por ticket).
  await sql`
    CREATE TABLE IF NOT EXISTS equipo_correctivos (
      correctivo_id INTEGER PRIMARY KEY REFERENCES correctivos(id) ON DELETE CASCADE,
      codigo        TEXT NOT NULL,
      usuario       TEXT,
      creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_equipo_correctivos_codigo ON equipo_correctivos (codigo)`;
  // Páginas de Gestión (ver /api/gestion/[modulo]): ajustes de garantía, contratistas, permisos de trabajo,
  // presupuesto, preventivos contratados, reportes por QR y notas del informe mensual. `clave` identifica
  // el registro único de cada tipo (el ticket, la cuenta del año, el proveedor, el mes); null = varios.
  await sql`
    CREATE TABLE IF NOT EXISTS gestion_registros (
      id             SERIAL PRIMARY KEY,
      tipo           TEXT NOT NULL,
      campus         TEXT NOT NULL DEFAULT 'principal',
      clave          TEXT,
      datos          JSONB NOT NULL DEFAULT '{}'::jsonb,
      usuario        TEXT,
      creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
      actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_gestion_registros_tipo ON gestion_registros (tipo, creado_en DESC)`;
  // Historial de solicitudes de materiales (ver /api/materiales/solicitudes).
  await sql`
    CREATE TABLE IF NOT EXISTS solicitudes_materiales (
      id             SERIAL PRIMARY KEY,
      numero         TEXT NOT NULL UNIQUE,
      username       TEXT NOT NULL,
      estado         TEXT NOT NULL DEFAULT 'Enviada',
      lineas         JSONB NOT NULL DEFAULT '[]'::jsonb,
      n_materiales   INTEGER NOT NULL DEFAULT 0,
      total_sin_igv  NUMERIC(14,2) NOT NULL DEFAULT 0,
      tickets        TEXT NOT NULL DEFAULT '',
      creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
      actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
      estado_por     TEXT,
      estado_en      TIMESTAMPTZ
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_solicitudes_materiales_creado ON solicitudes_materiales (creado_en DESC)`;
  // Fotos de los materiales fuera del catálogo (ver /api/materiales/fotos). `clave` es la del material
  // ("libre:<descripción normalizada>"), la misma que usan los favoritos.
  await sql`
    CREATE TABLE IF NOT EXISTS materiales_fotos (
      id         SERIAL PRIMARY KEY,
      clave      TEXT NOT NULL,
      nombre     TEXT NOT NULL,
      tipo       TEXT NOT NULL,
      tamano     INTEGER NOT NULL,
      data       BYTEA,
      blob_path  TEXT,
      blob_url   TEXT,
      subido_por TEXT,
      creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_materiales_fotos_clave ON materiales_fotos (clave)`;
  // Registro único de proveedores (ver lib/server/proveedores.ts).
  await sql`
    CREATE TABLE IF NOT EXISTS proveedores (
      id        SERIAL PRIMARY KEY,
      nombre    TEXT NOT NULL,
      ruc       TEXT UNIQUE,
      claves    TEXT[] NOT NULL DEFAULT '{}',
      alias     TEXT[] NOT NULL DEFAULT '{}',
      otros_ruc TEXT[] NOT NULL DEFAULT '{}',
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // De dónde salió el nombre oficial: 'oc' (de una orden de compra), 'manual' (fijado por un admin),
  // 'revisado' (se buscó una OC guardada y no había) o vacío (aún sin revisar). Ver proveedores.ts.
  await sql`ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS otros_ruc TEXT[] NOT NULL DEFAULT '{}'`;
  await sql`ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS fuente TEXT`;
  await sql`ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS oc_ref TEXT`;
  await sql`ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS actualizado_oc TIMESTAMPTZ`;
  await sql`CREATE INDEX IF NOT EXISTS idx_proveedores_claves ON proveedores USING GIN (claves)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_proveedores_nombre ON proveedores (nombre)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_correctivos_proveedor ON correctivos (proveedor)`;
  await sql`
    CREATE TABLE IF NOT EXISTS refer_tope (
      id    INTEGER PRIMARY KEY CHECK (id = 1),
      valor INTEGER NOT NULL
    )
  `;
  await separarPorCampus();
  await prepararDolares();
}

/**
 * Montos en dólares: el ticket guarda la moneda, el monto en dólares y el tipo de cambio; `monto` sigue
 * siendo en soles (el equivalente), así que paneles, presupuesto e informes no cambian. `ajustes` guarda
 * valores generales, como el último tipo de cambio usado (referencia para las OC sin tipo de cambio).
 */
async function prepararDolares(): Promise<void> {
  await sql`ALTER TABLE correctivos ADD COLUMN IF NOT EXISTS moneda TEXT NOT NULL DEFAULT 'PEN'`;
  await sql`ALTER TABLE correctivos ADD COLUMN IF NOT EXISTS monto_usd NUMERIC(14,2)`;
  await sql`ALTER TABLE correctivos ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(10,4)`;
  await sql`
    CREATE TABLE IF NOT EXISTS ajustes (
      clave          TEXT PRIMARY KEY,
      valor          JSONB NOT NULL,
      usuario        TEXT,
      actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

/**
 * Datos separados por campus (ver CAMPUS en lib/shared.ts). Todo lo que ya existía queda en el campus
 * "principal"; los usuarios administradores pasan a ver todos los campus ("*") y los de solo lectura,
 * el principal. Se puede repetir sin efecto: solo agrega lo que falta.
 *  - El N° Refer. se numera por campus: el índice único pasa a ser (campus, refer) y refer_tope tiene
 *    una fila por campus. La OC y el N° de ticket siguen siendo únicos en todos los campus (una OC no
 *    puede pagarse dos veces).
 *  - Indicadores mensuales y configuración del inventario: una fila por campus.
 */
async function separarPorCampus(): Promise<void> {
  for (const t of ["correctivos", "solicitudes_materiales", "inventario_equipos", "inventario_bitacora", "gestion_registros", "inventario_kpi_mensual", "inventario_config", "refer_tope"]) {
    await sql.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS campus TEXT NOT NULL DEFAULT 'principal'`);
  }
  await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS campus TEXT`;
  await sql`UPDATE usuarios SET campus = CASE WHEN rol = 'admin' THEN '*' ELSE 'principal' END WHERE campus IS NULL`;
  await sql`ALTER TABLE usuarios ALTER COLUMN campus SET DEFAULT 'principal'`;
  // Claves que eran únicas en toda la base pasan a serlo dentro de cada campus.
  await sql`ALTER TABLE inventario_kpi_mensual DROP CONSTRAINT IF EXISTS inventario_kpi_mensual_pkey`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_inventario_kpi_campus ON inventario_kpi_mensual (campus, mes)`;
  await sql`ALTER TABLE inventario_config DROP CONSTRAINT IF EXISTS inventario_config_pkey`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_inventario_config_campus ON inventario_config (campus, clave)`;
  await sql`ALTER TABLE refer_tope DROP CONSTRAINT IF EXISTS refer_tope_pkey`;
  await sql`ALTER TABLE refer_tope DROP CONSTRAINT IF EXISTS refer_tope_id_check`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_refer_tope_campus ON refer_tope (campus)`;
  await sql`DROP INDEX IF EXISTS uq_gestion_registros_clave`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_gestion_registros_campus ON gestion_registros (campus, tipo, clave) WHERE clave IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_inventario_equipos_campus ON inventario_equipos (campus, id DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_correctivos_campus ON correctivos (campus)`;
  await sql`DROP INDEX IF EXISTS uq_correctivos_refer_activos`;
  try {
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_correctivos_refer_campus ON correctivos (campus, refer) WHERE refer IS NOT NULL AND eliminado_en IS NULL`;
  } catch (e) {
    console.warn("No se pudo crear uq_correctivos_refer_campus (¿N° Refer. repetidos?)", e instanceof Error ? e.message : e);
  }
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
      await sql`ALTER TABLE correctivos ADD COLUMN IF NOT EXISTS campus TEXT NOT NULL DEFAULT 'principal'`;
      for (const [nombre, ddl] of [
        // El N° Refer. se numera por campus (ver separarPorCampus).
        ["uq_correctivos_refer_campus",
          "CREATE UNIQUE INDEX IF NOT EXISTS uq_correctivos_refer_campus ON correctivos (campus, refer) WHERE refer IS NOT NULL AND eliminado_en IS NULL"],
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
          INSERT INTO usuarios (username, password_hash, rol, campus)
          VALUES ('admin', ${hash}, 'admin', '*')
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
    // Una sola consulta: borra los tickets vencidos y, en la misma foto de la base, devuelve qué
    // adjuntos suyos estaban en Blob. Antes eran dos pasos: si alguien restauraba un ticket justo entre
    // los dos, sus archivos se borraban de Blob aunque el ticket siguiera vivo.
    const borrados = (await sql.query(
      `WITH b AS (
         DELETE FROM correctivos
         WHERE eliminado_en IS NOT NULL AND eliminado_en < now() - ($1 || ' days')::interval
         RETURNING id, refer, campus
       ),
       tope AS (
         -- Recuerda el N° Ref más alto que se borró (en cada campus): así nunca se vuelve a dar a un ticket
         -- nuevo (los PDFs y nombres de carpeta con "Ref N" seguirían apuntando al ticket borrado).
         INSERT INTO refer_tope (id, campus, valor)
         SELECT 1, campus, MAX(refer) FROM b WHERE refer IS NOT NULL GROUP BY campus
         ON CONFLICT (campus) DO UPDATE SET valor = GREATEST(refer_tope.valor, EXCLUDED.valor)
         RETURNING 1
       )
       SELECT b.id, a.blob_url
       FROM b LEFT JOIN archivos a ON a.correctivo_id = b.id AND a.blob_url IS NOT NULL`,
      [String(DIAS_PAPELERA)]
    )) as { id: number; blob_url: string | null }[];
    const urls = borrados.map((x) => x.blob_url).filter((u): u is string => !!u);
    if (urls.length > 0) {
      const { borrarDeBlob } = await import("./almacen");
      await borrarDeBlob(urls);
    }
    const nTickets = new Set(borrados.map((x) => x.id)).size;
    if (nTickets > 0) {
      console.log(`[papelera] ${nTickets} correctivo(s) eliminados definitivamente (más de ${DIAS_PAPELERA} días en la papelera).`);
    }
  } catch (e) {
    gPap.__correctivosPurgaPapelera = 0; // reintenta en la próxima carga
    console.warn("[papelera] no se pudo vaciar la papelera:", e instanceof Error ? e.message : e);
  }
}
