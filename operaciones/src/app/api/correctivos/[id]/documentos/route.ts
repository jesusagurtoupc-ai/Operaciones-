import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/auth";
import { DOCUMENTOS, ESTADOS_DOC, MAX_ADICIONALES, toDateOnly, hoyLima } from "@/lib/shared";
import type { Documentos } from "@/lib/shared";

// Estados anteriores a "Por Ejecutar": solo desde ellos la OC cambia el estado.
const ESTADOS_PREVIOS_A_EJECUTAR = ["cotizar", "enviado", "Ingresado a PS", ""];

type Params = { params: Promise<{ id: string }> };

/** Guarda las líneas de documentos (visita técnica, cotización, OC, informe, certificado). */
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const user = await getCurrentUser();
    if (user?.rol !== "admin") {
      return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
    }
    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: "Id inválido" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
    }

    const esPropio = (u: string) => new RegExp(`^/api/correctivos/${id}/archivos/\\d+$`).test(u);
    // Solo se aceptan las líneas conocidas, con campos de texto limpios.
    const limpio: Documentos = {};
    for (const { clave } of DOCUMENTOS) {
      const d = (body as Record<string, unknown>)[clave] as
        | Record<string, unknown>
        | undefined;
      if (!d) continue;
      const url = String(d.url ?? "").trim();
      // Se aceptan enlaces web o archivos subidos a este mismo ticket.
      const esArchivoPropio = esPropio(url);
      if (url && !esArchivoPropio && !/^https?:\/\//i.test(url)) {
        return NextResponse.json(
          { error: "El enlace no es válido" },
          { status: 400 }
        );
      }
      const estado = String(d.estado ?? "");
      // Archivos adicionales de la línea: solo archivos subidos a este mismo ticket.
      const adicionales: { nombre: string; url: string }[] = [];
      if (Array.isArray(d.adicionales)) {
        for (const a of d.adicionales.slice(0, MAX_ADICIONALES) as Record<string, unknown>[]) {
          const u = String(a?.url ?? "").trim();
          if (!esPropio(u)) return NextResponse.json({ error: "Un archivo adicional no es válido" }, { status: 400 });
          if (u === url || adicionales.some((x) => x.url === u)) continue;
          adicionales.push({ nombre: String(a?.nombre ?? "").trim().slice(0, 150) || "archivo", url: u });
        }
      }
      limpio[clave] = {
        numero: String(d.numero ?? "").trim().slice(0, 100),
        estado: (ESTADOS_DOC as readonly string[]).includes(estado) ? estado : "Pendiente",
        url: url.slice(0, 2000),
        ...(adicionales.length ? { adicionales } : {}),
      };
    }

    await ensureSchema();
    const previo = await sql`SELECT documentos, estado, f_inicio, f_fin FROM correctivos WHERE id = ${Number(id)} AND eliminado_en IS NULL`;
    const antes = ((previo[0]?.documentos ?? {}) as Documentos);
    const estadoActual = String(previo[0]?.estado ?? "");

    // Cambio de estado automático: al cargar la cotización (si estaba en "cotizar") pasa a "enviado"; al cargar la OC pasa a "Por Ejecutar" (solo si aún iba antes
    // de ese paso, nunca retrocede) y al cargar el informe pasa a "Finalizado".
    const ocNueva = !!limpio.oc?.url && limpio.oc.url !== (antes.oc?.url ?? "");
    const informeNuevo = !!limpio.informe?.url && limpio.informe.url !== (antes.informe?.url ?? "");
    const cotizacionNueva = !!limpio.cotizacion?.url && limpio.cotizacion.url !== (antes.cotizacion?.url ?? "");
    let estadoNuevo: string | null = null;
    if (informeNuevo && estadoActual !== "Finalizado") {
      estadoNuevo = "Finalizado";
    } else if (ocNueva && ESTADOS_PREVIOS_A_EJECUTAR.includes(estadoActual)) {
      estadoNuevo = "Por Ejecutar";
    } else if (cotizacionNueva && estadoActual === "cotizar") {
      estadoNuevo = "enviado";
    }

    // Historial: qué línea cambió y cómo (solo depende de lo anterior y de lo recibido).
    const cambios: string[] = [];
    for (const { clave, nombre } of DOCUMENTOS) {
      const a = antes[clave];
      const n = limpio[clave];
      if (!n) continue;
      if (!a && !n.numero && !n.url && n.estado === "Pendiente") continue;
      if (n.url && n.url !== (a?.url ?? "")) {
        cambios.push(`${nombre}: documento "${n.numero}" cargado (${n.estado})`);
      } else if (!n.url && a?.url) {
        cambios.push(`${nombre}: documento quitado`);
      } else if (n.estado !== (a?.estado ?? "Pendiente")) {
        cambios.push(`${nombre}: estado ${a?.estado ?? "Pendiente"} → ${n.estado}`);
      }
    }

    if (estadoNuevo) {
      cambios.push(`Estado: ${estadoActual || "—"} → ${estadoNuevo} (automático)`);
    }

    // Al finalizar solo, la F. fin se completa con hoy, salvo que eso la deje antes de la F. inicio
    // (una fecha de inicio futura): entonces se deja vacía y se anota para revisarla a mano.
    const fInicio = toDateOnly(previo[0]?.f_inicio);
    if (estadoNuevo === "Finalizado" && !toDateOnly(previo[0]?.f_fin) && fInicio && fInicio > hoyLima()) {
      cambios.push(`F. fin no se completó: la F. inicio (${fInicio}) es posterior a hoy`);
    }

    // Guardar y anotar el historial en UNA sola instrucción: una ida y vuelta menos a la base.
    const rows = await sql`
      WITH act AS (
        UPDATE correctivos
        SET documentos = ${JSON.stringify(limpio)}::jsonb,
            estado = COALESCE(${estadoNuevo}::text, estado),
            estado_desde = CASE WHEN ${estadoNuevo}::text IS NOT NULL THEN now() ELSE estado_desde END,
            f_fin = CASE
              WHEN ${estadoNuevo}::text = 'Finalizado' THEN COALESCE(
                f_fin,
                CASE WHEN f_inicio IS NULL OR f_inicio <= (now() AT TIME ZONE 'America/Lima')::date
                     THEN (now() AT TIME ZONE 'America/Lima')::date END
              )
              ELSE f_fin
            END,
            updated_at = now()
        WHERE id = ${Number(id)} AND eliminado_en IS NULL
        RETURNING documentos, estado, f_fin
      ),
      hist AS (
        INSERT INTO historial (correctivo_id, usuario, detalle)
        SELECT ${Number(id)}::int, ${user.username}::text, ${cambios.join(" · ").slice(0, 1000)}::text
        FROM act
        WHERE ${cambios.length > 0}::boolean
        RETURNING id
      )
      SELECT documentos, estado, f_fin FROM act
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }

    return NextResponse.json({
      data: rows[0].documentos,
      estado: rows[0].estado,
      f_fin: toDateOnly(rows[0].f_fin),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudieron guardar los documentos" }, { status: 500 });
  }
}
