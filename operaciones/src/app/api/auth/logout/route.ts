import { NextResponse } from "next/server";
import { cerrarSesion, getCurrentUser } from "@/lib/server/auth";
import { registrarEvento, ipDe } from "@/lib/server/auditoria";

export async function POST(req: Request) {
  const user = await getCurrentUser().catch(() => null);
  await cerrarSesion();
  if (user) await registrarEvento("logout", user.username, "", ipDe(req));
  return NextResponse.json({ ok: true });
}
