import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();

  const validUser = process.env.AUTH_USER;
  const encodedHash = process.env.AUTH_PASSWORD_HASH;

  if (!validUser || !encodedHash) {
    return NextResponse.json(
      {
        error:
          "El servidor no tiene configuradas las variables AUTH_USER y AUTH_PASSWORD_HASH.",
      },
      { status: 500 }
    );
  }

  if (username !== validUser) {
    return NextResponse.json(
      { error: "Usuario o contraseña incorrectos" },
      { status: 401 }
    );
  }

  // AUTH_PASSWORD_HASH se guarda en Base64 (ver scripts/hash-password.mjs):
  // el hash de bcrypt trae signos "$" que Next.js interpreta como
  // referencias a otras variables de entorno y los corrompe en silencio
  // si se guardan tal cual. Aquí se decodifica antes de comparar.
  const validHash = Buffer.from(encodedHash, "base64").toString("utf-8");

  const passwordOk = await bcrypt.compare(password || "", validHash);
  if (!passwordOk) {
    return NextResponse.json(
      { error: "Usuario o contraseña incorrectos" },
      { status: 401 }
    );
  }

  await createSession(username);
  return NextResponse.json({ ok: true });
}
