import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { exigirAdmin } from "@/lib/server/permisos";
import { registrar } from "@/lib/server/historial";
import { violacionUnica } from "@/lib/server/errores";
import { ocDuplicada } from "@/lib/server/duplicados";

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

    // Mientras estuvo en la papelera, otro correctivo activo pudo tomar su OC.
    const enPapelera = await sql`SELECT n_oc FROM correctivos WHERE id = ${numId} AND eliminado_en IS NOT NULL`;
    if (enPapelera.length === 0) {
      return NextResponse.json({ error: "No está en la papelera" }, { status: 404 });
    }
    const ocRepetida = await ocDuplicada((enPapelera[0] as { n_oc: string | null }).n_oc, numId);
    if (ocRepetida) {
      return NextResponse.json(
        { error: `No se puede restaurar: su OC ya la usa el ticket #${ocRepetida.refer ?? ocRepetida.id}` },
        { status: 409 }
      );
    }

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
              : dup === "n_oc"
              ? "No se puede restaurar: su OC ya la usa otro correctivo activo"
              : "No se puede restaurar: su ticket ya lo usa otro correctivo activo",
        },
        { status: 409 }
      );
    }
    console.error(err);
    return NextResponse.json({ error: "Error al restaurar el correctivo" }, { status: 500 });
  }
}
