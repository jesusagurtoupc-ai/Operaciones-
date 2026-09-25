import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET() {
  try {
    const [porEstado, porTipo, porArea, porMes, totales] = await Promise.all([
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
                 WHERE estado != 'Finalizado' AND f_reg < (CURRENT_DATE - INTERVAL '30 days')
               )::int AS atrasados
        FROM correctivos
      `,
    ]);

    return NextResponse.json({
      porEstado,
      porTipo,
      porArea,
      porMes,
      totales: totales[0],
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Error al obtener el dashboard" },
      { status: 500 }
    );
  }
}
