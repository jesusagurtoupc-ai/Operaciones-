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
