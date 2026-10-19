import { neon } from "@neondatabase/serverless";
import { getFreshSession, bearerValido } from "./auth.js";
import { LOGO_SHIELD_BASE64, normalizePersonKey, construirMapaCorreos, escapeHtml } from "./tareas-email-utils.js";

// Se ejecuta automáticamente todos los días a las 7:00 am (hora de Lima) gracias al
// Cron Job configurado en vercel.json (y también se puede disparar al toque desde el botón
// "Enviar notificaciones por correo" de Control de Tareas — mismo endpoint, mismos datos).
// Lee las tareas de "Control de Tareas", agrupa TODAS las que NO estén en estado
// "Completado" (o sea "No empezado" y "En curso", sin importar fecha de vencimiento) por
// responsable, y le manda un correo a cada quien con solo sus propias tareas — reusando el
// mismo Apps Script que ya envía las notificaciones de cotización.
//
// El correo de cada responsable se toma únicamente del campo "email" del usuario en
// Control de Tareas cuyo "trabajador" (o nombre de usuario) coincida con el "responsable"
// de la tarea — configurable desde la propia app (Gestión de usuarios → Accesos → Correo
// electrónico). Si ese responsable no tiene un usuario con correo configurado, simplemente
// no se le envía nada (no hay respaldo manual).

const sql = neon(process.env.DATABASE_URL);


function normEstado(v) {
  return (v || "").trim().toUpperCase();
}

function diasRestantes(fin) {
  if (!fin) return null;
  const [y, m, d] = String(fin).split("-").map(Number);
  if (![y, m, d].every(Number.isInteger) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const target = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000);
}


function construirCuerpo(responsable, tareas) {
  const lineas = tareas
    .sort((a, b) => (a.dias ?? 9999) - (b.dias ?? 9999))
    .map((t) => {
      let estadoTxt;
      if (t.dias === null) estadoTxt = "sin fecha límite";
      else if (t.dias < 0) estadoTxt = `ATRASADA por ${Math.abs(t.dias)} día(s)`;
      else if (t.dias === 0) estadoTxt = "vence HOY";
      else estadoTxt = `vence en ${t.dias} día(s)`;
      const obs = t.obs ? ` — ${t.obs}` : "";
      return `- [${t.estado}] ${t.tarea} (${estadoTxt})${obs}`;
    });

  return (
    `Hola ${responsable},\n\n` +
    `Este es tu resumen diario de tareas pendientes en Control de Tareas:\n\n` +
    lineas.join("\n") +
    `\n\nTotal: ${tareas.length} tarea(s) pendiente(s).\n`
  );
}


// Mismos 3 estados visuales que "Formato 2 — Tarjetas": rojo (atrasada), naranja (vence
// hoy) y azul (próxima). Se agrega un 4to estado neutro para tareas sin fecha límite, que
// el formato original no contemplaba.
function badgeTarea(dias) {
  if (dias === null) {
    return { texto: "SIN FECHA LÍMITE", borde: "#9aa5b5", bg: "#eef0f3", fg: "#6b7280" };
  }
  if (dias < 0) {
    const d = Math.abs(dias);
    return { texto: `ATRASADA · ${d} DÍA${d === 1 ? "" : "S"}`, borde: "#E62D35", bg: "#E62D35", fg: "#ffffff" };
  }
  if (dias === 0) {
    return { texto: "VENCE HOY", borde: "#f2a73b", bg: "#f2a73b", fg: "#ffffff" };
  }
  return { texto: `${dias} DÍA${dias === 1 ? "" : "S"}`, borde: "#38628C", bg: "#eaf1f8", fg: "#38628C" };
}

function tarjetaHtml(t) {
  const badge = badgeTarea(t.dias);
  const titulo = escapeHtml(t.tarea || "(sin título)");
  const subLinea = t.obs || t.estado || "";
  const sub = subLinea
    ? `<div style="color:#7c8593; font-size:12.5px; margin-top:3px;">${escapeHtml(subLinea)}</div>`
    : "";
  return `
  <tr><td style="padding-bottom:10px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:10px; border-left:5px solid ${badge.borde};">
      <tr><td style="padding:16px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <div style="color:#1c2530; font-size:14.5px; font-weight:bold;">${titulo}</div>
              ${sub}
            </td>
            <td align="right" style="white-space:nowrap; vertical-align:top;">
              <span style="background-color:${badge.bg}; color:${badge.fg}; font-size:10.5px; font-weight:bold; padding:4px 9px; border-radius:10px;">${badge.texto}</span>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </td></tr>`;
}

// Arma el correo en HTML con el diseño de "Formato 2 — Tarjetas" (una tarjeta por tarea,
// con borde y etiqueta de color según urgencia). Si se configura la variable de entorno
// APP_URL, se agrega el botón "Abrir Control de Tareas" enlazando ahí; si no, el correo
// se manda igual mostrando las tarjetas nomás.
function construirHtml(responsable, tareas) {
  const ordenadas = [...tareas].sort((a, b) => (a.dias ?? 9999) - (b.dias ?? 9999));
  const tarjetas = ordenadas.map(tarjetaHtml).join("\n");
  const appUrl = (process.env.APP_URL || "").trim();
  const boton = appUrl
    ? `<tr>
    <td align="center" style="padding-bottom:20px;">
      <a href="${escapeHtml(appUrl)}" style="display:inline-block; background-color:#1c2530; color:#ffffff; text-decoration:none; font-size:13.5px; font-weight:bold; padding:12px 30px; border-radius:24px;">Abrir Control de Tareas</a>
    </td>
  </tr>`
    : "";
  const hoy = new Date().toLocaleDateString("es-PE", { timeZone: "America/Lima" });
  const plural = tareas.length === 1 ? "" : "s";

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Tareas pendientes</title></head>
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
      <h1 style="margin:0; color:#1c2530; font-size:20px;">Tus tareas pendientes, ${escapeHtml(responsable)}</h1>
      <p style="margin:6px 0 0 0; color:#8a93a0; font-size:13px;">${tareas.length} tarea${plural} activa${plural} · actualizado ${escapeHtml(hoy)}</p>
    </td>
  </tr>
${tarjetas}
${boton}
  <tr>
    <td align="center">
      <p style="margin:0; color:#a3aab5; font-size:11px; line-height:1.6;">Resumen automático diario &middot; Wilarcon Operaciones</p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

export default async function handler(req, res) {
  // Dos formas válidas de disparar este endpoint:
  //  1) Vercel Cron, automáticamente, autenticado con el header que arma a partir de
  //     CRON_SECRET (si la configuraste).
  //  2) Un admin de la app, manualmente, desde el botón "Enviar notificaciones ahora"
  //     de Control de Tareas — autenticado con su sesión normal (cookie).
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || "";
  const esLlamadaCron = bearerValido(auth, cronSecret);

  if (!esLlamadaCron) {
    const session = await getFreshSession(req);
    if (!session) return res.status(401).json({ ok: false, reason: "sin_sesion" });
    if (session.role !== "admin") return res.status(403).json({ ok: false, reason: "solo_admin" });
  }

  try {
    const rows = await sql`SELECT value FROM app_storage WHERE key = 'torre_ops_data'`;
    if (!rows.length) return res.status(200).json({ ok: false, reason: "sin_datos" });

    const data = JSON.parse(rows[0].value);
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    const correosPorUsuario = construirMapaCorreos(data.users);

    const pendientes = tasks
      .filter((t) => !t.deleted && normEstado(t.estado) !== "COMPLETADO")
      .map((t) => ({ ...t, dias: diasRestantes(t.fin) }));

    const porResponsable = {};
    pendientes.forEach((t) => {
      const nombre = String(t.responsable || "Sin asignar").trim() || "Sin asignar";
      const key = normalizePersonKey(nombre);
      if (!porResponsable[key]) porResponsable[key] = { nombre, tareas: [] };
      porResponsable[key].tareas.push(t);
    });

    const webhookUrl = (process.env.WEBHOOK_COTIZACION_URL || "").trim();
    if (!webhookUrl) return res.status(200).json({ ok: false, reason: "not_configured" });

    const resultados = [];
    for (const key of Object.keys(porResponsable)) {
      const { nombre, tareas } = porResponsable[key];

      // Correo configurado en la app (usuario vinculado a este responsable). Sin respaldo:
      // si no está configurado, no se le envía nada a ese responsable.
      const email = correosPorUsuario[key];
      const origenCorreo = "usuario_app";

      if (!email) {
        resultados.push({ responsable: nombre, ok: false, reason: "sin_correo_configurado" });
        continue;
      }
      if (!tareas.length) continue;

      const payload = {
        evento: "alerta_tareas",
        to: email,
        subject: `Tareas pendientes (${tareas.length}) — ${nombre}`,
        texto: construirCuerpo(nombre, tareas),
        html: construirHtml(nombre, tareas),
      };

      try {
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
          console.error(`cron-alertas-tareas: webhook no devolvio JSON valido para ${nombre}`, e);
        }
        const okReal = webhookRes.ok && webhookBody && webhookBody.ok === true;
        resultados.push({
          responsable: nombre,
          ok: okReal,
          status: webhookRes.status,
          origenCorreo,
          detalle: okReal ? undefined : webhookBody,
        });
      } catch (e) {
        console.error(`cron-alertas-tareas: fallo el envio para ${nombre}`, e);
        resultados.push({ responsable: nombre, ok: false, reason: "error_envio" });
      }
    }

    return res.status(200).json({ ok: true, resultados });
  } catch (e) {
    console.error("[cron-alertas-tareas] error", e);
    return res.status(200).json({ ok: false, reason: "error" });
  }
}
