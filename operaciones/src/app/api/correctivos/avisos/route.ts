import { NextResponse, type NextRequest } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { exigirSesion } from "@/lib/server/utils";
import { normalizeCorrectivos } from "@/lib/shared";
import type { Correctivo } from "@/lib/shared";
import { cronometro } from "@/lib/server/utils";
import { ALERTAS, alertasDeTicket, type AvisoItem } from "@/components/lista/filtrosLista";

export const dynamic = "force-dynamic";

const PESO = { rojo: 0, ambar: 1, gris: 2 } as const;

// Tope de tickets revisados (antes 5000, y si se pasaba no se avisaba). Si se alcanza, la respuesta
// lo indica con `truncado` y el panel lo muestra.
const MAX_TICKETS = 20000;

// Las notificaciones son las mismas para todos los usuarios y revisan TODOS los tickets: se guardan
// unos segundos en esta instancia, así abrir la lista (o que varias personas la abran a la vez) no
// repite esa consulta grande cada vez. Un cambio se ve, como mucho, en ese tiempo.
const TTL_AVISOS_MS = 20_000;
const gAv = globalThis as typeof globalThis & { __correctivosAvisos?: { vence: number; cuerpo: unknown } };

/**
 * Todas las notificaciones de todos los tickets activos (no solo los de la página que se ve en la lista).
 * Se calculan con las mismas reglas que usaba la columna Estado; la persona elige en pantalla cuáles ver.
 */
export async function GET(req?: NextRequest) {
  try {
    const reloj = cronometro();
    const acceso = await exigirSesion();
    if (acceso.error) return acceso.error;
    reloj.paso("sesion");
    const guardado = gAv.__correctivosAvisos;
    const fresco = req?.nextUrl?.searchParams.get("fresco") === "1";
    if (!fresco && guardado && guardado.vence > Date.now()) {
      reloj.paso("copia");
      return NextResponse.json(guardado.cuerpo, { headers: { "Server-Timing": reloj.cabecera() } });
    }
    await ensureSchema();
    const filas = await sql`
      SELECT id, refer, n_oc, LEFT(descripcion, 200) AS descripcion, estado, f_entrega, monto,
             -- Los avisos solo miran la URL y el estado del informe y del certificado: se traen solo
             -- eso y no todo documentos (cotizaciones, OC, etc.), que pesa mucho en 5000 tickets.
             jsonb_build_object(
               'informe', jsonb_build_object('url', documentos->'informe'->'url', 'estado', documentos->'informe'->'estado'),
               'certificado', jsonb_build_object('url', documentos->'certificado'->'url', 'estado', documentos->'certificado'->'estado')
             ) AS documentos,
             -- Para el aviso de cotización por vencer: solo la validez (no las partidas).
             f_coti, jsonb_build_object('validez_dias', condiciones->'validez_dias') AS condiciones,
             estado_desde, f_reg, created_at, updated_at
      FROM correctivos
      WHERE eliminado_en IS NULL
      ORDER BY id DESC
      LIMIT ${MAX_TICKETS + 1}
    `;
    reloj.paso("base_datos");
    const truncado = filas.length > MAX_TICKETS;
    if (truncado) filas.length = MAX_TICKETS;
    const todas = ALERTAS.map((a) => a.clave);
    const items: AvisoItem[] = [];
    for (const f of normalizeCorrectivos(filas as Record<string, unknown>[])) {
      const r = f as unknown as Correctivo;
      for (const a of alertasDeTicket(r, todas)) {
        items.push({ ...a, id: r.id, refer: r.refer, n_oc: r.n_oc, descripcion: r.descripcion });
      }
    }
    items.sort((a, b) => PESO[a.tono] - PESO[b.tono] || (b.refer ?? b.id) - (a.refer ?? a.id));
    const cuerpo = { data: items, truncado, revisados: filas.length };
    gAv.__correctivosAvisos = { vence: Date.now() + TTL_AVISOS_MS, cuerpo };
    reloj.paso("calculo");
    return NextResponse.json(cuerpo, { headers: { "Server-Timing": reloj.cabecera() } });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudieron obtener las notificaciones" }, { status: 500 });
  }
}
