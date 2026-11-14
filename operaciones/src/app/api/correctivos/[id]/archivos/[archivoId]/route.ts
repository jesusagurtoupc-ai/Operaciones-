import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/server/db";
import { abrirDeBlob, borrarDeBlob } from "@/lib/server/almacen";
import { getCurrentUser } from "@/lib/server/auth";
import { exigirSesion } from "@/lib/server/utils";
import { cronometro } from "@/lib/server/utils";
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
    // Si está en Vercel Blob no se trae `data` (vacío): se envía directo desde Blob, sin base64.
    const rows = await sql`
      SELECT a.nombre, a.tipo, a.tamano, a.blob_path,
             CASE WHEN a.blob_path IS NULL THEN encode(a.data, 'base64') END AS b64
      FROM archivos a
      JOIN correctivos c ON c.id = a.correctivo_id
      WHERE a.id = ${Number(archivoId)} AND a.correctivo_id = ${Number(id)}
        AND (c.eliminado_en IS NULL OR ${esAdmin}::boolean)
    `;
    reloj.paso("base_datos");
    if (rows.length === 0) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    const { nombre, tamano, blob_path, b64 } = rows[0] as {
      nombre: string; tamano: number; blob_path: string | null; b64: string | null;
    };
    const permitido = TIPOS_PERMITIDOS[extensionDe(nombre)];
    const inline = permitido?.inline ?? false;
    // El tipo se decide por la extensión permitida, no por lo guardado: aunque una fila antigua tuviera
    // otro tipo, el navegador nunca recibe HTML ni otro tipo que pueda ejecutar código.
    const tipoSeguro = permitido?.mime ?? "application/octet-stream";
    let cuerpo: ReadableStream<Uint8Array> | Uint8Array;
    let largo: number | null;
    if (blob_path) {
      const flujo = await abrirDeBlob(blob_path);
      if (!flujo) return NextResponse.json({ error: "No se pudo abrir el archivo (almacén no disponible)" }, { status: 502 });
      cuerpo = flujo;
      largo = Number(tamano) || null;
      reloj.paso("blob");
    } else {
      if (b64 === null) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
      cuerpo = new Uint8Array(Buffer.from(b64, "base64"));
      largo = cuerpo.length;
      reloj.paso("decodificar");
    }

    return new Response(cuerpo as BodyInit, {
      headers: {
        "Content-Type": tipoSeguro,
        ...(largo ? { "Content-Length": String(largo) } : {}),
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
    // No se borra un archivo que el ticket aún muestra en sus documentos (línea principal o
    // adicional). Pasa si el guardado sí llegó al servidor pero la respuesta se perdió, o si otra
    // pestaña con datos viejos intenta limpiar: antes quedaba un enlace roto en el ticket.
    const enUso = JSON.stringify(`/api/correctivos/${Number(id)}/archivos/${Number(archivoId)}`);
    const rows = await sql`
      WITH borrado AS (
        DELETE FROM archivos
        WHERE id = ${Number(archivoId)} AND correctivo_id = ${Number(id)}
          AND NOT EXISTS (
            SELECT 1 FROM correctivos c
            WHERE c.id = ${Number(id)} AND position(${enUso}::text in COALESCE(c.documentos, '{}'::jsonb)::text) > 0
          )
        RETURNING id, blob_url
      )
      SELECT b.id, b.blob_url,
             EXISTS (SELECT 1 FROM archivos WHERE id = ${Number(archivoId)} AND correctivo_id = ${Number(id)}) AS sigue
      FROM (SELECT 1) x LEFT JOIN borrado b ON true
    `;
    const fila = rows[0] as { id: number | null; blob_url: string | null; sigue: boolean } | undefined;
    if (!fila || fila.id === null) {
      if (fila?.sigue) {
        return NextResponse.json({ error: "El archivo aún está enlazado en los documentos del ticket" }, { status: 409 });
      }
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    await borrarDeBlob([fila.blob_url]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error al eliminar el archivo" }, { status: 500 });
  }
}
