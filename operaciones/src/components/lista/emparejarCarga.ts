// Reglas para la carga masiva (botón "+ OC"): a qué ticket va cada cotización u OC. Sin React, para
// poder probarlas por separado.
import type { Correctivo, DatosCotizacion, DatosOC } from "@/lib/shared";

/** Estados en los que un ticket todavía espera su OC (los mismos que usa el cambio automático de estado). */
export const ESPERAN_OC = ["cotizar", "enviado", "Ingresado a PS", ""];

/** Diferencia máxima (en soles) para considerar que la OC y la cotización son por el mismo monto. */
export const TOLERANCIA_MONTO = 1;

const vacio = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

/** "MSG PERU S.A.C." y "Msg Perú SAC" → "msgperusac". */
export function normProveedor(v: string | null | undefined): string {
  return (v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** ¿Mismo proveedor? Por RUC si los dos lo tienen; si no, por el nombre normalizado. */
export function mismoProveedor(
  a: { ruc: string | null | undefined; nombre: string | null | undefined },
  b: { ruc: string | null | undefined; nombre: string | null | undefined }
): boolean {
  const ra = (a.ruc ?? "").trim();
  const rb = (b.ruc ?? "").trim();
  if (ra && rb) return ra === rb;
  const na = normProveedor(a.nombre);
  const nb = normProveedor(b.nombre);
  return na.length >= 3 && na === nb;
}

export function mismoMonto(a: number | string | null | undefined, b: number | null | undefined): boolean {
  if (a === null || a === undefined || a === "" || b === null || b === undefined) return false;
  const x = Number(a);
  return Number.isFinite(x) && Math.abs(x - b) <= TOLERANCIA_MONTO;
}

/** Clave de una cotización para detectar repetidas: proveedor + N°. Sin N° no hay clave. */
export function claveCotizacion(d: Pick<DatosCotizacion, "numero" | "ruc_proveedor" | "proveedor">): string | null {
  const n = (d.numero ?? "").trim().toLowerCase();
  if (!n) return null;
  const quien = (d.ruc_proveedor ?? "").trim() || normProveedor(d.proveedor);
  return quien ? `${quien}|${n}` : null;
}

/** Ticket activo que ya tiene esta misma cotización (mismo N° y proveedor), o null. */
export function cotizacionRegistrada(d: DatosCotizacion, tickets: Correctivo[]): Correctivo | null {
  const n = (d.numero ?? "").trim().toLowerCase();
  if (!n) return null;
  return (
    tickets.find(
      (c) =>
        (c.documentos?.cotizacion?.numero ?? "").trim().toLowerCase() === n &&
        mismoProveedor({ ruc: d.ruc_proveedor, nombre: d.proveedor }, { ruc: c.ruc_proveedor, nombre: c.proveedor })
    ) ?? null
  );
}

/**
 * Tickets a los que podría ir una OC que todavía no está registrada: los que aún no tienen OC, siguen
 * esperándola y son del mismo proveedor. `conMonto` = además, por el mismo monto (la coincidencia
 * fuerte); `soloProveedor` = del mismo proveedor pero con otro monto o sin monto (para elegir a mano).
 */
export function candidatosParaOc(d: DatosOC, tickets: Correctivo[]) {
  const enSoles = !d.moneda || d.moneda === "PEN";
  const sinOc = tickets.filter(
    (c) =>
      vacio(c.n_oc) &&
      ESPERAN_OC.includes(c.estado ?? "") &&
      mismoProveedor({ ruc: d.ruc_proveedor, nombre: d.proveedor }, { ruc: c.ruc_proveedor, nombre: c.proveedor })
  );
  const conMonto = enSoles ? sinOc.filter((c) => mismoMonto(c.monto, d.total)) : [];
  const soloProveedor = sinOc.filter((c) => !conMonto.includes(c));
  return { conMonto, soloProveedor };
}
