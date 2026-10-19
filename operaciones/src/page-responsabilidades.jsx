import { useState, useEffect, useMemo, useRef } from "react";
import * as C from "./core-common";
const {
  classifySyncError,
  SyncDot,
  FilterBar,
  scrollFieldIntoViewOnFocus,
  mutateStorageJSON,
  LOGO_SHIELD,
  COLORS,
  initials,
  colorForContacto,
  normalizePersonKey,
  canonicalPersonName,
  downloadXlsxWorkbook,
  useCarpetaLocal,
  BotonCarpetaLocal,
  nombreArchivoAnual,
  uid,
  reorderWithinFull,
  DragHandle,
  MultiSelect,
  Kpi,
  RESPONSABILIDADES_SEED,
  STORAGE_KEY_RESPONSABILIDADES,
  emptyRespDraft,
  RespForm,
  intentarGuardarConAprobacion,
  intentarEliminarConAprobacion,
  useSustentoGate,
  filterOwnRecords,
  useAutoSaveOnLeave
} = C;

function ControlResponsabilidades({ isAdmin = false, puedeEditar = true, puedeAgregar = true, puedeEliminar = true, puedeExportar = true, puedeAprobar = false, me = "", ownerIdentity = "", puedeVerTodos = true } = {}) {
  const sustentoGate = useSustentoGate();
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [syncState, setSyncState] = useState("pendiente");
  const [search, setSearch] = useState("");
  const [fArea, setFArea] = useState([]);
  const [fResponsable, setFResponsable] = useState([]);
  const [soloPendientes, setSoloPendientes] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [draftAdd, setDraftAdd] = useState(emptyRespDraft());
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
    async function loadItems() {
      try {
        const res = await window.storage.get(STORAGE_KEY_RESPONSABILIDADES, true);
        const data = JSON.parse(res.value);
        const hasData = Array.isArray(data) && data.length > 0;
        if (cancelado) return;
        if (hasData) {
          setItems(data.map((i) => ({ ...i, responsable: String(i.responsable || "").trim().replace(/\s+/g, " ") })));
        } else if (isAdmin) {
          const seeded = RESPONSABILIDADES_SEED.map((i) => ({ ...i, responsable: String(i.responsable || "").trim().replace(/\s+/g, " ") }));
          setItems(seeded);
          try { await window.storage.set(STORAGE_KEY_RESPONSABILIDADES, JSON.stringify(seeded), true); } catch (_) { console.error(_); }
        } else {
          setItems(Array.isArray(data) ? data : []);
        }
        setSyncState("ok");
      } catch (e) {
        if (cancelado) return;
        if (isAdmin) {
          setItems(RESPONSABILIDADES_SEED);
          try { await window.storage.set(STORAGE_KEY_RESPONSABILIDADES, JSON.stringify(RESPONSABILIDADES_SEED), true); } catch (_) { console.error(_); }
          setSyncState("ok");
        } else {
          setItems([]);
          setSyncState(classifySyncError(e));
        }
      }
      setLoading(false);
    }
    loadItems();
    const onPropuestasChanged = () => loadItems();
    window.addEventListener("wilarcon:propuestas-changed", onPropuestasChanged);
    return () => { cancelado = true; window.removeEventListener("wilarcon:propuestas-changed", onPropuestasChanged); };
  }, [isAdmin]);

  async function persist(next, intent) {
    if (typeof next === "function") {
      try {
        const applied = await mutateStorageJSON(STORAGE_KEY_RESPONSABILIDADES, [], (current) => next(Array.isArray(current) ? current : []), 4, intent);
        setItems(applied);
        setSyncState("ok");
        return applied;
      } catch (e) {
        console.error(e);
        setSyncState(classifySyncError(e));
        alert("No se pudo guardar el cambio: otro usuario modificó estos registros al mismo tiempo y los reintentos automáticos no lograron aplicarlo. Recarga la página e inténtalo de nuevo.");
        return;
      }
    }
    setItems(next);
    try { await window.storage.set(STORAGE_KEY_RESPONSABILIDADES, JSON.stringify(next), { intent }); setSyncState("ok"); } catch (e) { console.error(e); setSyncState(classifySyncError(e)); }
  }

  // Migración retroactiva a mayúsculas (v3.5.31): normaliza lo ya guardado en minúscula o mixtas.
  useEffect(() => {
    if (!isAdmin) return;
    persist((current) => {
      const list = Array.isArray(current) ? current : [];
      const up = (v) => (typeof v === "string" ? v.toUpperCase() : v);
      const normalized = list.map((i) => ({ ...i, area: up(i.area), tarea: up(i.tarea), responsable: up(i.responsable), nota: up(i.nota) }));
      return JSON.stringify(normalized) !== JSON.stringify(list) ? normalized : undefined;
    }, "migracion-mayusculas-responsabilidades");
  }, [isAdmin]);

  const itemsVisibles = useMemo(() => (
    puedeVerTodos ? (items || []) : filterOwnRecords(items || [], ownerIdentity, "responsable")
  ), [items, puedeVerTodos, ownerIdentity]);

  const areasDisponibles = useMemo(() => Array.from(new Set(itemsVisibles.map((i) => i.area).filter(Boolean))), [itemsVisibles]);
  const responsablesDisponibles = useMemo(() => { const out=[]; const seen=new Set(); itemsVisibles.forEach((i)=>{ const raw=String(i.responsable||"").trim() || "(sin asignar)"; const key=normalizePersonKey(raw); if(!seen.has(key)){seen.add(key);out.push(raw);} }); return out.sort((a,b)=>a.localeCompare(b,"es",{sensitivity:"base"})); }, [itemsVisibles]);

  // Al ingresar, un trabajador (no admin) ve el filtro "Responsable" ya puesto en su propio
  // nombre en vez de "Todos". Solo se aplica una vez para no pisar un cambio manual posterior,
  // y solo si su nombre calza con alguno de los responsables disponibles.
  const appliedOwnResponsableFilter = useRef(false);
  useEffect(() => {
    if (appliedOwnResponsableFilter.current) return;
    if (isAdmin || !ownerIdentity || !responsablesDisponibles.length) return;
    const propio = responsablesDisponibles.find((r) => normalizePersonKey(r) === normalizePersonKey(ownerIdentity));
    if (propio) {
      setFResponsable([propio]);
      appliedOwnResponsableFilter.current = true;
    }
  }, [isAdmin, ownerIdentity, responsablesDisponibles]);

  const filtered = useMemo(() => {
    let list = itemsVisibles;
    if (fArea.length) list = list.filter((i) => fArea.includes(i.area));
    if (fResponsable.length) list = list.filter((i) => fResponsable.some((x) => normalizePersonKey(x) === normalizePersonKey(i.responsable || "(sin asignar)")));
    if (soloPendientes) list = list.filter((i) => !i.hecho);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((i) => [i.tarea, i.responsable, i.nota].some((v) => (v || "").toLowerCase().includes(q)));
    return list;
  }, [itemsVisibles, fArea, fResponsable, soloPendientes, search]);

  const grouped = useMemo(() => {
    const map = {};
    filtered.forEach((i) => { (map[i.area || "Sin área"] = map[i.area || "Sin área"] || []).push(i); });
    return map;
  }, [filtered]);

  const kpis = useMemo(() => {
    const list = itemsVisibles;
    const hechos = list.filter((i) => i.hecho).length;
    return { total: list.length, hechos, pendientes: list.length - hechos, areas: areasDisponibles.length };
  }, [itemsVisibles, areasDisponibles]);

  async function toggleHecho(id) {
    if (!puedeEditar) return;
    const original = (items || []).find((i) => i.id === id);
    if (!original) return;
    const propuesto = { ...original, hecho: !original.hecho, _updatedAt: Date.now() };
    await intentarGuardarConAprobacion({
      puedeAprobar, modulo: "responsabilidades", moduloLabel: "Responsabilidades",
      storageKey: STORAGE_KEY_RESPONSABILIDADES, idField: "id", recordId: id,
      original, propuesto, autor: me,
      labels: { area: "Área", tarea: "Tarea", responsable: "Responsable", nota: "Nota", hecho: "Completado" },
      persistDirecto: (intent) => persist((current) => current.map((i) => (i.id === id ? propuesto : i)), intent),
      pedirSustento: sustentoGate.solicitar,
    });
  }
  function openAdd(area) { if (!puedeAgregar) return; setDraftAdd(emptyRespDraft(area)); setShowAdd(true); }
  async function confirmAdd() {
    if (!puedeAgregar) return;
    const rec = { ...draftAdd, id: uid(), responsable: canonicalPersonName(draftAdd.responsable, responsablesDisponibles) };
    await persist((current) => [rec, ...current], "crear");
    setShowAdd(false);
  }
  function openEdit(r) { if (!puedeEditar) return; setEditingId(r.id); setDraftEdit({ ...r }); }
  async function persistEditResp(draftToSave) {
    const propuesto = { ...draftToSave, responsable: canonicalPersonName(draftToSave.responsable, responsablesDisponibles) };
    const original = (items || []).find((i) => i.id === editingId);
    await intentarGuardarConAprobacion({
      puedeAprobar, modulo: "responsabilidades", moduloLabel: "Responsabilidades",
      storageKey: STORAGE_KEY_RESPONSABILIDADES, idField: "id", recordId: editingId,
      original, propuesto, autor: me,
      labels: { area: "Área", tarea: "Tarea", responsable: "Responsable", nota: "Nota", hecho: "Hecho" },
      persistDirecto: (intent) => persist((current) => current.map((i) => (i.id === editingId ? propuesto : i)), intent),
      pedirSustento: sustentoGate.solicitar,
    });
  }
  // Autoguardado: guarda lo editado si el usuario cambia de pestaña, oculta la
  // ventana o cierra el formulario sin apretar "Guardar".
  const autoSaveEditResp = useAutoSaveOnLeave({
    active: !!editingId && puedeEditar,
    draft: draftEdit,
    saveFn: persistEditResp,
  });
  async function cerrarEditResp() { await autoSaveEditResp(); setEditingId(null); setDraftEdit(null); }
  async function confirmEdit() {
    if (!puedeEditar) return;
    await persistEditResp(draftEdit);
    setEditingId(null); setDraftEdit(null);
  }
  async function doDelete(id) {
    if (!puedeEliminar) return;
    const registro = (items || []).find((i) => i.id === id);
    await intentarEliminarConAprobacion({
      puedeAprobar, modulo: "responsabilidades", moduloLabel: "Responsabilidades",
      storageKey: STORAGE_KEY_RESPONSABILIDADES, idField: "id", recordId: id, autor: me,
      resumen: registro ? `${registro.tarea || ""} — ${registro.responsable || ""}` : `registro ${id}`,
      persistDirecto: (intent) => persist((current) => current.filter((i) => i.id !== id), intent),
      pedirSustento: sustentoGate.solicitar,
    });
    setConfirmDelete(null);
  }

  function sheetsResponsabilidades() {
    return [{ name: "Responsabilidades", records: filtered, headers: ["Área", "Tarea", "Responsable", "Nota", "Estado"], rowMapper: (i) => [i.area, i.tarea, i.responsable, i.nota, i.hecho ? "Completado" : "Pendiente"] }];
  }
  async function exportXlsx() {
    setExportingXlsx(true);
    try {
      await downloadXlsxWorkbook(sheetsResponsabilidades(), "responsabilidades");
    } catch (e) {
      console.error("exportXlsx error", e);
      alert("Ocurrió un error al generar la descarga. Intenta nuevamente.");
    } finally {
      setExportingXlsx(false);
    }
  }
  const carpetaLocal = useCarpetaLocal("responsabilidades");
  useEffect(() => {
    if (!items) return;
    carpetaLocal.programarGuardado(nombreArchivoAnual("operaciones-responsabilidades"), sheetsResponsabilidades);
  }, [items]);

  const respDragRef = useRef(null);
  const [respArmed, setRespArmed] = useState(null);
  const [respOverId, setRespOverId] = useState(null);
  function handleGroupReorder(area, groupItems, fromIdx, toIdx) {
    const next = reorderWithinFull(items || [], groupItems, fromIdx, toIdx, "id");
    persist(next);
  }
  // Fallback para celular: el arrastre nativo de abajo no responde al dedo, así que esto
  // mueve la fila un puesto arriba/abajo dentro de su misma área con un toque.
  function moveRespBy(area, index, delta, groupItems) {
    if (!isAdmin) return;
    const target = index + delta;
    if (target < 0 || target >= groupItems.length) return;
    handleGroupReorder(area, groupItems, index, target);
  }
  function respHandleProps(area, index) {
    if (!isAdmin) return {};
    return {
      onMouseDown: (e) => { e.stopPropagation(); setRespArmed({ area, index }); },
      onMouseUp: (e) => { e.stopPropagation(); setRespArmed(null); },
      onTouchStart: (e) => { e.stopPropagation(); setRespArmed({ area, index }); },
      onTouchEnd: (e) => { e.stopPropagation(); setRespArmed(null); },
      onClick: (e) => { e.stopPropagation(); },
    };
  }
  function respRowProps(area, index, item, groupItems) {
    if (!isAdmin) return {};
    return {
      draggable: !!respArmed && respArmed.area === area && respArmed.index === index,
      onDragStart: (e) => {
        respDragRef.current = { area, index };
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", String(item.id)); } catch (_) { console.error(_); }
      },
      onDragEnter: (e) => {
        if (respDragRef.current && respDragRef.current.area === area) {
          e.preventDefault();
          setRespOverId(item.id);
        }
      },
      onDragOver: (e) => {
        if (respDragRef.current && respDragRef.current.area === area) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      },
      onDragLeave: () => setRespOverId((cur) => (cur === item.id ? null : cur)),
      onDrop: (e) => {
        const from = respDragRef.current;
        respDragRef.current = null;
        setRespOverId(null);
        setRespArmed(null);
        if (!from || from.area !== area) return;
        e.preventDefault();
        if (from.index === index) return;
        handleGroupReorder(area, groupItems, from.index, index);
      },
      onDragEnd: () => {
        respDragRef.current = null;
        setRespOverId(null);
        setRespArmed(null);
      },
    };
  }

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
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 600 }}>RESPONSABILIDADES</div>
            <div style={{ fontSize: 11, color: COLORS.dim, display: "flex", alignItems: "center", gap: 4 }}>
              Base de datos compartida en vivo
              <SyncDot syncState={syncState} palette={COLORS} />
            </div>
          </div>
        </div>
      </div>

      <FilterBar>
        <input className="ct-input2" placeholder="Buscar tarea, responsable, nota…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 260 }} />
        <MultiSelect label="Área" allLabel="Todas" options={areasDisponibles} selected={fArea} onChange={setFArea} />
        <MultiSelect label="Responsable" allLabel="Todos" options={responsablesDisponibles} selected={fResponsable} onChange={setFResponsable} />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: COLORS.dim, cursor: "pointer" }}>
          <input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} />
          Solo pendientes
        </label>
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 18 }}>
        <Kpi label="Total" value={String(kpis.total)} tone="blue" title="Total de responsabilidades registradas (no depende de los filtros aplicados a la tabla)." />
        <Kpi label="Completadas" value={String(kpis.hechos)} tone="green" title="Responsabilidades completadas en total (no depende de los filtros aplicados a la tabla)." />
        <Kpi label="Pendientes" value={String(kpis.pendientes)} tone="red" title="Responsabilidades pendientes en total (no depende de los filtros aplicados a la tabla)." />
        <Kpi label="Áreas" value={String(kpis.areas)} tone="amber" title="Áreas distintas registradas en total (no depende de los filtros aplicados a la tabla)." />
      </div>

      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "16px 18px", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600 }}>Registros ({filtered.length})</h2>
          <button onClick={() => openAdd()} style={{ display: "flex", alignItems: "center", gap: 6, background: COLORS.amber, color: COLORS.amberText, fontWeight: 600, fontSize: 12.5, padding: "8px 14px", borderRadius: 7, border: "none", cursor: "pointer" }}>
            + Nueva responsabilidad
          </button>
        </div>

      {Object.keys(grouped).length === 0 && (
        <div style={{ textAlign: "center", color: COLORS.faint, padding: 30 }}>Sin resultados</div>
      )}

      {Object.keys(grouped).map((area) => (
        <div key={area} style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: COLORS.amber, textTransform: "uppercase", letterSpacing: 0.5 }}>{area}</div>
            <div style={{ fontSize: 11, color: COLORS.faint }}>{grouped[area].length} tarea{grouped[area].length !== 1 ? "s" : ""}</div>
            {puedeAgregar && <button onClick={() => openAdd(area)} style={{ marginLeft: "auto", background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, borderRadius: 6, padding: "3px 9px", fontSize: 11, cursor: "pointer" }}>+ Agregar aquí</button>}
          </div>
          <div className="ct-scroll" style={{ overflowX: "auto", border: `1px solid ${COLORS.border}`, borderRadius: 9 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", background: COLORS.panel }}>
              <thead>
                <tr>
                  <th className="ct-th" style={{ width: 40 }}></th>
                  <th className="ct-th">Tarea</th>
                  <th className="ct-th">Responsable</th>
                  <th className="ct-th">Nota</th>
                  <th className="ct-th" style={{ width: 90 }}></th>
                </tr>
              </thead>
              <tbody>
                {grouped[area].map((i, idx) => {
                  const rp = respRowProps(area, idx, i, grouped[area]);
                  const isOver = respOverId === i.id;
                  return (
                  <tr key={i.id} className="ct-row" onClick={() => openEdit(i)} {...rp} style={isOver ? { boxShadow: `inset 0 2px 0 ${COLORS.amber}` } : undefined}>
                    <td className="ct-td" onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <DragHandle show={isAdmin} isMobile={isMobile} color={COLORS.faint} dragProps={respHandleProps(area, idx)} dragging={!!respArmed && respArmed.area === area && respArmed.index === idx} canMoveUp={idx > 0} canMoveDown={idx < grouped[area].length - 1} onMoveUp={() => moveRespBy(area, idx, -1, grouped[area])} onMoveDown={() => moveRespBy(area, idx, 1, grouped[area])} />
                        <input type="checkbox" checked={!!i.hecho} disabled={!puedeEditar} onChange={() => toggleHecho(i.id)} />
                      </div>
                    </td>
                    <td className="ct-td" style={{ whiteSpace: "pre-wrap", textDecoration: i.hecho ? "line-through" : "none", color: i.hecho ? COLORS.faint : COLORS.text }}>{i.tarea}</td>
                    <td className="ct-td">
                      {i.responsable ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 18, height: 18, borderRadius: 50, background: colorForContacto(i.responsable, responsablesDisponibles), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8.5, fontWeight: 700, color: COLORS.dark, flexShrink: 0 }}>{initials(i.responsable)}</div>
                          {i.responsable}
                        </div>
                      ) : <span style={{ color: COLORS.faint }}>Sin asignar</span>}
                    </td>
                    <td className="ct-td" style={{ color: COLORS.dim }}>{i.nota || "—"}</td>
                    <td className="ct-td" onClick={(e) => e.stopPropagation()}>
                      {puedeEliminar && <button onClick={() => setConfirmDelete(i.id)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.faint, borderRadius: 6, padding: "4px 8px", fontSize: 11, cursor: "pointer" }}>Eliminar</button>}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      </div>

      {showAdd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setShowAdd(false)}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 18, width: 440, maxWidth: "92vw" }} onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, marginBottom: 12 }}>Nueva responsabilidad</div>
            <RespForm value={draftAdd} onChange={setDraftAdd} areasDisponibles={areasDisponibles} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button onClick={() => setShowAdd(false)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, borderRadius: 7, padding: "7px 14px", fontSize: 12.5, cursor: "pointer" }}>Cancelar</button>
              <button onClick={confirmAdd} style={{ background: COLORS.amber, color: COLORS.amberText, border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {editingId && draftEdit && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={cerrarEditResp}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 18, width: 440, maxWidth: "92vw" }} onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, marginBottom: 12 }}>Editar responsabilidad</div>
            <RespForm value={draftEdit} onChange={setDraftEdit} areasDisponibles={areasDisponibles} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button onClick={cerrarEditResp} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, borderRadius: 7, padding: "7px 14px", fontSize: 12.5, cursor: "pointer" }}>Cancelar</button>
              <button onClick={confirmEdit} style={{ background: COLORS.amber, color: COLORS.amberText, border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Guardar cambios</button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setConfirmDelete(null)}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 18, width: 320, maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ fontSize: 13.5, color: COLORS.text, marginBottom: 14 }}>¿Eliminar esta responsabilidad?</div>
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


export { RespForm, ControlResponsabilidades };
