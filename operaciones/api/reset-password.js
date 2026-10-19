import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";
import { hashPassword } from "./auth.js";

// Endpoint PÚBLICO (sin sesión): completa el flujo iniciado en forgot-password.js. Recibe el
// usuario + token que llegaron en el enlace del correo y la contraseña nueva, valida el token
// contra su hash guardado en app_storage (mismo patrón que password_reset_<usuario> escrito
// por forgot-password.js) y, si es válido y no venció, actualiza SOLO el passwordHash de ESE
// usuario dentro de torre_ops_data -- mismo patrón de reintento ante conflictos de versión que
// usa change-my-password.js, para no pisar un guardado concurrente de otro admin.

const sql = neon(process.env.DATABASE_URL);
const RESET_PREFIX = "password_reset_";

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "metodo no soportado" });
  }

  let body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch (e) {
    console.error("reset-password: cuerpo de la peticion invalido", e);
    return res.status(400).json({ error: "cuerpo_invalido" });
  }
  const name = String(body.name || "").trim();
  const token = String(body.token || "").trim();
  const newPassword = String(body.newPassword || "");
  if (!name || !token || !newPassword) return res.status(400).json({ error: "faltan_campos" });
  if (newPassword.length < 4) return res.status(400).json({ error: "contrasena_muy_corta" });

  try {
    const key = RESET_PREFIX + name.toLowerCase();
    const resetRows = await sql`SELECT value FROM app_storage WHERE key = ${key}`;
    if (!resetRows.length) return res.status(400).json({ error: "token_invalido" });

    let record;
    try {
      record = JSON.parse(resetRows[0].value);
    } catch (e) {
      console.error("reset-password: registro de reset corrupto", e);
      return res.status(400).json({ error: "token_invalido" });
    }
    if (record.used) return res.status(400).json({ error: "token_invalido" });
    if (!record.expiresAt || record.expiresAt < Date.now()) return res.status(400).json({ error: "token_expirado" });

    const providedHash = tokenHash(token);
    const storedBuf = Buffer.from(String(record.tokenHash || ""));
    const providedBuf = Buffer.from(providedHash);
    const valid = storedBuf.length === providedBuf.length && crypto.timingSafeEqual(storedBuf, providedBuf);
    if (!valid) return res.status(400).json({ error: "token_invalido" });

    const nuevoHash = await hashPassword(newPassword);

    // Mismo patrón de reintento que change-my-password.js: relee y reaplica el cambio ante
    // cada conflicto de versión, sin confiar nunca en un "users" completo del cliente.
    let guardado = false;
    for (let intento = 0; intento < 5 && !guardado; intento++) {
      const dataRows = await sql`SELECT value, version FROM app_storage WHERE key = 'torre_ops_data'`;
      if (!dataRows.length) return res.status(404).json({ error: "not_found" });
      let data;
      try {
        data = JSON.parse(dataRows[0].value);
      } catch (e) {
        console.error("reset-password: JSON invalido en torre_ops_data", e);
        return res.status(500).json({ error: "error_interno" });
      }
      const list = Array.isArray(data.users) ? data.users : [];
      let found = false;
      const nextUsers = list.map((u) => {
        if (String(u.name || "").toLowerCase() === name.toLowerCase()) {
          found = true;
          const { password: _plain, ...rest } = u;
          return { ...rest, passwordHash: nuevoHash };
        }
        return u;
      });
      if (!found) return res.status(404).json({ error: "usuario_no_encontrado" });

      const nextValue = JSON.stringify({ ...data, users: nextUsers });
      const updated = await sql`
        UPDATE app_storage
        SET value = ${nextValue}, version = version + 1, updated_at = now()
        WHERE key = 'torre_ops_data' AND version = ${dataRows[0].version}
        RETURNING version
      `;
      if (updated.length) guardado = true;
      // Si no hubo filas actualizadas, la versión cambió entre el SELECT y el UPDATE: se
      // reintenta desde el inicio del for.
    }
    if (!guardado) return res.status(409).json({ error: "conflicto_version" });

    // El token es de un solo uso: se marca usado inmediatamente después de aplicar el cambio,
    // para que un segundo intento con el mismo enlace (por ejemplo un reenvío del correo, o el
    // enlace quedando cacheado) no pueda volver a cambiar la contraseña.
    record.used = true;
    await sql`
      UPDATE app_storage SET value = ${JSON.stringify(record)}, version = version + 1, updated_at = now()
      WHERE key = ${key}
    `;

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("reset-password error", e);
    return res.status(500).json({ error: "error_interno" });
  }
}
