import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, sql } from "@/lib/server/db";
import { exigirAdmin, leerJson } from "@/lib/server/utils";
import { actualizarDesdeOCs, listarProveedores, renombrarProveedor, unirProveedores, unificarProveedores } from "@/lib/server/proveedores";

/**
 * Registro de proveedores (solo administradores).
 *  GET   → lista con tickets y monto de cada uno (antes ordena los tickets pendientes).
 *  PATCH → { id, nombre, ruc?, fijar? }: cambia el nombre oficial (y el RUC); sus tickets se actualizan.
 *          fijar = true: las OC que lleguen ya no cambian ese nombre.
 *  POST  → { principal, otros: [ids] }: une proveedores duplicados en el principal.
 */
export async function GET(req: NextRequest) {
  const acceso = await exigirAdmin();
  if (acceso.error) return acceso.error;
  try {
    await ensureSchema();
    // ?sugerir=1&tipo=&sub=&lugar=&id= → proveedores que más hicieron ese tipo de trabajo (en ese lugar,
    // si hay), con su precio promedio y su plazo promedio OC → fin. Para el ticket.
    const sp = req.nextUrl.searchParams;
    if (sp.get("sugerir") === "1") {
      const tipo = (sp.get("tipo") ?? "").slice(0, 60) || null;
      const sub = (sp.get("sub") ?? "").slice(0, 60) || null;
      const lugar = (sp.get("lugar") ?? "").slice(0, 120) || null;
      const id = Number(sp.get("id")) || 0;
      if (!tipo && !sub) return NextResponse.json({ data: [] });
      const filas = await sql`
        SELECT proveedor,
               MAX(NULLIF(BTRIM(ruc_proveedor), '')) AS ruc,
               COUNT(*)::int AS trabajos,
               COUNT(*) FILTER (WHERE lugar = ${lugar}::text)::int AS en_lugar,
               ROUND(AVG(monto) FILTER (WHERE monto > 0))::float AS monto_prom,
               ROUND(AVG(f_fin - f_oc) FILTER (WHERE f_fin >= f_oc), 1)::float AS dias_prom
        FROM correctivos
        WHERE eliminado_en IS NULL AND campus = ${acceso.user.campus} AND id <> ${id} AND COALESCE(BTRIM(proveedor), '') <> ''
          AND (sub_tipo_trab = ${sub}::text OR (${sub}::text IS NULL AND tipo_trab = ${tipo}::text))
        GROUP BY proveedor
        ORDER BY COUNT(*) FILTER (WHERE lugar = ${lugar}::text) DESC, COUNT(*) DESC, proveedor
        LIMIT 3
      `;
      return NextResponse.json({ data: filas }, { headers: { "Cache-Control": "private, max-age=300", Vary: "Cookie" } });
    }
    await unificarProveedores();
    // Al abrir la página se avanza la revisión con las OC guardadas (unos pocos PDFs por vez).
    const revisados = await actualizarDesdeOCs(8).catch(() => 0);
    const pendientes = (await sql`SELECT COUNT(*)::int AS n FROM proveedores WHERE fuente IS NULL`) as { n: number }[];
    return NextResponse.json({ data: await listarProveedores(), revisados, pendientes: pendientes[0]?.n ?? 0 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo cargar la lista de proveedores" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const acceso = await exigirAdmin();
  if (acceso.error) return acceso.error;
  const body = await leerJson(req);
  const id = Number(body?.id);
  if (!body || !Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }
  try {
    await ensureSchema();
    const ruc = body.ruc === undefined ? undefined : body.ruc === null ? null : String(body.ruc);
    const r = await renombrarProveedor(id, String(body.nombre ?? ""), ruc, body.fijar === true, acceso.user.username);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.error === "No encontrado" ? 404 : 400 });
    return NextResponse.json({ data: r });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo guardar el proveedor" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const acceso = await exigirAdmin();
  if (acceso.error) return acceso.error;
  const body = await leerJson(req);
  const principal = Number(body?.principal);
  const otros = Array.isArray(body?.otros) ? (body.otros as unknown[]).map(Number) : [];
  if (!Number.isInteger(principal) || principal <= 0) {
    return NextResponse.json({ error: "Elige el proveedor principal" }, { status: 400 });
  }
  try {
    await ensureSchema();
    const r = await unirProveedores(principal, otros, { usuario: acceso.user.username, motivo: "unión de proveedores en la página Proveedores" });
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ data: r });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudieron unir los proveedores" }, { status: 500 });
  }
}
