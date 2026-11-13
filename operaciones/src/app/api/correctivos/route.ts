import { exigirSesion } from "@/lib/server/utils";
import { NextRequest, NextResponse } from "next/server";
import { consultarLista } from "@/lib/server/lista";

// Los tickets NO se crean por aquí: se crean leyendo un PDF, de su OC (POST /api/correctivos/desde-oc) o de su cotización (POST /api/correctivos/desde-cotizacion).
// Un POST a esta ruta responde 405.

export async function GET(req: NextRequest) {
  try {
    const acceso = await exigirSesion();
    if (acceso.error) return acceso.error;
    const { searchParams } = new URL(req.url);
    // La papelera solo la ve un administrador.
    const verPapelera = searchParams.get("papelera") === "1";
    if (verPapelera && acceso.user.rol !== "admin") {
      return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
    }
    return NextResponse.json(await consultarLista(searchParams, { papelera: verPapelera }));
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Error al obtener los correctivos" },
      { status: 500 }
    );
  }
}

/** Creación manual retirada: los tickets se crean leyendo el PDF de una orden de compra o de una cotización. */
export async function POST() {
  return NextResponse.json(
    { error: "Los tickets se crean leyendo el PDF de una orden de compra o de una cotización" },
    { status: 405, headers: { Allow: "GET" } }
  );
}
