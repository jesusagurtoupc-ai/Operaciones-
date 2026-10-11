// Reglas de contraseña compartidas entre el servidor y los formularios.
// Solo se exigen al CREAR o CAMBIAR una contraseña; las existentes siguen
// funcionando para entrar aunque sean más cortas.
export const MIN_PASSWORD = 10;
export const MSG_MIN_PASSWORD = `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`;

// Coste de bcrypt para contraseñas nuevas. Las antiguas (coste 10) se
// actualizan solas la próxima vez que su dueño inicia sesión.
export const BCRYPT_COSTO = 12;

// bcrypt solo usa los primeros 72 BYTES de la contraseña: lo que pase de ahí se ignora
// sin avisar. Se rechaza en vez de aceptar una clave más débil de lo que parece.
export const MAX_PASSWORD_BYTES = 72;
export const MSG_MAX_PASSWORD = `La contraseña no puede superar ${MAX_PASSWORD_BYTES} bytes (unos ${MAX_PASSWORD_BYTES} caracteres; los acentos y emojis ocupan más)`;
export const MSG_PASSWORD_COMUN = "Esa contraseña es demasiado común; elige otra";

// Contraseñas muy usadas (y variantes típicas del propio sistema). Se comparan sin
// distinguir mayúsculas. No pretende ser una lista completa: frena lo más obvio.
const COMUNES = new Set([
  "1234567890", "12345678910", "0123456789", "1234567891", "0987654321", "1111111111", "0000000000",
  "password", "password1", "password12", "password123", "password1234", "passw0rd123", "p@ssw0rd123",
  "contrasena", "contrasena1", "contrasena12", "contrasena123", "contrasena1234", "contraseña", "contraseña123",
  "qwertyuiop", "qwerty12345", "qwerty123456", "qwertyuiop123", "asdfghjkl1", "asdfghjklñ", "zxcvbnm123",
  "iloveyou12", "iloveyou123", "letmein123", "welcome123", "welcome1234", "administrador", "administrador1",
  "administrador123", "admin12345", "admin123456", "admin1234567", "admin@12345", "abc1234567", "abcd123456",
  "abcdefghij", "correctivos", "correctivos1", "correctivos123", "correctivos2024", "correctivos2025",
  "correctivos2026", "upc1234567", "upc123456789", "bienvenido1", "bienvenido123", "cambiame123", "cambiame1234",
  "temporal123", "temporal1234", "clavetemporal", "123456789a", "a123456789", "1q2w3e4r5t", "q1w2e3r4t5",
  "peru123456", "lima123456",
]);

/**
 * Reglas al CREAR o CAMBIAR una contraseña. Devuelve el mensaje de error o null si sirve.
 * `usuario` (opcional) evita que la clave sea el propio nombre de usuario.
 */
export function errorContrasena(password: string, usuario?: string): string | null {
  if (password.length < MIN_PASSWORD) return MSG_MIN_PASSWORD;
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) return MSG_MAX_PASSWORD;
  const p = password.trim().toLowerCase();
  if (COMUNES.has(p)) return MSG_PASSWORD_COMUN;
  if (usuario && p === usuario.trim().toLowerCase()) return "La contraseña no puede ser igual al nombre de usuario";
  // Un solo carácter repetido ("aaaaaaaaaaaa") o una secuencia numérica corrida.
  if (/^(.)\1+$/.test(p) || "01234567890123456789".includes(p) || "98765432109876543210".includes(p)) {
    return MSG_PASSWORD_COMUN;
  }
  return null;
}
