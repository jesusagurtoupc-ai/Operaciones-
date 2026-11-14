import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, sql } from "@/lib/server/db";
import { exigirAdmin, exigirSesion } from "@/lib/server/utils";
import { abrirDeBlob, borrarDeBlob, guardarEnBlob } from "@/lib/server/almacen";

export const dynamic = "force-dynamic";

/**
 * Fotos de los materiales fuera del catálogo.
 *  GET ?clave=a&clave=b   → { data: { [clave]: [{ id, nombre }] } }  (las fotos de esos materiales)
 *  GET ?id=N              → la imagen (para miniaturas y el visor)
 *  POST (form: clave, file) → sube una foto (solo administradores)
 *  DELETE ?id=N           → la borra (solo administradores)
 * La foto se guarda en Vercel Blob si está conectado; si no, en la base (como los adjuntos).
 */

const MAX_BYTES = 4 * 1024 * 1024; // el navegador ya la reduce antes de subirla
const MAX_POR_MATERIAL = 8;
const MAX_CLAVES = 300;

/** Tipo real de la imagen por sus primeros bytes (no por el nombre): solo JPG, PNG o WEBP. */
function tipoImagen(b: Buffer): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function claveValida(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s.startsWith("libre:") && s.length > 6 && s.length <= 400 ? s : null;
}

export async function GET(req: NextRequest) {
  const acceso = await exigirSesion();
  if (acceso.error) return acceso.error;
  try {
    await ensureSchema();
    const sp = req.nextUrl.searchParams;
    const id = Number(sp.get("id"));
    if (sp.has("id")) {
      if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Foto inválida" }, { status: 400 });
      const filas = (await sql`
        SELECT nombre, tipo, blob_path, CASE WHEN blob_path IS NULL THEN encode(data, 'base64') END AS b64
        FROM materiales_fotos WHERE id = ${id}
      `) as { nombre: string; tipo: string; blob_path: string | null; b64: string | null }[];
      const f = filas[0];
      if (!f) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
      const cuerpo = f.blob_path ? await abrirDeBlob(f.blob_path) : f.b64 ? Buffer.from(f.b64, "base64") : null;
      if (!cuerpo) return NextResponse.json({ error: "No se pudo leer la foto" }, { status: 502 });
      return new NextResponse(cuerpo as BodyInit, {
        headers: {
          "Content-Type": ["image/jpeg", "image/png", "image/webp"].includes(f.tipo) ? f.tipo : "application/octet-stream",
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.nombre)}`,
          "X-Content-Type-Options": "nosniff",
          // Cada foto tiene su propio id y nunca cambia: el navegador la guarda y no la vuelve a pedir.
          "Cache-Control": "private, max-age=604800, immutable",
        },
      });
    }
    const validas: string[] = [];
    for (const c of sp.getAll("clave")) {
      const v = claveValida(c);
      if (v && !validas.includes(v)) validas.push(v);
    }
    const claves = validas.slice(0, MAX_CLAVES);
    if (claves.length === 0) return NextResponse.json({ data: {} });
    const filas = (await sql`
      SELECT id, clave, nombre FROM materiales_fotos WHERE clave = ANY(${claves}::text[]) ORDER BY clave, id
    `) as { id: number; clave: string; nombre: string }[];
    const data: Record<string, { id: number; nombre: string }[]> = {};
    for (const f of filas) (data[f.clave] ??= []).push({ id: f.id, nombre: f.nombre });
    return NextResponse.json({ data });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudieron leer las fotos" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const acceso = await exigirAdmin();
  if (acceso.error) return acceso.error;
  try {
    const form = await req.formData().catch(() => null);
    const clave = claveValida(form?.get("clave"));
    const archivo = form?.get("file");
    if (!clave || !(archivo instanceof File)) {
      return NextResponse.json({ error: "Falta el material o la foto" }, { status: 400 });
    }
    if (archivo.size === 0 || archivo.size > MAX_BYTES) {
      return NextResponse.json({ error: "La foto pesa más de 4 MB" }, { status: 413 });
    }
    const buf = Buffer.from(await archivo.arrayBuffer());
    const tipo = tipoImagen(buf);
    if (!tipo) return NextResponse.json({ error: "Solo se aceptan fotos JPG, PNG o WEBP" }, { status: 415 });
    await ensureSchema();
    const nombre = (archivo.name || "foto.jpg").replace(/[\\/\r\n"]/g, "_").slice(0, 120);
    const enBlob = await guardarEnBlob(nombre, tipo, buf);
    // Solo si el material aún tiene lugar (el conteo y la inserción van en la misma consulta).
    const filas = (await sql`
      INSERT INTO materiales_fotos (clave, nombre, tipo, tamano, data, blob_path, blob_url, subido_por)
      SELECT ${clave}::text, ${nombre}::text, ${tipo}::text, ${buf.length}::int,
             CASE WHEN ${!!enBlob}::boolean THEN NULL ELSE decode(${enBlob ? "" : buf.toString("base64")}::text, 'base64') END,
             ${enBlob?.path ?? null}::text, ${enBlob?.url ?? null}::text, ${acceso.user.username}::text
      WHERE (SELECT COUNT(*) FROM materiales_fotos WHERE clave = ${clave}::text) < ${MAX_POR_MATERIAL}::int
      RETURNING id, nombre
    `) as { id: number; nombre: string }[];
    if (filas.length === 0) {
      if (enBlob) await borrarDeBlob([enBlob.url]);
      return NextResponse.json({ error: `Este material ya tiene ${MAX_POR_MATERIAL} fotos` }, { status: 409 });
    }
    return NextResponse.json({ data: filas[0] });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo guardar la foto" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const acceso = await exigirAdmin();
  if (acceso.error) return acceso.error;
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Foto inválida" }, { status: 400 });
  try {
    await ensureSchema();
    const filas = (await sql`DELETE FROM materiales_fotos WHERE id = ${id} RETURNING blob_url`) as { blob_url: string | null }[];
    if (filas.length === 0) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
    await borrarDeBlob([filas[0].blob_url]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "No se pudo borrar la foto" }, { status: 500 });
  }
}
