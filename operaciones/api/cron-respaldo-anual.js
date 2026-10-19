import { neon } from "@neondatabase/serverless";
import { getFreshSession, bearerValido } from "./auth.js";
import { sanitizeTorreData, decryptSensitive } from "./storage.js";

// Se ejecuta automáticamente el 1 de enero de cada año (Cron Job configurado en
// vercel.json) y guarda una "foto" completa de todas las claves de app_storage bajo una
// nueva clave "app_backup_<año>" en la MISMA tabla app_storage (no requiere crear ninguna
// tabla nueva ni correr ninguna migración en Neon). También se puede disparar manualmente
// desde el botón "Generar respaldo ahora" de Control de Tareas — mismo endpoint, misma
// lógica, autenticado con la sesión normal de un admin en vez del CRON_SECRET.

const sql = neon(process.env.DATABASE_URL);
const PREFIJO_RESPALDO = "app_backup_";

function anioObjetivo(body, esLlamadaCron) {
  const explicito = Number(body?.anio);
  if (Number.isInteger(explicito) && explicito > 2000 && explicito < 3000) return explicito;
  const ahoraUTC = new Date();
  // El cron corre el 1 de enero a las 06:00 UTC: a esa hora, el año que "acaba de
  // cerrar" (el que corresponde respaldar) es el anterior al año actual en UTC.
  if (esLlamadaCron) return ahoraUTC.getUTCFullYear() - 1;
  // Disparo manual sin año explícito: se respalda el año en curso, con los datos
  // vigentes hasta este momento (útil para refrescar el respaldo del año actual).
  return ahoraUTC.getUTCFullYear();
}

export default async function handler(req, res) {
  // Dos formas válidas de disparar este endpoint, igual que /api/cron-alertas-tareas:
  //  1) Vercel Cron, automáticamente, autenticado con el header que arma a partir de
  //     CRON_SECRET (si la configuraste).
  //  2) Un admin de la app, manualmente, desde el botón correspondiente — autenticado
  //     con su sesión normal (cookie).
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || "";
  const esLlamadaCron = bearerValido(auth, cronSecret);

  if (!esLlamadaCron) {
    const session = await getFreshSession(req);
    if (!session) return res.status(401).json({ ok: false, reason: "sin_sesion" });
    if (session.role !== "admin") return res.status(403).json({ ok: false, reason: "solo_admin" });
  }

  try {
    let body = {};
    if (req.method === "POST" || req.method === "PUT") {
      try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); } catch (_) { body = {}; }
    }
    const anio = anioObjetivo(body, esLlamadaCron);

    // Se excluyen las claves de respaldos anteriores (app_backup_*) para que un
    // respaldo nunca quede anidado dentro de otro.
    const rows = await sql`SELECT key, value FROM app_storage WHERE key NOT LIKE ${PREFIJO_RESPALDO + "%"}`;
    const datosPorClave = {};
    for (const row of rows) {
      let valor = row.value;
      // Igual que en el GET de /api/storage: nunca se guardan contraseñas en texto plano
      // ni hasheadas en el respaldo, y las cuentas/proveedores se guardan ya desencriptados
      // para que el respaldo sea legible por sí solo.
      if (row.key === "torre_ops_data") valor = sanitizeTorreData(valor);
      if (row.key === "wilarcon_cuentas_records") valor = decryptSensitive(valor);
      try { datosPorClave[row.key] = JSON.parse(valor); } catch (_) { datosPorClave[row.key] = valor; }
    }

    const claveRespaldo = PREFIJO_RESPALDO + anio;
    const stringValue = JSON.stringify({ anio, generado_en: new Date().toISOString(), data: datosPorClave });
    const guardado = await sql`
      INSERT INTO app_storage (key, value, version, updated_at)
      VALUES (${claveRespaldo}, ${stringValue}, 1, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, version = app_storage.version + 1, updated_at = now()
      RETURNING updated_at
    `;
    return res.status(200).json({
      ok: true,
      anio,
      generado_en: guardado[0].updated_at,
      claves: Object.keys(datosPorClave).length,
    });
  } catch (err) {
    console.error("cron-respaldo-anual: error al generar el respaldo", err);
    return res.status(500).json({ ok: false, reason: "error_interno" });
  }
}
