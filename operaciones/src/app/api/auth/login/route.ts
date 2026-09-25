import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();

  // Credenciales por defecto para que el sistema funcione incluso si
  // las variables de entorno no fueron cargadas en el servidor.
  // En producción se recomienda configurar AUTH_USER y AUTH_PASSWORD_HASH.
  const validUser = process.env.AUTH_USER || "admin";
  const encodedHash =
    process.env.AUTH_PASSWORD_HASH ||
    "JDJ5JDEwJENEWjF3SG1ZQmNaOGJGYksucDdWYnV4cFloc3k1TWNrTUY5aHlGQ2xrdFZid2owRkFBS3Nx";

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
