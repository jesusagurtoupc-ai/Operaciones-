import { getFreshSession } from "./auth.js";

// Sube, descarga y elimina las fotos de Visita Técnica usando el mismo Apps Script
// (webhook) que ya se usa para correos de cotización y alertas de tareas, reutilizando
// WEBHOOK_COTIZACION_URL (que ya incluye el secreto compartido embebido en la URL).
// Se hace server-side y no directo desde el navegador por el mismo motivo que
// webhook-cotizacion.js: la Content-Security-Policy de la app (connect-src 'self') no
// permitiría al navegador llamar a un dominio externo, y además así el secreto nunca
// queda expuesto en el código que corre en el navegador.
//
// GET  ?fileId=xxx        -> devuelve los bytes de la foto (para usar como <img src>)
// POST { dataBase64, mimeType, filename } -> sube una foto nueva, devuelve { fileId }
// DELETE ?fileId=xxx      -> mueve la foto a la papelera de Drive

// Seguridad de las fotos. Antes se guardaba y se servía el tipo (mimeType) que declaraba quien
// subía el archivo. Como la app permite scripts en línea (CSP con 'unsafe-inline'), cualquier
// usuario con sesión podía subir un HTML disfrazado de foto y mandarle el enlace
// /api/fotos-visitas?fileId=... a un administrador: al abrirlo, el script corría con los
// permisos de ese administrador (por ejemplo para crearse un usuario admin). Ahora:
//   - solo se aceptan imágenes reales, reconocidas por su contenido (no por lo que diga el cliente);
//   - al servirlas se usa el tipo detectado en los bytes, nunca el guardado, así que también
//     quedan neutralizados los archivos que ya estuvieran subidos;
//   - la respuesta lleva una política que impide ejecutar nada aunque algo se colara.
// (El cliente ya convierte las fotos a JPEG antes de subirlas.)
const MAX_BASE64 = 5_500_000; // ~4 MB de imagen; Vercel rechaza cuerpos de más de 4,5 MB
const FILE_ID_OK = /^[A-Za-z0-9_-]{10,100}$/;

function detectarImagen(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (buf.length >= 6) {
    const cab = buf.subarray(0, 6).toString("latin1");
    if (cab === "GIF87a" || cab === "GIF89a") return "image/gif";
  }
  return null;
}

function nombreSeguro(filename) {
  const limpio = String(filename || "foto").replace(/[^\w.\- ]/g, "_").slice(0, 100);
  return limpio || "foto";
}

async function llamarPuente(payload) {
  const url = (process.env.WEBHOOK_COTIZACION_URL || "").trim();
  if (!url) throw new Error("WEBHOOK_COTIZACION_URL no está configurada");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) throw new Error(`el puente respondió ${res.status}`);
  let body = null;
  try { body = await res.json(); } catch (_) { throw new Error("respuesta del puente no es JSON válido"); }
  if (!body || body.ok !== true) throw new Error((body && body.reason) || "el puente respondió ok:false");
  return body;
}

export default async function handler(req, res) {
  try {
    const session = await getFreshSession(req);
    if (!session) return res.status(401).json({ ok: false, reason: "sin_sesion" });

    if (req.method === "GET") {
      const fileId = String(req.query.fileId || "").trim();
      if (!fileId) return res.status(400).json({ ok: false, reason: "sin_fileId" });
      if (!FILE_ID_OK.test(fileId)) return res.status(400).json({ ok: false, reason: "fileId_invalido" });
      const data = await llamarPuente({ evento: "foto_descargar", fileId });
      if (!data.dataBase64) return res.status(502).json({ ok: false, reason: "puente_sin_datos" });
      const buffer = Buffer.from(data.dataBase64, "base64");
      // El tipo sale de los bytes, NO de data.mimeType (que viene de lo que declaró quien subió el archivo).
      const tipo = detectarImagen(buffer);
      if (!tipo) return res.status(415).json({ ok: false, reason: "formato_no_permitido" });
      res.setHeader("Content-Type", tipo);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("Content-Disposition", 'inline; filename="foto"');
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      return res.status(200).send(buffer);
    }

    if (req.method === "POST") {
      let body = {};
      try {
        body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      } catch (e) {
        return res.status(400).json({ ok: false, reason: "cuerpo_invalido" });
      }
      const { dataBase64, filename } = body;
      if (!dataBase64 || typeof dataBase64 !== "string") return res.status(400).json({ ok: false, reason: "sin_datos" });
      if (dataBase64.length > MAX_BASE64) return res.status(413).json({ ok: false, reason: "foto_demasiado_grande" });
      const tipoReal = detectarImagen(Buffer.from(dataBase64, "base64"));
      if (!tipoReal) return res.status(400).json({ ok: false, reason: "formato_no_permitido" });
      // Se manda al puente el tipo REAL detectado, no el que declaró el cliente.
      const data = await llamarPuente({ evento: "foto_subir", dataBase64, mimeType: tipoReal, filename: nombreSeguro(filename) });
      // Defensa extra: si el puente respondió ok:true pero sin fileId (por ejemplo porque el
      // Apps Script desplegado es una versión vieja que no reconoce evento "foto_subir" y cae
      // al flujo de correo de cotización, que también responde ok:true), no lo dejamos pasar
      // como éxito silencioso: eso hacía que la foto pareciera subida en la app pero nunca
      // quedara guardada en Drive, sin ningún error visible para el usuario.
      if (!data.fileId) {
        console.error("[fotos-visitas] el puente respondió ok pero sin fileId; revisar que el Code.gs desplegado sea la versión con soporte de fotos", data);
        return res.status(502).json({ ok: false, reason: "puente_sin_fileid" });
      }
      return res.status(200).json({ ok: true, fileId: data.fileId });
    }

    if (req.method === "DELETE") {
      const fileId = String(req.query.fileId || "").trim();
      if (!fileId) return res.status(400).json({ ok: false, reason: "sin_fileId" });
      if (!FILE_ID_OK.test(fileId)) return res.status(400).json({ ok: false, reason: "fileId_invalido" });
      await llamarPuente({ evento: "foto_eliminar", fileId });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, reason: "metodo no soportado" });
  } catch (e) {
    console.error("[fotos-visitas] error", e);
    return res.status(502).json({ ok: false, reason: "error_puente", detalle: String(e.message || e) });
  }
}
