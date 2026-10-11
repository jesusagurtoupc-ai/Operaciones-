// Validación de secretos de configuración. Evita arrancar en producción con
// valores de ejemplo copiados de `.env.example` o con claves demasiado cortas.

export const MIN_SESSION_SECRET = 32;

const EJEMPLOS = /cambia-esto|pon-aqui|changeme|change-me|ejemplo|example|secreto-solo|contrasena-inicial|^admin$|^password$/i;

/** true si el valor parece un texto de relleno y no un secreto real. */
export function esValorDeEjemplo(valor: string): boolean {
  return EJEMPLOS.test(valor.trim());
}

/** Devuelve el motivo por el que SESSION_SECRET no sirve, o null si es válido. */
export function errorSessionSecret(secret: string | undefined): string | null {
  if (!secret) return "Falta la variable de entorno SESSION_SECRET (defínela en .env.local o en Vercel).";
  if (secret.length < MIN_SESSION_SECRET) {
    return `SESSION_SECRET debe tener al menos ${MIN_SESSION_SECRET} caracteres (genera una con: openssl rand -hex 32).`;
  }
  if (esValorDeEjemplo(secret)) {
    return "SESSION_SECRET tiene un valor de ejemplo; genera uno aleatorio (openssl rand -hex 32).";
  }
  return null;
}

/** Nombre del administrador inicial: INITIAL_ADMIN_USER si es válido, o "admin". */
export function nombreAdminInicial(valor: string | undefined): string {
  const v = (valor ?? "").trim().toLowerCase();
  return /^[a-z0-9._-]{3,30}$/.test(v) ? v : "admin";
}
