import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { DOCUMENTOS, ESTADOS_DOC } from "@/lib/opciones";
import type { Documentos } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

/** Guarda las líneas de documentos (cotización, OC, informe, certificado). */
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const user = await getCurrentUser();
    if (user?.rol !== "admin") {
      return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
    }
    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }

    // Solo se aceptan las 4 líneas conocidas, con campos de texto limpios.
    const limpio: Documentos = {};
    for (const { clave } of DOCUMENTOS) {
      const d = (body as Record<string, unknown>)[clave] as
        | Record<string, unknown>
        | undefined;
      if (!d) continue;
      const url = String(d.url ?? "").trim();
      if (url && !/^https?:\/\//i.test(url)) {
        return NextResponse.json(
          { error: "El enlace debe empezar con http:// o https://" },
          { status: 400 }
        );
      }
      const estado = String(d.estado ?? "");
      limpio[clave] = {
        numero: String(d.numero ?? "").trim().slice(0, 100),
        estado: (ESTADOS_DOC as readonly string[]).includes(estado) ? estado : "Pendiente",
        url: url.slice(0, 2000),
      };
    }

    await ensureSchema();
    const rows = await sql`
      UPDATE correctivos
      SET documentos = ${JSON.stringify(limpio)}::jsonb, updated_at = now()
      WHERE id = ${Number(id)}
      RETURNING documentos
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    return NextResponse.json({ data: rows[0].documentos });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudieron guardar los documentos" }, { status: 500 });
  }
}
