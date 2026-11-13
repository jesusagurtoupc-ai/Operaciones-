import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/auth";
import { exigirSesion } from "@/lib/server/utils";
import { cronometro } from "@/lib/server/tiempos";
import { TIPOS_PERMITIDOS, extensionDe } from "@/lib/shared";

type Params = { params: Promise<{ id: string; archivoId: string }> };

/** Abre el archivo (en el navegador si es PDF o imagen; descarga si es Word/Excel). */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const reloj = cronometro();
    const acceso = await exigirSesion();
    if (acceso.error) return acceso.error;
    reloj.paso("sesion");
    const { id, archivoId } = await params;
    if (!/^\d+$/.test(id) || !/^\d+$/.test(archivoId)) {
      return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    }
    // Los archivos de un ticket en la papelera solo los abre un administrador.
    const esAdmin = acceso.user.rol === "admin";
    const rows = await sql`
      SELECT a.nombre, a.tipo, encode(a.data, 'base64') AS b64
      FROM archivos a
      JOIN correctivos c ON c.id = a.correctivo_id
      WHERE a.id = ${Number(archivoId)} AND a.correctivo_id = ${Number(id)}
        AND (c.eliminado_en IS NULL OR ${esAdmin}::boolean)
    `;
    reloj.paso("base_datos");
    if (rows.length === 0) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    const { nombre, tipo, b64 } = rows[0] as { nombre: string; tipo: string; b64: string };
    const inline = TIPOS_PERMITIDOS[extensionDe(nombre)]?.inline ?? false;
    const bytes = new Uint8Array(Buffer.from(b64, "base64"));
    reloj.paso("decodificar");

    return new Response(bytes, {
      headers: {
        "Content-Type": tipo,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(nombre)}`,
        "X-Content-Type-Options": "nosniff",
        "Server-Timing": reloj.cabecera(),
        // No se guarda en la caché del navegador: en un computador compartido, los documentos (OC,
        // cotizaciones con precios) quedarían en el disco aunque la persona cierre sesión.
        "Cache-Control": "private, no-store",
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
