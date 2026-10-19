import { useState, useEffect, useMemo, useRef } from "react";
import * as C from "./core-common";
const {
  classifySyncError,
  SyncDot,
  FilterBar,
  ClearFiltersButton,
  PdfViewerModal,
  scrollFieldIntoViewOnFocus,
  mutateStorageJSON,
  LOGO_SHIELD,
  COLORS,
  uid,
  fmtDate,
  Kpi,
  useIsMobile,
  STORAGE_KEY_VISITAS,
  emptyVisitaDraft,
  siguienteCodigoVisita,
  resizeImageFile,
  subirFotoADrive,
  urlFotoDrive,
  eliminarFotoDrive,
  buildVisitaPdf,
  intentarGuardarConAprobacion,
  intentarEliminarConAprobacion,
  useSustentoGate,
  filterOwnRecords,
  downloadXlsxWorkbook,
  useCarpetaLocal,
  BotonCarpetaLocal,
  OCSelector,
  STORAGE_KEY_CONTACTOS,
  STORAGE_KEY_ASISTENCIA_TRABAJADORES,
  useAutoSaveDebounced,
} = C;

const UNIDADES_MEDIDA = ["UND", "PZA", "M", "M2", "M3", "KG", "GAL", "LT", "ROLLO", "CAJA", "PAR", "JGO", "BLS", "GLB"];

function IconBtn({ onClick, title, danger, color, disabled, children }) {
  const tone = danger ? COLORS.red : (color || COLORS.dim);
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        background: "transparent",
        border: `1px solid ${tone}`,
        color: tone,
        borderRadius: 6,
        padding: "4px 9px",
        fontSize: 11,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.65 : 1,
      }}
    >
      {children}
    </button>
  );
}

function FotoTile({ foto, index, onQuitar, onRenombrar, onSubirEnEspacio, puedeAdjuntar = true }) {
  const nombre = foto.nombre ?? String(index + 1);
  const driveUrl = foto.driveFileId ? urlFotoDrive(foto.driveFileId) : null;
  // Prioridad: si ya tenemos la imagen en memoria (recién tomada/subida) se muestra de inmediato,
  // sin depender de una descarga a Drive. Solo se usa la URL de Drive cuando no hay dataUrl local
  // (por ejemplo, al reabrir un registro ya guardado anteriormente).
  const src = foto.dataUrl || driveUrl;
  const [errorCarga, setErrorCarga] = useState(false);
  const [intento, setIntento] = useState(0);
  useEffect(() => { setErrorCarga(false); }, [src]);
  const srcConReintento = src && intento > 0 && !foto.dataUrl ? `${src}${src.includes("?") ? "&" : "?"}_r=${intento}` : src;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <input
        className="ct-input2"
        value={nombre}
        onChange={(e) => onRenombrar(e.target.value)}
        placeholder={String(index + 1)}
        style={{ fontSize: 10.5, padding: "4px 6px" }}
        disabled={!puedeAdjuntar}
      />
      {src && !errorCarga ? (
        <div style={{ position: "relative" }}>
          <img
            src={srcConReintento}
            alt={nombre}
            onError={() => setErrorCarga(true)}
            style={{ width: "100%", height: 70, objectFit: "contain", background: COLORS.panel2, borderRadius: 6, border: `1px solid ${COLORS.border}`, display: "block" }}
          />
          {puedeAdjuntar && (
            <button type="button" onClick={onQuitar} style={{ position: "absolute", top: 2, right: 2, background: COLORS.overlayDark, color: COLORS.white, border: "none", borderRadius: 4, width: 18, height: 18, fontSize: 10, cursor: "pointer", lineHeight: 1 }}>✕</button>
          )}
        </div>
      ) : src && errorCarga ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, height: 70, borderRadius: 6, border: `1px dashed ${COLORS.red}`, color: COLORS.red, fontSize: 10, textAlign: "center", padding: 4 }}>
          <span>⚠ No se pudo cargar la foto</span>
          <button
            type="button"
            onClick={() => { setErrorCarga(false); setIntento((n) => n + 1); }}
            style={{ background: "transparent", border: `1px solid ${COLORS.red}`, color: COLORS.red, borderRadius: 4, padding: "2px 6px", fontSize: 10, cursor: "pointer" }}
          >Reintentar</button>
        </div>
      ) : puedeAdjuntar ? (
        <label style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 70, borderRadius: 6, border: `1px dashed ${COLORS.border}`, color: COLORS.faint, fontSize: 10.5, cursor: "pointer", textAlign: "center", padding: 4 }}>
          📷 Subir foto
          <input type="file" accept="image/*" onChange={(e) => { onSubirEnEspacio(e.target.files[0]); e.target.value = ""; }} style={{ display: "none" }} />
        </label>
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 70, borderRadius: 6, border: `1px dashed ${COLORS.border}`, color: COLORS.faint, fontSize: 10.5, textAlign: "center", padding: 4 }}>
          Sin permiso para adjuntar
        </div>
      )}
    </div>
  );
}

function VisitaForm({ value, onChange, subiendoFoto, onSubirFotos, onQuitarFoto, onRenombrarFoto, onAgregarEspacioFoto, onSubirFotoEnEspacio, contactos = [], trabajadores = [], puedeAdjuntar = true }) {
  const v = value;
  function set(k, val) { onChange({ ...v, [k]: val }); }
  const isMobile = useIsMobile();
  const contactoOptions = useMemo(() => {
    const seen = new Set();
    const list = [];
    (contactos || []).forEach((c) => {
      const nombre = String(c?.contacto || "").trim();
      if (!nombre) return;
      const k = nombre.toLocaleLowerCase();
      if (seen.has(k)) return;
      seen.add(k); list.push(nombre);
    });
    return list;
  }, [contactos]);
  function pickContacto(nombre) {
    const c = contactos.find((c) => c.contacto === nombre);
    if (c) {
      onChange({ ...v, contacto: c.contacto, telefono: c.telefono || v.telefono, lugar: c.direccion || v.lugar });
    } else {
      onChange({ ...v, contacto: nombre });
    }
  }
  const inputRow = { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 10 };
  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Solicitud / Proyecto</div>
        <input className="ct-input2" value={v.nombreProyecto} onChange={(e) => set("nombreProyecto", e.target.value.toUpperCase())} placeholder="MANTENIMIENTO DE AIRE ACONDICIONADO - SEDE SAN ISIDRO" />
      </div>
      <div style={inputRow}>
        <div>
          <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Contacto</div>
          <OCSelector value={v.contacto} onChange={pickContacto} options={contactoOptions} placeholder="Seleccionar o buscar contacto…" />
        </div>
        <div>
          <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Fecha</div>
          <input type="date" className="ct-input2" value={v.fecha} onChange={(e) => set("fecha", e.target.value)} />
        </div>
      </div>
      <div style={inputRow}>
        <div>
          <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Responsable</div>
          <OCSelector value={v.responsable} onChange={(val) => set("responsable", val)} options={trabajadores} placeholder="Seleccionar o buscar responsable…" />
        </div>
        <div>
          <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Hora</div>
          <input type="time" className="ct-input2" value={v.hora} onChange={(e) => set("hora", e.target.value)} />
        </div>
      </div>
      <div style={inputRow}>
        <div>
          <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Lugar</div>
          <input className="ct-input2" value={v.lugar} onChange={(e) => set("lugar", e.target.value.toUpperCase())} placeholder="SAN ISIDRO" />
        </div>
        <div>
          <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Teléfono</div>
          <input className="ct-input2" value={v.telefono} onChange={(e) => set("telefono", e.target.value)} placeholder="999 999 999" />
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Mano de obra</div>
        {(() => {
          const filas = Array.isArray(v.requisitos)
            ? (v.requisitos.length ? v.requisitos : [""])
            : (String(v.requisitos || "").trim() ? String(v.requisitos).split("\n") : [""]);
          function setFila(i, val) {
            const next = [...filas];
            next[i] = val;
            set("requisitos", next);
          }
          function quitarFila(i) {
            const next = filas.filter((_, idx) => idx !== i);
            set("requisitos", next.length ? next : [""]);
          }
          function agregarFila() {
            set("requisitos", [...filas, ""]);
          }
          return (
            <div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {filas.map((fila, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <textarea
                      className="ct-input2"
                      rows={2}
                      value={fila}
                      onChange={(e) => setFila(i, e.target.value)}
                      style={{ resize: "vertical", flex: 1 }}
                      placeholder="Detalle de lo solicitado por el cliente durante la visita…"
                    />
                    {filas.length > 1 && (
                      <button
                        type="button"
                        onClick={() => quitarFila(i)}
                        title="Quitar fila"
                        style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, borderRadius: 6, width: 28, height: 28, fontSize: 12, cursor: "pointer", flexShrink: 0, marginTop: 2 }}
                      >✕</button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={agregarFila}
                style={{ marginTop: 6, background: "transparent", border: `1px dashed ${COLORS.border}`, color: COLORS.dim, borderRadius: 6, padding: "5px 10px", fontSize: 11.5, cursor: "pointer" }}
              >+ Agregar fila</button>
            </div>
          );
        })()}
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Materiales</div>
        {(() => {
          const filas = (v.materiales && v.materiales.length) ? v.materiales : [{ id: uid(), nombre: "", cantidad: "", unidad: "" }];
          function setCampo(i, campo, val) {
            const next = filas.map((m, idx) => (idx === i ? { ...m, [campo]: val } : m));
            set("materiales", next);
          }
          function quitarFila(i) {
            const next = filas.filter((_, idx) => idx !== i);
            set("materiales", next);
          }
          function agregarFila() {
            const nueva = { id: uid(), nombre: "", cantidad: "", unidad: "" };
            set("materiales", [...filas, nueva]);
            return nueva.id;
          }
          return (
            <div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {filas.map((m, i) => (
                  <div key={m.id || i} style={{ display: "flex", gap: 6, alignItems: "flex-start", flexWrap: isMobile ? "wrap" : "nowrap" }}>
                    <textarea
                      className="ct-input2"
                      rows={2}
                      value={m.nombre}
                      onChange={(e) => setCampo(i, "nombre", e.target.value)}
                      style={{ resize: "vertical", flex: 1, minWidth: isMobile ? "100%" : "auto" }}
                      placeholder="Material (ej. cable THW 12 AWG)"
                    />
                    <select
                      className="ct-input2"
                      value={m.unidad}
                      onChange={(e) => setCampo(i, "unidad", e.target.value)}
                      style={{ width: 100, flexShrink: 0, marginTop: 2 }}
                    >
                      <option value="">Unidad…</option>
                      {UNIDADES_MEDIDA.map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                    <input
                      className="ct-input2"
                      type="number"
                      min="0"
                      value={m.cantidad}
                      onChange={(e) => setCampo(i, "cantidad", e.target.value)}
                      style={{ width: 80, flexShrink: 0, marginTop: 2 }}
                      placeholder="Cant."
                    />
                    {filas.length > 1 && (
                      <button
                        type="button"
                        onClick={() => quitarFila(i)}
                        title="Quitar material"
                        style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, borderRadius: 6, width: 28, height: 28, fontSize: 12, cursor: "pointer", flexShrink: 0, marginTop: 2 }}
                      >✕</button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={agregarFila}
                style={{ marginTop: 6, background: "transparent", border: `1px dashed ${COLORS.border}`, color: COLORS.dim, borderRadius: 6, padding: "5px 10px", fontSize: 11.5, cursor: "pointer" }}
              >+ Agregar material</button>
            </div>
          );
        })()}
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 6 }}>Diagramas / Fotos ({(v.fotos || []).length})</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(90px,1fr))", gap: 8, marginBottom: 8 }}>
          {(v.fotos || []).map((f, i) => (
            <FotoTile
              key={f.id}
              foto={f}
              index={i}
              onQuitar={() => onQuitarFoto(i)}
              onRenombrar={(nombre) => onRenombrarFoto(i, nombre)}
              onSubirEnEspacio={(file) => onSubirFotoEnEspacio(i, file)}
              puedeAdjuntar={puedeAdjuntar}
            />
          ))}
        </div>
        {puedeAdjuntar && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label className="ct-filebtn">
              {subiendoFoto ? "Subiendo…" : "📷 Agregar fotos"}
              <input type="file" accept="image/*" multiple disabled={subiendoFoto} onChange={(e) => { onSubirFotos(e.target.files); e.target.value = ""; }} style={{ display: "none" }} />
            </label>
            <label className="ct-filebtn">
              {subiendoFoto ? "Subiendo…" : "📸 Tomar foto"}
              <input type="file" accept="image/*" capture="environment" disabled={subiendoFoto} onChange={(e) => { onSubirFotos(e.target.files); e.target.value = ""; }} style={{ display: "none" }} />
            </label>
            <button type="button" onClick={onAgregarEspacioFoto} style={{ background: "transparent", border: `1px dashed ${COLORS.border}`, color: COLORS.dim, borderRadius: 6, padding: "5px 10px", fontSize: 11.5, cursor: "pointer" }}>+ Nombrar foto antes de subirla</button>
          </div>
        )}
      </div>

      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Observaciones</div>
        <textarea className="ct-input2" rows={4} value={v.observaciones} onChange={(e) => set("observaciones", e.target.value)} style={{ resize: "vertical" }} placeholder="Observaciones adicionales de la visita…" />
      </div>
    </div>
  );
}

function ControlVisitas({ isAdmin = false, puedeEditar = true, puedeAgregar = true, puedeEliminar = true, puedeExportar = true, puedeAdjuntar = true, puedeAprobar = false, me = "", ownerIdentity = "", puedeVerTodos = true } = {}) {
  const sustentoGate = useSustentoGate();
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [syncState, setSyncState] = useState("pendiente");
  const [search, setSearch] = useState("");

  const [showAdd, setShowAdd] = useState(false);
  const [draftAdd, setDraftAdd] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [draftEdit, setDraftEdit] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [generandoPdf, setGenerandoPdf] = useState(null);
  const [pdfViewer, setPdfViewer] = useState(null); // { url, fileName, doc } | null
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [contactos, setContactos] = useState([]);
  const [trabajadores, setTrabajadores] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY_ASISTENCIA_TRABAJADORES, true);
        const raw = JSON.parse(res.value);
        setTrabajadores(Array.isArray(raw) ? raw.filter(Boolean) : []);
      } catch (e) { console.error("carga de trabajadores (visitas): fallo", e); setTrabajadores([]); }
    })();
  }, []);

  useEffect(() => {
    let cancelado = false;
    async function cargarContactos() {
      try {
        const res = await window.storage.get(STORAGE_KEY_CONTACTOS, true);
        const data = JSON.parse(res.value);
        if (!cancelado) setContactos(Array.isArray(data) ? data : []);
      } catch (e) { if (!cancelado) setContactos([]); console.error("cargarContactos (visitas): fallo la carga", e); }
    }
    cargarContactos();
    const onVisible = () => { if (document.visibilityState === "visible") cargarContactos(); };
    document.addEventListener("visibilitychange", onVisible);
    const intervalId = setInterval(cargarContactos, 60000);
    return () => { cancelado = true; document.removeEventListener("visibilitychange", onVisible); clearInterval(intervalId); };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    setIsMobile(mq.matches);
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener ? mq.addEventListener("change", onChange) : mq.addListener(onChange);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", onChange) : mq.removeListener(onChange); };
  }, []);

  useEffect(() => {
    let cancelado = false;
    async function loadItems() {
      try {
        const res = await window.storage.get(STORAGE_KEY_VISITAS, true);
        const data = JSON.parse(res.value);
        if (cancelado) return;
        setItems(Array.isArray(data) ? data : []);
        setSyncState("ok");
      } catch (e) {
        if (cancelado) return;
        setItems([]);
        setSyncState(classifySyncError(e));
      }
      setLoading(false);
    }
    loadItems();
    const onPropuestasChanged = () => loadItems();
    window.addEventListener("wilarcon:propuestas-changed", onPropuestasChanged);
    return () => { cancelado = true; window.removeEventListener("wilarcon:propuestas-changed", onPropuestasChanged); };
  }, []);

  async function persist(next, intent) {
    if (typeof next === "function") {
      try {
        const applied = await mutateStorageJSON(STORAGE_KEY_VISITAS, [], (current) => next(Array.isArray(current) ? current : []), 4, intent);
        setItems(applied);
        setSyncState("ok");
        return applied;
      } catch (e) {
        console.error(e);
        const estado = classifySyncError(e);
        setSyncState(estado);
        // El mensaje depende de la causa real del fallo: antes se mostraba siempre el texto de
        // "conflicto de version" sin importar el motivo, lo cual era enganoso cuando en realidad
        // era un problema de permisos (o de conexion) — el usuario podia tener los permisos bien
        // configurados y aun asi ver un mensaje que sugeria que "otro usuario" habia chocado con su
        // guardado.
        if (estado === "sinPermisos") {
          alert("No se pudo guardar el cambio: no tienes permiso para hacer esta acción en Visitas Técnicas. Si crees que deberías tenerlo, pide que revisen tus accesos.");
        } else if (estado === "sinConexion") {
          alert("No se pudo guardar el cambio: no hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.");
        } else if (estado === "conflicto") {
          alert("No se pudo guardar el cambio: otro usuario modificó estos registros al mismo tiempo y los reintentos automáticos no lograron aplicarlo. Recarga la página e inténtalo de nuevo.");
        } else {
          alert("No se pudo guardar el cambio. Recarga la página e inténtalo de nuevo.");
        }
        return;
      }
    }
    setItems(next);
    try { await window.storage.set(STORAGE_KEY_VISITAS, JSON.stringify(next), { intent }); setSyncState("ok"); } catch (e) { console.error(e); setSyncState(classifySyncError(e)); }
  }

  const itemsVisibles = useMemo(() => (
    puedeVerTodos ? (items || []) : filterOwnRecords(items || [], ownerIdentity, "creadoPor")
  ), [items, puedeVerTodos, ownerIdentity]);

  const filtered = useMemo(() => {
    let list = itemsVisibles;
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((i) => [i.codigo, i.nombreProyecto, i.lugar, i.contacto, i.responsable].some((v) => (v || "").toLowerCase().includes(q)));
    return [...list].sort((a, b) => (b.actualizadoEn || 0) - (a.actualizadoEn || 0));
  }, [itemsVisibles, search]);

  const kpis = useMemo(() => {
    const list = itemsVisibles;
    return { total: list.length };
  }, [itemsVisibles]);

  function openAdd() {
    if (!puedeAgregar) return;
    setDraftAdd({ ...emptyVisitaDraft(), id: uid(), codigo: siguienteCodigoVisita(items || []) });
    setShowAdd(true);
  }
  // Antes de guardar se quita el dataUrl de cada foto ya subida a Drive (se conserva solo en
  // memoria para mostrarla al instante en pantalla): así el registro guardado sigue siendo
  // liviano, igual que antes de que las miniaturas se mostraran de inmediato tras subir.
  function sanitizeFotosParaGuardar(fotos) {
    return (fotos || []).map((f) => (f && f.driveFileId && f.dataUrl ? { ...f, dataUrl: undefined } : f));
  }
  // Guardado silencioso de la visita nueva: la primera vez que dispara el autoguardado crea el
  // registro; las siguientes lo actualiza directo (crear nunca pasa por aprobación, igual que antes).
  async function guardarNuevaVisitaSilenciosa(current) {
    const existeActual = (items || []).some((i) => i.id === current.id);
    const rec = { ...current, fotos: sanitizeFotosParaGuardar(current.fotos), creadoPor: current.creadoPor || me, actualizadoEn: Date.now() };
    if (existeActual) {
      await persist((list) => list.map((i) => (i.id === rec.id ? rec : i)), "editar");
    } else {
      await persist((list) => [rec, ...list], "crear");
    }
  }
  const autoSaveNuevaVisita = useAutoSaveDebounced({
    active: showAdd && puedeAgregar,
    draft: draftAdd,
    saveFn: guardarNuevaVisitaSilenciosa,
  });
  async function cerrarAddVisita() { await autoSaveNuevaVisita(); setShowAdd(false); setDraftAdd(null); }
  function duplicar(i) {
    if (!puedeAgregar) return;
    const copia = JSON.parse(JSON.stringify(i));
    copia.id = uid();
    copia.codigo = siguienteCodigoVisita(items || []);
    setDraftAdd(copia);
    setShowAdd(true);
  }
  // Sustento en caché por sesión de edición: si el usuario no puede aprobar y el autoguardado
  // se dispara varias veces (una por cada pausa de escritura), se pide el motivo una sola vez
  // y se reutiliza en los siguientes autoguardados de esa misma edición. Se reinicia al abrir
  // un registro distinto.
  const sustentoEditRef = useRef(null);
  function openEdit(r) { if (!puedeEditar) return; sustentoEditRef.current = null; setEditingId(r.id); setDraftEdit({ ...r }); }
  async function persistEditVisita(draftToSave) {
    const propuesto = { ...draftToSave, fotos: sanitizeFotosParaGuardar(draftToSave.fotos), actualizadoEn: Date.now() };
    const original = (items || []).find((i) => i.id === editingId);
    await intentarGuardarConAprobacion({
      puedeAprobar, modulo: "visitas", moduloLabel: "Visitas Técnicas",
      storageKey: STORAGE_KEY_VISITAS, idField: "id", recordId: editingId,
      original, propuesto, autor: me,
      labels: { codigo: "Código", nombreProyecto: "Solicitud / Proyecto", lugar: "Lugar", fecha: "Fecha", responsable: "Responsable", hora: "Hora", contacto: "Contacto", telefono: "Teléfono", presupuesto: "Presupuesto", requisitos: "Mano de obra", materiales: "Materiales", observaciones: "Observaciones" },
      persistDirecto: (intent) => persist((current) => current.map((i) => (i.id === editingId ? propuesto : i)), intent),
      pedirSustento: sustentoGate.solicitar,
      sustentoRef: sustentoEditRef,
    });
  }
  // Autoguardado con debounce: guarda unos segundos después de que el usuario deja de escribir,
  // y de inmediato si cambia de pestaña, oculta la ventana o se cierra el formulario.
  const autoSaveEditVisita = useAutoSaveDebounced({
    active: !!editingId && puedeEditar,
    draft: draftEdit,
    saveFn: persistEditVisita,
  });
  async function cerrarEditVisita() { await autoSaveEditVisita(); sustentoEditRef.current = null; setEditingId(null); setDraftEdit(null); }
  async function doDelete(id) {
    if (!puedeEliminar) return;
    const registro = (items || []).find((i) => i.id === id);
    await intentarEliminarConAprobacion({
      puedeAprobar, modulo: "visitas", moduloLabel: "Visitas Técnicas",
      storageKey: STORAGE_KEY_VISITAS, idField: "id", recordId: id, autor: me,
      resumen: registro ? `${registro.codigo || ""} — ${registro.nombreProyecto || ""}` : `registro ${id}`,
      persistDirecto: (intent) => persist((current) => current.filter((i) => i.id !== id), intent),
      pedirSustento: sustentoGate.solicitar,
    });
    setConfirmDelete(null);
  }

  async function subirFotos(fileList, draft, setDraft) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setSubiendoFoto(true);
    try {
      // Antes se subían todas las fotos a la vez en paralelo para ganar velocidad, pero Google
      // Apps Script no ejecuta varias llamadas de nuestro webhook al mismo tiempo: las pone en
      // cola. Con 2+ fotos a la vez, la segunda esperaba a que la primera terminara DENTRO de
      // Google, y esa cola hacía que la petición completa superara los 15s de margen del
      // backend (Vercel cortaba la conexión con "aborted" aunque Google sí la había procesado
      // bien, solo que tarde). Subir de a una evita esa cola y es igual de confiable que en la
      // página de Informes, que siempre lo hizo así.
      const nuevas = [];
      let huboError = false;
      for (const file of files) {
        try {
          const { dataUrl, width, height } = await resizeImageFile(file);
          const driveFileId = await subirFotoADrive(dataUrl, file.name);
          nuevas.push({ id: uid(), driveFileId, dataUrl, width, height });
        } catch (e) {
          console.error(e);
          huboError = true;
        }
      }
      if (nuevas.length) setDraft((prev) => ({ ...prev, fotos: [...(prev.fotos || []), ...nuevas] }));
      if (huboError) alert("No se pudo subir una de las fotos. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setSubiendoFoto(false);
    }
  }
  function quitarFoto(idx, draft, setDraft) {
    setDraft((prev) => {
      const foto = (prev.fotos || [])[idx];
      if (foto && foto.driveFileId) eliminarFotoDrive(foto.driveFileId);
      return { ...prev, fotos: (prev.fotos || []).filter((_, i) => i !== idx) };
    });
  }
  function agregarEspacioFoto(draft, setDraft) {
    setDraft((prev) => {
      const list = prev.fotos || [];
      return { ...prev, fotos: [...list, { id: uid(), nombre: String(list.length + 1), dataUrl: null, width: 0, height: 0 }] };
    });
  }
  function renombrarFoto(idx, nombre, draft, setDraft) {
    setDraft((prev) => ({ ...prev, fotos: (prev.fotos || []).map((f, i) => (i === idx ? { ...f, nombre } : f)) }));
  }
  async function subirFotoEnEspacio(idx, file, draft, setDraft) {
    if (!file) return;
    setSubiendoFoto(true);
    try {
      const { dataUrl, width, height } = await resizeImageFile(file);
      const driveFileId = await subirFotoADrive(dataUrl, file.name);
      setDraft((prev) => ({ ...prev, fotos: (prev.fotos || []).map((f, i) => (i === idx ? { ...f, driveFileId, dataUrl, width, height } : f)) }));
    } catch (e) {
      console.error(e);
      alert("No se pudo subir la foto. Revisa tu conexión e inténtalo de nuevo.");
    }
    finally { setSubiendoFoto(false); }
  }

  async function verPdf(visita) {
    setGenerandoPdf(visita.id);
    try {
      const { doc, fileName } = await buildVisitaPdf(visita, { download: false });
      const url = doc.output("bloburl");
      setPdfViewer((prev) => {
        if (prev) { try { URL.revokeObjectURL(prev.url); } catch (e) { console.error(e); } }
        return { url, fileName, doc };
      });
    } catch (e) {
      console.error(e);
      alert("Ocurrió un error al generar el PDF. Intenta nuevamente.");
    } finally {
      setGenerandoPdf(null);
    }
  }

  function cerrarPdfViewer() {
    setPdfViewer((prev) => {
      if (prev) { try { URL.revokeObjectURL(prev.url); } catch (e) { console.error(e); } }
      return null;
    });
  }

  useEffect(() => {
    return () => {
      setPdfViewer((prev) => {
        if (prev) { try { URL.revokeObjectURL(prev.url); } catch (e) { console.error(e); } }
        return prev;
      });
    };
  }, []);

  function sheetsVisitas() {
    return [{
      name: "Visitas",
      records: filtered,
      headers: ["Código", "Solicitud / Proyecto", "Lugar", "Fecha", "Responsable", "Contacto", "Teléfono", "Presupuesto", "N° Fotos", "Creado por"],
      rowMapper: (i) => [
        i.codigo,
        i.nombreProyecto,
        i.lugar,
        fmtDate(i.fecha) || i.fecha,
        i.responsable,
        i.contacto,
        i.telefono,
        i.presupuesto,
        (i.fotos || []).length,
        i.creadoPor,
      ],
    }];
  }
  async function exportXlsx() {
    setExportingXlsx(true);
    try {
      await downloadXlsxWorkbook(sheetsVisitas(), "visitas_tecnicas");
    } catch (e) {
      console.error("exportXlsx error", e);
      alert("Ocurrió un error al generar la descarga. Intenta nuevamente.");
    } finally {
      setExportingXlsx(false);
    }
  }
  // A diferencia de las demás páginas, aquí la copia en carpeta local no es un Excel resumen:
  // es el mismo PDF de informe de visita (el que genera "Ver/exportar PDF") por cada visita,
  // así la carpeta queda con los PDF listos tal como se entregarían.
  async function pdfsVisitasParaCarpetaLocal() {
    const archivos = [];
    for (const v of filtered) {
      try {
        const { doc, fileName } = await buildVisitaPdf(v, { download: false });
        archivos.push({ nombre: fileName, arrayBuffer: doc.output("arraybuffer") });
      } catch (e) {
        console.error("[carpeta local visitas] no se pudo generar el PDF de", v.codigo, e);
      }
    }
    return archivos;
  }
  const carpetaLocal = useCarpetaLocal("visitas");
  useEffect(() => {
    if (!items) return;
    carpetaLocal.programarGuardado(null, pdfsVisitasParaCarpetaLocal, 1200, "pdfs");
  }, [items]);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: COLORS.dim, fontFamily: "'Inter',sans-serif" }}>Cargando…</div>;

  return (
    <div style={{ background: COLORS.bg, color: COLORS.text, fontFamily: "'Inter',sans-serif", fontSize: 13, padding: isMobile ? 10 : 16, borderRadius: 14 }}>
      <style>{`
        .ct-th { position: sticky; top: 0; background: ${COLORS.panel2}; text-align: left; padding: 9px 10px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .5px; color: ${COLORS.dim}; border-bottom: 1px solid ${COLORS.border}; white-space: nowrap; }
        .ct-td { padding: 8px 10px; border-bottom: 1px solid ${COLORS.grid}; vertical-align: middle; }
        .ct-row:hover { background: rgba(77,141,184,.07); cursor: pointer; }
        .ct-scroll::-webkit-scrollbar { height: 8px; width: 8px; }
        .ct-scroll::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 4px; }
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
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 600 }}>VISITA TÉCNICA</div>
            <div style={{ fontSize: 11, color: COLORS.dim, display: "flex", alignItems: "center", gap: 4 }}>
              Base de datos compartida en vivo
              <SyncDot syncState={syncState} palette={COLORS} />
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 18 }}>
        <Kpi label="Total" value={String(kpis.total)} tone="blue" title="Total de informes de visita técnica registrados." />
      </div>

      <FilterBar>
        <input className="ct-input2" placeholder="Buscar código, proyecto, lugar, contacto…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 280 }} />
        {search && <ClearFiltersButton onClick={() => setSearch("")} />}
        <div style={{ marginLeft: isMobile ? 0 : "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {puedeExportar && (
            <button
              onClick={exportXlsx}
              disabled={exportingXlsx}
              title="Descarga en un archivo Excel la información de esta página"
              style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.text, fontWeight: 600, padding: "8px 14px", borderRadius: 7, fontSize: 12.5, cursor: exportingXlsx ? "not-allowed" : "pointer", opacity: exportingXlsx ? 0.6 : 1 }}
            >
              {exportingXlsx ? "Generando…" : "⬇ Excel"}
            </button>
          )}
          {puedeExportar && <BotonCarpetaLocal carpeta={carpetaLocal} formato="pdf" />}
          {puedeAgregar && (
            <button onClick={openAdd} style={{ display: "flex", alignItems: "center", gap: 6, background: COLORS.amber, color: COLORS.amberText, fontWeight: 600, fontSize: 12.5, padding: "8px 14px", borderRadius: 7, border: "none", cursor: "pointer" }}>
              + Nueva visita
            </button>
          )}
        </div>
      </FilterBar>

      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "16px 18px" }}>
        <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600, marginBottom: 12 }}>Registros ({filtered.length})</h2>
        {filtered.length === 0 && <div style={{ textAlign: "center", color: COLORS.faint, padding: 30 }}>Sin resultados</div>}
        {filtered.length > 0 && (
          <div className="ct-scroll" style={{ overflowX: "auto", border: `1px solid ${COLORS.border}`, borderRadius: 9 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", background: COLORS.panel }}>
              <thead>
                <tr>
                  <th className="ct-th">Código</th>
                  <th className="ct-th">Solicitud / Proyecto</th>
                  <th className="ct-th">Lugar</th>
                  <th className="ct-th">Fecha</th>
                  <th className="ct-th">Contacto</th>
                  <th className="ct-th" style={{ width: 220 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => (
                  <tr key={i.id} className="ct-row" onClick={() => openEdit(i)}>
                    <td className="ct-td" style={{ fontWeight: 600, color: COLORS.blue }}>{i.codigo || "—"}</td>
                    <td className="ct-td">{i.nombreProyecto || "—"}</td>
                    <td className="ct-td" style={{ color: COLORS.dim }}>{i.lugar || "—"}</td>
                    <td className="ct-td" style={{ color: COLORS.dim }}>{fmtDate(i.fecha) || i.fecha || "—"}</td>
                    <td className="ct-td" style={{ color: COLORS.dim }}>{i.contacto || "—"}</td>
                    <td className="ct-td" onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {puedeAgregar && <IconBtn title="Duplicar" onClick={() => duplicar(i)}>Duplicar</IconBtn>}
                      <IconBtn title="Ver / exportar PDF" disabled={generandoPdf === i.id} onClick={() => verPdf(i)}>
                        {generandoPdf === i.id ? "Generando…" : "PDF"}
                      </IconBtn>
                      {puedeEliminar && <IconBtn title="Eliminar" danger onClick={() => setConfirmDelete(i.id)}>Eliminar</IconBtn>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && draftAdd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }} onClick={cerrarAddVisita}>
          <div className="ct-scroll" style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 18, width: 620, maxWidth: "94vw", maxHeight: "88vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, marginBottom: 12 }}>Nuevo informe de visita técnica</div>
            <VisitaForm value={draftAdd} onChange={setDraftAdd} subiendoFoto={subiendoFoto} onSubirFotos={(files) => subirFotos(files, draftAdd, setDraftAdd)} onQuitarFoto={(idx) => quitarFoto(idx, draftAdd, setDraftAdd)} onRenombrarFoto={(idx, nombre) => renombrarFoto(idx, nombre, draftAdd, setDraftAdd)} onAgregarEspacioFoto={() => agregarEspacioFoto(draftAdd, setDraftAdd)} onSubirFotoEnEspacio={(idx, file) => subirFotoEnEspacio(idx, file, draftAdd, setDraftAdd)} contactos={contactos} trabajadores={trabajadores} puedeAdjuntar={puedeAdjuntar} />
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 14 }}>
              <span style={{ color: COLORS.faint, fontSize: 11.5 }}>Guardado automático</span>
              <button onClick={cerrarAddVisita} style={{ background: COLORS.amber, color: COLORS.amberText, border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {editingId && draftEdit && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }} onClick={cerrarEditVisita}>
          <div className="ct-scroll" style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 18, width: 620, maxWidth: "94vw", maxHeight: "88vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, marginBottom: 12 }}>Editar informe de visita técnica</div>
            <VisitaForm value={draftEdit} onChange={setDraftEdit} subiendoFoto={subiendoFoto} onSubirFotos={(files) => subirFotos(files, draftEdit, setDraftEdit)} onQuitarFoto={(idx) => quitarFoto(idx, draftEdit, setDraftEdit)} onRenombrarFoto={(idx, nombre) => renombrarFoto(idx, nombre, draftEdit, setDraftEdit)} onAgregarEspacioFoto={() => agregarEspacioFoto(draftEdit, setDraftEdit)} onSubirFotoEnEspacio={(idx, file) => subirFotoEnEspacio(idx, file, draftEdit, setDraftEdit)} contactos={contactos} trabajadores={trabajadores} puedeAdjuntar={puedeAdjuntar} />
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 14 }}>
              <span style={{ color: COLORS.faint, fontSize: 11.5 }}>Guardado automático</span>
              <button onClick={cerrarEditVisita} style={{ background: COLORS.amber, color: COLORS.amberText, border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setConfirmDelete(null)}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 18, width: 320, maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ fontSize: 13.5, color: COLORS.text, marginBottom: 14 }}>¿Eliminar este informe de visita?</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setConfirmDelete(null)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, borderRadius: 7, padding: "7px 14px", fontSize: 12.5, cursor: "pointer" }}>Cancelar</button>
              <button onClick={() => doDelete(confirmDelete)} style={{ background: COLORS.red, color: COLORS.white, border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Eliminar</button>
            </div>
          </div>
        </div>
      )}
      <PdfViewerModal pdf={pdfViewer} onClose={cerrarPdfViewer} />
      {sustentoGate.modal}
    </div>
  );
}

export { VisitaForm, ControlVisitas };
