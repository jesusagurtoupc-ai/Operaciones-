import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/lib/server/db";
import { exigirAdmin, leerJson } from "@/lib/server/utils";
import { listarProveedores, renombrarProveedor, unirProveedores, unificarProveedores } from "@/lib/server/proveedores";

/**
 * Registro de proveedores (solo administradores).
 *  GET   → lista con tickets y monto de cada uno (antes ordena los tickets pendientes).
 *  PATCH → { id, nombre, ruc? }: cambia el nombre oficial (y el RUC); sus tickets se actualizan.
 *  POST  → { principal, otros: [ids] }: une proveedores duplicados en el principal.
 */
export async function GET() {
  const acceso = await exigirAdmin();
  if (acceso.error) return acceso.error;
  try {
    await ensureSchema();
    await unificarProveedores();
    return NextResponse.json({ data: await listarProveedores() });
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
    const r = await renombrarProveedor(id, String(body.nombre ?? ""), ruc);
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
    const r = await unirProveedores(principal, otros);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ data: r });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudieron unir los proveedores" }, { status: 500 });
  }
}
