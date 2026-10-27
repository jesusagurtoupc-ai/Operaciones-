import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/auth";
import { TIPOS_PERMITIDOS, extensionDe } from "@/lib/shared/archivos";

type Params = { params: Promise<{ id: string; archivoId: string }> };

/**
 * Abre el archivo (en el navegador si es PDF o imagen; descarga si es Word/Excel).
 *
 * Los archivos pesados están guardados en trozos y no caben en una sola respuesta (Vercel limita
 * cada una a 4.5 MB): se piden de a uno con `?parte=N` (0, 1, 2...). La cabecera X-Partes dice cuántos
 * son. Pedirlos sin `parte` devuelve 409 en vez de un archivo cortado a medias. Los archivos de una
 * sola pieza se entregan completos con `?parte=0` o sin parámetro.
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id, archivoId } = await params;
    if (!/^\d+$/.test(id) || !/^\d+$/.test(archivoId)) {
      return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    }
    const aid = Number(archivoId);
    const parteParam = new URL(req.url).searchParams.get("parte");
    if (parteParam !== null && !/^\d+$/.test(parteParam)) {
      return NextResponse.json({ error: "Parte inválida" }, { status: 400 });
    }

    const meta = await sql`
      SELECT a.nombre, a.tipo, a.partes
      FROM archivos a
      JOIN correctivos c ON c.id = a.correctivo_id
      WHERE a.id = ${aid} AND a.correctivo_id = ${Number(id)}
        AND c.eliminado_en IS NULL
    `;
    if (meta.length === 0) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    const { nombre, tipo, partes } = meta[0] as { nombre: string; tipo: string; partes: number | null };

    let b64: string | undefined;
    if (partes === null) {
      if (parteParam !== null && Number(parteParam) !== 0) {
        return NextResponse.json({ error: "No encontrado" }, { status: 404 });
      }
      const rows = await sql`SELECT encode(data, 'base64') AS b64 FROM archivos WHERE id = ${aid}`;
      b64 = (rows[0] as { b64: string } | undefined)?.b64;
    } else {
      if (parteParam === null) {
        return NextResponse.json(
          { error: "Archivo pesado: se descarga por partes (?parte=0, 1, 2...)", partes },
          { status: 409 }
        );
      }
      const orden = Number(parteParam);
      if (orden >= partes) {
        return NextResponse.json({ error: "No encontrado" }, { status: 404 });
      }
      const rows = await sql`
        SELECT encode(data, 'base64') AS b64 FROM archivo_partes
        WHERE archivo_id = ${aid} AND orden = ${orden}
      `;
      b64 = (rows[0] as { b64: string } | undefined)?.b64;
    }
    if (b64 === undefined) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }

    const inline = TIPOS_PERMITIDOS[extensionDe(nombre)]?.inline ?? false;
    const bytes = new Uint8Array(Buffer.from(b64, "base64"));

    return new Response(bytes, {
      headers: {
        "Content-Type": tipo,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(nombre)}`,
        "X-Content-Type-Options": "nosniff",
        "X-Partes": String(partes ?? 1),
        "X-Archivo-Nombre": encodeURIComponent(nombre),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error al abrir el archivo" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await getCurrentUser();
    if (user?.rol !== "admin") {
      return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
    }
    const { id, archivoId } = await params;
    if (!/^\d+$/.test(id) || !/^\d+$/.test(archivoId)) {
      return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    }
    const rows = await sql`
      DELETE FROM archivos
      WHERE id = ${Number(archivoId)} AND correctivo_id = ${Number(id)}
        AND correctivo_id IN (SELECT id FROM correctivos WHERE eliminado_en IS NULL)
      RETURNING id
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error al eliminar el archivo" }, { status: 500 });
  }
}
