import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql, ensureSchema } from "@/lib/server/db";
import { createSession, type Rol } from "@/lib/server/auth";
import { contarIntentosLogin, devolverIntento, limpiarFallos, limitesLogin } from "@/lib/server/limiteLogin";
import { BCRYPT_COSTO } from "@/lib/shared/passwords";
import { ipCliente } from "@/lib/server/ip";
import { registrarAcceso } from "@/lib/server/auditoriaAccesos";
import { descifrarSecreto, verificarTotp, esFormatoRespaldo, huellaRespaldo } from "@/lib/server/mfa";

// Hash de relleno: se compara igual cuando el usuario no existe, para que
// el tiempo de respuesta no delate qué usuarios están registrados.
const HASH_RELLENO = bcrypt.hashSync("relleno-sin-uso", BCRYPT_COSTO);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const username = String(body.username ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");

    // Tope de tamaño: evita gastar CPU en bcrypt con cuerpos enormes.
    if (username.length > 100 || password.length > 1024) {
      return NextResponse.json({ error: "Usuario o contraseña incorrectos" }, { status: 401 });
    }

    const limites = limitesLogin(username, ipCliente(req));
    const clave = limites[0].clave;
    await ensureSchema();
    // El intento se cuenta ANTES de verificar (atómico): las peticiones en paralelo no pueden
    // adivinar más veces que el tope. Un éxito devuelve el suyo; un fallo ya está contado.
    if (await contarIntentosLogin(limites)) {
      return NextResponse.json(
        { error: "Demasiados intentos fallidos. Espera 15 minutos e intenta de nuevo." },
        { status: 429 }
      );
    }

    const rows = await sql`
      SELECT username, password_hash, rol, activo, sesion_version, debe_cambiar_clave,
             mfa_activo, mfa_secreto, mfa_ultimo_paso
      FROM usuarios WHERE username = ${username}
    `;
    const u = rows[0] as
      | { username: string; password_hash: string; rol: Rol; activo: boolean; sesion_version: number; debe_cambiar_clave: boolean; mfa_activo?: boolean; mfa_secreto?: string | null; mfa_ultimo_paso?: string | number | null }
      | undefined;

    const ok = await bcrypt.compare(password, u?.password_hash ?? HASH_RELLENO);
    if (!u || !ok || !u.activo) {
      // Solo se guarda el nombre si es de un usuario real: lo escrito en ese campo puede ser, por
      // error, una contraseña, y no debe quedar 180 días en el registro.
      await registrarAcceso("login_fallo", u?.username ?? null, req, u ? undefined : "usuario desconocido");
      return NextResponse.json(
        { error: "Usuario o contraseña incorrectos" },
        { status: 401 }
      );
    }

    // Segundo paso: con la verificación en dos pasos activa, la contraseña sola no basta.
    // Sin código se pide (aún no hay sesión ni se limpian los fallos); un código malo cuenta
    // como fallo en los mismos contadores del login, y un código ya usado no se acepta de nuevo.
    if (u.mfa_activo === true) {
      // Si está activo pero no hay secreto utilizable, se NIEGA el acceso (nunca se salta el segundo paso).
      if (!u.mfa_secreto) {
        console.error(`MFA activo sin secreto para ${u.username}`);
        return NextResponse.json({ error: "No se pudo verificar tu segundo paso. Contacta a un administrador." }, { status: 403 });
      }
      const codigo = String(body.codigo ?? "");
      if (!codigo.trim()) {
        await Promise.all(limites.map((l) => devolverIntento(l.clave))); // no se adivinó nada
        return NextResponse.json({ requiereMfa: true });
      }
      let aceptado = false;
      try {
        if (esFormatoRespaldo(codigo)) {
          // Código de respaldo: se consume de forma atómica (solo vale una vez).
          const h = huellaRespaldo(codigo);
          aceptado =
            (
              await sql`
                UPDATE usuarios SET mfa_respaldo = mfa_respaldo - ${h}::text
                WHERE username = ${u.username} AND mfa_respaldo @> ${JSON.stringify([h])}::jsonb
                RETURNING 1
              `
            ).length > 0;
          if (aceptado) await registrarAcceso("login_ok", u.username, req, "con código de respaldo");
        } else {
          const secreto = descifrarSecreto(u.mfa_secreto);
          const paso = verificarTotp(secreto, codigo, Date.now(), Number(u.mfa_ultimo_paso ?? 0));
          aceptado =
            paso !== null &&
            (
              await sql`
                UPDATE usuarios SET mfa_ultimo_paso = ${paso}
                WHERE username = ${u.username} AND mfa_ultimo_paso < ${paso} RETURNING 1
              `
            ).length > 0;
        }
      } catch (err) {
        console.error("No se pudo verificar el segundo paso (¿cambió SESSION_SECRET?)", err);
        return NextResponse.json({ error: "No se pudo verificar tu segundo paso. Contacta a un administrador." }, { status: 403 });
      }
      if (!aceptado) {
        await registrarAcceso("login_fallo", u.username, req, "MFA");
        return NextResponse.json({ error: "Código de verificación incorrecto o vencido" }, { status: 401 });
      }
    }

    // Éxito: se limpia el contador de usuario+IP y se devuelve el intento al del usuario. El de IP
    // NO se devuelve (si no, una cuenta propia permitiría compensar los intentos de un barrido).
    await limpiarFallos(clave);
    await devolverIntento(limites[2].clave);

    // Hash antiguo (coste menor): se actualiza ahora que tenemos la contraseña en claro.
    if (bcrypt.getRounds(u.password_hash) < BCRYPT_COSTO) {
      try {
        await sql`
          UPDATE usuarios SET password_hash = ${await bcrypt.hash(password, BCRYPT_COSTO)}
          WHERE username = ${u.username}
        `;
      } catch (err) {
        console.error("No se pudo actualizar el hash", err); // no impide entrar
      }
    }
    await createSession(u.username, u.rol, u.sesion_version);
    await registrarAcceso("login_ok", u.username, req);
    return NextResponse.json({ ok: true, debeCambiarClave: u.debe_cambiar_clave === true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "No se pudo iniciar sesión. Intenta de nuevo." },
      { status: 500 }
    );
  }
}
