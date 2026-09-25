import { neon } from "@neondatabase/serverless";

// La variable DATABASE_URL la provee automáticamente la integración de
// Vercel Postgres / Neon cuando conectas la base de datos a tu proyecto
// en Vercel. En local, defínela en .env.local
if (!process.env.DATABASE_URL) {
  console.warn(
    "⚠️  DATABASE_URL no está definida. Configúrala en .env.local o en Vercel."
  );
}

export const sql = neon(process.env.DATABASE_URL || "");
