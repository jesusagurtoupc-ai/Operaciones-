import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, sql } from "@/lib/server/db";
import { exigirAdmin, exigirSesion } from "@/lib/server/utils";

export const dynamic = "force-dynamic";

/**
 * Inventario de equipos (página Inventario) y lo que lo acompaña.
 *
 *  GET                  → el inventario vigente (formato de public/inventario-equipos.json); 404 si nunca se
 *                         guardó uno (la página usa el archivo); 304 si el navegador ya tiene esa versión.
 *  GET ?extra=1         → por equipo: correctivos enlazados (cantidad y monto), última verificación, último
 *                         mantenimiento y fallas registradas; más la configuración (precios, presupuesto,
 *                         frecuencias) y la evolución mensual de los KPI.
 *  GET ?bitacora=CÓDIGO → la bitácora del equipo (cambios de estado, mantenimientos, verificaciones).
 *  GET ?tickets=CÓDIGO  → los correctivos enlazados a ese equipo.
 *  GET ?equipos=1       → lista corta (código, nombre, ubicación) para elegir el equipo de un ticket.
 *  GET ?ticket=ID       → el equipo enlazado a ese ticket (o null).
 *
 *  POST                 → reemplaza el inventario completo (Excel subido o primera versión). Admin.
 *  POST ?accion=verificar  { codigo, nota? }            → "verificado en campo hoy". Admin.
 *  POST ?accion=config     { clave, valor }             → guarda precios / presupuesto / frecuencias. Admin.
 *  POST ?accion=enlazar    { correctivo_id, codigo|null } → enlaza un ticket a un equipo (queda en el
 *                                                            historial del ticket). Admin.
 *  PATCH { codigo, cambios: { estado?, observaciones?, informe?, alerta?, ultimo_mant? } }
 *                       → actualiza un equipo tras el mantenimiento; queda en su bitácora. Admin.
 *
 * Tras cada cambio se actualiza la foto de KPI del mes (evolución).
 */

const MAX_BYTES = 4 * 1024 * 1024;
const ESTADOS = ["OPERATIVO", "OPERATIVO CON OBSERVACION", "INOPERATIVO", ""];
const CLAVES_CONFIG = ["precios", "presupuesto", "frecuencias"];
const CODIGO = /^[\w.-]{1,40}$/;

type Inventario = { equipos: Record<string, unknown>[] } & Record<string, unknown>;
function valido(d: unknown): d is Inventario {
  if (!d || typeof d !== "object" || !Array.isArray((d as Inventario).equipos)) return false;
  const eq = (d as Inventario).equipos;
  // Un equipo sin código puede venir con null: se guarda como texto vacío.
  for (const e of eq) if (e && typeof e === "object" && (e.codigo === null || e.codigo === undefined)) e.codigo = "";
  return (
    eq.length > 0 &&
    eq.length <= 5000 &&
    eq.every(
      (e) =>
        e && typeof e === "object" && typeof e.sistema === "string" && typeof e.nombre === "string" &&
        typeof e.ubicacion === "string" && typeof e.codigo === "string" && Array.isArray(e.fuentes)
    )
  );
}

const mesLima = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" }).slice(0, 7);

/** Foto de los KPI del mes con el inventario vigente (se sobrescribe dentro del mismo mes). */
async function fotoDelMes(campus: string) {
  await sql`
    INSERT INTO inventario_kpi_mensual (campus, mes, datos)
    SELECT ${campus}, ${mesLima()}, jsonb_build_object(
      'total', COUNT(*),
      'operativos', COUNT(*) FILTER (WHERE e->>'estado' = 'OPERATIVO'),
      'observacion', COUNT(*) FILTER (WHERE e->>'estado' = 'OPERATIVO CON OBSERVACION'),
      'inoperativos', COUNT(*) FILTER (WHERE e->>'estado' = 'INOPERATIVO'),
      'sin_informe', COUNT(*) FILTER (WHERE COALESCE(e->>'estado', '') = ''),
      'reemplazo', COUNT(*) FILTER (WHERE e->>'alerta' ILIKE '%reemplazo%'),
      'vida_superada', COUNT(*) FILTER (WHERE jsonb_typeof(e->'meses_excedidos') = 'number' AND (e->>'meses_excedidos')::numeric > 0)
    )
    FROM jsonb_array_elements((SELECT datos->'equipos' FROM inventario_equipos WHERE campus = ${campus} ORDER BY id DESC LIMIT 1)) e
    HAVING COUNT(*) > 0
    ON CONFLICT (campus, mes) DO UPDATE SET datos = EXCLUDED.datos, actualizado = now()
  `;
}

export async function GET(req: NextRequest) {
  const acceso = await exigirSesion();
  if (acceso.error) return acceso.error;
  try {
    await ensureSchema();
    const sp = req.nextUrl.searchParams;
    const sinCache = { "Cache-Control": "private, no-store" };
    // Cada campus tiene su propio inventario, bitácora, configuración e indicadores.
    const campus = acceso.user.campus;

    if (sp.get("extra") === "1") {
      const [tickets, verif, mant, fallas, config, evolucion] = await Promise.all([
        sql`SELECT ec.codigo, COUNT(*)::int AS n, COALESCE(SUM(c.monto), 0)::float AS monto
            FROM equipo_correctivos ec JOIN correctivos c ON c.id = ec.correctivo_id AND c.eliminado_en IS NULL AND c.campus = ${campus}
            GROUP BY ec.codigo`,
        sql`SELECT codigo, MAX(creado_en) AS fecha FROM inventario_bitacora WHERE campus = ${campus} AND tipo = 'verificacion' GROUP BY codigo`,
        sql`SELECT codigo, MAX((detalle->>'fecha')::date)::text AS fecha FROM inventario_bitacora
            WHERE campus = ${campus} AND tipo = 'mantenimiento' AND detalle->>'fecha' ~ '^\\d{4}-\\d{2}-\\d{2}$' GROUP BY codigo`,
        sql`SELECT codigo, COUNT(*)::int AS n FROM inventario_bitacora
            WHERE campus = ${campus} AND tipo = 'estado' AND detalle->>'despues' IN ('INOPERATIVO', 'OPERATIVO CON OBSERVACION')
              AND detalle->>'antes' IS DISTINCT FROM detalle->>'despues'
            GROUP BY codigo`,
        sql`SELECT clave, valor FROM inventario_config WHERE campus = ${campus}`,
        sql`SELECT mes, datos FROM inventario_kpi_mensual WHERE campus = ${campus} ORDER BY mes DESC LIMIT 36`,
      ]);
      const mapa = <T,>(filas: Record<string, unknown>[], valor: (f: Record<string, unknown>) => T) =>
        Object.fromEntries(filas.map((f) => [String(f.codigo), valor(f)]));
      return NextResponse.json(
        {
          tickets: mapa(tickets as Record<string, unknown>[], (f) => ({ n: f.n, monto: f.monto })),
          verificado: mapa(verif as Record<string, unknown>[], (f) => new Date(String(f.fecha)).toISOString()),
          mantenimiento: mapa(mant as Record<string, unknown>[], (f) => f.fecha),
          fallas: mapa(fallas as Record<string, unknown>[], (f) => f.n),
          config: Object.fromEntries((config as { clave: string; valor: unknown }[]).map((c) => [c.clave, c.valor])),
          evolucion: (evolucion as { mes: string; datos: unknown }[]).reverse(),
        },
        { headers: sinCache }
      );
    }
    const codigoBitacora = sp.get("bitacora");
    if (codigoBitacora !== null) {
      if (!CODIGO.test(codigoBitacora)) return NextResponse.json({ error: "Código inválido" }, { status: 400 });
      const filas = await sql`
        SELECT id, tipo, detalle, usuario, creado_en FROM inventario_bitacora
        WHERE codigo = ${codigoBitacora} AND campus = ${campus} ORDER BY creado_en DESC, id DESC LIMIT 100
      `;
      return NextResponse.json({ data: filas }, { headers: sinCache });
    }
    const codigoTickets = sp.get("tickets");
    if (codigoTickets !== null) {
      if (!CODIGO.test(codigoTickets)) return NextResponse.json({ error: "Código inválido" }, { status: 400 });
      const filas = await sql`
        SELECT c.id, c.refer, c.ticket, c.descripcion, c.estado, c.monto::float AS monto, c.f_reg::text AS f_reg
        FROM equipo_correctivos ec JOIN correctivos c ON c.id = ec.correctivo_id AND c.eliminado_en IS NULL AND c.campus = ${campus}
        WHERE ec.codigo = ${codigoTickets} ORDER BY c.refer DESC NULLS LAST LIMIT 200
      `;
      return NextResponse.json({ data: filas }, { headers: sinCache });
    }
    const ticketId = sp.get("ticket");
    if (ticketId !== null) {
      const id = Number(ticketId);
      if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Ticket inválido" }, { status: 400 });
      const f = (await sql`SELECT ec.codigo FROM equipo_correctivos ec JOIN correctivos c ON c.id = ec.correctivo_id
                              WHERE ec.correctivo_id = ${id} AND c.campus = ANY(${acceso.user.campusPermitidos}::text[])`) as { codigo: string }[];
      return NextResponse.json({ codigo: f[0]?.codigo ?? null }, { headers: sinCache });
    }
    if (sp.get("equipos") === "1") {
      const f = (await sql`
        SELECT jsonb_agg(jsonb_build_object('codigo', e->>'codigo', 'nombre', e->>'nombre', 'ubicacion', e->>'ubicacion',
               'pabellon', e->>'pabellon', 'piso', e->>'piso'))::text AS lista
        FROM jsonb_array_elements((SELECT datos->'equipos' FROM inventario_equipos WHERE campus = ${campus} ORDER BY id DESC LIMIT 1)) e
        WHERE COALESCE(e->>'codigo', '') <> ''
      `) as { lista: string | null }[];
      if (!f[0]?.lista) return NextResponse.json({ error: "Sin inventario guardado" }, { status: 404 });
      return new NextResponse(f[0].lista, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, max-age=300", Vary: "Cookie" } });
    }

    const u = (await sql`SELECT id, version FROM inventario_equipos WHERE campus = ${campus} ORDER BY id DESC LIMIT 1`) as { id: number; version: number }[];
    if (u.length === 0) return NextResponse.json({ error: "Sin inventario guardado" }, { status: 404 });
    const etag = `"inv-${u[0].id}-${u[0].version}"`;
    if (req.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag, "Cache-Control": "private, no-cache" } });
    }
    const f = (await sql`SELECT datos::text AS datos FROM inventario_equipos WHERE id = ${u[0].id}`) as { datos: string }[];
    return new NextResponse(f[0].datos, {
      headers: { "Content-Type": "application/json; charset=utf-8", ETag: etag, "Cache-Control": "private, no-cache" },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo leer el inventario" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const acceso = await exigirAdmin();
  if (acceso.error) return acceso.error;
  const usuario = acceso.user.username;
  const campus = acceso.user.campus;
  try {
    const accion = req.nextUrl.searchParams.get("accion");
    if (accion) {
      const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!b) return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
      await ensureSchema();

      if (accion === "verificar") {
        const codigo = String(b.codigo ?? "");
        if (!CODIGO.test(codigo)) return NextResponse.json({ error: "Código inválido" }, { status: 400 });
        const nota = String(b.nota ?? "").slice(0, 500);
        const f = await sql`
          INSERT INTO inventario_bitacora (campus, codigo, tipo, detalle, usuario)
          VALUES (${campus}, ${codigo}, 'verificacion', ${JSON.stringify(nota ? { nota } : {})}::jsonb, ${usuario})
          RETURNING id, tipo, detalle, usuario, creado_en
        `;
        return NextResponse.json({ data: f[0] });
      }

      if (accion === "config") {
        const clave = String(b.clave ?? "");
        if (!CLAVES_CONFIG.includes(clave)) return NextResponse.json({ error: "Configuración desconocida" }, { status: 400 });
        const valor = b.valor;
        // Solo objetos de números (precio por tipo, presupuesto por año, meses por tipo).
        if (!valor || typeof valor !== "object" || Array.isArray(valor) ||
            !Object.entries(valor).every(([k, v]) => k.length <= 120 && typeof v === "number" && Number.isFinite(v) && v >= 0) ||
            Object.keys(valor).length > 200) {
          return NextResponse.json({ error: "Valores inválidos" }, { status: 400 });
        }
        await sql`
          INSERT INTO inventario_config (campus, clave, valor, usuario) VALUES (${campus}, ${clave}, ${JSON.stringify(valor)}::jsonb, ${usuario})
          ON CONFLICT (campus, clave) DO UPDATE SET valor = EXCLUDED.valor, usuario = EXCLUDED.usuario, actualizado = now()
        `;
        return NextResponse.json({ ok: true });
      }

      if (accion === "enlazar") {
        const id = Number(b.correctivo_id);
        const codigo = b.codigo === null || b.codigo === "" ? null : String(b.codigo ?? "");
        if (!Number.isInteger(id) || id <= 0 || (codigo !== null && !CODIGO.test(codigo))) {
          return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
        }
        // Enlace + línea en el historial del ticket, en una sola instrucción.
        const f = (await sql`
          WITH antes AS (SELECT codigo FROM equipo_correctivos WHERE correctivo_id = ${id}),
          t AS (SELECT id FROM correctivos WHERE id = ${id} AND campus = ${campus} AND eliminado_en IS NULL),
          borrar AS (
            DELETE FROM equipo_correctivos WHERE correctivo_id = ${id} AND ${codigo}::text IS NULL AND EXISTS (SELECT 1 FROM t)
          ),
          poner AS (
            INSERT INTO equipo_correctivos (correctivo_id, codigo, usuario)
            SELECT ${id}, ${codigo}::text, ${usuario} FROM t WHERE ${codigo}::text IS NOT NULL
            ON CONFLICT (correctivo_id) DO UPDATE SET codigo = EXCLUDED.codigo, usuario = EXCLUDED.usuario, creado_en = now()
          ),
          hist AS (
            INSERT INTO historial (correctivo_id, usuario, detalle)
            SELECT ${id}, ${usuario}, format('Equipo del inventario: %s → %s',
                   COALESCE((SELECT codigo FROM antes), 'ninguno'), COALESCE(${codigo}::text, 'ninguno'))
            FROM t WHERE (SELECT codigo FROM antes) IS DISTINCT FROM ${codigo}::text
          )
          SELECT (SELECT COUNT(*) FROM t)::int AS existe
        `) as { existe: number }[];
        if (!f[0]?.existe) return NextResponse.json({ error: "No se encontró el ticket" }, { status: 404 });
        return NextResponse.json({ ok: true, codigo });
      }
      return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
    }

    const texto = await req.text();
    if (texto.length > MAX_BYTES) return NextResponse.json({ error: "El inventario es demasiado grande" }, { status: 413 });
    let d: unknown;
    try {
      d = JSON.parse(texto);
    } catch {
      return NextResponse.json({ error: "Inventario inválido" }, { status: 400 });
    }
    if (!valido(d)) return NextResponse.json({ error: "El inventario no tiene el formato esperado" }, { status: 400 });
    const motivo = String((d as Record<string, unknown>).motivo ?? "Excel subido").slice(0, 200);
    await ensureSchema();
    const f = await sql`
      WITH nuevo AS (
        INSERT INTO inventario_equipos (campus, datos, equipos, motivo, subido_por)
        VALUES (${campus}, ${JSON.stringify(d)}::jsonb, ${d.equipos.length}, ${motivo}, ${usuario})
        RETURNING id, equipos, motivo, subido_por, subido_en
      ),
      viejos AS (
        -- Se guardan las 5 últimas versiones de cada campus.
        DELETE FROM inventario_equipos
        WHERE campus = ${campus} AND id NOT IN (SELECT id FROM inventario_equipos WHERE campus = ${campus} ORDER BY id DESC LIMIT 4)
      )
      SELECT * FROM nuevo
    `;
    await fotoDelMes(campus).catch((e) => console.error("[inventario] KPI del mes", e));
    return NextResponse.json({ data: f[0] });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const acceso = await exigirAdmin();
  if (acceso.error) return acceso.error;
  try {
    const b = (await req.json().catch(() => null)) as { codigo?: unknown; cambios?: Record<string, unknown> } | null;
    const codigo = typeof b?.codigo === "string" ? b.codigo.trim() : "";
    if (!CODIGO.test(codigo) || !b?.cambios || typeof b.cambios !== "object") {
      return NextResponse.json({ error: "Falta el código del equipo o los cambios" }, { status: 400 });
    }
    const cambios: Record<string, string> = {};
    for (const k of ["estado", "observaciones", "informe", "alerta", "ultimo_mant"] as const) {
      const v = b.cambios[k];
      if (v === undefined) continue;
      if (typeof v !== "string") return NextResponse.json({ error: `Valor inválido en ${k}` }, { status: 400 });
      cambios[k] = k === "observaciones" ? v.slice(0, 4000) : v.trim().slice(0, 300);
    }
    if ("estado" in cambios && !ESTADOS.includes(cambios.estado)) {
      return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
    }
    if (cambios.ultimo_mant !== undefined && cambios.ultimo_mant !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(cambios.ultimo_mant)) {
      return NextResponse.json({ error: "Fecha de mantenimiento inválida" }, { status: 400 });
    }
    if (Object.keys(cambios).length === 0) return NextResponse.json({ error: "No hay cambios" }, { status: 400 });
    const usuario = acceso.user.username;
    const campus = acceso.user.campus;
    const marca = { ...cambios, editado_por: usuario, editado_en: new Date().toISOString() };
    const mant = cambios.ultimo_mant || null;
    await ensureSchema();
    // Una sola sentencia: bloquea la versión vigente, reemplaza solo ese equipo y anota la bitácora
    // (cambio de estado con el antes y el después; mantenimiento con su fecha y su informe).
    const f = (await sql`
      WITH u AS (SELECT id, datos FROM inventario_equipos WHERE campus = ${campus} ORDER BY id DESC LIMIT 1 FOR UPDATE),
      previo AS (
        SELECT x.e FROM u, jsonb_array_elements(u.datos->'equipos') x(e) WHERE x.e->>'codigo' = ${codigo} LIMIT 1
      ),
      act AS (
        UPDATE inventario_equipos i
        SET version = i.version + 1,
            datos = jsonb_set(u.datos, '{equipos}', (
              SELECT jsonb_agg(CASE WHEN x.e->>'codigo' = ${codigo} THEN x.e || ${JSON.stringify(marca)}::jsonb ELSE x.e END ORDER BY x.o)
              FROM jsonb_array_elements(u.datos->'equipos') WITH ORDINALITY AS x(e, o)
            ))
        FROM u
        WHERE i.id = u.id AND EXISTS (SELECT 1 FROM previo)
        RETURNING i.id
      ),
      b1 AS (
        INSERT INTO inventario_bitacora (campus, codigo, tipo, detalle, usuario)
        SELECT ${campus}, ${codigo}, 'estado',
               jsonb_build_object('antes', COALESCE((SELECT e->>'estado' FROM previo), ''), 'despues', ${cambios.estado ?? null}::text,
                                  'observaciones', ${cambios.observaciones ?? null}::text, 'alerta', ${cambios.alerta ?? null}::text),
               ${usuario}
        FROM act
        WHERE ${cambios.estado ?? null}::text IS NOT NULL OR ${cambios.observaciones ?? null}::text IS NOT NULL
      ),
      b2 AS (
        INSERT INTO inventario_bitacora (campus, codigo, tipo, detalle, usuario)
        SELECT ${campus}, ${codigo}, 'mantenimiento', jsonb_build_object('fecha', ${mant}::text, 'informe', ${cambios.informe ?? null}::text), ${usuario}
        FROM act WHERE ${mant}::text IS NOT NULL
      )
      SELECT id FROM act
    `) as { id: number }[];
    if (f.length === 0) return NextResponse.json({ error: "No se encontró ese equipo en el inventario guardado" }, { status: 404 });
    await fotoDelMes(campus).catch((e) => console.error("[inventario] KPI del mes", e));
    return NextResponse.json({ ok: true, equipo: { codigo, ...marca } });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo guardar el cambio" }, { status: 500 });
  }
}
