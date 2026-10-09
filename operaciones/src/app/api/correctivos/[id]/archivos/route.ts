import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/auth";
import {
  TIPOS_PERMITIDOS,
  MAX_BYTES,
  MAX_ARCHIVOS_POR_TICKET,
  extensionDe,
} from "@/lib/shared/archivos";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    }
    await ensureSchema();
    const rows = await sql`
      SELECT id, nombre, tipo, tamano, subido_por, created_at
      FROM archivos WHERE correctivo_id = ${Number(id)}
      ORDER BY created_at, id
    `;
    return NextResponse.json({ data: rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error al listar los archivos" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await getCurrentUser();
    if (user?.rol !== "admin") {
      return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
    }
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
    const nombre = file.name.replace(/[\\/\r\n]/g, "_").slice(0, 200) || "archivo";
    const tipoPermitido = TIPOS_PERMITIDOS[extensionDe(nombre)];
    if (!tipoPermitido) {
      return NextResponse.json(
        { error: "Tipo de archivo no permitido (PDF, imágenes, Word o Excel)" },
        { status: 400 }
      );
    }

    await ensureSchema();
    const existe = await sql`SELECT 1 FROM correctivos WHERE id = ${cid}`;
    if (existe.length === 0) {
      return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });
    }
    const cuenta = await sql`
      SELECT COUNT(*)::int AS n FROM archivos WHERE correctivo_id = ${cid}
    `;
    if ((cuenta[0] as { n: number }).n >= MAX_ARCHIVOS_POR_TICKET) {
      return NextResponse.json(
        { error: `Máximo ${MAX_ARCHIVOS_POR_TICKET} archivos por ticket` },
        { status: 400 }
      );
    }

    const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const rows = await sql`
      INSERT INTO archivos (correctivo_id, nombre, tipo, tamano, data, subido_por)
      VALUES (${cid}, ${nombre}, ${tipoPermitido.mime}, ${file.size},
              decode(${b64}, 'base64'), ${user.username})
      RETURNING id, nombre, tipo, tamano, subido_por, created_at
    `;
    return NextResponse.json({ data: rows[0] }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error al subir el archivo" }, { status: 500 });
  }
}
