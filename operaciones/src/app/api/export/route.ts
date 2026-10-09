import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/server/db";
import { toDateOnly } from "@/lib/shared/types";
import { buildWhere } from "@/lib/server/filtros";
import * as XLSX from "xlsx";

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

const DATE_KEYS = new Set([
  "f_reg", "f_coti", "f_oc", "f_inicio", "f_fin",
]);

export async function GET(req: NextRequest) {
  try {
    await ensureSchema();
    const { searchParams } = new URL(req.url);
    const { where, values } = buildWhere(searchParams);

    const query = `
      SELECT * FROM correctivos ${where}
      ORDER BY f_reg DESC NULLS LAST, id DESC
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
        // una fecha limpia. Se reconstruye como Date a mediodía local
        // para que Excel la reconozca como celda de fecha real (ordenable
        // y filtrable), no como texto plano.
        if (DATE_KEYS.has(c.key)) {
          const soloFecha = toDateOnly(v);
          v = soloFecha ? new Date(soloFecha + "T00:00:00") : null;
        }
        obj[c.header] = v;
      }
      return obj;
    });

    const worksheet = XLSX.utils.json_to_sheet(data, {
      header: COLUMNAS.map((c) => c.header),
    });
    worksheet["!cols"] = COLUMNAS.map(() => ({ wch: 18 }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Correctivos");

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buffer, {
      status: 200,
      headers: {
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
