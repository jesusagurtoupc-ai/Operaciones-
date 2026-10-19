import { neon } from "@neondatabase/serverless";
import { getFreshSession } from "./auth.js";
import { LOGO_SHIELD_BASE64, normalizePersonKey, construirMapaCorreos, escapeHtml } from "./tareas-email-utils.js";

// Efecto secundario "best-effort" al crear una tarea nueva en "Control de Tareas": le manda un
// correo al responsable avisándole que se le asignó, reusando el mismo Apps Script (webhook)
// que ya usan el resumen diario (cron-alertas-tareas.js) y las notificaciones de cotización.
// Si algo falla aquí (webhook no configurado, responsable sin correo, error de red) no debe
// afectar el flujo: la tarea ya quedó guardada en "Control de Tareas" antes de llamar a este
// endpoint, así que siempre se responde 200 con ok:true/false en vez de un error.
//
// El correo del responsable se toma de la misma forma que en el resumen diario: del campo
// "email" del usuario en Control de Tareas cuyo "trabajador" (o nombre de usuario) coincida
// con el "responsable" de la tarea. Si no hay un usuario con correo configurado para ese
// responsable, simplemente no se manda nada (no hay respaldo manual).

const sql = neon(process.env.DATABASE_URL);

function badgePrioridad(prioridad) {
  const p = String(prioridad || "").trim().toLowerCase();
  if (p === "alta") return { bg: "#E62D35", fg: "#ffffff" };
  if (p === "baja") return { bg: "#eef0f3", fg: "#6b7280" };
  return { bg: "#f2a73b", fg: "#ffffff" }; // Media (por defecto)
}

function fmtFecha(v) {
  if (!v) return null;
  const [y, m, d] = String(v).split("-").map(Number);
  if (![y, m, d].every(Number.isInteger)) return String(v);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-PE", { timeZone: "UTC", day: "2-digit", month: "long", year: "numeric" });
}

function construirCuerpo({ responsable, tarea, prioridad, inicio, fin, obs, creadoPor }) {
  const lineas = [
    `Hola ${responsable},`,
    "",
    `Se te asignó una nueva tarea en Control de Tareas:`,
    "",
    `- Tarea: ${tarea}`,
    `- Prioridad: ${prioridad || "Media"}`,
  ];
  if (inicio) lineas.push(`- Inicio: ${fmtFecha(inicio)}`);
  if (fin) lineas.push(`- Vence: ${fmtFecha(fin)}`);
  if (obs) lineas.push(`- Observaciones: ${obs}`);
  lineas.push("", `Creada por: ${creadoPor}`);
  return lineas.join("\n") + "\n";
}

function construirHtml({ responsable, tarea, prioridad, inicio, fin, obs, creadoPor }) {
  const badge = badgePrioridad(prioridad);
  const appUrl = (process.env.APP_URL || "").trim();
  const boton = appUrl
    ? `<tr>
    <td align="center" style="padding-bottom:20px;">
      <a href="${escapeHtml(appUrl)}" style="display:inline-block; background-color:#1c2530; color:#ffffff; text-decoration:none; font-size:13.5px; font-weight:bold; padding:12px 30px; border-radius:24px;">Abrir Control de Tareas</a>
    </td>
  </tr>`
    : "";

  const filas = [
    ["Prioridad", `<span style="background-color:${badge.bg}; color:${badge.fg}; font-size:10.5px; font-weight:bold; padding:4px 9px; border-radius:10px;">${escapeHtml(String(prioridad || "Media").toUpperCase())}</span>`],
  ];
  if (inicio) filas.push(["Inicio", escapeHtml(fmtFecha(inicio))]);
  if (fin) filas.push(["Vence", escapeHtml(fmtFecha(fin))]);
  if (obs) filas.push(["Observaciones", escapeHtml(obs)]);
  filas.push(["Creada por", escapeHtml(creadoPor)]);

  const filasHtml = filas
    .map(
      ([label, valor]) => `
          <tr>
            <td style="padding:6px 0; color:#8a93a0; font-size:12.5px; white-space:nowrap; vertical-align:top;">${escapeHtml(label)}</td>
            <td style="padding:6px 0 6px 14px; color:#1c2530; font-size:13.5px;">${valor}</td>
          </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Nueva tarea asignada</title></head>
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
      <h1 style="margin:0; color:#1c2530; font-size:20px;">Nueva tarea asignada, ${escapeHtml(responsable)}</h1>
      <p style="margin:6px 0 0 0; color:#8a93a0; font-size:13px;">Control de Tareas</p>
    </td>
  </tr>

  <tr><td style="padding-bottom:20px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:10px; border-left:5px solid #38628C;">
      <tr><td style="padding:16px 20px;">
        <div style="color:#1c2530; font-size:15px; font-weight:bold; padding-bottom:4px;">${escapeHtml(tarea)}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filasHtml}
        </table>
      </td></tr>
    </table>
  </td></tr>
${boton}
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
  if (req.method !== "POST") return res.status(405).json({ error: "metodo no soportado" });

  try {
    const session = await getFreshSession(req);
    if (!session) return res.status(401).json({ ok: false, reason: "sin_sesion" });

    let body = {};
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    } catch (e) {
      console.error("notificar-tarea: cuerpo de la peticion invalido", e);
      return res.status(400).json({ error: "cuerpo_invalido" });
    }

    const responsable = String(body.responsable || "").trim();
    const tarea = String(body.tarea || "").trim();
    if (!responsable || responsable === "Sin asignar" || !tarea) {
      return res.status(200).json({ ok: false, reason: "sin_responsable_o_tarea" });
    }

    const webhookUrl = (process.env.WEBHOOK_COTIZACION_URL || "").trim();
    if (!webhookUrl) return res.status(200).json({ ok: false, reason: "not_configured" });

    const rows = await sql`SELECT value FROM app_storage WHERE key = 'torre_ops_data'`;
    if (!rows.length) return res.status(200).json({ ok: false, reason: "sin_datos" });

    const data = JSON.parse(rows[0].value);
    const correosPorUsuario = construirMapaCorreos(data.users);
    const email = correosPorUsuario[normalizePersonKey(responsable)];
    if (!email) return res.status(200).json({ ok: false, reason: "sin_correo_configurado" });

    const detalle = {
      responsable,
      tarea,
      prioridad: String(body.prioridad || "Media").trim(),
      inicio: String(body.inicio || "").trim(),
      fin: String(body.fin || "").trim(),
      obs: String(body.obs || "").trim(),
      creadoPor: session.name,
    };

    const payload = {
      evento: "alerta_tareas",
      to: email,
      subject: `Nueva tarea asignada: ${tarea}`,
      texto: construirCuerpo(detalle),
      html: construirHtml(detalle),
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    let webhookRes;
    try {
      webhookRes = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    let webhookBody = null;
    try {
      webhookBody = await webhookRes.json();
    } catch (e) {
      console.error("notificar-tarea: el webhook no devolvio JSON valido", e);
    }
    const okReal = webhookRes.ok && webhookBody && webhookBody.ok === true;
    return res.status(200).json({ ok: okReal, detalle: okReal ? undefined : webhookBody });
  } catch (e) {
    console.error("[notificar-tarea] no se pudo enviar la notificacion", e);
    return res.status(200).json({ ok: false, reason: "error" });
  }
}
