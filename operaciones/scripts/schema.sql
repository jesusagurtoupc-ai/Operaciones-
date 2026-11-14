-- Esquema para el Sistema de Correctivos
-- Ejecuta este script una vez contra tu base de datos de Vercel Postgres (Neon)

CREATE TABLE IF NOT EXISTS correctivos (
  id             SERIAL PRIMARY KEY,
  refer          INTEGER,
  ticket         TEXT,
  f_reg          DATE,
  descripcion    TEXT NOT NULL,
  lugar          TEXT,
  estado         TEXT NOT NULL DEFAULT 'cotizar',
  proveedor      TEXT,
  monto          NUMERIC(12,2),
  f_coti         DATE,
  obs_cot        TEXT,
  f_ps           DATE,
  f_oc           DATE,
  f_inicio       DATE,
  f_fin          DATE,
  cuenta         TEXT,
  tipo_trab      TEXT,
  sub_tipo_trab  TEXT,
  evaluacion     TEXT,
  n_oc           TEXT,
  area           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_correctivos_estado ON correctivos (estado);
CREATE INDEX IF NOT EXISTS idx_correctivos_area ON correctivos (area);
CREATE INDEX IF NOT EXISTS idx_correctivos_tipo_trab ON correctivos (tipo_trab);
CREATE INDEX IF NOT EXISTS idx_correctivos_f_reg ON correctivos (f_reg);

-- Líneas de documentos del ticket (cotización, OC, informe, certificado).
ALTER TABLE correctivos ADD COLUMN IF NOT EXISTS documentos JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Condiciones leídas de la cotización (plazo, validez, garantía, forma de pago, partidas).
ALTER TABLE correctivos ADD COLUMN IF NOT EXISTS condiciones JSONB;

-- Datos que vienen de la OC: RUC del proveedor, fecha de entrega y contrato.
ALTER TABLE correctivos ADD COLUMN IF NOT EXISTS ruc_proveedor TEXT;
ALTER TABLE correctivos ADD COLUMN IF NOT EXISTS f_entrega DATE;
ALTER TABLE correctivos ADD COLUMN IF NOT EXISTS contrato TEXT;

-- Desde cuándo el ticket está en su estado actual, e historial de cambios.
ALTER TABLE correctivos ADD COLUMN IF NOT EXISTS estado_desde TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS historial (
  id            SERIAL PRIMARY KEY,
  correctivo_id INTEGER NOT NULL REFERENCES correctivos(id) ON DELETE CASCADE,
  usuario       TEXT,
  detalle       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_historial_correctivo ON historial (correctivo_id, created_at DESC);

-- Usuarios con rol (admin / lectura). El usuario inicial admin/admin se crea
-- solo la primera vez que la app lo necesita, no hace falta insertarlo aqui.
CREATE TABLE IF NOT EXISTS usuarios (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  rol           TEXT NOT NULL DEFAULT 'lectura' CHECK (rol IN ('admin', 'lectura')),
  activo        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Archivos adjuntos de cada ticket (se guardan en la propia base de datos).
CREATE TABLE IF NOT EXISTS archivos (
  id            SERIAL PRIMARY KEY,
  correctivo_id INTEGER NOT NULL REFERENCES correctivos(id) ON DELETE CASCADE,
  nombre        TEXT NOT NULL,
  tipo          TEXT NOT NULL,
  tamano        INTEGER NOT NULL,
  data          BYTEA NOT NULL,
  subido_por    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_archivos_correctivo ON archivos (correctivo_id);
-- Adjuntos en Vercel Blob (opcional): la base guarda dónde está el archivo y deja `data` vacío.
ALTER TABLE archivos ADD COLUMN IF NOT EXISTS blob_path TEXT;
ALTER TABLE archivos ADD COLUMN IF NOT EXISTS blob_url TEXT;
ALTER TABLE archivos ALTER COLUMN data DROP NOT NULL;

-- Papelera: eliminar marca el correctivo en vez de borrarlo, y se puede restaurar.
ALTER TABLE correctivos ADD COLUMN IF NOT EXISTS eliminado_en TIMESTAMPTZ;
ALTER TABLE correctivos ADD COLUMN IF NOT EXISTS eliminado_por TEXT;
CREATE INDEX IF NOT EXISTS idx_correctivos_eliminado ON correctivos (eliminado_en) WHERE eliminado_en IS NOT NULL;

-- Ref y ticket únicos entre los correctivos NO eliminados (el ticket sin distinguir mayúsculas ni espacios).
DROP INDEX IF EXISTS uq_correctivos_refer;
DROP INDEX IF EXISTS uq_correctivos_ticket_ci;
CREATE UNIQUE INDEX IF NOT EXISTS uq_correctivos_refer_activos ON correctivos (refer) WHERE refer IS NOT NULL AND eliminado_en IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_correctivos_ticket_activos ON correctivos (LOWER(BTRIM(ticket))) WHERE ticket IS NOT NULL AND BTRIM(ticket) <> '' AND eliminado_en IS NULL;

-- Una OC (N° de OC) solo puede estar en un correctivo NO eliminado (sin distinguir mayúsculas ni espacios).
-- Si ya hay OC repetidas este índice falla: corrige los duplicados y vuelve a ejecutar esta línea.
CREATE UNIQUE INDEX IF NOT EXISTS uq_correctivos_n_oc_activos ON correctivos (LOWER(BTRIM(n_oc))) WHERE n_oc IS NOT NULL AND BTRIM(n_oc) <> '' AND eliminado_en IS NULL;

-- Orden por defecto de la lista (N° Ref de mayor a menor): la base entrega las primeras filas ya ordenadas.
CREATE INDEX IF NOT EXISTS idx_correctivos_orden_ref ON correctivos (refer DESC NULLS LAST, id DESC);

-- Contadores del límite de intentos de login (compartidos entre instancias).
CREATE TABLE IF NOT EXISTS login_intentos (
  clave  TEXT PRIMARY KEY,
  fallos INTEGER NOT NULL,
  desde  TIMESTAMPTZ NOT NULL
);

-- Momento desde el cual valen las sesiones de cada usuario: al cambiar su contraseña se actualiza
-- y los tokens emitidos antes dejan de valer.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sesiones_desde TIMESTAMPTZ;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS paginas TEXT[];

-- Borrador de la solicitud de materiales de cada usuario (también se crea sola la primera vez).
CREATE TABLE IF NOT EXISTS materiales_borradores (
  username TEXT PRIMARY KEY,
  lineas   JSONB NOT NULL DEFAULT '[]'::jsonb,
  t        BIGINT NOT NULL DEFAULT 0
);

-- Registro de actividad de seguridad (inicios de sesión, intentos fallidos, cambios de usuarios).
-- La app la crea sola la primera vez; se conservan 180 días.
CREATE TABLE IF NOT EXISTS auditoria (
  id         BIGSERIAL PRIMARY KEY,
  evento     TEXT NOT NULL,
  usuario    TEXT,
  detalle    TEXT,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auditoria_fecha ON auditoria (created_at DESC);

-- Sesiones cerradas con "Cerrar sesión": su token deja de valer en el servidor (la app la crea sola).
CREATE TABLE IF NOT EXISTS sesiones_cerradas (
  jti      TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  expira   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sesiones_cerradas_usuario ON sesiones_cerradas (username, expira);

-- Qué cotización (proveedor + N°) creó cada ticket: impide que la misma cotización cree dos tickets.
CREATE TABLE IF NOT EXISTS cotizaciones_tickets (
  clave         TEXT PRIMARY KEY,
  correctivo_id INTEGER NOT NULL REFERENCES correctivos(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_tickets_correctivo ON cotizaciones_tickets (correctivo_id);

-- N° Ref más alto de un ticket ya eliminado para siempre: nunca se reutiliza.
CREATE TABLE IF NOT EXISTS refer_tope (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  valor INTEGER NOT NULL
);

-- Registro único de proveedores: un nombre oficial por empresa (por RUC o por nombre comparable).
CREATE TABLE IF NOT EXISTS proveedores (
  id        SERIAL PRIMARY KEY,
  nombre    TEXT NOT NULL,
  ruc       TEXT UNIQUE,
  claves    TEXT[] NOT NULL DEFAULT '{}',
  alias     TEXT[] NOT NULL DEFAULT '{}',
  otros_ruc TEXT[] NOT NULL DEFAULT '{}',
  fuente    TEXT,          -- 'oc' | 'manual' | 'revisado' | NULL (sin revisar)
  oc_ref    TEXT,          -- N° de la última OC de la que se tomaron sus datos
  actualizado_oc TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proveedores_claves ON proveedores USING GIN (claves);
CREATE INDEX IF NOT EXISTS idx_proveedores_nombre ON proveedores (nombre);
CREATE INDEX IF NOT EXISTS idx_correctivos_proveedor ON correctivos (proveedor);

-- Fotos de los materiales fuera del catálogo (clave = "libre:<descripción normalizada>").
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
);
CREATE INDEX IF NOT EXISTS idx_materiales_fotos_clave ON materiales_fotos (clave);

-- Contador del N° de solicitud de materiales (SI-<año>-<n>); la tabla también se crea sola.
CREATE TABLE IF NOT EXISTS solicitudes_numeracion (
  anio   INTEGER PRIMARY KEY,
  ultimo INTEGER NOT NULL
);
