import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/auth";
import {
  TIPOS_PERMITIDOS,
  MAX_BYTES,
  MAX_BYTES_DIRECTO,
  MAX_MB,
  MAX_ARCHIVOS_POR_TICKET,
  TAMANO_PARTE,
  numeroDePartes,
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
    // Un archivo en trozos solo cuenta cuando ya llegaron todos (si no, es una subida a medias).
    const rows = await sql`
      SELECT a.id, a.nombre, a.tipo, a.tamano, a.partes, a.subido_por, a.created_at
      FROM archivos a
      JOIN correctivos c ON c.id = a.correctivo_id
      WHERE a.correctivo_id = ${Number(id)} AND c.eliminado_en IS NULL
        AND (a.partes IS NULL
             OR (SELECT COUNT(*) FROM archivo_partes p WHERE p.archivo_id = a.id) = a.partes)
      ORDER BY a.created_at, a.id
    `;
    return NextResponse.json({ data: rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error al listar los archivos" }, { status: 500 });
  }
}

/** Nombre sin separadores de ruta ni saltos de línea, y su tipo permitido (null si no se admite). */
function nombreYTipo(crudo: string) {
  const nombre = crudo.replace(/[\\/\r\n]/g, "_").slice(0, 200) || "archivo";
  return { nombre, tipo: TIPOS_PERMITIDOS[extensionDe(nombre)] ?? null };
}

const ERROR_TIPO = "Tipo de archivo no permitido (PDF, imágenes, Word o Excel)";

/** Comprueba que el ticket exista y que no se pase del máximo de archivos. */
async function revisarTicket(cid: number): Promise<NextResponse | null> {
  const existe = await sql`SELECT 1 FROM correctivos WHERE id = ${cid} AND eliminado_en IS NULL`;
  if (existe.length === 0) {
    return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });
  }
  const cuenta = await sql`SELECT COUNT(*)::int AS n FROM archivos WHERE correctivo_id = ${cid}`;
  if ((cuenta[0] as { n: number }).n >= MAX_ARCHIVOS_POR_TICKET) {
    return NextResponse.json(
      { error: `Máximo ${MAX_ARCHIVOS_POR_TICKET} archivos por ticket` },
      { status: 400 }
    );
  }
  return null;
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

    // ── Archivo pesado: la petición trae solo {nombre, tamano} y abre la subida por trozos.
    //    Los trozos llegan después, uno por uno (ver .../[archivoId]/partes/[orden]).
    if ((req.headers.get("content-type") ?? "").includes("application/json")) {
      const body = (await req.json().catch(() => null)) as { nombre?: unknown; tamano?: unknown } | null;
      const tamano = Number(body?.tamano);
      if (typeof body?.nombre !== "string" || !Number.isInteger(tamano) || tamano <= 0) {
        return NextResponse.json({ error: "Datos del archivo inválidos" }, { status: 400 });
      }
      if (tamano > MAX_BYTES) {
        return NextResponse.json(
          { error: `El archivo supera el máximo de ${MAX_MB} MB` },
          { status: 413 }
        );
      }
      const { nombre, tipo } = nombreYTipo(body.nombre);
      if (!tipo) return NextResponse.json({ error: ERROR_TIPO }, { status: 400 });

      await ensureSchema();
      // Subidas que quedaron a medias hace más de una hora (se cerró el navegador, se cortó
      // la conexión...): se limpian para que no ocupen espacio ni cuenten para el máximo.
      await sql`
        DELETE FROM archivos a
        WHERE a.correctivo_id = ${cid} AND a.partes IS NOT NULL
          AND a.created_at < now() - interval '1 hour'
          AND (SELECT COUNT(*) FROM archivo_partes p WHERE p.archivo_id = a.id) < a.partes
      `;
      const problema = await revisarTicket(cid);
      if (problema) return problema;

      const partes = numeroDePartes(tamano);
      const rows = await sql`
        INSERT INTO archivos (correctivo_id, nombre, tipo, tamano, data, partes, subido_por)
        VALUES (${cid}, ${nombre}, ${tipo.mime}, ${tamano}, ''::bytea, ${partes}, ${user.username})
        RETURNING id
      `;
      return NextResponse.json(
        { data: { id: (rows[0] as { id: number }).id, partes, tamano_parte: TAMANO_PARTE } },
        { status: 201 }
      );
    }

    // ── Archivo normal (hasta MAX_BYTES_DIRECTO): una sola petición.
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No se recibió ningún archivo" }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "El archivo está vacío" }, { status: 400 });
    }
    if (file.size > MAX_BYTES_DIRECTO) {
      return NextResponse.json(
        { error: "El archivo es demasiado grande para subirse de una vez" },
        { status: 413 }
      );
    }
    const { nombre, tipo: tipoPermitido } = nombreYTipo(file.name);
    if (!tipoPermitido) return NextResponse.json({ error: ERROR_TIPO }, { status: 400 });

    await ensureSchema();
    const problema = await revisarTicket(cid);
    if (problema) return problema;

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
