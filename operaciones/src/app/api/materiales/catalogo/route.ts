import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, sql } from "@/lib/server/db";
import { exigirAdmin, exigirSesion } from "@/lib/server/utils";
import { catalogoValido } from "@/lib/materiales";

export const dynamic = "force-dynamic";

/**
 * Catálogo de materiales cargado desde la app.
 *  GET            → el catálogo vigente (el último cargado), en el mismo formato que
 *                   public/catalogo-materiales.json. 404 si nunca se cargó uno: la página usa el archivo.
 *                   Responde 304 si el navegador ya tiene esa versión (ETag).
 *  GET ?info=1    → solo los datos del vigente (título, fecha, quién, artículos) y los anteriores.
 *  POST (JSON)    → guarda un catálogo nuevo (solo administradores). El navegador ya leyó el Excel y
 *                   manda el resultado; aquí se valida su forma completa. Se guardan los 5 últimos.
 */

const MAX_BYTES = 4 * 1024 * 1024; // límite de Vercel para el cuerpo de una petición: ~4,5 MB

export async function GET(req: NextRequest) {
  const acceso = await exigirSesion();
  if (acceso.error) return acceso.error;
  try {
    await ensureSchema();
    if (req.nextUrl.searchParams.get("info") === "1") {
      const filas = await sql`
        SELECT id, titulo, items, vence, subido_por, subido_en FROM catalogo_materiales ORDER BY id DESC LIMIT 5
      `;
      return NextResponse.json({ data: filas }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const ultimo = (await sql`SELECT id FROM catalogo_materiales ORDER BY id DESC LIMIT 1`) as { id: number }[];
    if (ultimo.length === 0) return NextResponse.json({ error: "Sin catálogo cargado" }, { status: 404 });
    const etag = `"catalogo-${ultimo[0].id}"`;
    if (req.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag, "Cache-Control": "private, no-cache" } });
    }
    const filas = (await sql`SELECT datos FROM catalogo_materiales WHERE id = ${ultimo[0].id}`) as { datos: string }[];
    return new NextResponse(filas[0].datos, {
      headers: { "Content-Type": "application/json; charset=utf-8", ETag: etag, "Cache-Control": "private, no-cache" },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo leer el catálogo" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const acceso = await exigirAdmin();
  if (acceso.error) return acceso.error;
  try {
    const texto = await req.text();
    if (texto.length > MAX_BYTES) {
      return NextResponse.json({ error: "El catálogo es demasiado grande para subirlo de una vez" }, { status: 413 });
    }
    let datos: unknown;
    try {
      datos = JSON.parse(texto);
    } catch {
      return NextResponse.json({ error: "Catálogo inválido" }, { status: 400 });
    }
    if (!catalogoValido(datos)) {
      return NextResponse.json({ error: "El catálogo no tiene el formato esperado" }, { status: 400 });
    }
    // Vencimiento más próximo (para avisar en la página).
    const vence = datos.vencimientos.filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v)).sort()[0] ?? null;
    await ensureSchema();
    const filas = await sql`
      WITH nuevo AS (
        INSERT INTO catalogo_materiales (titulo, items, vence, datos, subido_por)
        VALUES (${datos.titulo.slice(0, 300)}, ${datos.items.length}, ${vence}::date, ${JSON.stringify(datos)}, ${acceso.user.username})
        RETURNING id, titulo, items, vence, subido_por, subido_en
      ),
      -- Se guardan solo los 5 últimos (el nuevo + 4 anteriores).
      viejos AS (
        DELETE FROM catalogo_materiales
        WHERE id NOT IN (SELECT id FROM catalogo_materiales ORDER BY id DESC LIMIT 4)
        RETURNING id
      )
      SELECT * FROM nuevo
    `;
    return NextResponse.json({ data: filas[0] });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo guardar el catálogo" }, { status: 500 });
  }
}
