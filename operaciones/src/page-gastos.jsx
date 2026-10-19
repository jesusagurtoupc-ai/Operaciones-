import { useState, useEffect, useMemo } from "react";
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
  MAX_FILE_BYTES,
  fmtMoney,
  fmtMoneyCompact,
  fmtDate,
  normEstado,
  gastoEstadoColor,
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
  MultiSelect,
  Kpi,
  AttachmentThumb,
  InfoRow,
  DocRow,
  todayStr,
  GASTOS_SEED,
  STORAGE_KEY_GASTOS,
  emptyGastoDraft,
  montoGasto,
  normalizeText,
  GastoForm,
  OCSelector,
  buildOcOptions,
  STORAGE_KEY_ASISTENCIA_TRABAJADORES,
  intentarGuardarConAprobacion,
  intentarEliminarConAprobacion,
  useSustentoGate,
  DropdownSelect,
  DropdownMultiSelect,
  useAutoSaveOnLeave
} = C;

function ControlGastos({ isAdmin = false, puedeEditar = true, puedeAgregar = true, puedeEliminar = true, puedeExportar = true, puedeAdjuntar = true, puedeAprobar = false, me = "" } = {}) {
  const sustentoGate = useSustentoGate();
  const [gastos, setGastos] = useState(null);
  const [ordenesCompra, setOrdenesCompra] = useState([]);
  const [ordenesCompraRecords, setOrdenesCompraRecords] = useState([]);
  const [trabajadores, setTrabajadores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [syncState, setSyncState] = useState("pendiente");
  const [search, setSearch] = useState("");
  const [fTipo, setFTipo] = useState([]);
  const [fEstado, setFEstado] = useState([]);
  const [fMes, setFMes] = useState([]);
  const [fAnio, setFAnio] = useState("");
  const [sortKey, setSortKey] = useState("fecha");
  const [sortDir, setSortDir] = useState(-1);

  const [showAdd, setShowAdd] = useState(false);
  const [draftAdd, setDraftAdd] = useState(emptyGastoDraft());
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [exportingXlsx, setExportingXlsx] = useState(false);

  const [detalle, setDetalle] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draftEdit, setDraftEdit] = useState(null);
  const [docs, setDocs] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDeleteDetalle, setConfirmDeleteDetalle] = useState(false);

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
    async function loadGastos() {
      try {
        const res = await window.storage.get(STORAGE_KEY_GASTOS, true);
        const parsed = JSON.parse(res.value);
        const data = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.records) ? parsed.records : [];
        const normalized = data.map((g) => ({
          ...g,
          tipo: String(g?.tipo || g?.type || "egreso").trim().toLowerCase(),
          fecha: String(g?.fecha || g?.date || "").slice(0, 10),
          importe: g?.importe ?? g?.monto ?? g?.montoEgreso ?? "",
          total: g?.total ?? g?.montoTotal ?? g?.valorTotal ?? "",
        }));
        const usable = normalized.filter((g) => ["egreso", "ingreso", "saldo_inicial"].includes(g.tipo));
        if (cancelado) return;
        if (usable.length) {
          setGastos(usable);
        } else if (isAdmin) {
          setGastos(GASTOS_SEED);
          try { await window.storage.set(STORAGE_KEY_GASTOS, JSON.stringify(GASTOS_SEED), true); } catch (_) { console.error(_); }
        } else {
          setGastos([]);
        }
        setSyncState("ok");
      } catch (e) {
        if (cancelado) return;
        if (isAdmin) {
          setGastos(GASTOS_SEED);
          try { await window.storage.set(STORAGE_KEY_GASTOS, JSON.stringify(GASTOS_SEED), true); } catch (_) { console.error(_); }
          setSyncState("ok");
        } else {
          setGastos([]);
          setSyncState(classifySyncError(e));
        }
      }
      setLoading(false);
    }
    loadGastos();
    const onPropuestasChanged = () => loadGastos();
    window.addEventListener("wilarcon:propuestas-changed", onPropuestasChanged);
    return () => { cancelado = true; window.removeEventListener("wilarcon:propuestas-changed", onPropuestasChanged); };
  }, [isAdmin]);

  useEffect(() => {
    let cancelado = false;
    async function cargarOrdenesCompra() {
      try {
        const res = await window.storage.get(STORAGE_KEY_RECORDS, true);
        const raw = JSON.parse(res.value);
        const records = Array.isArray(raw) ? raw : [];
        const ordered = records.filter(r => String(r?.oc || "").trim()).sort((a,b) => (Number(b?.n)||0) - (Number(a?.n)||0));
        if (!cancelado) { setOrdenesCompra(buildOcOptions(ordered)); setOrdenesCompraRecords(ordered); }
      } catch (e) { console.error("cargarOrdenesCompra (gastos): fallo la carga", e); if (!cancelado) { setOrdenesCompra([]); setOrdenesCompraRecords([]); } }
    }
    cargarOrdenesCompra();
    const onTrabajosChanged = () => cargarOrdenesCompra();
    const onVisible = () => { if (document.visibilityState === "visible") cargarOrdenesCompra(); };
    window.addEventListener("wilarcon:trabajos-changed", onTrabajosChanged);
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(cargarOrdenesCompra, 60000);
    return () => {
      cancelado = true;
      clearInterval(id);
      window.removeEventListener("wilarcon:trabajos-changed", onTrabajosChanged);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY_ASISTENCIA_TRABAJADORES, true);
        const raw = JSON.parse(res.value);
        setTrabajadores(Array.isArray(raw) ? raw.filter(Boolean) : []);
      } catch (e) { console.error("carga de trabajadores (gastos): fallo", e); setTrabajadores([]); }
    })();
  }, []);

  async function persist(next, intent) {
    if (typeof next === "function") {
      try {
        const applied = await mutateStorageJSON(STORAGE_KEY_GASTOS, [], (current) => next(Array.isArray(current) ? current : []), 4, intent);
        setGastos(applied);
        setSyncState("ok");
      } catch (e) {
        console.error(e);
        setSyncState(classifySyncError(e));
        alert("No se pudo guardar el cambio: otro usuario modificó estos registros al mismo tiempo y los reintentos automáticos no lograron aplicarlo. Recarga la página e inténtalo de nuevo.");
      }
      return;
    }
    setGastos(next);
    try { await window.storage.set(STORAGE_KEY_GASTOS, JSON.stringify(next), { intent }); setSyncState("ok"); } catch (e) { console.error(e); setSyncState(classifySyncError(e)); }
  }

  // Migración retroactiva a mayúsculas (v3.5.31): normaliza lo ya guardado en minúscula o mixtas.
  useEffect(() => {
    if (!isAdmin) return;
    persist((current) => {
      const list = Array.isArray(current) ? current : [];
      const up = (v) => (typeof v === "string" ? v.toUpperCase() : v);
      const normalized = list.map((g) => ({ ...g, descripcion: up(g.descripcion), nRecibo: up(g.nRecibo) }));
      return JSON.stringify(normalized) !== JSON.stringify(list) ? normalized : undefined;
    }, "migracion-mayusculas-gastos");
  }, [isAdmin]);

  const estadosDisponibles = useMemo(() => Array.from(new Set((gastos || []).map((g) => normEstado(g.estado)).filter(Boolean))).sort(), [gastos]);
  const mesesDisponibles = useMemo(() => Array.from(new Set((gastos || []).map((g) => (g.fecha || "").slice(0, 7)).filter(Boolean))).sort().reverse(), [gastos]);
  const aniosDisponiblesGastos = useMemo(() => Array.from(new Set(mesesDisponibles.map((m) => m.slice(0, 4)))).sort().reverse(), [mesesDisponibles]);
  const mesesDelAnioGastos = useMemo(() => (fAnio ? mesesDisponibles.filter((m) => m.slice(0, 4) === fAnio) : []), [mesesDisponibles, fAnio]);

  const filtered = useMemo(() => {
    let list = gastos || [];
    if (fTipo.length) list = list.filter((g) => fTipo.includes(g.tipo));
    if (fEstado.length) list = list.filter((g) => fEstado.includes(normEstado(g.estado)));
    if (fMes.length) list = list.filter((g) => fMes.includes((g.fecha || "").slice(0, 7)));
    else if (fAnio) list = list.filter((g) => (g.fecha || "").slice(0, 4) === fAnio);
    const q = normalizeText(search);
    if (q) list = list.filter((g) => [g.descripcion, g.oc, g.destinatario, g.nRecibo, g.factura].some((x) => normalizeText(x).includes(q)));
    if (sortKey === "__manual") return list;
    return [...list].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (sortKey === "monto") { av = montoGasto(a); bv = montoGasto(b); }
      if (av === undefined) av = "";
      if (bv === undefined) bv = "";
      if (av < bv) return -1 * sortDir;
      if (av > bv) return 1 * sortDir;
      return 0;
    });
  }, [gastos, fTipo, fEstado, fMes, fAnio, search, sortKey, sortDir]);

  function handleManualReorder(fromIdx, toIdx) {
    const next = reorderWithinFull(gastos || [], filtered, fromIdx, toIdx, "id");
    setSortKey("__manual");
    persist(next);
  }
  const rowDrag = useRowDrag({ enabled: !!isAdmin, idKey: "id", onReorder: handleManualReorder });

  const mesScope = useMemo(() => filtered, [filtered]);
  const saldoInicial = useMemo(() => mesScope.filter((g) => g.tipo === "saldo_inicial").reduce((s, g) => s + montoGasto(g), 0), [mesScope]);
  const totalIngresos = useMemo(() => mesScope.filter((g) => g.tipo === "ingreso").reduce((s, g) => s + montoGasto(g), 0), [mesScope]);
  const totalEgresos = useMemo(() => mesScope.filter((g) => g.tipo === "egreso").reduce((s, g) => s + montoGasto(g), 0), [mesScope]);
  const resultadoPeriodo = totalIngresos - totalEgresos;
  const pendientes = useMemo(() => mesScope.filter((g) => normEstado(g.estado) === "PENDIENTE" && String(g.destinatario || "").trim() !== "").length, [mesScope]);

  const saldoActual = useMemo(() => {
    let source = gastos || [];
    let end = "9999-12-31";
    if (fMes.length) end = `${[...fMes].sort().at(-1)}-31`;
    else if (fAnio) end = `${fAnio}-12-31`;
    if (fMes.length || fAnio) source = source.filter((g) => !g.fecha || g.fecha <= end);
    const inicial = source.filter((g) => g.tipo === "saldo_inicial").reduce((s, g) => s + montoGasto(g), 0);
    const ingresos = source.filter((g) => g.tipo === "ingreso").reduce((s, g) => s + montoGasto(g), 0);
    const egresos = source.filter((g) => g.tipo === "egreso").reduce((s, g) => s + montoGasto(g), 0);
    return inicial + ingresos - egresos;
  }, [gastos, fMes, fAnio]);

  const egresosDelMes = useMemo(() => {
    if (fMes.length || fAnio) return totalEgresos;
    const ym = todayStr().slice(0, 7);
    return filtered
      .filter((g) => g.tipo === "egreso" && (g.fecha || "").slice(0, 7) === ym)
      .reduce((s, g) => s + montoGasto(g), 0);
  }, [filtered, fMes, fAnio, totalEgresos]);

  const egresosFiltrados = useMemo(() => filtered.filter((g) => g.tipo === "egreso"), [filtered]);
  const mayorEgresoFiltrado = useMemo(
    () => (egresosFiltrados.length ? egresosFiltrados.reduce((max, g) => (montoGasto(g) > montoGasto(max) ? g : max), egresosFiltrados[0]) : null),
    [egresosFiltrados]
  );

  const kpiCompareSource = useMemo(() => {
    let list = gastos || [];
    if (fTipo.length) list = list.filter((g) => fTipo.includes(g.tipo));
    if (fEstado.length) list = list.filter((g) => fEstado.includes(normEstado(g.estado)));
    const q = normalizeText(search);
    if (q) list = list.filter((g) => [g.descripcion, g.oc, g.destinatario, g.nRecibo, g.factura].some((x) => normalizeText(x).includes(q)));
    return list;
  }, [gastos, fTipo, fEstado, search]);

  const MESES_ABBR = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  function labelMes(ym) {
    const [y, m] = ym.split("-");
    return `${MESES_ABBR[Number(m) - 1] || ym} ${y.slice(2)}`;
  }
  function labelMeses(meses) {
    if (!meses.length) return "";
    if (meses.length === 1) return labelMes(meses[0]);
    if (meses.length <= 3) return [...meses].sort().map((m) => labelMes(m)).join(", ");
    return `${meses.length} meses`;
  }

  const datosPorMes = useMemo(() => {
    const map = {};
    kpiCompareSource.forEach((g) => {
      if (g.tipo === "saldo_inicial") return;
      const ym = (g.fecha || "").slice(0, 7);
      if (ym.length !== 7) return;
      if (!map[ym]) map[ym] = { ym, ingresos: 0, egresos: 0 };
      if (g.tipo === "ingreso") map[ym].ingresos += montoGasto(g);
      if (g.tipo === "egreso") map[ym].egresos += montoGasto(g);
    });
    return Object.values(map).sort((a, b) => a.ym.localeCompare(b.ym));
  }, [kpiCompareSource]);
  const periodoReferenciaYM = useMemo(() => {
    if (fMes.length) return [...fMes].sort().at(-1);
    if (fAnio) {
      const delAnio = datosPorMes.filter((m) => m.ym.slice(0, 4) === fAnio).map((m) => m.ym);
      return delAnio.length ? delAnio[delAnio.length - 1] : `${fAnio}-12`;
    }
    return todayStr().slice(0, 7);
  }, [fMes, fAnio, datosPorMes]);

  const ultimosMeses = useMemo(() => {
    const [year, month] = periodoReferenciaYM.split("-").map(Number);
    const base = new Date(year, month - 1, 1);
    const meses = [];
    for (let i = 4; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const found = datosPorMes.find((m) => m.ym === ym);
      meses.push(found || { ym, ingresos: 0, egresos: 0 });
    }
    return meses;
  }, [datosPorMes, periodoReferenciaYM]);
  const maxMensual = ultimosMeses.length ? Math.max(...ultimosMeses.flatMap((m) => [m.ingresos, m.egresos])) : 0;

  const variacionMensual = useMemo(() => {
    const targetYm = periodoReferenciaYM;
    const idx = ultimosMeses.findIndex((m) => m.ym === targetYm);
    if (idx < 0) return null;
    const actual = ultimosMeses[idx].egresos;
    const anterior = idx > 0 ? ultimosMeses[idx - 1].egresos : 0;
    const ymAnterior = idx > 0 ? ultimosMeses[idx - 1].ym : null;
    if (!ymAnterior) return null;
    if (anterior === 0) return actual > 0 ? { pct: 100, esNuevo: true, actual, anterior, ymAnterior } : { pct: 0, esNuevo: false, actual, anterior, ymAnterior };
    return { pct: ((actual - anterior) / anterior) * 100, actual, anterior, ymAnterior };
  }, [ultimosMeses, periodoReferenciaYM]);

  function toggleTipoFiltro(t) {
    setFTipo((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }
  function toggleEstadoFiltro(e) {
    setFEstado((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]));
  }

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => -d);
    else { setSortKey(key); setSortDir(-1); }
  }

  function openAdd() { if (!puedeAgregar) return; setDraftAdd(emptyGastoDraft()); setShowAdd(true); }
  function normalizeGastoDraft(draft) {
    const rec = { ...draft, tipo: draft.tipo === "ingreso" ? "ingreso" : draft.tipo === "saldo_inicial" ? "saldo_inicial" : "egreso" };
    ["subTotal", "igv", "total", "importe"].forEach((k) => {
      if (rec[k] !== "" && rec[k] !== null && rec[k] !== undefined) rec[k] = Number(rec[k]) || 0;
    });
    rec.fecha = rec.fecha || "";
    rec.descripcion = (rec.descripcion || "").trim();
    rec.estado = normEstado(rec.estado);
    return rec;
  }

  function validateGasto(rec) {
    const monto = montoGasto(rec);
    if (!rec.fecha) return "Debes indicar la fecha del gasto.";
    if (!Number.isFinite(monto) || monto <= 0) return "El monto debe ser mayor que S/ 0.00.";
    if (!rec.descripcion) return "Debes indicar una descripción.";
    return "";
  }

  async function confirmAdd() {
    if (!puedeAgregar) return;
    const rec = normalizeGastoDraft({ ...draftAdd, id: uid() });
    const error = validateGasto(rec);
    if (error) { alert(error); return; }
    await persist((current) => [rec, ...current], "crear");
    setShowAdd(false);
    openDetalle(rec.id);
  }
  const GASTOS_DOCS_KEY_PREFIX = "wilarcon_gastos_docs_";
  async function loadDocsForGasto(id) {
    setDocsLoading(true);
    try {
      const res = await window.storage.get(`${GASTOS_DOCS_KEY_PREFIX}${id}`, true);
      const data = JSON.parse(res.value);
      setDocs(Array.isArray(data) ? data : []);
    } catch (e) {
      console.warn("loadDocsForGasto: no se pudieron cargar los adjuntos", e);
      setDocs([]);
    }
    setDocsLoading(false);
  }
  async function saveDocsForGasto(id, nextDocs) {
    setDocs(nextDocs);
    try { await window.storage.set(`${GASTOS_DOCS_KEY_PREFIX}${id}`, JSON.stringify(nextDocs), true); } catch (e) { console.error("no se pudo guardar archivos", e); }
  }
  function openDetalle(id) {
    setDetalle(id);
    setEditing(false);
    setConfirmDeleteDetalle(false);
    loadDocsForGasto(id);
  }
  async function closeDetalle() {
    if (editing) await autoSaveEditDetalle();
    setDetalle(null);
    setEditing(false);
    setDocs([]);
    setConfirmDeleteDetalle(false);
  }
  const currentGasto = useMemo(() => (gastos || []).find((g) => g.id === detalle) || null, [gastos, detalle]);
  function startEditDetalle() {
    if (!puedeEditar || !currentGasto) return;
    setDraftEdit({ ...currentGasto });
    setEditing(true);
  }
  async function cancelEditDetalle() { await autoSaveEditDetalle(); setEditing(false); setDraftEdit(null); }
  async function persistEditDetalle(draftToSave) {
    const nextDraft = normalizeGastoDraft(draftToSave);
    const original = (gastos || []).find((g) => g.id === detalle);
    await intentarGuardarConAprobacion({
      puedeAprobar, modulo: "gastos", moduloLabel: "Gastos",
      storageKey: STORAGE_KEY_GASTOS, idField: "id", recordId: detalle,
      original, propuesto: nextDraft, autor: me,
      labels: { tipo: "Tipo", descripcion: "Descripción", fecha: "Fecha", oc: "N° OC", subTotal: "Subtotal", igv: "IGV", total: "Total", importe: "Importe", estado: "Estado", medioPago: "Medio de pago" },
      persistDirecto: (intent) => persist((current) => current.map((g) => (g.id === detalle ? nextDraft : g)), intent),
      pedirSustento: sustentoGate.solicitar,
    });
  }
  async function saveEditDetalle() {
    if (!puedeEditar || !draftEdit) return;
    const error = validateGasto(normalizeGastoDraft(draftEdit));
    if (error) { alert(error); return; }
    await persistEditDetalle(draftEdit);
    setEditing(false);
    setDraftEdit(null);
  }
  // Autoguardado: si el usuario cambia de pestaña, oculta la ventana o cierra el
  // detalle sin apretar "Guardar cambios", se persiste automáticamente lo editado.
  const autoSaveEditDetalle = useAutoSaveOnLeave({
    active: editing && puedeEditar,
    draft: draftEdit,
    saveFn: persistEditDetalle,
    isValid: (d) => !validateGasto(normalizeGastoDraft(d)),
  });
  async function deleteCurrentGasto() {
    if (!puedeEliminar || !currentGasto) return;
    const id = detalle;
    await intentarEliminarConAprobacion({
      puedeAprobar, modulo: "gastos", moduloLabel: "Gastos",
      storageKey: STORAGE_KEY_GASTOS, idField: "id", recordId: id, autor: me,
      resumen: `${currentGasto.descripcion || currentGasto.tipo || "Gasto"} — ${montoGasto(currentGasto) || ""}`,
      docsKeyToClear: `${GASTOS_DOCS_KEY_PREFIX}${id}`,
      pedirSustento: sustentoGate.solicitar,
      persistDirecto: async (intent) => {
        await persist((current) => current.filter((g) => g.id !== id), intent);
        try { await window.storage.set(`${GASTOS_DOCS_KEY_PREFIX}${id}`, JSON.stringify([]), true); } catch (_) { console.error(_); }
      },
    });
    closeDetalle();
  }
  async function onFilesSelectedGasto(fileList) {
    if (!puedeAdjuntar || !detalle) return;
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
    if (accepted.length) await saveDocsForGasto(detalle, [...docs, ...accepted]);
    setUploading(false);
  }
  function removeAttachmentGasto(id) {
    if (!puedeAdjuntar) return;
    const doc = docs.find((d) => d.id === id);
    if (doc && doc.driveFileId) eliminarFotoDrive(doc.driveFileId);
    saveDocsForGasto(detalle, docs.filter((d) => d.id !== id));
  }
  async function doDelete(id) {
    if (!puedeEliminar) return;
    const registro = (gastos || []).find((g) => g.id === id);
    await intentarEliminarConAprobacion({
      puedeAprobar, modulo: "gastos", moduloLabel: "Gastos",
      storageKey: STORAGE_KEY_GASTOS, idField: "id", recordId: id, autor: me,
      resumen: registro ? `${registro.descripcion || registro.tipo || "Gasto"} — ${montoGasto(registro) || ""}` : `registro ${id}`,
      docsKeyToClear: `${GASTOS_DOCS_KEY_PREFIX}${id}`,
      pedirSustento: sustentoGate.solicitar,
      persistDirecto: async (intent) => {
        await persist((gastos || []).filter((g) => g.id !== id), intent);
        try { await window.storage.set(`${GASTOS_DOCS_KEY_PREFIX}${id}`, JSON.stringify([]), true); } catch (_) { console.error(_); }
      },
    });
    setConfirmDelete(null);
  }

  function sheetsGastos() {
    return [{ name: "Gastos", records: filtered, headers: ["Tipo", "Fecha", "Descripción", "OC", "Monto", "Destinatario", "N° Recibo", "Emisión", "Estado"], rowMapper: (g) => [g.tipo, g.fecha, g.descripcion, g.oc, montoGasto(g), g.destinatario, g.nRecibo, g.emision, g.estado] }];
  }
  async function exportXlsx() {
    setExportingXlsx(true);
    try {
      await downloadXlsxWorkbook(sheetsGastos(), "gastos");
    } catch (e) {
      console.error("exportXlsx error", e);
      alert("Ocurrió un error al generar la descarga. Intenta nuevamente.");
    } finally {
      setExportingXlsx(false);
    }
  }
  const carpetaLocal = useCarpetaLocal("gastos");
  useEffect(() => {
    if (!gastos) return;
    carpetaLocal.programarGuardado(nombreArchivoAnual("operaciones-gastos"), sheetsGastos);
  }, [gastos]);

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
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 600 }}>GASTOS</div>
            <div style={{ fontSize: 11, color: COLORS.dim, display: "flex", alignItems: "center", gap: 4 }}>
              Base de datos compartida en vivo
              <SyncDot syncState={syncState} palette={COLORS} />
            </div>
          </div>
        </div>
      </div>

      <FilterBar>
        <input className="ct-input2" placeholder="Buscar descripción, OC, destinatario, recibo…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 260 }} />
        <MultiSelect label="Tipo" allLabel="Todos" options={["ingreso", "egreso"]} selected={fTipo} onChange={setFTipo} />
        {estadosDisponibles.length > 0 && <MultiSelect label="Estado" allLabel="Todos" options={estadosDisponibles} selected={fEstado} onChange={setFEstado} />}
        <div style={{ display: "flex", alignItems: "center", gap: 9 }} title="Elige el año y luego el mes para filtrar los gastos por período">
          <span style={{ fontSize: 11, color: COLORS.dim, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
            📅 Periodo
          </span>
          <DropdownSelect
            value={fAnio}
            onChange={(v) => { setFAnio(v); setFMes([]); }}
            options={aniosDisponiblesGastos}
            placeholder="Todos los años"
            buttonStyle={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 20, color: COLORS.text, fontFamily: "'Inter',sans-serif", fontSize: 12.5, fontWeight: 600, padding: "5px 12px" }}
          />
          <DropdownMultiSelect
            value={fMes}
            onChange={setFMes}
            options={mesesDelAnioGastos.map((m) => ({ value: m, label: labelMes(m) }))}
            placeholder="Todos los meses"
            disabled={!fAnio}
            buttonStyle={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 20, color: COLORS.text, fontFamily: "'Inter',sans-serif", fontSize: 12.5, fontWeight: 600, padding: "5px 12px", opacity: fAnio ? 1 : 0.5 }}
          />
          {(fAnio || fMes.length > 0) && (
            <button onClick={() => { setFAnio(""); setFMes([]); }} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.faint, borderRadius: 20, padding: "5px 10px", fontSize: 11.5, cursor: "pointer" }}>
              Limpiar
            </button>
          )}
        </div>
        <div style={{ marginLeft: isMobile ? 0 : "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(search || fTipo.length || fEstado.length || fMes.length > 0 || fAnio) && (
            <ClearFiltersButton
              onClick={() => { setSearch(""); setFTipo([]); setFEstado([]); setFMes([]); setFAnio(""); }}
              title="Restablecer todos los filtros de gastos"
            />
          )}
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
          title={`Total general: ${(gastos || []).length} registros`}
          style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ fontSize: 11, color: COLORS.dim, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
              {fMes.length || fAnio || fTipo.length || fEstado.length || search.trim() ? "Registros (filtro)" : "Registros"}
            </div>
            <div style={{ opacity: 0.7, flexShrink: 0 }}>🧾</div>
          </div>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 24, fontWeight: 700, color: COLORS.text }}>{String(filtered.length)}</div>
        </div>
        <Kpi label={fMes.length ? `Saldo acumulado (${labelMeses(fMes)})` : fAnio ? `Saldo acumulado (${fAnio})` : "Saldo actual"} value={fmtMoney(saldoActual)} tone={saldoActual >= 0 ? "green" : "red"} icon="🏦" title={`Resultado del filtro: ${fmtMoney(resultadoPeriodo)} · Saldo inicial incluido: ${fmtMoney(saldoInicial)}`} />
        <Kpi
          label={fMes.length ? `Ingresos (${labelMeses(fMes)})` : fAnio ? `Ingresos (${fAnio})` : "Ingresos"}
          value={fmtMoney(totalIngresos)}
          tone="green"
          icon="⬆️"
          active={fTipo.includes("ingreso")}
          onClick={() => toggleTipoFiltro("ingreso")}
          title="Clic para filtrar por ingresos"
        />
        <Kpi
          label={fMes.length ? `Egresos (${labelMeses(fMes)})` : fAnio ? `Egresos (${fAnio})` : "Egresos"}
          value={fmtMoney(totalEgresos)}
          tone="amber"
          icon="⬇️"
          active={fTipo.includes("egreso")}
          onClick={() => toggleTipoFiltro("egreso")}
          title="Clic para filtrar por egresos"
        />
        <Kpi label={fMes.length || fAnio ? "Egresos del período" : "Egresos del mes"} value={fmtMoney(egresosDelMes)} icon="📅" title={fMes.length || fAnio ? "Suma de egresos del período seleccionado" : "Suma de egresos del mes calendario en curso"} />
        {mayorEgresoFiltrado && (
          <Kpi
            label="Mayor egreso"
            value={fmtMoney(montoGasto(mayorEgresoFiltrado))}
            icon="🔺"
            onClick={() => setSearch(mayorEgresoFiltrado.descripcion || "")}
            title={`${mayorEgresoFiltrado.descripcion || "—"} · ${fmtDate(mayorEgresoFiltrado.fecha)} · clic para buscarlo`}
          />
        )}
        {variacionMensual && (
          <Kpi
            label={`Egresos vs ${labelMes(variacionMensual.ymAnterior)}`}
            value={variacionMensual.esNuevo ? "Nuevo" : `${variacionMensual.pct >= 0 ? "+" : ""}${variacionMensual.pct.toFixed(1)}%`}
            tone={variacionMensual.esNuevo ? "red" : variacionMensual.pct > 0 ? "red" : "green"}
            icon={variacionMensual.esNuevo ? "🆕" : variacionMensual.pct > 0 ? "📈" : "📉"}
            title={`Mes anterior: ${fmtMoney(variacionMensual.anterior)} · Mes actual: ${fmtMoney(variacionMensual.actual)}`}
          />
        )}
        {pendientes > 0 && (
          <Kpi
            label={fMes.length ? "Recibos pendientes (mes)" : "Recibos pendientes"}
            value={String(pendientes)}
            icon="⏳"
            active={fEstado.includes("PENDIENTE")}
            onClick={() => toggleEstadoFiltro("PENDIENTE")}
            title="Clic para filtrar por pendientes"
          />
        )}
      </div>

      {ultimosMeses.length > 1 && (
        <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: COLORS.dim, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, marginBottom: 12 }}>
            Tendencia mensual (ingresos vs. egresos)
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 24, height: 220, padding: "4px 4px 0" }}>
            {ultimosMeses.map((m) => {
              const barAreaHeight = 180;
              const hIngreso = maxMensual > 0 ? (m.ingresos / maxMensual) * barAreaHeight : 0;
              const hEgreso = maxMensual > 0 ? (m.egresos / maxMensual) * barAreaHeight : 0;
              return (
                <div key={m.ym} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: barAreaHeight, width: "100%", justifyContent: "center" }}>
                    <div title={`Ingresos: ${fmtMoney(m.ingresos)}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                      {m.ingresos > 0 && (
                        <div style={{ fontSize: 10, color: COLORS.green, fontWeight: 600, marginBottom: 4, whiteSpace: "nowrap", fontFamily: "'JetBrains Mono',monospace" }}>
                          {fmtMoneyCompact(m.ingresos)}
                        </div>
                      )}
                      <div style={{ width: 26, height: `${Math.max(hIngreso, m.ingresos > 0 ? 3 : 0)}px`, background: COLORS.green, borderRadius: "4px 4px 0 0" }} />
                    </div>
                    <div title={`Egresos: ${fmtMoney(m.egresos)}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                      {m.egresos > 0 && (
                        <div style={{ fontSize: 10, color: COLORS.red, fontWeight: 600, marginBottom: 4, whiteSpace: "nowrap", fontFamily: "'JetBrains Mono',monospace" }}>
                          {fmtMoneyCompact(m.egresos)}
                        </div>
                      )}
                      <div style={{ width: 26, height: `${Math.max(hEgreso, m.egresos > 0 ? 3 : 0)}px`, background: COLORS.red, borderRadius: "4px 4px 0 0" }} />
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: COLORS.faint, marginTop: 6, whiteSpace: "nowrap" }}>{labelMes(m.ym)}</div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 14, fontSize: 10.5, color: COLORS.faint, marginTop: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: COLORS.green, display: "inline-block" }} />Ingresos</div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: COLORS.red, display: "inline-block" }} />Egresos</div>
          </div>
        </div>
      )}

      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "16px 18px", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600 }}>Registros ({filtered.length})</h2>
          {puedeAgregar && (
            <button onClick={openAdd} style={{ display: "flex", alignItems: "center", gap: 6, background: COLORS.amber, color: COLORS.amberText, fontWeight: 600, fontSize: 12.5, padding: "8px 14px", borderRadius: 7, border: "none", cursor: "pointer" }}>
              + Nuevo gasto
            </button>
          )}
        </div>
      <div className="ct-scroll" style={{ overflowX: "auto", border: `1px solid ${COLORS.border}`, borderRadius: 9 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", background: COLORS.panel }}>
          <thead>
            <tr>
              <th className="ct-th" onClick={() => toggleSort("fecha")}>Fecha</th>
              <th className="ct-th" onClick={() => toggleSort("tipo")}>Tipo</th>
              <th className="ct-th" onClick={() => toggleSort("descripcion")}>Descripción</th>
              <th className="ct-th" onClick={() => toggleSort("oc")}>OC</th>
              <th className="ct-th" onClick={() => toggleSort("monto")}>Monto</th>
              <th className="ct-th" onClick={() => toggleSort("destinatario")}>Destinatario</th>
              <th className="ct-th" onClick={() => toggleSort("estado")}>Estado</th>
              <th className="ct-th" style={{ width: 70 }}>Doc.</th>
              <th className="ct-th" style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td className="ct-td" colSpan={9} style={{ textAlign: "center", color: COLORS.faint, padding: 20 }}>Sin resultados</td></tr>
            )}
            {filtered.map((g, idx) => {
              const dh = rowDrag.getHandlers(idx, g);
              const isOver = rowDrag.dragOverId === g.id;
              const monto = montoGasto(g);
              const esEgreso = g.tipo === "egreso";
              const docs = [g.anexo, g.anexo2, g.anexo3].filter(Boolean);
              return (
              <tr key={g.id} className="ct-row" onClick={() => openDetalle(g.id)} {...dh} style={isOver ? { boxShadow: `inset 0 2px 0 ${COLORS.amber}` } : undefined}>
                <td className="ct-td" style={{ color: COLORS.dim }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <DragHandle show={isAdmin} isMobile={isMobile} color={COLORS.faint} dragProps={rowDrag.getHandleProps(idx)} dragging={rowDrag.armedIndex === idx} canMoveUp={idx > 0} canMoveDown={idx < filtered.length - 1} onMoveUp={() => rowDrag.moveBy(idx, -1, filtered.length)} onMoveDown={() => rowDrag.moveBy(idx, 1, filtered.length)} />
                    {fmtDate(g.fecha) === "\u2014" ? (g.fecha || "—") : fmtDate(g.fecha)}
                  </div>
                </td>
                <td className="ct-td">
                  <span style={{
                    fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 20, textTransform: "uppercase",
                    background: g.tipo === "saldo_inicial" ? COLORS.panel2 : esEgreso ? "rgba(232,93,93,.14)" : "rgba(96,196,133,.14)",
                    color: g.tipo === "saldo_inicial" ? COLORS.faint : esEgreso ? COLORS.red : COLORS.green,
                  }}>
                    {g.tipo === "saldo_inicial" ? "Saldo" : g.tipo}
                  </span>
                </td>
                <td className="ct-td">{g.descripcion || "—"}</td>
                <td className="ct-td" style={{ color: COLORS.dim }}>{g.oc || "—"}</td>
                <td className="ct-td" style={{ fontWeight: 600, color: g.tipo === "saldo_inicial" ? COLORS.text : esEgreso ? COLORS.red : COLORS.green }}>
                  {esEgreso ? "-" : ""}{fmtMoney(monto)}
                </td>
                <td className="ct-td" style={{ color: COLORS.dim }}>{g.destinatario || "—"}</td>
                <td className="ct-td" style={{ color: COLORS.dim }}>{g.estado || "—"}</td>
                <td className="ct-td" onClick={(e) => e.stopPropagation()}>
                  {docs.length > 0 ? (
                    <div style={{ display: "flex", gap: 4 }}>
                      {docs.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noreferrer" title="Ver documento" style={{ color: COLORS.amber, fontSize: 13, textDecoration: "none" }}>📎</a>
                      ))}
                    </div>
                  ) : "—"}
                </td>
                <td className="ct-td" onClick={(e) => e.stopPropagation()}>
                  {puedeEliminar && <button onClick={() => setConfirmDelete(g.id)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.faint, borderRadius: 6, padding: "4px 8px", fontSize: 11, cursor: "pointer" }}>Eliminar</button>}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>

      {showAdd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }} onClick={() => setShowAdd(false)}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 22, width: 620, maxWidth: "100%", maxHeight: "85vh", overflowY: "auto", boxSizing: "border-box" }} className="ct-scroll" onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: 15 }}>Nuevo gasto</div>
              <button onClick={() => setShowAdd(false)} style={{ background: "transparent", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            <GastoForm value={draftAdd} onChange={setDraftAdd} ocOptions={ordenesCompra} ocRecords={ordenesCompraRecords} trabajadores={trabajadores} />
            <div style={{ fontSize: 11, color: COLORS.faint, marginTop: 10 }}>Podras agregar fotos y documentos despues de crear el gasto.</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${COLORS.border}` }}>
              <button onClick={() => setShowAdd(false)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, padding: "8px 16px", borderRadius: 7, fontSize: 12.5, cursor: "pointer" }}>Cancelar</button>
              <button onClick={confirmAdd} style={{ background: COLORS.amber, color: COLORS.amberText, border: "none", padding: "8px 16px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Crear gasto</button>
            </div>
          </div>
        </div>
      )}

      {detalle && currentGasto && (() => {
        const esEgreso = currentGasto.tipo === "egreso";
        const esSaldo = currentGasto.tipo === "saldo_inicial";
        const monto = montoGasto(currentGasto);
        const tipoLabel = esSaldo ? "Saldo inicial" : currentGasto.tipo;
        const docRows = esEgreso
          ? [
              { titulo: "Comprobante / Sustento", numero: currentGasto.nRecibo, link: currentGasto.anexo2 },
              { titulo: "Recibo", numero: currentGasto.emision ? fmtDate(currentGasto.emision) : null, link: currentGasto.anexo3 },
            ]
          : esSaldo
          ? []
          : [{ titulo: "Sustento", numero: null, link: currentGasto.anexo }];
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }} onClick={closeDetalle}>
            <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 22, width: 620, maxWidth: "100%", maxHeight: "85vh", overflowY: "auto", boxSizing: "border-box" }} className="ct-scroll" onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                <div>
                  <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: 15, textTransform: "capitalize" }}>{tipoLabel}</div>
                  <div style={{ fontSize: 11.5, color: COLORS.dim, marginTop: 2 }}>
                    {fmtDate(currentGasto.fecha)}{currentGasto.oc ? ` · OC ${currentGasto.oc}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {!editing && puedeEditar && (
                    <button onClick={startEditDetalle} style={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}`, color: COLORS.text, padding: "6px 12px", borderRadius: 7, fontSize: 12, cursor: "pointer" }}>
                      ✎ Editar
                    </button>
                  )}
                  <button onClick={closeDetalle} style={{ background: "transparent", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 16 }}>✕</button>
                </div>
              </div>

              {editing ? (
                <>
                  <GastoForm value={draftEdit} onChange={setDraftEdit} ocOptions={ordenesCompra} ocRecords={ordenesCompraRecords} trabajadores={trabajadores} />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 14, borderTop: `1px solid ${COLORS.border}` }}>
                    {!puedeEliminar ? <div /> : confirmDeleteDetalle ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 11.5, color: COLORS.red }}>¿Eliminar este gasto definitivamente?</span>
                        <button onClick={deleteCurrentGasto} style={{ background: COLORS.red, color: COLORS.white, border: "none", padding: "6px 12px", borderRadius: 7, fontSize: 12, cursor: "pointer" }}>Confirmar</button>
                        <button onClick={() => setConfirmDeleteDetalle(false)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, padding: "6px 12px", borderRadius: 7, fontSize: 12, cursor: "pointer" }}>Cancelar</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDeleteDetalle(true)} style={{ background: "transparent", border: `1px solid ${COLORS.redDim}`, color: COLORS.red, padding: "7px 14px", borderRadius: 7, fontSize: 12, cursor: "pointer" }}>
                        Eliminar gasto
                      </button>
                    )}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={cancelEditDetalle} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, padding: "8px 16px", borderRadius: 7, fontSize: 12.5, cursor: "pointer" }}>Cancelar</button>
                      <button onClick={saveEditDetalle} style={{ background: COLORS.amber, color: COLORS.amberText, border: "none", padding: "8px 16px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Guardar cambios</button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13.5, marginBottom: 16, lineHeight: 1.5 }}>{currentGasto.descripcion || "—"}</div>

                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 16 }}>
                    <InfoRow label="Tipo" value={tipoLabel} />
                    <InfoRow label="OC" value={currentGasto.oc} />
                    <InfoRow label="Monto" value={`${esEgreso ? "-" : ""}${fmtMoney(monto)}`} />
                    <InfoRow label="Estado" value={currentGasto.estado} />
                    {esEgreso && <InfoRow label="Destinatario" value={currentGasto.destinatario} />}
                    {esEgreso && <InfoRow label="N.º Recibo" value={currentGasto.nRecibo} />}
                    {!esEgreso && !esSaldo && <InfoRow label="Subtotal" value={fmtMoney(currentGasto.subTotal)} />}
                    {!esEgreso && !esSaldo && <InfoRow label="IGV" value={fmtMoney(currentGasto.igv)} />}
                  </div>

                  {docRows.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                      {docRows.map((d, i) => (
                        <DocRow key={i} titulo={d.titulo} numero={d.numero} estado={currentGasto.estado} link={d.link} colorFn={gastoEstadoColor} />
                      ))}
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
                          onChange={(e) => { onFilesSelectedGasto(e.target.files); e.target.value = ""; }}
                        />
                      </label>
                    </div>
                    {docsLoading ? (
                      <div style={{ fontSize: 11.5, color: COLORS.faint }}>Cargando archivos…</div>
                    ) : docs.length === 0 ? (
                      <div style={{ fontSize: 11.5, color: COLORS.faint }}>Sin fotos ni documentos adjuntos todavia</div>
                    ) : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                        {docs.map((att) => <AttachmentThumb key={att.id} att={att} onRemove={removeAttachmentGasto} />)}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {confirmDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setConfirmDelete(null)}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 18, width: 320, maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ fontSize: 13.5, color: COLORS.text, marginBottom: 14 }}>¿Eliminar este gasto?</div>
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



export { GastoForm, OCSelector, ControlGastos };
