import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/server/utils";
import { leerDocumento } from "@/lib/server/leerDocumento";
import { extraerPaginasPdf } from "@/lib/server/pdfTexto";
import { MAX_BYTES } from "@/lib/shared";

// Usa zlib de Node: no puede correr en el runtime "edge".
export const runtime = "nodejs";
// Tope de tiempo: si un PDF raro se traba, la función se corta al minuto en vez de seguir cobrando.
export const maxDuration = 60;

/**
 * Lee CUALQUIER documento de un trabajo (OC, cotización, informe, certificado, guía…) y devuelve qué es
 * y sus pistas (OC y cotización que cita, RUC, fecha, resumen) para juntarlo con los demás documentos.
 * NO guarda nada. Body (multipart): file.
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
    // ?filas=1: el texto del PDF línea por línea, con la posición de cada trozo (para leer tablas, p. ej. un
    // inventario en PDF al cargar una carpeta en Inventario).
    if (req.nextUrl.searchParams.get("filas") === "1") {
      const p = extraerPaginasPdf(Buffer.from(await file.arrayBuffer()));
      if (!p.ok) return NextResponse.json({ error: p.error }, { status: 422 });
      const paginas = p.paginas.slice(0, 300).map((pg) =>
        pg.lineas.map((l) => l.corridas.map((c) => ({ x: Math.round(c.x), t: c.texto.trim() })).filter((c) => c.t))
      );
      return NextResponse.json({ data: { paginas, fuentesCID: p.usaFuentesCID } });
    }
    const r = leerDocumento(Buffer.from(await file.arrayBuffer()), file.name.slice(0, 200));
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.noEsPdf ? 400 : 422 });
    return NextResponse.json({ data: r.datos });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo leer el documento" }, { status: 500 });
  }
}
