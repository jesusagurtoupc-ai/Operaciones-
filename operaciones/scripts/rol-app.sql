-- Crea el rol con el que correrá la APLICACIÓN (permisos mínimos).
-- Ejecútalo UNA vez como propietario de la base (Neon: SQL Editor), cambiando la contraseña.
-- En Neon también puedes crear el rol desde Console → Roles; el resultado es el mismo.
--
-- Después:
--   1) Local, en .env.local:  DATABASE_URL_MIGRACION = conexión del propietario (la de siempre)
--                             APP_DB_ROLE = app_correctivos
--      y ejecuta `npm run db:migrate`: crea/actualiza tablas y otorga los permisos mínimos.
--   2) En Vercel, cambia DATABASE_URL por la conexión del rol app_correctivos
--      (misma dirección y base, con ese usuario y contraseña) y vuelve a desplegar.
--   3) El propietario ya no se usa en producción.
CREATE ROLE app_correctivos LOGIN PASSWORD 'CAMBIA-ESTA-CONTRASENA-POR-UNA-LARGA-Y-ALEATORIA';
GRANT CONNECT ON DATABASE neondb TO app_correctivos; -- cambia "neondb" si tu base se llama distinto
