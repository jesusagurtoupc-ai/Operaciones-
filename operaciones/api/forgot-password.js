import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";
import { loadUsers } from "./auth.js";
import { LOGO_SHIELD_BASE64, escapeHtml } from "./tareas-email-utils.js";

// Endpoint PÚBLICO (sin sesión, a propósito: el usuario no puede iniciar sesión, para eso es
// esto). Genera un token de un solo uso, lo guarda hasheado en app_storage y manda el enlace
// de restablecimiento por correo, reusando el mismo webhook (Apps Script) que ya usan
// notificar-tarea.js y cron-alertas-tareas.js -- no hace falta configurar un proveedor de
// correo nuevo, ya existe WEBHOOK_COTIZACION_URL.
//
// Por diseño SIEMPRE responde 200 { ok: true } sin importar si el usuario existe, si tiene
// correo configurado o si está desactivado: revelar esa información permitiría a cualquiera
// usar este formulario para enumerar usuarios válidos del sistema. El único indicio real de
// que algo falló (webhook no configurado, sin DATABASE_URL, etc.) queda en los logs del
// servidor, nunca en la respuesta.

const sql = neon(process.env.DATABASE_URL);
const RESET_PREFIX = "password_reset_";
const RESET_TTL_MS = 30 * 60 * 1000; // el enlace vence a los 30 minutos
const REQUEST_COOLDOWN_MS = 2 * 60 * 1000; // no reenviar un correo nuevo antes de 2 minutos

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function construirHtmlReset({ nombre, link }) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Restablecer contraseña</title></head>
<body style="margin:0; padding:0; background-color:#ffffff; font-family:'Segoe UI', Arial, Helvetica, sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff; padding:28px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0">

  <tr>
    <td align="center" style="padding-bottom:20px;">
      <img src="${LOGO_SHIELD_BASE64}" alt="Wilarcon" width="48" style="width:48px; height:auto; display:inline-block;" />
      <div style="margin-top:10px; color:#8a93a0; font-size:12px; letter-spacing:1px; text-transform:uppercase; font-weight:bold;">Wilarcon Operaciones</div>
    </td>
  </tr>

  <tr>
    <td align="center" style="padding-bottom:24px;">
      <h1 style="margin:0; color:#1c2530; font-size:20px;">Restablecer contraseña</h1>
      <p style="margin:6px 0 0 0; color:#8a93a0; font-size:13px;">Hola ${escapeHtml(nombre)}</p>
    </td>
  </tr>

  <tr><td style="padding-bottom:20px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:10px; border-left:5px solid #38628C;">
      <tr><td style="padding:16px 20px;">
        <div style="color:#1c2530; font-size:13.5px; line-height:1.6;">
          Recibimos una solicitud para restablecer tu contraseña. Este enlace vence en 30 minutos y solo se puede usar una vez. Si no fuiste tú, ignora este correo: tu contraseña actual sigue funcionando.
        </div>
      </td></tr>
    </table>
  </td></tr>

  <tr>
    <td align="center" style="padding-bottom:20px;">
      <a href="${escapeHtml(link)}" style="display:inline-block; background-color:#1c2530; color:#ffffff; text-decoration:none; font-size:13.5px; font-weight:bold; padding:12px 30px; border-radius:24px;">Crear nueva contraseña</a>
    </td>
  </tr>

  <tr>
    <td align="center">
      <p style="margin:0; color:#a3aab5; font-size:11px; line-height:1.6;">Notificación automática &middot; Wilarcon Operaciones</p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
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
    console.error("forgot-password: cuerpo de la peticion invalido", e);
    return res.status(400).json({ error: "cuerpo_invalido" });
  }
  const name = String(body.name || "").trim();
  const respuestaGenerica = { ok: true };
  if (!name) return res.status(200).json(respuestaGenerica);

  try {
    const webhookUrl = (process.env.WEBHOOK_COTIZACION_URL || "").trim();
    if (!webhookUrl) {
      console.warn("forgot-password: WEBHOOK_COTIZACION_URL no configurado, no se puede enviar el correo");
      return res.status(200).json(respuestaGenerica);
    }

    const users = await loadUsers();
    const user = users.find((u) => String(u.name || "").toLowerCase() === name.toLowerCase());
    if (!user || user.activo === false || !String(user.email || "").trim()) {
      return res.status(200).json(respuestaGenerica);
    }

    const key = RESET_PREFIX + name.toLowerCase();
    const existingRows = await sql`SELECT value FROM app_storage WHERE key = ${key}`;
    if (existingRows.length) {
      try {
        const existing = JSON.parse(existingRows[0].value);
        if (existing.requestedAt && Date.now() - existing.requestedAt < REQUEST_COOLDOWN_MS) {
          return res.status(200).json(respuestaGenerica);
        }
      } catch (e) { console.error("forgot-password: registro de reset previo invalido, se ignora", e); }
    }

    const token = crypto.randomBytes(32).toString("hex");
    const record = { tokenHash: tokenHash(token), expiresAt: Date.now() + RESET_TTL_MS, requestedAt: Date.now(), used: false };
    await sql`
      INSERT INTO app_storage (key, value, version, updated_at)
      VALUES (${key}, ${JSON.stringify(record)}, 1, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, version = app_storage.version + 1, updated_at = now()
    `;

    const appUrl = (process.env.APP_URL || "").trim().replace(/\/$/, "");
    const link = `${appUrl}?reset=${token}&u=${encodeURIComponent(user.name)}`;

    const payload = {
      evento: "reset_password",
      to: user.email,
      subject: "Restablecer tu contraseña — Wilarcon Operaciones",
      texto: `Hola ${user.name},\n\nRecibimos una solicitud para restablecer tu contraseña. Este enlace vence en 30 minutos y solo se puede usar una vez:\n${link}\n\nSi no fuiste tú, ignora este correo.`,
      html: construirHtmlReset({ nombre: user.name, link }),
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (e) {
    console.error("forgot-password: no se pudo procesar la solicitud (no bloqueante)", e);
  }

  return res.status(200).json(respuestaGenerica);
}
