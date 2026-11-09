import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { exigirSesion } from "@/lib/server/utils";
import { normalizeCorrectivos } from "@/lib/shared";
import type { Correctivo } from "@/lib/shared";
import { ALERTAS, alertasDeTicket, type AvisoItem } from "@/components/lista/filtrosLista";

export const dynamic = "force-dynamic";

const PESO = { rojo: 0, ambar: 1, gris: 2 } as const;

/**
 * Todas las notificaciones de todos los tickets activos (no solo los de la página que se ve en la lista).
 * Se calculan con las mismas reglas que usaba la columna Estado; la persona elige en pantalla cuáles ver.
 */
export async function GET() {
  try {
    const acceso = await exigirSesion();
    if (acceso.error) return acceso.error;
    await ensureSchema();
    const filas = await sql`
      SELECT id, refer, n_oc, descripcion, estado, f_entrega, monto, documentos,
             estado_desde, f_reg, created_at, updated_at
      FROM correctivos
      WHERE eliminado_en IS NULL
      ORDER BY id DESC
      LIMIT 5000
    `;
    const todas = ALERTAS.map((a) => a.clave);
    const items: AvisoItem[] = [];
    for (const f of normalizeCorrectivos(filas as Record<string, unknown>[])) {
      const r = f as unknown as Correctivo;
      for (const a of alertasDeTicket(r, todas)) {
        items.push({ ...a, id: r.id, refer: r.refer, n_oc: r.n_oc, descripcion: r.descripcion });
      }
    }
    items.sort((a, b) => PESO[a.tono] - PESO[b.tono] || (b.refer ?? b.id) - (a.refer ?? a.id));
    return NextResponse.json({ data: items });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudieron obtener las notificaciones" }, { status: 500 });
  }
}
