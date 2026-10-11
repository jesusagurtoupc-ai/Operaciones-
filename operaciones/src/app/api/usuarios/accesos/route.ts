import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { getAdmin } from "@/lib/server/auth";

/** Últimos accesos (ingresos, fallos, salidas, exportaciones). Solo administradores. */
export async function GET() {
  if (!(await getAdmin())) {
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  }
  try {
    await ensureSchema();
    const rows = await sql`
      SELECT id, usuario, evento, ip, user_agent, detalle, created_at
      FROM auditoria_accesos ORDER BY created_at DESC, id DESC LIMIT 100
    `;
    return NextResponse.json(
      { data: rows },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error al cargar los accesos" }, { status: 500 });
  }
}
