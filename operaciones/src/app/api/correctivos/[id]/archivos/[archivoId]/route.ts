import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/auth";
import { TIPOS_PERMITIDOS, extensionDe } from "@/lib/shared/archivos";

type Params = { params: Promise<{ id: string; archivoId: string }> };

/** Abre el archivo (en el navegador si es PDF o imagen; descarga si es Word/Excel). */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id, archivoId } = await params;
    if (!/^\d+$/.test(id) || !/^\d+$/.test(archivoId)) {
      return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    }
    const rows = await sql`
      SELECT nombre, tipo, encode(data, 'base64') AS b64
      FROM archivos
      WHERE id = ${Number(archivoId)} AND correctivo_id = ${Number(id)}
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    const { nombre, tipo, b64 } = rows[0] as { nombre: string; tipo: string; b64: string };
    const inline = TIPOS_PERMITIDOS[extensionDe(nombre)]?.inline ?? false;
    const bytes = new Uint8Array(Buffer.from(b64, "base64"));

    return new Response(bytes, {
      headers: {
        "Content-Type": tipo,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(nombre)}`,
        "X-Content-Type-Options": "nosniff",
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
