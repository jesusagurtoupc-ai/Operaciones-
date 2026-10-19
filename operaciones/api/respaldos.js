import { neon } from "@neondatabase/serverless";
import { getFreshSession } from "./auth.js";

const sql = neon(process.env.DATABASE_URL);
const PREFIJO_RESPALDO = "app_backup_";

export default async function handler(req, res) {
  const session = await getFreshSession(req);
  if (!session) return res.status(401).json({ error: "sin_sesion" });
  if (session.role !== "admin") return res.status(403).json({ error: "solo_admin" });
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "metodo_no_soportado" });
  }

  try {
    const anioParam = req.query.anio;
    if (anioParam) {
      const anio = Number(anioParam);
      if (!Number.isInteger(anio)) return res.status(400).json({ error: "anio_invalido" });
      const rows = await sql`SELECT value FROM app_storage WHERE key = ${PREFIJO_RESPALDO + anio}`;
      if (!rows.length) return res.status(404).json({ error: "no_encontrado" });
      const parsed = JSON.parse(rows[0].value);
      return res.status(200).json({ anio: parsed.anio, generado_en: parsed.generado_en, data: parsed.data });
    }

    const rows = await sql`
      SELECT key, value, updated_at, pg_column_size(value) AS bytes
      FROM app_storage
      WHERE key LIKE ${PREFIJO_RESPALDO + "%"}
      ORDER BY key DESC
    `;
    const backups = rows.map((r) => {
      const anio = Number(r.key.slice(PREFIJO_RESPALDO.length));
      let generado_en = r.updated_at;
      try { generado_en = JSON.parse(r.value).generado_en || r.updated_at; } catch (_) { /* usa updated_at */ }
      return { anio, generado_en, bytes: Number(r.bytes) };
    }).filter((b) => Number.isInteger(b.anio));
    return res.status(200).json({ backups });
  } catch (err) {
    console.error("respaldos: error al leer los respaldos", err);
    return res.status(500).json({ error: "error_interno" });
  }
}
