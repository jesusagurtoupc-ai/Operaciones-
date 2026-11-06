import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { exigirAdmin } from "@/lib/server/utils";
import { extraerPaginasPdf } from "@/lib/server/pdfTexto";
import { parsearOC } from "@/lib/server/parsearOC";
import { MAX_BYTES } from "@/lib/shared";
import type { DatosOC } from "@/lib/shared";

// Usa zlib de Node: no puede correr en el runtime "edge".
export const runtime = "nodejs";

/**
 * Lee una orden de compra en PDF y devuelve los datos que usa el ticket.
 * NO guarda nada: la persona revisa lo leído y recién al guardar el ticket se graba.
 *
 * Body (multipart): file = PDF de la OC; excluir = id del ticket que se está editando
 * (para no avisar que "otro" ticket ya usa esa OC cuando es el mismo).
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
    if (file.size === 0) {
      return NextResponse.json({ error: "El archivo está vacío" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "El archivo supera el máximo de 4 MB" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const pdf = extraerPaginasPdf(buf);
    if (!pdf.ok) return NextResponse.json({ error: pdf.error }, { status: 422 });

    const oc = parsearOC(pdf.paginas, pdf.creado);
    if (!oc.ok) return NextResponse.json({ error: oc.error }, { status: 422 });

    // ¿Otro ticket ya tiene este N° de OC? Una OC no puede estar en dos tickets: se avisa aquí y el
    // panel no copia ese N° al ticket (el guardado también lo rechaza).
    let otros: DatosOC["otros_tickets"] = [];
    if (oc.datos.n_oc) {
      try {
        await ensureSchema();
        const excluirRaw = String(form?.get("excluir") ?? "");
        const excluir = /^\d+$/.test(excluirRaw) ? Number(excluirRaw) : 0;
        const rows = await sql`
          SELECT id, refer, ticket
          FROM correctivos
          WHERE eliminado_en IS NULL
            AND LOWER(BTRIM(n_oc)) = ${oc.datos.n_oc.toLowerCase()}
            AND id <> ${excluir}
          ORDER BY id
          LIMIT 5
        `;
        otros = rows.map((r) => ({
          id: Number(r.id),
          refer: r.refer === null ? null : Number(r.refer),
          ticket: (r.ticket as string | null) ?? null,
        }));
      } catch (err) {
        console.error(err); // la lectura de la OC sigue valiendo sin este aviso
      }
    }

    const datos: DatosOC = { ...oc.datos, otros_tickets: otros };
    return NextResponse.json({ data: datos });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo leer la orden de compra" }, { status: 500 });
  }
}
