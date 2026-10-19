import { useState, useRef } from "react";
import * as C from "./core-common";
const {
  COLORS,
  mutateStorageJSON,
  uid,
  todayStr,
  readXlsxRows,
  normalizeFechaImportada,
  STORAGE_KEY_RECORDS,
  FIELD_DEFS,
  computeAutoEstados,
  STORAGE_KEY_VIATICOS,
  STORAGE_KEY_GASTOS,
  parseMontoGasto,
  STORAGE_KEY_CONTACTOS,
  STORAGE_KEY_RESPONSABILIDADES,
  STORAGE_KEY_ASISTENCIA_REGISTROS,
  STORAGE_KEY_ASISTENCIA_TRABAJADORES,
  canonicalPersonName,
  ESTADOS_ASISTENCIA_FORM,
  TURNOS_ASISTENCIA,
  DropdownSelect,
} = C;


function txt(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function normHeader(v) {
  return String(v ?? "")
    .replace(/\u00a0/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/["'“”‘’]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
function coreHeader(v) {
  return normHeader(v).replace(/\(.*?\)/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function valorColumna(fila, headers) {
  const candidatos = Array.isArray(headers) ? headers : [headers];
  for (const h of candidatos) {
    if (h in fila) return fila[h];
  }
  const keys = Object.keys(fila);
  for (const h of candidatos) {
    const objetivo = normHeader(h);
    const key = keys.find((k) => normHeader(k) === objetivo);
    if (key !== undefined) return fila[key];
  }
  for (const h of candidatos) {
    const objetivo = coreHeader(h);
    if (!objetivo) continue;
    const key = keys.find((k) => {
      const core = coreHeader(k);
      return core && (core === objetivo || core.includes(objetivo) || objetivo.includes(core));
    });
    if (key !== undefined) return fila[key];
  }
  return "";
}
function normalizarTipoGasto(raw) {
  const v = normHeader(raw);
  if (!v) return "";
  if (v.startsWith("ingr") || v === "i") return "ingreso";
  if (v.startsWith("egr") || v === "e") return "egreso";
  return "";
}

const TRABAJOS_COLUMNAS = FIELD_DEFS.filter((f) => !f.readOnly).map((f) => ({ header: f.label, campo: f.key, tipo: f.type }));

const MODULOS = [
  {
    key: "trabajos",
    label: "Trabajos",
    storageKey: STORAGE_KEY_RECORDS,
    columnas: TRABAJOS_COLUMNAS,
    idStrategy: "n",
    construir(fila) {
      const draft = {};
      TRABAJOS_COLUMNAS.forEach(({ header, campo: campoKey, tipo }) => {
        const raw = valorColumna(fila, header);
        if (tipo === "number") draft[campoKey] = txt(raw) === "" ? "" : Number(raw) || 0;
        else if (tipo === "date") draft[campoKey] = normalizeFechaImportada(raw);
        else draft[campoKey] = txt(raw);
      });
      if (draft.subtotal !== "" && draft.subtotal !== null) {
        const igv = Math.round(draft.subtotal * 0.18 * 100) / 100;
        draft.igv = igv;
        draft.total = Math.round((draft.subtotal + igv) * 100) / 100;
      } else {
        draft.igv = "";
        draft.total = "";
      }
      if (!draft.oc && !draft.descripcion) return { error: "Falta N° OC o Descripción" };
      return { registro: computeAutoEstados({ ...draft, _updatedAt: Date.now() }) };
    },
  },
  {
    key: "viaticos",
    label: "Viáticos y Descuentos",
    storageKey: STORAGE_KEY_VIATICOS,
    columnas: [
      { header: "Trabajador", campo: "trabajador" },
      { header: "Fecha", campo: "fecha", tipo: "date" },
      { header: "Descripción", campo: "descripcion" },
      { header: "N° OC", campo: "oc" },
      { header: "Monto", campo: "monto", tipo: "number" },
    ],
    idStrategy: "id",
    construir(fila, ctx) {
      const trabajador = canonicalPersonName(txt(valorColumna(fila, "Trabajador")), ctx.trabajadores);
      const fecha = normalizeFechaImportada(valorColumna(fila, "Fecha"));
      const descripcion = txt(valorColumna(fila, "Descripción"));
      const oc = txt(valorColumna(fila, "N° OC"));
      const monto = parseMontoGasto(valorColumna(fila, "Monto"));
      if (!trabajador) return { error: "Falta el trabajador" };
      if (!fecha) return { error: "Falta la fecha" };
      if (!descripcion) return { error: "Falta la descripción" };
      if (!(monto > 0)) return { error: "El monto debe ser mayor que S/ 0.00" };
      return { registro: { trabajador, fecha, descripcion, oc, monto } };
    },
  },
  {
    key: "gastos",
    label: "Gastos",
    storageKey: STORAGE_KEY_GASTOS,
    columnas: [
      { header: "Tipo (ingreso/egreso)", campo: "tipo" },
      { header: "Descripción", campo: "descripcion" },
      { header: "Fecha", campo: "fecha", tipo: "date" },
      { header: "N° OC", campo: "oc" },
      { header: "Monto", campo: "monto", tipo: "number" },
      { header: "Destinatario", campo: "destinatario" },
      { header: "N° Recibo/Factura", campo: "nRecibo" },
      { header: "Estado", campo: "estado" },
    ],
    idStrategy: "id",
    construir(fila) {
      const tipo = normalizarTipoGasto(valorColumna(fila, ["Tipo (ingreso/egreso)", "Tipo"]));
      const descripcion = txt(valorColumna(fila, "Descripción"));
      const fecha = normalizeFechaImportada(valorColumna(fila, "Fecha")) || todayStr();
      const monto = parseMontoGasto(valorColumna(fila, "Monto"));
      if (!tipo) return { error: `El Tipo debe ser "ingreso" o "egreso" (se encontró: "${txt(valorColumna(fila, ["Tipo (ingreso/egreso)", "Tipo"])) || "vacío"}")` };
      if (!descripcion) return { error: "Falta la descripción" };
      if (!(monto > 0)) return { error: "El monto debe ser mayor que S/ 0.00" };
      return {
        registro: {
          tipo,
          descripcion,
          fecha,
          oc: txt(valorColumna(fila, ["N° OC", "OC"])),
          subTotal: "",
          igv: "",
          total: monto,
          anexo: "",
          importe: monto,
          destinatario: txt(valorColumna(fila, "Destinatario")),
          factura: "",
          anexo2: "",
          nRecibo: txt(valorColumna(fila, ["N° Recibo/Factura", "N° Recibo", "Recibo", "Factura"])),
          emision: normalizeFechaImportada(valorColumna(fila, ["Emisión", "Fecha de Emisión"])),
          anexo3: "",
          estado: txt(valorColumna(fila, "Estado")).toUpperCase() || "PENDIENTE",
        },
      };
    },
  },
  {
    key: "contactos",
    label: "Contactos",
    storageKey: STORAGE_KEY_CONTACTOS,
    columnas: [
      { header: "Contacto", campo: "contacto" },
      { header: "Cargo", campo: "cargo" },
      { header: "Dirección", campo: "direccion" },
      { header: "Teléfono", campo: "telefono" },
    ],
    idStrategy: "id",
    construir(fila) {
      const contacto = txt(valorColumna(fila, "Contacto"));
      if (!contacto) return { error: "Falta el nombre del contacto" };
      return { registro: { contacto, cargo: txt(valorColumna(fila, "Cargo")), direccion: txt(valorColumna(fila, "Dirección")), telefono: txt(valorColumna(fila, "Teléfono")) } };
    },
  },
  {
    key: "responsabilidades",
    label: "Responsabilidades",
    storageKey: STORAGE_KEY_RESPONSABILIDADES,
    columnas: [
      { header: "Área", campo: "area" },
      { header: "Tarea", campo: "tarea" },
      { header: "Responsable", campo: "responsable" },
      { header: "Nota", campo: "nota" },
      { header: "Estado (Pendiente/Completado)", campo: "hecho" },
    ],
    idStrategy: "id",
    construir(fila) {
      const tarea = txt(valorColumna(fila, "Tarea"));
      if (!tarea) return { error: "Falta la tarea / responsabilidad" };
      const hecho = /complet/i.test(txt(valorColumna(fila, "Estado (Pendiente/Completado)")));
      return { registro: { area: txt(valorColumna(fila, "Área")), tarea, responsable: txt(valorColumna(fila, "Responsable")), nota: txt(valorColumna(fila, "Nota")), hecho } };
    },
  },
  {
    key: "asistencia",
    label: "Asistencia",
    storageKey: STORAGE_KEY_ASISTENCIA_REGISTROS,
    columnas: [
      { header: "Trabajador", campo: "trabajador" },
      { header: "Fecha", campo: "fecha", tipo: "date" },
      { header: "Turno (D/N)", campo: "turno" },
      { header: "Hora Entrada (HH:MM)", campo: "horaEntrada" },
      { header: "Hora Salida (HH:MM)", campo: "horaSalida" },
      { header: "Ubicación", campo: "ubicacion" },
      { header: "Estado", campo: "estado" },
      { header: "Observación", campo: "observacion" },
    ],
    idStrategy: "id",
    construir(fila, ctx) {
      const trabajador = canonicalPersonName(txt(valorColumna(fila, "Trabajador")), ctx.trabajadores);
      const fecha = normalizeFechaImportada(valorColumna(fila, "Fecha"));
      if (!trabajador) return { error: "Falta el trabajador" };
      if (!fecha) return { error: "Falta la fecha" };
      const turnoRaw = txt(valorColumna(fila, "Turno (D/N)")).toUpperCase();
      const turno = TURNOS_ASISTENCIA.includes(turnoRaw) ? turnoRaw : "D";
      const estadoRaw = txt(valorColumna(fila, "Estado"));
      const estadoMatch = ESTADOS_ASISTENCIA_FORM.find((e) => e.toLowerCase() === estadoRaw.toLowerCase());
      return {
        registro: {
          trabajador,
          fecha,
          turno,
          horaEntrada: txt(valorColumna(fila, "Hora Entrada (HH:MM)")),
          horaSalida: txt(valorColumna(fila, "Hora Salida (HH:MM)")),
          ubicacion: txt(valorColumna(fila, "Ubicación")),
          estado: estadoMatch || "Presente",
          observacion: txt(valorColumna(fila, "Observación")),
        },
      };
    },
  },
];

function descargarPlantilla(modulo) {
  import("xlsx").then((XLSX) => {
    const ws = XLSX.utils.aoa_to_sheet([modulo.columnas.map((c) => c.header)]);
    ws["!cols"] = modulo.columnas.map((c) => ({ wch: Math.min(Math.max(c.header.length + 4, 14), 32) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, modulo.label.slice(0, 31));
    XLSX.writeFile(wb, `plantilla-${modulo.key}.xlsx`);
  });
}

export function ImportarDatosModal({ onClose }) {
  const [moduloKey, setModuloKey] = useState(MODULOS[0].key);
  const [analizando, setAnalizando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [mensajeFinal, setMensajeFinal] = useState("");
  const fileRef = useRef(null);
  const modulo = MODULOS.find((m) => m.key === moduloKey);

  function cambiarModulo(key) {
    setModuloKey(key);
    setResultado(null);
    setMensajeFinal("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setAnalizando(true);
    setResultado(null);
    setMensajeFinal("");
    try {
      const filas = await readXlsxRows(file);
      let trabajadores = [];
      if (modulo.key === "viaticos" || modulo.key === "asistencia") {
        try {
          const res = await window.storage.get(STORAGE_KEY_ASISTENCIA_TRABAJADORES, true);
          const arr = JSON.parse(res.value);
          if (Array.isArray(arr)) trabajadores = arr;
        } catch (_) { console.error(_); }
      }
      const ctx = { trabajadores };
      const validos = [];
      const invalidos = [];
      filas.forEach((fila, idx) => {
        const vacia = Object.values(fila).every((v) => txt(v) === "");
        if (vacia) return;
        const { registro, error } = modulo.construir(fila, ctx);
        if (error) invalidos.push({ fila: idx + 2, error });
        else validos.push(registro);
      });
      setResultado({ validos, invalidos });
    } catch (err) {
      console.error("import xlsx error", err);
      setMensajeFinal("No se pudo leer el archivo. Verifica que sea un Excel (.xlsx) válido.");
    } finally {
      setAnalizando(false);
    }
  }

  async function confirmarImportacion() {
    if (!resultado || !resultado.validos.length) return;
    setImportando(true);
    try {
      await mutateStorageJSON(
        modulo.storageKey,
        [],
        () => {
          if (modulo.idStrategy === "n") {
            let nextN = 1;
            return resultado.validos.map((r) => ({ n: nextN++, ...r }));
          }
          return resultado.validos.map((r) => ({ id: uid(), ...r }));
        },
        4,
        "reemplazar"
      );
      setMensajeFinal(`Se reemplazaron los datos de ${modulo.label}: ahora contiene ${resultado.validos.length} registro(s) del Excel.`);
      setResultado(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      console.error("confirmarImportacion error", err);
      setMensajeFinal("Ocurrió un error al guardar los datos. Intenta nuevamente.");
    } finally {
      setImportando(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 22, width: "min(640px, 92vw)", maxHeight: "88vh", overflowY: "auto", fontFamily: "'Inter',sans-serif", color: COLORS.text }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 15.5, fontWeight: 700 }}>⬆ Cargar datos desde Excel</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: COLORS.dim, fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ fontSize: 10.5, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>1. ¿Para qué página son los datos?</div>
        <DropdownSelect
          value={moduloKey}
          onChange={cambiarModulo}
          options={MODULOS.map((m) => ({ value: m.key, label: m.label }))}
          buttonStyle={{ width: "100%", background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text, fontFamily: "'Inter',sans-serif", fontSize: 13, padding: "9px 12px" }}
          wrapperStyle={{ marginBottom: 16 }}
        />

        <div style={{ fontSize: 10.5, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>2. Descarga la plantilla y complétala</div>
        <button
          onClick={() => descargarPlantilla(modulo)}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.blue, fontWeight: 600, borderRadius: 7, padding: "8px 14px", fontSize: 12.5, cursor: "pointer", marginBottom: 16 }}
        >
          ⬇ Descargar plantilla de {modulo.label}
        </button>

        <div style={{ fontSize: 10.5, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>3. Sube el Excel completado</div>
        <div style={{ background: COLORS.redDim, border: `1px solid ${COLORS.red}`, color: COLORS.red, borderRadius: 8, padding: "8px 12px", fontSize: 11.5, lineHeight: 1.4, marginBottom: 10 }}>
          ⚠ Al importar se <b>borrarán todos los registros actuales</b> de {modulo.label} y quedarán solo los del Excel.
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={onFileSelected} disabled={analizando || importando} style={{ fontSize: 12.5, color: COLORS.dim, marginBottom: 16 }} />

        {analizando && <div style={{ fontSize: 12.5, color: COLORS.dim, marginBottom: 12 }}>Analizando archivo…</div>}

        {resultado && (
          <div style={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: "12px 14px", marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: resultado.validos.length ? COLORS.green : COLORS.dim }}>
              {resultado.validos.length} registro(s) listo(s) para reemplazar los datos actuales de {modulo.label}
            </div>
            {resultado.invalidos.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, color: COLORS.red, fontWeight: 600 }}>{resultado.invalidos.length} fila(s) con errores (no se importarán):</div>
                <div style={{ maxHeight: 140, overflowY: "auto", marginTop: 6 }}>
                  {resultado.invalidos.map((i, idx) => (
                    <div key={idx} style={{ fontSize: 11.5, color: COLORS.dim, padding: "3px 0" }}>Fila {i.fila}: {i.error}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {mensajeFinal && (
          <div style={{ fontSize: 12.5, color: mensajeFinal.startsWith("Se reemplazaron") ? COLORS.green : COLORS.red, marginBottom: 14 }}>{mensajeFinal}</div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, borderRadius: 7, padding: "8px 16px", fontSize: 12.5, cursor: "pointer" }}>Cerrar</button>
          <button
            onClick={confirmarImportacion}
            disabled={!resultado || !resultado.validos.length || importando}
            style={{ background: COLORS.red, color: COLORS.white, fontWeight: 600, border: "none", padding: "8px 16px", borderRadius: 7, fontSize: 12.5, cursor: (!resultado || !resultado.validos.length || importando) ? "not-allowed" : "pointer", opacity: (!resultado || !resultado.validos.length || importando) ? 0.6 : 1 }}
          >
            {importando ? "Reemplazando…" : `Reemplazar datos (${resultado ? resultado.validos.length : ""} registro(s))`}
          </button>
        </div>
      </div>
    </div>
  );
}
