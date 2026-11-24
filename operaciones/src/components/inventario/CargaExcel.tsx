"use client";

/**
 * Carga de equipos al inventario desde Excel (administradores). Se usa en la página Inventario y en el Panel
 * (botón «Cargar Excel»). También tiene los tipos del inventario y las funciones que comparten.
 */

import { useMemo, useState } from "react";
import { descargarExcelInventario } from "@/lib/importarExcel";
import { CAMPUS_PRINCIPAL } from "@/lib/shared";

export type Equipo = {
  codigo: string;
  sistema: string;
  tipo?: string;
  subtipo?: string;
  nombre: string;
  pabellon?: string;
  piso?: string;
  ubicacion: string;
  marca?: string;
  modelo?: string;
  serie?: string;
  capacidad?: string;
  anio?: number | null;
  base_anio?: string;
  confianza?: string;
  vida_util?: number | null;
  meses_uso?: number | null;
  meses_excedidos?: number | null;
  informe?: string;
  estado: string;
  observaciones?: string;
  alerta: string;
  fuentes: string[];
  cod_contable?: string;
  cod_barra?: string;
  estado_contable?: string;
  precio?: number | null;
  fecha_ingreso?: string | null;
  oc?: string;
  editado_por?: string;
  editado_en?: string;
  /** Fecha del último mantenimiento registrado en la app (YYYY-MM-DD). */
  ultimo_mant?: string;
};

export type Datos = {
  generado: string;
  corte: string;
  fuentes: string[];
  leidos: Record<string, number>;
  contable_total: number;
  contable_baja: number;
  contable_enlazados: number;
  repetidos: { codigo: string; se_conserva: string | null; motivo: string }[];
  equipos: Equipo[];
  motivo?: string;
};

export const ESTADOS: Record<string, string> = {
  OPERATIVO: "Operativo",
  "OPERATIVO CON OBSERVACION": "Con observación",
  INOPERATIVO: "Inoperativo",
  "": "Sin informe",
};
export const ESTADO_CODIGO: Record<string, string> = Object.fromEntries(Object.entries(ESTADOS).map(([k, v]) => [v, k]));
export const serieMala = (s?: string) => !s || /^(ilegible|-+|n\/?a|s\/?n|0)$/i.test(s.trim());
/** Informe del Excel de depreciados: corresponde al mantenimiento de noviembre de 2025. */
export const FECHA_INFORME_EXCEL = "2025-11-15";
export const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const compacto = (s: string) => sinTildes(s).toUpperCase().replace(/[^A-Z0-9]/g, "");

const BOTON =
  "border border-line-strong rounded-md px-4 py-2 text-sm font-medium bg-white hover:bg-concrete-dim disabled:opacity-50";
const TARJETA = "bg-white border border-line rounded-lg";

/**
 * Inventario actual del campus, igual que lo muestra la página Inventario: el guardado en la app; si nunca se
 * guardó, el archivo consolidado (solo el campus principal) o un inventario vacío.
 */
export async function cargarInventarioActual(campus: string | undefined): Promise<Datos> {
  const r = await fetch("/api/inventario", { cache: "no-cache" });
  if (r.ok) return r.json();
  if (r.status !== 404) throw new Error("No se pudo cargar el inventario.");
  if (campus && campus !== CAMPUS_PRINCIPAL) {
    return { generado: new Date().toISOString(), corte: new Date().toISOString().slice(0, 10), fuentes: [], leidos: {},
      contable_total: 0, contable_baja: 0, contable_enlazados: 0, repetidos: [], equipos: [] };
  }
  const a = await fetch("/inventario-equipos.json");
  if (!a.ok) throw new Error("No se pudo cargar el inventario.");
  return a.json();
}

/* ───────── Cargar inventario desde Excel ───────── */

/**
 * Nombres de columna que se reconocen (sin importar tildes, mayúsculas ni signos). El primero de cada lista
 * es el de «Descargar Excel» y la plantilla; los demás, los de otros Excel (inventarios de proveedores,
 * del área contable…).
 */
const COLUMNAS: Record<string, string[]> = {
  codigo: ["Código", "Cód. Equipo", "Codigo de equipo", "COD_ACTIVO", "Cod activo", "Cod"],
  sistema: ["Sistema"],
  tipo: ["Tipo", "Tipo equipo", "Tipo de equipo (Excel)"],
  subtipo: ["Subtipo", "Sub tipo"],
  nombre: ["Equipo", "Nombre equipo", "Nombre de equipo", "Nombre", "Descripción"],
  pabellon: ["Pabellón", "Edificio / Pabellón", "Edificio"],
  piso: ["Piso", "Nivel"],
  ubicacion: ["Ubicación", "Ambiente", "Area", "Lugar"],
  marca: ["Marca"],
  modelo: ["Modelo"],
  serie: ["N° Serie", "Serie", "Nro serie", "Numero de serie"],
  capacidad: ["Capacidad"],
  anio: ["Año", "Año de fabricación", "Año (fabricación o ingreso)"],
  vida_util: ["Vida útil (meses)"],
  meses_uso: ["Meses de uso", "Meses de uso al corte"],
  meses_excedidos: ["Meses excedidos"],
  estado: ["Estado", "Estado en mantenimiento"],
  alerta: ["Alerta", "Alerta del informe"],
  informe: ["Informe de mantenimiento"],
  observaciones: ["Observaciones", "Observaciones del mantenimiento"],
  precio: ["Precio S/ (contable)", "Precio", "Precio S/."],
  fecha_ingreso: ["Fecha de ingreso", "Fecha Ing."],
  ultimo_mant: ["Último mantenimiento"],
  fuentes: ["Fuentes"],
};
const normCab = (s: string) => sinTildes(String(s)).toUpperCase().replace(/[^A-Z0-9]/g, "");
/** Columnas de la plantilla (las mismas de «Descargar Excel», sin las calculadas). */
const PLANTILLA = ["Código", "Sistema", "Tipo", "Subtipo", "Equipo", "Pabellón", "Piso", "Ubicación", "Marca", "Modelo",
  "N° Serie", "Capacidad", "Año", "Vida útil (meses)", "Estado", "Alerta", "Informe de mantenimiento", "Observaciones"];

/** Nombres de sistema y de marca escritos de otra forma → los unificados del inventario. */
const SISTEMAS_ALIAS: Record<string, string> = {
  AAAGUAHELADA: "Agua helada", AGUAHELADA: "Agua helada", EDEEXPANSIONDIRECTA: "Expansión directa", EXPANSIONDIRECTA: "Expansión directa",
  VENTILACIONMECANICA: "Ventilación mecánica", EXTRACTORDEMONOXIDOYJETFAN: "Monóxido y jetfan", MONOXIDOYJETFAN: "Monóxido y jetfan",
  CORTINASDEAIRE: "Cortinas de aire", EQUIPODEPRESURIZACION: "Presurización", PRESURIZACION: "Presurización",
};
const MARCAS_ALIAS: Record<string, string> = { SP: "SOLER & PALAU", SOLE: "SOLER & PALAU", SOLERPALAU: "SOLER & PALAU", FIRSTCO: "FIRST CO.", MCQUAY: "MC QUAY" };
const normSistema = (v: string) => SISTEMAS_ALIAS[normCab(v)] ?? v.trim();
function normMarca(v: string): string {
  const t = v.trim().replace(/[ .]+$/, "").toUpperCase();
  if (!t || /^(ILEGIBLE|-+|N\/?A|S\/?N)$/.test(t)) return "";
  return MARCAS_ALIAS[normCab(t)] ?? t;
}
const sinValor = (v: string) => (/^(ILEGIBLE|-+|N\/?A|S\/?N|0)$/i.test(v.trim()) ? "" : v.trim());

function normPabellon(v: string): string {
  const m = /^(?:PAB(?:ELLON)?\.?\s*)?([A-Z])$/i.exec(sinTildes(v).trim());
  return m ? `Pabellón ${m[1].toUpperCase()}` : v.trim();
}
function normPiso(v: string): string {
  const t = sinTildes(v).toUpperCase().replace(/\s+/g, " ").trim();
  let m = /^(?:PISO\s*)?(\d{1,2})$/.exec(t);
  if (m) return `Piso ${Number(m[1])}`;
  m = /^(?:SOTANO|S)\s*-?\s*(\d)$/.exec(t);
  if (m) return `Sótano ${Number(m[1])}`;
  if (t.startsWith("AZOTEA")) return "Azotea";
  return v.trim();
}

type Lectura = { equipos: Equipo[]; repetidos: number; archivo: string; columnas: string[] };

/**
 * Cargar inventario desde Excel (administradores), en dos modos:
 *  - Agregar: suma los equipos nuevos y actualiza los que ya están (mismo código; o, sin código, misma
 *    serie+marca+modelo o mismo equipo y ubicación). Lo que no viene en el Excel queda igual, y una celda
 *    vacía no borra un dato que ya existía.
 *  - Reemplazar: el Excel pasa a ser el inventario completo.
 * Se reconocen columnas con otros nombres (ver COLUMNAS) y pabellón/piso escritos de otra forma.
 */
export function SubirExcel({ actual, alGuardar }: { actual: Datos; alGuardar: (d: Datos) => void }) {
  const [lectura, setLectura] = useState<Lectura | null>(null);
  const [msg, setMsg] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function leer(file: File) {
    setMsg("");
    setLectura(null);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const hoja = wb.Sheets[wb.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, defval: "" });
      const alias = Object.fromEntries(Object.entries(COLUMNAS).map(([k, v]) => [k, v.map(normCab)]));
      // Fila de encabezado: la primera que tiene una columna de código o de equipo, y una de ubicación.
      const buscar = (r: unknown[], k: string) => r.findIndex((c) => alias[k].includes(normCab(String(c))));
      const iCab = filas.findIndex((r) => (buscar(r, "codigo") >= 0 || buscar(r, "nombre") >= 0) && buscar(r, "ubicacion") >= 0);
      if (iCab < 0) throw new Error("No se encontró el encabezado: hace falta una columna de código o de equipo y una de ubicación. Descarga la plantilla.");
      const idx: Record<string, number> = Object.fromEntries(Object.keys(COLUMNAS).map((k) => [k, buscar(filas[iCab], k)]));
      const txt = (r: unknown[], k: string) => {
        const v = idx[k] >= 0 ? r[idx[k]] : "";
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        return String(v ?? "").replace(/\s+/g, " ").trim();
      };
      const largo = (r: unknown[], k: string) => (idx[k] >= 0 ? String(r[idx[k]] ?? "").trim() : "");
      const num = (r: unknown[], k: string) => {
        const v = txt(r, k).replace(",", ".");
        return v && !Number.isNaN(Number(v)) ? Number(v) : null;
      };
      const fechaDe = (r: unknown[], k: string) => (/^\d{4}-\d{2}-\d{2}/.test(txt(r, k)) ? txt(r, k).slice(0, 10) : null);
      const equipos: Equipo[] = [];
      const vistos = new Set<string>();
      let repetidos = 0;
      for (const r of filas.slice(iCab + 1)) {
        let codigo = txt(r, "codigo");
        if (/^\d{1,8}$/.test(codigo)) codigo = codigo.padStart(8, "0"); // 7674 → 00007674 (Excel quita los ceros)
        const nombre = txt(r, "nombre");
        const ubicacion = txt(r, "ubicacion");
        if (!codigo && !nombre && !ubicacion) continue;
        const serie = txt(r, "serie");
        const llaveSerie = serieMala(serie) ? "" : `${compacto(serie)}|${txt(r, "marca").toUpperCase()}|${txt(r, "modelo").toUpperCase()}`;
        // Repetido dentro del Excel: el mismo código, o una fila SIN código igual a otra.
        const llave = codigo ? `c:${codigo}` : `u:${compacto(nombre + ubicacion + serie)}`;
        if (vistos.has(llave) || (!codigo && llaveSerie && vistos.has(`s:${llaveSerie}`))) {
          repetidos++;
          continue;
        }
        vistos.add(llave);
        if (llaveSerie) vistos.add(`s:${llaveSerie}`);
        const estadoTxt = txt(r, "estado");
        const um = fechaDe(r, "ultimo_mant");
        equipos.push({
          codigo, nombre, ubicacion, serie: sinValor(serie),
          sistema: normSistema(txt(r, "sistema")), tipo: txt(r, "tipo"), subtipo: txt(r, "subtipo"),
          pabellon: normPabellon(txt(r, "pabellon")), piso: normPiso(txt(r, "piso")), marca: normMarca(txt(r, "marca")), modelo: sinValor(txt(r, "modelo")),
          capacidad: txt(r, "capacidad"), anio: num(r, "anio"), vida_util: num(r, "vida_util"),
          meses_uso: num(r, "meses_uso"), meses_excedidos: num(r, "meses_excedidos"),
          estado: ESTADO_CODIGO[estadoTxt] ?? (estadoTxt ? sinTildes(estadoTxt).toUpperCase() : ""),
          alerta: txt(r, "alerta"), informe: txt(r, "informe"),
          observaciones: largo(r, "observaciones").replace(/ · /g, "\n"), precio: num(r, "precio"),
          fecha_ingreso: fechaDe(r, "fecha_ingreso"),
          ...(um && um !== FECHA_INFORME_EXCEL ? { ultimo_mant: um } : {}),
          fuentes: txt(r, "fuentes") ? txt(r, "fuentes").split(/,\s*/) : [file.name],
        });
      }
      if (equipos.length === 0) throw new Error("El Excel no tiene equipos.");
      const columnas = Object.keys(COLUMNAS).filter((k) => idx[k] >= 0).map((k) => COLUMNAS[k][0]);
      setLectura({ equipos, repetidos, archivo: file.name, columnas });
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "No se pudo leer el Excel.");
    }
  }

  // Cómo quedaría al AGREGAR: nuevos, actualizados y sin cambios.
  const mezcla = useMemo(() => {
    if (!lectura) return null;
    const lista = actual.equipos.map((e) => ({ ...e }));
    const porCodigo = new Map(lista.filter((e) => e.codigo).map((e) => [e.codigo, e]));
    const llaveS = (e: Equipo) => (serieMala(e.serie) ? "" : `${compacto(e.serie ?? "")}|${(e.marca ?? "").toUpperCase()}|${(e.modelo ?? "").toUpperCase()}`);
    const llaveU = (e: Equipo) => compacto(e.nombre + e.ubicacion + (e.serie ?? ""));
    let nuevos = 0, actualizados = 0, iguales = 0;
    const camposCambiados = new Map<string, number>();
    for (const n of lectura.equipos) {
      const existente = n.codigo
        ? porCodigo.get(n.codigo)
        : lista.find((e) => (llaveS(n) && llaveS(e) === llaveS(n)) || llaveU(e) === llaveU(n));
      if (!existente) {
        lista.push({ ...n, sistema: n.sistema || "Sin dato" });
        if (n.codigo) porCodigo.set(n.codigo, lista[lista.length - 1]);
        nuevos++;
        continue;
      }
      // Solo lo que el Excel trae con valor: una celda vacía no borra lo que ya había.
      let cambio = false;
      for (const [k, v] of Object.entries(n) as [keyof Equipo, unknown][]) {
        if (k === "fuentes" || v === null || v === undefined || v === "") continue;
        if (String(existente[k] ?? "") !== String(v)) {
          (existente as Record<string, unknown>)[k] = v;
          cambio = true;
          camposCambiados.set(k, (camposCambiados.get(k) ?? 0) + 1);
        }
      }
      if (cambio) {
        existente.fuentes = [...new Set([...existente.fuentes, ...n.fuentes])];
        actualizados++;
      } else iguales++;
    }
    return { lista, nuevos, actualizados, iguales, camposCambiados };
  }, [lectura, actual]);

  async function guardar(modo: "agregar" | "reemplazar") {
    if (!lectura || !mezcla) return;
    setGuardando(true);
    const hoy = new Date().toISOString().slice(0, 10);
    const datos: Datos =
      modo === "agregar"
        ? { ...actual, equipos: mezcla.lista, motivo: `Agregado desde ${lectura.archivo}: ${mezcla.nuevos} nuevo(s), ${mezcla.actualizados} actualizado(s)` }
        : { generado: hoy, corte: hoy, fuentes: [lectura.archivo], leidos: { [lectura.archivo]: lectura.equipos.length + lectura.repetidos },
            contable_total: 0, contable_baja: 0, contable_enlazados: 0, repetidos: [],
            equipos: lectura.equipos.map((e) => ({ ...e, sistema: e.sistema || "Sin dato" })), motivo: `Reemplazado por ${lectura.archivo}` };
    const r = await fetch("/api/inventario", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos) });
    setGuardando(false);
    if (!r.ok) {
      setMsg((await r.json().catch(() => ({}))).error || "No se pudo guardar.");
      return;
    }
    alGuardar(datos);
    setLectura(null);
    setMsg(modo === "agregar" ? `✓ Agregados ${mezcla.nuevos} y actualizados ${mezcla.actualizados} equipo(s)` : "✓ Inventario reemplazado");
  }

  function plantilla() {
    descargarExcelInventario(
      PLANTILLA.map((t) => ({ titulo: t, ancho: t === "Observaciones" ? 50 : t === "Ubicación" || t === "Equipo" ? 28 : 16 })),
      [["00099001", "Bombas", "Sumergible", "Desagüe", "ELECTROBOMBA SUMERGIBLE 1", "Pabellón B", "Sótano 3", "POZO SÉPTICO",
        "PEDROLLO", "VXm 10/35", "SN-12345", "1 HP", 2019, 120, "Operativo", "", "", "Fila de ejemplo: bórrala y escribe tus equipos"]],
      { titulo: "PLANTILLA – CARGA DE EQUIPOS AL INVENTARIO", detalle: "Código, Equipo y Ubicación son los datos clave. Estado: Operativo, Con observación, Inoperativo o vacío." },
      "plantilla-inventario"
    );
  }

  return (
    <section className={`${TARJETA} px-4 py-3`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-sm">Cargar equipos desde Excel</h2>
          <p className="text-xs text-ink-soft mt-0.5 max-w-2xl">
            Sirve la plantilla, el Excel de «Descargar Excel» u otro inventario: se reconocen columnas como Código / Cód. Equipo,
            Equipo / Nombre equipo, Ubicación / Ambiente, Pabellón, Piso, Marca, Modelo, Serie, Sistema, Tipo, Estado y Observaciones.
            Otros sistemas (bombas, tableros, UPS…) van con su nombre en «Sistema».
          </p>
        </div>
        <button type="button" onClick={plantilla} className={BOTON}>Descargar plantilla</button>
      </div>
      <label className={`${BOTON} mt-2 inline-flex items-center gap-2 cursor-pointer`}>
        📄 Elegir Excel…
        <input type="file" accept=".xlsx,.xls" className="sr-only" onChange={(x) => { const fl = x.target.files?.[0]; x.target.value = ""; if (fl) void leer(fl); }} />
      </label>
      {lectura && mezcla && (
        <div className="mt-3 text-sm border border-line rounded-lg p-3 bg-slate-50">
          <p>
            <b>{lectura.archivo}</b>: {lectura.equipos.length} equipo(s){lectura.repetidos ? `, ${lectura.repetidos} repetido(s) dentro del Excel omitido(s)` : ""}.
          </p>
          <p className="text-xs text-ink-soft mt-0.5">Columnas reconocidas: {lectura.columnas.join(", ")}.</p>
          <div className="mt-3 grid sm:grid-cols-2 gap-3">
            <div className="bg-white border border-line rounded-md p-3">
              <p className="font-medium">Agregar al inventario</p>
              <p className="text-xs text-ink-soft">
                {mezcla.nuevos} nuevo(s) · {mezcla.actualizados} actualizado(s) · {mezcla.iguales} sin cambios. Los demás equipos quedan
                igual; una celda vacía no borra un dato existente. Quedarían {mezcla.lista.length} equipos.
              </p>
              {mezcla.camposCambiados.size > 0 && (
                <p className="text-xs mt-1">
                  Cambiaría: {[...mezcla.camposCambiados].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${COLUMNAS[k]?.[0] ?? k} (${n})`).join(", ")}.
                </p>
              )}
              <button type="button" onClick={() => void guardar("agregar")} disabled={guardando || mezcla.nuevos + mezcla.actualizados === 0}
                className="mt-2 bg-slate-ink text-white rounded-md px-4 py-1.5 text-sm font-medium disabled:opacity-50">
                {guardando ? "Guardando…" : "Agregar"}
              </button>
            </div>
            <div className="bg-white border border-line rounded-md p-3">
              <p className="font-medium">Reemplazar todo</p>
              <p className="text-xs text-ink-soft">
                El inventario pasa a ser solo este Excel ({lectura.equipos.length} equipos; hoy hay {actual.equipos.length}). Úsalo con el
                Excel completo de «Descargar Excel» (sin filtros).
              </p>
              <button type="button" onClick={() => void guardar("reemplazar")} disabled={guardando} className="mt-2 border border-line-strong rounded-md px-4 py-1.5 text-sm font-medium">
                Reemplazar
              </button>
            </div>
          </div>
          <button type="button" onClick={() => setLectura(null)} className="mt-2 text-xs underline">Cancelar</button>
        </div>
      )}
      {msg && <p className={`text-xs mt-2 ${msg.startsWith("✓") ? "text-emerald-700" : "text-danger"}`}>{msg}</p>}
    </section>
  );
}
