// Ejecuta: npm run db:seed
// Importa los 319 registros originales del archivo Sistema_Correctivos_2025.xlsm
// a la tabla `correctivos`. Es seguro ejecutarlo varias veces: si la tabla
// ya tiene datos, se te preguntará antes de continuar.
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

  const rows = JSON.parse(
    readFileSync(path.join(__dirname, "seed-data.json"), "utf-8")
  );

  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM correctivos`;
  if (count > 0) {
    console.log(
      `⚠️  La tabla ya tiene ${count} registros. Se insertarán ${rows.length} adicionales.`
    );
  }

  let inserted = 0;
  let omitidos = 0;
  for (const r of rows) {
    try {
      await sql`
        INSERT INTO correctivos
          (refer, ticket, f_reg, descripcion, lugar, estado, proveedor, monto,
           f_coti, obs_cot, f_ps, f_oc, f_inicio, f_fin, cuenta, tipo_trab,
           sub_tipo_trab, evaluacion, n_oc, area)
        VALUES
          (${r.refer ?? null}, ${r.ticket ?? null}, ${r.f_reg ?? null},
           ${r.descripcion ?? null}, ${r.lugar ?? null}, ${r.estado ?? "cotizar"},
           ${r.proveedor ?? null}, ${r.monto ?? null}, ${r.f_coti ?? null},
           ${r.obs_cot ?? null}, ${r.f_ps ?? null}, ${r.f_oc ?? null},
           ${r.f_inicio ?? null}, ${r.f_fin ?? null}, ${r.cuenta ?? null},
           ${r.tipo_trab ?? null}, ${r.sub_tipo_trab ?? null},
           ${r.evaluacion ?? null}, ${r.n_oc ? String(r.n_oc) : null},
           ${r.area ?? null})
      `;
      inserted++;
    } catch (err) {
      omitidos++;
      console.warn(
        `⚠️  Fila con refer=${r.refer ?? "?"} omitida (dato inválido): ${err.message}`
      );
    }
  }

  console.log(
    `✅ Se insertaron ${inserted} registros en 'correctivos'.` +
      (omitidos > 0 ? ` (${omitidos} omitidos por datos inválidos)` : "")
  );
}

main().catch((err) => {
  console.error("❌ Error al importar datos:", err);
  process.exit(1);
});
