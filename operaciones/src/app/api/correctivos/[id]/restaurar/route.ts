import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { exigirAdmin } from "@/lib/server/permisos";
import { registrar } from "@/lib/server/historial";
import { violacionUnica } from "@/lib/server/errores";

type Params = { params: Promise<{ id: string }> };

/** Saca un correctivo de la papelera y lo deja activo otra vez. Solo administradores. */
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const acceso = await exigirAdmin();
    if (acceso.error) return acceso.error;
    const { id } = await params;
    if (!/^\d{1,9}$/.test(id)) {
      return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    }
    const numId = Number(id);
    await ensureSchema();

    const rows = await sql`
      UPDATE correctivos
      SET eliminado_en = NULL, eliminado_por = NULL, updated_at = now()
      WHERE id = ${numId} AND eliminado_en IS NOT NULL
      RETURNING id
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "No está en la papelera" }, { status: 404 });
    }
    await registrar(numId, acceso.user.username, "Ticket restaurado de la papelera");
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Mientras estuvo en la papelera, otro correctivo pudo tomar su Ref o su ticket.
    const dup = violacionUnica(err);
    if (dup) {
      return NextResponse.json(
        {
          error:
            dup === "refer"
              ? "No se puede restaurar: su N° Refer. ya lo usa otro correctivo activo"
              : "No se puede restaurar: su ticket ya lo usa otro correctivo activo",
        },
        { status: 409 }
      );
    }
    console.error(err);
    return NextResponse.json({ error: "Error al restaurar el correctivo" }, { status: 500 });
  }
}
