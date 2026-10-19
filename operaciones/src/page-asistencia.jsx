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
  fmtDate,
  monthLabel,
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
  Badge,
  MultiSelect,
  MiniBarChart,
  ChartPanel,
  KpiHorasExtra,
  KpiPuntualidad,
  VACACIONES_DIAS_ANIO,
  KpiVacaciones,
  KpiFaltas,
  useIsMobile,
  HoraInput,
  DateInput,
  STORAGE_KEY_ASISTENCIA_REGISTROS,
  STORAGE_KEY_ASISTENCIA_TRABAJADORES,
  STORAGE_KEY_ASISTENCIA_UBICACIONES,
  STORAGE_KEY_ASISTENCIA_SUELDOS,
  ASISTENCIA_SEED_UBICACIONES,
  ASISTENCIA_SEED_SUELDOS,
  ESTADOS_ASISTENCIA,
  ESTADOS_ASISTENCIA_FORM,
  TURNOS_ASISTENCIA,
  JORNADA_HORAS_ASISTENCIA,
  diasLaborablesDelMes,
  ASISTENCIA_SEED_TRABAJADORES,
  ASISTENCIA_SEED_DATA,
  estadoAsistenciaColor,
  emptyAsistenciaDraft,
  asistenciaDraftValido,
  groupAsistenciaBy,
  horasEntreHorarios,
  fmtHoras,
  calcularHorasRegistro,
  resumenHorasPorTrabajador,
  normalizePersonKey,
  canonicalPersonName,
  canonicalizePeople,
  canonicalizeWorkerRecords,
  canonicalizeWorkerSalaryMap,
  UBICACION_SEDES,
  todayStr,
  STORAGE_KEY_VIATICOS,
  esBonoDiarioTrabajador,
  VIATICO_AUTO_SUPERVISION_MONTO,
  VIATICO_AUTO_SUPERVISION_CONCEPTO,
  intentarGuardarConAprobacion,
  intentarEliminarConAprobacion,
  useSustentoGate,
  filterOwnRecords,
  OCSelector,
  DropdownSelect,
  useAutoSaveOnLeave,
} = C;

function AsistenciaForm({ value, onChange, trabajadores, ubicacionSedes }) {
  const sedes = ubicacionSedes || UBICACION_SEDES;
  const set = (patch) => onChange({ ...value, ...patch });
  const esFalta = value.estado === "Falta";
  const isMobile = useIsMobile();
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
      <div style={{ gridColumn: "1 / -1" }}>
        <div style={{ fontSize: 10.5, color: COLORS.dim, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Trabajador</div>
        {trabajadores.length > 0 ? (
          <OCSelector value={value.trabajador} onChange={(v) => set({ trabajador: v })} options={trabajadores} placeholder="Selecciona…" />
        ) : (
          <input className="as-input" value={value.trabajador} onChange={(e) => set({ trabajador: e.target.value.toUpperCase() })} placeholder="Nombre del trabajador" />
        )}
      </div>
      <div>
        <div style={{ fontSize: 10.5, color: COLORS.dim, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Fecha</div>
        <DateInput value={value.fecha} onChange={(fecha) => set({ fecha })} inputClassName="as-input" showLabel={false} palette={COLORS} />
      </div>
      <div>
        <div style={{ fontSize: 10.5, color: COLORS.dim, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Estado</div>
        <DropdownSelect
          buttonClassName="as-input"
          value={value.estado}
          onChange={(nuevoEstado) => {
            if (nuevoEstado === "Falta") {
              set({ estado: nuevoEstado, horaEntrada: "", horaSalida: "", ubicacion: "" });
            } else {
              set({ estado: nuevoEstado });
            }
          }}
          options={ESTADOS_ASISTENCIA_FORM}
        />
      </div>
      <div>
        <div style={{ fontSize: 10.5, color: COLORS.dim, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Turno</div>
        <DropdownSelect buttonClassName="as-input" value={value.turno} onChange={(v) => set({ turno: v })} options={TURNOS_ASISTENCIA.map((t) => ({ value: t, label: t === "D" ? "Dia" : "Noche" }))} />
      </div>
      {!esFalta && (
        <>
          <HoraInput label="Hora entrada" value={value.horaEntrada} onChange={(hora) => set({ horaEntrada: hora })} turno={value.turno} isEntrada />
          <HoraInput label="Hora salida" value={value.horaSalida} onChange={(hora) => set({ horaSalida: hora })} turno={value.turno} />
          <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 10px", borderRadius: 8, background: COLORS.panel2, border: `1px solid ${COLORS.border}` }}>
            <span style={{ fontSize: 10.5, color: COLORS.dim }}>Jornada registrada</span>
            <strong style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, color: COLORS.text }}>
              {value.horaEntrada && value.horaSalida ? fmtHoras(horasEntreHorarios(value.horaEntrada, value.horaSalida)) : "Completa entrada y salida"}
            </strong>
          </div>
          <div style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
            <div>
              <div style={{ fontSize: 10.5, color: COLORS.dim, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Ubicacion de obra</div>
              <DropdownSelect
                buttonClassName="as-input"
                value={(() => { const p = (value.ubicacion || "").split(" "); return sedes[p[0]] ? p[0] : ""; })()}
                onChange={(v) => set({ ubicacion: v || "" })}
                placeholder="Selecciona sede…"
                options={Object.keys(sedes)}
              />
            </div>
            <div>
              <div style={{ fontSize: 10.5, color: COLORS.dim, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>&nbsp;</div>
              {(() => {
                const partes = (value.ubicacion || "").split(" ");
                const sede = sedes[partes[0]] ? partes[0] : "";
                const campus = sede ? partes.slice(1).join(" ") : "";
                return (
                  <DropdownSelect
                    buttonClassName="as-input"
                    value={campus}
                    disabled={!sede}
                    onChange={(v) => set({ ubicacion: v ? `${sede} ${v}` : sede })}
                    placeholder="Selecciona campus…"
                    options={sede ? sedes[sede] : []}
                  />
                );
              })()}
            </div>
          </div>
        </>
      )}
      <div style={{ gridColumn: "1 / -1" }}>
        <div style={{ fontSize: 10.5, color: COLORS.dim, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Observacion</div>
        <textarea className="as-input" rows={3} value={value.observacion} onChange={(e) => set({ observacion: e.target.value.toUpperCase() })} style={{ resize: "vertical", fontFamily: "'Inter',sans-serif" }} />
      </div>
    </div>
  );
}

function ControlAsistencia({ readOnly = false, canDelete = true, isAdmin = false, puedeExportar = true, puedeAprobar = false, me = "", ownerIdentity = "", puedeVerTodos = true } = {}) {
  const MESES_NOMBRES_PERIODO = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const sustentoGate = useSustentoGate();
  const [isMobile, setIsMobile] = useState(false);
  const [registros, setRegistros] = useState(null);
  const [trabajadores, setTrabajadores] = useState([]);
  const [ubicacionSedes, setUbicacionSedes] = useState({});
  const [loading, setLoading] = useState(true);
  const [syncState, setSyncState] = useState("pendiente");

  const [search, setSearch] = useState("");
  const [fTrabajador, setFTrabajador] = useState([]);
  const [fEstado, setFEstado] = useState([]);
  const [fUbicacion, setFUbicacion] = useState([]);
  const [fTurno, setFTurno] = useState([]);
  const [kpiFilter, setKpiFilter] = useState(null);
  const [kpiTecnicoHoras, setKpiTecnicoHoras] = useState("");
  const [mesResumenAsistencias, setMesResumenAsistencias] = useState("todos");
  const [mesGlobalMes, setMesGlobalMes] = useState(Number(todayStr().slice(5, 7)));
  const [mesGlobalAnio, setMesGlobalAnio] = useState(Number(todayStr().slice(0, 4)));
  const mesGlobalYM = `${mesGlobalAnio}-${String(mesGlobalMes).padStart(2, "0")}`;
  const [sortKey, setSortKey] = useState("fecha");
  const [sortDir, setSortDir] = useState(-1);
  const [view, setView] = useState("tabla");

  const [showAdd, setShowAdd] = useState(false);
  const [draftAdd, setDraftAdd] = useState(emptyAsistenciaDraft());
  const [editingId, setEditingId] = useState(null);
  const [draftEdit, setDraftEdit] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const [exportingXlsx, setExportingXlsx] = useState(false);

  const [sueldos, setSueldos] = useState({});

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
      try {
        const res = await window.storage.get(STORAGE_KEY_ASISTENCIA_REGISTROS, true);
        const data = JSON.parse(res.value);
        const hasData = Array.isArray(data) && data.length > 0;
        if (hasData) {
          setRegistros(data);
        } else if (isAdmin) {
          setRegistros(ASISTENCIA_SEED_DATA);
          try { await window.storage.set(STORAGE_KEY_ASISTENCIA_REGISTROS, JSON.stringify(ASISTENCIA_SEED_DATA), true); } catch (_) { console.error(_); }
        } else {
          setRegistros(Array.isArray(data) ? data : []);
        }
        setSyncState("ok");
      } catch (e) {
        if (isAdmin) {
          setRegistros(ASISTENCIA_SEED_DATA);
          try { await window.storage.set(STORAGE_KEY_ASISTENCIA_REGISTROS, JSON.stringify(ASISTENCIA_SEED_DATA), true); } catch (_) { console.error(_); }
          setSyncState("ok");
        } else {
          setRegistros([]);
          setSyncState("error");
        }
      }
      try {
        const res2 = await window.storage.get(STORAGE_KEY_ASISTENCIA_TRABAJADORES, true);
        const data2 = JSON.parse(res2.value);
        const hasWorkers = Array.isArray(data2) && data2.length > 0;
        if (hasWorkers) {
          setTrabajadores(canonicalizePeople(data2));
        } else if (isAdmin) {
          setTrabajadores(canonicalizePeople(ASISTENCIA_SEED_TRABAJADORES));
          try { await window.storage.set(STORAGE_KEY_ASISTENCIA_TRABAJADORES, JSON.stringify(ASISTENCIA_SEED_TRABAJADORES), true); } catch (_) { console.error(_); }
        } else {
          setTrabajadores(Array.isArray(data2) ? data2 : []);
        }
      } catch (e) {
        if (isAdmin) {
          setTrabajadores(ASISTENCIA_SEED_TRABAJADORES);
          try { await window.storage.set(STORAGE_KEY_ASISTENCIA_TRABAJADORES, JSON.stringify(ASISTENCIA_SEED_TRABAJADORES), true); } catch (_) { console.error(_); }
        } else {
          setTrabajadores([]);
        }
      }
      try {
        const res3 = await window.storage.get(STORAGE_KEY_ASISTENCIA_UBICACIONES, true);
        const data3 = JSON.parse(res3.value);
        if (data3 && typeof data3 === "object" && Object.keys(data3).length) {
          setUbicacionSedes(data3);
        } else if (isAdmin) {
          setUbicacionSedes(ASISTENCIA_SEED_UBICACIONES);
          try { await window.storage.set(STORAGE_KEY_ASISTENCIA_UBICACIONES, JSON.stringify(ASISTENCIA_SEED_UBICACIONES), true); } catch (_) { console.error(_); }
        } else {
          setUbicacionSedes({});
        }
      } catch (e) {
        if (isAdmin) {
          setUbicacionSedes(ASISTENCIA_SEED_UBICACIONES);
          try { await window.storage.set(STORAGE_KEY_ASISTENCIA_UBICACIONES, JSON.stringify(ASISTENCIA_SEED_UBICACIONES), true); } catch (_) { console.error(_); }
        } else {
          setUbicacionSedes({});
        }
      }
      try {
        const res4 = await window.storage.get(STORAGE_KEY_ASISTENCIA_SUELDOS, true);
        const data4 = JSON.parse(res4.value);
        if (data4 && typeof data4 === "object" && Object.keys(data4).length) {
          setSueldos(data4);
        } else if (isAdmin) {
          setSueldos(ASISTENCIA_SEED_SUELDOS);
          try { await window.storage.set(STORAGE_KEY_ASISTENCIA_SUELDOS, JSON.stringify(ASISTENCIA_SEED_SUELDOS), true); } catch (_) { console.error(_); }
        } else {
          setSueldos({});
        }
      } catch (e) {
        if (isAdmin) {
          setSueldos(ASISTENCIA_SEED_SUELDOS);
          try { await window.storage.set(STORAGE_KEY_ASISTENCIA_SUELDOS, JSON.stringify(ASISTENCIA_SEED_SUELDOS), true); } catch (_) { console.error(_); }
        } else {
          setSueldos({});
        }
      }
      setLoading(false);
    }
    loadAll();
    const onPropuestasChanged = () => loadAll();
    window.addEventListener("wilarcon:propuestas-changed", onPropuestasChanged);
    return () => { cancelado = true; window.removeEventListener("wilarcon:propuestas-changed", onPropuestasChanged); };
  }, [isAdmin]);

  // Al ingresar, un trabajador (no admin) ve el filtro "Trabajador" ya puesto en su propio
  // nombre en vez de "Todos", para que la vista arranque mostrando lo suyo. Solo se aplica una
  // vez (appliedOwnTrabajadorFilter) para no pisar un cambio manual posterior del usuario, y
  // solo si su nombre calza con alguno de los trabajadores registrados.
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

  useEffect(() => {
    if (!isAdmin || !trabajadores.length) return;
    persistRegistros((current) => {
      const list = Array.isArray(current) ? current : [];
      const normalized = canonicalizeWorkerRecords(list, trabajadores);
      return JSON.stringify(normalized) !== JSON.stringify(list) ? normalized : undefined;
    });
  }, [isAdmin, trabajadores]);

  useEffect(() => {
    if (!isAdmin) return;
    persistRegistros((current) => {
      const list = Array.isArray(current) ? current : [];
      const normalized = list.map((r) => {
        const observacion = typeof r.observacion === "string" ? r.observacion.toUpperCase() : r.observacion;
        return observacion === r.observacion ? r : { ...r, observacion };
      });
      return JSON.stringify(normalized) !== JSON.stringify(list) ? normalized : undefined;
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || !trabajadores.length) return;
    persistSueldos((current) => {
      const map = current && typeof current === "object" ? current : {};
      const normalized = canonicalizeWorkerSalaryMap(map, trabajadores);
      return JSON.stringify(normalized) !== JSON.stringify(map) ? normalized : undefined;
    });
  }, [isAdmin, trabajadores]);

  async function persistRegistros(next, intent) {
    if (typeof next === "function") {
      try {
        const applied = await mutateStorageJSON(STORAGE_KEY_ASISTENCIA_REGISTROS, [], (current) => next(Array.isArray(current) ? current : []), 4, intent);
        setRegistros(applied);
        setSyncState("ok");
        return applied;
      } catch (e) {
        console.error("persist asistencia error", e);
        setSyncState(classifySyncError(e));
        alert("No se pudo guardar el cambio: otro usuario modificó estos registros al mismo tiempo y los reintentos automáticos no lograron aplicarlo. Recarga la página e inténtalo de nuevo.");
        return;
      }
    }
    setRegistros(next);
    try {
      await window.storage.set(STORAGE_KEY_ASISTENCIA_REGISTROS, JSON.stringify(next), { intent });
      setSyncState("ok");
    } catch (e) {
      console.error("persist asistencia error", e);
      setSyncState(classifySyncError(e));
    }
  }

  async function persistSueldos(next) {
    if (typeof next === "function") {
      try {
        const applied = await mutateStorageJSON(STORAGE_KEY_ASISTENCIA_SUELDOS, {}, (current) => next(current && typeof current === "object" ? current : {}));
        setSueldos(applied);
        return applied;
      } catch (e) {
        console.error("persist sueldos error", e);
        alert("No se pudo guardar el cambio: otro usuario modificó los sueldos al mismo tiempo y los reintentos automáticos no lograron aplicarlo. Recarga la página e inténtalo de nuevo.");
        return;
      }
    }
    setSueldos(next);
    try {
      await window.storage.set(STORAGE_KEY_ASISTENCIA_SUELDOS, JSON.stringify(next), true);
    } catch (e) {
      console.error("persist sueldos error", e);
    }
  }

  function wrapFilterChange(setter) {
    return (v) => { setKpiFilter(null); setter(v); };
  }

  function resetFilters() {
    setSearch("");
    setFTrabajador([]);
    setFEstado([]);
    setFUbicacion([]);
    setFTurno([]);
    setKpiFilter(null);
    setKpiTecnicoHoras("");
  }

  function handleTrabajadorGlobalChange(value) {
    setKpiTecnicoHoras(value);
    setKpiFilter(null);
    setFTrabajador(value ? [value] : []);
  }
  const filtersActive = !!(search || fTrabajador.length || fEstado.length || fUbicacion.length || fTurno.length || kpiFilter);

  const registrosVisibles = useMemo(() => (
    puedeVerTodos ? (registros || []) : filterOwnRecords(registros || [], ownerIdentity, "trabajador")
  ), [registros, puedeVerTodos, ownerIdentity]);

  const ubicaciones = useMemo(() => [...new Set(registrosVisibles.map((r) => r.ubicacion).filter(Boolean))].sort(), [registrosVisibles]);

  const kpis = useMemo(() => {
    const list = registrosVisibles;
    const q = search.trim().toLowerCase();
    const delMes = list.filter((r) => {
      if ((r.fecha || "").slice(0, 7) !== mesGlobalYM) return false;
      if (fTrabajador.length && !fTrabajador.some((x) => normalizePersonKey(x) === normalizePersonKey(r.trabajador))) return false;
      if (fEstado.length && !fEstado.includes(r.estado)) return false;
      if (fUbicacion.length && !fUbicacion.includes(r.ubicacion)) return false;
      if (fTurno.length && !fTurno.includes(r.turno)) return false;
      if (q) {
        const hay = `${r.trabajador} ${r.ubicacion} ${r.observacion}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const resumenHorasMes = resumenHorasPorTrabajador(delMes);
    const balanceHorasTotalMes = resumenHorasMes.reduce((acc, rt) => acc + rt.diferencia, 0);
    return {
      total: list.length,
      presentes: delMes.filter((r) => r.estado === "Presente").length,
      tardanzas: delMes.filter((r) => r.estado === "Tardanza").length,
      faltas: delMes.filter((r) => r.estado === "Falta").length,
      resumenHorasMes,
      balanceHorasTotalMes,
      delMes,
    };
  }, [registrosVisibles, search, fTrabajador, fEstado, fUbicacion, fTurno, mesGlobalYM]);

  const horasExtraKpiValue = useMemo(() => {
    if (!kpiTecnicoHoras) return kpis.balanceHorasTotalMes;
    const rt = kpis.resumenHorasMes.find((x) => normalizePersonKey(x.trabajador) === normalizePersonKey(kpiTecnicoHoras));
    return rt ? rt.diferencia : 0;
  }, [kpis, kpiTecnicoHoras]);

  const puntualidadKpiValue = useMemo(() => {
    const registrosMes = kpiTecnicoHoras
      ? kpis.delMes.filter((r) => normalizePersonKey(r.trabajador) === normalizePersonKey(kpiTecnicoHoras))
      : kpis.delMes;
    const diasLaborables = diasLaborablesDelMes(mesGlobalYM, todayStr());
    if (!diasLaborables) return null;
    if (kpiTecnicoHoras) {
      const presentes = registrosMes.filter((r) => r.estado === "Presente").length;
      return Math.round((presentes / diasLaborables) * 100);
    }
    if (!trabajadores.length) return null;
    const presentesTotal = registrosMes.filter((r) => r.estado === "Presente").length;
    const numTrabajadoresParaPromedio = puedeVerTodos ? trabajadores.length : 1;
    const diasEsperadosTotal = diasLaborables * numTrabajadoresParaPromedio;
    return Math.round((presentesTotal / diasEsperadosTotal) * 100);
  }, [kpis, trabajadores, kpiTecnicoHoras, mesGlobalYM, puedeVerTodos]);

  const anioActualKpi = mesGlobalAnio;
  const vacacionesKpiValue = useMemo(() => {
    if (!kpiTecnicoHoras) return null;
    const registrosTecnico = registrosVisibles.filter((r) => normalizePersonKey(r.trabajador) === normalizePersonKey(kpiTecnicoHoras));
    const anios = registrosTecnico
      .map((r) => Number((r.fecha || "").slice(0, 4)))
      .filter((a) => a > 0);
    const primerAnio = anios.length ? Math.min(...anios, anioActualKpi) : anioActualKpi;
    const aniosAcumulados = Math.max(1, anioActualKpi - primerAnio + 1);
    const disponible = aniosAcumulados * VACACIONES_DIAS_ANIO;
    const q = search.trim().toLowerCase();
    const tomados = registrosTecnico.filter((r) => {
      if (r.estado !== "Vacaciones") return false;
      if (fEstado.length && !fEstado.includes(r.estado)) return false;
      if (fUbicacion.length && !fUbicacion.includes(r.ubicacion)) return false;
      if (fTurno.length && !fTurno.includes(r.turno)) return false;
      if (q) {
        const hay = `${r.trabajador} ${r.ubicacion} ${r.observacion}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).length;
    return { tomados, disponible, restantes: disponible - tomados };
  }, [registrosVisibles, kpiTecnicoHoras, anioActualKpi, fEstado, fUbicacion, fTurno, search]);

  const faltasKpiValue = useMemo(() => {
    const base = kpiTecnicoHoras ? kpis.delMes.filter((r) => normalizePersonKey(r.trabajador) === normalizePersonKey(kpiTecnicoHoras)) : kpis.delMes;
    return base.filter((r) => r.estado === "Falta").length;
  }, [kpis, kpiTecnicoHoras]);


  function showEstadoKpi(estado) {
    const trabajadorActivo = kpiTecnicoHoras;
    if (kpiFilter === estado) {
      resetFilters();
      if (trabajadorActivo) { setKpiTecnicoHoras(trabajadorActivo); setFTrabajador([trabajadorActivo]); }
      return;
    }
    resetFilters();
    if (trabajadorActivo) { setKpiTecnicoHoras(trabajadorActivo); setFTrabajador([trabajadorActivo]); }
    setFEstado([estado]);
    setKpiFilter(estado);
  }

  const filteredSinMes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return registrosVisibles.filter((r) => {
      if (fTrabajador.length && !fTrabajador.some((x) => normalizePersonKey(x) === normalizePersonKey(r.trabajador))) return false;
      if (fEstado.length && !fEstado.includes(r.estado)) return false;
      if (fUbicacion.length && !fUbicacion.includes(r.ubicacion)) return false;
      if (fTurno.length && !fTurno.includes(r.turno)) return false;
      if (q) {
        const hay = `${r.trabajador} ${r.ubicacion} ${r.observacion}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [registrosVisibles, fTrabajador, fEstado, fUbicacion, fTurno, search]);

  const filtered = useMemo(() => {
    return filteredSinMes.filter((r) => (r.fecha || "").slice(0, 7) === mesGlobalYM);
  }, [filteredSinMes, mesGlobalYM]);

  const sorted = useMemo(() => {
    if (sortKey === "__manual") return filtered;
    const list = [...filtered];
    list.sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      if (av < bv) return -1 * sortDir;
      if (av > bv) return 1 * sortDir;
      return 0;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => -d);
    else { setSortKey(key); setSortDir(1); }
  }

  function handleManualReorder(fromIdx, toIdx) {
    const next = reorderWithinFull(registros || [], sorted, fromIdx, toIdx, "id");
    setSortKey("__manual");
    persistRegistros(next);
  }
  const rowDrag = useRowDrag({ enabled: !!isAdmin && !readOnly, idKey: "id", onReorder: handleManualReorder });

  function openAdd() {
    if (readOnly) return;
    setDraftAdd(emptyAsistenciaDraft());
    setShowAdd(true);
  }

  function submitAdd() {
    if (readOnly) return;
    if (!asistenciaDraftValido(draftAdd, ubicacionSedes)) return;
    const newRecord = { ...draftAdd, id: uid() };
    persistRegistros((current) => [newRecord, ...(current || [])], "crear");
    generarViaticoSupervisionAutomatico(newRecord);
    setShowAdd(false);
  }

  async function generarViaticoSupervisionAutomatico(registro) {
    if (registro.estado !== "Presente") return;
    if (!esBonoDiarioTrabajador(registro.trabajador)) return;
    const nuevoViatico = {
      id: uid(),
      trabajador: registro.trabajador,
      fecha: registro.fecha,
      descripcion: VIATICO_AUTO_SUPERVISION_CONCEPTO,
      oc: "",
      monto: VIATICO_AUTO_SUPERVISION_MONTO,
    };
    try {
      await mutateStorageJSON(STORAGE_KEY_VIATICOS, [], (current) => [nuevoViatico, ...(Array.isArray(current) ? current : [])], 4, "crear");
    } catch (error) {
      console.error("[asistencia] no se pudo generar el viático automático de supervisión", error);
    }
  }

  function openEdit(r) {
    if (readOnly) return;
    setDraftEdit({ ...r });
    setEditingId(r.id);
  }

  async function persistEditAsistencia(draftToSave) {
    const original = (registros || []).find((r) => r.id === editingId);
    await intentarGuardarConAprobacion({
      puedeAprobar, modulo: "asistencia", moduloLabel: "Asistencia",
      storageKey: STORAGE_KEY_ASISTENCIA_REGISTROS, idField: "id", recordId: editingId,
      original, propuesto: { ...draftToSave }, autor: me,
      labels: { trabajador: "Trabajador", fecha: "Fecha", horaEntrada: "Hora de entrada", horaSalida: "Hora de salida", ubicacion: "Ubicación", turno: "Turno", estado: "Estado", observacion: "Observación" },
      persistDirecto: (intent) => persistRegistros((current) => (current || []).map((r) => (r.id === editingId ? { ...draftToSave } : r)), intent),
      pedirSustento: sustentoGate.solicitar,
    });
  }
  // Autoguardado: guarda lo editado si el usuario cambia de pestaña, oculta la
  // ventana o cierra el formulario sin apretar "Guardar cambios".
  const autoSaveEditAsistencia = useAutoSaveOnLeave({
    active: !!editingId && !readOnly,
    draft: draftEdit,
    saveFn: persistEditAsistencia,
    isValid: (d) => asistenciaDraftValido(d, ubicacionSedes),
  });
  async function cerrarEditAsistencia() { await autoSaveEditAsistencia(); setEditingId(null); setDraftEdit(null); }
  function submitEdit() {
    if (readOnly) return;
    if (!asistenciaDraftValido(draftEdit, ubicacionSedes)) return;
    persistEditAsistencia(draftEdit);
    setEditingId(null);
    setDraftEdit(null);
  }

  async function doDelete(id) {
    if (!canDelete) return;
    const registro = (registros || []).find((r) => r.id === id);
    await intentarEliminarConAprobacion({
      puedeAprobar, modulo: "asistencia", moduloLabel: "Asistencia",
      storageKey: STORAGE_KEY_ASISTENCIA_REGISTROS, idField: "id", recordId: id, autor: me,
      resumen: registro ? `${registro.trabajador || ""} — ${registro.fecha || ""}` : `registro ${id}`,
      persistDirecto: (intent) => persistRegistros((current) => (current || []).filter((r) => r.id !== id), intent),
      pedirSustento: sustentoGate.solicitar,
    });
    setConfirmDelete(null);
  }

  function sheetsAsistencia() {
    const cols = ["trabajador", "fecha", "turno", "horaEntrada", "horaSalida", "ubicacion", "estado", "observacion"];
    const headers = [...cols, "horasTrabajadas", "diferencia", "bonoFeriadoDomingo"];
    return [{
      name: "Asistencia",
      records: sorted,
      headers,
      rowMapper: (r) => {
        const { horas, diferencia, esBono } = calcularHorasRegistro(r);
        return [...cols.map((c) => r[c] ?? ""), horas === null ? "" : horas.toFixed(2), diferencia === null ? "" : diferencia.toFixed(2), esBono ? "Si" : "No"];
      },
    }];
  }
  async function exportXlsx() {
    setExportingXlsx(true);
    try {
      await downloadXlsxWorkbook(sheetsAsistencia(), "asistencia");
    } catch (e) {
      console.error("exportXlsx error", e);
      alert("Ocurrió un error al generar la descarga. Intenta nuevamente.");
    } finally {
      setExportingXlsx(false);
    }
  }
  const carpetaLocal = useCarpetaLocal("asistencia");
  useEffect(() => {
    if (!registros) return;
    carpetaLocal.programarGuardado(nombreArchivoAnual("operaciones-asistencia"), sheetsAsistencia);
  }, [registros]);

  const chartPorEstado = useMemo(() => groupAsistenciaBy(filtered, "estado"), [filtered]);
  const chartPorTrabajador = useMemo(() => groupAsistenciaBy(filtered, "trabajador"), [filtered]);

  const mesesResumenAsistencias = useMemo(() => {
    const set = new Set((registros || []).map((r) => (r.fecha || "").slice(0, 7)).filter(Boolean));
    return [...set].sort().reverse();
  }, [registros]);

  const resumenHoras = useMemo(() => {
    const base = mesResumenAsistencias === "todos"
      ? filteredSinMes
      : filteredSinMes.filter((r) => (r.fecha || "").slice(0, 7) === mesResumenAsistencias);
    return resumenHorasPorTrabajador(base);
  }, [filteredSinMes, mesResumenAsistencias]);

  const aniosDisponiblesPeriodo = useMemo(() => {
    const set = new Set((registros || []).map((r) => Number((r.fecha || "").slice(0, 4))).filter(Boolean));
    set.add(Number(todayStr().slice(0, 4)));
    return [...set].sort((a, b) => b - a);
  }, [registros]);

  if (loading || registros === null) {
    return (
      <div style={{ minHeight: 300, display: "flex", alignItems: "center", justifyContent: "center", background: COLORS.bg, borderRadius: 12, color: COLORS.dim, fontFamily: "'Inter',sans-serif", fontSize: 13 }}>
        Conectando con la base de datos compartida…
      </div>
    );
  }

  return (
    <div style={{ background: COLORS.bg, color: COLORS.text, fontFamily: "'Inter',sans-serif", fontSize: 13, padding: isMobile ? 10 : 16, borderRadius: 14 }}>
      <style>{`
        .as-th { position: sticky; top: 0; background: ${COLORS.panel2}; text-align: left; padding: 9px 10px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .5px; color: ${COLORS.dim}; border-bottom: 1px solid ${COLORS.border}; cursor: pointer; user-select: none; white-space: nowrap; }
        .as-th:hover { color: ${COLORS.amber}; }
        .as-td { padding: 8px 10px; border-bottom: 1px solid ${COLORS.grid}; vertical-align: middle; }
        .as-row:hover { background: rgba(77,141,184,.07); cursor: pointer; }
        .as-scroll::-webkit-scrollbar { height: 8px; width: 8px; }
        .as-scroll::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 4px; }
        .as-card { background: ${COLORS.panel2}; border: 1px solid ${COLORS.border}; border-radius: 9px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; cursor: pointer; transition: border-color .15s; }
        .as-card:hover { border-color: ${COLORS.amber}; }
        .as-input { width: 100%; background: ${COLORS.panel2}; border: 1px solid ${COLORS.border}; color: ${COLORS.text}; font-family: 'Inter',sans-serif; font-size: 12.5px; padding: 7px 9px; border-radius: 6px; outline: none; box-sizing: border-box; }
        .as-input:focus { border-color: ${COLORS.amber}; }
      `}</style>

      <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "center", justifyContent: "space-between", background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "14px 18px", marginBottom: 14, flexWrap: "wrap", gap: 12, flexDirection: isMobile ? "column" : "row" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src={LOGO_SHIELD} alt="Operaciones" style={{ width: 40, height: "auto", flexShrink: 0, display: "block" }} />
          <div>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 600 }}>CONTROL DE ASISTENCIA</div>
            <div style={{ fontSize: 11, color: COLORS.dim, display: "flex", alignItems: "center", gap: 4 }}>
              Base de datos compartida en vivo
              <SyncDot syncState={syncState} palette={COLORS} />
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {readOnly && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: COLORS.panel2, color: COLORS.dim, fontSize: 11, padding: "6px 12px", borderRadius: 20, border: `1px solid ${COLORS.border}` }}>
              👁 Solo lectura
            </div>
          )}
          {!readOnly && !canDelete && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: COLORS.panel2, color: COLORS.dim, fontSize: 11, padding: "6px 12px", borderRadius: 20, border: `1px solid ${COLORS.border}` }}>
              ✎ Sin permiso para eliminar
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "10px 18px", marginBottom: 14, flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }} title="Elige el año y luego el mes para ver toda la informacion de esta pagina (tarjetas, tabla, cards y graficos). Por defecto muestra el mes actual.">
          <span style={{ fontSize: 11, color: COLORS.dim, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
            📅 Periodo
          </span>
          <DropdownSelect
            value={mesGlobalAnio}
            onChange={(v) => setMesGlobalAnio(Number(v))}
            options={aniosDisponiblesPeriodo.map((a) => ({ value: a, label: String(a) }))}
            buttonStyle={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 20, color: COLORS.text, fontFamily: "'Inter',sans-serif", fontSize: 12.5, fontWeight: 600, padding: "5px 12px" }}
          />
          <DropdownSelect
            value={mesGlobalMes}
            onChange={(v) => setMesGlobalMes(Number(v))}
            options={MESES_NOMBRES_PERIODO.map((nombre, idx) => ({ value: idx + 1, label: nombre }))}
            buttonStyle={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 20, color: COLORS.text, fontFamily: "'Inter',sans-serif", fontSize: 12.5, fontWeight: 600, padding: "5px 12px" }}
          />
        </div>
        <div style={{ width: 1, alignSelf: "stretch", background: COLORS.border }} />
        <div style={{ display: "flex", alignItems: "center", gap: 9 }} title="Elige un trabajador para ver su Puntualidad, Horas extras, Faltas y Saldo de vacaciones.">
          <span style={{ fontSize: 11, color: COLORS.dim, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
            👤 Trabajador
          </span>
          <DropdownSelect
            value={kpiTecnicoHoras}
            onChange={handleTrabajadorGlobalChange}
            placeholder="Todos"
            options={trabajadores}
            buttonStyle={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 20, color: COLORS.text, fontFamily: "'Inter',sans-serif", fontSize: 12.5, fontWeight: 600, padding: "5px 12px" }}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 14 }}>
        <KpiPuntualidad value={puntualidadKpiValue} />
        <KpiHorasExtra label="Horas Extras a Favor" value={horasExtraKpiValue} />
        <KpiFaltas value={faltasKpiValue} onClick={() => showEstadoKpi("Falta")} active={kpiFilter === "Falta"} />
        <KpiVacaciones value={vacacionesKpiValue} anio={anioActualKpi} />
      </div>

      <FilterBar>
        <input
          className="ct-input2"
          value={search}
          onChange={(e) => wrapFilterChange(setSearch)(e.target.value)}
          placeholder="Buscar trabajador, ubicacion, observacion…"
          style={{ width: isMobile ? "100%" : 230 }}
        />
        <MultiSelect label="Trabajador" allLabel="Trabajador: Todos" options={trabajadores} selected={fTrabajador} onChange={wrapFilterChange(setFTrabajador)} />
        <MultiSelect label="Estado" allLabel="Estado: Todos" options={ESTADOS_ASISTENCIA} selected={fEstado} onChange={wrapFilterChange(setFEstado)} />
        <MultiSelect label="Ubicacion" allLabel="Ubicacion: Todas" options={ubicaciones} selected={fUbicacion} onChange={wrapFilterChange(setFUbicacion)} />
        <MultiSelect label="Turno" allLabel="Turno: Todos" options={TURNOS_ASISTENCIA} selected={fTurno} onChange={wrapFilterChange(setFTurno)} />
        {filtersActive ? (
          <ClearFiltersButton onClick={resetFilters} />
        ) : (
          <div style={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 20, padding: "6px 12px", fontSize: 11.5, color: COLORS.dim }}>
            <b style={{ color: COLORS.amber }}>{sorted.length}</b> de {registros.length} registros
          </div>
        )}
        <div style={{ marginLeft: isMobile ? 0 : "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 7, overflow: "hidden" }}>
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
          <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600 }}>Registros de asistencia ({sorted.length})</h2>
          {!readOnly && (
            <button onClick={openAdd} style={{ display: "flex", alignItems: "center", gap: 6, background: COLORS.amber, color: COLORS.amberText, fontWeight: 600, fontSize: 12.5, padding: "8px 14px", borderRadius: 7, border: "none", cursor: "pointer" }}>
              + Nueva asistencia
            </button>
          )}
        </div>

        {view === "tabla" ? (
          <div className="as-scroll" style={{ overflowX: "auto", maxHeight: 560, overflowY: "auto", borderRadius: 8, border: `1px solid ${COLORS.border}` }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 900 }}>
              <thead>
                <tr>
                  <th className="as-th" onClick={() => toggleSort("trabajador")}>Trabajador</th>
                  <th className="as-th" onClick={() => toggleSort("fecha")}>Fecha</th>
                  <th className="as-th" onClick={() => toggleSort("turno")}>Turno</th>
                  <th className="as-th" onClick={() => toggleSort("horaEntrada")}>Entrada</th>
                  <th className="as-th" onClick={() => toggleSort("horaSalida")}>Salida</th>
                  <th className="as-th">Horas</th>
                  <th className="as-th">Diferencia</th>
                  <th className="as-th" onClick={() => toggleSort("ubicacion")}>Ubicacion</th>
                  <th className="as-th" onClick={() => toggleSort("estado")}>Estado</th>
                  <th className="as-th" style={{ minWidth: 180 }}>Observacion</th>
                  <th className="as-th" style={{ width: 70 }}></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, idx) => {
                  const { horas, diferencia, esBono } = calcularHorasRegistro(r);
                  const dh = rowDrag.getHandlers(idx, r);
                  const isOver = rowDrag.dragOverId === r.id;
                  return (
                  <tr key={r.id} className="as-row" onClick={() => { if (!readOnly) openEdit(r); }} {...dh} style={{ cursor: rowDrag && isAdmin && !readOnly ? "grab" : readOnly ? "default" : "pointer", ...(isOver ? { boxShadow: `inset 0 2px 0 ${COLORS.amber}` } : {}) }}>
                    <td className="as-td">
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <DragHandle show={isAdmin && !readOnly} isMobile={isMobile} color={COLORS.faint} dragProps={rowDrag.getHandleProps(idx)} dragging={rowDrag.armedIndex === idx} canMoveUp={idx > 0} canMoveDown={idx < sorted.length - 1} onMoveUp={() => rowDrag.moveBy(idx, -1, sorted.length)} onMoveDown={() => rowDrag.moveBy(idx, 1, sorted.length)} />
                        <div style={{ width: 18, height: 18, borderRadius: 50, background: colorForContacto(r.trabajador, trabajadores), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8.5, fontWeight: 700, color: COLORS.dark, flexShrink: 0 }}>{initials(r.trabajador)}</div>
                        {r.trabajador || "—"}
                      </div>
                    </td>
                    <td className="as-td">
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        {fmtDate(r.fecha)}
                        {esBono && <span title="Domingo/feriado: horas trabajadas +100% (bono, se suma a horas extra)" style={{ fontSize: 10.5 }}>🎉</span>}
                      </div>
                    </td>
                    <td className="as-td" style={{ textAlign: "center" }}>{r.turno || "—"}</td>
                    <td className="as-td" style={{ fontFamily: "'JetBrains Mono',monospace" }}>{r.horaEntrada || "—"}</td>
                    <td className="as-td" style={{ fontFamily: "'JetBrains Mono',monospace" }}>{r.horaSalida || "—"}</td>
                    <td className="as-td" style={{ fontFamily: "'JetBrains Mono',monospace" }}>{fmtHoras(horas)}</td>
                    <td className="as-td">
                      {diferencia === null ? (
                        <span style={{ color: COLORS.faint, fontSize: 11.5 }}>—</span>
                      ) : diferencia > 0.0084 ? (
                        <Badge text={fmtHoras(diferencia, { signo: true })} colors={{ bg: COLORS.greenDim, fg: COLORS.greenSoft }} />
                      ) : diferencia < -0.0084 ? (
                        <Badge text={fmtHoras(diferencia)} colors={{ bg: COLORS.redDim, fg: COLORS.redSoft }} />
                      ) : (
                        <Badge text={fmtHoras(0)} colors={{ bg: COLORS.panel2, fg: COLORS.dim }} />
                      )}
                    </td>
                    <td className="as-td" style={{ color: COLORS.dim }}>{r.ubicacion || "—"}</td>
                    <td className="as-td"><Badge text={r.estado} colors={estadoAsistenciaColor(r.estado)} /></td>
                    <td className="as-td" style={{ color: COLORS.dim, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.observacion || "—"}</td>
                    <td className="as-td" onClick={(e) => e.stopPropagation()}>
                      {canDelete && (
                        <button onClick={() => setConfirmDelete(r.id)} style={{ background: "transparent", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 13 }} title="Eliminar">🗑</button>
                      )}
                    </td>
                  </tr>
                  );
                })}
                {sorted.length === 0 && (
                  <tr><td className="as-td" colSpan={11} style={{ textAlign: "center", color: COLORS.faint, padding: 24 }}>No hay registros con estos filtros</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ) : view === "tarjetas" ? (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill,minmax(260px,1fr))", gap: 12 }}>
            {sorted.map((r, idx) => {
              const { horas, diferencia, esBono } = calcularHorasRegistro(r);
              const dh = rowDrag.getHandlers(idx, r);
              const isOver = rowDrag.dragOverId === r.id;
              return (
              <div key={r.id} className="as-card" onClick={() => { if (!readOnly) openEdit(r); }} {...dh} style={{ cursor: isAdmin && !readOnly ? "grab" : readOnly ? "default" : "pointer", ...(isOver ? { boxShadow: `inset 0 0 0 2px ${COLORS.amber}` } : {}) }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <DragHandle show={isAdmin && !readOnly} isMobile={isMobile} color={COLORS.faint} dragProps={rowDrag.getHandleProps(idx)} dragging={rowDrag.armedIndex === idx} canMoveUp={idx > 0} canMoveDown={idx < sorted.length - 1} onMoveUp={() => rowDrag.moveBy(idx, -1, sorted.length)} onMoveDown={() => rowDrag.moveBy(idx, 1, sorted.length)} />
                    <div style={{ width: 22, height: 22, borderRadius: 50, background: colorForContacto(r.trabajador, trabajadores), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9.5, fontWeight: 700, color: COLORS.dark, flexShrink: 0 }}>{initials(r.trabajador)}</div>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{r.trabajador || "—"}</span>
                  </div>
                  <Badge text={r.estado} colors={estadoAsistenciaColor(r.estado)} />
                </div>
                <div style={{ fontSize: 11, color: COLORS.dim }}>{r.ubicacion || "Sin ubicacion"}</div>
                {r.observacion && <div style={{ fontSize: 12, lineHeight: 1.3 }}>{r.observacion}</div>}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${COLORS.border}`, paddingTop: 8 }}>
                  <span style={{ fontSize: 11, color: COLORS.faint, display: "flex", alignItems: "center", gap: 4 }}>
                    {fmtDate(r.fecha)} · Turno {r.turno || "—"}
                    {esBono && <span title="Domingo/feriado: horas trabajadas +100% (bono, se suma a horas extra)" style={{ fontSize: 10.5 }}>🎉</span>}
                  </span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, color: COLORS.dim }}>{r.horaEntrada || "—"} – {r.horaSalida || "—"}</span>
                </div>
                {(horas !== null || diferencia !== null) && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: COLORS.dim }}>
                      {horas !== null ? (
                        <>Trabajadas: <b style={{ color: COLORS.text }}>{fmtHoras(horas)}</b></>
                      ) : (
                        "Falta"
                      )}
                    </span>
                    {diferencia > 0.0084 ? (
                      <Badge text={fmtHoras(diferencia, { signo: true })} colors={{ bg: COLORS.greenDim, fg: COLORS.greenSoft }} />
                    ) : diferencia < -0.0084 ? (
                      <Badge text={fmtHoras(diferencia)} colors={{ bg: COLORS.redDim, fg: COLORS.redSoft }} />
                    ) : (
                      <Badge text={fmtHoras(0)} colors={{ bg: COLORS.panel2, fg: COLORS.dim }} />
                    )}
                  </div>
                )}
              </div>
              );
            })}
            {sorted.length === 0 && (
              <div style={{ gridColumn: "1/-1", textAlign: "center", color: COLORS.faint, padding: 24 }}>No hay registros con estos filtros</div>
            )}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2,1fr)", gap: 12 }}>
            <ChartPanel title="Registros por estado">
              <MiniBarChart data={chartPorEstado} valueKey="count" formatValue={(v) => `${v}`} barColor={COLORS.amber} />
            </ChartPanel>
            <ChartPanel title="Registros por trabajador">
              <MiniBarChart data={chartPorTrabajador} valueKey="count" formatValue={(v) => `${v}`} barColor={COLORS.green} />
            </ChartPanel>
          </div>
        )}
      </div>

      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "16px 18px", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600 }}>RESUMEN ASISTENCIAS</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: COLORS.faint }}>Jornada base: {JORNADA_HORAS_ASISTENCIA}h/dia · segun filtros aplicados</span>
            <div title="Filtrar el resumen por mes">
              <DropdownSelect
                buttonClassName="as-input"
                value={mesResumenAsistencias}
                onChange={setMesResumenAsistencias}
                buttonStyle={{ fontSize: 11.5, padding: "4px 8px", width: "auto" }}
                wrapperStyle={{ width: "auto" }}
                options={[{ value: "todos", label: "Todos los meses" }, ...mesesResumenAsistencias.map((ym) => ({ value: ym, label: monthLabel(ym) }))]}
              />
            </div>
          </div>
        </div>
        <div className="as-scroll" style={{ overflowX: "auto", borderRadius: 8, border: `1px solid ${COLORS.border}` }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 640 }}>
            <thead>
              <tr>
                <th className="as-th">Trabajador</th>
                <th className="as-th" style={{ textAlign: "right" }}>DIAS TRABAJADOS</th>
                <th className="as-th" style={{ textAlign: "right" }}>Horas trabajadas</th>
                <th className="as-th" style={{ textAlign: "right" }}>Horas esperadas</th>
                <th className="as-th" style={{ textAlign: "right" }}>Faltas</th>
                <th className="as-th">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {resumenHoras.map((rt) => (
                <tr key={rt.trabajador} className="as-row">
                  <td className="as-td">
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 18, height: 18, borderRadius: 50, background: colorForContacto(rt.trabajador, trabajadores), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8.5, fontWeight: 700, color: COLORS.dark, flexShrink: 0 }}>{initials(rt.trabajador)}</div>
                      {rt.trabajador}
                    </div>
                  </td>
                  <td className="as-td" style={{ textAlign: "right", color: COLORS.dim }}>{rt.diasConHorario}</td>
                  <td className="as-td" style={{ textAlign: "right", fontFamily: "'JetBrains Mono',monospace" }}>{fmtHoras(rt.horasTrabajadas)}</td>
                  <td className="as-td" style={{ textAlign: "right", fontFamily: "'JetBrains Mono',monospace", color: COLORS.dim }}>{fmtHoras(rt.horasEsperadas)}</td>
                  <td className="as-td" style={{ textAlign: "right" }}>
                    {rt.diasFalta > 0 ? (
                      <span
                        onClick={() => { resetFilters(); setFTrabajador([canonicalPersonName(rt.trabajador, trabajadores)]); setFEstado(["Falta"]); setKpiFilter("Falta"); }}
                        title="Ver faltas de este trabajador"
                        style={{ cursor: "pointer", color: COLORS.redSoft, fontWeight: 600 }}
                      >
                        {rt.diasFalta}
                      </span>
                    ) : (
                      <span style={{ color: COLORS.faint }}>0</span>
                    )}
                  </td>
                  <td className="as-td">
                    {Math.abs(rt.diferencia) < 0.0084 ? (
                      <Badge text={fmtHoras(0)} colors={{ bg: COLORS.panel2, fg: COLORS.dim }} />
                    ) : rt.diferencia > 0 ? (
                      <Badge text={fmtHoras(rt.diferencia, { signo: true })} colors={{ bg: COLORS.greenDim, fg: COLORS.greenSoft }} />
                    ) : (
                      <Badge text={fmtHoras(rt.diferencia)} colors={{ bg: COLORS.redDim, fg: COLORS.redSoft }} />
                    )}
                  </td>
                </tr>
              ))}
              {resumenHoras.length === 0 && (
                <tr><td className="as-td" colSpan={6} style={{ textAlign: "center", color: COLORS.faint, padding: 24 }}>No hay registros con estos filtros</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }} onClick={() => setShowAdd(false)}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 22, width: 520, maxWidth: "100%", maxHeight: "85vh", overflowY: "auto", boxSizing: "border-box" }} className="as-scroll" onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: 15 }}>Nueva asistencia</div>
              <button onClick={() => setShowAdd(false)} style={{ background: "transparent", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            <AsistenciaForm value={draftAdd} onChange={setDraftAdd} trabajadores={trabajadores} ubicacionSedes={ubicacionSedes} />
            {trabajadores.length === 0 && (
              <div style={{ fontSize: 11, color: COLORS.faint, marginTop: 10 }}>Aun no tienes trabajadores registrados. Puedes escribir el nombre directamente o agregarlos primero desde "Trabajadores".</div>
            )}
            {(draftAdd.estado === "Presente" || draftAdd.estado === "Permiso") && !asistenciaDraftValido(draftAdd, ubicacionSedes) && (
              <div style={{ fontSize: 11, color: COLORS.redSoft, marginTop: 10 }}>Completa trabajador, fecha, hora de entrada y ubicacion de obra para poder guardar.</div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${COLORS.border}` }}>
              <button onClick={() => setShowAdd(false)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, padding: "8px 16px", borderRadius: 7, fontSize: 12.5, cursor: "pointer" }}>Cancelar</button>
              <button onClick={submitAdd} disabled={!asistenciaDraftValido(draftAdd, ubicacionSedes)} style={{ background: asistenciaDraftValido(draftAdd, ubicacionSedes) ? COLORS.amber : COLORS.panel2, color: asistenciaDraftValido(draftAdd, ubicacionSedes) ? COLORS.amberText : COLORS.faint, border: "none", padding: "8px 16px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: asistenciaDraftValido(draftAdd, ubicacionSedes) ? "pointer" : "default" }}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {editingId && draftEdit && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }} onClick={cerrarEditAsistencia}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 22, width: 520, maxWidth: "100%", maxHeight: "85vh", overflowY: "auto", boxSizing: "border-box" }} className="as-scroll" onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: 15 }}>Editar asistencia</div>
              <button onClick={cerrarEditAsistencia} style={{ background: "transparent", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            <AsistenciaForm value={draftEdit} onChange={setDraftEdit} trabajadores={trabajadores} ubicacionSedes={ubicacionSedes} />
            {(draftEdit.estado === "Presente" || draftEdit.estado === "Permiso") && !asistenciaDraftValido(draftEdit, ubicacionSedes) && (
              <div style={{ fontSize: 11, color: COLORS.redSoft, marginTop: 10 }}>Completa trabajador, fecha, hora de entrada y ubicacion de obra para poder guardar.</div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${COLORS.border}` }}>
              {canDelete ? (
                <button onClick={() => { setConfirmDelete(editingId); setEditingId(null); }} style={{ background: "transparent", border: `1px solid ${COLORS.red}`, color: COLORS.red, padding: "8px 16px", borderRadius: 7, fontSize: 12.5, cursor: "pointer" }}>Eliminar</button>
              ) : <span />}
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={cerrarEditAsistencia} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, padding: "8px 16px", borderRadius: 7, fontSize: 12.5, cursor: "pointer" }}>Cancelar</button>
                <button onClick={submitEdit} disabled={!asistenciaDraftValido(draftEdit, ubicacionSedes)} style={{ background: asistenciaDraftValido(draftEdit, ubicacionSedes) ? COLORS.amber : COLORS.panel2, color: asistenciaDraftValido(draftEdit, ubicacionSedes) ? COLORS.amberText : COLORS.faint, border: "none", padding: "8px 16px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: asistenciaDraftValido(draftEdit, ubicacionSedes) ? "pointer" : "default" }}>Guardar cambios</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110, padding: 16 }} onClick={() => setConfirmDelete(null)}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 22, width: 360, maxWidth: "100%", boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Eliminar registro</div>
            <div style={{ fontSize: 12.5, color: COLORS.dim, marginBottom: 18 }}>Esta accion no se puede deshacer. ¿Deseas continuar?</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setConfirmDelete(null)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, padding: "8px 16px", borderRadius: 7, fontSize: 12.5, cursor: "pointer" }}>Cancelar</button>
              <button onClick={() => doDelete(confirmDelete)} style={{ background: COLORS.red, color: COLORS.white, border: "none", padding: "8px 16px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Eliminar</button>
            </div>
          </div>
        </div>
      )}

      {sustentoGate.modal}
    </div>
  );
}


export { AsistenciaForm, ControlAsistencia };
