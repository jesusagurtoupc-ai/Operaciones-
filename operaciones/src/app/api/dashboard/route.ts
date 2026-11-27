import { exigirSesion, exigirAdmin } from "@/lib/server/utils";
import { sql, ensureSchema } from "@/lib/server/db";
import { NextResponse } from "next/server";
import { calcularPanel } from "@/lib/server/lista";
import { cronometro } from "@/lib/server/utils";

export async function GET() {
  try {
    const reloj = cronometro();
    const acceso = await exigirSesion();
    if (acceso.error) return acceso.error;
    reloj.paso("sesion");
    const datos = await calcularPanel(acceso.user.rol === "admin", acceso.user.campus);
    reloj.paso("base_datos");
    return NextResponse.json(datos, { headers: { "Cache-Control": "private, max-age=15", Vary: "Cookie", "Server-Timing": reloj.cabecera() } });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Error al obtener el dashboard" },
      { status: 500 }
    );
  }
}

/** Guarda el presupuesto anual del campus: { anio, total, porTipo: { [tipo de trabajo]: monto } }. Solo administradores. */
export async function POST(req: Request) {
  try {
    const acceso = await exigirAdmin();
    if (acceso.error) return acceso.error;
    const body = (await req.json().catch(() => null)) as { anio?: number; total?: number; porTipo?: Record<string, number> } | null;
    const anio = Number(body?.anio);
    if (!body || !Number.isInteger(anio) || anio < 2020 || anio > 2100) {
      return NextResponse.json({ error: "Año inválido" }, { status: 400 });
    }
    const monto = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) < 1e12 ? Math.round(Number(v) * 100) / 100 : 0);
    const porTipo = Object.fromEntries(
      Object.entries(body.porTipo ?? {}).slice(0, 50).map(([k, v]) => [String(k).slice(0, 80), monto(v)]).filter(([, v]) => (v as number) > 0)
    );
    const valor = JSON.stringify({ total: monto(body.total), porTipo });
    await ensureSchema();
    await sql`
      INSERT INTO ajustes (clave, valor, usuario) VALUES (${`presupuesto:${acceso.user.campus}:${anio}`}, ${valor}::jsonb, ${acceso.user.username})
      ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, usuario = EXCLUDED.usuario, actualizado_en = now()
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo guardar el presupuesto" }, { status: 500 });
  }
}
