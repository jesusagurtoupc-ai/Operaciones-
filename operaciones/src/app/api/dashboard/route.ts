import { exigirSesion } from "@/lib/server/utils";
import { NextResponse } from "next/server";
import { calcularPanel } from "@/lib/server/lista";
import { cronometro } from "@/lib/server/tiempos";

export async function GET() {
  try {
    const reloj = cronometro();
    const acceso = await exigirSesion();
    if (acceso.error) return acceso.error;
    reloj.paso("sesion");
    const datos = await calcularPanel(acceso.user.rol === "admin");
    reloj.paso("base_datos");
    return NextResponse.json(datos, { headers: { "Cache-Control": "private, max-age=15", "Server-Timing": reloj.cabecera() } });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Error al obtener el dashboard" },
      { status: 500 }
    );
  }
}
