import { useState, useEffect, useMemo } from "react";
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
  downloadXlsxWorkbook,
  useCarpetaLocal,
  BotonCarpetaLocal,
  nombreArchivoAnual,
  uid,
  reorderWithinFull,
  useRowDrag,
  DragHandle,
  CONTACTOS_SEED,
  STORAGE_KEY_CONTACTOS,
  STORAGE_KEY_CUENTAS,
  emptyContactoDraft,
  emptyCuentaDraft,
  intentarGuardarConAprobacion,
  intentarEliminarConAprobacion,
  useSustentoGate,
  useAutoSaveOnLeave
} = C;

function DraftForm({ value, onChange, fields }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {fields.map((f) => (
        <div key={f.key}>
          <div style={{ fontSize: 10, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>{f.label}</div>
          <input
            className="ct-input2"
            type="text"
            value={value[f.key] ?? ""}
            onChange={(e) => onChange({ ...value, [f.key]: f.noUppercase ? e.target.value : e.target.value.toUpperCase() })}
          />
        </div>
      ))}
    </div>
  );
}

function ContactosCuentas({ isAdmin = false, puedeEditar = true, puedeAgregar = true, puedeEliminar = true, puedeExportar = true, puedeAprobar = false, me = "" } = {}) {
  const sustentoGate = useSustentoGate();
  const [tab, setTab] = useState("contactos");
  const [contactos, setContactos] = useState(null);
  const [cuentas, setCuentas] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [syncState, setSyncState] = useState("pendiente");
  const [search, setSearch] = useState("");

  const [showAdd, setShowAdd] = useState(false);
  const [draftAdd, setDraftAdd] = useState(emptyContactoDraft());
  const [editingId, setEditingId] = useState(null);
  const [draftEdit, setDraftEdit] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
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
      try {
        const res = await window.storage.get(STORAGE_KEY_CONTACTOS, true);
        const data = JSON.parse(res.value);
        const hasData = Array.isArray(data) && data.length > 0;
        if (cancelado) return;
        if (hasData) {
          setContactos(data);
        } else if (isAdmin) {
          setContactos(CONTACTOS_SEED);
          try { await window.storage.set(STORAGE_KEY_CONTACTOS, JSON.stringify(CONTACTOS_SEED), true); } catch (_) { console.error(_); }
        } else {
          setContactos(Array.isArray(data) ? data : []);
        }
        setSyncState("ok");
      } catch (e) {
        if (cancelado) return;
        if (isAdmin) {
          setContactos(CONTACTOS_SEED);
          try { await window.storage.set(STORAGE_KEY_CONTACTOS, JSON.stringify(CONTACTOS_SEED), true); } catch (_) { console.error(_); }
          setSyncState("ok");
        } else {
          setContactos([]);
          setSyncState(classifySyncError(e));
        }
      }
      try {
        const res2 = await window.storage.get(STORAGE_KEY_CUENTAS, true);
        const data2 = JSON.parse(res2.value);
        if (!cancelado) setCuentas(Array.isArray(data2) ? data2 : []);
      } catch (e) {
        console.error("carga de cuentas: fallo", e);
        if (!cancelado) setCuentas([]);
      }
      setLoading(false);
    }
    loadAll();
    const onPropuestasChanged = () => loadAll();
    window.addEventListener("wilarcon:propuestas-changed", onPropuestasChanged);
    return () => { cancelado = true; window.removeEventListener("wilarcon:propuestas-changed", onPropuestasChanged); };
  }, [isAdmin]);

  async function persistContactos(next, intent) {
    if (typeof next === "function") {
      try {
        const applied = await mutateStorageJSON(STORAGE_KEY_CONTACTOS, [], (current) => next(Array.isArray(current) ? current : []), 4, intent);
        setContactos(applied);
        setSyncState("ok");
        return applied;
      } catch (e) {
        console.error(e);
        setSyncState(classifySyncError(e));
        alert("No se pudo guardar el cambio: otro usuario modificó los contactos al mismo tiempo y los reintentos automáticos no lograron aplicarlo. Recarga la página e inténtalo de nuevo.");
        return;
      }
    }
    setContactos(next);
    try { await window.storage.set(STORAGE_KEY_CONTACTOS, JSON.stringify(next), { intent }); setSyncState("ok"); } catch (e) { console.error(e); setSyncState(classifySyncError(e)); }
  }
  async function persistCuentas(next, intent) {
    if (typeof next === "function") {
      try {
        const applied = await mutateStorageJSON(STORAGE_KEY_CUENTAS, [], (current) => next(Array.isArray(current) ? current : []), 4, intent);
        setCuentas(applied);
        setSyncState("ok");
        return applied;
      } catch (e) {
        console.error(e);
        setSyncState(classifySyncError(e));
        alert("No se pudo guardar el cambio: otro usuario modificó las cuentas al mismo tiempo y los reintentos automáticos no lograron aplicarlo. Recarga la página e inténtalo de nuevo.");
        return;
      }
    }
    setCuentas(next);
    try { await window.storage.set(STORAGE_KEY_CUENTAS, JSON.stringify(next), { intent }); setSyncState("ok"); } catch (e) { console.error(e); setSyncState(classifySyncError(e)); }
  }

  // Migración retroactiva a mayúsculas (v3.5.31): normaliza lo ya guardado en minúscula o mixtas.
  useEffect(() => {
    if (!isAdmin) return;
    const up = (v) => (typeof v === "string" ? v.toUpperCase() : v);
    persistContactos((current) => {
      const list = Array.isArray(current) ? current : [];
      const normalized = list.map((c) => ({ ...c, contacto: up(c.contacto), cargo: up(c.cargo), direccion: up(c.direccion), telefono: up(c.telefono) }));
      return JSON.stringify(normalized) !== JSON.stringify(list) ? normalized : undefined;
    }, "migracion-mayusculas-contactos");
    persistCuentas((current) => {
      const list = Array.isArray(current) ? current : [];
      const normalized = list.map((c) => ({ ...c, nombre: up(c.nombre), banco: up(c.banco) }));
      return JSON.stringify(normalized) !== JSON.stringify(list) ? normalized : undefined;
    }, "migracion-mayusculas-cuentas");
  }, [isAdmin]);

  function sheetsContactosCuentas() {
    return [
      { name: "Contactos", records: contactos || [], headers: ["Contacto", "Cargo", "Dirección", "Teléfono"], rowMapper: (c) => [c.contacto, c.cargo, c.direccion, c.telefono] },
      { name: "Proveedores", records: cuentas || [], headers: ["Nombre", "RUC", "Teléfono", "Banco", "N° Cuenta"], rowMapper: (c) => [c.nombre, c.ruc, c.telefono, c.banco, c.numeroCuenta] },
    ];
  }
  async function exportXlsx() {
    setExportingXlsx(true);
    try {
      await downloadXlsxWorkbook(sheetsContactosCuentas(), "contactos-y-cuentas");
    } catch (e) {
      console.error("exportXlsx error", e);
      alert("Ocurrió un error al generar la descarga. Intenta nuevamente.");
    } finally {
      setExportingXlsx(false);
    }
  }
  const carpetaLocal = useCarpetaLocal("contactos");
  useEffect(() => {
    if (!contactos && !cuentas) return;
    carpetaLocal.programarGuardado(nombreArchivoAnual("operaciones-contactos-y-cuentas"), sheetsContactosCuentas);
  }, [contactos, cuentas]);

  const isContactos = tab === "contactos";
  const nombresContactos = useMemo(() => (contactos || []).map((c) => c.contacto), [contactos]);

  const filtered = useMemo(() => {
    const list = isContactos ? (contactos || []) : (cuentas || []);
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) => {
      const hay = isContactos ? [r.contacto, r.cargo, r.direccion, r.telefono] : [r.nombre, r.ruc, r.telefono, r.banco, r.numeroCuenta];
      return hay.some((v) => (v || "").toLowerCase().includes(q));
    });
  }, [isContactos, contactos, cuentas, search]);

  function handleManualReorder(fromIdx, toIdx) {
    if (isContactos) {
      const next = reorderWithinFull(contactos || [], filtered, fromIdx, toIdx, "id");
      persistContactos(next);
    } else {
      const next = reorderWithinFull(cuentas || [], filtered, fromIdx, toIdx, "id");
      persistCuentas(next);
    }
  }
  const rowDrag = useRowDrag({ enabled: !!isAdmin, idKey: "id", onReorder: handleManualReorder });

  function openAdd() {
    if (!puedeAgregar) return;
    setDraftAdd(isContactos ? emptyContactoDraft() : emptyCuentaDraft());
    setShowAdd(true);
  }
  async function confirmAdd() {
    if (!puedeAgregar) return;
    const rec = { ...draftAdd, id: uid() };
    if (isContactos) await persistContactos((current) => [rec, ...(current || [])], "crear");
    else await persistCuentas((current) => [rec, ...(current || [])], "crear");
    setShowAdd(false);
  }
  function openEdit(r) {
    if (!puedeEditar) return;
    setEditingId(r.id);
    setDraftEdit({ ...r });
  }
  async function persistEditContacto(draftToSave) {
    const modulo = isContactos ? "contactos" : "cuentas";
    const moduloLabel = isContactos ? "Contactos" : "Proveedores";
    const storageKey = isContactos ? STORAGE_KEY_CONTACTOS : STORAGE_KEY_CUENTAS;
    const coleccion = isContactos ? (contactos || []) : (cuentas || []);
    const original = coleccion.find((c) => c.id === editingId);
    const labels = isContactos
      ? { contacto: "Contacto", cargo: "Cargo", direccion: "Dirección", telefono: "Teléfono" }
      : { nombre: "Nombre", ruc: "RUC", telefono: "Teléfono", banco: "Banco", numeroCuenta: "N° Cuenta" };
    await intentarGuardarConAprobacion({
      puedeAprobar, modulo, moduloLabel, storageKey, idField: "id", recordId: editingId,
      original, propuesto: draftToSave, autor: me, labels,
      persistDirecto: (intent) => (isContactos ? persistContactos((current) => (current || []).map((c) => (c.id === editingId ? draftToSave : c)), intent) : persistCuentas((current) => (current || []).map((c) => (c.id === editingId ? draftToSave : c)), intent)),
      pedirSustento: sustentoGate.solicitar,
    });
  }
  // Autoguardado: guarda lo editado si el usuario cambia de pestaña, oculta la
  // ventana o cierra el formulario sin apretar "Guardar".
  const autoSaveEditContacto = useAutoSaveOnLeave({
    active: !!editingId && puedeEditar,
    draft: draftEdit,
    saveFn: persistEditContacto,
  });
  async function cerrarEditContacto() { await autoSaveEditContacto(); setEditingId(null); setDraftEdit(null); }
  async function confirmEdit() {
    if (!puedeEditar) return;
    await persistEditContacto(draftEdit);
    setEditingId(null);
    setDraftEdit(null);
  }
  async function doDelete(id) {
    if (!puedeEliminar) return;
    const modulo = isContactos ? "contactos" : "cuentas";
    const moduloLabel = isContactos ? "Contactos" : "Proveedores";
    const storageKey = isContactos ? STORAGE_KEY_CONTACTOS : STORAGE_KEY_CUENTAS;
    const coleccion = isContactos ? (contactos || []) : (cuentas || []);
    const registro = coleccion.find((c) => c.id === id);
    const resumen = isContactos ? (registro?.contacto || "Contacto") : (registro?.nombre || "Proveedor");
    await intentarEliminarConAprobacion({
      puedeAprobar, modulo, moduloLabel, storageKey, idField: "id", recordId: id, autor: me, resumen,
      persistDirecto: (intent) => (isContactos ? persistContactos((current) => (current || []).filter((c) => c.id !== id), intent) : persistCuentas((current) => (current || []).filter((c) => c.id !== id), intent)),
      pedirSustento: sustentoGate.solicitar,
    });
    setConfirmDelete(null);
  }
  async function copyToClipboard(text, id) {
    const value = String(text ?? "");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement("textarea");
        ta.value = value; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        if (!ok) throw new Error("clipboard_unavailable");
      }
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1200);
    } catch (_) {
      alert("No fue posible copiar el dato en este entorno.");
    }
  }

  const fieldsContacto = [
    { key: "contacto", label: "Nombre" },
    { key: "cargo", label: "Cargo" },
    { key: "direccion", label: "Dirección" },
    { key: "telefono", label: "Teléfono" },
  ];
  const fieldsCuenta = [
    { key: "nombre", label: "Nombre" },
    { key: "ruc", label: "RUC", noUppercase: true },
    { key: "telefono", label: "Teléfono", noUppercase: true },
    { key: "banco", label: "Banco" },
    { key: "numeroCuenta", label: "N° Cuenta", noUppercase: true },
  ];
  const fields = isContactos ? fieldsContacto : fieldsCuenta;

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: COLORS.dim, fontFamily: "'Inter',sans-serif" }}>Cargando…</div>;
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
        .ct-input2 { width: 100%; background: ${COLORS.panel2}; border: 1px solid ${COLORS.border}; color: ${COLORS.text}; font-family: 'Inter',sans-serif; font-size: 12.5px; padding: 7px 9px; border-radius: 6px; outline: none; box-sizing: border-box; }
        .ct-input2:focus { border-color: ${COLORS.amber}; }
        .ct-input2::placeholder { color: ${COLORS.faint}; opacity: 1; }
        .ct-filebtn { display: inline-flex; align-items: center; gap: 6px; background: ${COLORS.panel2}; border: 1px dashed ${COLORS.border}; color: ${COLORS.text}; padding: 8px 14px; border-radius: 7px; font-size: 12.5px; cursor: pointer; }
        .ct-filebtn:hover { border-color: ${COLORS.amber}; color: ${COLORS.amber}; }
      `}</style>

      <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "center", justifyContent: "space-between", background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "14px 18px", marginBottom: 14, flexWrap: "wrap", gap: 12, flexDirection: isMobile ? "column" : "row" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src={LOGO_SHIELD} alt="Operaciones" style={{ width: 40, height: "auto", flexShrink: 0, display: "block" }} />
          <div>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 600 }}>CONTACTOS Y PROVEEDORES</div>
            <div style={{ fontSize: 11, color: COLORS.dim, display: "flex", alignItems: "center", gap: 4 }}>
              Base de datos compartida en vivo
              <SyncDot syncState={syncState} palette={COLORS} />
            </div>
          </div>
        </div>
      </div>

      <FilterBar>
        <div style={{ display: "flex", background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 7, overflow: "hidden" }}>
          <button
            onClick={() => setTab("contactos")}
            style={{ padding: "7px 14px", fontSize: 12.5, border: "none", cursor: "pointer", background: tab === "contactos" ? COLORS.amber : "transparent", color: tab === "contactos" ? COLORS.amberText : COLORS.dim, fontWeight: tab === "contactos" ? 600 : 400 }}
          >
            Contactos
          </button>
          <button
            onClick={() => setTab("cuentas")}
            style={{ padding: "7px 14px", fontSize: 12.5, border: "none", cursor: "pointer", background: tab === "cuentas" ? COLORS.amber : "transparent", color: tab === "cuentas" ? COLORS.amberText : COLORS.dim, fontWeight: tab === "cuentas" ? 600 : 400 }}
          >
            Proveedores
          </button>
        </div>
        <input
          className="ct-input2"
          placeholder={isContactos ? "Buscar contacto…" : "Buscar proveedor…"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 260 }}
        />
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

      {tab === "cuentas" && (cuentas || []).length === 0 && (
        <div style={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: 14, marginBottom: 14, fontSize: 12.5, color: COLORS.dim }}>
          Aún no hay proveedores guardados. Usa "Nuevo proveedor" para registrar sus datos (nombre, RUC, teléfono y cuenta bancaria).
        </div>
      )}

      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "16px 18px", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600 }}>Registros ({filtered.length})</h2>
          {puedeAgregar && (
            <button onClick={openAdd} style={{ display: "flex", alignItems: "center", gap: 6, background: COLORS.amber, color: COLORS.amberText, fontWeight: 600, fontSize: 12.5, padding: "8px 14px", borderRadius: 7, border: "none", cursor: "pointer" }}>
              + {isContactos ? "Nuevo contacto" : "Nuevo proveedor"}
            </button>
          )}
        </div>
      <div className="ct-scroll" style={{ overflowX: "auto", border: `1px solid ${COLORS.border}`, borderRadius: 9 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", background: COLORS.panel }}>
          <thead>
            <tr>
              {isContactos ? (
                <>
                  <th className="ct-th">Contacto</th>
                  <th className="ct-th">Cargo</th>
                  <th className="ct-th">Dirección</th>
                  <th className="ct-th">Teléfono</th>
                </>
              ) : (
                <>
                  <th className="ct-th">Nombre</th>
                  <th className="ct-th">RUC</th>
                  <th className="ct-th">Teléfono</th>
                  <th className="ct-th">Banco</th>
                  <th className="ct-th">N° Cuenta</th>
                </>
              )}
              <th className="ct-th" style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td className="ct-td" colSpan={isContactos ? 5 : 6} style={{ textAlign: "center", color: COLORS.faint, padding: 20 }}>Sin resultados</td></tr>
            )}
            {isContactos ? filtered.map((r, idx) => {
              const dh = rowDrag.getHandlers(idx, r);
              const isOver = rowDrag.dragOverId === r.id;
              return (
              <tr key={r.id} className="ct-row" onClick={() => openEdit(r)} {...dh} style={isOver ? { boxShadow: `inset 0 2px 0 ${COLORS.amber}` } : undefined}>
                <td className="ct-td">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <DragHandle show={isAdmin} isMobile={isMobile} color={COLORS.faint} dragProps={rowDrag.getHandleProps(idx)} dragging={rowDrag.armedIndex === idx} canMoveUp={idx > 0} canMoveDown={idx < filtered.length - 1} onMoveUp={() => rowDrag.moveBy(idx, -1, filtered.length)} onMoveDown={() => rowDrag.moveBy(idx, 1, filtered.length)} />
                    <div style={{ width: 20, height: 20, borderRadius: 50, background: colorForContacto(r.contacto, nombresContactos), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: COLORS.dark, flexShrink: 0 }}>{initials(r.contacto)}</div>
                    {r.contacto}
                  </div>
                </td>
                <td className="ct-td" style={{ color: COLORS.dim }}>{r.cargo || "—"}</td>
                <td className="ct-td" style={{ color: COLORS.dim }}>{r.direccion || "—"}</td>
                <td className="ct-td" style={{ color: COLORS.dim }}>{r.telefono || "—"}</td>
                <td className="ct-td" onClick={(e) => e.stopPropagation()}>
                  {puedeEliminar && <button onClick={() => setConfirmDelete(r.id)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.faint, borderRadius: 6, padding: "4px 8px", fontSize: 11, cursor: "pointer" }}>Eliminar</button>}
                </td>
              </tr>
              );
            }) : filtered.map((r, idx) => {
              const dh = rowDrag.getHandlers(idx, r);
              const isOver = rowDrag.dragOverId === r.id;
              return (
              <tr key={r.id} className="ct-row" onClick={() => openEdit(r)} {...dh} style={isOver ? { boxShadow: `inset 0 2px 0 ${COLORS.amber}` } : undefined}>
                <td className="ct-td">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <DragHandle show={isAdmin} isMobile={isMobile} color={COLORS.faint} dragProps={rowDrag.getHandleProps(idx)} dragging={rowDrag.armedIndex === idx} canMoveUp={idx > 0} canMoveDown={idx < filtered.length - 1} onMoveUp={() => rowDrag.moveBy(idx, -1, filtered.length)} onMoveDown={() => rowDrag.moveBy(idx, 1, filtered.length)} />
                    {r.nombre}
                  </div>
                </td>
                <td className="ct-td" style={{ color: COLORS.dim }}>{r.ruc || "—"}</td>
                <td className="ct-td" style={{ color: COLORS.dim }}>{r.telefono || "—"}</td>
                <td className="ct-td" style={{ color: COLORS.dim }}>{r.banco || "—"}</td>
                <td className="ct-td" onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: COLORS.dim, fontFamily: "monospace" }}>{r.numeroCuenta || "—"}</span>
                    {r.numeroCuenta && (
                      <button onClick={() => copyToClipboard(r.numeroCuenta, r.id)} title="Copiar" style={{ background: "transparent", border: "none", color: copiedId === r.id ? COLORS.green : COLORS.faint, cursor: "pointer", fontSize: 12 }}>{copiedId === r.id ? "✓" : "⧉"}</button>
                    )}
                  </div>
                </td>
                <td className="ct-td" onClick={(e) => e.stopPropagation()}>
                  {puedeEliminar && <button onClick={() => setConfirmDelete(r.id)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.faint, borderRadius: 6, padding: "4px 8px", fontSize: 11, cursor: "pointer" }}>Eliminar</button>}
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
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 18, width: 380, maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, marginBottom: 12 }}>{isContactos ? "Nuevo contacto" : "Nuevo proveedor"}</div>
            <DraftForm value={draftAdd} onChange={setDraftAdd} fields={fields} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button onClick={() => setShowAdd(false)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, borderRadius: 7, padding: "7px 14px", fontSize: 12.5, cursor: "pointer" }}>Cancelar</button>
              <button onClick={confirmAdd} style={{ background: COLORS.amber, color: COLORS.amberText, border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {editingId && draftEdit && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={cerrarEditContacto}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 18, width: 380, maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, marginBottom: 12 }}>{isContactos ? "Editar contacto" : "Editar proveedor"}</div>
            <DraftForm value={draftEdit} onChange={setDraftEdit} fields={fields} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button onClick={cerrarEditContacto} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, borderRadius: 7, padding: "7px 14px", fontSize: 12.5, cursor: "pointer" }}>Cancelar</button>
              <button onClick={confirmEdit} style={{ background: COLORS.amber, color: COLORS.amberText, border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Guardar cambios</button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setConfirmDelete(null)}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 18, width: 320, maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ fontSize: 13.5, color: COLORS.text, marginBottom: 14 }}>¿Eliminar este registro? Esta acción no se puede deshacer.</div>
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


export { ContactosCuentas };
