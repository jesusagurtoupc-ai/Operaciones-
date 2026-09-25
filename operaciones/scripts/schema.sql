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
