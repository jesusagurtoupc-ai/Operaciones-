import { exigirSesion } from "@/lib/server/utils";
import { NextRequest, NextResponse } from "next/server";
import { consultarLista } from "@/lib/server/lista";

// Los tickets NO se crean por aquí: la única forma es leer una OC en PDF (POST /api/correctivos/desde-oc).
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

/** Creación manual retirada: los tickets solo se crean leyendo una orden de compra en PDF. */
export async function POST() {
  return NextResponse.json(
    { error: "Los tickets solo se crean leyendo una orden de compra en PDF" },
    { status: 405, headers: { Allow: "GET" } }
  );
}
