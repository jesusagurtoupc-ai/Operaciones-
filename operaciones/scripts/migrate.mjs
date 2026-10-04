// Ejecuta: npm run db:migrate
// Requiere que DATABASE_URL esté definida (en .env.local o en el entorno)
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ Falta la variable de entorno DATABASE_URL.");
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);
  const schema = readFileSync(path.join(__dirname, "schema.sql"), "utf-8");

  // neon() no soporta múltiples statements en una sola llamada,
  // así que los separamos por punto y coma.
  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of statements) {
    await sql(stmt);
  }

  console.log("✅ Migración completada: tabla 'correctivos' lista.");
}

main().catch((err) => {
  console.error("❌ Error al migrar:", err);
  process.exit(1);
});
