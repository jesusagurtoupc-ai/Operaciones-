import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { sql, ensureSchema } from "@/lib/server/db";

const COOKIE_NAME = "correctivos_session";
const alg = "HS256";

// Cuánto se recuerda el rol/estado de un usuario antes de volver a consultarlo.
// En otras instancias del servidor un cambio de rol puede tardar hasta este tiempo.
const TTL_USUARIO_MS = 60_000; // un cambio de clave o baja de usuario tarda hasta 1 min en reflejarse en otras instancias
// La caché vive en globalThis (no en una variable del módulo) porque el proxy y las
// rutas de la API se compilan como módulos separados: con una variable normal cada uno
// tenía su propia copia, y olvidarUsuario() (que se llama al desactivar a alguien o
// cambiarle el rol) solo limpiaba la de las rutas; el proxy seguía creyendo en la suya
// hasta 1 minuto (TTL_USUARIO_MS). Con globalThis comparten la misma y el cambio aplica al instante.
const g = globalThis as typeof globalThis & {
  __correctivosCacheUsuarios?: Map<string, { usuario: UsuarioSesion; desde: number; cerradas: Set<string>; vence: number }>;
};
const cacheUsuarios = (g.__correctivosCacheUsuarios ??= new Map());

export type Rol = "admin" | "lectura";
export type UsuarioSesion = { username: string; rol: Rol; /** Páginas permitidas; null = todas. */ paginas: string[] | null };

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "Falta la variable de entorno SESSION_SECRET (defínela en .env.local o en Vercel)."
    );
  }
  // Con una clave corta o adivinable, cualquiera podría fabricar una sesión válida con el nombre de
  // otro usuario. En producción se exige un mínimo (openssl rand -hex 32 da 64 caracteres).
  if (process.env.NODE_ENV === "production" && secret.length < 32) {
    throw new Error(
      "SESSION_SECRET es demasiado corta (mínimo 32 caracteres). Genera una con: openssl rand -hex 32"
    );
  }
  return new TextEncoder().encode(secret);
}

function firmarToken(username: string, rol: Rol) {
  return new SignJWT({ username, rol })
    .setProtectedHeader({ alg })
    // Identificador único de esta sesión: permite cerrarla en el servidor (ver cerrarSesion).
    .setJti(globalThis.crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
}

/** Opciones de la cookie de sesión (las mismas al crearla y al renovarla). */
export const OPCIONES_COOKIE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 7, // 7 días
};

export async function createSession(username: string, rol: Rol) {
  const token = await firmarToken(username, rol);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, OPCIONES_COOKIE);
}

// La sesión dura 7 días desde la última renovación: quien usa la app al menos una vez por semana no
// tiene que volver a iniciar sesión. Se renueva como mucho una vez al día.
const RENOVAR_TRAS_S = 24 * 60 * 60;

/**
 * Si el token (ya validado) tiene más de un día, devuelve uno nuevo para el mismo usuario; si no,
 * null. Lo usa el proxy para alargar la sesión de quien sigue trabajando.
 */
export async function tokenRenovado(token: string, usuario: UsuarioSesion): Promise<string | null> {
  const payload = await verifyToken(token);
  const iat = Number(payload?.iat) || 0;
  if (!payload || Date.now() / 1000 - iat < RENOVAR_TRAS_S) return null;
  return firmarToken(usuario.username, usuario.rol);
}

export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: [alg] });
    return payload as { username: string; rol?: Rol; iat?: number; exp?: number; jti?: string };
  } catch {
    return null;
  }
}

/**
 * Valida el token Y consulta la base de datos: el rol y el estado
 * "activo" se toman de la tabla `usuarios`, no del token. Así, si un
 * administrador desactiva a alguien o le cambia el rol, el cambio
 * aplica de inmediato y no hay que esperar a que venza la sesión.
 */
export async function getUserFromToken(
  token: string
): Promise<UsuarioSesion | null> {
  const payload = await verifyToken(token);
  if (!payload?.username) return null;

  // `desde` = momento (en segundos) desde el que valen las sesiones de este usuario; un token
  // emitido antes (iat menor) se rechaza. Se compara en CADA petición, también con la caché.
  const iat = Number(payload.iat) || 0;
  // Sesión cerrada con "Cerrar sesión" (su identificador está en sesiones_cerradas).
  const jti = typeof payload.jti === "string" ? payload.jti : "";
  const valida = (desde: number, cerradas: Set<string>) => iat >= desde && !(jti && cerradas.has(jti));

  // Caché de pocos segundos: cada petición pasa por el proxy y por la ruta,
  // y sin esto cada una consultaba la base de datos dos veces.
  const guardado = cacheUsuarios.get(payload.username);
  if (guardado && guardado.vence > Date.now()) {
    return valida(guardado.desde, guardado.cerradas) ? guardado.usuario : null;
  }

  const buscarUsuario = () => sql`
    SELECT username, rol, paginas,
           COALESCE(FLOOR(EXTRACT(EPOCH FROM sesiones_desde)), 0)::bigint AS desde,
           ARRAY(SELECT c.jti FROM sesiones_cerradas c
                 WHERE c.username = usuarios.username AND c.expira > now()) AS cerradas
    FROM usuarios
    WHERE username = ${payload.username} AND activo = true
  `;
  // La comprobación del esquema y la búsqueda del usuario van a la vez (antes una esperaba a la otra,
  // y en cada arranque en frío eso sumaba una ida y vuelta más a la base). Si la búsqueda falla porque
  // el esquema aún no está al día (columna o tabla que falta), se espera a que se aplique y se repite.
  let rows;
  try {
    [, rows] = await Promise.all([ensureSchema(), buscarUsuario()]);
  } catch {
    await ensureSchema();
    rows = await buscarUsuario();
  }
  if (rows.length === 0) {
    cacheUsuarios.delete(payload.username);
    return null;
  }
  const usuario = { username: rows[0].username as string, rol: rows[0].rol as Rol, paginas: (rows[0].paginas as string[] | null) ?? null };
  const desde = Number(rows[0].desde) || 0;
  const cerradas = new Set<string>((rows[0].cerradas as string[] | null) ?? []);
  cacheUsuarios.set(payload.username, { usuario, desde, cerradas, vence: Date.now() + TTL_USUARIO_MS });
  return valida(desde, cerradas) ? usuario : null;
}

/**
 * "Cerrar sesión": además de borrar la cookie, anota la sesión como cerrada en la base, así ese token
 * deja de valer aunque alguien lo hubiera copiado. Solo cierra ESTA sesión (las de otros equipos del
 * mismo usuario siguen abiertas). En esta instancia aplica al instante; en las demás, en máx. 1 minuto.
 */
export async function cerrarSesion(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) {
    const payload = await verifyToken(token);
    if (payload?.username && typeof payload.jti === "string") {
      const expira = Number(payload.exp) || Math.floor(Date.now() / 1000) + OPCIONES_COOKIE.maxAge;
      try {
        await ensureSchema();
        await sql`
          INSERT INTO sesiones_cerradas (jti, username, expira)
          VALUES (${payload.jti}, ${payload.username}, to_timestamp(${expira}))
          ON CONFLICT (jti) DO NOTHING
        `;
        // Limpieza: las ya vencidas no hace falta recordarlas.
        await sql`DELETE FROM sesiones_cerradas WHERE expira < now()`;
      } catch (e) {
        console.error("No se pudo registrar el cierre de sesión", e instanceof Error ? e.message : e);
      }
      olvidarUsuario(payload.username);
    }
  }
  cookieStore.delete(COOKIE_NAME);
}

/** Olvida al usuario guardado (se llama al cambiarle el rol, desactivarlo o eliminarlo). */
export function olvidarUsuario(username: string) {
  cacheUsuarios.delete(username);
}

export async function getCurrentUser(): Promise<UsuarioSesion | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return getUserFromToken(token);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
