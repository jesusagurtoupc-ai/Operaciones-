import { exigirSesion } from "@/lib/server/acceso";
import { registrar } from "@/lib/server/historial";
import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/auth";
import {
  TIPOS_PERMITIDOS,
  MAX_BYTES,
  MAX_ARCHIVOS_POR_TICKET,
  extensionDe,
  firmaCoincide,
  pdfTieneContenidoActivo,
} from "@/lib/shared/archivos";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const sesion = await exigirSesion();
  if (sesion.error) return sesion.error;
  try {
    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    }
    await ensureSchema();
    const rows = await sql`
      SELECT a.id, a.nombre, a.tipo, a.tamano, a.subido_por, a.created_at
      FROM archivos a
      JOIN correctivos c ON c.id = a.correctivo_id AND c.eliminado_en IS NULL
      WHERE a.correctivo_id = ${Number(id)}
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
    const user = await getCurrentUser();
    if (user?.rol !== "admin") {
      return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
    }
    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    }
    const cid = Number(id);

    // Se rechaza por Content-Length ANTES de leer el cuerpo (el formulario añade algo de sobrecarga).
    const declarado = Number(req.headers.get("content-length") ?? 0);
    if (Number.isFinite(declarado) && declarado > MAX_BYTES + 64 * 1024) {
      return NextResponse.json({ error: "El archivo supera el máximo de 4 MB" }, { status: 413 });
    }

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

    const contenido = new Uint8Array(await file.arrayBuffer());
    if (!firmaCoincide(extensionDe(nombre), contenido.subarray(0, 1024))) {
      return NextResponse.json(
        { error: "El contenido del archivo no corresponde a su extensión" },
        { status: 400 }
      );
    }

    if (extensionDe(nombre) === "pdf" && pdfTieneContenidoActivo(contenido)) {
      return NextResponse.json(
        { error: "El PDF contiene scripts o acciones activas. Expórtalo de nuevo sin ellos (por ejemplo, imprímelo a PDF)." },
        { status: 400 }
      );
    }

    await ensureSchema();
    const existe = await sql`SELECT 1 FROM correctivos WHERE id = ${cid} AND eliminado_en IS NULL`;
    if (existe.length === 0) {
      return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });
    }
    const b64 = Buffer.from(contenido).toString("base64");
    // El tope de archivos se aplica dentro del propio INSERT (atómico): dos subidas simultáneas
    // no pueden pasarse del máximo.
    const rows = await sql`
      INSERT INTO archivos (correctivo_id, nombre, tipo, tamano, data, subido_por)
      SELECT ${cid}, ${nombre}, ${tipoPermitido.mime}, ${file.size},
             decode(${b64}, 'base64'), ${user.username}
      WHERE (SELECT COUNT(*) FROM archivos WHERE correctivo_id = ${cid}) < ${MAX_ARCHIVOS_POR_TICKET}
      RETURNING id, nombre, tipo, tamano, subido_por, created_at
    `;
    if (rows.length === 0) {
      return NextResponse.json(
        { error: `Máximo ${MAX_ARCHIVOS_POR_TICKET} archivos por ticket` },
        { status: 400 }
      );
    }
    await registrar(cid, user.username, `Archivo subido: ${nombre} (${Math.ceil(file.size / 1024)} KB)`);
    return NextResponse.json({ data: rows[0] }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error al subir el archivo" }, { status: 500 });
  }
}
