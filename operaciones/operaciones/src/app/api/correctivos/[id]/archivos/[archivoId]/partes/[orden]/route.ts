import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/auth";
import { tamanoDeParte } from "@/lib/shared/archivos";

type Params = { params: Promise<{ id: string; archivoId: string; orden: string }> };

/**
 * Recibe un trozo de un archivo pesado (el cuerpo es el trozo en bruto). Es seguro repetirlo: si el
 * trozo ya estaba, se reemplaza. Responde cuántos trozos van y si ya está completo.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const user = await getCurrentUser();
    if (user?.rol !== "admin") {
      return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
    }
    const { id, archivoId, orden } = await params;
    if (!/^\d+$/.test(id) || !/^\d+$/.test(archivoId) || !/^\d+$/.test(orden)) {
      return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    }
    const cid = Number(id);
    const aid = Number(archivoId);
    const o = Number(orden);

    await ensureSchema();
    const rows = await sql`
      SELECT a.tamano, a.partes
      FROM archivos a
      JOIN correctivos c ON c.id = a.correctivo_id
      WHERE a.id = ${aid} AND a.correctivo_id = ${cid} AND c.eliminado_en IS NULL
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
    }
    const { tamano, partes } = rows[0] as { tamano: number; partes: number | null };
    if (partes === null) {
      return NextResponse.json({ error: "Este archivo no se sube por trozos" }, { status: 400 });
    }
    if (o >= partes) {
      return NextResponse.json({ error: "Número de trozo inválido" }, { status: 400 });
    }

    const bytes = Buffer.from(await req.arrayBuffer());
    if (bytes.length !== tamanoDeParte(tamano, o)) {
      return NextResponse.json({ error: "El trozo no tiene el tamaño esperado" }, { status: 400 });
    }
    const b64 = bytes.toString("base64");
    await sql`
      INSERT INTO archivo_partes (archivo_id, orden, data)
      VALUES (${aid}, ${o}, decode(${b64}, 'base64'))
      ON CONFLICT (archivo_id, orden) DO UPDATE SET data = EXCLUDED.data
    `;
    const cuenta = await sql`SELECT COUNT(*)::int AS n FROM archivo_partes WHERE archivo_id = ${aid}`;
    const recibidas = (cuenta[0] as { n: number }).n;
    return NextResponse.json({ recibidas, completo: recibidas === partes });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Error al subir el archivo" }, { status: 500 });
  }
}
