import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { getAdmin } from "@/lib/server/auth";
import { registrar } from "@/lib/server/historial";
import { esViolacionUnica } from "@/lib/server/errores";

type Params = { params: Promise<{ id: string }> };

/**
 * Restaura un ticket eliminado. Si su N° Refer. ya lo usa otro ticket activo,
 * se le asigna el siguiente número libre y se avisa en la respuesta.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const user = await getAdmin();
    if (!user) {
      return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
    }
    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    }
    const numId = Number(id);
    await ensureSchema();

    let referNuevo: number | null = null;
    let rows: Record<string, unknown>[] = [];
    try {
      rows = (await sql`
        UPDATE correctivos
        SET eliminado_en = NULL, eliminado_por = NULL, updated_at = now()
        WHERE id = ${numId} AND eliminado_en IS NOT NULL
        RETURNING id
      `) as Record<string, unknown>[];
    } catch (err) {
      if (!esViolacionUnica(err)) throw err;
      // N° Refer. repetido con un ticket activo: se le da el siguiente libre.
      const reasignado = (await sql`
        UPDATE correctivos
        SET eliminado_en = NULL, eliminado_por = NULL, updated_at = now(),
            refer = (SELECT COALESCE(MAX(refer), 0) + 1 FROM correctivos)
        WHERE id = ${numId} AND eliminado_en IS NOT NULL
        RETURNING id, refer
      `) as { id: number; refer: number }[];
      rows = reasignado;
      referNuevo = reasignado[0]?.refer ?? null;
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    await registrar(
      numId,
      user.username,
      referNuevo !== null
        ? `Ticket restaurado (N° Refer. reasignado a ${referNuevo})`
        : "Ticket restaurado"
    );
    return NextResponse.json({ ok: true, referNuevo });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error al restaurar el ticket" }, { status: 500 });
  }
}
