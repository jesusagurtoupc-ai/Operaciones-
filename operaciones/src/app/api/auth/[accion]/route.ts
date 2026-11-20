import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql, ensureSchema } from "@/lib/server/db";
import { createSession, cerrarSesion, getCurrentUser, olvidarUsuario, OPCIONES_COOKIE, type Rol } from "@/lib/server/auth";
import { COOKIE_CAMPUS } from "@/lib/shared";
import {
  bloqueado, registrarFallo, limpiarFallos, errorClaveNueva, MAX_FALLOS_USUARIO, MAX_FALLOS_IP,
} from "@/lib/server/utils";
import { registrarEvento, ipDe } from "@/lib/server/auditoria";

/**
 * Sesión, en una sola ruta (mismas direcciones de siempre):
 *  POST /api/auth/login     → iniciar sesión
 *  POST /api/auth/logout    → cerrar sesión
 *  GET  /api/auth/me        → quién está en sesión
 *  POST /api/auth/password  → cambiar la propia contraseña
 *  POST /api/auth/campus    → elegir el campus que se ve (solo entre los permitidos)
 */
type Params = { params: Promise<{ accion: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { accion } = await params;
  if (accion === "me") return quienSoy();
  return NextResponse.json({ error: "No encontrado" }, { status: 404 });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { accion } = await params;
  if (accion === "login") return iniciarSesion(req);
  if (accion === "logout") return salir(req);
  if (accion === "password") return cambiarClave(req);
  if (accion === "campus") return elegirCampus(req);
  return NextResponse.json({ error: "No encontrado" }, { status: 404 });
}

// ───────── iniciar sesión ─────────

// Hash de relleno: se compara igual cuando el usuario no existe, para que
// el tiempo de respuesta no delate qué usuarios están registrados. Se calcula en segundo plano (antes
// era hashSync al cargar el módulo: bloqueaba ~80 ms cada arranque en frío del inicio de sesión).
const HASH_RELLENO: Promise<string> = bcrypt.hash("relleno-sin-uso", 10);

async function iniciarSesion(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const username = String(body.username ?? "").trim().toLowerCase().slice(0, 100);
    const password = String(body.password ?? "");

    const ip = ipDe(req); // recortada a 64 caracteres: la clave del contador de intentos no crece sin límite
    const claveUsuario = `u:${username}|${ip}`;
    const claveIp = `ip:${ip}`;

    await ensureSchema();
    if (
      (await bloqueado(claveUsuario, MAX_FALLOS_USUARIO)) ||
      (await bloqueado(claveIp, MAX_FALLOS_IP))
    ) {
      await registrarEvento("login_bloqueado", username || null, "demasiados intentos fallidos", ip);
      return NextResponse.json(
        { error: "Demasiados intentos fallidos. Espera 15 minutos e intenta de nuevo." },
        { status: 429 }
      );
    }

    const rows = await sql`
      SELECT username, password_hash, rol, activo
      FROM usuarios WHERE username = ${username}
    `;
    const u = rows[0] as
      | { username: string; password_hash: string; rol: Rol; activo: boolean }
      | undefined;

    const ok = await bcrypt.compare(password, u?.password_hash ?? (await HASH_RELLENO));
    if (!u || !ok || !u.activo) {
      await Promise.all([
        registrarFallo(claveUsuario),
        registrarFallo(claveIp),
        registrarEvento("login_fallo", username || null, !u ? "usuario inexistente" : !u.activo ? "usuario desactivado" : "contraseña incorrecta", ip),
      ]);
      return NextResponse.json(
        { error: "Usuario o contraseña incorrectos" },
        { status: 401 }
      );
    }

    await limpiarFallos(claveUsuario);
    await createSession(u.username, u.rol);
    await registrarEvento("login_ok", u.username, "", ip);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "No se pudo iniciar sesión. Intenta de nuevo." },
      { status: 500 }
    );
  }
}

// ───────── cerrar sesión ─────────
async function salir(req: Request) {
  const user = await getCurrentUser().catch(() => null);
  await cerrarSesion();
  if (user) await registrarEvento("logout", user.username, "", ipDe(req));
  return NextResponse.json({ ok: true });
}

// ───────── quién está en sesión ─────────
async function quienSoy() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  return NextResponse.json({ user });
}

// ───────── elegir campus ─────────
async function elegirCampus(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { campus?: string } | null;
  const elegido = user.campusPermitidos.find((c) => c === body?.campus);
  if (!elegido) return NextResponse.json({ error: "No tienes acceso a ese campus" }, { status: 403 });
  const res = NextResponse.json({ ok: true, campus: elegido });
  res.cookies.set(COOKIE_CAMPUS, elegido, { ...OPCIONES_COOKIE, maxAge: 60 * 60 * 24 * 365 });
  return res;
}

// ───────── cambiar la contraseña ─────────
// Intentos fallidos de "contraseña actual" permitidos en 15 minutos. Sin límite, quien tuviera
// una sesión robada podía adivinar la contraseña actual sin freno y quedarse con la cuenta.
const MAX_FALLOS_CLAVE_ACTUAL = 5;

/** Cambia la contraseña del usuario en sesión (cualquier rol). */
async function cambiarClave(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const actual = String(body.actual ?? "");
    const nueva = String(body.nueva ?? "");

    const errClave = errorClaveNueva(nueva);
    if (errClave) {
      return NextResponse.json({ error: errClave.replace("La contraseña", "La nueva contraseña") }, { status: 400 });
    }
    if (nueva === actual) {
      return NextResponse.json(
        { error: "La nueva contraseña debe ser distinta de la actual" },
        { status: 400 }
      );
    }

    await ensureSchema();
    const claveLimite = `pw:${user.username}`;
    if (await bloqueado(claveLimite, MAX_FALLOS_CLAVE_ACTUAL)) {
      return NextResponse.json(
        { error: "Demasiados intentos fallidos. Espera 15 minutos e intenta de nuevo." },
        { status: 429 }
      );
    }

    const rows = await sql`
      SELECT password_hash FROM usuarios WHERE username = ${user.username}
    `;
    const hash = (rows[0] as { password_hash: string } | undefined)?.password_hash;
    if (!hash || !(await bcrypt.compare(actual, hash))) {
      await registrarFallo(claveLimite);
      return NextResponse.json(
        { error: "La contraseña actual no es correcta" },
        { status: 400 }
      );
    }
    await limpiarFallos(claveLimite);

    // sesiones_desde = ahora, con el reloj de ESTA app (el mismo que pone el `iat` del token; si se
    // usara el de la base de datos y difirieran un segundo, la sesión renovada de abajo se
    // rechazaría). Las demás sesiones abiertas de esta cuenta (p. ej. una robada) dejan de valer;
    // la de quien cambia la clave se renueva para que siga conectado.
    await sql`
      UPDATE usuarios
      SET password_hash = ${await bcrypt.hash(nueva, 10)}, sesiones_desde = to_timestamp(${Math.floor(Date.now() / 1000)})
      WHERE username = ${user.username}
    `;
    olvidarUsuario(user.username);
    await createSession(user.username, user.rol);
    await registrarEvento("clave_cambiada", user.username, "cambió su propia contraseña", ipDe(req));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "No se pudo cambiar la contraseña" },
      { status: 500 }
    );
  }
}
