import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql, ensureSchema } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/auth";
import { contarIntento, limpiarFallos } from "@/lib/server/limiteLogin";
import { descifrarSecreto, verificarTotp } from "@/lib/server/mfa";
import { registrarUsuario } from "@/lib/server/auditoriaUsuarios";
import { emitirReauth, opcionesCookieReauth, REAUTH_COOKIE_NAME } from "@/lib/server/reauth";

/** Confirma la contraseña (y el código del 2FA, si lo tiene) del administrador en sesión. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser(true);
  if (user?.rol !== "admin") {
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  }
  try {
    await ensureSchema();
    const body = await req.json().catch(() => ({}));
    const password = String(body.password ?? "");
    const codigo = String(body.codigo ?? "");

    const claveLimite = `r|${encodeURIComponent(user.username.slice(0, 100))}`;
    if ((await contarIntento(claveLimite)) > 10) {
      return NextResponse.json({ error: "Demasiados intentos. Espera 15 minutos." }, { status: 429 });
    }
    const rows = await sql`
      SELECT password_hash, sesion_version, mfa_activo, mfa_secreto, mfa_ultimo_paso
      FROM usuarios WHERE username = ${user.username} AND activo = true
    `;
    const f = rows[0] as
      | { password_hash: string; sesion_version: number; mfa_activo: boolean; mfa_secreto: string | null; mfa_ultimo_paso: string | number | null }
      | undefined;
    if (!f || password.length > 1024 || !(await bcrypt.compare(password, f.password_hash))) {
      return NextResponse.json({ error: "La contraseña no es correcta" }, { status: 400 });
    }
    if (f.mfa_activo) {
      if (!f.mfa_secreto) {
        return NextResponse.json({ error: "No se pudo verificar tu segundo paso. Contacta a otro administrador." }, { status: 403 });
      }
      if (!codigo.trim()) {
        return NextResponse.json({ error: "Escribe el código de tu app de verificación", pideCodigo: true }, { status: 400 });
      }
      const paso = verificarTotp(descifrarSecreto(f.mfa_secreto), codigo, Date.now(), Number(f.mfa_ultimo_paso ?? 0));
      const aceptado =
        paso !== null &&
        (
          await sql`
            UPDATE usuarios SET mfa_ultimo_paso = ${paso}
            WHERE username = ${user.username} AND mfa_ultimo_paso < ${paso} RETURNING 1
          `
        ).length > 0;
      if (!aceptado) {
        return NextResponse.json(
          { error: "Código incorrecto, vencido o ya usado (espera al siguiente)" },
          { status: 400 }
        );
      }
    }
    await limpiarFallos(claveLimite);
    await registrarUsuario(user.username, "Confirmó su identidad para una acción de administrador", user.username);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(REAUTH_COOKIE_NAME, await emitirReauth(user.username, f.sesion_version), opcionesCookieReauth());
    return res;
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo confirmar la identidad" }, { status: 500 });
  }
}
