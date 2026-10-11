import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql, ensureSchema } from "@/lib/server/db";
import { getCurrentUser, olvidarUsuario } from "@/lib/server/auth";
import { registrarUsuario } from "@/lib/server/auditoriaUsuarios";
import { bloqueado, registrarFallo } from "@/lib/server/limiteLogin";
import { cifrarSecreto, descifrarSecreto, generarSecreto, generarRespaldos, uriOtpauth, verificarTotp } from "@/lib/server/mfa";

const MAX_FALLOS_MFA = 10;
type Fila = { password_hash: string; mfa_secreto: string | null; mfa_activo: boolean; mfa_ultimo_paso: string | number | null };

async function cargar(username: string) {
  const rows = await sql`
    SELECT password_hash, mfa_secreto, mfa_activo, mfa_ultimo_paso FROM usuarios WHERE username = ${username}
  `;
  return rows[0] as Fila | undefined;
}

/** ¿Tiene el usuario en sesión la verificación en dos pasos activada? */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await ensureSchema();
    return NextResponse.json({ activo: (await cargar(user.username))?.mfa_activo === true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo consultar" }, { status: 500 });
  }
}

/**
 * Activar o desactivar la verificación en dos pasos del usuario en sesión.
 *  - { accion: "iniciar", password }            → genera un secreto (aún inactivo) y lo devuelve.
 *  - { accion: "confirmar", codigo }            → comprueba un código y activa la verificación.
 *  - { accion: "desactivar", password, codigo } → exige contraseña Y código vigente.
 *  - { accion: "respaldos", password, codigo }  → genera 8 códigos de respaldo nuevos (anulan los anteriores).
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    await ensureSchema();
    const body = await req.json().catch(() => ({}));
    const accion = String(body.accion ?? "");
    const password = String(body.password ?? "");
    const codigo = String(body.codigo ?? "");

    const claveLimite = `m|${encodeURIComponent(user.username.slice(0, 100))}`;
    if (await bloqueado(claveLimite, MAX_FALLOS_MFA)) {
      return NextResponse.json({ error: "Demasiados intentos. Espera 15 minutos." }, { status: 429 });
    }
    const fila = await cargar(user.username);
    if (!fila) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const fallo = async (mensaje: string) => {
      await registrarFallo(claveLimite);
      return NextResponse.json({ error: mensaje }, { status: 400 });
    };

    if (accion === "iniciar") {
      if (fila.mfa_activo) return NextResponse.json({ error: "La verificación en dos pasos ya está activa" }, { status: 400 });
      if (!(await bcrypt.compare(password, fila.password_hash))) return fallo("La contraseña no es correcta");
      const secreto = generarSecreto();
      await sql`UPDATE usuarios SET mfa_secreto = ${cifrarSecreto(secreto)}, mfa_activo = false WHERE username = ${user.username}`;
      return NextResponse.json({ secreto, uri: uriOtpauth(user.username, secreto) });
    }

    if (accion === "confirmar") {
      if (fila.mfa_activo || !fila.mfa_secreto) {
        return NextResponse.json({ error: "Inicia primero la activación" }, { status: 400 });
      }
      const paso = verificarTotp(descifrarSecreto(fila.mfa_secreto), codigo, Date.now(), Number(fila.mfa_ultimo_paso ?? 0));
      if (paso === null) return fallo("Código incorrecto o vencido");
      const { codigos, huellas } = generarRespaldos();
      await sql`
        UPDATE usuarios SET mfa_activo = true, mfa_ultimo_paso = ${paso}, mfa_respaldo = ${JSON.stringify(huellas)}::jsonb
        WHERE username = ${user.username}
      `;
      olvidarUsuario(user.username); // el proxy y las rutas deben ver el 2FA activo al instante
      await registrarUsuario(user.username, "Activó la verificación en dos pasos", user.username);
      return NextResponse.json({ ok: true, respaldo: codigos }); // se muestran UNA sola vez
    }

    if (accion === "desactivar") {
      if (!fila.mfa_activo || !fila.mfa_secreto) {
        return NextResponse.json({ error: "La verificación en dos pasos no está activa" }, { status: 400 });
      }
      if (!(await bcrypt.compare(password, fila.password_hash))) return fallo("La contraseña no es correcta");
      const paso = verificarTotp(descifrarSecreto(fila.mfa_secreto), codigo, Date.now(), Number(fila.mfa_ultimo_paso ?? 0));
      if (paso === null) return fallo("Código incorrecto o vencido");
      await sql`UPDATE usuarios SET mfa_activo = false, mfa_secreto = NULL, mfa_ultimo_paso = 0, mfa_respaldo = '[]'::jsonb WHERE username = ${user.username}`;
      olvidarUsuario(user.username);
      await registrarUsuario(user.username, "Desactivó la verificación en dos pasos", user.username);
      return NextResponse.json({ ok: true });
    }

    if (accion === "respaldos") {
      // Códigos nuevos: invalidan los anteriores. Exige contraseña Y un código vigente.
      if (!fila.mfa_activo || !fila.mfa_secreto) {
        return NextResponse.json({ error: "La verificación en dos pasos no está activa" }, { status: 400 });
      }
      if (!(await bcrypt.compare(password, fila.password_hash))) return fallo("La contraseña no es correcta");
      const paso = verificarTotp(descifrarSecreto(fila.mfa_secreto), codigo, Date.now(), Number(fila.mfa_ultimo_paso ?? 0));
      if (paso === null) return fallo("Código incorrecto o vencido");
      const { codigos, huellas } = generarRespaldos();
      await sql`UPDATE usuarios SET mfa_ultimo_paso = ${paso}, mfa_respaldo = ${JSON.stringify(huellas)}::jsonb WHERE username = ${user.username}`;
      await registrarUsuario(user.username, "Generó nuevos códigos de respaldo del 2FA", user.username);
      return NextResponse.json({ ok: true, respaldo: codigos });
    }

    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo completar la operación" }, { status: 500 });
  }
}
