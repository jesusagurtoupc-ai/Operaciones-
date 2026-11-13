import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { exigirAdmin } from "@/lib/server/utils";
import { leerPdfDeInforme } from "@/lib/server/parsearInforme";
import { MAX_BYTES } from "@/lib/shared";

// Usa zlib de Node: no puede correr en el runtime "edge".
export const runtime = "nodejs";

/**
 * Lee un informe técnico en PDF y busca los tickets activos de la(s) OC que menciona.
 * NO guarda nada: el archivo se sube después a la línea "Informe" del ticket elegido.
 * Body (multipart): file.
 */
export async function POST(req: NextRequest) {
  try {
    const acceso = await exigirAdmin();
    if (acceso.error) return acceso.error;
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No se recibió ningún archivo" }, { status: 400 });
    }
    if (file.size === 0) return NextResponse.json({ error: "El archivo está vacío" }, { status: 400 });
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "El archivo supera el máximo de 4 MB" }, { status: 413 });
    }
    const r = leerPdfDeInforme(Buffer.from(await file.arrayBuffer()));
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.noEsPdf ? 400 : 422 });

    const ocs = r.datos.ocs.map((o) => o.trim().toLowerCase()).filter(Boolean).slice(0, 5);
    let tickets: unknown[] = [];
    if (ocs.length) {
      await ensureSchema();
      tickets = await sql`
        SELECT id, refer, n_oc, estado, descripcion, proveedor,
               (documentos->'informe'->>'url') IS NOT NULL AS tiene_informe
        FROM correctivos
        WHERE eliminado_en IS NULL AND LOWER(BTRIM(n_oc)) = ANY(${ocs})
        ORDER BY id
        LIMIT 10
      `;
    }
    return NextResponse.json({ data: { ...r.datos, tickets } });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo leer el informe" }, { status: 500 });
  }
}
