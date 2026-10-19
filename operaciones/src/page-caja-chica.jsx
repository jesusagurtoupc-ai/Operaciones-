import { useEffect, useMemo, useState } from "react";
import * as C from "./core-common";

const {
  COLORS,
  FilterBar,
  ClearFiltersButton,
  SyncDot,
  Kpi,
  useIsMobile,
  classifySyncError,
  mutateStorageJSON,
  todayStr,
  uid,
  fmtMoney,
  fmtDate,
  normalizeText,
  downloadXlsxWorkbook,
  useCarpetaLocal,
  BotonCarpetaLocal,
  nombreArchivoAnual,
  MAX_FILE_BYTES,
  fileToDataURL,
  subirFotoADrive,
  urlFotoDrive,
  eliminarFotoDrive,
  intentarGuardarConAprobacion,
  intentarEliminarConAprobacion,
  useSustentoGate,
  useAutoSaveOnLeave,
  STORAGE_KEY_RECORDS,
  OCSelector,
  buildOcOptions,
  DropdownSelect,
  InfoRow,
  scrollFieldIntoViewOnFocus,
  LOGO_SHIELD,
} = C;

export const STORAGE_KEY_CAJA_CHICA = "wilarcon_caja_chica_records";

const ESTADOS = ["PENDIENTE", "APROBADO", "PAGADO", "OBSERVADO"];
const MEDIOS = ["EFECTIVO", "TRANSFERENCIA", "YAPE/PLIN", "TARJETA", "OTRO"];
const CATEGORIAS = ["MOVILIDAD", "ALIMENTACION", "MATERIALES", "HERRAMIENTAS", "MENSAJERIA", "SERVICIOS", "OTROS"];
const TIPOS = ["EGRESO", "INGRESO"];

function emptyDraft() {
  return {
    tipo: "EGRESO",
    fecha: todayStr(),
    categoria: "OTROS",
    descripcion: "",
    centroCosto: "",
    medioPago: "EFECTIVO",
    importe: "",
    estado: "PENDIENTE",
    observacion: "",
  };
}

function monto(v) {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function normalizeRecord(r) {
  return {
    ...r,
    tipo: TIPOS.includes(String(r?.tipo || "").toUpperCase()) ? String(r.tipo).toUpperCase() : "EGRESO",
    fecha: String(r?.fecha || "").slice(0, 10),
    categoria: String(r?.categoria || "OTROS").toUpperCase(),
    descripcion: String(r?.descripcion || "").trim(),
    centroCosto: String(r?.centroCosto || "").trim(),
    medioPago: String(r?.medioPago || "EFECTIVO").toUpperCase(),
    importe: monto(r?.importe),
    estado: String(r?.estado || "PENDIENTE").toUpperCase(),
    observacion: String(r?.observacion || "").trim(),
  };
}

function estadoStyle(estado) {
  const n = String(estado || "").toUpperCase();
  if (n === "PAGADO" || n === "APROBADO") return { bg: COLORS.greenDim, fg: COLORS.greenSoft };
  if (n === "OBSERVADO") return { bg: COLORS.redDim, fg: COLORS.redSoft };
  return { bg: COLORS.amberDim, fg: COLORS.blueSoft };
}

function Campo({ label, children, required }) {
  return <label style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
    <span style={{ fontSize: 11, color: COLORS.dim, fontWeight: 600 }}>{label}{required ? " *" : ""}</span>
    {children}
  </label>;
}

const pillDropdownStyle = {
  background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 20, color: COLORS.text,
  fontFamily: "'Inter',sans-serif", fontSize: 12.5, fontWeight: 600, padding: "5px 12px",
};

export function ControlCajaChica({ isAdmin = false, puedeEditar = true, puedeAgregar = true, puedeEliminar = true, puedeExportar = true, puedeAdjuntar = true, puedeAprobar = false, me = "" } = {}) {
  const sustentoGate = useSustentoGate();
  const [records, setRecords] = useState(null);
  const [syncState, setSyncState] = useState("pendiente");
  const [search, setSearch] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fCategoria, setFCategoria] = useState("");
  const [fMes, setFMes] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState(emptyDraft());
  const [detalle, setDetalle] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(null);
  const [docs, setDocs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [ocOptions, setOcOptions] = useState([]);

  useEffect(() => {
    let cancelado = false;
    async function cargarOrdenesCompra() {
      try {
        const res = await window.storage.get(STORAGE_KEY_RECORDS, true);
        const raw = JSON.parse(res.value);
        const records = Array.isArray(raw) ? raw : [];
        const ordered = records.filter(r => String(r?.oc || "").trim()).sort((a, b) => (Number(b?.n) || 0) - (Number(a?.n) || 0));
        if (!cancelado) setOcOptions(buildOcOptions(ordered));
      } catch (e) { if (!cancelado) setOcOptions([]); console.error("cargarOrdenesCompra (caja chica): fallo la carga", e); }
    }
    cargarOrdenesCompra();
    const onTrabajosChanged = () => cargarOrdenesCompra();
    const onVisible = () => { if (document.visibilityState === "visible") cargarOrdenesCompra(); };
    window.addEventListener("wilarcon:trabajos-changed", onTrabajosChanged);
    document.addEventListener("visibilitychange", onVisible);
    const intervalId = setInterval(cargarOrdenesCompra, 60000);
    return () => {
      cancelado = true;
      clearInterval(intervalId);
      window.removeEventListener("wilarcon:trabajos-changed", onTrabajosChanged);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadRecords() {
      try {
        const res = await window.storage.get(STORAGE_KEY_CAJA_CHICA, true);
        const raw = JSON.parse(res.value);
        const data = Array.isArray(raw) ? raw.map(normalizeRecord).filter(r => r.id) : [];
        if (!cancelled) { setRecords(data); setSyncState("ok"); }
      } catch (e) {
        if (!cancelled) { setRecords([]); setSyncState(classifySyncError(e)); }
      }
    }
    loadRecords();
    const onPropuestasChanged = () => loadRecords();
    window.addEventListener("wilarcon:propuestas-changed", onPropuestasChanged);
    return () => { cancelled = true; window.removeEventListener("wilarcon:propuestas-changed", onPropuestasChanged); };
  }, []);

  async function persist(next, intent) {
    try {
      const applied = await mutateStorageJSON(STORAGE_KEY_CAJA_CHICA, [], current => {
        const base = Array.isArray(current) ? current.map(normalizeRecord) : [];
        return typeof next === "function" ? next(base) : next;
      }, 4, intent);
      setRecords(Array.isArray(applied) ? applied.map(normalizeRecord) : []);
      setSyncState("ok");
      return applied;
    } catch (e) {
      console.error(e); setSyncState(classifySyncError(e));
      alert("No se pudo guardar el cambio. Verifica la conexión y vuelve a intentarlo.");
      return null;
    }
  }

  // Migración retroactiva a mayúsculas (v3.5.31): normaliza lo ya guardado en minúscula o mixtas.
  useEffect(() => {
    if (!isAdmin) return;
    persist((current) => {
      const list = Array.isArray(current) ? current : [];
      const up = (v) => (typeof v === "string" ? v.toUpperCase() : v);
      const normalized = list.map((r) => ({ ...r, descripcion: up(r.descripcion), observacion: up(r.observacion) }));
      return JSON.stringify(normalized) !== JSON.stringify(list) ? normalized : undefined;
    }, "migracion-mayusculas-caja-chica");
  }, [isAdmin]);

  const filtered = useMemo(() => {
    const q = normalizeText(search);
    return (records || []).filter(r => {
      if (fEstado && r.estado !== fEstado) return false;
      if (fTipo && r.tipo !== fTipo) return false;
      if (fCategoria && r.categoria !== fCategoria) return false;
      if (fMes && r.fecha.slice(0, 7) !== fMes) return false;
      if (q && ![r.descripcion, r.centroCosto, r.observacion].some(x => normalizeText(x).includes(q))) return false;
      return true;
    }).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }, [records, search, fEstado, fTipo, fCategoria, fMes]);

  const saldoActual = useMemo(() => (records || []).reduce((s, r) => s + (r.tipo === "EGRESO" ? -monto(r.importe) : monto(r.importe)), 0), [records]);
  const totalIngresos = useMemo(() => filtered.filter(r => r.tipo === "INGRESO").reduce((s, r) => s + monto(r.importe), 0), [filtered]);
  const totalEgresos = useMemo(() => filtered.filter(r => r.tipo === "EGRESO").reduce((s, r) => s + monto(r.importe), 0), [filtered]);
  const pagado = useMemo(() => filtered.filter(r => r.estado === "PAGADO").reduce((s, r) => s + monto(r.importe), 0), [filtered]);
  const pendiente = useMemo(() => filtered.filter(r => r.estado === "PENDIENTE").reduce((s, r) => s + monto(r.importe), 0), [filtered]);
  const aprobado = useMemo(() => filtered.filter(r => r.estado === "APROBADO").reduce((s, r) => s + monto(r.importe), 0), [filtered]);
  const meses = useMemo(() => Array.from(new Set((records || []).map(r => r.fecha.slice(0, 7)).filter(Boolean))).sort().reverse(), [records]);
  const filtrosActivos = !!(search.trim() || fEstado || fTipo || fCategoria || fMes);

  function openAdd() { if (!puedeAgregar) return; setDraft(emptyDraft()); setShowAdd(true); }
  function validate(r) {
    if (!r.fecha) return "Indica la fecha.";
    if (!r.descripcion) return "Indica la descripción del gasto.";
    if (r.importe === 0 || r.importe === "" || Number.isNaN(r.importe)) return "Indica un importe distinto de S/ 0.00.";
    return "";
  }
  async function confirmAdd() {
    if (!puedeAgregar) return;
    const rec = normalizeRecord({ ...draft, estado: (isAdmin || puedeAprobar) ? draft.estado : "PENDIENTE", id: uid(), creadoPor: me, creadoEn: Date.now(), actualizadoEn: Date.now() });
    const err = validate(rec); if (err) return alert(err);
    const saved = await persist(cur => [rec, ...cur], "crear");
    if (saved) { setShowAdd(false); openDetalle(rec.id); }
  }
  async function openDetalle(id) {
    const rec = (records || []).find(r => r.id === id); if (!rec) return;
    setDetalle(id); setEditing(false); setEditDraft(null); setConfirmDelete(false);
    try {
      const res = await window.storage.get(`wilarcon_caja_chica_docs_${id}`, true);
      const raw = JSON.parse(res.value); setDocs(Array.isArray(raw) ? raw : []);
    } catch (e) { console.warn("openDetalle (caja chica): no se pudieron cargar los adjuntos", e); setDocs([]); }
  }
  function startEdit() { if (!puedeEditar || !current) return; setEditDraft({ ...current }); setEditing(true); }
  async function persistEditCaja(draftToSave, { silent } = {}) {
    const rec = normalizeRecord({ ...draftToSave, actualizadoEn: Date.now() });
    const original = current;
    const resultado = await intentarGuardarConAprobacion({
      puedeAprobar, modulo: "caja_chica", moduloLabel: "Caja Chica", storageKey: STORAGE_KEY_CAJA_CHICA, idField: "id", recordId: rec.id,
      original, propuesto: rec, autor: me,
      labels: { tipo: "Tipo", fecha: "Fecha", categoria: "Categoría", descripcion: "Descripción", centroCosto: "Centro de costo", medioPago: "Medio de pago", importe: "Importe", estado: "Estado", observacion: "Observación" },
      persistDirecto: intent => persist(cur => cur.map(x => x.id === rec.id ? rec : x), intent),
      pedirSustento: sustentoGate.solicitar,
    });
    if (!silent) {
      if (resultado?.enviadoAprobacion) {
        alert("El cambio fue enviado a aprobación. El registro actual no se modificó todavía.");
      } else if (resultado?.cancelado) {
        return false;
      }
    }
    return true;
  }
  // Autoguardado: guarda lo editado si el usuario cambia de pestaña, oculta la
  // ventana o cierra el detalle sin apretar "Guardar cambios".
  const autoSaveEditCaja = useAutoSaveOnLeave({
    active: editing && puedeEditar,
    draft: editDraft,
    saveFn: (d) => persistEditCaja(d, { silent: true }),
    isValid: (d) => !validate(normalizeRecord({ ...d, actualizadoEn: Date.now() })),
  });
  async function saveEdit() {
    if (!puedeEditar || !editDraft) return;
    const err = validate(normalizeRecord({ ...editDraft, actualizadoEn: Date.now() })); if (err) return alert(err);
    const ok = await persistEditCaja(editDraft);
    if (ok === false) return;
    setEditing(false); setEditDraft(null);
  }
  async function remove() {
    if (!puedeEliminar || !current) return;
    const id = current.id;
    const resultado = await intentarEliminarConAprobacion({
      puedeAprobar, modulo: "caja_chica", moduloLabel: "Caja Chica", storageKey: STORAGE_KEY_CAJA_CHICA, idField: "id", recordId: id, autor: me, docsKeyToClear: `wilarcon_caja_chica_docs_${id}`,
      resumen: `${current.descripcion} — ${fmtMoney(current.importe)}`,
      pedirSustento: sustentoGate.solicitar,
      persistDirecto: async intent => {
        const applied = await persist(cur => cur.filter(x => x.id !== id), intent);
        if (applied) { try { await window.storage.set(`wilarcon_caja_chica_docs_${id}`, JSON.stringify([]), { intent: "adjuntar" }); } catch (_) { console.error(_); } }
        return applied;
      },
    });
    if (resultado?.enviadoAprobacion) {
      alert("La solicitud de eliminación fue enviada a aprobación. El registro permanece hasta que un administrador la apruebe.");
      setConfirmDelete(false);
    } else if (resultado?.cancelado) {
      setConfirmDelete(false);
    } else {
      setDetalle(null); setDocs([]); setConfirmDelete(false);
    }
  }
  async function saveDocs(next) {
    if (!detalle) return false;
    try {
      await window.storage.set(`wilarcon_caja_chica_docs_${detalle}`, JSON.stringify(next), { intent: "adjuntar" });
      setDocs(next);
      return true;
    } catch (e) {
      console.error(e);
      alert("No se pudo guardar el sustento. Verifica tus permisos y vuelve a intentarlo.");
      return false;
    }
  }
  async function onFiles(fileList) {
    if (!puedeAdjuntar || !detalle) return;
    setUploading(true);
    const accepted = [];
    for (const f of Array.from(fileList || [])) {
      if (f.size > MAX_FILE_BYTES) { alert(`"${f.name}" supera 4MB.`); continue; }
      try {
        const dataUrl = await fileToDataURL(f);
        const driveFileId = await subirFotoADrive(dataUrl, f.name);
        accepted.push({ id: uid(), name: f.name, type: f.type, size: f.size, driveFileId, uploadedAt: Date.now() });
      } catch (_) {
        console.error(_);
        alert(`No se pudo subir "${f.name}". Revisa tu conexión e inténtalo de nuevo.`);
      }
    }
    if (accepted.length) await saveDocs([...docs, ...accepted]);
    setUploading(false);
  }
  async function deleteDoc(docId) {
    if (!puedeAdjuntar || !detalle) return;
    if (!window.confirm("¿Eliminar este sustento?")) return;
    const doc = docs.find(d => d.id === docId);
    if (doc && doc.driveFileId) eliminarFotoDrive(doc.driveFileId);
    const next = docs.filter(d => d.id !== docId);
    await saveDocs(next);
  }

  function sheetsCajaChica() {
    return [{ name: "Caja Chica", records: filtered, headers: ["Tipo","Fecha","Categoría","Descripción","Centro de costo","Medio de pago","Importe","Estado","Observación"], rowMapper: r => [r.tipo,r.fecha,r.categoria,r.descripcion,r.centroCosto,r.medioPago,r.importe,r.estado,r.observacion] }];
  }
  async function exportXlsx() {
    if (!puedeExportar) return; setExporting(true);
    try { await downloadXlsxWorkbook(sheetsCajaChica(), "caja-chica"); }
    finally { setExporting(false); }
  }
  const carpetaLocal = useCarpetaLocal("caja-chica");
  useEffect(() => {
    if (!records) return;
    carpetaLocal.programarGuardado(nombreArchivoAnual("operaciones-caja-chica"), sheetsCajaChica);
  }, [records]);

  const current = useMemo(() => (records || []).find(r => r.id === detalle) || null, [records, detalle]);
  if (records === null) return <div style={{ padding: 24, color: COLORS.dim }}>Cargando Caja Chica…</div>;
  const form = editDraft || draft;
  const setForm = (k, v) => editDraft ? setEditDraft(x => ({ ...x, [k]: v })) : setDraft(x => ({ ...x, [k]: v }));

  return <div style={{ padding: "18px 20px 40px", maxWidth: 1500, margin: "0 auto" }}>
    <style>{`
      .ct-th { position: sticky; top: 0; background: ${COLORS.panel2}; text-align: left; padding: 9px 10px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .5px; color: ${COLORS.dim}; border-bottom: 1px solid ${COLORS.border}; white-space: nowrap; }
      .ct-td { padding: 8px 10px; border-bottom: 1px solid ${COLORS.grid}; vertical-align: middle; font-size: 12px; color: ${COLORS.text}; white-space: nowrap; }
      .ct-row:hover { background: rgba(77,141,184,.07); cursor: pointer; }
      .ct-scroll::-webkit-scrollbar { height: 8px; width: 8px; }
      .ct-scroll::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 4px; }
    `}</style>

    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "14px 18px", marginBottom: 14, flexWrap: "wrap", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <img src={LOGO_SHIELD} alt="Operaciones" style={{ width: 40, height: "auto", flexShrink: 0, display: "block" }} />
        <div>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 600 }}>CAJA CHICA</div>
          <div style={{ fontSize: 11, color: COLORS.dim, display: "flex", alignItems: "center", gap: 4 }}>
            Registro y control de gastos de caja chica
            <SyncDot syncState={syncState} palette={COLORS} />
          </div>
        </div>
      </div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10, marginBottom: 12 }}>
      <Kpi label="Registros" value={String(filtered.length)} icon="▤" />
      <Kpi label="Saldo actual" value={fmtMoney(saldoActual)} icon="S/" tone={saldoActual < 0 ? "red" : saldoActual > 0 ? "green" : undefined} title="Ingresos menos egresos de toda la base de datos de caja chica (no depende de los filtros aplicados)." />
      <Kpi label={filtrosActivos ? "Ingresos (filtro)" : "Ingresos"} value={fmtMoney(totalIngresos)} icon="↑" tone={totalIngresos > 0 ? "green" : undefined} />
      <Kpi label={filtrosActivos ? "Egresos (filtro)" : "Egresos"} value={fmtMoney(totalEgresos)} icon="↓" tone={totalEgresos > 0 ? "amber" : undefined} />
      <Kpi label={filtrosActivos ? "Pagado (filtro)" : "Pagado"} value={fmtMoney(pagado)} icon="✓" tone={pagado > 0 ? "green" : undefined} />
      <Kpi label={filtrosActivos ? "Pendiente (filtro)" : "Pendiente"} value={fmtMoney(pendiente)} icon="!" tone={pendiente > 0 ? "amber" : "green"} />
      <Kpi label={filtrosActivos ? "Aprobado (filtro)" : "Aprobado"} value={fmtMoney(aprobado)} icon="◆" tone={aprobado > 0 ? "green" : undefined} />
    </div>

    <FilterBar>
      <input className="ct-input2" autoComplete="off" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar descripción, centro de costo…" style={{ flex: "2 1 220px", minWidth: 180, width: "auto" }} />
      <DropdownSelect value={fTipo} onChange={setFTipo} wrapperStyle={{ flex: "1 1 130px" }} buttonStyle={pillDropdownStyle} placeholder="Ingreso / Egreso" options={TIPOS} />
      <DropdownSelect value={fEstado} onChange={setFEstado} wrapperStyle={{ flex: "1 1 130px" }} buttonStyle={pillDropdownStyle} placeholder="Todos los estados" options={ESTADOS} />
      <DropdownSelect value={fCategoria} onChange={setFCategoria} wrapperStyle={{ flex: "1 1 130px" }} buttonStyle={pillDropdownStyle} placeholder="Todas las categorías" options={CATEGORIAS} />
      <DropdownSelect value={fMes} onChange={setFMes} wrapperStyle={{ flex: "1 1 130px" }} buttonStyle={pillDropdownStyle} placeholder="Todos los meses" options={meses} />
      <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(search || fEstado || fTipo || fCategoria || fMes) && (
          <ClearFiltersButton onClick={() => { setSearch(""); setFEstado(""); setFTipo(""); setFCategoria(""); setFMes(""); }} title="Restablecer todos los filtros de caja chica" />
        )}
        {puedeExportar && (
          <button onClick={exportXlsx} disabled={exporting} title="Descarga en un archivo Excel la información de esta página" style={{ display: "flex", alignItems: "center", gap: 6, background: COLORS.amber, color: COLORS.amberText, fontWeight: 600, border: "none", padding: "8px 14px", borderRadius: 7, fontSize: 12.5, cursor: exporting ? "not-allowed" : "pointer", opacity: exporting ? 0.6 : 1 }}>
            {exporting ? "Generando…" : "⬇ Descargar"}
          </button>
        )}
        {puedeExportar && <BotonCarpetaLocal carpeta={carpetaLocal} />}
      </div>
    </FilterBar>

    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600 }}>Registros ({filtered.length})</h2>
        {puedeAgregar && (
          <button onClick={openAdd} style={{ display: "flex", alignItems: "center", gap: 6, background: COLORS.amber, color: COLORS.amberText, fontWeight: 600, fontSize: 12.5, padding: "8px 14px", borderRadius: 7, border: "none", cursor: "pointer" }}>
            ＋ Registrar gasto
          </button>
        )}
      </div>
      <div className="ct-scroll" style={{ overflowX: "auto", border: `1px solid ${COLORS.border}`, borderRadius: 9 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 950, background: COLORS.panel }}>
          <thead><tr>{["Tipo","Fecha","Categoría","Descripción","Centro de costo","Medio","Importe","Estado"].map(h => <th key={h} className="ct-th">{h}</th>)}</tr></thead>
          <tbody>
            {!filtered.length && <tr><td className="ct-td" colSpan={8} style={{ textAlign: "center", color: COLORS.dim, padding: 30 }}>No hay gastos de caja chica registrados.</td></tr>}
            {filtered.map(r => { const es = estadoStyle(r.estado); const esEgreso = r.tipo === "EGRESO"; return <tr key={r.id} className="ct-row" onClick={() => openDetalle(r.id)}>
              <td className="ct-td"><span style={{ background: esEgreso ? "rgba(232,93,93,.14)" : "rgba(96,196,133,.14)", color: esEgreso ? COLORS.red : COLORS.green, borderRadius: 20, padding: "2px 8px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase" }}>{r.tipo}</span></td>
              <td className="ct-td">{fmtDate(r.fecha)}</td>
              <td className="ct-td">{r.categoria}</td>
              <td className="ct-td" style={{ fontWeight: 600 }}>{r.descripcion}</td>
              <td className="ct-td">{r.centroCosto || "—"}</td>
              <td className="ct-td">{r.medioPago}</td>
              <td className="ct-td" style={{ textAlign: "right", fontWeight: 700, color: esEgreso ? COLORS.red : COLORS.green }}>{fmtMoney(r.importe)}</td>
              <td className="ct-td"><span style={{ background: es.bg, color: es.fg, borderRadius: 999, padding: "4px 8px", fontSize: 10.5, fontWeight: 700 }}>{r.estado}</span></td>
            </tr>; })}
          </tbody>
        </table>
      </div>
    </div>

    {showAdd && <Modal title="Registrar gasto de caja chica" onClose={() => setShowAdd(false)}>
      <GastoForm value={draft} set={setForm} allowStatus={isAdmin || puedeAprobar} ocOptions={ocOptions} />
      <div style={modalActions}><button onClick={() => setShowAdd(false)} style={btnGhost}>Cancelar</button><button onClick={confirmAdd} style={btnPrimary}>Guardar gasto</button></div>
    </Modal>}

    {current && <Modal title={editing ? "Editar gasto de caja chica" : "Detalle — Caja Chica"} onClose={async () => { if (editing) await autoSaveEditCaja(); setDetalle(null); setEditing(false); setConfirmDelete(false); }}>
      {editing ? <GastoForm value={form} set={setForm} allowStatus={isAdmin || puedeAprobar} ocOptions={ocOptions} /> : <Detail record={current} docs={docs} puedeAdjuntar={puedeAdjuntar} onDeleteDoc={deleteDoc} />}
      {!editing && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${COLORS.border}`, flexWrap: "wrap" }}>
        {puedeEliminar ? (confirmDelete
          ? <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11.5, color: COLORS.red }}>¿Eliminar este registro?</span>
              <button onClick={remove} style={btnDangerSolid}>Sí, eliminar</button>
              <button onClick={() => setConfirmDelete(false)} style={btnGhost}>Cancelar</button>
            </div>
          : <button onClick={() => setConfirmDelete(true)} style={btnDanger}>Eliminar</button>
        ) : <span />}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {puedeAdjuntar && <label style={{ ...btnGhost, cursor: uploading ? "default" : "pointer" }}>{uploading ? "Subiendo…" : "📎 Adjuntar sustento"}<input type="file" multiple hidden onChange={e => { onFiles(e.target.files); e.target.value = ""; }} disabled={uploading} /></label>}
          {puedeEditar && <button onClick={startEdit} style={btnPrimary}>Editar</button>}
        </div>
      </div>}
      {editing && <div style={modalActions}><button onClick={async () => { await autoSaveEditCaja(); setEditing(false); setEditDraft(null); }} style={btnGhost}>Cancelar</button><button onClick={saveEdit} style={btnPrimary}>Guardar cambios</button></div>}
    </Modal>}
    {sustentoGate.modal}
  </div>;
}

function GastoForm({ value, set, allowStatus = false, ocOptions = [] }) {
  const isMobile = useIsMobile();
  return <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2,minmax(0,1fr))", gap: 11 }}>
    <div style={{ gridColumn: "1 / -1" }}>
      <Campo label="Tipo" required>
        <div style={{ display: "flex", gap: 8 }}>
          {TIPOS.map(t => <button key={t} type="button" onClick={() => set("tipo", t)} style={{
            flex: 1, padding: "8px 0", borderRadius: 7, cursor: "pointer", fontSize: 12.5, fontWeight: 600, textTransform: "capitalize",
            border: `1px solid ${value.tipo === t ? COLORS.amber : COLORS.border}`,
            background: value.tipo === t ? COLORS.amberDim : COLORS.panel2,
            color: value.tipo === t ? COLORS.amber : COLORS.dim,
          }}>{t}</button>)}
        </div>
      </Campo>
    </div>
    <Campo label="Fecha" required><input className="ct-input2" autoComplete="off" type="date" value={value.fecha || ""} onChange={e => set("fecha", e.target.value)} /></Campo>
    <Campo label="Categoría" required><DropdownSelect value={value.categoria} onChange={v => set("categoria", v)} options={CATEGORIAS} /></Campo>
    <Campo label="Descripción" required><input className="ct-input2" autoComplete="off" value={value.descripcion} onChange={e => set("descripcion", e.target.value.toUpperCase())} placeholder="Ej. compra de materiales" /></Campo>
    <Campo label="Centro de costo"><OCSelector value={value.centroCosto} onChange={v => set("centroCosto", v)} options={ocOptions} placeholder="Seleccionar OC de Control de Trabajo…" /></Campo>
    <Campo label="Medio de pago"><DropdownSelect value={value.medioPago} onChange={v => set("medioPago", v)} options={MEDIOS} /></Campo>
    <Campo label="Importe (S/)" required><input className="ct-input2" autoComplete="off" type="number" step="0.01" value={value.importe} onChange={e => set("importe", e.target.value === "" ? "" : Number(e.target.value))} /></Campo>
    <Campo label="Estado"><DropdownSelect value={value.estado} disabled={!allowStatus} onChange={v => set("estado", v)} buttonStyle={{ opacity: allowStatus ? 1 : 0.7 }} options={ESTADOS} />{!allowStatus && <span style={{ fontSize: 10, color: COLORS.dim }}>Los nuevos gastos se registran como PENDIENTE.</span>}</Campo>
    <Campo label="Observación"><input className="ct-input2" autoComplete="off" value={value.observacion} onChange={e => set("observacion", e.target.value.toUpperCase())} /></Campo>
  </div>;
}

function Detail({ record, docs, puedeAdjuntar, onDeleteDoc }) {
  const isMobile = useIsMobile();
  return <div>
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 16 }}>
      <InfoRow label="Tipo" value={record.tipo} />
      <InfoRow label="Fecha" value={fmtDate(record.fecha)} />
      <InfoRow label="Categoría" value={record.categoria} />
      <InfoRow label="Centro de costo" value={record.centroCosto || "—"} />
      <InfoRow label="Medio de pago" value={record.medioPago} />
      <InfoRow label="Importe" value={fmtMoney(record.importe)} />
      <InfoRow label="Estado" value={record.estado} />
    </div>
    <div style={{ marginBottom: 16 }}><InfoRow label="Descripción" value={record.descripcion} /></div>
    {record.observacion && <div style={{ marginBottom: docs?.length ? 16 : 0 }}><InfoRow label="Observación" value={record.observacion} /></div>}
    {docs?.length > 0 && <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 14 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 10 }}>Sustentos ({docs.length})</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {docs.map(d => <div key={d.id} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
          <a href={d.driveFileId ? urlFotoDrive(d.driveFileId) : d.dataUrl} download={d.name} target="_blank" rel="noreferrer" style={{ ...btnGhost, textDecoration: "none", display: "inline-block", padding: "5px 10px", fontSize: 11.5 }}>Ver / descargar</a>
          {puedeAdjuntar && <button onClick={() => onDeleteDoc(d.id)} style={{ ...btnDanger, padding: "5px 10px", fontSize: 11.5 }}>Eliminar</button>}
        </div>)}
      </div>
    </div>}
  </div>;
}

function Modal({ title, onClose, children, width = 620 }) {
  return <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}>
    <div onClick={e => e.stopPropagation()} style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 22, width, maxWidth: "100%", maxHeight: "85vh", overflowY: "auto", boxSizing: "border-box" }} className="ct-scroll" onFocus={scrollFieldIntoViewOnFocus}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: 15 }}>{title}</div>
        <button onClick={onClose} style={{ background: "transparent", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 16 }}>✕</button>
      </div>
      {children}
    </div>
  </div>;
}

const btnGhost = { background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, padding: "8px 16px", borderRadius: 7, fontSize: 12.5, cursor: "pointer" };
const btnPrimary = { background: COLORS.amber, color: COLORS.amberText, border: "none", padding: "8px 16px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const btnDanger = { background: "transparent", border: `1px solid ${COLORS.redDim}`, color: COLORS.red, padding: "8px 16px", borderRadius: 7, fontSize: 12.5, cursor: "pointer" };
const btnDangerSolid = { background: COLORS.red, color: COLORS.white, border: "none", padding: "8px 16px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const modalActions = { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${COLORS.border}` };
