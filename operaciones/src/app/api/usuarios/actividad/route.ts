import { NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/server/utils";
import { ultimosEventos } from "@/lib/server/auditoria";

export const dynamic = "force-dynamic";

/** Registro de actividad de seguridad (solo administradores). */
export async function GET() {
  try {
    const acceso = await exigirAdmin();
    if (acceso.error) return acceso.error;
    return NextResponse.json({ data: await ultimosEventos(200) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo leer el registro de actividad" }, { status: 500 });
  }
}
