import { ESTADOS, DOCUMENTOS } from "@/lib/shared";
import { numOrNull, toDateOnly } from "@/lib/shared";
import { NextResponse } from "next/server";
import { getCurrentUser, type UsuarioSesion } from "./auth";
import { sql } from "@/lib/server/db";

// ───────── errores.ts ─────────
// Detección de errores de unicidad de Postgres (código 23505) para poder
// responder 409 con un mensaje claro en vez de un 500 genérico.
export type CampoUnico = "refer" | "ticket" | "n_oc";

export const INDICE_REFER = "uq_correctivos_refer_activos";
export const INDICE_TICKET = "uq_correctivos_ticket_activos";
export const INDICE_OC = "uq_correctivos_n_oc_activos";

export function violacionUnica(err: unknown): CampoUnico | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: string; constraint?: string; message?: string };
  if (e.code !== "23505") return null;
  const donde = `${e.constraint ?? ""} ${e.message ?? ""}`;
  if (donde.includes(INDICE_REFER)) return "refer";
  if (donde.includes(INDICE_TICKET)) return "ticket";
  if (donde.includes(INDICE_OC)) return "n_oc";
  return null;
}

export const MSG_REFER_REPETIDO = "Ya existe un correctivo con ese N° Refer.";
export const MSG_TICKET_REPETIDO = "Ya existe un correctivo con ese ticket";
export const MSG_OC_REPETIDO = "Esa orden de compra (N° de OC) ya está registrada en otro correctivo";

/** Mensaje de 409 para cada campo único. */
export function mensajeDuplicado(campo: CampoUnico): string {
  if (campo === "refer") return MSG_REFER_REPETIDO;
  if (campo === "n_oc") return MSG_OC_REPETIDO;
  return MSG_TICKET_REPETIDO;
}

/** Forma comparable de un N° de OC: sin espacios en los extremos y sin distinguir mayúsculas. */
export function claveOc(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim().toLowerCase();
}

/**
 * Busca otro correctivo ACTIVO (no eliminado) con el mismo N° de OC. Una OC solo puede estar en
 * un correctivo. Devuelve un mensaje listo para mostrar, o null si la OC está libre.
 * `excluirId` es el correctivo que se está guardando (para no chocar consigo mismo).
 */
export async function ocEnUso(nOc: unknown, excluirId = 0): Promise<string | null> {
  const clave = claveOc(nOc);
  if (!clave) return null;
  const rows = await sql`
    SELECT id, refer, ticket
    FROM correctivos
    WHERE eliminado_en IS NULL
      AND LOWER(BTRIM(n_oc)) = ${clave}
      AND id <> ${excluirId}
    ORDER BY id
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const r = rows[0] as { id: number; refer: number | null; ticket: string | null };
  const donde = r.refer !== null ? `N° Refer. ${r.refer}` : `id ${r.id}`;
  const ticket = r.ticket && r.ticket.trim() ? ` (ticket ${r.ticket.trim()})` : "";
  return `La OC ${String(nOc).trim()} ya está registrada en el correctivo ${donde}${ticket}`;
}

// ───────── orden.ts ─────────
// Orden de la lista de correctivos y de la exportación a Excel.
//
// El número de "Ref" es lo que la gente ve en la columna, así que es lo que
// manda: se ordena como número (9, 99, 481, 1000...) y los que no tienen
// Ref van siempre al final. Para desempatar se usa el ticket en orden
// "natural" (los tickets son texto: "566", "566-B", "CC-2026-0012"; en
// orden alfabético "1000" quedaría antes que "481") y por último el id.
//
// Lista blanca: lo que llega por la URL solo elige una de estas opciones,
// nunca se concatena en la consulta.

const TICKET_BLANK = `(ticket IS NULL OR BTRIM(ticket) = '')`;
const TICKET_PREFIX = `LOWER(REGEXP_REPLACE(BTRIM(ticket), '\\d.*$', ''))`;
const TICKET_NUMBERS = `ARRAY(SELECT m[1]::numeric FROM REGEXP_MATCHES(ticket, '\\d+', 'g') AS m)`;

const ORDENES: Record<string, string> = {
  ref_desc: `refer DESC NULLS LAST, ${TICKET_BLANK}, ${TICKET_PREFIX} DESC, ${TICKET_NUMBERS} DESC, id DESC`,
  ref_asc: `refer ASC NULLS LAST, ${TICKET_BLANK}, ${TICKET_PREFIX}, ${TICKET_NUMBERS}, id ASC`,
  fecha: "f_reg DESC NULLS LAST, id DESC",
};

/** Orden por defecto: Ref de mayor a menor (el más nuevo arriba). */
export const ORDEN_POR_DEFECTO = "ref_desc";

export function buildOrderBy(orden: string | null): string {
  return ORDENES[orden || ""] || ORDENES[ORDEN_POR_DEFECTO];
}

// ───────── permisos.ts ─────────
// Verificación de sesión y rol DENTRO de cada ruta de la API.
//
// El proxy (src/proxy.ts) ya bloquea a quien no tiene sesión y a los usuarios
// de solo lectura, pero es una sola capa: si alguna vez falla o una ruta nueva
// queda fuera de su alcance, los datos quedarían expuestos. Cada ruta vuelve a
// comprobarlo por su cuenta (defensa en profundidad), con los mismos mensajes.
export type Acceso =
  | { user: UsuarioSesion; error?: undefined }
  | { user?: undefined; error: NextResponse };

/** Cualquier usuario con sesión válida (admin o lectura). */
export async function exigirSesion(): Promise<Acceso> {
  const user = await getCurrentUser();
  if (!user) {
    return { error: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
  }
  return { user };
}

/** Solo administradores: para crear, editar y eliminar. */
export async function exigirAdmin(): Promise<Acceso> {
  const acceso = await exigirSesion();
  if (acceso.error) return acceso;
  if (acceso.user.rol !== "admin") {
    return {
      error: NextResponse.json({ error: "Tu usuario es de solo lectura" }, { status: 403 }),
    };
  }
  return acceso;
}

// ───────── historial.ts ─────────
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
  ruc_proveedor: "RUC proveedor",
  f_entrega: "F. entrega",
  contrato: "Contrato",
};

function textoHist(v: unknown): string {
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
    const a = textoHist(antes[campo]);
    let n = nuevo[campo];
    if (campo === "monto") {
      const aNum = antes[campo] === null || antes[campo] === undefined ? null : Number(antes[campo]);
      const nNum = n === null || n === undefined || n === "" ? null : Number(n);
      if (aNum === nNum) continue;
    }
    n = textoHist(n);
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

// ───────── limiteLogin.ts ─────────
// Límite de intentos fallidos de login, guardado en la BASE DE DATOS.
//
// Antes vivía en la memoria de cada instancia del servidor. En Vercel hay
// varias instancias y se reinician solas, así que el contador no se compartía:
// quien probaba claves podía repartir los intentos entre instancias o esperar
// un reinicio. En la base de datos el contador es uno solo para todos.
//
// Hay dos límites: por usuario+IP (5 fallos: frena adivinar la clave de alguien
// y no deja que un tercero bloquee a esa persona desde otra IP) y por IP
// (30 fallos: frena probar muchos usuarios distintos desde un mismo lugar).
export const MAX_FALLOS_USUARIO = 5;
export const MAX_FALLOS_IP = 30;
// La ventana (15 minutos) va escrita en las consultas con el reloj de la base de
// datos, así todas las instancias cuentan igual.

export async function bloqueado(clave: string, max: number): Promise<boolean> {
  const rows = await sql`
    SELECT fallos FROM login_intentos
    WHERE clave = ${clave} AND desde > now() - interval '15 minutes'
  `;
  return rows.length > 0 && Number(rows[0].fallos) >= max;
}

export async function registrarFallo(clave: string): Promise<void> {
  // Una sola instrucción atómica: si hay dos fallos a la vez, ninguno se pierde.
  await sql`
    INSERT INTO login_intentos (clave, fallos, desde)
    VALUES (${clave}, 1, now())
    ON CONFLICT (clave) DO UPDATE SET
      fallos = CASE WHEN login_intentos.desde < now() - interval '15 minutes'
                    THEN 1 ELSE login_intentos.fallos + 1 END,
      desde  = CASE WHEN login_intentos.desde < now() - interval '15 minutes'
                    THEN now() ELSE login_intentos.desde END
  `;
  // Limpieza ocasional de contadores viejos para que la tabla no crezca sin fin.
  if (Math.random() < 0.02) {
    await sql`DELETE FROM login_intentos WHERE desde < now() - interval '1 hour'`;
  }
}

export async function limpiarFallos(clave: string): Promise<void> {
  await sql`DELETE FROM login_intentos WHERE clave = ${clave}`;
}

// ───────── validar.ts ─────────
// Validación de los datos de un correctivo en el SERVIDOR.
//
// El formulario ya valida algunas cosas, pero cualquiera puede llamar a la API
// directamente (o fallar el navegador), así que las reglas viven aquí. Antes
// el servidor guardaba montos negativos, estados inventados, fechas absurdas
// y textos de cualquier tamaño (una descripción de 50 000 caracteres rompía
// la exportación a Excel de todos, por el límite de 32 767 por celda), y una
// fecha imposible o un JSON mal formado terminaban en error 500.
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
  ruc_proveedor: string | null;
  f_entrega: string | null;
  contrato: string | null;
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
        ruc_proveedor: txt("ruc_proveedor", "El RUC del proveedor", LIMITE_TEXTO),
        f_entrega: fch("f_entrega", "La fecha de entrega"),
        contrato: txt("contrato", "El contrato", LIMITE_TEXTO),
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

// ───────── filtros.ts ─────────
/**
 * Filtros compartidos por el listado (/api/correctivos) y la exportación
 * (/api/export), para que una tabla y su Excel siempre coincidan.
 *
 * Cada "dimensión" admite selección múltiple: el frontend manda el mismo
 * parámetro repetido (?estado=A&estado=B) y aquí se convierte en
 * `estado IN ($1, $2)`. Dentro de una misma dimensión las opciones se
 * combinan con O; entre dimensiones distintas, con Y.
 */

// Lista fija (no viene del usuario): por eso es seguro escribir el nombre
// de la columna directamente dentro del SQL.
export const DIMENSIONES = [
  "estado",
  "tipo_trab",
  "sub_tipo_trab",
  "lugar",
  "area",
] as const;

export type Dimension = (typeof DIMENSIONES)[number];

/**
 * Arma el WHERE a partir de los parámetros de la URL.
 * `excluir` deja fuera una dimensión: se usa para calcular los conteos
 * de esa dimensión ("¿cuántos habría si eligiera esta opción?").
 */
export const DOC_CLAVES: Record<string, string> = Object.fromEntries(
  DOCUMENTOS.map((d) => [d.nombre, d.clave])
);

/** Condición SQL: el documento aún no está listo (sin línea o en Pendiente). */
export function docPendienteSql(clave: string) {
  return `COALESCE(documentos->'${clave}'->>'estado', 'Pendiente') = 'Pendiente'`;
}

export function buildWhere(
  searchParams: URLSearchParams,
  excluir?: Dimension | "sin",
  opciones: { papelera?: boolean } = {}
) {
  // Siempre se filtra por la papelera: por defecto solo los correctivos activos (así el listado, los
  // conteos y el Excel nunca mezclan eliminados). Ver la papelera lo decide la RUTA (solo admin),
  // no un parámetro de la URL, para que la exportación no pueda pedirla.
  const clauses: string[] = [opciones.papelera ? "eliminado_en IS NOT NULL" : "eliminado_en IS NULL"];
  const values: unknown[] = [];

  for (const dim of DIMENSIONES) {
    if (dim === excluir) continue;
    const elegidos = searchParams.getAll(dim).filter((v) => v !== "");
    if (elegidos.length === 0) continue;
    const marcadores = elegidos.map((v) => {
      values.push(v);
      return `$${values.length}`;
    });
    clauses.push(`${dim} IN (${marcadores.join(", ")})`);
  }

  // Documento pendiente: tickets a los que aún les falta alguno de los elegidos.
  if (excluir !== "sin") {
    const claves = searchParams
      .getAll("sin")
      .map((v) => DOC_CLAVES[v])
      .filter(Boolean);
    if (claves.length > 0) {
      clauses.push(`(${claves.map(docPendienteSql).join(" OR ")})`);
    }
  }

  const q = searchParams.get("q");
  const desde = searchParams.get("desde");
  const hasta = searchParams.get("hasta");

  if (q) {
    values.push(`%${q.replace(/[\\%_]/g, "\\$&")}%`);
    const i = values.length;
    clauses.push(
      `(descripcion ILIKE $${i} OR proveedor ILIKE $${i} OR ticket ILIKE $${i} OR CAST(refer AS TEXT) ILIKE $${i} OR n_oc ILIKE $${i})`
    );
  }
  if (desde) {
    values.push(desde);
    clauses.push(`f_reg >= $${values.length}`);
  }
  if (hasta) {
    values.push(hasta);
    clauses.push(`f_reg <= $${values.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { where, values };
}

export type FacetaFila = { valor: string; cantidad: number; monto: number };
export type FacetasCalculadas = {
  resumen: { total: number; monto: number };
  facetas: Record<string, FacetaFila[]>;
};

/**
 * Una sola consulta que reemplaza a las 9 de antes (resumen, conteo de documentos pendientes y los
 * conteos de cada dimensión): lee la tabla una vez, marca por fila qué filtro cumple, y cada
 * conteo aplica "todos los filtros menos el suyo" sobre esas marcas. Resultado idéntico, pero
 * una sola vuelta a la base de datos.
 */
export function buildFacetasQuery(
  searchParams: URLSearchParams,
  opciones: { papelera?: boolean } = {}
) {
  const values: unknown[] = [];
  const base: string[] = [opciones.papelera ? "eliminado_en IS NOT NULL" : "eliminado_en IS NULL"];

  const marca: Record<string, string> = {};
  for (const dim of DIMENSIONES) {
    const elegidos = searchParams.getAll(dim).filter((v) => v !== "");
    if (elegidos.length === 0) {
      marca[dim] = "TRUE";
      continue;
    }
    const marcadores = elegidos.map((v) => {
      values.push(v);
      return `$${values.length}`;
    });
    marca[dim] = `COALESCE(${dim} IN (${marcadores.join(", ")}), FALSE)`;
  }

  const clavesSin = searchParams
    .getAll("sin")
    .map((v) => DOC_CLAVES[v])
    .filter(Boolean);
  const marcaSin = clavesSin.length > 0 ? `(${clavesSin.map(docPendienteSql).join(" OR ")})` : "TRUE";

  const q = searchParams.get("q");
  const desde = searchParams.get("desde");
  const hasta = searchParams.get("hasta");
  if (q) {
    values.push(`%${q.replace(/[\\%_]/g, "\\$&")}%`);
    const i = values.length;
    base.push(
      `(descripcion ILIKE $${i} OR proveedor ILIKE $${i} OR ticket ILIKE $${i} OR CAST(refer AS TEXT) ILIKE $${i} OR n_oc ILIKE $${i})`
    );
  }
  if (desde) {
    values.push(desde);
    base.push(`f_reg >= $${values.length}`);
  }
  if (hasta) {
    values.push(hasta);
    base.push(`f_reg <= $${values.length}`);
  }

  const columnasMarca = [
    ...DIMENSIONES.map((d) => `${marca[d]} AS m_${d}`),
    `${marcaSin} AS m_sin`,
  ].join(",\n      ");

  // Marcas de todas las dimensiones menos `excepto` (y menos "sin" si no se pide).
  const marcasDims = (excepto?: string) =>
    DIMENSIONES.filter((d) => d !== excepto).map((d) => `m_${d}`);

  const ramas: string[] = [];
  for (const dim of DIMENSIONES) {
    const cond = [...marcasDims(dim), "m_sin", `${dim} IS NOT NULL`].join(" AND ");
    ramas.push(
      `SELECT '${dim}'::text AS dim, ${dim}::text AS valor, COUNT(*)::int AS cantidad, COALESCE(SUM(monto), 0)::float AS monto
       FROM base WHERE ${cond} GROUP BY ${dim}`
    );
  }
  ramas.push(
    `SELECT 'resumen'::text, NULL::text, COUNT(*)::int, COALESCE(SUM(monto), 0)::float
     FROM base WHERE ${[...marcasDims(), "m_sin"].join(" AND ")}`
  );
  for (const [nombre, clave] of Object.entries(DOC_CLAVES)) {
    ramas.push(
      `SELECT 'sin'::text, '${nombre.replace(/'/g, "''")}'::text, COUNT(*)::int, 0::float
       FROM base WHERE ${[...marcasDims(), docPendienteSql(clave)].join(" AND ")}`
    );
  }

  const text = `
    WITH base AS (
      SELECT ${[...DIMENSIONES, "monto", "documentos"].join(", ")},
      ${columnasMarca}
      FROM correctivos WHERE ${base.join(" AND ")}
    )
    ${ramas.join("\n    UNION ALL\n    ")}
  `;
  return { text, values };
}

/** Convierte las filas de buildFacetasQuery en el formato que ya usaba la API. */
export function armarFacetas(rows: Record<string, unknown>[]): FacetasCalculadas {
  const facetas: Record<string, FacetaFila[]> = {};
  for (const dim of DIMENSIONES) facetas[dim] = [];
  facetas.sin = [];
  let resumen = { total: 0, monto: 0 };
  for (const r of rows) {
    const fila = { valor: r.valor as string, cantidad: Number(r.cantidad), monto: Number(r.monto) };
    if (r.dim === "resumen") resumen = { total: fila.cantidad, monto: fila.monto };
    else if (r.dim === "sin") facetas.sin.push(fila);
    else facetas[r.dim as string]?.push(fila);
  }
  // Mismo orden que DOC_CLAVES (el de la UNION no está garantizado).
  const orden = Object.keys(DOC_CLAVES);
  facetas.sin.sort((a, b) => orden.indexOf(a.valor) - orden.indexOf(b.valor));
  return { resumen, facetas };
}
