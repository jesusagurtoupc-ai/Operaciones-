"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  type Catalogo,
  type CatalogoFuera,
  type Linea,
  LIMITES,
  buscarCatalogo,
  lineaDeCatalogo,
  nuevoUid,
  precioUnitario,
  simbolo,
} from "@/lib/materiales";
import { type FilaImportada, descargarPlantilla, filasALineas, leerArchivoExcel } from "@/lib/importarExcel";

const inputCls =
  "w-full border border-line rounded-md px-3 py-2 bg-white text-sm focus:outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-200/70";
const labelCls = "block text-xs font-medium text-ink-soft mb-1";
const botonPrimario =
  "bg-amber border border-amber text-white rounded-md px-5 py-2.5 text-sm font-medium hover:bg-amber-hover hover:border-amber-hover transition-colors disabled:opacity-50";
const botonSecundario =
  "border border-line-strong rounded-md px-4 py-2 text-sm font-medium hover:bg-concrete-dim transition-colors disabled:opacity-50";
const pestana = (activa: boolean) =>
  `px-4 py-2 text-sm font-medium border-b-2 -mb-px ${activa ? "border-amber text-ink" : "border-transparent text-ink-soft hover:text-ink"}`;

const ETIQUETA = { catalogo: "Catálogo", fuera: "Fuera de catálogo", error: "Error" } as const;

type Props = {
  catalogo: Catalogo | null;
  fuera: CatalogoFuera | null;
  /** Suma las líneas a la solicitud (el padre une repetidas y respeta el máximo). */
  onAgregar: (nuevas: Linea[]) => void;
  onCerrar: () => void;
};

export default function AgregarMateriales({ catalogo, fuera, onAgregar, onCerrar }: Props) {
  const [pestaña, setPestaña] = useState<"manual" | "excel">("manual");
  const [tipo, setTipo] = useState<"catalogo" | "fuera">("catalogo");
  const [consulta, setConsulta] = useState("");
  const consultaDif = useDeferredValue(consulta);
  const [cantidad, setCantidad] = useState("1");
  const [libre, setLibre] = useState({ descripcion: "", cantidad: "1", unidad: "", precio: "" });
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [filas, setFilas] = useState<FilaImportada[]>([]);
  const [archivo, setArchivo] = useState("");
  const [leyendo, setLeyendo] = useState(false);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [onCerrar]);

  const resultados = useMemo(
    () => (catalogo ? buscarCatalogo(catalogo, consultaDif, 20) : { items: [], total: 0 }),
    [catalogo, consultaDif]
  );
  const num = (t: string) => parseFloat(t.replace(",", "."));

  function agregarCatalogo(it: Parameters<typeof lineaDeCatalogo>[0]) {
    const n = num(cantidad);
    if (!Number.isFinite(n) || n <= 0) return setError("La cantidad debe ser mayor que cero.");
    setError("");
    onAgregar([lineaDeCatalogo(it, n)]);
    setOk(`Agregado: ${it.descripcion.slice(0, 60)}`);
  }

  function agregarLibre() {
    const descripcion = libre.descripcion.trim();
    const n = num(libre.cantidad);
    const p = libre.precio.trim() === "" ? null : num(libre.precio);
    if (!descripcion) return setError("Escribe la descripción del material.");
    if (!Number.isFinite(n) || n <= 0) return setError("La cantidad debe ser mayor que cero.");
    if (p !== null && (!Number.isFinite(p) || p < 0)) return setError("El precio no es válido.");
    setError("");
    onAgregar([
      {
        uid: nuevoUid(), codigo: null, descripcion: descripcion.slice(0, LIMITES.descripcion), cantidad: n,
        unidad: libre.unidad.trim().slice(0, LIMITES.unidad), precio: p, moneda: "PEN",
        vence: null, proveedor: null, minimo: null, entrega: null,
      },
    ]);
    setOk(`Agregado: ${descripcion.slice(0, 60)}`);
    setLibre({ descripcion: "", cantidad: "1", unidad: "", precio: "" });
  }

  async function elegirArchivo(f: File | undefined) {
    if (!f) return;
    setError("");
    setFilas([]);
    setArchivo(f.name);
    setLeyendo(true);
    try {
      const r = filasALineas(await leerArchivoExcel(f), catalogo, fuera);
      setFilas(r.filas);
      if (r.error) setError(r.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el archivo.");
    } finally {
      setLeyendo(false);
    }
  }

  const buenas = filas.filter((f) => f.linea);
  const conError = filas.length - buenas.length;
  function importar() {
    onAgregar(buenas.map((f) => f.linea!));
    setOk(`Se agregaron ${buenas.length} material(es) desde ${archivo}.`);
    setFilas([]);
    setArchivo("");
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" onClick={onCerrar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="t-agregar"
        className="bg-white rounded-lg shadow-card w-full max-w-3xl my-8 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 id="t-agregar" className="text-base font-medium">Agregar materiales</h2>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="text-2xl leading-none text-ink-soft hover:text-danger px-2">×</button>
        </div>

        <div className="flex border-b border-line mb-4" role="tablist">
          <button type="button" role="tab" aria-selected={pestaña === "manual"} className={pestana(pestaña === "manual")} onClick={() => { setPestaña("manual"); setError(""); }}>Manual</button>
          <button type="button" role="tab" aria-selected={pestaña === "excel"} className={pestana(pestaña === "excel")} onClick={() => { setPestaña("excel"); setError(""); }}>Desde Excel</button>
        </div>

        {pestaña === "manual" ? (
          <>
            <div className="flex gap-2 mb-4">
              <button type="button" aria-pressed={tipo === "catalogo"} className={`${botonSecundario} ${tipo === "catalogo" ? "!bg-concrete-dim" : ""}`} onClick={() => { setTipo("catalogo"); setError(""); }}>Del catálogo</button>
              <button type="button" aria-pressed={tipo === "fuera"} className={`${botonSecundario} ${tipo === "fuera" ? "!bg-concrete-dim" : ""}`} onClick={() => { setTipo("fuera"); setError(""); }}>Fuera de catálogo</button>
            </div>

            {tipo === "catalogo" ? (
              <>
                <div className="grid grid-cols-[1fr_90px] gap-3">
                  <div>
                    <label className={labelCls} htmlFor="a-buscar">Buscar por código o descripción</label>
                    <input id="a-buscar" className={inputCls} value={consulta} disabled={!catalogo} placeholder={catalogo ? "ej. arco de sierra, balde 20lts" : "Cargando catálogo…"} onChange={(e) => setConsulta(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="a-cant">Cantidad</label>
                    <input id="a-cant" inputMode="decimal" className={inputCls} value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
                  </div>
                </div>
                {consultaDif.trim() !== "" && resultados.total === 0 && (
                  <p className="text-xs text-ink-soft mt-2">Sin resultados. Prueba con menos palabras o usa «Fuera de catálogo».</p>
                )}
                {resultados.items.length > 0 && (
                  <ul className="mt-3 border border-line rounded-md divide-y divide-line max-h-72 overflow-y-auto">
                    {resultados.items.map((it) => (
                      <li key={it.articulo} className="flex items-start gap-3 px-3 py-2 text-sm">
                        <div className="flex-1 min-w-0">
                          <p className="break-words">{it.descripcion}</p>
                          <p className="text-[11px] text-ink-soft font-mono-tag">{it.articulo}</p>
                        </div>
                        <p className="font-mono-tag text-sm shrink-0">{simbolo(it.moneda)} {precioUnitario(it.precio)}</p>
                        <button type="button" className={`${botonSecundario} shrink-0 !px-3 !py-1.5`} onClick={() => agregarCatalogo(it)}>Agregar</button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <div className="grid md:grid-cols-12 gap-3">
                <div className="md:col-span-6">
                  <label className={labelCls} htmlFor="a-desc">Descripción</label>
                  <input id="a-desc" className={inputCls} maxLength={LIMITES.descripcion} value={libre.descripcion} onChange={(e) => setLibre({ ...libre, descripcion: e.target.value })} onKeyDown={(e) => e.key === "Enter" && agregarLibre()} />
                </div>
                <div className="md:col-span-2">
                  <label className={labelCls} htmlFor="a-lcant">Cantidad</label>
                  <input id="a-lcant" inputMode="decimal" className={inputCls} value={libre.cantidad} onChange={(e) => setLibre({ ...libre, cantidad: e.target.value })} onKeyDown={(e) => e.key === "Enter" && agregarLibre()} />
                </div>
                <div className="md:col-span-2">
                  <label className={labelCls} htmlFor="a-uni">Unidad (opc.)</label>
                  <input id="a-uni" className={inputCls} maxLength={LIMITES.unidad} placeholder="UND, m…" value={libre.unidad} onChange={(e) => setLibre({ ...libre, unidad: e.target.value })} onKeyDown={(e) => e.key === "Enter" && agregarLibre()} />
                </div>
                <div className="md:col-span-2">
                  <label className={labelCls} htmlFor="a-prec">Precio s/IGV (opc.)</label>
                  <input id="a-prec" inputMode="decimal" className={inputCls} value={libre.precio} onChange={(e) => setLibre({ ...libre, precio: e.target.value })} onKeyDown={(e) => e.key === "Enter" && agregarLibre()} />
                </div>
                <div className="md:col-span-12">
                  <button type="button" className={botonSecundario} onClick={agregarLibre}>Agregar a la solicitud</button>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-ink-soft mb-3">
              Sube un Excel (.xlsx, .xls) o .csv con las columnas <b>Código</b>, <b>Descripción</b>, <b>Cantidad</b>, <b>Unidad</b> y <b>Precio sin IGV</b> (solo Cantidad y Código o Descripción son obligatorias).
              Si el código está en el catálogo se usa su precio; si no, el material entra como fuera de catálogo.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <input type="file" accept=".xlsx,.xls,.csv" aria-label="Archivo de Excel" className="text-sm" onChange={(e) => { void elegirArchivo(e.target.files?.[0]); e.target.value = ""; }} />
              <button type="button" className="text-xs underline text-ink-soft" onClick={() => void descargarPlantilla()}>Descargar plantilla</button>
            </div>
            {leyendo && <p className="text-xs text-ink-soft mt-3">Leyendo el archivo…</p>}
            {filas.length > 0 && (
              <>
                <p className="text-sm mt-4">
                  {archivo}: {buenas.length} listo(s){conError > 0 && <span className="text-danger"> · {conError} con error (no se agregan)</span>}
                </p>
                <div className="mt-2 border border-line rounded-md max-h-72 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-concrete-dim text-ink-soft sticky top-0">
                      <tr><th className="text-left p-2">Fila</th><th className="text-left p-2">Material</th><th className="text-right p-2">Cant.</th><th className="text-left p-2">Tipo</th></tr>
                    </thead>
                    <tbody>
                      {filas.map((f) => (
                        <tr key={f.fila} className="border-t border-line align-top">
                          <td className="p-2 font-mono-tag">{f.fila}</td>
                          <td className="p-2 break-words">
                            {f.linea?.descripcion ?? "—"}
                            {f.mensaje && <p className={f.estado === "error" ? "text-danger" : "text-ink-soft"}>{f.mensaje}</p>}
                          </td>
                          <td className="p-2 text-right font-mono-tag">{f.linea?.cantidad ?? ""}</td>
                          <td className={`p-2 whitespace-nowrap ${f.estado === "error" ? "text-danger" : ""}`}>{ETIQUETA[f.estado]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button type="button" className={`${botonPrimario} mt-3`} disabled={buenas.length === 0} onClick={importar}>
                  Agregar {buenas.length} material(es)
                </button>
              </>
            )}
          </>
        )}

        {error && <p className="text-sm text-danger mt-3" role="alert">{error}</p>}
        {ok && !error && <p className="text-sm mt-3" role="status">{ok}</p>}
        <div className="mt-5 flex justify-end">
          <button type="button" className={botonSecundario} onClick={onCerrar}>Listo</button>
        </div>
      </div>
    </div>
  );
}
