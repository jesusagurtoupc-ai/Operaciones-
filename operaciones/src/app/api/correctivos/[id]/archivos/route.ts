import { NextRequest, NextResponse } from "next/server";
import { guardarEnBlob, borrarDeBlob } from "@/lib/server/almacen";
import { sql, ensureSchema } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/auth";
import { exigirSesion } from "@/lib/server/utils";
import { cronometro } from "@/lib/server/utils";
import {
  TIPOS_PERMITIDOS,
  MAX_BYTES,
  MAX_ARCHIVOS_POR_TICKET,
  extensionDe,
} from "@/lib/shared";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const acceso = await exigirSesion();
    if (acceso.error) return acceso.error;
    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    }
    await ensureSchema();
    // Los archivos de un ticket en la papelera solo los ve un administrador.
    const esAdmin = acceso.user.rol === "admin";
    const rows = await sql`
      SELECT a.id, a.nombre, a.tipo, a.tamano, a.subido_por, a.created_at
      FROM archivos a
      JOIN correctivos c ON c.id = a.correctivo_id
      WHERE a.correctivo_id = ${Number(id)}
        AND (c.eliminado_en IS NULL OR ${esAdmin}::boolean)
      ORDER BY a.created_at, a.id
    `;
    return NextResponse.json({ data: rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error al listar los archivos" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const reloj = cronometro();
    const user = await getCurrentUser();
    if (user?.rol !== "admin") {
      return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
    }
    reloj.paso("sesion");
    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    }
    const cid = Number(id);

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No se recibió ningún archivo" }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "El archivo está vacío" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "El archivo supera el máximo de 4 MB" },
        { status: 413 }
      );
    }
    reloj.paso("recibir_archivo");
    const nombre = file.name.replace(/[\\/\r\n]/g, "_").slice(0, 200) || "archivo";
    const tipoPermitido = TIPOS_PERMITIDOS[extensionDe(nombre)];
    if (!tipoPermitido) {
      return NextResponse.json(
        { error: "Tipo de archivo no permitido (PDF, imágenes, Word o Excel)" },
        { status: 400 }
      );
    }

    await ensureSchema();
    // Comprobación (ticket existe, cupo de archivos) e inserción en UNA sola consulta: una ida y vuelta
    // menos a la base, que con archivos de varios MB es lo que más pesa al subir.
    reloj.paso("validar");
    const buf = Buffer.from(await file.arrayBuffer());
    // Con Vercel Blob, el archivo va allí y la base solo guarda dónde está (ver almacen.ts).
    const enBlob = await guardarEnBlob(nombre, tipoPermitido.mime, buf);
    const b64 = enBlob ? null : buf.toString("base64");
    reloj.paso(enBlob ? "blob" : "codificar");
    const insertar = () => sql`
      WITH previo AS (
        SELECT EXISTS (SELECT 1 FROM correctivos WHERE id = ${cid} AND eliminado_en IS NULL) AS existe,
               (SELECT COUNT(*)::int FROM archivos WHERE correctivo_id = ${cid}) AS n
      ), nuevo AS (
        INSERT INTO archivos (correctivo_id, nombre, tipo, tamano, data, subido_por, blob_path, blob_url)
        SELECT ${cid}::int, ${nombre}::text, ${tipoPermitido.mime}::text, ${file.size}::int,
               decode(${b64}::text, 'base64'), ${user.username}::text, ${enBlob?.path ?? null}::text, ${enBlob?.url ?? null}::text
        FROM previo
        WHERE existe AND n < ${MAX_ARCHIVOS_POR_TICKET}::int
        RETURNING id, nombre, tipo, tamano, subido_por, created_at
      )
      SELECT p.existe, p.n, nuevo.id, nuevo.nombre, nuevo.tipo, nuevo.tamano, nuevo.subido_por, nuevo.created_at
      FROM previo p LEFT JOIN nuevo ON true
    `;
    let filas;
    try {
      filas = await insertar();
    } catch (e) {
      await borrarDeBlob([enBlob?.url]);
      throw e;
    }
    reloj.paso("base_datos");
    const r = filas[0] as {
      existe: boolean; n: number; id: number | null; nombre: string; tipo: string;
      tamano: number; subido_por: string; created_at: string;
    };
    if (r.id === null) await borrarDeBlob([enBlob?.url]); // no se guardó: no dejar el archivo suelto en Blob
    if (!r.existe) {
      return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });
    }
    if (r.id === null) {
      return NextResponse.json(
        { error: `Máximo ${MAX_ARCHIVOS_POR_TICKET} archivos por ticket` },
        { status: 400 }
      );
    }
    const rows = [{ id: r.id, nombre: r.nombre, tipo: r.tipo, tamano: r.tamano, subido_por: r.subido_por, created_at: r.created_at }];
    return NextResponse.json({ data: rows[0] }, { status: 201, headers: { "Server-Timing": reloj.cabecera() } });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error al subir el archivo" }, { status: 500 });
  }
}
