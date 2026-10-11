// Ejecuta: npm run db:migrate
// Requiere DATABASE_URL (en .env.local o en el entorno). Si usas un rol de
// aplicación con permisos mínimos (recomendado), define DATABASE_URL_MIGRACION con
// la conexión del propietario de la base: la migración usa esa y deja
// DATABASE_URL para la app. Con APP_DB_ROLE=<rol> también le otorga los permisos mínimos.
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { sentenciasPermisos, rolValido } from "./permisos.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.DATABASE_URL_MIGRACION || process.env.DATABASE_URL;
  if (!url) {
    console.error("❌ Falta la variable de entorno DATABASE_URL.");
    process.exit(1);
  }
  const rolApp = process.env.APP_DB_ROLE;
  if (rolApp && !rolValido(rolApp)) {
    console.error(`❌ APP_DB_ROLE no es un nombre de rol válido: "${rolApp}"`);
    process.exit(1);
  }
  const sql = neon(url);
  const schema = readFileSync(path.join(__dirname, "schema.sql"), "utf-8");

  // neon() no soporta múltiples statements en una sola llamada,
  // así que los separamos por punto y coma.
  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of statements) {
    await sql.query(stmt);
  }

  // N° Refer. único entre los tickets activos. Se crea solo si no hay
  // duplicados: si los hay, se listan para corregirlos a mano y se vuelve a migrar.
  const duplicados = await sql`
    SELECT refer, COUNT(*)::int AS n, ARRAY_AGG(id ORDER BY id) AS ids
    FROM correctivos
    WHERE refer IS NOT NULL AND eliminado_en IS NULL
    GROUP BY refer HAVING COUNT(*) > 1
    ORDER BY refer
  `;
  if (duplicados.length > 0) {
    console.warn("⚠️  Hay N° Refer. repetidos; no se creó el índice único. Corrígelos y ejecuta de nuevo:");
    for (const d of duplicados) {
      console.warn(`   Refer ${d.refer}: tickets con id ${d.ids.join(", ")}`);
    }
  } else {
    await sql.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_correctivos_refer ON correctivos (refer) WHERE refer IS NOT NULL AND eliminado_en IS NULL"
    );
    console.log("✅ Índice único de N° Refer. listo.");
  }

  if (rolApp) {
    for (const stmt of sentenciasPermisos(rolApp)) {
      await sql.query(stmt);
    }
    console.log(`✅ Permisos mínimos aplicados al rol "${rolApp}".`);
  } else {
    console.log("ℹ️  Sin APP_DB_ROLE: no se tocaron permisos (la app usa la conexión indicada).");
  }

  console.log("✅ Migración completada.");
}

main().catch((err) => {
  console.error("❌ Error al migrar:", err);
  process.exit(1);
});
