import { getFreshSession } from "./auth.js";

// Reenvía (desde el servidor, no desde el navegador) los datos básicos de una cotización
// finalizada al webhook externo configurado en la variable de entorno WEBHOOK_COTIZACION_URL.
// Se hace server-side y no directo desde el navegador porque la Content-Security-Policy de la
// app (connect-src 'self') no permitiría al navegador llamar a un dominio externo.
// Es un efecto secundario "best-effort": si el webhook no está configurado, no responde, o
// falla, se devuelve 200 con ok:false en vez de un error — el botón "Enviar" ya guardó el
// cambio de estado antes de llamar aquí y no debe fallar por esto.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "metodo no soportado" });

  try {
    const session = await getFreshSession(req);
    if (!session) return res.status(401).json({ error: "sin sesion" });

    const url = (process.env.WEBHOOK_COTIZACION_URL || "").trim();
    if (!url) return res.status(200).json({ ok: false, reason: "not_configured" });

    let body = {};
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    } catch (e) {
      console.error("handler: cuerpo de la peticion invalido", e);
      return res.status(400).json({ error: "cuerpo_invalido" });
    }

    const payload = {
      evento: "cotizacion_enviada",
      numero: String(body.numero || ""),
      contacto: String(body.contacto || ""),
      solicitud: String(body.solicitud || ""),
      moneda: String(body.moneda || ""),
      total: Number(body.total) || 0,
      enviadoPor: session.name,
      fecha: new Date().toISOString(),
      pdf: body.pdfBase64
        ? { fileName: String(body.pdfFileName || "cotizacion.pdf"), base64: String(body.pdfBase64) }
        : null,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    let webhookRes;
    try {
      webhookRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!webhookRes.ok) {
      console.error(`[webhook-cotizacion] el webhook respondio ${webhookRes.status}`);
      return res.status(200).json({ ok: false, reason: "webhook_error", status: webhookRes.status });
    }

    // Apps Script casi siempre responde HTTP 200 aunque falle internamente
    // (secreto inválido, sin body, etc.), así que el status por sí solo no basta.
    let webhookBody = null;
    try {
      webhookBody = await webhookRes.json();
    } catch (_) {
      console.error("[webhook-cotizacion] respuesta del webhook no es JSON valido");
      return res.status(200).json({ ok: false, reason: "webhook_respuesta_invalida" });
    }
    if (!webhookBody || webhookBody.ok !== true) {
      console.error("[webhook-cotizacion] el webhook respondio ok:false", webhookBody);
      return res.status(200).json({ ok: false, reason: "webhook_rechazado", detalle: webhookBody });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[webhook-cotizacion] no se pudo enviar el webhook", e);
    return res.status(200).json({ ok: false, reason: "error" });
  }
}
