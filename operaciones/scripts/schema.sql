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

-- Borrado lógico: un ticket eliminado queda oculto pero conserva archivos e historial.
-- Para restaurarlo: UPDATE correctivos SET eliminado_en = NULL, eliminado_por = NULL WHERE id = 123
ALTER TABLE correctivos ADD COLUMN IF NOT EXISTS eliminado_en TIMESTAMPTZ;

ALTER TABLE correctivos ADD COLUMN IF NOT EXISTS eliminado_por TEXT;

-- Versión de sesión: al cambiar o restablecer una contraseña sube, y las sesiones anteriores dejan de valer.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sesion_version INTEGER NOT NULL DEFAULT 0;

-- Obliga a cambiar la contraseña en el siguiente ingreso (admin inicial y claves puestas por un administrador).
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS debe_cambiar_clave BOOLEAN NOT NULL DEFAULT false;

-- Intentos fallidos de login por usuario + IP (compartido entre instancias del servidor).
CREATE TABLE IF NOT EXISTS intentos_login (
  clave  TEXT PRIMARY KEY,
  fallos INTEGER NOT NULL,
  desde  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Registro de acciones sobre usuarios (crear, cambiar rol, desactivar, contraseñas, eliminar).
-- No usa clave foránea: el registro se conserva aunque el usuario se elimine.
CREATE TABLE IF NOT EXISTS auditoria_usuarios (
  id         SERIAL PRIMARY KEY,
  actor      TEXT NOT NULL,
  accion     TEXT NOT NULL,
  objetivo   TEXT,
  detalle    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_usuarios_fecha ON auditoria_usuarios (created_at DESC);

-- Registro de accesos: ingresos (correctos y fallidos), salidas y exportaciones, con IP y navegador.
-- Se conserva 180 días (la app borra lo anterior de vez en cuando).
CREATE TABLE IF NOT EXISTS auditoria_accesos (
  id         SERIAL PRIMARY KEY,
  usuario    TEXT,
  evento     TEXT NOT NULL,
  ip         TEXT,
  user_agent TEXT,
  detalle    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_accesos_fecha ON auditoria_accesos (created_at DESC);


-- Verificación en dos pasos (TOTP). El secreto se guarda cifrado; mfa_ultimo_paso impide reutilizar un código.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mfa_secreto TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mfa_activo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mfa_ultimo_paso BIGINT NOT NULL DEFAULT 0;

-- Sesiones cerradas ("Salir"): un token robado deja de valer aunque no haya vencido.
CREATE TABLE IF NOT EXISTS sesiones_revocadas (
  jti    TEXT PRIMARY KEY,
  expira TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sesiones_revocadas_expira ON sesiones_revocadas (expira);

-- Códigos de respaldo del 2FA (solo se guardan sus huellas; cada uno vale una vez).
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS mfa_respaldo JSONB NOT NULL DEFAULT '[]'::jsonb;
