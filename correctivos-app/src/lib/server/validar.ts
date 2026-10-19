// Validación de los datos de un correctivo en el SERVIDOR.
//
// El formulario ya valida algunas cosas, pero cualquiera puede llamar a la API
// directamente (o fallar el navegador), así que las reglas viven aquí. Antes
// el servidor guardaba montos negativos, estados inventados, fechas absurdas
// y textos de cualquier tamaño (una descripción de 50 000 caracteres rompía
// la exportación a Excel de todos, por el límite de 32 767 por celda), y una
// fecha imposible o un JSON mal formado terminaban en error 500.
import { ESTADOS } from "@/lib/shared/opciones";
import { numOrNull } from "@/lib/shared/num";
import { toDateOnly } from "@/lib/shared/types";

export const LIMITE_DESCRIPCION = 2000;
export const LIMITE_TEXTO = 200;
export const LIMITE_TICKET = 50;
const MONTO_MAX = 9_999_999_999.99; // NUMERIC(12,2)
const REFER_MAX = 2_147_483_647; // INTEGER de Postgres

export type DatosCorrectivo = {
  refer: number | null;
  ticket: string | null;
  f_reg: string | null;
  descripcion: string;
  lugar: string | null;
  estado: string;
  proveedor: string | null;
  monto: number | null;
  f_coti: string | null;
  f_oc: string | null;
  f_inicio: string | null;
  f_fin: string | null;
  cuenta: string | null;
  tipo_trab: string | null;
  sub_tipo_trab: string | null;
  n_oc: string | null;
  area: string | null;
};

export type Validacion =
  | { ok: true; datos: DatosCorrectivo }
  | { ok: false; error: string };

class ErrorValidacion extends Error {}

/** Lee el cuerpo JSON; devuelve null si está mal formado o no es un objeto. */
export async function leerJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Fecha de hoy (YYYY-MM-DD) en hora de Lima. */
export function hoyLima(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
}

function texto(v: unknown, etiqueta: string, max: number): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" && typeof v !== "number") {
    throw new ErrorValidacion(`${etiqueta} no es válido`);
  }
  const s = String(v).trim();
  if (s === "") return null;
  if (s.length > max) {
    throw new ErrorValidacion(`${etiqueta} supera el máximo de ${max} caracteres`);
  }
  return s;
}

function fecha(v: unknown, etiqueta: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && Number.isNaN(v.getTime())) {
    throw new ErrorValidacion(`${etiqueta} no es una fecha válida`);
  }
  const s = toDateOnly(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new ErrorValidacion(`${etiqueta} no es una fecha válida`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  const real =
    dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  if (!real || y < 2000 || y > 2100) {
    throw new ErrorValidacion(`${etiqueta} no es una fecha válida`);
  }
  return s;
}

// Tope absoluto de texto, por debajo del límite de celda de Excel (32 767 caracteres).
const TOPE_ABSOLUTO = 30000;

/** ¿El valor que llega es el mismo que ya está guardado? (para no bloquear datos históricos) */
function igualAlPrevio(nombre: string, crudo: unknown, prev: unknown): boolean {
  if (prev === null || prev === undefined) {
    return crudo === null || crudo === undefined || crudo === "";
  }
  try {
    if (nombre === "monto" || nombre === "refer") return Number(crudo) === Number(prev);
    if (nombre.startsWith("f_")) return toDateOnly(crudo) === toDateOnly(prev);
    return String(crudo ?? "").trim() === String(prev).trim();
  } catch {
    return false;
  }
}

/**
 * Valida y normaliza los datos de un correctivo.
 *
 * `previo` (solo al EDITAR) es la fila guardada. Las reglas se aplican a lo que el usuario
 * CAMBIA: si un valor llega igual al que ya estaba (aunque hoy incumpla una regla, p. ej. una
 * descripción larga, un monto negativo o un estado antiguo), se respeta. Sin esto, editar
 * cualquier otro campo de un registro histórico quedaría bloqueado.
 */
export function validarCorrectivo(
  body: Record<string, unknown>,
  previo?: Record<string, unknown>
): Validacion {
  // Aplica `validar`; si falla pero el valor no cambió respecto a lo guardado, usa `tolerado`.
  function campo<T>(nombre: string, crudo: unknown, validar: () => T, tolerado: () => T): T {
    try {
      return validar();
    } catch (e) {
      if (e instanceof ErrorValidacion && previo && igualAlPrevio(nombre, crudo, previo[nombre])) {
        return tolerado();
      }
      throw e;
    }
  }
  const textoViejo = (v: unknown, etiqueta: string): string | null => {
    const t = texto(v, etiqueta, TOPE_ABSOLUTO);
    return t;
  };
  const txt = (nombre: string, etiqueta: string, max: number): string | null =>
    campo(nombre, body[nombre], () => texto(body[nombre], etiqueta, max), () => textoViejo(body[nombre], etiqueta));
  const fch = (nombre: string, etiqueta: string): string | null =>
    campo(nombre, body[nombre], () => fecha(body[nombre], etiqueta), () => {
      const v = body[nombre];
      return v === null || v === undefined || v === "" ? null : toDateOnly(v);
    });

  try {
    const descripcion = campo(
      "descripcion",
      body.descripcion,
      () => texto(body.descripcion, "La descripción", LIMITE_DESCRIPCION),
      () => textoViejo(body.descripcion, "La descripción")
    );
    if (!descripcion) throw new ErrorValidacion("La descripción es obligatoria");

    const referNum = numOrNull(body.refer);
    const montoNum = numOrNull(body.monto);
    if (referNum === undefined || montoNum === undefined) {
      throw new ErrorValidacion("N° Refer. y Monto deben ser números válidos");
    }
    const refer = campo(
      "refer",
      body.refer,
      () => {
        if (referNum !== null && (!Number.isInteger(referNum) || referNum < 1 || referNum > REFER_MAX)) {
          throw new ErrorValidacion("N° Refer. debe ser un número entero positivo");
        }
        return referNum;
      },
      () => referNum
    );
    const monto = campo(
      "monto",
      body.monto,
      () => {
        if (montoNum !== null && montoNum < 0) throw new ErrorValidacion("El monto no puede ser negativo");
        if (montoNum !== null && montoNum > MONTO_MAX) throw new ErrorValidacion("El monto es demasiado grande");
        return montoNum;
      },
      () => montoNum
    );

    const estadoCrudo =
      body.estado === null || body.estado === undefined || body.estado === ""
        ? "cotizar"
        : String(body.estado).trim();
    const estado = campo(
      "estado",
      body.estado,
      () => {
        if (!(ESTADOS as readonly string[]).includes(estadoCrudo)) {
          throw new ErrorValidacion(`Estado no válido. Opciones: ${ESTADOS.join(", ")}`);
        }
        return estadoCrudo;
      },
      () => estadoCrudo
    );

    return {
      ok: true,
      datos: {
        refer,
        ticket: txt("ticket", "El ticket", LIMITE_TICKET),
        f_reg: fch("f_reg", "La fecha de registro"),
        descripcion,
        lugar: txt("lugar", "El lugar", LIMITE_TEXTO),
        estado,
        proveedor: txt("proveedor", "El proveedor", LIMITE_TEXTO),
        monto,
        f_coti: fch("f_coti", "La fecha de cotización"),
        f_oc: fch("f_oc", "La fecha de OC"),
        f_inicio: fch("f_inicio", "La fecha de inicio"),
        f_fin: fch("f_fin", "La fecha de fin"),
        cuenta: txt("cuenta", "La cuenta", LIMITE_TEXTO),
        tipo_trab: txt("tipo_trab", "El tipo de trabajo", LIMITE_TEXTO),
        sub_tipo_trab: txt("sub_tipo_trab", "El subtipo", LIMITE_TEXTO),
        n_oc: txt("n_oc", "El N° de OC", LIMITE_TEXTO),
        area: txt("area", "El área", LIMITE_TEXTO),
      },
    };
  } catch (e) {
    if (e instanceof ErrorValidacion) return { ok: false, error: e.message };
    throw e;
  }
}

type Fechas = { f_reg?: string | null; f_inicio?: string | null; f_fin?: string | null };

/** Fechas que no tienen sentido juntas (fin antes de inicio o de registro, etc.). */
export function incoherenciasFechas(f: Fechas): string[] {
  const out: string[] = [];
  if (f.f_fin && f.f_reg && f.f_fin < f.f_reg) {
    out.push("La fecha de fin no puede ser anterior a la de registro");
  }
  if (f.f_fin && f.f_inicio && f.f_fin < f.f_inicio) {
    out.push("La fecha de fin no puede ser anterior a la de inicio");
  }
  if (f.f_inicio && f.f_reg && f.f_inicio < f.f_reg) {
    out.push("La fecha de inicio no puede ser anterior a la de registro");
  }
  return out;
}

export const MSG_FINALIZADO_SIN_FIN = "Un correctivo Finalizado debe tener fecha de fin";
export const MSG_JSON_INVALIDO = "Solicitud inválida: el cuerpo debe ser un JSON válido";
