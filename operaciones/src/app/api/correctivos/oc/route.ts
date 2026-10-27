import { NextRequest, NextResponse } from "next/server";
import { exigirSesion } from "@/lib/server/permisos";
import { ensureSchema } from "@/lib/server/db";
import { ocDuplicada } from "@/lib/server/duplicados";

/**
 * ¿Ya existe un correctivo activo con esta OC? Lo usa el formulario para avisar antes de
 * guardar. `?n_oc=PER05-...` y, al editar, `&excluir=<id del ticket>`. Responde
 * { data: null } si está libre o { data: { id, refer } } con el ticket que ya la tiene.
 */
export async function GET(req: NextRequest) {
  try {
    const acceso = await exigirSesion();
    if (acceso.error) return acceso.error;
    await ensureSchema();
    const sp = new URL(req.url).searchParams;
    const excluir = sp.get("excluir");
    const dup = await ocDuplicada(
      sp.get("n_oc"),
      excluir && /^\d{1,9}$/.test(excluir) ? Number(excluir) : undefined
    );
    return NextResponse.json({ data: dup });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error al revisar la OC" }, { status: 500 });
  }
}
