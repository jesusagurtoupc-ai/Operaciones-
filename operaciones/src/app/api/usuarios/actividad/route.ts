import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { getAdmin } from "@/lib/server/auth";

/** Últimas acciones sobre usuarios (solo administradores). */
export async function GET() {
  if (!(await getAdmin())) {
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  }
  try {
    await ensureSchema();
    const rows = await sql`
      SELECT id, actor, accion, objetivo, detalle, created_at
      FROM auditoria_usuarios ORDER BY created_at DESC, id DESC LIMIT 50
    `;
    return NextResponse.json({ data: rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error al cargar la actividad" }, { status: 500 });
  }
}
