import { sql } from "./db";
import { claveProveedor } from "@/lib/shared";

/**
 * Registro único de proveedores.
 *
 * Cada empresa tiene UN nombre oficial (el que se ve en la lista, el filtro, el panel y el Excel). Al
 * crear o actualizar un ticket (desde una OC, una cotización, la carga masiva o a mano), el nombre que
 * trae el documento se compara con el registro y se cambia por el oficial:
 *  1. por RUC (lo más seguro: el RUC identifica a la empresa);
 *  2. si no hay RUC, por la clave del nombre (sin tildes, puntos ni "S.A.C.": ver claveProveedor).
 * Si no coincide con ninguno, se agrega como proveedor nuevo. Las formas en que llegó escrito se
 * guardan como "variantes", y el administrador puede renombrar o unir proveedores en /proveedores.
 */

export type Proveedor = {
  id: number;
  nombre: string;
  ruc: string | null;
  claves: string[];
  alias: string[];
  /** RUC de proveedores que se unieron a este (siguen reconociéndose como la misma empresa). */
  otros_ruc: string[];
};

const MAX_ALIAS = 30;

/** RUC peruano válido (11 dígitos) o null. */
export function rucValido(v: unknown): string | null {
  const s = String(v ?? "").replace(/\D/g, "");
  return s.length === 11 ? s : null;
}

function limpiarNombre(v: string | null | undefined): string {
  return (v ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * De los candidatos, cuál es "el mismo proveedor": primero el del mismo RUC; si no, uno con la misma
 * clave cuyo RUC no contradiga (si hay dos empresas distintas con la misma clave, no se adivina).
 */
function elegir(cands: Proveedor[], clave: string, ruc: string | null): Proveedor | null {
  if (ruc) {
    const porRuc = cands.find((p) => p.ruc === ruc || (p.otros_ruc ?? []).includes(ruc));
    if (porRuc) return porRuc;
  }
  const porClave = cands.filter((p) => clave && p.claves.includes(clave) && (!ruc || !p.ruc || p.ruc === ruc));
  if (porClave.length === 1) return porClave[0];
  if (porClave.length > 1) {
    // Con RUC: el que aún no tiene RUC (se le asigna). Sin RUC: solo si todos son la misma empresa.
    if (ruc) return porClave.find((p) => !p.ruc) ?? null;
    const rucs = new Set(porClave.map((p) => p.ruc).filter(Boolean));
    return rucs.size <= 1 ? porClave.find((p) => p.ruc) ?? porClave[0] : null;
  }
  return null;
}

/**
 * Nombre oficial (y RUC) del proveedor que trae un documento o un formulario. Si no está registrado,
 * lo registra. Nunca lanza: ante cualquier error devuelve lo que recibió (el ticket se guarda igual).
 */
export async function resolverProveedor(
  nombreRaw: string | null | undefined,
  rucRaw: string | null | undefined
): Promise<{ nombre: string | null; ruc: string | null }> {
  const nombre = limpiarNombre(nombreRaw);
  const ruc = rucValido(rucRaw);
  const original = { nombre: nombre || null, ruc: String(rucRaw ?? "").trim() || null };
  const clave = claveProveedor(nombre);
  if (!clave && !ruc) return original;
  try {
    const cands = (await sql`
      SELECT id, nombre, ruc, claves, alias, otros_ruc FROM proveedores
      WHERE (${ruc}::text IS NOT NULL AND (ruc = ${ruc}::text OR ${ruc}::text = ANY(otros_ruc)))
         OR (${clave}::text <> '' AND ${clave}::text = ANY(claves))
    `) as Proveedor[];
    const p = elegir(cands, clave, ruc);
    if (p) {
      // Aprende: la nueva forma de escribirlo, su clave y el RUC si aún no lo tenía.
      const nuevaClave = clave && !p.claves.includes(clave);
      const nuevoAlias = nombre && nombre !== p.nombre && !p.alias.includes(nombre) && p.alias.length < MAX_ALIAS;
      const nuevoRuc = ruc && !p.ruc;
      if (nuevaClave || nuevoAlias || nuevoRuc) {
        await sql`
          UPDATE proveedores SET
            claves = CASE WHEN ${!!nuevaClave}::boolean THEN array_append(claves, ${clave}::text) ELSE claves END,
            alias  = CASE WHEN ${!!nuevoAlias}::boolean THEN array_append(alias, ${nombre}::text) ELSE alias END,
            ruc    = CASE WHEN ${!!nuevoRuc}::boolean
                               AND NOT EXISTS (SELECT 1 FROM proveedores WHERE ruc = ${ruc}::text OR ${ruc}::text = ANY(otros_ruc))
                          THEN ${ruc}::text ELSE ruc END
          WHERE id = ${p.id}
        `;
      }
      // El RUC del documento manda (si se unieron empresas con distinto RUC, cada ticket conserva el suyo).
      return { nombre: p.nombre, ruc: ruc ?? p.ruc ?? original.ruc };
    }
    if (!nombre) return original; // solo RUC y no registrado: no se inventa un nombre
    // Nuevo. Si justo otra subida lo registró con el mismo RUC, se usa ese.
    const ins = (await sql`
      INSERT INTO proveedores (nombre, ruc, claves, alias)
      VALUES (${nombre}, ${ruc}, ${clave ? [clave] : []}::text[], '{}'::text[])
      ON CONFLICT (ruc) DO NOTHING
      RETURNING nombre, ruc
    `) as { nombre: string; ruc: string | null }[];
    if (ins.length > 0) return { nombre: ins[0].nombre, ruc: ins[0].ruc ?? original.ruc };
    const ya = (await sql`SELECT nombre, ruc FROM proveedores WHERE ruc = ${ruc}`) as { nombre: string; ruc: string }[];
    return ya[0] ? { nombre: ya[0].nombre, ruc: ya[0].ruc } : original;
  } catch (err) {
    console.error("[proveedores] no se pudo resolver el proveedor", err);
    return original;
  }
}

/**
 * Ordena lo que ya existe: registra los proveedores de los tickets y deja un solo nombre por empresa.
 * Corre en segundo plano (tarea de cada 5 minutos) y solo trabaja si hay tickets cuyo proveedor no es
 * todavía un nombre oficial. La forma más usada de escribir cada empresa queda como nombre oficial.
 */
export async function unificarProveedores(): Promise<number> {
  const pendientes = (await sql`
    SELECT proveedor, NULLIF(BTRIM(ruc_proveedor), '') AS ruc, COUNT(*)::int AS n
    FROM correctivos c
    WHERE COALESCE(BTRIM(proveedor), '') <> ''
      AND NOT EXISTS (SELECT 1 FROM proveedores p WHERE p.nombre = c.proveedor)
    GROUP BY proveedor, NULLIF(BTRIM(ruc_proveedor), '')
    ORDER BY n DESC
    LIMIT 300
  `) as { proveedor: string; ruc: string | null; n: number }[];
  let cambiados = 0;
  for (const r of pendientes) {
    const oficial = await resolverProveedor(r.proveedor, r.ruc);
    if (oficial.nombre && oficial.nombre !== r.proveedor) {
      const filas = await sql`
        UPDATE correctivos SET proveedor = ${oficial.nombre}
        WHERE proveedor = ${r.proveedor}
          AND NULLIF(BTRIM(ruc_proveedor), '') IS NOT DISTINCT FROM ${r.ruc}::text
        RETURNING id
      `;
      cambiados += filas.length;
    }
  }
  if (cambiados > 0) console.log(`[proveedores] ${cambiados} ticket(s) pasaron al nombre oficial de su proveedor`);
  return cambiados;
}

/** Lista para la página de administración: con cuántos tickets y qué monto tiene cada uno. */
export async function listarProveedores() {
  return (await sql`
    SELECT p.id, p.nombre, p.ruc, p.alias,
           COUNT(c.id)::int AS tickets,
           COALESCE(SUM(c.monto), 0)::float AS monto
    FROM proveedores p
    LEFT JOIN correctivos c ON c.proveedor = p.nombre AND c.eliminado_en IS NULL
    GROUP BY p.id
    ORDER BY COUNT(c.id) DESC, p.nombre
  `) as { id: number; nombre: string; ruc: string | null; alias: string[]; tickets: number; monto: number }[];
}

/** Cambia el nombre oficial: también en todos sus tickets. Error si ya existe otro con ese nombre. */
export async function renombrarProveedor(id: number, nuevoRaw: string, ruc: string | null | undefined) {
  const nuevo = limpiarNombre(nuevoRaw);
  if (!nuevo) return { error: "Escribe el nombre" };
  const rucNuevo = ruc === undefined ? undefined : rucValido(ruc);
  if (ruc !== undefined && ruc !== null && ruc !== "" && !rucNuevo) return { error: "El RUC debe tener 11 dígitos" };
  const choque = await sql`SELECT id FROM proveedores WHERE nombre = ${nuevo} AND id <> ${id}`;
  if (choque.length > 0) return { error: "Ya hay otro proveedor con ese nombre: usa «Unir» para juntarlos" };
  if (rucNuevo) {
    const r = await sql`SELECT nombre FROM proveedores WHERE (ruc = ${rucNuevo} OR ${rucNuevo} = ANY(otros_ruc)) AND id <> ${id}`;
    if (r.length > 0) return { error: `Ese RUC ya es de ${(r[0] as { nombre: string }).nombre}: usa «Unir»` };
  }
  const clave = claveProveedor(nuevo);
  const filas = (await sql`
    WITH antes AS (SELECT id, nombre FROM proveedores WHERE id = ${id}),
    cambio AS (
      UPDATE proveedores p SET
        nombre = ${nuevo},
        ruc = CASE WHEN ${rucNuevo === undefined}::boolean THEN p.ruc ELSE ${rucNuevo ?? null}::text END,
        claves = CASE WHEN ${clave}::text = '' OR ${clave}::text = ANY(p.claves) THEN p.claves ELSE array_append(p.claves, ${clave}::text) END,
        alias = CASE WHEN a.nombre <> ${nuevo} AND NOT (a.nombre = ANY(p.alias)) THEN array_append(p.alias, a.nombre) ELSE p.alias END
      FROM antes a WHERE p.id = a.id
      RETURNING p.id
    ),
    tickets AS (
      UPDATE correctivos c SET proveedor = ${nuevo}
      FROM antes a WHERE c.proveedor = a.nombre AND EXISTS (SELECT 1 FROM cambio)
      RETURNING c.id
    )
    SELECT (SELECT COUNT(*) FROM cambio)::int AS ok, (SELECT COUNT(*) FROM tickets)::int AS tickets
  `) as { ok: number; tickets: number }[];
  if (!filas[0]?.ok) return { error: "No encontrado" };
  return { tickets: filas[0].tickets };
}

/**
 * Une varios proveedores en uno (el principal): sus tickets pasan al nombre del principal y sus
 * variantes, claves y RUC (si el principal no tenía) se suman a él. Los demás desaparecen del registro.
 */
export async function unirProveedores(principal: number, otros: number[]) {
  const ids = Array.from(new Set(otros.filter((x) => Number.isInteger(x) && x > 0 && x !== principal))).slice(0, 50);
  if (ids.length === 0) return { error: "Elige al menos otro proveedor para unir" };
  const filas = (await sql`
    WITH p AS (SELECT id, nombre FROM proveedores WHERE id = ${principal}),
    o AS (DELETE FROM proveedores WHERE id = ANY(${ids}::int[]) AND EXISTS (SELECT 1 FROM p)
          RETURNING id, nombre, ruc, claves, alias, otros_ruc),
    suma AS (
      UPDATE proveedores pr SET
        -- Los RUC de los unidos se siguen reconociendo como esta empresa.
        otros_ruc = ARRAY(SELECT DISTINCT x FROM unnest(pr.otros_ruc
                      || (SELECT COALESCE(array_agg(ruc), '{}') FROM o WHERE ruc IS NOT NULL)
                      || (SELECT COALESCE(array_agg(r), '{}') FROM o, unnest(o.otros_ruc) r)) x
                      WHERE x IS DISTINCT FROM pr.ruc),
        claves = ARRAY(SELECT DISTINCT x FROM unnest(pr.claves || (SELECT COALESCE(array_agg(c), '{}') FROM o, unnest(o.claves) c)) x),
        alias = (ARRAY(SELECT DISTINCT x FROM unnest(pr.alias || (SELECT array_agg(nombre) FROM o)
                       || (SELECT COALESCE(array_agg(a), '{}') FROM o, unnest(o.alias) a)) x
                       WHERE x <> pr.nombre))[1:${MAX_ALIAS}]
      WHERE pr.id = ${principal}
      RETURNING pr.id
    ),
    tickets AS (
      UPDATE correctivos c SET proveedor = (SELECT nombre FROM p)
      WHERE c.proveedor IN (SELECT nombre FROM o)
      RETURNING c.id
    )
    SELECT (SELECT COUNT(*) FROM o)::int AS unidos, (SELECT COUNT(*) FROM tickets)::int AS tickets,
           (SELECT nombre FROM p) AS nombre
  `) as { unidos: number; tickets: number; nombre: string | null }[];
  if (!filas[0]?.nombre) return { error: "No se encontró el proveedor principal" };
  // Si el principal no tenía RUC, toma el primero de los unidos: en un paso aparte, porque el RUC es
  // único y dentro de la misma consulta el registro borrado todavía lo "ocupa".
  await sql`
    UPDATE proveedores SET ruc = otros_ruc[1], otros_ruc = otros_ruc[2:]
    WHERE id = ${principal} AND ruc IS NULL AND cardinality(otros_ruc) > 0
  `;
  return { unidos: filas[0].unidos, tickets: filas[0].tickets, nombre: filas[0].nombre };
}
