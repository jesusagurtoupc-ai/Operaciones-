import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { ESTADOS_CON_PLAZO, DIAS_ATRASO } from "@/lib/shared/opciones";

export async function GET() {
  try {
    await ensureSchema(); // asegura la columna estado_desde
    const [porEstado, porTipo, porArea, porLugar, porMes, totales, porProveedor] = await Promise.all([
      sql`
        SELECT COALESCE(estado, 'Sin estado') AS label, COUNT(*)::int AS cantidad,
               COALESCE(SUM(monto), 0)::float AS monto
        FROM correctivos GROUP BY estado ORDER BY cantidad DESC
      `,
      sql`
        SELECT COALESCE(tipo_trab, 'Sin tipo') AS label, COUNT(*)::int AS cantidad,
               COALESCE(SUM(monto), 0)::float AS monto
        FROM correctivos GROUP BY tipo_trab ORDER BY monto DESC
      `,
      sql`
        SELECT COALESCE(area, 'Sin área') AS label, COUNT(*)::int AS cantidad,
               COALESCE(SUM(monto), 0)::float AS monto
        FROM correctivos GROUP BY area ORDER BY monto DESC
      `,
      sql`
        SELECT COALESCE(lugar, 'Sin lugar') AS label, COUNT(*)::int AS cantidad,
               COALESCE(SUM(monto), 0)::float AS monto
        FROM correctivos GROUP BY lugar ORDER BY cantidad DESC
      `,
      sql`
        SELECT TO_CHAR(f_reg, 'YYYY-MM') AS label, COUNT(*)::int AS cantidad,
               COALESCE(SUM(monto), 0)::float AS monto
        FROM correctivos
        WHERE f_reg IS NOT NULL
        GROUP BY TO_CHAR(f_reg, 'YYYY-MM')
        ORDER BY label ASC
      `,
      sql`
        SELECT COUNT(*)::int AS total_tickets,
               COALESCE(SUM(monto), 0)::float AS monto_total,
               COUNT(*) FILTER (WHERE estado = 'Finalizado')::int AS finalizados,
               COUNT(*) FILTER (WHERE estado != 'Finalizado')::int AS pendientes,
               COUNT(*) FILTER (
                 WHERE estado = ANY(string_to_array(${ESTADOS_CON_PLAZO.join("|")}, '|'))
                   AND COALESCE(estado_desde, f_reg::timestamptz, updated_at)
                       < now() - make_interval(days => ${DIAS_ATRASO}::int)
               )::int AS atrasados
        FROM correctivos
      `,
      sql`
        SELECT proveedor AS label, COUNT(*)::int AS cantidad,
               COALESCE(SUM(monto), 0)::float AS monto
        FROM correctivos
        WHERE proveedor IS NOT NULL AND proveedor <> ''
        GROUP BY proveedor ORDER BY monto DESC LIMIT 8
      `,
    ]);

    return NextResponse.json({
      porEstado,
      porTipo,
      porArea,
      porLugar,
      porMes,
      porProveedor,
      totales: totales[0],
    }, { headers: { "Cache-Control": "private, max-age=15" } });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Error al obtener el dashboard" },
      { status: 500 }
    );
  }
}
