import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/server/utils";
import { leerPdfDeCotizacion } from "@/lib/server/leerCotizacion";
import { MAX_BYTES } from "@/lib/shared";

// Usa zlib de Node: no puede correr en el runtime "edge".
export const runtime = "nodejs";

/** Lee una cotización en PDF y devuelve lo que encontró. NO guarda nada. Body (multipart): file. */
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
    const r = leerPdfDeCotizacion(Buffer.from(await file.arrayBuffer()));
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.noEsPdf ? 400 : 422 });
    return NextResponse.json({ data: r.datos });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo leer la cotización" }, { status: 500 });
  }
}
