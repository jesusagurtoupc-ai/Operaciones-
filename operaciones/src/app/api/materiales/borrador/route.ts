import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/server/db";
import { exigirSesion, leerJson } from "@/lib/server/utils";
import { leerBorrador, MAX_LINEAS } from "@/lib/materiales";

export const dynamic = "force-dynamic";

// Borrador de la solicitud de materiales de cada usuario, guardado en el servidor: así los materiales
// elegidos no se pierden al cambiar de navegador o de equipo, ni al borrar los datos del navegador.
// La tabla se crea sola la primera vez (una vez por instancia del servidor).
const g = globalThis as typeof globalThis & { __materialesBorradorTabla?: Promise<void> };

function asegurarTabla(): Promise<void> {
  if (!g.__materialesBorradorTabla) {
    g.__materialesBorradorTabla = Promise.resolve(
      sql`
        CREATE TABLE IF NOT EXISTS materiales_borradores (
          username TEXT PRIMARY KEY,
          lineas   JSONB NOT NULL DEFAULT '[]'::jsonb,
          t        BIGINT NOT NULL DEFAULT 0
        )
      `
    )
      .then(() => undefined)
      .catch((e) => {
        g.__materialesBorradorTabla = undefined; // permite reintentar
        throw e;
      });
  }
  return g.__materialesBorradorTabla;
}

/** Devuelve el borrador guardado del usuario (o null si no tiene). `t` = momento de la última edición. */
export async function GET() {
  try {
    const acceso = await exigirSesion();
    if (acceso.error) return acceso.error;
    await asegurarTabla();
    const filas = await sql`SELECT lineas, t FROM materiales_borradores WHERE username = ${acceso.user.username}`;
    if (filas.length === 0) return NextResponse.json({ data: null });
    return NextResponse.json({ data: { lineas: filas[0].lineas, t: Number(filas[0].t) || 0 } });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo leer el borrador" }, { status: 500 });
  }
}

/**
 * Guarda el borrador. Un guardado más antiguo que el que ya está (p. ej. de una pestaña vieja) no lo
 * pisa: solo se aplica si su `t` es igual o mayor.
 */
export async function PUT(req: NextRequest) {
  try {
    const acceso = await exigirSesion();
    if (acceso.error) return acceso.error;
    const body = await leerJson(req);
    const t = Number(body?.t);
    if (!body || !Array.isArray(body.lineas) || body.lineas.length > MAX_LINEAS || !Number.isFinite(t) || t < 0) {
      return NextResponse.json({ error: "Borrador no válido" }, { status: 400 });
    }
    // Se limpia con las mismas reglas que al leer el borrador en el navegador.
    const limpias = (leerBorrador(JSON.stringify({ lineas: body.lineas }))?.lineas ?? []).map((l) => {
      const { uid, ...resto } = l;
      void uid;
      return resto;
    });
    await asegurarTabla();
    const filas = await sql`
      INSERT INTO materiales_borradores (username, lineas, t)
      VALUES (${acceso.user.username}, ${JSON.stringify(limpias)}::jsonb, ${Math.trunc(t)})
      ON CONFLICT (username) DO UPDATE SET lineas = EXCLUDED.lineas, t = EXCLUDED.t
      WHERE materiales_borradores.t <= EXCLUDED.t
      RETURNING t
    `;
    return NextResponse.json({ ok: true, aplicado: filas.length > 0 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo guardar el borrador" }, { status: 500 });
  }
}
