import { exigirSesion } from "@/lib/server/utils";
import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { ESTADOS_CON_PLAZO, DIAS_ATRASO } from "@/lib/shared";

type FilaPanel = {
  g: number;
  estado: string | null; tipo_trab: string | null; area: string | null; lugar: string | null;
  mes: string | null; proveedor: string | null;
  cantidad: number; monto: number; finalizados: number; pendientes: number; atrasados: number;
};
type Barra = { label: string; cantidad: number; monto: number };

// GROUPING(...) vale 1 en el bit de cada columna que NO se agrupa (la primera columna es el bit más alto):
// con esto se sabe a cuál de los 7 grupos pertenece cada fila.
const GRUPO = { estado: 31, tipo: 47, area: 55, lugar: 59, mes: 61, proveedor: 62, total: 63 } as const;

/** Reparte las filas de la consulta única en las mismas listas que devolvían las 7 consultas de antes. */
function armarPanel(filas: FilaPanel[]) {
  const o = {
    porEstado: [] as Barra[], porTipo: [] as Barra[], porArea: [] as Barra[], porLugar: [] as Barra[],
    porMes: [] as Barra[], porProveedor: [] as Barra[],
    totales: { total_tickets: 0, monto_total: 0, finalizados: 0, pendientes: 0, atrasados: 0 },
  };
  for (const r of filas) {
    const b = { cantidad: r.cantidad, monto: r.monto };
    switch (r.g) {
      case GRUPO.estado: o.porEstado.push({ label: r.estado ?? "Sin estado", ...b }); break;
      case GRUPO.tipo: o.porTipo.push({ label: r.tipo_trab ?? "Sin tipo", ...b }); break;
      case GRUPO.area: o.porArea.push({ label: r.area ?? "Sin área", ...b }); break;
      case GRUPO.lugar: o.porLugar.push({ label: r.lugar ?? "Sin lugar", ...b }); break;
      case GRUPO.mes: if (r.mes !== null) o.porMes.push({ label: r.mes, ...b }); break;
      case GRUPO.proveedor:
        if (r.proveedor !== null && r.proveedor !== "") o.porProveedor.push({ label: r.proveedor, ...b });
        break;
      case GRUPO.total:
        o.totales = {
          total_tickets: r.cantidad, monto_total: r.monto,
          finalizados: r.finalizados, pendientes: r.pendientes, atrasados: r.atrasados,
        };
        break;
    }
  }
  const porCantidad = (a: Barra, b: Barra) => b.cantidad - a.cantidad;
  const porMonto = (a: Barra, b: Barra) => b.monto - a.monto;
  o.porEstado.sort(porCantidad);
  o.porLugar.sort(porCantidad);
  o.porTipo.sort(porMonto);
  o.porArea.sort(porMonto);
  o.porMes.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  o.porProveedor.sort(porMonto);
  o.porProveedor = o.porProveedor.slice(0, 8);
  return o;
}

export async function GET() {
  try {
    const acceso = await exigirSesion();
    if (acceso.error) return acceso.error;
    await ensureSchema(); // asegura la columna estado_desde
    // UNA sola consulta (una sola lectura de la tabla) calcula todo el panel con GROUPING SETS: antes eran 7
    // consultas que leían la tabla completa cada una (con 20 000 tickets: ~85 ms → ~35 ms).
    const filas = (await sql`
      SELECT GROUPING(estado, tipo_trab, area, lugar, mes, proveedor)::int AS g,
             estado, tipo_trab, area, lugar, mes, proveedor,
             COUNT(*)::int AS cantidad,
             COALESCE(SUM(monto), 0)::float AS monto,
             COUNT(*) FILTER (WHERE estado = 'Finalizado')::int AS finalizados,
             COUNT(*) FILTER (WHERE estado != 'Finalizado')::int AS pendientes,
             COUNT(*) FILTER (WHERE atrasado)::int AS atrasados
      FROM (
        SELECT estado, tipo_trab, area, lugar, proveedor, TO_CHAR(f_reg, 'YYYY-MM') AS mes, monto,
               (estado = ANY(string_to_array(${ESTADOS_CON_PLAZO.join("|")}, '|'))
                AND COALESCE(estado_desde, f_reg::timestamptz, updated_at)
                    < now() - make_interval(days => ${DIAS_ATRASO}::int)) AS atrasado
        FROM correctivos
        WHERE eliminado_en IS NULL
      ) c
      GROUP BY GROUPING SETS ((estado), (tipo_trab), (area), (lugar), (mes), (proveedor), ())
    `) as FilaPanel[];
    const { porEstado, porTipo, porArea, porLugar, porMes, porProveedor, totales } = armarPanel(filas);

    // Espacio usado (solo administradores): los adjuntos se guardan dentro de la base de datos, así que
    // con el tiempo pueden llenar el plan. El límite se configura con LIMITE_BASE_MB (por defecto
    // 512 MB, el del plan gratuito de Neon).
    let almacenamiento = null;
    if (acceso.user.rol === "admin") {
      try {
        const [e] = (await sql`
          SELECT pg_database_size(current_database())::float AS base,
                 (SELECT COALESCE(SUM(tamano), 0)::float FROM archivos) AS arch,
                 (SELECT COUNT(*)::int FROM archivos) AS n
        `) as { base: number; arch: number; n: number }[];
        const limiteMb = Number(process.env.LIMITE_BASE_MB) > 0 ? Number(process.env.LIMITE_BASE_MB) : 512;
        almacenamiento = {
          baseBytes: e.base, archivosBytes: e.arch, archivos: e.n, limiteBytes: limiteMb * 1024 * 1024,
        };
      } catch (err) {
        console.warn("No se pudo medir el espacio de la base de datos", err);
      }
    }

    return NextResponse.json({
      porEstado,
      porTipo,
      porArea,
      porLugar,
      porMes,
      porProveedor,
      totales,
      almacenamiento,
    }, { headers: { "Cache-Control": "private, max-age=15" } });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Error al obtener el dashboard" },
      { status: 500 }
    );
  }
}
