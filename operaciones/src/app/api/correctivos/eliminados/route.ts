import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { getAdmin } from "@/lib/server/auth";

/** Tickets eliminados (borrado lógico), los más recientes primero. Solo administradores. */
export async function GET() {
  if (!(await getAdmin())) {
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
  }
  try {
    await ensureSchema();
    const rows = await sql`
      SELECT id, refer, ticket, descripcion, estado, proveedor, eliminado_en, eliminado_por
      FROM correctivos
      WHERE eliminado_en IS NOT NULL
      ORDER BY eliminado_en DESC, id DESC
      LIMIT 200
    `;
    return NextResponse.json({ data: rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error al cargar los tickets eliminados" }, { status: 500 });
  }
}
