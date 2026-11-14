import { NextRequest, NextResponse } from "next/server";
import { automatizar } from "@/lib/server/lista";
import { ensureSchema, sql } from "@/lib/server/db";
import { exigirAdmin, exigirSesion, leerJson } from "@/lib/server/utils";
import { claveTicket, leerBorrador, MAX_LINEAS } from "@/lib/materiales";

export const dynamic = "force-dynamic";

/**
 * Historial de solicitudes de materiales (SI-<año>-<n>).
 *  GET                  → lista (los administradores ven todas; los demás, las suyas). ?q= busca por N°,
 *                         ticket, usuario o material; ?estado= filtra.
 *  GET ?numero=SI-…     → una solicitud con sus materiales (para verla, volver a descargarla o editarla).
 *  POST { numero, lineas } → la registra o actualiza (se llama al descargar el PDF o el Excel). Solo
 *                         su autor (o un administrador) puede actualizarla, y el N° debe haber salido
 *                         del contador.
 *  PATCH { numero, estado } → cambia el estado (solo administradores).
 *  GET ?buscarTicket=…  → tickets que coinciden con lo que se escribe (sugerencias del N° Ticket).
 *  GET ?ticket=…&ticket=… → a qué ticket corresponde cada N° Ticket escrito (o null si no existe).
 */

const ESTADOS_SOLICITUD = ["Enviada", "Aprobada", "Atendida", "Anulada"] as const;
const FORMATO = /^SI-(\d{4})-(\d{1,7})$/;

export async function GET(req: NextRequest) {
  const acceso = await exigirSesion();
  if (acceso.error) return acceso.error;
  const esAdmin = acceso.user.rol === "admin";
  const yo = acceso.user.username;
  try {
    await ensureSchema();
    const sp = req.nextUrl.searchParams;
    // Al ver el historial: las solicitudes cuyos tickets ya terminaron pasan a "Atendida" (máx. cada 30 min).
    if (!sp.has("buscarTicket") && !sp.has("ticket")) await automatizar().catch(() => undefined);

    // ?buscarTicket=texto → tickets que coinciden (para sugerir mientras se escribe el N° Ticket).
    const buscar = sp.get("buscarTicket");
    if (buscar !== null) {
      const t = buscar.trim().slice(0, 60);
      if (!t) return NextResponse.json({ data: [] });
      const { refer } = claveTicket(t);
      const patron = `%${t.replace(/[\\%_]/g, (m: string) => `\\${m}`)}%`;
      const filas = await sql`
        SELECT id, refer, ticket, LEFT(descripcion, 90) AS descripcion, lugar, estado
        FROM correctivos
        WHERE eliminado_en IS NULL
          AND (refer = ${refer}::int OR ticket ILIKE ${patron} OR refer::text LIKE ${`${refer ?? t}%`}
               OR descripcion ILIKE ${patron} OR lugar ILIKE ${patron})
        ORDER BY (refer = ${refer}::int) DESC NULLS LAST, (ticket ILIKE ${patron}) DESC, refer DESC NULLS LAST
        LIMIT 8
      `;
      return NextResponse.json({ data: filas }, { headers: { "Cache-Control": "private, max-age=30" } });
    }

    // ?ticket=a&ticket=b → a qué ticket corresponde cada texto escrito (null si no existe).
    const escritos: string[] = [...new Set(sp.getAll("ticket").map((x: string) => x.trim()).filter(Boolean))].slice(0, 100) as string[];
    if (escritos.length > 0) {
      const claves = escritos.map((e) => ({ e, ...claveTicket(e) }));
      const textos = claves.map((c) => c.texto);
      const refers = claves.map((c) => c.refer).filter((n): n is number => n !== null);
      const filas = (await sql`
        SELECT id, refer, ticket, LEFT(descripcion, 90) AS descripcion, lugar, estado
        FROM correctivos
        WHERE eliminado_en IS NULL
          AND (LOWER(BTRIM(ticket)) = ANY(${textos}::text[]) OR refer = ANY(${refers}::int[]))
      `) as { id: number; refer: number | null; ticket: string | null; descripcion: string; lugar: string | null; estado: string }[];
      const data: Record<string, (typeof filas)[number] | null> = {};
      for (const c of claves) {
        data[c.e] =
          filas.find((f) => (f.ticket ?? "").trim().toLowerCase() === c.texto) ??
          (c.refer !== null ? filas.find((f) => f.refer === c.refer) : undefined) ??
          null;
      }
      return NextResponse.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
    }

    const numero = sp.get("numero");
    if (numero) {
      const filas = await sql`
        SELECT numero, username, estado, lineas, n_materiales, total_sin_igv::float AS total, tickets,
               creado_en, actualizado_en, estado_por, estado_en
        FROM solicitudes_materiales
        WHERE numero = ${numero} AND (${esAdmin}::boolean OR username = ${yo})
      `;
      if (filas.length === 0) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
      return NextResponse.json({ data: filas[0] });
    }
    const q = (sp.get("q") ?? "").trim().slice(0, 100);
    const estado = sp.get("estado") ?? "";
    const patron = `%${q.replace(/[\\%_]/g, (m: string) => `\\${m}`)}%`;
    const filas = await sql`
      SELECT numero, username, estado, n_materiales, total_sin_igv::float AS total, tickets,
             creado_en, actualizado_en, estado_por, estado_en
      FROM solicitudes_materiales
      WHERE (${esAdmin}::boolean OR username = ${yo})
        AND (${estado} = '' OR estado = ${estado})
        AND (${q} = '' OR numero ILIKE ${patron} OR tickets ILIKE ${patron} OR username ILIKE ${patron}
             OR lineas::text ILIKE ${patron})
      ORDER BY creado_en DESC, id DESC
      LIMIT 300
    `;
    return NextResponse.json({ data: filas });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo leer el historial de solicitudes" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const acceso = await exigirSesion();
  if (acceso.error) return acceso.error;
  const esAdmin = acceso.user.rol === "admin";
  const body = await leerJson(req);
  const numero = String(body?.numero ?? "");
  const m = FORMATO.exec(numero);
  if (!m || !Array.isArray(body?.lineas) || body.lineas.length === 0 || body.lineas.length > MAX_LINEAS) {
    return NextResponse.json({ error: "Solicitud no válida" }, { status: 400 });
  }
  // Mismas reglas de limpieza que el borrador; sin el uid (es solo del navegador).
  const lineas = (leerBorrador(JSON.stringify({ lineas: body.lineas }))?.lineas ?? []).map((l) => {
    const { uid, ...resto } = l;
    void uid;
    return resto;
  });
  if (lineas.length === 0) return NextResponse.json({ error: "La solicitud no tiene materiales" }, { status: 400 });
  const total = Math.round(lineas.reduce((s, l) => s + (l.precio ?? 0) * l.cantidad, 0) * 100) / 100;
  const tickets = [...new Set(lineas.map((l) => (l.ticket ?? "").trim()).filter(Boolean))].join(", ").slice(0, 500);
  try {
    await ensureSchema();
    const filas = await sql`
      INSERT INTO solicitudes_materiales (numero, username, lineas, n_materiales, total_sin_igv, tickets)
      SELECT ${numero}, ${acceso.user.username}, ${JSON.stringify(lineas)}::jsonb, ${lineas.length}, ${total}, ${tickets}
      WHERE EXISTS (SELECT 1 FROM solicitudes_numeracion WHERE anio = ${Number(m[1])} AND ultimo >= ${Number(m[2])})
      ON CONFLICT (numero) DO UPDATE SET
        lineas = EXCLUDED.lineas, n_materiales = EXCLUDED.n_materiales, total_sin_igv = EXCLUDED.total_sin_igv,
        tickets = EXCLUDED.tickets, actualizado_en = now()
      WHERE solicitudes_materiales.username = EXCLUDED.username OR ${esAdmin}::boolean
      RETURNING numero, estado
    `;
    if (filas.length === 0) {
      return NextResponse.json({ error: "Ese N° de solicitud no existe o es de otro usuario" }, { status: 403 });
    }
    return NextResponse.json({ data: filas[0] });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo registrar la solicitud en el historial" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const acceso = await exigirAdmin();
  if (acceso.error) return acceso.error;
  const body = await leerJson(req);
  const numero = String(body?.numero ?? "");
  const estado = String(body?.estado ?? "");
  if (!FORMATO.test(numero) || !(ESTADOS_SOLICITUD as readonly string[]).includes(estado)) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }
  try {
    await ensureSchema();
    const filas = await sql`
      UPDATE solicitudes_materiales SET estado = ${estado}, estado_por = ${acceso.user.username}, estado_en = now()
      WHERE numero = ${numero}
      RETURNING numero, estado
    `;
    if (filas.length === 0) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
    return NextResponse.json({ data: filas[0] });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo cambiar el estado" }, { status: 500 });
  }
}
