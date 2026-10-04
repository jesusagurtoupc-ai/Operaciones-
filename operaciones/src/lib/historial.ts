import { sql } from "@/lib/db";

/** Nombres legibles de los campos del ticket, para el historial. */
export const ETIQUETAS: Record<string, string> = {
  refer: "N° Refer.",
  ticket: "Ticket",
  f_reg: "F. registro",
  descripcion: "Descripción",
  lugar: "Lugar",
  estado: "Estado",
  proveedor: "Proveedor",
  monto: "Monto",
  f_coti: "F. cotización",
  f_oc: "F. OC",
  f_inicio: "F. inicio",
  f_fin: "F. fin",
  cuenta: "Cuenta",
  tipo_trab: "Tipo de trabajo",
  sub_tipo_trab: "Sub tipo",
  n_oc: "N° OC",
  area: "Área",
};

function texto(v: unknown): string {
  if (v === null || v === undefined || v === "") return "vacío";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const t = String(v);
  // Fecha completa ("2026-08-18T00:00:00.000Z") -> solo el día.
  return /^\d{4}-\d{2}-\d{2}T/.test(t) ? t.slice(0, 10) : t;
}

/** Lista los campos que cambiaron entre la fila anterior y los datos nuevos. */
export function diferencias(
  antes: Record<string, unknown>,
  nuevo: Record<string, unknown>
): string[] {
  const out: string[] = [];
  for (const campo of Object.keys(ETIQUETAS)) {
    if (!(campo in nuevo)) continue;
    const a = texto(antes[campo]);
    let n = nuevo[campo];
    if (campo === "monto") {
      const aNum = antes[campo] === null || antes[campo] === undefined ? null : Number(antes[campo]);
      const nNum = n === null || n === undefined || n === "" ? null : Number(n);
      if (aNum === nNum) continue;
    }
    n = texto(n);
    if (a !== n) out.push(`${ETIQUETAS[campo]}: ${a} → ${n}`);
  }
  return out;
}

/** Guarda una línea en el historial; si falla, no interrumpe la operación. */
export async function registrar(
  correctivoId: number,
  usuario: string | undefined,
  detalle: string
) {
  try {
    await sql`
      INSERT INTO historial (correctivo_id, usuario, detalle)
      VALUES (${correctivoId}, ${usuario ?? null}, ${detalle.slice(0, 1000)})
    `;
  } catch (err) {
    console.error("No se pudo registrar el historial", err);
  }
}
