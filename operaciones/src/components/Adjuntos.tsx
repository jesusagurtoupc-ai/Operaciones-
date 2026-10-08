"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMe } from "@/lib/useMe";
import { autoGuardarTicket } from "@/lib/carpetaLocal";
import { MAX_BYTES, extensionDe, type Archivo } from "@/lib/archivos";

const ACEPTADOS = ".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx";

function formatoTamano(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Las fotos de celular pesan varios MB y el servidor admite máximo 4 MB
 * por archivo. Aquí se reducen (lado mayor 1920 px, JPEG) antes de
 * subirlas; PDFs, Word y Excel se suben tal cual.
 */
async function prepararArchivo(file: File): Promise<File> {
  const ext = extensionDe(file.name);
  const esImagenComprimible = ["jpg", "jpeg", "png", "webp"].includes(ext);
  if (!esImagenComprimible || file.size < 700 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const escala = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/jpeg", 0.82)
    );
    if (!blob || blob.size >= file.size) return file;
    const base = file.name.replace(/\.[^.]+$/, "");
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export default function Adjuntos({ correctivoId }: { correctivoId: number }) {
  const me = useMe();
  const esAdmin = me?.rol === "admin";
  const [archivos, setArchivos] = useState<Archivo[] | null>(null);
  const [error, setError] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const base = `/api/correctivos/${correctivoId}/archivos`;

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(base);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setArchivos(data.data);
    } catch {
      setError("No se pudo cargar la lista de archivos");
      setArchivos([]);
    }
  }, [base]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar();
  }, [cargar]);

  async function subir(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError("");
    setSubiendo(true);
    const fallos: string[] = [];
    for (const original of Array.from(files)) {
      const file = await prepararArchivo(original);
      if (file.size > MAX_BYTES) {
        fallos.push(`${original.name}: supera el máximo de 4 MB`);
        continue;
      }
      const fd = new FormData();
      fd.append("file", file);
      try {
        const res = await fetch(base, { method: "POST", body: fd });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          fallos.push(`${original.name}: ${d.error || "no se pudo subir"}`);
        }
      } catch {
        fallos.push(`${original.name}: error de conexión`);
      }
    }
    if (fallos.length) setError(fallos.join(" · "));
    if (inputRef.current) inputRef.current.value = "";
    setSubiendo(false);
    await cargar();
    void autoGuardarTicket(correctivoId);
  }

  async function eliminar(a: Archivo) {
    if (!confirm(`¿Eliminar el archivo "${a.nombre}"?`)) return;
    setError("");
    const res = await fetch(`${base}/${a.id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "No se pudo eliminar el archivo");
      return;
    }
    await cargar();
    void autoGuardarTicket(correctivoId);
  }

  return (
    <section className="bg-white border border-line rounded-lg shadow-card p-6 mt-6">
      <div className="flex items-center justify-between gap-3 flex-wrap border-b border-line pb-2 mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
          Archivos adjuntos {archivos ? `(${archivos.length})` : ""}
        </h3>
        {esAdmin && (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACEPTADOS}
              className="hidden"
              onChange={(e) => subir(e.target.files)}
            />
            <button
              type="button"
              disabled={subiendo}
              onClick={() => inputRef.current?.click()}
              className="border border-line-strong rounded-md px-4 py-1.5 text-xs font-medium hover:bg-concrete-dim transition-colors disabled:opacity-50"
            >
              {subiendo ? "Subiendo..." : "+ Agregar archivos"}
            </button>
          </>
        )}
      </div>

      {error && (
        <p className="text-sm text-danger bg-[var(--danger-soft)] border border-danger/30 px-3 py-2 mb-3">
          {error}
        </p>
      )}

      {archivos === null ? (
        <p className="text-sm text-ink-soft">Cargando…</p>
      ) : archivos.length === 0 ? (
        <p className="text-sm text-ink-soft">Este ticket no tiene archivos adjuntos.</p>
      ) : (
        <ul className="divide-y divide-line border border-line rounded-md overflow-hidden">
          {archivos.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <a
                href={`${base}/${a.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-teal hover:underline truncate"
                title="Abrir archivo"
              >
                {a.nombre}
              </a>
              <span className="flex items-center gap-4 shrink-0">
                <span className="font-mono-tag text-xs text-ink-soft">
                  {formatoTamano(a.tamano)}
                </span>
                {esAdmin && (
                  <button
                    type="button"
                    onClick={() => eliminar(a)}
                    className="text-xs font-medium text-danger hover:underline"
                  >
                    Quitar
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {esAdmin && (
        <p className="text-xs text-ink-soft mt-3">
          PDF, imágenes, Word o Excel. Máximo 4 MB por archivo (las fotos se reducen solas
          al subirlas) y 20 archivos por ticket.
        </p>
      )}
    </section>
  );
}
