import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { diferencias, registrar } from "@/lib/historial";
import { normalizeCorrectivo } from "@/lib/types";

/**
 * A diferencia de "valor || null", esto NO convierte 0 en null.
 * `monto: 0` (ej. trabajo cubierto por garantía) es un valor válido y
 * distinto de "sin monto"; con "|| null" se perdía silenciosamente.
 */
function numOrNull(v: unknown): number | null {
  return v === null || v === undefined || v === "" ? null : Number(v);
}

type Params = { params: Promise<{ id: string }> };

/** Valida que el id de la URL sea un entero antes de tocar la base de
 * datos. Sin esto, un id no numérico (p. ej. /api/correctivos/abc)
 * hacía fallar la consulta SQL y devolvía un 500 genérico en vez de
 * un 400 claro. */
function parseId(id: string): number | null {
  if (!/^\d+$/.test(id)) return null;
  return Number(id);
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numId = parseId(id);
    if (numId === null) {
      return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    }

    const rows = await sql`SELECT * FROM correctivos WHERE id = ${numId}`;
    if (rows.length === 0) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    return NextResponse.json({ data: normalizeCorrectivo(rows[0] as Record<string, unknown>) });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Error al obtener el correctivo" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numId = parseId(id);
    if (numId === null) {
      return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    }

    await ensureSchema();
    const body = await req.json();

    const {
      refer, ticket, f_reg, descripcion, lugar, estado, proveedor, monto,
      f_coti, f_oc, f_inicio, f_fin, cuenta, tipo_trab,
      sub_tipo_trab, n_oc, area,
    } = body;

    if (!descripcion || String(descripcion).trim() === "") {
      return NextResponse.json(
        { error: "La descripción es obligatoria" },
        { status: 400 }
      );
    }

    // Fila anterior, para dejar en el historial qué cambió.
    const antes = await sql`SELECT * FROM correctivos WHERE id = ${numId}`;
    if (antes.length === 0) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }

    const rows = await sql`
      UPDATE correctivos SET
        refer = ${numOrNull(refer)},
        ticket = ${ticket || null},
        f_reg = ${f_reg || null},
        descripcion = ${descripcion},
        lugar = ${lugar || null},
        estado_desde = CASE
          WHEN estado IS DISTINCT FROM ${estado || "cotizar"} THEN now()
          ELSE estado_desde
        END,
        estado = ${estado || "cotizar"},
        proveedor = ${proveedor || null},
        monto = ${numOrNull(monto)},
        f_coti = ${f_coti || null},
        f_oc = ${f_oc || null},
        f_inicio = ${f_inicio || null},
        f_fin = ${f_fin || null},
        cuenta = ${cuenta || null},
        tipo_trab = ${tipo_trab || null},
        sub_tipo_trab = ${sub_tipo_trab || null},
        n_oc = ${n_oc || null},
        area = ${area || null},
        updated_at = now()
      WHERE id = ${numId}
      RETURNING *
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }

    const cambios = diferencias(antes[0] as Record<string, unknown>, {
      ...body,
      f_reg: f_reg || null,
    });
    if (cambios.length > 0) {
      const user = await getCurrentUser();
      await registrar(numId, user?.username, cambios.join(" · "));
    }

    return NextResponse.json({ data: normalizeCorrectivo(rows[0] as Record<string, unknown>) });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Error al actualizar el correctivo" },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const numId = parseId(id);
    if (numId === null) {
      return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    }

    const rows = await sql`
      DELETE FROM correctivos WHERE id = ${numId} RETURNING id
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Error al eliminar el correctivo" },
      { status: 500 }
    );
  }
}
