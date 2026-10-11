import { exigirSesion } from "@/lib/server/acceso";
import { registrarAcceso } from "@/lib/server/auditoriaAccesos";
import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { toDateOnly } from "@/lib/shared/types";
import { buildWhere } from "@/lib/server/filtros";
import { errorFiltrosFecha } from "@/lib/server/validacion";
import { buildOrderBy } from "@/lib/server/orden";
import ExcelJS from "exceljs";

const COLUMNAS: { key: string; header: string }[] = [
  { key: "refer", header: "Refer" },
  { key: "ticket", header: "Ticket" },
  { key: "f_reg", header: "F. Reg" },
  { key: "descripcion", header: "Descripción" },
  { key: "lugar", header: "Lugar" },
  { key: "estado", header: "Estado" },
  { key: "proveedor", header: "Proveedor" },
  { key: "monto", header: "Monto" },
  { key: "f_coti", header: "F.Coti" },
  { key: "f_oc", header: "F. OC" },
  { key: "f_inicio", header: "F. Inicio" },
  { key: "f_fin", header: "F. Fin" },
  { key: "cuenta", header: "Cuenta" },
  { key: "tipo_trab", header: "Tipo Trab" },
  { key: "sub_tipo_trab", header: "Sub Tipo Trab" },
  { key: "n_oc", header: "N.OC" },
  { key: "area", header: "Area" },
];

// Tope de filas por exportación: evita volcados enormes y consumo excesivo de memoria.
const MAX_FILAS_EXPORT = 20000;

const DATE_KEYS = new Set([
  "f_reg", "f_coti", "f_oc", "f_inicio", "f_fin",
]);

export async function GET(req: NextRequest) {
  const sesion = await exigirSesion();
  if (sesion.error) return sesion.error;
  try {
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const errorFecha = errorFiltrosFecha(searchParams);
    if (errorFecha) {
      return NextResponse.json({ error: errorFecha }, { status: 400 });
    }
    const { where, values } = buildWhere(searchParams);

    const query = `
      SELECT * FROM correctivos ${where}
      ORDER BY ${buildOrderBy(searchParams.get("orden"))}
      LIMIT ${MAX_FILAS_EXPORT}
    `;
    const rows = (await sql.query(query, values)) as Record<string, unknown>[];

    const data = rows.map((r) => {
      const obj: Record<string, unknown> = {};
      for (const c of COLUMNAS) {
        let v = r[c.key];
        // Postgres devuelve las columnas NUMERIC como texto (para no perder
        // precisión). Si no se convierten, Excel las trata como texto en
        // vez de números y no se pueden sumar ni filtrar como cifras.
        if (c.key === "monto" && v !== null && v !== undefined) {
          v = Number(v);
        }
        // Las columnas DATE pueden llegar como objeto Date o como string
        // ISO completo según el driver. Sin normalizar, Excel mostraba
        // literalmente "2026-08-27T00:00:00.000Z" como texto en vez de
        // una fecha limpia. Se reconstruye como Date a medianoche UTC
        // (así el día no cambia según la zona horaria del servidor) para que
        // Excel la reconozca como celda de fecha real (ordenable y
        // filtrable), no como texto plano.
        if (DATE_KEYS.has(c.key)) {
          const soloFecha = toDateOnly(v);
          v = soloFecha ? new Date(soloFecha + "T00:00:00Z") : null;
        }
        obj[c.header] = v;
      }
      return obj;
    });

    // exceljs escribe los textos siempre como texto: una descripción que
    // empiece con "=" no se ejecuta como fórmula al abrirla en Excel.
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Correctivos", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    worksheet.columns = COLUMNAS.map((c) => ({
      header: c.header,
      key: c.header,
      width: 18,
      style: DATE_KEYS.has(c.key) ? { numFmt: "dd/mm/yyyy" } : undefined,
    }));
    worksheet.addRows(data);
    worksheet.getRow(1).font = { bold: true };
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: COLUMNAS.length },
    };

    const buffer = new Uint8Array(await workbook.xlsx.writeBuffer());
    await registrarAcceso(
      "export",
      sesion.user.username,
      req,
      `${rows.length} filas${searchParams.toString() ? ` · filtros: ${searchParams.toString()}` : ""}`
    );

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="correctivos_${new Date()
          .toISOString()
          .slice(0, 10)}.xlsx"`,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Error al exportar" },
      { status: 500 }
    );
  }
}
