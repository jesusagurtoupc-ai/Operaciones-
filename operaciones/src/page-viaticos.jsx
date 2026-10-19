import { useState, useEffect, useMemo, useRef } from "react";
import * as C from "./core-common";
const {
  classifySyncError,
  SyncDot,
  FilterBar,
  ClearFiltersButton,
  scrollFieldIntoViewOnFocus,
  mutateStorageJSON,
  LOGO_SHIELD,
  COLORS,
  STORAGE_KEY_RECORDS,
  fmtMoney,
  fmtDate,
  initials,
  colorForContacto,
  downloadXlsxWorkbook,
  useCarpetaLocal,
  BotonCarpetaLocal,
  nombreArchivoAnual,
  uid,
  reorderWithinFull,
  useRowDrag,
  DragHandle,
  MultiSelect,
  Kpi,
  STORAGE_KEY_ASISTENCIA_TRABAJADORES,
  ASISTENCIA_SEED_TRABAJADORES,
  todayStr,
  VIATICOS_SEED,
  STORAGE_KEY_VIATICOS,
  emptyViaticoDraft,
  parseMontoGasto,
  normalizeText,
  normalizePersonKey,
  canonicalizePeople,
  ViaticoForm,
  buildOcOptions,
  intentarGuardarConAprobacion,
  intentarEliminarConAprobacion,
  useSustentoGate,
  filterOwnRecords,
  DropdownSelect,
  useAutoSaveOnLeave
} = C;

function ControlViaticos({ isAdmin = false, puedeEditar = true, puedeAgregar = true, puedeEliminar = true, puedeExportar = true, puedeAprobar = false, me = "", ownerIdentity = "", puedeVerTodos = true } = {}) {
  const sustentoGate = useSustentoGate();
  const [viaticos, setViaticos] = useState(null);
  const [trabajadores, setTrabajadores] = useState([]);
  const [ordenesCompra, setOrdenesCompra] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [syncState, setSyncState] = useState("pendiente");
  const [search, setSearch] = useState("");
  const [fTrabajador, setFTrabajador] = useState([]);
  const [fMes, setFMes] = useState(todayStr().slice(0, 7));
  const [fAnio, setFAnio] = useState(todayStr().slice(0, 4));
  const [sortKey, setSortKey] = useState("fecha");
  const [sortDir, setSortDir] = useState(-1);

  const [showAdd, setShowAdd] = useState(false);
  const [draftAdd, setDraftAdd] = useState(emptyViaticoDraft());
  const [editingId, setEditingId] = useState(null);
  const [draftEdit, setDraftEdit] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [exportingXlsx, setExportingXlsx] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    setIsMobile(mq.matches);
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener ? mq.addEventListener("change", onChange) : mq.addListener(onChange);
    return () => {
      mq.removeEventListener ? mq.removeEventListener("change", onChange) : mq.removeListener(onChange);
    };
  }, []);

  useEffect(() => {
    let cancelado = false;
    async function loadAll() {
      let data = [];
      let workersRaw = [];
      let ocRaw = [];

      // Cada fuente auxiliar es independiente: que un usuario no tenga acceso a
      // trabajadores u órdenes de compra no debe impedirle ver sus viáticos.
      try {
        const res = await window.storage.get(STORAGE_KEY_VIATICOS, true);
        const parsed = JSON.parse(res.value);
        data = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        console.error("carga de viaticos: fallo", e);
        if (isAdmin) {
          data = VIATICOS_SEED;
        } else {
          data = [];
        }
      }

      try {
        const resTrab = await window.storage.get(STORAGE_KEY_ASISTENCIA_TRABAJADORES, true);
        const parsed = JSON.parse(resTrab.value);
        workersRaw = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        console.error("carga de trabajadores (viaticos): fallo", e);
        workersRaw = [];
      }

      try {
        const resOC = await window.storage.get(STORAGE_KEY_RECORDS, true);
        const parsed = JSON.parse(resOC.value);
        ocRaw = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        console.error("carga de OC (viaticos): fallo", e);
        ocRaw = [];
      }

      const ocRecords = Array.isArray(ocRaw) ? ocRaw : [];
      setOrdenesCompra(buildOcOptions(ocRecords));

      const workers = canonicalizePeople(Array.isArray(workersRaw) && workersRaw.length
        ? workersRaw
        : (isAdmin ? ASISTENCIA_SEED_TRABAJADORES : []));
      if (cancelado) return;
      setTrabajadores(workers);

      const source = Array.isArray(data) && data.length ? data : (isAdmin ? VIATICOS_SEED : []);
      const canonical = (name) => {
        const raw = String(name || "").trim();
        const match = workers.find((w) => normalizePersonKey(w) === normalizePersonKey(raw));
        return match || raw.toUpperCase();
      };
      const normalized = source.map((v) => ({
        ...v,
        trabajador: canonical(v.trabajador),
        descripcion: typeof v.descripcion === "string" ? v.descripcion.toUpperCase() : v.descripcion,
      }));
      if (cancelado) return;
      setViaticos(normalized);

      if (isAdmin && (!Array.isArray(data) || !data.length || JSON.stringify(normalized) !== JSON.stringify(data))) {
        try { await window.storage.set(STORAGE_KEY_VIATICOS, JSON.stringify(normalized), true); } catch (_) { console.error(_); }
      }
      setSyncState("ok");
      setLoading(false);
    }
    loadAll();
    // Al aprobar/rechazar una propuesta recargamos para reflejar ediciones aprobadas sin recargar la página.
    const onPropuestasChanged = () => loadAll();
    window.addEventListener("wilarcon:propuestas-changed", onPropuestasChanged);
    return () => { cancelado = true; window.removeEventListener("wilarcon:propuestas-changed", onPropuestasChanged); };
  }, [isAdmin]);

  // Al ingresar, un trabajador (no admin) ve el filtro "Trabajador" ya puesto en su propio
  // nombre en vez de "Todos". Solo se aplica una vez para no pisar un cambio manual posterior,
  // y solo si su nombre calza con alguno de los trabajadores registrados.
  const appliedOwnTrabajadorFilter = useRef(false);
  useEffect(() => {
    if (appliedOwnTrabajadorFilter.current) return;
    if (isAdmin || !ownerIdentity || !trabajadores.length) return;
    const propio = trabajadores.find((t) => normalizePersonKey(t) === normalizePersonKey(ownerIdentity));
    if (propio) {
      setFTrabajador([propio]);
      appliedOwnTrabajadorFilter.current = true;
    }
  }, [isAdmin, ownerIdentity, trabajadores]);

  async function persist(next, intent) {
    if (typeof next === "function") {
      try {
        const applied = await mutateStorageJSON(STORAGE_KEY_VIATICOS, [], (current) => next(Array.isArray(current) ? current : []), 4, intent);
        setViaticos(applied);
        setSyncState("ok");
      } catch (e) {
        console.error(e);
        setSyncState(classifySyncError(e));
        alert("No se pudo guardar el cambio: otro usuario modificó estos registros al mismo tiempo y los reintentos automáticos no lograron aplicarlo. Recarga la página e inténtalo de nuevo.");
      }
      return;
    }
    setViaticos(next);
    try { await window.storage.set(STORAGE_KEY_VIATICOS, JSON.stringify(next), { intent }); setSyncState("ok"); } catch (e) { console.error(e); setSyncState(classifySyncError(e)); }
  }

  const trabajadoresDisponibles = useMemo(() => trabajadores.slice().sort((a,b) => a.localeCompare(b, "es", {sensitivity:"base"})), [trabajadores]);
  const mesesDisponiblesViaticos = useMemo(() => Array.from(new Set([...(viaticos || []).map((v) => (v.fecha || "").slice(0, 7)).filter(Boolean), todayStr().slice(0, 7)])).sort().reverse(), [viaticos]);
  const aniosDisponiblesViaticos = useMemo(() => Array.from(new Set(mesesDisponiblesViaticos.map((m) => m.slice(0, 4)))).sort().reverse(), [mesesDisponiblesViaticos]);
  const mesesDelAnioViaticos = useMemo(() => (fAnio ? mesesDisponiblesViaticos.filter((m) => m.slice(0, 4) === fAnio) : []), [mesesDisponiblesViaticos, fAnio]);

  const filtered = useMemo(() => {
    let list = puedeVerTodos ? (viaticos || []) : filterOwnRecords(viaticos || [], ownerIdentity, "trabajador");
    if (fTrabajador.length) list = list.filter((v) => fTrabajador.some((x) => normalizePersonKey(x) === normalizePersonKey(v.trabajador)));
    if (fMes) list = list.filter((v) => (v.fecha || "").slice(0, 7) === fMes);
    else if (fAnio) list = list.filter((v) => (v.fecha || "").slice(0, 4) === fAnio);
    const q = normalizeText(search);
    if (q) list = list.filter((v) => [v.descripcion, v.oc].some((x) => normalizeText(x).includes(q)));
    if (sortKey === "__manual") return list;
    return [...list].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (sortKey === "monto") { av = Number(av) || 0; bv = Number(bv) || 0; }
      if (av < bv) return -1 * sortDir;
      if (av > bv) return 1 * sortDir;
      return 0;
    });
  }, [viaticos, fTrabajador, fMes, fAnio, search, sortKey, sortDir, puedeVerTodos, ownerIdentity]);

  function handleManualReorder(fromIdx, toIdx) {
    const next = reorderWithinFull(viaticos || [], filtered, fromIdx, toIdx, "id");
    setSortKey("__manual");
    persist(next);
  }
  const rowDrag = useRowDrag({ enabled: !!isAdmin, idKey: "id", onReorder: handleManualReorder });

  const mesScopeViaticos = useMemo(() => filtered, [filtered]);

  const kpisPorTrabajadorList = useMemo(() => {
    const list = mesScopeViaticos;
    const map = {};
    list.forEach((v) => {
      const key = v.trabajador || "Sin asignar";
      if (!map[key]) map[key] = { trabajador: key, monto: 0, registros: 0 };
      map[key].monto += parseMontoGasto(v.monto);
      map[key].registros += 1;
    });
    return Object.values(map).sort((a, b) => b.monto - a.monto);
  }, [mesScopeViaticos]);

  const total = useMemo(() => (viaticos || []).reduce((s, v) => s + (parseMontoGasto(v.monto)), 0), [viaticos]);
  const totalFiltrado = useMemo(() => filtered.reduce((s, v) => s + (parseMontoGasto(v.monto)), 0), [filtered]);
  const promedioFiltrado = filtered.length ? totalFiltrado / filtered.length : 0;
  const mesActualTotal = useMemo(() => {
    const ym = todayStr().slice(0, 7);
    return (viaticos || [])
      .filter((v) => (v.fecha || "").slice(0, 7) === ym)
      .reduce((s, v) => s + parseMontoGasto(v.monto), 0);
  }, [viaticos]);
  const maxMontoTrabajador = kpisPorTrabajadorList.length ? kpisPorTrabajadorList[0].monto : 0;

  function toggleTrabajadorFiltro(nombre) {
    setFTrabajador((prev) => (prev.includes(nombre) ? prev.filter((x) => x !== nombre) : [...prev, nombre]));
  }

  function labelMesViatico(ym) {
    const MESES_ABBR_V = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const [y, m] = ym.split("-");
    return `${MESES_ABBR_V[Number(m) - 1] || ym} ${y.slice(2)}`;
  }

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => -d);
    else { setSortKey(key); setSortDir(-1); }
  }

  function normalizeViaticoDraft(draft) {
    const rawTrabajador = (draft.trabajador || "").trim();
    const trabajador = trabajadores.find((w) => String(w).trim().toLocaleLowerCase() === rawTrabajador.toLocaleLowerCase()) || rawTrabajador;
    return {
      ...draft,
      trabajador,
      fecha: draft.fecha || "",
      descripcion: (draft.descripcion || "").trim(),
      oc: (draft.oc || "").trim(),
      monto: Number(draft.monto) || 0,
    };
  }
  function validateViatico(rec) {
    if (!rec.trabajador) return "Debes indicar el trabajador.";
    if (!rec.fecha) return "Debes indicar la fecha.";
    if (!rec.descripcion) return "Debes indicar una descripción.";
    if (!Number.isFinite(rec.monto) || rec.monto === 0) return "El monto no puede ser S/ 0.00 (usa un monto negativo para un descuento).";
    return "";
  }
  function resetFilters() {
    setSearch(""); setFTrabajador([]); setFMes(""); setFAnio("");
  }
  function openAdd() { if (!puedeAgregar) return; setDraftAdd(emptyViaticoDraft()); setShowAdd(true); }
  async function confirmAdd() {
    if (!puedeAgregar) return;
    const rec = normalizeViaticoDraft({ ...draftAdd, id: uid() });
    const error = validateViatico(rec);
    if (error) { alert(error); return; }
    await persist((current) => [rec, ...current], "crear");
    setShowAdd(false);
  }
  function openEdit(r) { if (!puedeEditar) return; setEditingId(r.id); setDraftEdit({ ...r }); }
  async function persistEdit(draftToSave) {
    const rec = normalizeViaticoDraft(draftToSave);
    const original = (viaticos || []).find((v) => v.id === editingId);
    await intentarGuardarConAprobacion({
      puedeAprobar, modulo: "viaticos", moduloLabel: "Viáticos y Descuentos",
      storageKey: STORAGE_KEY_VIATICOS, idField: "id", recordId: editingId,
      original, propuesto: rec, autor: me,
      labels: { trabajador: "Trabajador", fecha: "Fecha", descripcion: "Descripción", oc: "N° OC", monto: "Monto" },
      persistDirecto: (intent) => persist((current) => current.map((v) => (v.id === editingId ? rec : v)), intent),
      pedirSustento: sustentoGate.solicitar,
    });
  }
  // Autoguardado: guarda solo lo editado si el usuario cambia de pestaña, oculta la
  // ventana o cierra el formulario sin apretar "Guardar".
  const autoSaveEdit = useAutoSaveOnLeave({
    active: !!editingId && puedeEditar,
    draft: draftEdit,
    saveFn: persistEdit,
    isValid: (d) => !validateViatico(normalizeViaticoDraft(d)),
  });
  async function cerrarEdit() { await autoSaveEdit(); setEditingId(null); setDraftEdit(null); }
  async function confirmEdit() {
    if (!puedeEditar || !draftEdit) return;
    const error = validateViatico(normalizeViaticoDraft(draftEdit));
    if (error) { alert(error); return; }
    await persistEdit(draftEdit);
    setEditingId(null); setDraftEdit(null);
  }
  async function doDelete(id) {
    if (!puedeEliminar) return;
    const registro = (viaticos || []).find((v) => v.id === id);
    await intentarEliminarConAprobacion({
      puedeAprobar, modulo: "viaticos", moduloLabel: "Viáticos y Descuentos",
      storageKey: STORAGE_KEY_VIATICOS, idField: "id", recordId: id, autor: me,
      resumen: registro ? `${registro.trabajador || ""} — ${registro.descripcion || ""}` : `registro ${id}`,
      persistDirecto: (intent) => persist((current) => current.filter((v) => v.id !== id), intent),
      pedirSustento: sustentoGate.solicitar,
    });
    setConfirmDelete(null);
  }

  function sheetsViaticos() {
    return [{ name: "Viáticos y Descuentos", records: filtered, headers: ["Trabajador", "Fecha", "Descripción", "OC", "Monto"], rowMapper: (v) => [v.trabajador, v.fecha, v.descripcion, v.oc, v.monto] }];
  }
  async function exportXlsx() {
    setExportingXlsx(true);
    try {
      await downloadXlsxWorkbook(sheetsViaticos(), "viaticos");
    } catch (e) {
      console.error("exportXlsx error", e);
      alert("Ocurrió un error al generar la descarga. Intenta nuevamente.");
    } finally {
      setExportingXlsx(false);
    }
  }
  const carpetaLocal = useCarpetaLocal("viaticos");
  useEffect(() => {
    if (!viaticos) return;
    carpetaLocal.programarGuardado(nombreArchivoAnual("operaciones-viaticos"), sheetsViaticos);
  }, [viaticos]);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: COLORS.dim, fontFamily: "'Inter',sans-serif" }}>Cargando…</div>;

  return (
    <div style={{ background: COLORS.bg, color: COLORS.text, fontFamily: "'Inter',sans-serif", fontSize: 13, padding: isMobile ? 10 : 16, borderRadius: 14 }}>
      <style>{`
        .ct-th { position: sticky; top: 0; background: ${COLORS.panel2}; text-align: left; padding: 9px 10px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .5px; color: ${COLORS.dim}; border-bottom: 1px solid ${COLORS.border}; cursor: pointer; user-select: none; white-space: nowrap; }
        .ct-th:hover { color: ${COLORS.amber}; }
        .ct-td { padding: 8px 10px; border-bottom: 1px solid ${COLORS.grid}; vertical-align: middle; }
        .ct-row:hover { background: rgba(77,141,184,.07); cursor: pointer; }
        .ct-scroll::-webkit-scrollbar { height: 8px; width: 8px; }
        .ct-scroll::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 4px; }
        .ct-card { background: ${COLORS.panel2}; border: 1px solid ${COLORS.border}; border-radius: 9px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; cursor: pointer; transition: border-color .15s; }
        .ct-card:hover { border-color: ${COLORS.amber}; }
        .ct-link { color: ${COLORS.blue}; text-decoration: none; }
        .ct-link:hover { text-decoration: underline; }
        .ct-filebtn { display: inline-flex; align-items: center; gap: 6px; background: ${COLORS.panel2}; border: 1px dashed ${COLORS.border}; color: ${COLORS.text}; padding: 8px 14px; border-radius: 7px; font-size: 12.5px; cursor: pointer; }
        .ct-filebtn:hover { border-color: ${COLORS.amber}; color: ${COLORS.amber}; }
      `}</style>

      <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "center", justifyContent: "space-between", background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "14px 18px", marginBottom: 14, flexWrap: "wrap", gap: 12, flexDirection: isMobile ? "column" : "row" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src={LOGO_SHIELD} alt="Operaciones" style={{ width: 40, height: "auto", flexShrink: 0, display: "block" }} />
          <div>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 600 }}>VIÁTICOS Y DESCUENTOS</div>
            <div style={{ fontSize: 11, color: COLORS.dim, display: "flex", alignItems: "center", gap: 4 }}>
              Base de datos compartida en vivo
              <SyncDot syncState={syncState} palette={COLORS} />
            </div>
          </div>
        </div>
      </div>

      <FilterBar>
        <input className="ct-input2" placeholder="Buscar descripción u OC…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 240 }} />
        <MultiSelect label="Trabajador" allLabel="Todos" options={trabajadoresDisponibles} selected={fTrabajador} onChange={setFTrabajador} />
        <div style={{ display: "flex", alignItems: "center", gap: 9 }} title="Elige el año y luego el mes para filtrar los viáticos por período">
          <span style={{ fontSize: 11, color: COLORS.dim, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
            📅 Periodo
          </span>
          <DropdownSelect
            value={fAnio}
            onChange={(v) => { setFAnio(v); setFMes(""); }}
            options={aniosDisponiblesViaticos}
            placeholder="Todos los años"
            buttonStyle={{ width: "auto", background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 20, color: COLORS.text, fontFamily: "'Inter',sans-serif", fontSize: 12.5, fontWeight: 600, padding: "5px 12px" }}
          />
          <DropdownSelect
            value={fMes}
            onChange={setFMes}
            options={mesesDelAnioViaticos.map((m) => ({ value: m, label: labelMesViatico(m) }))}
            placeholder="Todos los meses"
            disabled={!fAnio}
            buttonStyle={{ width: "auto", background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 20, color: COLORS.text, fontFamily: "'Inter',sans-serif", fontSize: 12.5, fontWeight: 600, padding: "5px 12px", opacity: fAnio ? 1 : 0.5 }}
          />
        </div>
        {(search || fTrabajador.length || fMes || fAnio) && <ClearFiltersButton onClick={resetFilters} />}
        <div style={{ marginLeft: isMobile ? 0 : "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {puedeExportar && (
            <button
              onClick={exportXlsx}
              disabled={exportingXlsx}
              title="Descarga en un archivo Excel la información de esta página"
              style={{ display: "flex", alignItems: "center", gap: 6, background: COLORS.amber, color: COLORS.amberText, fontWeight: 600, border: "none", padding: "8px 14px", borderRadius: 7, fontSize: 12.5, cursor: exportingXlsx ? "not-allowed" : "pointer", opacity: exportingXlsx ? 0.6 : 1 }}
            >
              {exportingXlsx ? "Generando…" : "⬇ Descargar"}
            </button>
          )}
          {puedeExportar && <BotonCarpetaLocal carpeta={carpetaLocal} />}
        </div>
      </FilterBar>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 12 }}>
        <div
          title={`Total general: ${(viaticos || []).length} registros`}
          style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ fontSize: 11, color: COLORS.dim, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
              {fMes || fAnio || fTrabajador.length || search.trim() ? "Registros (filtro)" : "Registros"}
            </div>
            <div style={{ opacity: 0.7, flexShrink: 0 }}>🧾</div>
          </div>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 24, fontWeight: 700, color: COLORS.text }}>{String(filtered.length)}</div>
        </div>
        <Kpi
          label={fMes || fAnio || fTrabajador.length || search.trim() ? "Monto (filtro)" : "Monto total"}
          value={fmtMoney(totalFiltrado)}
          tone="amber"
          icon="💰"
          title={`Total general: ${fmtMoney(total)}`}
        />
        <Kpi label={fMes || fAnio ? "Promedio por registro (filtro)" : "Promedio por registro"} value={fmtMoney(promedioFiltrado)} icon="📊" />
        <Kpi label="Gasto del mes" value={fmtMoney(mesActualTotal)} tone={mesActualTotal > 0 ? "green" : undefined} icon="📅" title="Suma de viáticos y descuentos con fecha en el mes en curso" />
      </div>

      {kpisPorTrabajadorList.length > 0 && (
        <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: COLORS.dim, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, marginBottom: 12 }}>
            Gasto por trabajador
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {kpisPorTrabajadorList.map((r, i) => {
              const pct = maxMontoTrabajador > 0 ? Math.max((r.monto / maxMontoTrabajador) * 100, 3) : 0;
              const isActive = fTrabajador.includes(r.trabajador);
              return (
                <div
                  key={r.trabajador}
                  onClick={() => toggleTrabajadorFiltro(r.trabajador)}
                  title="Clic para filtrar por este trabajador"
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 4px", borderBottom: i === kpisPorTrabajadorList.length - 1 ? "none" : `1px solid ${COLORS.border}`, cursor: "pointer", borderRadius: 6, background: isActive ? COLORS.panel2 : "transparent" }}
                >
                  <div style={{ width: 20, height: 20, borderRadius: 50, background: colorForContacto(r.trabajador, kpisPorTrabajadorList.map((x) => x.trabajador)), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: COLORS.dark, flexShrink: 0 }}>{initials(r.trabajador)}</div>
                  <div style={{ width: 100, fontSize: 12, flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: isActive ? 700 : 400 }}>{r.trabajador}</div>
                  <svg width="100%" height="14" style={{ flex: 1, minWidth: 0 }} viewBox="0 0 200 14" preserveAspectRatio="none">
                    <rect x="0" y="2" width="200" height="10" rx="5" fill={COLORS.panel2} />
                    <rect x="0" y="2" width={(pct / 100) * 200} height="10" rx="5" fill={COLORS.amber} />
                  </svg>
                  <div style={{ width: 90, textAlign: "right", fontSize: 11.5, fontWeight: 600, flexShrink: 0, fontFamily: "'JetBrains Mono',monospace", color: parseMontoGasto(r.monto) < 0 ? COLORS.red : COLORS.text }}>{fmtMoney(r.monto)}</div>
                  <div style={{ width: 68, textAlign: "right", fontSize: 10.5, color: COLORS.faint, flexShrink: 0 }}>{r.registros} {r.registros === 1 ? "reg." : "regs."}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "16px 18px", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600 }}>Registros ({filtered.length})</h2>
          {puedeAgregar && (
            <button onClick={openAdd} style={{ display: "flex", alignItems: "center", gap: 6, background: COLORS.amber, color: COLORS.amberText, fontWeight: 600, fontSize: 12.5, padding: "8px 14px", borderRadius: 7, border: "none", cursor: "pointer" }}>
              + Nuevo viático
            </button>
          )}
        </div>
      <div className="ct-scroll" style={{ overflowX: "auto", border: `1px solid ${COLORS.border}`, borderRadius: 9 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", background: COLORS.panel }}>
          <thead>
            <tr>
              <th className="ct-th" onClick={() => toggleSort("trabajador")}>Trabajador</th>
              <th className="ct-th" onClick={() => toggleSort("fecha")}>Fecha</th>
              <th className="ct-th" onClick={() => toggleSort("descripcion")}>Descripción</th>
              <th className="ct-th" onClick={() => toggleSort("oc")}>OC</th>
              <th className="ct-th" onClick={() => toggleSort("monto")}>Monto</th>
              <th className="ct-th" style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td className="ct-td" colSpan={6} style={{ textAlign: "center", color: COLORS.faint, padding: 20 }}>Sin resultados</td></tr>
            )}
            {filtered.map((v, idx) => {
              const dh = rowDrag.getHandlers(idx, v);
              const isOver = rowDrag.dragOverId === v.id;
              return (
              <tr key={v.id} className="ct-row" onClick={() => openEdit(v)} {...dh} style={isOver ? { boxShadow: `inset 0 2px 0 ${COLORS.amber}` } : undefined}>
                <td className="ct-td">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <DragHandle show={isAdmin} isMobile={isMobile} color={COLORS.faint} dragProps={rowDrag.getHandleProps(idx)} dragging={rowDrag.armedIndex === idx} canMoveUp={idx > 0} canMoveDown={idx < filtered.length - 1} onMoveUp={() => rowDrag.moveBy(idx, -1, filtered.length)} onMoveDown={() => rowDrag.moveBy(idx, 1, filtered.length)} />
                    <div style={{ width: 20, height: 20, borderRadius: 50, background: colorForContacto(v.trabajador, trabajadoresDisponibles), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: COLORS.dark, flexShrink: 0 }}>{initials(v.trabajador)}</div>
                    {v.trabajador}
                  </div>
                </td>
                <td className="ct-td" style={{ color: COLORS.dim }}>{fmtDate(v.fecha) || "—"}</td>
                <td className="ct-td">{v.descripcion || "—"}</td>
                <td className="ct-td" style={{ color: COLORS.dim }}>{v.oc || "—"}</td>
                <td className="ct-td" style={{ fontWeight: 600, color: parseMontoGasto(v.monto) < 0 ? COLORS.red : COLORS.text }}>{fmtMoney(v.monto)}</td>
                <td className="ct-td" onClick={(e) => e.stopPropagation()}>
                  {puedeEliminar && <button onClick={() => setConfirmDelete(v.id)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.faint, borderRadius: 6, padding: "4px 8px", fontSize: 11, cursor: "pointer" }}>Eliminar</button>}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>

      {showAdd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setShowAdd(false)}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 18, width: 440, maxWidth: "92vw" }} onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, marginBottom: 12 }}>Nuevo viático</div>
            <ViaticoForm value={draftAdd} onChange={setDraftAdd} trabajadores={trabajadores} ocOptions={ordenesCompra} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button onClick={() => setShowAdd(false)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, borderRadius: 7, padding: "7px 14px", fontSize: 12.5, cursor: "pointer" }}>Cancelar</button>
              <button onClick={confirmAdd} style={{ background: COLORS.amber, color: COLORS.amberText, border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {editingId && draftEdit && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={cerrarEdit}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 18, width: 440, maxWidth: "92vw" }} onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, marginBottom: 12 }}>Editar viático</div>
            <ViaticoForm value={draftEdit} onChange={setDraftEdit} trabajadores={trabajadores} ocOptions={ordenesCompra} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button onClick={cerrarEdit} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, borderRadius: 7, padding: "7px 14px", fontSize: 12.5, cursor: "pointer" }}>Cancelar</button>
              <button onClick={confirmEdit} style={{ background: COLORS.amber, color: COLORS.amberText, border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Guardar cambios</button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setConfirmDelete(null)}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 18, width: 320, maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ fontSize: 13.5, color: COLORS.text, marginBottom: 14 }}>¿Eliminar este viático?</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setConfirmDelete(null)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, borderRadius: 7, padding: "7px 14px", fontSize: 12.5, cursor: "pointer" }}>Cancelar</button>
              <button onClick={() => doDelete(confirmDelete)} style={{ background: COLORS.red, color: COLORS.white, border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Eliminar</button>
            </div>
          </div>
        </div>
      )}
      {sustentoGate.modal}
    </div>
  );
}

export { ViaticoForm, ControlViaticos };
