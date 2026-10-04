"use client";

import { useRef, useState } from "react";
import { useMe } from "@/lib/useMe";
import { autoGuardarTicket } from "@/lib/carpetaLocal";
import { DOCUMENTOS, ESTADO_DOC_COLORS } from "@/lib/opciones";
import { MAX_BYTES } from "@/lib/archivos";
import { prepararArchivo } from "@/components/Adjuntos";
import type { DocumentoClave, DocumentoLinea, Documentos } from "@/lib/types";

const VACIA: DocumentoLinea = { numero: "", estado: "Pendiente", url: "" };
const ACEPTADOS = ".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx";

export default function DocumentosTicket({
  correctivoId,
  inicial,
  numeroOc,
}: {
  correctivoId: number;
  inicial: Documentos;
  numeroOc: string | null;
}) {
  const me = useMe();
  const esAdmin = me?.rol === "admin";
  const [docs, setDocs] = useState<Documentos>(inicial);
  const [subiendo, setSubiendo] = useState<DocumentoClave | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const claveElegida = useRef<DocumentoClave | null>(null);
  const baseArchivos = `/api/correctivos/${correctivoId}/archivos`;

  // El N° de OC del ticket se muestra en la línea de OC si no hay otro número.
  function linea(clave: DocumentoClave): DocumentoLinea {
    const d = { ...VACIA, ...(docs[clave] ?? {}) };
    if (clave === "oc" && !d.numero && numeroOc) d.numero = numeroOc;
    return d;
  }

  function elegirArchivo(clave: DocumentoClave) {
    if (subiendo) return;
    claveElegida.current = clave;
    inputRef.current?.click();
  }

  async function borrarArchivo(url: string) {
    // Solo se borran archivos subidos a este mismo ticket.
    if (url.startsWith(`${baseArchivos}/`)) {
      await fetch(url, { method: "DELETE" }).catch(() => {});
    }
  }

  async function alElegir(files: FileList | null) {
    const clave = claveElegida.current;
    const original = files?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!clave || !original) return;

    setError("");
    setSubiendo(clave);
    let urlNueva = "";
    try {
      const file = await prepararArchivo(original);
      if (file.size > MAX_BYTES) {
        throw new Error(`${original.name}: supera el máximo de 4 MB`);
      }

      // 1) Subir el archivo al ticket.
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetch(baseArchivos, { method: "POST", body: fd });
      const upData = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(upData.error || "No se pudo subir el archivo");
      urlNueva = `${baseArchivos}/${upData.data.id}`;

      // 2) Guardar la línea: número = nombre del archivo, estado = Listo, enlace.
      const anterior = docs[clave]?.url ?? "";
      const nuevos: Documentos = {
        ...docs,
        [clave]: {
          numero: original.name.replace(/\.[^.]+$/, ""),
          estado: "Listo",
          url: urlNueva,
        },
      };
      const res = await fetch(`/api/correctivos/${correctivoId}/documentos`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nuevos),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo guardar el documento");
      setDocs(data.data ?? nuevos);

      // 3) Si la línea ya tenía un archivo propio, se quita para no dejar basura.
      if (anterior && anterior !== urlNueva) await borrarArchivo(anterior);
      void autoGuardarTicket(correctivoId);
    } catch (e) {
      if (urlNueva) await borrarArchivo(urlNueva);
      setError(e instanceof Error ? e.message : "No se pudo subir el documento");
    } finally {
      setSubiendo(null);
    }
  }

  return (
    <section className="bg-white border-2 border-ink p-6 mt-6">
      <h3 className="font-mono-tag text-xs uppercase tracking-widest text-ink-soft border-b border-line pb-2 mb-4">
        Documentos
      </h3>

      <input
        ref={inputRef}
        type="file"
        accept={ACEPTADOS}
        className="hidden"
        onChange={(e) => alElegir(e.target.files)}
      />

      {error && (
        <p className="text-sm text-danger bg-[var(--danger-soft)] border border-danger/30 px-3 py-2 mb-3">
          {error}
        </p>
      )}

      <ul className="space-y-2.5">
        {DOCUMENTOS.map(({ clave, nombre }) => {
          const d = linea(clave);
          const ocupado = subiendo === clave;
          return (
            <li
              key={clave}
              tabIndex={esAdmin ? 0 : undefined}
              onClick={esAdmin ? () => elegirArchivo(clave) : undefined}
              onKeyDown={
                esAdmin
                  ? (e) => {
                      if (e.target === e.currentTarget && e.key === "Enter") elegirArchivo(clave);
                    }
                  : undefined
              }
              title={esAdmin ? "Clic para seleccionar el documento" : undefined}
              className={`flex items-center justify-between gap-3 rounded-lg bg-concrete-dim/60 px-4 py-3 ${
                esAdmin
                  ? "cursor-pointer hover:bg-concrete-dim focus:outline-none focus:bg-concrete-dim"
                  : ""
              } ${ocupado ? "opacity-60" : ""}`}
            >
              <div className="min-w-0">
                <p className="font-medium leading-tight">{nombre}</p>
                <p className="font-mono-tag text-xs text-ink-soft mt-0.5 truncate">
                  {ocupado ? "Subiendo…" : d.numero || "—"}
                </p>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <span
                  className={`rounded-full px-3 py-0.5 text-xs font-semibold uppercase tracking-wide ${
                    ESTADO_DOC_COLORS[d.estado] ?? ESTADO_DOC_COLORS.Pendiente
                  }`}
                >
                  {d.estado}
                </span>
                {d.url ? (
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-sm text-ink-soft hover:text-ink hover:underline"
                  >
                    Ver documento ↗
                  </a>
                ) : (
                  <span className="text-sm text-ink-soft/50">
                    {esAdmin ? "Seleccionar documento" : "Sin documento"}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {esAdmin && (
        <p className="text-xs text-ink-soft mt-3">
          PDF, imágenes, Word o Excel. Máximo 4 MB por archivo. Al elegir un archivo, su
          nombre pasa a ser el número, el estado cambia a Listo y se guarda el enlace.
        </p>
      )}
    </section>
  );
}
