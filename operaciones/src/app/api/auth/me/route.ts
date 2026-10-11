import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { adminSinMfa } from "@/lib/server/reauth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  // REQUIRE_ADMIN_MFA=1: los administradores sin verificación en dos pasos deben activarla.
  const mfaRequerido = adminSinMfa(user);
  return NextResponse.json({ user: { ...user, mfaRequerido } });
}
