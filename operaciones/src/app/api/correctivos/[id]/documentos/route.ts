import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/auth";
import { registrar } from "@/lib/server/historial";
import { DOCUMENTOS, ESTADOS_DOC } from "@/lib/shared/opciones";
import type { Documentos } from "@/lib/shared/types";

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
      // Se aceptan enlaces web o archivos subidos a este mismo ticket.
      const esArchivoPropio = new RegExp(`^/api/correctivos/${id}/archivos/\\d+$`).test(url);
      if (url && !esArchivoPropio && !/^https?:\/\//i.test(url)) {
        return NextResponse.json(
          { error: "El enlace no es válido" },
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
    const previo = await sql`SELECT documentos FROM correctivos WHERE id = ${Number(id)}`;
    const antes = ((previo[0]?.documentos ?? {}) as Documentos);
    const rows = await sql`
      UPDATE correctivos
      SET documentos = ${JSON.stringify(limpio)}::jsonb, updated_at = now()
      WHERE id = ${Number(id)}
      RETURNING documentos
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }

    // Historial: qué línea cambió y cómo.
    const cambios: string[] = [];
    for (const { clave, nombre } of DOCUMENTOS) {
      const a = antes[clave];
      const n = limpio[clave];
      if (!n) continue;
      if (!a && !n.numero && !n.url && n.estado === "Pendiente") continue;
      if (n.url && n.url !== (a?.url ?? "")) {
        cambios.push(`${nombre}: documento "${n.numero}" cargado (${n.estado})`);
      } else if (!n.url && a?.url) {
        cambios.push(`${nombre}: documento quitado`);
      } else if (n.estado !== (a?.estado ?? "Pendiente")) {
        cambios.push(`${nombre}: estado ${a?.estado ?? "Pendiente"} → ${n.estado}`);
      }
    }
    if (cambios.length > 0) await registrar(Number(id), user.username, cambios.join(" · "));

    return NextResponse.json({ data: rows[0].documentos });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudieron guardar los documentos" }, { status: 500 });
  }
}
