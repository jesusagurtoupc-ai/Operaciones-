import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Verificación en dos pasos (TOTP, RFC 6238): código de 6 dígitos que cambia cada 30 s,
// compatible con Google Authenticator, Microsoft Authenticator, Authy, 1Password, etc.
// Sin dependencias: solo el módulo `crypto` de Node.

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PERIODO_MS = 30_000;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let valor = 0;
  let salida = "";
  for (const byte of buf) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += B32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += B32[(valor << (5 - bits)) & 31];
  return salida;
}

export function base32Decode(texto: string): Buffer {
  const limpio = texto.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const c of limpio) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error("Secreto base32 inválido");
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Secreto nuevo de 160 bits en base32. */
export function generarSecreto(): string {
  return base32Encode(randomBytes(20));
}

/** Código de 6 dígitos para un paso de tiempo (paso = segundos Unix / 30). */
export function codigoTotp(secreto: string, paso: number): string {
  const mensaje = Buffer.alloc(8);
  mensaje.writeBigUInt64BE(BigInt(paso));
  const h = createHmac("sha1", base32Decode(secreto)).update(mensaje).digest();
  const o = h[19] & 0x0f;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

/**
 * Comprueba un código admitiendo ±1 paso (desfase de reloj). Devuelve el paso aceptado o
 * null. Solo vale un paso MAYOR que `ultimoPaso`: un código ya usado no se puede repetir.
 */
export function verificarTotp(secreto: string, codigo: string, ahoraMs = Date.now(), ultimoPaso = 0): number | null {
  const limpio = codigo.replace(/\s/g, "");
  if (!/^\d{6}$/.test(limpio)) return null;
  const actual = Math.floor(ahoraMs / PERIODO_MS);
  let aceptado: number | null = null;
  for (const d of [-1, 0, 1]) {
    const paso = actual + d;
    const coincide = timingSafeEqual(Buffer.from(codigoTotp(secreto, paso)), Buffer.from(limpio));
    if (coincide && paso > ultimoPaso) aceptado = paso;
  }
  return aceptado;
}

export function uriOtpauth(usuario: string, secreto: string): string {
  return `otpauth://totp/Correctivos:${encodeURIComponent(usuario)}?secret=${secreto}&issuer=Correctivos&algorithm=SHA1&digits=6&period=30`;
}

// El secreto se guarda CIFRADO (AES-256-GCM): una copia de la base de datos sola no basta para
// generar códigos. La clave sale de MFA_KEY si está definida (recomendado: así una filtración de
// SESSION_SECRET no destapa los secretos TOTP) y, si no, de SESSION_SECRET (como antes).
// Los secretos cifrados con SESSION_SECRET siguen descifrándose tras definir MFA_KEY.
function clave(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("Falta SESSION_SECRET");
  return createHash("sha256").update(`mfa-secreto:${s}`).digest();
}

function claveMfa(): Buffer {
  const k = process.env.MFA_KEY;
  if (k && k.length >= 32) return createHash("sha256").update(`mfa-cifrado:${k}`).digest();
  return clave();
}

export function cifrarSecreto(secreto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", claveMfa(), iv);
  const ct = Buffer.concat([c.update(secreto, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64")).join(".");
}

function descifrarCon(k: Buffer, guardado: string): string {
  const [iv, tag, ct] = guardado.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", k, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

export function descifrarSecreto(guardado: string): string {
  try {
    return descifrarCon(claveMfa(), guardado);
  } catch (err) {
    // Secreto anterior a MFA_KEY: se intenta con la clave derivada de SESSION_SECRET.
    if (process.env.MFA_KEY) return descifrarCon(clave(), guardado);
    throw err;
  }
}

// ---- Códigos de respaldo: 8 códigos de un solo uso por si se pierde el teléfono ----
// Se muestran UNA vez; en la base solo queda su huella (HMAC con una clave derivada de SESSION_SECRET).

export const CANTIDAD_RESPALDOS = 8;

/** Quita guiones y espacios y pasa a mayúsculas: "abcde-fghij" → "ABCDEFGHIJ". */
export function normalizarRespaldo(texto: string): string {
  return texto.replace(/[\s-]/g, "").toUpperCase();
}

export function esFormatoRespaldo(texto: string): boolean {
  return /^[A-Z2-7]{10}$/.test(normalizarRespaldo(texto));
}

export function huellaRespaldo(codigo: string): string {
  return createHmac("sha256", clave()).update(`respaldo:${normalizarRespaldo(codigo)}`).digest("hex");
}

/** Códigos legibles (XXXXX-XXXXX) y las huellas que se guardan. */
export function generarRespaldos(): { codigos: string[]; huellas: string[] } {
  const codigos = Array.from({ length: CANTIDAD_RESPALDOS }, () => {
    const c = base32Encode(randomBytes(7)).slice(0, 10);
    return `${c.slice(0, 5)}-${c.slice(5)}`;
  });
  return { codigos, huellas: codigos.map(huellaRespaldo) };
}
