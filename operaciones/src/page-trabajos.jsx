import { useState, useEffect, useMemo, useRef } from "react";
import * as C from "./core-common";
const {
  classifySyncError,
  SyncDot,
  scrollFieldIntoViewOnFocus,
  mutateStorageJSON,
  LOGO_SHIELD,
  COLORS,
  FilterBar,
  ClearFiltersButton,
  SEED_DATA,
  STORAGE_KEY_RECORDS,
  STORAGE_KEY_META,
  DOCS_KEY_PREFIX,
  STORAGE_KEY_KPI_LABELS,
  STORAGE_KEY_HISTORY,
  MAX_HISTORY,
  DIAS_URGENTE,
  DEFAULT_KPI_LABELS,
  MAX_FILE_BYTES,
  FIELD_DEFS,
  emptyDraft,
  computeAutoEstados,
  fmtMoney,
  fmtPct,
  fmtDate,
  fmtDateTime,
  isUrgente,
  groupByMonth,
  groupByField,
  initials,
  colorForContacto,
  normEstado,
  normalizePersonKey,
  canonicalPersonName,
  canonicalizePeople,
  canonicalizeWorkerRecords,
  estadoFacturaColor,
  medioPagoColor,
  docEstadoColor,
  downloadXlsxWorkbook,
  useCarpetaLocal,
  BotonCarpetaLocal,
  nombreArchivoAnual,
  uid,
  fileToDataURL,
  subirFotoADrive,
  eliminarFotoDrive,
  reorderWithinFull,
  useRowDrag,
  DragHandle,
  Badge,
  MultiSelect,
  MiniBarChart,
  ChartPanel,
  Kpi,
  EditForm,
  buildOcOptions,
  AttachmentThumb,
  InfoRow,
  DocRow,
  STORAGE_KEY_ASISTENCIA_REGISTROS,
  STORAGE_KEY_ASISTENCIA_TRABAJADORES,
  horasEntreHorarios,
  fmtHoras,
  STORAGE_KEY_VIATICOS,
  STORAGE_KEY_GASTOS,
  montoGasto,
  parseOcList,
  normalizeText,
  intentarGuardarConAprobacion,
  intentarEliminarConAprobacion,
  useSustentoGate,
  filterOwnRecords,
  useAutoSaveOnLeave
} = C;

function ControlTrabajos({ isAdmin = false, puedeEditar = true, puedeAgregar = true, puedeEliminar = true, puedeExportar = true, puedeAdjuntar = true, puedeAprobar = false, me = "", ownerIdentity = "", puedeVerTodos = true } = {}) {
  const sustentoGate = useSustentoGate();
  const [isMobile, setIsMobile] = useState(false);
  const [records, setRecords] = useState(null);
  const [viaticosData, setViaticosData] = useState([]);
  const [gastosData, setGastosData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncState, setSyncState] = useState("pendiente");
  const migracionCierreRealHecha = useRef(false);

  const [search, setSearch] = useState("");
  const [fContacto, setFContacto] = useState([]);
  const [fUbicacion, setFUbicacion] = useState([]);
  const [fEstadoFactura, setFEstadoFactura] = useState([]);
  const [fMedioPago, setFMedioPago] = useState([]);
  const [fEstadoAC, setFEstadoAC] = useState([]);
  const [fEstadoInforme, setFEstadoInforme] = useState([]);
  const [kpiFilter, setKpiFilter] = useState(null);
  const [sortKey, setSortKey] = useState("n");
  const [sortDir, setSortDir] = useState(1);
  const [view, setView] = useState("tabla");
  const [readOnlyMode, setReadOnlyMode] = useState(false);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  const [detalle, setDetalle] = useState(null);
  const [torreTasks, setTorreTasks] = useState([]);
  const [asistenciaData, setAsistenciaData] = useState([]);
  const [editing, setEditing] = useState(false);
  const [draftEdit, setDraftEdit] = useState(null);
  const [docs, setDocs] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [draftAdd, setDraftAdd] = useState(emptyDraft());
  const [exportingXlsx, setExportingXlsx] = useState(false);

  const [kpiLabels, setKpiLabels] = useState(DEFAULT_KPI_LABELS);

  const recordsRef = useRef([]);
  recordsRef.current = records || [];

  useEffect(() => {
    (async () => {
      const readArray = async (key) => {
        try { const res = await window.storage.get(key, true); const data = JSON.parse(res.value); return Array.isArray(data) ? data : []; } catch (e) { console.error(`readArray(${key}): fallo la carga`, e); return []; }
      };
      const readObjectTasks = async () => {
        try {
          const res = await window.storage.get("torre_ops_data", true);
          const data = JSON.parse(res.value);
          return Array.isArray(data?.tasks) ? data.tasks : [];
        } catch (e) { console.error("readObjectTasks: fallo la carga", e); return []; }
      };
      const [v, g, t, a, w] = await Promise.all([
        readArray(STORAGE_KEY_VIATICOS),
        readArray(STORAGE_KEY_GASTOS),
        readObjectTasks(),
        readArray(STORAGE_KEY_ASISTENCIA_REGISTROS),
        readArray(STORAGE_KEY_ASISTENCIA_TRABAJADORES),
      ]);
      const workers = canonicalizePeople(w);
      setViaticosData((v || []).map((r) => ({ ...r, trabajador: canonicalPersonName(r?.trabajador, workers) })));
      setGastosData(g);
      setTorreTasks(t);
      setAsistenciaData(canonicalizeWorkerRecords(a, workers));
    })();
  }, []);

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
    async function loadRecords() {
      try {
        const res = await window.storage.get(STORAGE_KEY_RECORDS, true);
        const data = JSON.parse(res.value);
        const hasData = Array.isArray(data) && data.length > 0;
        if (cancelado) return;
        if (hasData) {
          setRecords(data);
        } else if (isAdmin) {
          setRecords(SEED_DATA);
          try { await window.storage.set(STORAGE_KEY_RECORDS, JSON.stringify(SEED_DATA), true); } catch (_) { console.error(_); }
        } else {
          setRecords(Array.isArray(data) ? data : []);
        }
        setSyncState("ok");
      } catch (e) {
        if (cancelado) return;
        if (isAdmin) {
          setRecords(SEED_DATA);
          try {
            await window.storage.set(STORAGE_KEY_RECORDS, JSON.stringify(SEED_DATA), true);
          } catch (_) { console.error(_); }
          setSyncState("ok");
        } else {
          setRecords([]);
          setSyncState(classifySyncError(e));
        }
      }
      setLoading(false);
    }
    loadRecords();
    // Al aprobar/rechazar una propuesta (de este u otro módulo) recargamos los registros:
    // así una edición o eliminación aprobada por el admin se refleja sin recargar la página.
    const onPropuestasChanged = () => loadRecords();
    window.addEventListener("wilarcon:propuestas-changed", onPropuestasChanged);
    return () => { cancelado = true; window.removeEventListener("wilarcon:propuestas-changed", onPropuestasChanged); };
  }, [isAdmin]);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY_KPI_LABELS, true);
        const data = JSON.parse(res.value);
        setKpiLabels({ ...DEFAULT_KPI_LABELS, ...(data || {}) });
      } catch (e) {
        console.warn("carga de etiquetas KPI: fallo, se usan las de por defecto", e);
        setKpiLabels(DEFAULT_KPI_LABELS);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY_HISTORY, true);
        const data = JSON.parse(res.value);
        setHistory(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error("carga de historial (trabajos): fallo", e);
        setHistory([]);
      }
    })();
  }, []);

  async function pushHistory(entry) {
    const item = { ts: Date.now(), ...entry };
    setHistory((prev) => {
      const next = [item, ...prev].slice(0, MAX_HISTORY);
      (async () => {
        try {
          await window.storage.set(STORAGE_KEY_HISTORY, JSON.stringify(next), true);
        } catch (e) {
          console.error("persist history error", e);
        }
      })();
      return next;
    });
  }

  async function persistKpiLabel(key, value) {
    setKpiLabels((prev) => {
      const next = { ...prev, [key]: value };
      (async () => {
        try {
          await window.storage.set(STORAGE_KEY_KPI_LABELS, JSON.stringify(next), true);
        } catch (e) {
          console.error("persist kpi label error", e);
        }
      })();
      return next;
    });
  }

  async function persistRecords(next, intent) {
    if (typeof next === "function") {
      try {
        const applied = await mutateStorageJSON(STORAGE_KEY_RECORDS, [], (current) => next(Array.isArray(current) ? current : []), 4, intent);
        setRecords(applied);
        try { await window.storage.set(STORAGE_KEY_META, JSON.stringify({ updatedAt: Date.now(), count: applied.length }), true); } catch (_) { console.error(_); }
        setSyncState("ok");
        try { window.dispatchEvent(new CustomEvent("wilarcon:trabajos-changed")); } catch (_) { console.error(_); }
        return applied;
      } catch (e) {
        console.error("persist error", e);
        setSyncState(classifySyncError(e));
        alert("No se pudo guardar el cambio: otro usuario modificó estos registros al mismo tiempo y los reintentos automáticos no lograron aplicarlo. Recarga la página e inténtalo de nuevo.");
        return;
      }
    }
    setRecords(next);
    try {
      await window.storage.set(STORAGE_KEY_RECORDS, JSON.stringify(next), { intent });
      await window.storage.set(STORAGE_KEY_META, JSON.stringify({ updatedAt: Date.now(), count: next.length }), true);
      setSyncState("ok");
      try { window.dispatchEvent(new CustomEvent("wilarcon:trabajos-changed")); } catch (_) { console.error(_); }
    } catch (e) {
      console.error("persist error", e);
      setSyncState(classifySyncError(e));
    }
  }

  // Migración retroactiva a mayúsculas (v3.5.31): normaliza los registros que
  // ya estaban guardados en minúscula o mixtas, igual que se hizo con Asistencia.
  useEffect(() => {
    if (!isAdmin) return;
    persistRecords((current) => {
      const list = Array.isArray(current) ? current : [];
      const up = (v) => (typeof v === "string" ? v.toUpperCase() : v);
      const normalized = list.map((r) => ({
        ...r,
        cliente: up(r.cliente), proyecto: up(r.proyecto), responsable: up(r.responsable),
        personalAsignado: up(r.personalAsignado), proveedor: up(r.proveedor), contacto: up(r.contacto),
        ubicacion: up(r.ubicacion), descripcion: up(r.descripcion), observacion: up(r.observacion),
        nInforme: up(r.nInforme), nAC: up(r.nAC), nFactura: up(r.nFactura), oc: up(r.oc),
      }));
      return JSON.stringify(normalized) !== JSON.stringify(list) ? normalized : undefined;
    }, "migracion-mayusculas-trabajos");
  }, [isAdmin]);

  // Migración única: completa "Cierre real" (fechaFinReal) para los registros
  // ya guardados que no lo tengan, usando la misma regla que computeAutoEstados
  // (fecha de hoy si ya tienen el Informe cargado; si no, queda en blanco
  // hasta que se edite a mano o se cargue el Informe).
  // Se ejecuta una sola vez por sesión, y solo persiste si hubo cambios reales.
  useEffect(() => {
    if (loading || migracionCierreRealHecha.current) return;
    if (!Array.isArray(records) || !records.length) return;
    migracionCierreRealHecha.current = true;
    const huboCambios = records.some((r) => {
      const actualizado = computeAutoEstados(r);
      return actualizado.fechaFinReal !== r.fechaFinReal || actualizado.fechaFinRealAuto !== r.fechaFinRealAuto;
    });
    if (huboCambios) {
      persistRecords((current) => (current || []).map((r) => {
        const actualizado = computeAutoEstados(r);
        return (actualizado.fechaFinReal !== r.fechaFinReal || actualizado.fechaFinRealAuto !== r.fechaFinRealAuto) ? actualizado : r;
      }), "migracion-cierre-real");
    }
  }, [loading, records]);

  async function loadDocsFor(n) {
    setDocsLoading(true);
    try {
      const res = await window.storage.get(`${DOCS_KEY_PREFIX}${n}`, true);
      const data = JSON.parse(res.value);
      setDocs(Array.isArray(data) ? data : []);
    } catch (e) {
      console.warn("loadDocsFor: no se pudieron cargar los adjuntos", e);
      setDocs([]);
    }
    setDocsLoading(false);
  }

  async function saveDocsFor(n, nextDocs) {
    setDocs(nextDocs);
    try {
      await window.storage.set(`${DOCS_KEY_PREFIX}${n}`, JSON.stringify(nextDocs), true);
    } catch (e) {
      console.error("no se pudo guardar archivos", e);
    }
  }

  function openDetalle(n) {
    setDetalle(n);
    setEditing(false);
    setConfirmDelete(false);
    loadDocsFor(n);
  }
  async function closeDetalle() {
    if (editing) await autoSaveEdit();
    setDetalle(null);
    setEditing(false);
    setDocs([]);
    setConfirmDelete(false);
  }

  const currentRecord = useMemo(() => (records || []).find((r) => r.n === detalle) || null, [records, detalle]);
  const currentLinkedFinance = useMemo(() => {
    if (!currentRecord) return { gastos: [], viaticos: [], gastoReal: 0, viaticoReal: 0, costoReal: 0, utilidadReal: null, margenReal: null, pendienteCobro: 0 };
    const oc = String(currentRecord.oc ?? "").trim();
    const gastosDirectos = (gastosData || [])
      .filter(g => normEstado(g.tipo) === "EGRESO" && parseOcList(g.oc).some(x => x.toLocaleLowerCase() === oc.toLocaleLowerCase()))
      .map(g => {
        const lista = parseOcList(g.oc);
        const multi = lista.length > 1;
        return { ...g, _montoProrrateado: multi ? montoGasto(g) / lista.length : montoGasto(g), _prorrateado: multi, _ocsDelMes: lista.length };
      });

    // Gastos sin OC asignada: se prorratean entre todas las OC emitidas el mismo mes de emisión
    const ocEmisionYM = String(currentRecord.emision || "").slice(0, 7);
    const gastosProrrateados = [];
    if (ocEmisionYM) {
      const ocsDelMes = (records || []).filter(r => String(r.emision || "").slice(0, 7) === ocEmisionYM && String(r.oc ?? "").trim()).length;
      if (ocsDelMes > 0) {
        (gastosData || [])
          .filter(g => normEstado(g.tipo) === "EGRESO" && parseOcList(g.oc).length === 0 && String(g.fecha || "").slice(0, 7) === ocEmisionYM)
          .forEach(g => {
            gastosProrrateados.push({ ...g, _montoProrrateado: montoGasto(g) / ocsDelMes, _prorrateado: true, _ocsDelMes: ocsDelMes });
          });
      }
    }

    const gastos = [...gastosDirectos, ...gastosProrrateados];
    const gastoReal = gastosDirectos.reduce((s, g) => s + g._montoProrrateado, 0) + gastosProrrateados.reduce((s, g) => s + g._montoProrrateado, 0);
    const viaticos = (viaticosData || []).filter(v => String(v.oc ?? "").trim() === oc);
    const viaticoReal = viaticos.reduce((s,v) => s + (Number(v.monto) || 0), 0);
    const costoReal = gastoReal + viaticoReal;
    const venta = Number(currentRecord.total) || 0;
    const utilidadReal = venta ? venta - costoReal : null;
    const margenReal = venta > 0 ? utilidadReal / venta : 0;
    const facturado = Number(currentRecord.totalFacturado) || 0;
    const pagado = normEstado(currentRecord.medioPago) === "PAGADO" || !!currentRecord.fechaPago ? facturado : 0;
    return { gastos, viaticos, gastoReal, viaticoReal, costoReal, utilidadReal, margenReal, pendienteCobro: Math.max(0, facturado - pagado) };
  }, [currentRecord, gastosData, viaticosData, records]);

  const currentOC360 = useMemo(() => {
    if (!currentRecord) return { personal: [], tareas: [], asistencia: [], progreso: 0, proveedor: "", total: 0, facturado: 0, cobrado: 0, pendienteCobro: 0, costoReal: 0, utilidadReal: null, margenReal: null, documentos: docs.length };
    const oc = String(currentRecord.oc ?? "").trim();
    const personal = String(currentRecord.personalAsignado || "").split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
    const names = personal.length ? personal : (currentRecord.responsable ? [String(currentRecord.responsable).trim()] : []);
    const tareas = (torreTasks || []).filter(t => {
      const toc = String(t.oc ?? t.ordenCompra ?? t.orden_compra ?? "").trim();
      return toc && oc && toc === oc;
    });
    const asistencia = (asistenciaData || []).filter(a => names.some(n => normalizePersonKey(n) === normalizePersonKey(a.trabajador)));
    const facturado = Number(currentRecord.totalFacturado ?? currentRecord.total ?? 0) || 0;
    const cobrado = (normEstado(currentRecord.medioPago) === "PAGADO" || currentRecord.fechaPago) ? facturado : 0;
    const pendienteCobro = Math.max(0, facturado - cobrado);
    const venta = Number(currentRecord.total) || 0;
    const costoReal = currentLinkedFinance.costoReal || 0;
    const utilidadReal = venta ? venta - costoReal : null;
    const margenReal = venta > 0 ? utilidadReal / venta : 0;
    return {
      personal: names, tareas, asistencia,
      progreso: Math.max(0, Math.min(100, Number(currentRecord.avance) || 0)),
      proveedor: currentRecord.proveedor || "", total: venta, facturado, cobrado, pendienteCobro,
      costoReal, utilidadReal, margenReal, documentos: docs.length,
    };
  }, [currentRecord, torreTasks, asistenciaData, docs, currentLinkedFinance]);

  function startEdit() {
    if (!puedeEditar) return;
    if (!currentRecord) return;
    setDraftEdit(computeAutoEstados({ ...currentRecord }));
    setEditing(true);
  }
  async function cancelEdit() {
    await autoSaveEdit();
    setEditing(false);
    setDraftEdit(null);
  }
  async function persistEditTrabajo(draftToSave) {
    const stamped = computeAutoEstados({ ...draftToSave, n: detalle, _updatedAt: Date.now() });
    const original = recordsRef.current.find((r) => r.n === detalle);
    const labels = Object.fromEntries(FIELD_DEFS.map((f) => [f.key, f.label]));
    await intentarGuardarConAprobacion({
      puedeAprobar, modulo: "trabajos", moduloLabel: "Trabajos",
      storageKey: STORAGE_KEY_RECORDS, idField: "n", recordId: detalle,
      original, propuesto: stamped, autor: me, labels,
      historialEntry: { n: detalle, oc: stamped.oc, action: "editado" },
      pedirSustento: sustentoGate.solicitar,
      persistDirecto: (intent) => {
        persistRecords((current) => current.map((r) => (r.n === detalle ? stamped : r)), intent);
        pushHistory({ n: detalle, oc: stamped.oc, action: "editado" });
      },
    });
  }
  // Autoguardado: guarda lo editado si el usuario cambia de pestaña, oculta la
  // ventana o cierra el detalle sin apretar "Guardar".
  const autoSaveEdit = useAutoSaveOnLeave({
    active: editing && puedeEditar,
    draft: draftEdit,
    saveFn: persistEditTrabajo,
  });
  function saveEdit() {
    if (!puedeEditar) return;
    if (!draftEdit) return;
    persistEditTrabajo(draftEdit);
    setEditing(false);
  }
  async function deleteCurrentRecord() {
    if (!puedeEliminar) return;
    const id = detalle;
    const removed = recordsRef.current.find((r) => r.n === id);
    await intentarEliminarConAprobacion({
      puedeAprobar, modulo: "trabajos", moduloLabel: "Trabajos",
      storageKey: STORAGE_KEY_RECORDS, idField: "n", recordId: id, autor: me,
      resumen: removed ? `OC ${removed.oc || id} — ${removed.proveedor || ""}` : `registro ${id}`,
      docsKeyToClear: `${DOCS_KEY_PREFIX}${id}`,
      historialEntry: { n: id, oc: removed?.oc, action: "eliminado" },
      pedirSustento: sustentoGate.solicitar,
      persistDirecto: async (intent) => {
        await persistRecords((current) => current.filter((r) => r.n !== id), intent);
        try { await window.storage.set(`${DOCS_KEY_PREFIX}${id}`, JSON.stringify([]), true); } catch (_) { console.error(_); }
        pushHistory({ n: id, oc: removed?.oc, action: "eliminado" });
      },
    });
    closeDetalle();
  }

  async function onFilesSelected(fileList) {
    if (!puedeEditar) return;
    if (!detalle) return;
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(true);
    const accepted = [];
    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) {
        alert(`"${f.name}" supera 4MB y no se subio.`);
        continue;
      }
      try {
        const dataUrl = await fileToDataURL(f);
        const driveFileId = await subirFotoADrive(dataUrl, f.name);
        accepted.push({ id: uid(), name: f.name, type: f.type, size: f.size, driveFileId, uploadedAt: Date.now() });
      } catch (e) {
        console.error("error subiendo archivo", e);
        alert(`No se pudo subir "${f.name}". Revisa tu conexión e inténtalo de nuevo.`);
      }
    }
    if (accepted.length) {
      const next = [...docs, ...accepted];
      await saveDocsFor(detalle, next);
    }
    setUploading(false);
  }
  function removeAttachment(id) {
    if (!puedeEditar) return;
    const doc = docs.find((d) => d.id === id);
    if (doc && doc.driveFileId) eliminarFotoDrive(doc.driveFileId);
    const next = docs.filter((d) => d.id !== id);
    saveDocsFor(detalle, next);
  }

  function openAdd() {
    if (!puedeAgregar) return;
    setDraftAdd(emptyDraft());
    setShowAdd(true);
  }
  async function submitAdd() {
    if (!puedeAgregar) return;
    if (!draftAdd.descripcion?.trim() && !draftAdd.oc?.toString().trim()) {
      alert("Ingresa al menos la descripcion o el N° de OC");
      return;
    }
    let insertedN = null;
    let insertedRecord = null;
    const applied = await persistRecords((cur) => {
      const nextN = cur.length ? Math.max(...cur.map((r) => r.n)) + 1 : 1;
      const newRecord = computeAutoEstados({ n: nextN, ...draftAdd, _updatedAt: Date.now() });
      insertedN = nextN;
      insertedRecord = newRecord;
      return [...cur, newRecord];
    }, "crear");
    if (!applied)
      return;
    pushHistory({ n: insertedN, oc: insertedRecord.oc, action: "creado" });
    setShowAdd(false);
    setDraftAdd(emptyDraft());
    openDetalle(insertedN);
  }

  const contactos = useMemo(() => [...new Set((records || []).map((d) => d.contacto).filter(Boolean))].sort(), [records]);
  const ubicaciones = useMemo(() => [...new Set((records || []).map((d) => d.ubicacion).filter(Boolean))].sort(), [records]);
  const estadosFactura = useMemo(() => [...new Set((records || []).map((d) => d.estadoFactura).filter(Boolean))].sort(), [records]);
  const mediosPago = useMemo(() => [...new Set((records || []).map((d) => d.medioPago).filter(Boolean))].sort(), [records]);
  const estadosAC = useMemo(() => [...new Set((records || []).map((d) => d.estadoAC).filter(Boolean))].sort(), [records]);
  const estadosInforme = useMemo(() => [...new Set((records || []).map((d) => d.estadoInforme).filter(Boolean))].sort(), [records]);

  const filtersActive = Boolean(search.trim() || fContacto.length || fUbicacion.length || fEstadoFactura.length || fMedioPago.length || fEstadoAC.length || fEstadoInforme.length || kpiFilter);
  function resetFilters() {
    setSearch(""); setFContacto([]); setFUbicacion([]); setFEstadoFactura([]); setFMedioPago([]); setFEstadoAC([]); setFEstadoInforme([]);
    setKpiFilter(null);
  }
  function wrapFilterChange(setter) {
    return (v) => { setKpiFilter(null); setter(v); };
  }

  function showFacturasPendientes() {
    setKpiFilter((v) => v === "facturasPendientes" ? null : "facturasPendientes");
  }

  function showActasPendientes() {
    setKpiFilter((v) => v === "actasPendientes" ? null : "actasPendientes");
  }

  function showInformesPendientes() {
    setKpiFilter((v) => v === "informesPendientes" ? null : "informesPendientes");
  }

  function showPendienteCobro() {
    setKpiFilter((v) => v === "pendienteCobro" ? null : "pendienteCobro");
  }

  const baseFiltered = useMemo(() => {
    const q = normalizeText(search);
    const scoped = puedeVerTodos ? (records || []) : filterOwnRecords(records || [], ownerIdentity, "responsable");
    return scoped.filter((d) => {
      if (fContacto.length && !fContacto.some((v) => normEstado(v) === normEstado(d.contacto))) return false;
      if (fUbicacion.length && !fUbicacion.some((v) => normEstado(v) === normEstado(d.ubicacion))) return false;
      if (fEstadoFactura.length && !fEstadoFactura.some((v) => normEstado(v) === normEstado(d.estadoFactura))) return false;
      if (fMedioPago.length && !fMedioPago.some((v) => normEstado(v) === normEstado(d.medioPago))) return false;
      if (fEstadoAC.length && !fEstadoAC.some((v) => normEstado(v) === normEstado(d.estadoAC))) return false;
      if (fEstadoInforme.length && !fEstadoInforme.some((v) => normEstado(v) === normEstado(d.estadoInforme))) return false;
      if (q) {
        const hay = normalizeText(`${d.oc ?? ""} ${d.cliente ?? ""} ${d.proyecto ?? ""} ${d.responsable ?? ""} ${d.contacto ?? ""} ${d.ubicacion ?? ""} ${d.descripcion ?? ""} ${d.observacion ?? ""} ${d.nInforme ?? ""} ${d.nFactura ?? ""}`);
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [records, search, fContacto, fUbicacion, fEstadoFactura, fMedioPago, fEstadoAC, fEstadoInforme, puedeVerTodos, ownerIdentity]);

  const filtered = useMemo(() => {
    if (!kpiFilter) return baseFiltered;
    const predicate = {
      pendienteCobro: (d) => normEstado(d.medioPago) === "PENDIENTE",
      informesPendientes: (d) => normEstado(d.estadoInforme) !== "LISTO",
      actasPendientes: (d) => normEstado(d.estadoAC) !== "LISTO",
      facturasPendientes: (d) => normEstado(d.estadoFactura) === "PENDIENTE",
      urgentes: (d) => isUrgente(d),
    }[kpiFilter];
    return predicate ? baseFiltered.filter(predicate) : baseFiltered;
  }, [baseFiltered, kpiFilter]);

  const sorted = useMemo(() => {
    if (sortKey === "__manual") return filtered;
    const arr = [...filtered];
    arr.sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (av === null || av === undefined) av = "";
      if (bv === null || bv === undefined) bv = "";
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av < bv) return -1 * sortDir;
      if (av > bv) return 1 * sortDir;
      return 0;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => -d);
    else { setSortKey(key); setSortDir(1); }
  }

  function handleManualReorder(fromIdx, toIdx) {
    const next = reorderWithinFull(recordsRef.current, sorted, fromIdx, toIdx, "n");
    setSortKey("__manual");
    persistRecords(next);
  }
  const rowDrag = useRowDrag({ enabled: !!isAdmin, idKey: "n", onReorder: handleManualReorder });

  const kpis = useMemo(() => {
    const data = baseFiltered;
    const total = data.length;
    const totalFacturado = data.reduce((s, d) => s + (Number(d.total) || 0), 0);
    const pendienteCobro = data.filter((d) => normEstado(d.medioPago) === "PENDIENTE").reduce((s, d) => s + (Number(d.total) || 0), 0);
    const facturasPendientes = data.filter((d) => normEstado(d.estadoFactura) === "PENDIENTE").length;
    const informesPendientes = data.filter((d) => normEstado(d.estadoInforme) !== "LISTO").length;
    const actasPendientes = data.filter((d) => normEstado(d.estadoAC) !== "LISTO").length;
    const urgentes = data.filter(isUrgente).length;
    const costoTotal = data.reduce((s, d) => {
      const c = Number.isFinite(Number(d.costoTotal)) ? Number(d.costoTotal) : (Number.isFinite(Number(d.rentabilidad)) ? (Number(d.total || 0) - Number(d.rentabilidad)) : 0);
      return s + Math.max(0, c);
    }, 0);
    const utilidad = data.reduce((s, d) => {
      const u = Number.isFinite(Number(d.rentabilidadCalculada)) ? Number(d.rentabilidadCalculada) : (Number.isFinite(Number(d.rentabilidad)) ? Number(d.rentabilidad) : 0);
      return s + u;
    }, 0);
    const margen = totalFacturado > 0 ? utilidad / totalFacturado : null;
    const avancePromedio = data.length ? data.reduce((s,d)=>s+(Number(d.avance)||0),0)/data.length : 0;
    return { total, totalFacturado, pendienteCobro, facturasPendientes, informesPendientes, actasPendientes, urgentes, costoTotal, utilidad, margen, avancePromedio };
  }, [baseFiltered]);

  function showUrgentes() {
    setKpiFilter((v) => v === "urgentes" ? null : "urgentes");
  }

  const chartData = useMemo(() => ({
    porMes: groupByMonth(sorted),
    porContacto: groupByField(sorted, "contacto").slice(0, 8),
    porUbicacion: groupByField(sorted, "ubicacion").slice(0, 8),
  }), [sorted]);

  function sheetsControlTrabajos() {
    const headers = ["N°", "N° OC", "Contacto", "Emision", "Ubicacion", "Descripcion", "Subtotal", "IGV", "Total", "N Informe", "Estado Informe", "N AC", "Estado AC", "N Factura", "Estado Factura", "Fecha Pago", "Medio Pago"];
    return [{ name: "Control de Trabajos", records: sorted, headers, rowMapper: (d) => [d.n, d.oc, d.contacto, d.emision, d.ubicacion, d.descripcion, d.subtotal, d.igv, d.total, d.nInforme, d.estadoInforme, d.nAC, d.estadoAC, d.nFactura, d.estadoFactura, d.fechaPago, d.medioPago] }];
  }
  async function exportXlsx() {
    setExportingXlsx(true);
    try {
      await downloadXlsxWorkbook(sheetsControlTrabajos(), "control-de-trabajos");
    } catch (e) {
      console.error("exportXlsx error", e);
      alert("Ocurrió un error al generar la descarga. Intenta nuevamente.");
    } finally {
      setExportingXlsx(false);
    }
  }
  const carpetaLocal = useCarpetaLocal("trabajos");
  useEffect(() => {
    if (!records) return;
    carpetaLocal.programarGuardado(nombreArchivoAnual("operaciones-control-de-trabajos"), sheetsControlTrabajos);
  }, [records]);

  if (loading || !records) {
    return (
      <div style={{ minHeight: 300, display: "flex", alignItems: "center", justifyContent: "center", background: COLORS.bg, borderRadius: 12, color: COLORS.dim, fontFamily: "'Inter',sans-serif", fontSize: 13 }}>
        Conectando con la base de datos compartida…
      </div>
    );
  }

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
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 600 }}>CONTROL DE TRABAJOS · OC</div>
            <div style={{ fontSize: 11, color: COLORS.dim, display: "flex", alignItems: "center", gap: 4 }}>
              Base de datos compartida en vivo
              <SyncDot syncState={syncState} palette={COLORS} />
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setShowHistory(true)} style={{ display: "flex", alignItems: "center", gap: 6, background: COLORS.panel2, color: COLORS.text, fontSize: 12, padding: "7px 12px", borderRadius: 7, border: `1px solid ${COLORS.border}`, cursor: "pointer" }}>
            🕘 Historial
          </button>
          <button
            onClick={() => setReadOnlyMode((v) => !v)}
            title={readOnlyMode ? "Modo lectura activo: la edicion esta bloqueada" : "Modo edicion activo"}
            style={{ display: "flex", alignItems: "center", gap: 6, background: readOnlyMode ? COLORS.redDim : COLORS.panel2, color: readOnlyMode ? COLORS.redSoft : COLORS.text, fontSize: 12, padding: "7px 12px", borderRadius: 7, border: `1px solid ${readOnlyMode ? COLORS.red : COLORS.border}`, cursor: "pointer" }}
          >
            {readOnlyMode ? "🔒 Modo lectura" : "🔓 Modo edicion"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 14 }}>
        <Kpi label={kpiLabels.montoTotalOC} value={fmtMoney(kpis.totalFacturado)} icon="S/" tone="green" onLabelChange={readOnlyMode ? undefined : (v) => persistKpiLabel("montoTotalOC", v)} />
        <Kpi label={kpiLabels.pendienteCobro} value={fmtMoney(kpis.pendienteCobro)} icon="!" tone={kpis.pendienteCobro > 0 ? "red" : "green"} onClick={kpis.pendienteCobro > 0 ? showPendienteCobro : undefined} active={kpiFilter === "pendienteCobro"} onLabelChange={readOnlyMode ? undefined : (v) => persistKpiLabel("pendienteCobro", v)} />
        <Kpi label={kpiLabels.informesPendientes} value={kpis.informesPendientes} icon="○" tone={kpis.informesPendientes ? "amber" : "green"} onClick={kpis.informesPendientes ? showInformesPendientes : undefined} active={kpiFilter === "informesPendientes"} onLabelChange={readOnlyMode ? undefined : (v) => persistKpiLabel("informesPendientes", v)} />
        <Kpi label={kpiLabels.actasPendientes} value={kpis.actasPendientes} icon="□" tone={kpis.actasPendientes ? "amber" : "green"} onClick={kpis.actasPendientes ? showActasPendientes : undefined} active={kpiFilter === "actasPendientes"} onLabelChange={readOnlyMode ? undefined : (v) => persistKpiLabel("actasPendientes", v)} />
        <Kpi label={kpiLabels.facturasPendientes} value={kpis.facturasPendientes} icon="●" tone={kpis.facturasPendientes ? "amber" : "green"} onClick={kpis.facturasPendientes ? showFacturasPendientes : undefined} active={kpiFilter === "facturasPendientes"} onLabelChange={readOnlyMode ? undefined : (v) => persistKpiLabel("facturasPendientes", v)} />
        <Kpi label={kpiLabels.totalOC} value={kpis.total} icon="◆" onLabelChange={readOnlyMode ? undefined : (v) => persistKpiLabel("totalOC", v)} />
        <Kpi label="Costo acumulado" value={fmtMoney(kpis.costoTotal)} icon="↘" tone="amber" />
        <Kpi label="Utilidad estimada" value={fmtMoney(kpis.utilidad)} icon="↗" tone={kpis.utilidad >= 0 ? "green" : "red"} />
        <Kpi label="Margen estimado" value={kpis.margen === null ? "—" : fmtPct(kpis.margen)} icon="%" tone={kpis.margen !== null && kpis.margen >= .3 ? "green" : "amber"} />
        <Kpi label="Avance promedio" value={`${kpis.avancePromedio.toFixed(0)}%`} icon="▰" tone={kpis.avancePromedio >= 80 ? "green" : "amber"} />
        <Kpi label={`Vencidas (+${DIAS_URGENTE}d)`} value={kpis.urgentes} icon="⚠" tone={kpis.urgentes ? "red" : "green"} onClick={kpis.urgentes ? showUrgentes : undefined} active={kpiFilter === "urgentes"} />
      </div>

      <FilterBar>
        <input
          className="ct-input2"
          value={search}
          onChange={(e) => wrapFilterChange(setSearch)(e.target.value)}
          placeholder="Buscar OC, contacto, descripcion…"
          style={{ width: isMobile ? "100%" : 230 }}
        />
        <MultiSelect label="Contacto" allLabel="Contacto: Todos" options={contactos} selected={fContacto} onChange={wrapFilterChange(setFContacto)} />
        <MultiSelect label="Ubicacion" allLabel="Ubicacion: Todas" options={ubicaciones} selected={fUbicacion} onChange={wrapFilterChange(setFUbicacion)} />
        <MultiSelect label="Estado factura" allLabel="Factura: Todos" options={estadosFactura} selected={fEstadoFactura} onChange={wrapFilterChange(setFEstadoFactura)} />
        <MultiSelect label="Medio de pago" allLabel="Pago: Todos" options={mediosPago} selected={fMedioPago} onChange={wrapFilterChange(setFMedioPago)} />
        <MultiSelect label="Actas" allLabel="Actas: Todos" options={estadosAC} selected={fEstadoAC} onChange={wrapFilterChange(setFEstadoAC)} />
        <MultiSelect label="Informes" allLabel="Informes: Todos" options={estadosInforme} selected={fEstadoInforme} onChange={wrapFilterChange(setFEstadoInforme)} />
        {filtersActive ? (
          <ClearFiltersButton onClick={resetFilters} />
        ) : (
          <div style={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 20, padding: "6px 12px", fontSize: 11.5, color: COLORS.dim }}>
            <b style={{ color: COLORS.amber }}>{sorted.length}</b> de {records.length} OC
          </div>
        )}
        <div style={{ marginLeft: isMobile ? 0 : "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div className="wc-nav-scroll" style={{ display: "flex", background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 7, overflowX: "auto", overflowY: "hidden", maxWidth: "100%" }}>
            <button onClick={() => setView("tabla")} style={{ padding: "7px 12px", fontSize: 12, border: "none", cursor: "pointer", background: view === "tabla" ? COLORS.amber : "transparent", color: view === "tabla" ? COLORS.amberText : COLORS.dim, fontWeight: view === "tabla" ? 600 : 400 }}>Tabla</button>
            <button onClick={() => setView("tarjetas")} style={{ padding: "7px 12px", fontSize: 12, border: "none", cursor: "pointer", background: view === "tarjetas" ? COLORS.amber : "transparent", color: view === "tarjetas" ? COLORS.amberText : COLORS.dim, fontWeight: view === "tarjetas" ? 600 : 400 }}>Tarjetas</button>
            <button onClick={() => setView("graficos")} style={{ padding: "7px 12px", fontSize: 12, border: "none", cursor: "pointer", background: view === "graficos" ? COLORS.amber : "transparent", color: view === "graficos" ? COLORS.amberText : COLORS.dim, fontWeight: view === "graficos" ? 600 : 400 }}>Graficos</button>
          </div>
          {puedeExportar && (
            <button
              onClick={exportXlsx}
              disabled={exportingXlsx}
              title="Descarga en un archivo Excel la información de esta página"
              style={{ display: "flex", alignItems: "center", gap: 6, background: COLORS.amber, color: COLORS.amberText, fontWeight: 600, border: "none", padding: "7px 12px", borderRadius: 7, fontSize: 12, cursor: exportingXlsx ? "not-allowed" : "pointer", opacity: exportingXlsx ? 0.6 : 1 }}
            >
              {exportingXlsx ? "Generando…" : "⬇ Descargar"}
            </button>
          )}
          {puedeExportar && <BotonCarpetaLocal carpeta={carpetaLocal} />}
        </div>
      </FilterBar>

      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "16px 18px", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600 }}>Ordenes de compra ({sorted.length})</h2>
          {!readOnlyMode && (
            <button onClick={openAdd} style={{ display: puedeAgregar ? "flex" : "none", alignItems: "center", gap: 6, background: COLORS.amber, color: COLORS.amberText, fontWeight: 600, fontSize: 12.5, padding: "8px 14px", borderRadius: 7, border: "none", cursor: "pointer" }}>
              + Nueva OC
            </button>
          )}
        </div>

        {view === "tabla" ? (
          <div className="ct-scroll" style={{ overflowX: "auto", maxHeight: 560, overflowY: "auto", borderRadius: 8, border: `1px solid ${COLORS.border}` }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 1180 }}>
              <thead>
                <tr>
                  <th className="ct-th" style={{ width: 40 }} onClick={() => toggleSort("n")}>#</th>
                  <th className="ct-th" onClick={() => toggleSort("oc")}>N° OC</th>
                  <th className="ct-th" onClick={() => toggleSort("contacto")}>Contacto</th>
                  <th className="ct-th" onClick={() => toggleSort("emision")}>Emision</th>
                  <th className="ct-th" onClick={() => toggleSort("ubicacion")}>Ubicacion</th>
                  <th className="ct-th" style={{ minWidth: 240 }} onClick={() => toggleSort("descripcion")}>Descripcion</th>
                  <th className="ct-th" onClick={() => toggleSort("total")}>Total</th>
                  <th className="ct-th" onClick={() => toggleSort("estadoInforme")}>Informe</th>
                  <th className="ct-th" onClick={() => toggleSort("estadoAC")}>AC</th>
                  <th className="ct-th" onClick={() => toggleSort("estadoFactura")}>Factura</th>
                  <th className="ct-th" onClick={() => toggleSort("medioPago")}>Pago</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((d, idx) => {
                  const urgente = isUrgente(d);
                  const dh = rowDrag.getHandlers(idx, d);
                  const isOver = rowDrag.dragOverId === d.n;
                  return (
                    <tr key={d.n} className="ct-row" onClick={() => openDetalle(d.n)} {...dh} style={{ ...(urgente ? { boxShadow: `inset 3px 0 0 ${COLORS.red}` } : {}), ...(isOver ? { boxShadow: `inset 0 2px 0 ${COLORS.amber}` } : {}), ...(isAdmin ? { cursor: "grab" } : {}) }}>
                      <td className="ct-td" style={{ color: COLORS.faint, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, display: "flex", alignItems: "center", gap: 2 }}>
                        <DragHandle show={isAdmin} isMobile={isMobile} color={COLORS.faint} dragProps={rowDrag.getHandleProps(idx)} dragging={rowDrag.armedIndex === idx} canMoveUp={idx > 0} canMoveDown={idx < sorted.length - 1} onMoveUp={() => rowDrag.moveBy(idx, -1, sorted.length)} onMoveDown={() => rowDrag.moveBy(idx, 1, sorted.length)} />
                        {d.n}
                      </td>
                      <td className="ct-td" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>{d.oc}</td>
                      <td className="ct-td">
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ width: 18, height: 18, borderRadius: 50, background: colorForContacto(d.contacto, contactos), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8.5, fontWeight: 700, color: COLORS.dark, flexShrink: 0 }}>{initials(d.contacto)}</div>
                          {d.contacto || "—"}
                        </div>
                      </td>
                      <td className="ct-td">{fmtDate(d.emision)}</td>
                      <td className="ct-td" style={{ color: COLORS.dim }}>{d.ubicacion}</td>
                      <td className="ct-td">{d.descripcion}</td>
                      <td className="ct-td" style={{ fontFamily: "'JetBrains Mono',monospace" }}>{fmtMoney(d.total)}</td>
                      <td className="ct-td"><Badge text={d.estadoInforme} colors={docEstadoColor(d.estadoInforme)} /></td>
                      <td className="ct-td"><Badge text={d.estadoAC} colors={docEstadoColor(d.estadoAC)} /></td>
                      <td className="ct-td"><Badge text={d.estadoFactura} colors={estadoFacturaColor(d.estadoFactura)} /></td>
                      <td className="ct-td">
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <Badge text={d.medioPago} colors={medioPagoColor(d.medioPago)} />
                          {urgente && <span title={`Pendiente hace mas de ${DIAS_URGENTE} dias`} style={{ fontSize: 11, color: COLORS.red }}>⚠</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {sorted.length === 0 && (
                  <tr><td className="ct-td" colSpan={11} style={{ textAlign: "center", color: COLORS.faint, padding: 24 }}>No hay resultados con estos filtros</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ) : view === "tarjetas" ? (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill,minmax(300px,1fr))", gap: 12 }}>
            {sorted.map((d, idx) => {
              const urgente = isUrgente(d);
              const dh = rowDrag.getHandlers(idx, d);
              const isOver = rowDrag.dragOverId === d.n;
              return (
                <div key={d.n} className="ct-card" onClick={() => openDetalle(d.n)} {...dh} style={{ ...(urgente ? { borderColor: COLORS.red } : {}), ...(isOver ? { boxShadow: `inset 0 0 0 2px ${COLORS.amber}` } : {}), ...(isAdmin ? { cursor: "grab" } : {}) }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 4 }}>
                      <DragHandle show={isAdmin} isMobile={isMobile} color={COLORS.faint} dragProps={rowDrag.getHandleProps(idx)} dragging={rowDrag.armedIndex === idx} canMoveUp={idx > 0} canMoveDown={idx < sorted.length - 1} onMoveUp={() => rowDrag.moveBy(idx, -1, sorted.length)} onMoveDown={() => rowDrag.moveBy(idx, 1, sorted.length)} />
                      <div>
                        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: COLORS.faint }}>OC {d.oc}</div>
                        <div style={{ fontSize: 11, color: COLORS.dim }}>{d.ubicacion}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {urgente && <span title={`Pendiente hace mas de ${DIAS_URGENTE} dias`} style={{ fontSize: 12, color: COLORS.red }}>⚠</span>}
                      <Badge text={d.estadoFactura} colors={estadoFacturaColor(d.estadoFactura)} />
                    </div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3 }}>{d.descripcion}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 18, height: 18, borderRadius: 50, background: colorForContacto(d.contacto, contactos), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8.5, fontWeight: 700, color: COLORS.dark, flexShrink: 0 }}>{initials(d.contacto)}</div>
                    <span style={{ fontSize: 12 }}>{d.contacto || "—"}</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: COLORS.faint }}>{fmtDate(d.emision)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${COLORS.border}`, paddingTop: 8 }}>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 600 }}>{fmtMoney(d.total)}</span>
                  </div>
                </div>
              );
            })}
            {sorted.length === 0 && (
              <div style={{ gridColumn: "1/-1", textAlign: "center", color: COLORS.faint, padding: 24 }}>No hay resultados con estos filtros</div>
            )}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2,1fr)", gap: 12 }}>
            <ChartPanel title="Monto facturado por mes">
              <MiniBarChart data={chartData.porMes} valueKey="monto" formatValue={fmtMoney} barColor={COLORS.green} />
            </ChartPanel>
            <ChartPanel title="OC emitidas por mes">
              <MiniBarChart data={chartData.porMes} valueKey="count" formatValue={(v) => `${v} OC`} barColor={COLORS.amber} />
            </ChartPanel>
            <ChartPanel title="Monto facturado por contacto">
              <MiniBarChart data={chartData.porContacto} valueKey="monto" formatValue={fmtMoney} barColor={COLORS.purple} />
            </ChartPanel>
            <ChartPanel title="Monto facturado por ubicacion">
              <MiniBarChart data={chartData.porUbicacion} valueKey="monto" formatValue={fmtMoney} barColor={COLORS.blue} />
            </ChartPanel>
            {chartData.porMes.length === 0 && (
              <div style={{ gridColumn: "1/-1", textAlign: "center", color: COLORS.faint, padding: 24 }}>No hay datos suficientes con estos filtros</div>
            )}
          </div>
        )}
      </div>

      {detalle && currentRecord && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }} onClick={closeDetalle}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 22, width: 1080, maxWidth: "100%", maxHeight: "92vh", overflowY: "auto", boxSizing: "border-box" }} className="ct-scroll" onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <div>
                <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: 15 }}>OC {currentRecord.oc} · Ficha 360°</div>
                <div style={{ fontSize: 11.5, color: COLORS.dim, marginTop: 2 }}>{currentRecord.ubicacion} · {fmtDate(currentRecord.emision)}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {!editing && !readOnlyMode && puedeEditar && (
                  <button onClick={startEdit} style={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}`, color: COLORS.text, padding: "6px 12px", borderRadius: 7, fontSize: 12, cursor: "pointer" }}>
                    ✎ Editar
                  </button>
                )}
                <button onClick={closeDetalle} style={{ background: "transparent", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 16 }}>✕</button>
              </div>
            </div>
            {readOnlyMode && (
              <div style={{ fontSize: 11, color: COLORS.faint, marginBottom: 10 }}>🔒 Modo lectura activo — la edicion esta bloqueada</div>
            )}

            {editing ? (
              <>
                <EditForm value={draftEdit} onChange={setDraftEdit} ocOptions={buildOcOptions(records)} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 14, borderTop: `1px solid ${COLORS.border}` }}>
                  {!puedeEliminar ? <div /> : confirmDelete ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11.5, color: COLORS.red }}>¿Eliminar esta OC definitivamente?</span>
                      <button onClick={deleteCurrentRecord} style={{ background: COLORS.red, color: COLORS.white, border: "none", padding: "6px 12px", borderRadius: 7, fontSize: 12, cursor: "pointer" }}>Confirmar</button>
                      <button onClick={() => setConfirmDelete(false)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, padding: "6px 12px", borderRadius: 7, fontSize: 12, cursor: "pointer" }}>Cancelar</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDelete(true)} style={{ background: "transparent", border: `1px solid ${COLORS.redDim}`, color: COLORS.red, padding: "7px 14px", borderRadius: 7, fontSize: 12, cursor: "pointer" }}>
                      Eliminar OC
                    </button>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={cancelEdit} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, padding: "8px 16px", borderRadius: 7, fontSize: 12.5, cursor: "pointer" }}>Cancelar</button>
                    <button onClick={saveEdit} style={{ background: COLORS.amber, color: COLORS.amberText, border: "none", padding: "8px 16px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Guardar cambios</button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div style={{ background: `linear-gradient(135deg, ${COLORS.panel2}, ${COLORS.panel})`, border: `1px solid ${COLORS.border}`, borderRadius: 11, padding: 14, marginBottom: 14 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12, flexWrap:"wrap" }}>
                    <div>
                      <div style={{ fontSize:10, color:COLORS.amber, textTransform:"uppercase", letterSpacing:.8, fontWeight:700 }}>Ficha 360° de la OC</div>
                      <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:18, fontWeight:700, marginTop:3 }}>{currentRecord.descripcion || "Orden de compra"}</div>
                      <div style={{ fontSize:11, color:COLORS.faint, marginTop:3 }}>{currentRecord.cliente || "Sin cliente"} · {currentRecord.proyecto || "Sin proyecto"} · Proveedor: {currentOC360.proveedor || "Sin proveedor"}</div>
                    </div>
                    <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                      <Badge text={currentRecord.estadoOC || "SIN ESTADO"} colors={{ bg:COLORS.panel, fg:COLORS.text }} />
                      {isUrgente(currentRecord) && <Badge text="URGENTE" colors={{ bg:COLORS.redDim, fg:COLORS.red }} />}
                    </div>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:isMobile?"repeat(2,1fr)":"repeat(7,1fr)", gap:8, marginTop:13 }}>
                    {[
                      ["Avance", `${currentOC360.progreso}%`, COLORS.amber],
                      ["Total OC", fmtMoney(currentOC360.total), COLORS.text],
                      ["Facturado", fmtMoney(currentOC360.facturado), COLORS.blue],
                      ["Costo real", fmtMoney(currentOC360.costoReal), COLORS.red],
                      ["Utilidad", fmtMoney(currentOC360.utilidadReal), currentOC360.utilidadReal >= 0 ? COLORS.green : COLORS.red],
                      ["Margen", fmtPct(currentOC360.margenReal), currentOC360.margenReal >= .3 ? COLORS.green : COLORS.amber],
                      ["Cobranza", fmtMoney(currentOC360.pendienteCobro), currentOC360.pendienteCobro > 0 ? COLORS.amber : COLORS.green],
                    ].map(([label,value,tone]) => (
                      <div key={label} style={{ background:COLORS.panel, border:`1px solid ${COLORS.border}`, borderRadius:8, padding:"8px 9px" }}>
                        <div style={{ fontSize:9.5, color:COLORS.faint, textTransform:"uppercase", letterSpacing:.4 }}>{label}</div>
                        <div style={{ fontSize:13, fontWeight:700, color:tone, marginTop:3, fontFamily:"'JetBrains Mono',monospace" }}>{value}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop:10, height:7, background:COLORS.border, borderRadius:20, overflow:"hidden" }}>
                    <div style={{ width:`${currentOC360.progreso}%`, height:"100%", background:currentOC360.progreso >= 100 ? COLORS.green : COLORS.amber, transition:"width .2s" }} />
                  </div>
                </div>

                <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1.15fr .85fr", gap:12, marginBottom:14 }}>
                  <div style={{ background:COLORS.panel2, border:`1px solid ${COLORS.border}`, borderRadius:9, padding:12 }}>
                    <div style={{ fontSize:11, color:COLORS.faint, textTransform:"uppercase", letterSpacing:.5, marginBottom:9 }}>Operación · personal · proveedores</div>
                    <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"repeat(4,1fr)", gap:9 }}>
                      <InfoRow label="Responsable" value={currentRecord.responsable} />
                      <InfoRow label="Proveedor" value={currentOC360.proveedor} />
                      <InfoRow label="Prioridad" value={currentRecord.prioridad} />
                      <InfoRow label="Ubicación" value={currentRecord.ubicacion} />
                      <InfoRow label="Inicio" value={fmtDate(currentRecord.fechaInicio)} />
                      <InfoRow label="Entrega" value={fmtDate(currentRecord.fechaEntrega)} />
                      <InfoRow label="Personal asignado" value={currentOC360.personal.length ? currentOC360.personal.join(", ") : "No asignado"} />
                      <InfoRow label="Tareas vinculadas" value={`${currentOC360.tareas.length}`} />
                    </div>
                    <div style={{ marginTop:10, display:"flex", flexWrap:"wrap", gap:6 }}>
                      {currentOC360.personal.map(name => <span key={name} style={{ background:COLORS.amberDim, border:`1px solid ${COLORS.border}`, borderRadius:20, padding:"4px 8px", fontSize:10.5 }}>{initials(name)} · {name}</span>)}
                    </div>
                  </div>

                  <div style={{ background:COLORS.panel2, border:`1px solid ${COLORS.border}`, borderRadius:9, padding:12 }}>
                    <div style={{ fontSize:11, color:COLORS.faint, textTransform:"uppercase", letterSpacing:.5, marginBottom:9 }}>Control documental y evidencias</div>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:7 }}>
                      {[["Informe",currentRecord.estadoInforme],["Acta",currentRecord.estadoAC],["Factura",currentRecord.estadoFactura],["Fotos/docs",`${currentOC360.documentos}`],["Asistencia",`${currentOC360.asistencia.length}`],["Cobranza",currentRecord.medioPago || "PENDIENTE"]].map(([label,value]) => (
                        <div key={label} style={{ background:COLORS.panel, border:`1px solid ${COLORS.border}`, borderRadius:7, padding:"7px 8px" }}>
                          <div style={{ fontSize:9, color:COLORS.faint }}>{label}</div>
                          <div style={{ fontSize:11, marginTop:3, color:/pendiente/i.test(String(value)) ? COLORS.amber : COLORS.text }}>{value || "—"}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:12, marginBottom:14 }}>
                  <div style={{ background:COLORS.panel2, border:`1px solid ${COLORS.border}`, borderRadius:9, padding:12 }}>
                    <div style={{ fontSize:11, color:COLORS.faint, textTransform:"uppercase", letterSpacing:.5, marginBottom:9 }}>Tareas y avances</div>
                    {currentOC360.tareas.length ? currentOC360.tareas.slice(0,6).map(t => (
                      <div key={t.id || `${t.oc}-${t.tarea}`} style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:8, padding:"7px 0", borderBottom:`1px solid ${COLORS.grid}`, fontSize:11 }}>
                        <div><b>{t.tarea || t.descripcion || "Tarea"}</b><div style={{ color:COLORS.faint, marginTop:2 }}>{t.responsable || "Sin responsable"}</div></div>
                        <span style={{ color:t.hecho || /complet|hecho/i.test(String(t.estado||"")) ? COLORS.green : COLORS.amber }}>{t.estado || (t.hecho ? "COMPLETADA" : "PENDIENTE")}</span>
                      </div>
                    )) : <div style={{ color:COLORS.faint, fontSize:11.5 }}>No hay tareas vinculadas por N° de OC. Las tareas deben contener el campo OC.</div>}
                  </div>

                  <div style={{ background:COLORS.panel2, border:`1px solid ${COLORS.border}`, borderRadius:9, padding:12 }}>
                    <div style={{ fontSize:11, color:COLORS.faint, textTransform:"uppercase", letterSpacing:.5, marginBottom:9 }}>Rentabilidad y cobranza</div>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
                      <InfoRow label="Gastos reales" value={fmtMoney(currentLinkedFinance.gastoReal)} />
                      <InfoRow label="Viáticos reales" value={fmtMoney(currentLinkedFinance.viaticoReal)} />
                      <InfoRow label="Costo real" value={fmtMoney(currentOC360.costoReal)} />
                      <InfoRow label="Utilidad real" value={fmtMoney(currentOC360.utilidadReal)} />
                      <InfoRow label="Margen real" value={fmtPct(currentOC360.margenReal)} />
                      <InfoRow label="Pendiente cobro" value={fmtMoney(currentOC360.pendienteCobro)} />
                    </div>
                    <div style={{ marginTop:9, height:7, background:COLORS.border, borderRadius:20, overflow:"hidden" }}>
                      <div style={{ width:`${Math.max(0,Math.min(100,(currentOC360.margenReal || 0)*100))}%`, height:"100%", background:currentOC360.margenReal >= .3 ? COLORS.green : COLORS.amber }} />
                    </div>
                  </div>
                </div>

                <div style={{ background:COLORS.panel2, border:`1px solid ${COLORS.border}`, borderRadius:9, padding:12, marginBottom:16 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:9 }}>
                    <div style={{ fontSize:11, color:COLORS.faint, textTransform:"uppercase", letterSpacing:.5 }}>Evidencias fotográficas y documentos</div>
                    <span style={{ fontSize:10.5, color:COLORS.faint }}>{currentOC360.documentos} archivo(s)</span>
                  </div>
                  {docs.length ? (
                    <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                      {docs.slice(0,8).map(att => <AttachmentThumb key={att.id} att={att} onRemove={removeAttachment} />)}
                      {docs.length > 8 && <div style={{ alignSelf:"center", color:COLORS.faint, fontSize:11 }}>+{docs.length - 8} más</div>}
                    </div>
                  ) : <div style={{ color:COLORS.faint, fontSize:11.5 }}>Sin evidencias adjuntas. Usa “Agregar archivo” al final de la ficha.</div>}
                </div>

                <div style={{ background:COLORS.panel2, border:`1px solid ${COLORS.border}`, borderRadius:9, padding:12, marginBottom:16 }}>
                  <div style={{ fontSize:11, color:COLORS.faint, textTransform:"uppercase", letterSpacing:.5, marginBottom:9 }}>Trazabilidad de personal</div>
                  {currentOC360.asistencia.length ? (
                    <div style={{ overflowX:"auto" }}>
                      <table style={{ width:"100%", borderCollapse:"collapse", minWidth:620 }}>
                        <thead><tr>{["Trabajador","Fecha","Entrada","Salida","Ubicación","Estado","Horas"].map(h => <th key={h} style={{ textAlign:"left", padding:"6px 7px", fontSize:9.5, color:COLORS.faint, borderBottom:`1px solid ${COLORS.border}` }}>{h}</th>)}</tr></thead>
                        <tbody>{currentOC360.asistencia.slice(-8).reverse().map(a => {
                          const hrs = horasEntreHorarios(a.horaEntrada,a.horaSalida);
                          return <tr key={a.id}><td style={{padding:"6px 7px",fontSize:10.5,borderBottom:`1px solid ${COLORS.grid}`}}>{a.trabajador}</td><td style={{padding:"6px 7px",fontSize:10,borderBottom:`1px solid ${COLORS.grid}`}}>{fmtDate(a.fecha)}</td><td style={{padding:"6px 7px",fontSize:10,borderBottom:`1px solid ${COLORS.grid}`}}>{a.horaEntrada || "—"}</td><td style={{padding:"6px 7px",fontSize:10,borderBottom:`1px solid ${COLORS.grid}`}}>{a.horaSalida || "—"}</td><td style={{padding:"6px 7px",fontSize:10,borderBottom:`1px solid ${COLORS.grid}`}}>{a.ubicacion || "—"}</td><td style={{padding:"6px 7px",fontSize:10,borderBottom:`1px solid ${COLORS.grid}`}}>{a.estado || "—"}</td><td style={{padding:"6px 7px",fontSize:10,borderBottom:`1px solid ${COLORS.grid}`}}>{hrs == null ? "—" : fmtHoras(hrs)}</td></tr>;
                        })}</tbody>
                      </table>
                    </div>
                  ) : <div style={{ color:COLORS.faint, fontSize:11.5 }}>No hay registros de asistencia asociados al personal de esta OC.</div>}
                </div>

                <div style={{ background:COLORS.amberDim, border:`1px solid ${COLORS.amber}`, borderRadius:9, padding:"9px 11px", marginBottom:16, fontSize:10.5, color:COLORS.dim }}>
                  <b style={{color:COLORS.amber}}>Para completar la ficha 360°:</b> edita la OC y registra “Personal asignado” y “Proveedor”. Las tareas se vinculan automáticamente cuando contienen el mismo N° de OC.
                </div>

                <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"repeat(4,1fr)", gap:8, marginBottom:14 }}>
                  <InfoRow label="Cliente" value={currentRecord.cliente} />
                  <InfoRow label="Proyecto" value={currentRecord.proyecto} />
                  <InfoRow label="Responsable" value={currentRecord.responsable} />
                  <InfoRow label="Estado" value={currentRecord.estadoOC} />
                  <InfoRow label="Prioridad" value={currentRecord.prioridad} />
                  <InfoRow label="Avance" value={currentRecord.avance === "" || currentRecord.avance == null ? "—" : `${currentRecord.avance}%`} />
                  <InfoRow label="Inicio" value={fmtDate(currentRecord.fechaInicio)} />
                  <InfoRow label="Entrega" value={fmtDate(currentRecord.fechaEntrega)} />
                </div>
                <div style={{height:7,background:COLORS.border,borderRadius:20,overflow:'hidden',marginBottom:16}}><div style={{width:`${Math.max(0,Math.min(100,Number(currentRecord.avance)||0))}%`,height:'100%',background:(Number(currentRecord.avance)||0)>=100?COLORS.green:COLORS.amber}} /></div>
                <div style={{ fontSize: 13.5, marginBottom: 16, lineHeight: 1.5 }}>{currentRecord.descripcion}</div>

                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 16 }}>
                  <InfoRow label="Contacto" value={currentRecord.contacto} />
                  <InfoRow label="Observacion" value={currentRecord.observacion} />
                  <InfoRow label="Subtotal" value={fmtMoney(currentRecord.subtotal)} />
                  <InfoRow label="IGV" value={fmtMoney(currentRecord.igv)} />
                  <InfoRow label="Total" value={fmtMoney(currentRecord.total)} />
                </div>

                <div style={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: 12, marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: COLORS.faint, textTransform: "uppercase", letterSpacing: .5, marginBottom: 9 }}>Resumen económico</div>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(5,1fr)", gap: 8 }}>
                    <InfoRow label="Total OC" value={fmtMoney(currentRecord.total)} />
                    <InfoRow label="Facturado" value={fmtMoney(currentRecord.totalFacturado)} />
                    <InfoRow label="Costos" value={fmtMoney(currentRecord.costoTotal)} />
                    <InfoRow label="Utilidad" value={fmtMoney(currentRecord.rentabilidadCalculada ?? currentRecord.rentabilidad)} />
                    <InfoRow label="Margen" value={fmtPct(currentRecord.pctRentabilidadCalculada ?? currentRecord.pctRentabilidad)} />
                  </div>
                  <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(5,1fr)", gap: 7 }}>
                    {[['Materiales',currentRecord.costoMateriales],['Personal',currentRecord.costoPersonal],['Transporte',currentRecord.costoTransporte],['Viaticos',currentRecord.costoViaticos],['Otros',currentRecord.otrosCostos]].map(([label,val]) => <div key={label} style={{background:COLORS.panel,border:`1px solid ${COLORS.border}`,borderRadius:7,padding:'7px 8px'}}><div style={{fontSize:9,color:COLORS.faint,textTransform:'uppercase'}}>{label}</div><div style={{fontSize:11.5,marginTop:3}}>{fmtMoney(val)}</div></div>)}
                  </div>
                  <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)", gap: 8 }}>
                    <InfoRow label="Gasto real vinculado" value={fmtMoney(currentLinkedFinance.gastoReal)} />
                    <InfoRow label="Viáticos reales" value={fmtMoney(currentLinkedFinance.viaticoReal)} />
                    <InfoRow label="Costo real" value={fmtMoney(currentLinkedFinance.costoReal)} />
                    <InfoRow label="Utilidad real" value={fmtMoney(currentLinkedFinance.utilidadReal)} />
                  </div>
                  <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3,1fr)", gap: 8 }}>
                    <InfoRow label="Margen real" value={fmtPct(currentLinkedFinance.margenReal)} />
                    <InfoRow label="Cobro pendiente" value={fmtMoney(currentLinkedFinance.pendienteCobro)} />
                    <InfoRow label="Movimientos" value={`${currentLinkedFinance.gastos.length} gastos · ${currentLinkedFinance.viaticos.length} viáticos`} />
                  </div>
                  {(currentLinkedFinance.gastos.length || currentLinkedFinance.viaticos.length) > 0 && (
                    <div style={{ marginTop: 10, paddingTop: 9, borderTop: `1px solid ${COLORS.border}`, fontSize: 10.5, color: COLORS.dim }}>
                      {currentLinkedFinance.gastos.slice(0,3).map(g => <div key={g.id} style={{display:"flex",justifyContent:"space-between",gap:8,padding:"2px 0"}}><span>{g.descripcion || "Gasto"}{g._prorrateado ? (String(g.oc ?? "").trim() ? ` (${g._ocsDelMes} OC · prorrateado)` : ` (sin OC · prorrateado ÷${g._ocsDelMes})`) : ""}</span><b>{fmtMoney(g._montoProrrateado ?? montoGasto(g))}</b></div>)}
                      {currentLinkedFinance.viaticos.slice(0,3).map(v => <div key={v.id} style={{display:"flex",justifyContent:"space-between",gap:8,padding:"2px 0"}}><span>Viático · {v.trabajador || "Sin trabajador"}</span><b>{fmtMoney(v.monto)}</b></div>)}
                    </div>
                  )}
                  <div style={{ marginTop: 10, height: 7, background: COLORS.border, borderRadius: 20, overflow: "hidden" }}>
                    <div style={{ width: `${Math.max(0, Math.min(100, Number(currentRecord.pctRentabilidadCalculada ?? currentRecord.pctRentabilidad ?? 0) * 100))}%`, height: "100%", background: Number(currentRecord.pctRentabilidadCalculada ?? currentRecord.pctRentabilidad ?? 0) >= .3 ? COLORS.green : COLORS.amber, borderRadius: 20 }} />
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                  <DocRow titulo="Informe" numero={currentRecord.nInforme} estado={currentRecord.estadoInforme} link={currentRecord.anexoInforme} />
                  <DocRow titulo="Acta de Conformidad" numero={currentRecord.nAC} estado={currentRecord.estadoAC} link={currentRecord.anexoAC} />
                  <DocRow titulo="Factura" numero={currentRecord.nFactura} estado={currentRecord.estadoFactura} link={currentRecord.anexoFactura} />
                </div>

                <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
                  <InfoRow label="Fecha de pago" value={fmtDate(currentRecord.fechaPago)} />
                  <InfoRow label="Medio de pago" value={currentRecord.medioPago || "—"} />
                </div>

                {currentRecord._updatedAt && (
                  <div style={{ fontSize: 11, color: COLORS.faint, marginBottom: 16 }}>
                    Ultima actualizacion: {fmtDateTime(currentRecord._updatedAt)}
                    {isUrgente(currentRecord) && <span style={{ color: COLORS.red, marginLeft: 8 }}>⚠ Pendiente hace mas de {DIAS_URGENTE} dias</span>}
                  </div>
                )}

                <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>Fotos y documentos {docs.length > 0 ? `(${docs.length})` : ""}</div>
                    <label className="ct-filebtn" style={{ display: puedeAdjuntar ? "inline-flex" : "none" }}>
                      {uploading ? "Subiendo…" : "+ Agregar archivo"}
                      <input
                        type="file"
                        multiple
                        accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
                        style={{ display: "none" }}
                        disabled={uploading}
                        onChange={(e) => { onFilesSelected(e.target.files); e.target.value = ""; }}
                      />
                    </label>
                  </div>
                  {docsLoading ? (
                    <div style={{ fontSize: 11.5, color: COLORS.faint }}>Cargando archivos…</div>
                  ) : docs.length === 0 ? (
                    <div style={{ fontSize: 11.5, color: COLORS.faint }}>Sin fotos ni documentos adjuntos todavia</div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                      {docs.map((att) => <AttachmentThumb key={att.id} att={att} onRemove={removeAttachment} />)}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showAdd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }} onClick={() => setShowAdd(false)}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 22, width: 620, maxWidth: "100%", maxHeight: "85vh", overflowY: "auto", boxSizing: "border-box" }} className="ct-scroll" onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: 15 }}>Nueva orden de compra</div>
              <button onClick={() => setShowAdd(false)} style={{ background: "transparent", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            <EditForm value={draftAdd} onChange={setDraftAdd} ocOptions={buildOcOptions(records)} />
            <div style={{ fontSize: 11, color: COLORS.faint, marginTop: 10 }}>Podras agregar fotos y documentos despues de crear la OC.</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${COLORS.border}` }}>
              <button onClick={() => setShowAdd(false)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, padding: "8px 16px", borderRadius: 7, fontSize: 12.5, cursor: "pointer" }}>Cancelar</button>
              <button onClick={submitAdd} style={{ background: COLORS.amber, color: COLORS.amberText, border: "none", padding: "8px 16px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Crear OC</button>
            </div>
          </div>
        </div>
      )}

      {showHistory && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }} onClick={() => setShowHistory(false)}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 22, width: 480, maxWidth: "100%", maxHeight: "80vh", overflowY: "auto", boxSizing: "border-box" }} className="ct-scroll" onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: 15 }}>Historial de cambios</div>
              <button onClick={() => setShowHistory(false)} style={{ background: "transparent", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {history.length === 0 && <div style={{ fontSize: 12, color: COLORS.faint, textAlign: "center", padding: 20 }}>Aun no hay cambios registrados</div>}
              {history.map((h, i) => {
                const label = h.action === "creado" ? "creo" : h.action === "eliminado" ? "elimino" : "edito";
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: COLORS.panel2, borderRadius: 8, padding: "8px 12px" }}>
                    <div style={{ fontSize: 12 }}>
                      Se {label} la OC <b style={{ fontFamily: "'JetBrains Mono',monospace" }}>{h.oc ?? h.n}</b>
                    </div>
                    <div style={{ fontSize: 10.5, color: COLORS.faint, whiteSpace: "nowrap", marginLeft: 10 }}>{fmtDateTime(h.ts)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {sustentoGate.modal}
    </div>
  );
}


export { ControlTrabajos };
