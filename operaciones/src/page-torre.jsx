import { useState, useEffect, useMemo, useRef } from "react";
import * as C from "./core-common";
const {
  classifySyncError,
  SyncDot,
  scrollFieldIntoViewOnFocus,
  MAX_FILE_BYTES,
  fmtDate,
  DateInput,
  normEstado,
  normalizePersonKey,
  uid,
  useCarpetaLocal,
  BotonCarpetaLocal,
  nombreArchivoAnual,
  buildRespaldoXlsx,
  fmtBytes,
  fmtDateTime,
  isInteractiveTarget,
  fileToDataURL,
  subirFotoADrive,
  eliminarFotoDrive,
  reorderWithinFull,
  useRowDrag,
  DragHandle,
  AttachmentThumb,
  InfoRow,
  TC_LOGO_SHIELD,
  TC_COLORS,
  ESTADOS,
  PRIORIDADES,
  FRECUENCIAS,
  ESTADO_COLOR,
  TC_KPI_DEFS,
  TcKpi,
  DEFAULT_ALERT_PHONE,
  MESES_ANTIGUEDAD_AUTOARCHIVO,
  DIAS_RETENCION_PAPELERA,
  MS_POR_DIA,
  monthsAgoTs,
  PERMISSION_ACTIONS,
  DEFAULT_MODULE_PERMISSIONS,
  makeFullPermissionMatrix,
  DEFAULT_USERS,
  INITIAL_TASKS,
  todayStr,
  diasRestantes,
  cumplimiento,
  addPeriod,
  tcInitials,
  colorForResp,
  fmtRelTime,
  describeLog,
  NAV_ITEMS_DEFAULT,
  intentarGuardarConAprobacion,
  intentarEliminarConAprobacion,
  useSustentoGate,
  filterOwnRecords,
  DropdownSelect,
  OCSelector,
  useAutoSaveOnLeave,
} = C;

function TorreControl({ initialMe, initialIsAdmin, onGlobalLogout, puedeEliminar = true, puedeAgregar = true, puedeEditar = true, puedeExportar = true, puedeAdjuntar = true, puedeAprobar = false, initialOpenCreateUser = false, onCreateUserOpened, puedeVerTodos = true, ownerIdentity = "" }) {
  const sustentoGate = useSustentoGate();
  const [me, setMe] = useState(initialMe || null);
  const [isAdmin, setIsAdmin] = useState(!!initialIsAdmin);

  const [tasks, setTasks] = useState(null);
  const [history, setHistory] = useState([]);
  const [users, setUsers] = useState(null);
  const [workers, setWorkers] = useState([]);
  const [selectedWorker, setSelectedWorker] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncState, setSyncState] = useState("pendiente");
  // Ver nota junto al catch de "not found" en el efecto de carga inicial: nunca se escribe
  // DEFAULT_USERS (sin contraseña real) a la base de datos sin que un admin lo confirme
  // explicitamente aqui, para no volver a borrar la contraseña real del admin ante un
  // "not found" pasajero (por ejemplo, justo despues de desplegar una nueva version).
  const [needsTorreBootstrap, setNeedsTorreBootstrap] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [, forceTick] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  const [search, setSearch] = useState("");
  const [fResp, setFResp] = useState([]);
  const [kpiFilters, setKpiFilters] = useState([]);
  const [sortKey, setSortKey] = useState("id");
  const [sortDir, setSortDir] = useState(1);
  const [view, setView] = useState("tabla");

  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ tarea: "", responsable: "", prioridad: "Media", inicio: todayStr(), fin: "", estado: "No empezado", obs: "", recurrente: false, frecuencia: "Semanal" });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmPermanent, setConfirmPermanent] = useState(null);
  const [showTrash, setShowTrash] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState("member");
  const [newUserPages, setNewUserPages] = useState(NAV_ITEMS_DEFAULT.map((n) => n.key));
  const [newUserPermisos, setNewUserPermisos] = useState(makeFullPermissionMatrix());
  const [enviandoNotifCorreo, setEnviandoNotifCorreo] = useState(false);
  const [resultNotifCorreo, setResultNotifCorreo] = useState(null);
  const [respaldos, setRespaldos] = useState([]);
  const [generandoRespaldo, setGenerandoRespaldo] = useState(false);
  const [descargandoRespaldo, setDescargandoRespaldo] = useState(null);
  const [resultRespaldo, setResultRespaldo] = useState(null);
  const [userError, setUserError] = useState("");
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  useEffect(() => {
    if (initialOpenCreateUser && isAdmin) {
      openCreateWizard();
      onCreateUserOpened?.();
    }
    // disparador "una sola vez": onCreateUserOpened resetea initialOpenCreateUser en el padre;
    // incluirla en deps volvería a abrir el wizard en cada render del padre mientras el flag
    // siga en true, ya que su referencia cambia en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenCreateUser, isAdmin]);
  const [wizardStep, setWizardStep] = useState(0);

  const [detalle, setDetalle] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draftEdit, setDraftEdit] = useState(null);
  const [docs, setDocs] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDeleteDetalle, setConfirmDeleteDetalle] = useState(false);

  const [alertPhone, setAlertPhone] = useState(DEFAULT_ALERT_PHONE);
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState("");
  const [exportingAll, setExportingAll] = useState(false);

  const lastUpdateRef = useRef(0);
  const saveTimerRef = useRef(null);
  const migracionMayusculasHecha = useRef(false);
  const tasksRef = useRef([]);
  tasksRef.current = tasks || [];
  const historyRef = useRef([]);
  historyRef.current = history || [];
  const usersRef = useRef([]);
  usersRef.current = users || [];
  const meRef = useRef(me);
  meRef.current = me;

  // Migración retroactiva a mayúsculas (v3.5.31): normaliza lo ya guardado en
  // minúscula o mixtas. Se ejecuta una sola vez por sesión, solo como admin,
  // y solo persiste si hubo cambios reales.
  useEffect(() => {
    if (!isAdmin || loading || migracionMayusculasHecha.current) return;
    if (!Array.isArray(tasks) || !tasks.length) return;
    migracionMayusculasHecha.current = true;
    const up = (v) => (typeof v === "string" ? v.toUpperCase() : v);
    const normalized = tasks.map((t) => ({ ...t, tarea: up(t.tarea), responsable: up(t.responsable), obs: up(t.obs) }));
    const huboCambios = JSON.stringify(normalized) !== JSON.stringify(tasks);
    if (huboCambios) {
      setTasks(normalized);
      persist(normalized, historyRef.current, "Sistema (migración mayúsculas)", usersRef.current);
    }
  }, [isAdmin, loading, tasks]);

  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 30000);
    return () => clearInterval(t);
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

  async function persist(nextTasks, nextHistory, actor, nextUsers, expectedVersion, intent) {
    const usersToSave = nextUsers !== undefined ? nextUsers : usersRef.current;
    try {
      const ifVersion = expectedVersion !== undefined ? expectedVersion : window.storage.getVersion?.("torre_ops_data");
      await window.storage.set("torre_ops_data", JSON.stringify({ tasks: nextTasks, history: nextHistory, users: usersToSave }), { ifVersion, intent });
      const meta = { updatedAt: Date.now(), updatedBy: actor, count: nextTasks.length };
      await window.storage.set("torre_ops_meta", JSON.stringify(meta), true);
      lastUpdateRef.current = meta.updatedAt;
      setLastSync(meta);
      setSyncState("ok");
    } catch (e) {
      console.error("persist error", e);
      if (e && e.conflict) {
        setSyncState("conflicto");
        try {
          const fresh = JSON.parse(e.serverValue);
          setTasks(fresh.tasks || []);
          setHistory(fresh.history || []);
          // El servidor SIEMPRE entrega users:[] a un no-admin (por privacidad, ver
          // filterWorkerData en api/storage.js). Sustituir eso por DEFAULT_USERS (una lista
          // semilla con cuentas "Admin/user/operaciones" que no son las cuentas reales) hacia
          // un no-admin era el origen del bug: ese estado quedaba en memoria y, si la cuenta
          // volvia a guardar algo en Torre, se reenviaba como si fueran los usuarios reales,
          // borrando a los usuarios de verdad. Solo un admin puede necesitar ese respaldo
          // (recuperarse de una base de datos realmente vacia); para cualquier otra sesion,
          // una lista vacia es el valor correcto y no un error a "arreglar".
          setUsers(fresh.users && fresh.users.length ? fresh.users : (isAdmin ? DEFAULT_USERS : []));
        } catch (_) { console.error(_); }
        window.alert("Otro usuario guardó un cambio en Control de Tareas justo antes que tú, así que tu última edición no se guardó. Se cargaron los datos más recientes; por favor revisa e inténtalo de nuevo.");
        return;
      }
      setSyncState(classifySyncError(e));
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("torre_ops_data", true);
        const data = JSON.parse(res.value);
        const loadedTasks = data.tasks || [];
        const loadedHistory = data.history || [];
        const loadedUsers = data.users && data.users.length ? data.users : (isAdmin ? DEFAULT_USERS : []);
        setUsers(loadedUsers);
        const maint = runMaintenance(loadedTasks, loadedHistory);
        if (maint) {
          setTasks(maint.nextTasks);
          setHistory(maint.nextHistory);
          await persist(maint.nextTasks, maint.nextHistory, "Sistema (automatico)", loadedUsers);
        } else {
          setTasks(loadedTasks);
          setHistory(loadedHistory);
        }
        try {
          const metaRes = await window.storage.get("torre_ops_meta", true);
          const m = JSON.parse(metaRes.value);
          lastUpdateRef.current = m.updatedAt;
          setLastSync(m);
        } catch (_) { console.error(_); }
        setSyncState("ok");
      } catch (e) {
        if (String(e && e.message || "").includes("not found")) {
          // Antes, un "not found" disparaba de inmediato un persist() con DEFAULT_USERS (la
          // lista semilla del bundle, SIN passwordHash) sobre torre_ops_data. Eso era seguro
          // solo si la base de datos estaba realmente vacia, pero un "not found" pasajero
          // (por ejemplo, justo despues de desplegar una nueva version, con el pool de
          // conexiones de Neon recien frio) podia disparar la misma rama y sobrescribir la
          // lista de usuarios real -- incluida la contraseña del admin -- con la semilla sin
          // contraseña. Se reintenta una vez antes de confiar en el "not found".
          let confirmedEmpty = false;
          try {
            await new Promise((r) => setTimeout(r, 1200));
            await window.storage.get("torre_ops_data", true);
            // El reintento SI encontro el registro: no era un "not found" real. Se sale sin
            // tocar nada; el usuario puede recargar para ver los datos reales.
          } catch (e2) {
            confirmedEmpty = String(e2 && e2.message || "").includes("not found");
          }
          if (!confirmedEmpty) {
            console.error("GET de torre_ops_data devolvio 'not found' pero el reintento no lo confirmo; no se reinicializa", e);
            setSyncState("error");
            return;
          }
          // Confirmado (dos intentos consecutivos): no existe ningun registro. Aun asi, no se
          // escribe nada a la base de datos automaticamente; solo se muestra el estado local y
          // se exige que el admin confirme explicitamente la inicializacion desde la pantalla
          // (ver botón "Inicializar Torre de Control").
          setTasks(INITIAL_TASKS);
          setHistory([]);
          setUsers(isAdmin ? DEFAULT_USERS : []);
          if (isAdmin) setNeedsTorreBootstrap(true);
          setSyncState(isAdmin ? "pendiente" : classifySyncError(e));
        } else {
          console.error("no se pudo cargar torre_ops_data, no se reinicializa para evitar pisar usuarios reales", e);
          setSyncState(classifySyncError(e));
        }
      }

      try {
        const workerRes = await window.storage.get("wilarcon_asistencia_trabajadores", true);
        const workerData = JSON.parse(workerRes.value);
        const workerList = Array.isArray(workerData) ? workerData.map((x) => String(x || "").trim()).filter(Boolean) : [];
        setWorkers(Array.from(new Set(workerList)).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" })));
      } catch (e) {
        console.error("carga de trabajadores (torre): fallo", e);
        setWorkers([]);
      }
      try {
        const phoneRes = await window.storage.get("torre_alert_phone", true);
        if (phoneRes && phoneRes.value) setAlertPhone(phoneRes.value);
        else await window.storage.set("torre_alert_phone", DEFAULT_ALERT_PHONE, true);
      } catch (_) {
        try { await window.storage.set("torre_alert_phone", DEFAULT_ALERT_PHONE, true); } catch (_) { console.error(_); }
      }
      setLoading(false);
    })();
    // carga inicial (una sola vez al montar); persist/runMaintenance son funciones locales
    // redefinidas en cada render, incluirlas dispararía esta carga (y sus escrituras a storage)
    // en cada render. isAdmin solo decide el valor de respaldo si la lista de usuarios llega
    // vacía; no se re-evalúa tras el montaje.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirmBootstrapTorre() {
    if (!isAdmin || bootstrapping) return;
    setBootstrapping(true);
    try {
      await persist(INITIAL_TASKS, [], "Sistema (datos iniciales, confirmado por admin)", DEFAULT_USERS);
      setNeedsTorreBootstrap(false);
    } finally {
      setBootstrapping(false);
    }
  }

  async function saveAlertPhone() {
    const clean = phoneDraft.replace(/[^\d]/g, "");
    if (!clean) { setEditingPhone(false); return; }
    try {
      await window.storage.set("torre_alert_phone", clean, true);
      setAlertPhone(clean);
    } catch (e) {
      console.error("no se pudo guardar el numero", e);
    }
    setEditingPhone(false);
  }

  function sendAlertasWhatsApp() {
    if (!alertPhone) { setEditingPhone(true); setPhoneDraft(""); return; }
    const porResponsable = {};
    alertas.forEach((a) => {
      const r = a.t.responsable || "Sin asignar";
      if (!porResponsable[r]) porResponsable[r] = [];
      porResponsable[r].push(a);
    });
    let text = `*CONTROL DE TAREAS - OPERACIONES*\n\n`;
    Object.keys(porResponsable).sort().forEach((resp) => {
      text += `*${resp}*\n`;
      porResponsable[resp]
        .sort((a, b) => (b.dias ?? -9999) - (a.dias ?? -9999))
        .forEach(({ t, dias, cump }) => {
          const estadoTxt = cump === "Demorado" ? `${Math.abs(dias)} dia(s) de atraso` : `vence en ${dias} dia(s)`;
          text += `- _${t.tarea}_ — ${estadoTxt}\n`;
        });
      text += `\n`;
    });
    const url = `https://wa.me/${alertPhone}?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  }

  async function enviarNotificacionesCorreo() {
    if (enviandoNotifCorreo) return;
    setEnviandoNotifCorreo(true);
    setResultNotifCorreo(null);
    try {
      const res = await fetch("/api/cron-alertas-tareas", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        const resultados = data.resultados || [];
        const enviados = resultados.filter((r) => r.ok).length;
        const fallidosList = resultados.filter((r) => !r.ok);
        const detalleFallidos = fallidosList.length
          ? ` · Sin enviar: ${fallidosList.map((r) => `${r.responsable} (${r.reason === "sin_correo_configurado" ? "sin correo configurado en su usuario" : r.reason})`).join(", ")}`
          : "";
        setResultNotifCorreo({ tipo: fallidosList.length ? "error" : "ok", texto: `Enviado a ${enviados} responsable(s)${detalleFallidos}.` });
      } else {
        setResultNotifCorreo({ tipo: "error", texto: `No se pudo enviar (${data.reason || res.status}).` });
      }
    } catch (e) {
      console.error("enviarNotifCorreo (torre): error de red", e);
      setResultNotifCorreo({ tipo: "error", texto: "Error de red al enviar." });
    } finally {
      setEnviandoNotifCorreo(false);
    }
  }

  async function cargarRespaldos() {
    try {
      const res = await fetch("/api/respaldos");
      const data = await res.json().catch(() => ({}));
      if (res.ok) setRespaldos(data.backups || []);
    } catch (e) {
      console.error("cargarRespaldos: error de red", e);
    }
  }

  useEffect(() => {
    if (isAdmin) cargarRespaldos();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo se dispara al pasar a admin
  }, [isAdmin]);

  async function generarRespaldoAhora() {
    if (generandoRespaldo) return;
    setGenerandoRespaldo(true);
    setResultRespaldo(null);
    try {
      const res = await fetch("/api/cron-respaldo-anual", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setResultRespaldo({ tipo: "ok", texto: `Respaldo del ${data.anio} generado (${data.claves} claves).` });
        cargarRespaldos();
      } else {
        setResultRespaldo({ tipo: "error", texto: `No se pudo generar (${data.reason || res.status}).` });
      }
    } catch (e) {
      console.error("generarRespaldoAhora: error de red", e);
      setResultRespaldo({ tipo: "error", texto: "Error de red al generar el respaldo." });
    } finally {
      setGenerandoRespaldo(false);
    }
  }

  async function descargarRespaldoJson(anio) {
    setDescargandoRespaldo(`${anio}-json`);
    try {
      const res = await fetch(`/api/respaldos?anio=${anio}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setResultRespaldo({ tipo: "error", texto: `No se pudo descargar el respaldo del ${anio}.` }); return; }
      const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `respaldo-wilarcon-${anio}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("descargarRespaldoJson: error de red", e);
      setResultRespaldo({ tipo: "error", texto: "Error de red al descargar." });
    } finally {
      setDescargandoRespaldo(null);
    }
  }

  async function descargarRespaldoExcel(anio) {
    setDescargandoRespaldo(`${anio}-xlsx`);
    try {
      const res = await fetch(`/api/respaldos?anio=${anio}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setResultRespaldo({ tipo: "error", texto: `No se pudo descargar el respaldo del ${anio}.` }); return; }
      await buildRespaldoXlsx(anio, data.data);
    } catch (e) {
      console.error("descargarRespaldoExcel: error de red", e);
      setResultRespaldo({ tipo: "error", texto: "Error de red al descargar." });
    } finally {
      setDescargandoRespaldo(null);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- intervalo creado una sola vez al montar;
  // usa tasksRef/historyRef (ya actualizados en cada render) para leer los datos vigentes en cada
  // tick, así que no necesita reiniciarse cuando persist/runMaintenance cambian de referencia.
  useEffect(() => {
    const t = setInterval(() => {
      const maint = runMaintenance(tasksRef.current, historyRef.current);
      if (maint) {
        setTasks(maint.nextTasks);
        setHistory(maint.nextHistory);
        clearTimeout(saveTimerRef.current);
        persist(maint.nextTasks, maint.nextHistory, "Sistema (automatico)");
      }
    }, 3600000);
    return () => clearInterval(t);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- polling creado una sola vez al montar;
  // isAdmin solo se usa como respaldo si llega una lista de usuarios vacía desde el servidor.
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const metaRes = await window.storage.get("torre_ops_meta", true);
        const m = JSON.parse(metaRes.value);
        if (m.updatedAt !== lastUpdateRef.current) {
          const res = await window.storage.get("torre_ops_data", true);
          const data = JSON.parse(res.value);
          setTasks(data.tasks || []);
          setHistory(data.history || []);
          setUsers(data.users && data.users.length ? data.users : (isAdmin ? DEFAULT_USERS : []));
          lastUpdateRef.current = m.updatedAt;
          setLastSync(m);
        }
        setSyncState("ok");
      } catch (e) {
        setSyncState(classifySyncError(e));
      }
    }, 4000);
    return () => clearInterval(t);
  }, []);

  function pushLog(currentHistory, entry, actorOverride) {
    const nextId = currentHistory.length ? Math.max(...currentHistory.map((h) => h.id)) + 1 : 1;
    const next = [...currentHistory, { id: nextId, ts: Date.now(), actor: actorOverride || meRef.current, ...entry }];
    return next.length > 300 ? next.slice(next.length - 300) : next;
  }

  function runMaintenance(currentTasks, currentHistory) {
    const now = Date.now();
    const cutoffArchivo = monthsAgoTs(MESES_ANTIGUEDAD_AUTOARCHIVO);
    let changed = false;
    let nextHistory = currentHistory;

    let nextTasks = currentTasks.map((t) => {
      if (!t.deleted && t.estado === "Completado") {
        const ref = t.completadoAt || (t.fin ? new Date(t.fin + "T00:00:00").getTime() : null);
        if (ref && ref < cutoffArchivo) {
          changed = true;
          nextHistory = pushLog(nextHistory, { action: "auto_trash", taskId: t.id, taskTarea: t.tarea }, "Sistema (automatico)");
          return { ...t, deleted: true, deletedAt: now };
        }
      }
      return t;
    });

    nextTasks = nextTasks.filter((t) => {
      if (t.deleted && t.deletedAt && now - t.deletedAt > DIAS_RETENCION_PAPELERA * MS_POR_DIA) {
        changed = true;
        nextHistory = pushLog(nextHistory, { action: "auto_purge", taskId: t.id, taskTarea: t.tarea }, "Sistema (automatico)");
        return false;
      }
      return true;
    });

    return changed ? { nextTasks, nextHistory } : null;
  }

  // Efecto secundario "best-effort" al crear una tarea: avisa por correo al responsable vía
  // /api/notificar-tarea (que reenvía al mismo webhook/Apps Script que ya usan el resumen
  // diario y las notificaciones de cotización). Si falla, no afecta el flujo: la tarea ya
  // quedó guardada en "Control de Tareas" antes de llamar aquí.
  async function notificarNuevaTarea(task) {
    if (!task.responsable || task.responsable === "Sin asignar") return;
    try {
      await fetch("/api/notificar-tarea", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responsable: task.responsable,
          tarea: task.tarea,
          prioridad: task.prioridad,
          inicio: task.inicio,
          fin: task.fin,
          obs: task.obs,
        }),
      });
    } catch (e) {
      console.error("no se pudo enviar la notificacion de tarea nueva", e);
    }
  }

  function addTask() {
    if (!puedeAgregar) return;
    if (!draft.tarea.trim()) return;
    const current = tasksRef.current;
    const nextId = current.length ? Math.max(...current.map((t) => t.id)) + 1 : 1;
    const newTask = { id: nextId, ...draft, tarea: draft.tarea.trim(), responsable: draft.responsable.trim() || "Sin asignar", deleted: false, deletedAt: null, completadoAt: draft.estado === "Completado" ? Date.now() : null };
    const nextTasks = [...current, newTask];
    const nextHistory = pushLog(historyRef.current, { action: "add", taskId: nextId, taskTarea: newTask.tarea });
    setTasks(nextTasks);
    setHistory(nextHistory);
    clearTimeout(saveTimerRef.current);
    persist(nextTasks, nextHistory, meRef.current, undefined, undefined, "crear");
    notificarNuevaTarea(newTask);
    setShowAdd(false);
    setDraft({ tarea: "", responsable: "", prioridad: "Media", inicio: todayStr(), fin: "", estado: "No empezado", obs: "", recurrente: false, frecuencia: "Semanal" });
  }

  async function moveToTrash(id) {
    if (!puedeEliminar) return;
    const current = tasksRef.current;
    const task = current.find((t) => t.id === id);
    if (!task) return;
    // Enviar a la papelera es, en el fondo, una edicion del registro (deleted:false -> true), y
    // por eso pasa por el mismo flujo de aprobacion que el resto de ediciones de Torre (a
    // diferencia de antes, cuando se aplicaba directo sin pasar por el admin, inconsistente con
    // el resto de modulos).
    await intentarGuardarConAprobacion({
      puedeAprobar, modulo: "torre", moduloLabel: "Control de Tareas",
      storageKey: "torre_ops_data", contenedor: "tasks", idField: "id", recordId: id,
      original: task, propuesto: { ...task, deleted: true, deletedAt: Date.now() },
      autor: meRef.current,
      labels: { deleted: "Eliminada (papelera)", deletedAt: "Fecha de eliminación" },
      pedirSustento: sustentoGate.solicitar,
      persistDirecto: async () => {
        const nextTasks = current.map((t) => (t.id === id ? { ...t, deleted: true, deletedAt: Date.now() } : t));
        const nextHistory = pushLog(historyRef.current, { action: "trash", taskId: id, taskTarea: task.tarea });
        setTasks(nextTasks);
        setHistory(nextHistory);
        clearTimeout(saveTimerRef.current);
        await persist(nextTasks, nextHistory, meRef.current, undefined, undefined, "eliminar");
      },
    });
    setConfirmDelete(null);
  }

  function restoreTask(id) {
    if (!puedeEliminar) return;
    const current = tasksRef.current;
    const task = current.find((t) => t.id === id);
    if (!task) return;
    const nextTasks = current.map((t) => (t.id === id ? { ...t, deleted: false, deletedAt: null } : t));
    const nextHistory = pushLog(historyRef.current, { action: "restore", taskId: id, taskTarea: task.tarea });
    setTasks(nextTasks);
    setHistory(nextHistory);
    clearTimeout(saveTimerRef.current);
    persist(nextTasks, nextHistory, meRef.current, undefined, undefined, "eliminar");
  }

  async function permanentDelete(id) {
    if (!puedeEliminar) return;
    const current = tasksRef.current;
    const task = current.find((t) => t.id === id);
    if (!task) return;
    // Borrado definitivo desde la papelera: es la eliminacion real (ya no un simple
    // deleted:true), asi que pasa por intentarEliminarConAprobacion igual que en el resto de
    // modulos.
    await intentarEliminarConAprobacion({
      puedeAprobar, modulo: "torre", moduloLabel: "Control de Tareas",
      storageKey: "torre_ops_data", contenedor: "tasks", idField: "id", recordId: id,
      resumen: task.tarea, autor: meRef.current,
      pedirSustento: sustentoGate.solicitar,
      persistDirecto: async () => {
        const nextTasks = current.filter((t) => t.id !== id);
        const nextHistory = pushLog(historyRef.current, { action: "permanent_delete", taskId: id, taskTarea: task.tarea });
        setTasks(nextTasks);
        setHistory(nextHistory);
        clearTimeout(saveTimerRef.current);
        await persist(nextTasks, nextHistory, meRef.current, undefined, undefined, "eliminar");
      },
    });
    setConfirmPermanent(null);
  }

  function emptyTrash() {
    if (!puedeEliminar) return;
    if (!puedeAprobar) {
      // Vaciar la papelera borra varios registros de una sola vez, algo que el sistema de
      // propuestas (pensado para un registro a la vez) no modela bien. En vez de aplicarlo
      // directo sin aprobacion (el bug original), se exige que quien no puede aprobar elimine
      // cada tarea de la papelera de forma individual, para que cada una pase por su propia
      // solicitud de aprobacion.
      window.alert("Vaciar la papelera por completo requiere permiso de aprobación. Elimina cada tarea de la papelera de forma individual para enviar la solicitud de aprobación correspondiente.");
      return;
    }
    const current = tasksRef.current;
    const trashCount = current.filter((t) => t.deleted).length;
    if (trashCount === 0) return;
    const nextTasks = current.filter((t) => !t.deleted);
    const nextHistory = pushLog(historyRef.current, { action: "empty_trash", count: trashCount });
    setTasks(nextTasks);
    setHistory(nextHistory);
    clearTimeout(saveTimerRef.current);
    persist(nextTasks, nextHistory, meRef.current, undefined, undefined, "eliminar");
  }

  const TC_DOCS_KEY_PREFIX = "wilarcon_torre_docs_";
  async function loadDocsForTask(id) {
    setDocsLoading(true);
    try {
      const res = await window.storage.get(`${TC_DOCS_KEY_PREFIX}${id}`, true);
      const data = JSON.parse(res.value);
      setDocs(Array.isArray(data) ? data : []);
    } catch (e) {
      console.warn("loadDocsForTask: no se pudieron cargar los adjuntos", e);
      setDocs([]);
    }
    setDocsLoading(false);
  }
  async function saveDocsForTask(id, nextDocs) {
    setDocs(nextDocs);
    try {
      await window.storage.set(`${TC_DOCS_KEY_PREFIX}${id}`, JSON.stringify(nextDocs), true);
    } catch (e) {
      console.error("no se pudo guardar archivos", e);
    }
  }
  function openDetalle(id) {
    setDetalle(id);
    setEditing(false);
    setConfirmDeleteDetalle(false);
    loadDocsForTask(id);
  }
  async function closeDetalle() {
    if (editing) await autoSaveEditDetalle();
    setDetalle(null);
    setEditing(false);
    setDraftEdit(null);
    setDocs([]);
    setConfirmDeleteDetalle(false);
  }
  const currentTask = useMemo(() => (tasks || []).find((t) => t.id === detalle) || null, [tasks, detalle]);
  function startEditDetalle() {
    if (!currentTask) return;
    setDraftEdit({ ...currentTask });
    setEditing(true);
  }
  async function cancelEditDetalle() {
    await autoSaveEditDetalle();
    setEditing(false);
    setDraftEdit(null);
  }
  function persistEditTorre(draftToSave) {
    if (!draftToSave || !currentTask) return;
    const current = tasksRef.current;
    const original = current.find((t) => t.id === detalle);
    if (!original) return;
    const allowedFields = puedeEditar
      ? ["tarea", "responsable", "prioridad", "inicio", "fin", "estado", "obs", "recurrente", "frecuencia"]
      : ["estado", "obs"];
    const changes = {};
    allowedFields.forEach((f) => {
      if (draftToSave[f] !== original[f]) changes[f] = draftToSave[f];
    });
    if (Object.keys(changes).length === 0) return;
    if (!puedeAprobar) {
      intentarGuardarConAprobacion({
        puedeAprobar, modulo: "torre", moduloLabel: "Control de Tareas",
        storageKey: "torre_ops_data", contenedor: "tasks", idField: "id", recordId: detalle,
        original, propuesto: { ...original, ...changes }, autor: meRef.current,
        labels: { tarea: "Tarea", responsable: "Responsable", prioridad: "Prioridad", inicio: "Inicio", fin: "Fin", estado: "Estado", obs: "Observaciones", recurrente: "Recurrente", frecuencia: "Frecuencia" },
        persistDirecto: () => {},
        pedirSustento: sustentoGate.solicitar,
      });
      return;
    }
    let nextHistory = historyRef.current;
    let updatedTask;
    const willComplete = changes.estado === "Completado";
    const staysRecurrente = changes.recurrente !== undefined ? changes.recurrente : original.recurrente;
    if (willComplete && staysRecurrente) {
      const baseInicio = changes.inicio !== undefined ? changes.inicio : original.inicio;
      const baseFin = changes.fin !== undefined ? changes.fin : original.fin;
      const baseFrecuencia = changes.frecuencia !== undefined ? changes.frecuencia : original.frecuencia;
      const nextInicio = addPeriod(baseInicio, baseFrecuencia) || baseInicio;
      const nextFin = addPeriod(baseFin, baseFrecuencia) || baseFin;
      updatedTask = { ...original, ...changes, estado: "No empezado", inicio: nextInicio, fin: nextFin };
      nextHistory = pushLog(nextHistory, { action: "recurring_reset", taskId: detalle, taskTarea: original.tarea, nextFin });
    } else {
      updatedTask = { ...original, ...changes };
      if (changes.estado !== undefined) updatedTask.completadoAt = changes.estado === "Completado" ? Date.now() : null;
      Object.keys(changes).forEach((field) => {
        nextHistory = pushLog(nextHistory, { action: "edit", taskId: detalle, taskTarea: original.tarea, field, before: original[field], after: changes[field] });
      });
    }
    const nextTasks = current.map((t) => (t.id === detalle ? updatedTask : t));
    setTasks(nextTasks);
    setHistory(nextHistory);
    clearTimeout(saveTimerRef.current);
    persist(nextTasks, nextHistory, meRef.current, undefined, undefined, "editar");
  }
  // Autoguardado: guarda lo editado si el usuario cambia de pestaña, oculta la
  // ventana o cierra el detalle sin apretar "Guardar".
  const autoSaveEditDetalle = useAutoSaveOnLeave({
    active: editing,
    draft: draftEdit,
    saveFn: async (d) => persistEditTorre(d),
  });
  function saveEditDetalle() {
    if (!draftEdit || !currentTask) return;
    persistEditTorre(draftEdit);
    setEditing(false);
    setDraftEdit(null);
  }
  function deleteCurrentTask() {
    if (!puedeEliminar || !detalle) return;
    moveToTrash(detalle);
    closeDetalle();
  }
  async function onFilesSelectedTask(fileList) {
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
    if (accepted.length) {
      const next = [...docs, ...accepted];
      await saveDocsForTask(detalle, next);
    }
    setUploading(false);
  }
  function removeAttachmentTask(id) {
    if (!puedeAdjuntar) return;
    const doc = docs.find((d) => d.id === id);
    if (doc && doc.driveFileId) eliminarFotoDrive(doc.driveFileId);
    const next = docs.filter((d) => d.id !== id);
    saveDocsForTask(detalle, next);
  }

  function toggleNewUserPage(key) {
    setNewUserPages((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
    setNewUserPermisos((prev) => {
      const current = prev[key] || DEFAULT_MODULE_PERMISSIONS[key];
      const next = !current.ver;
      return { ...prev, [key]: { ...current, ...Object.fromEntries(PERMISSION_ACTIONS.map(a => [a.key, next])) } };
    });
  }

  function usernameFromWorker(worker) {
    return String(worker || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
  }

  function addUser() {
    if (!isAdmin) return false;
    const name = newUserName.trim();
    const pwd = newUserPassword;
    const worker = selectedWorker.trim();
    if (!worker) { setUserError("Selecciona un trabajador registrado"); return false; }
    if (!name || !pwd) { setUserError("Completa usuario y contraseña"); return false; }
    const exists = usersRef.current.some((u) => u.name.toLowerCase() === name.toLowerCase());
    if (exists) { setUserError("Ya existe un usuario con ese nombre"); return false; }
    const linked = usersRef.current.some((u) => u.trabajador && normalizePersonKey(u.trabajador) === normalizePersonKey(worker));
    if (linked) { setUserError("Ese trabajador ya tiene un usuario vinculado"); return false; }
    if (newUserRole === "member" && !Object.values(newUserPermisos).some((m) => m.ver)) { setUserError("Activa al menos un módulo con permiso Ver"); return false; }
    const nextUsers = [
      ...usersRef.current,
      {
        name,
        password: pwd,
        role: newUserRole,
        trabajador: worker,
        trabajadorId: `worker:${normalizePersonKey(worker)}`,
        email: newUserEmail.trim(),
        ...(newUserRole === "member" ? { paginas: Object.entries(newUserPermisos).filter(([,m]) => m.ver).map(([k]) => k), permisosPorPagina: newUserPermisos } : {}),
        activo: true,
        createdAt: Date.now(),
      },
    ];
    const nextHistory = pushLog(historyRef.current, { action: "user_add", targetUser: name, trabajador: worker });
    setUsers(nextUsers);
    setHistory(nextHistory);
    clearTimeout(saveTimerRef.current);
    persist(tasksRef.current, nextHistory, meRef.current, nextUsers);
    setNewUserName(""); setNewUserPassword(""); setNewUserEmail(""); setSelectedWorker(""); setNewUserRole("member"); setNewUserPages(NAV_ITEMS_DEFAULT.map((n) => n.key)); setNewUserPermisos(makeFullPermissionMatrix()); setUserError("");
    return true;
  }

  const WIZARD_STEPS_MEMBER = [
    { key: "datos", label: "Datos", short: "1" },
    { key: "paginas", label: "Páginas", short: "2" },
    { key: "permisos", label: "Permisos", short: "3" },
    { key: "confirmar", label: "Confirmar", short: "4" },
  ];
  const WIZARD_STEPS_SIMPLE = [
    { key: "datos", label: "Datos", short: "1" },
    { key: "confirmar", label: "Confirmar", short: "2" },
  ];
  const wizardSteps = newUserRole === "member" ? WIZARD_STEPS_MEMBER : WIZARD_STEPS_SIMPLE;
  const wizardStepKey = wizardSteps[Math.min(wizardStep, wizardSteps.length - 1)]?.key;

  function openCreateWizard() {
    setNewUserName(""); setNewUserPassword(""); setSelectedWorker(""); setNewUserRole("member");
    setNewUserPages(NAV_ITEMS_DEFAULT.map((n) => n.key));
    setNewUserPermisos(makeFullPermissionMatrix());
    setUserError("");
    setWizardStep(0);
    setShowCreateWizard(true);
  }
  function closeCreateWizard() {
    setShowCreateWizard(false);
    setUserError("");
    setNewUserName(""); setNewUserPassword(""); setSelectedWorker(""); setNewUserRole("member");
    setNewUserPages(NAV_ITEMS_DEFAULT.map((n) => n.key));
    setNewUserPermisos(makeFullPermissionMatrix());
  }
  function wizardGoNext() {
    if (wizardStepKey === "datos") {
      const name = newUserName.trim();
      if (!selectedWorker) { setUserError("Selecciona un trabajador registrado"); return; }
      if (!name || !newUserPassword) { setUserError("Completa usuario y contraseña"); return; }
      const exists = usersRef.current.some((u) => u.name.toLowerCase() === name.toLowerCase());
      if (exists) { setUserError("Ya existe un usuario con ese nombre"); return; }
      if (usersRef.current.some((u) => u.trabajador && normalizePersonKey(u.trabajador) === normalizePersonKey(selectedWorker))) { setUserError("Ese trabajador ya tiene un usuario vinculado"); return; }
    }
    if (wizardStepKey === "paginas" && !newUserPages.length) { setUserError("Selecciona al menos una página"); return; }
    if (wizardStepKey === "permisos" && !Object.values(newUserPermisos).some((m) => m.ver)) { setUserError("Activa al menos un módulo con permiso Ver"); return; }
    setUserError("");
    setWizardStep((s) => Math.min(s + 1, wizardSteps.length - 1));
  }
  function wizardGoBack() {
    setUserError("");
    setWizardStep((s) => Math.max(s - 1, 0));
  }
  function wizardFinish() {
    const ok = addUser();
    if (ok) { setShowCreateWizard(false); setWizardStep(0); }
  }

  function toggleMatrixPermission(pageKey, actionKey) {
    setNewUserPermisos((prev) => ({ ...prev, [pageKey]: { ...(prev[pageKey] || DEFAULT_MODULE_PERMISSIONS[pageKey]), [actionKey]: !prev[pageKey]?.[actionKey] } }));
  }

  const activeTasks = useMemo(() => {
    const base = tasks ? tasks.filter((t) => !t.deleted) : [];
    return puedeVerTodos ? base : filterOwnRecords(base, ownerIdentity, "responsable");
  }, [tasks, puedeVerTodos, ownerIdentity]);
  const trashedTasks = useMemo(() => {
    const base = tasks ? tasks.filter((t) => t.deleted) : [];
    return puedeVerTodos ? base : filterOwnRecords(base, ownerIdentity, "responsable");
  }, [tasks, puedeVerTodos, ownerIdentity]);

  const responsables = useMemo(() => { const out=[]; const seen=new Set(); activeTasks.forEach((t)=>{ const raw=String(t.responsable||"").trim(); const key=normalizePersonKey(raw); if(raw && !seen.has(key)){seen.add(key);out.push(raw);} }); return out.sort((a,b)=>a.localeCompare(b,"es",{sensitivity:"base"})); }, [activeTasks]);

  useEffect(() => {
    if (initialMe && !isAdmin && tasks && fResp.length === 0) {
      const match = responsables.find((r) => normalizePersonKey(r) === normalizePersonKey(initialMe));
      if (match) setFResp([match]);
    }
  }, [tasks, isAdmin, initialMe, fResp.length, responsables]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeTasks.filter((t) => {
      if (fResp.length && !fResp.some((x) => normalizePersonKey(x) === normalizePersonKey(t.responsable))) return false;
      if (kpiFilters.length && !kpiFilters.some((k) => TC_KPI_DEFS[k] && TC_KPI_DEFS[k].predicate(t))) return false;
      if (q && !(`${t.tarea} ${t.responsable} ${t.obs}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [activeTasks, fResp, kpiFilters, search]);

  const sorted = useMemo(() => {
    if (sortKey === "__manual") return filtered;
    const arr = [...filtered];
    arr.sort((a, b) => {
      let av, bv;
      if (sortKey === "dias") { av = diasRestantes(a.fin) ?? 9999; bv = diasRestantes(b.fin) ?? 9999; }
      else if (sortKey === "cumplimiento") { av = cumplimiento(a); bv = cumplimiento(b); }
      else { av = a[sortKey]; bv = b[sortKey]; }
      if (av === bv) return 0;
      if (av === null || av === undefined || av === "") return 1;
      if (bv === null || bv === undefined || bv === "") return -1;
      return av > bv ? sortDir : -sortDir;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => -d);
    else { setSortKey(key); setSortDir(1); }
  }

  function handleManualReorder(fromIdx, toIdx) {
    const next = reorderWithinFull(tasksRef.current, sorted, fromIdx, toIdx, "id");
    setSortKey("__manual");
    persist(next, historyRef.current, meRef.current);
  }
  const rowDrag = useRowDrag({ enabled: !!isAdmin, idKey: "id", onReorder: handleManualReorder });

  const kanbanDragRef = useRef(null);
  const [kanbanArmed, setKanbanArmed] = useState(null);
  const [kanbanOverId, setKanbanOverId] = useState(null);
  function handleKanbanReorder(colItems, fromIdx, toIdx) {
    const next = reorderWithinFull(tasksRef.current, colItems, fromIdx, toIdx, "id");
    setSortKey("__manual");
    persist(next, historyRef.current, meRef.current);
  }
  // Fallback para celular: el arrastre nativo de abajo no responde al dedo, así que esto
  // mueve la tarjeta un puesto arriba/abajo dentro de su misma columna con un toque.
  function moveKanbanBy(index, delta, colItems) {
    if (!isAdmin) return;
    const target = index + delta;
    if (target < 0 || target >= colItems.length) return;
    handleKanbanReorder(colItems, index, target);
  }
  function kanbanHandleProps(estado, index) {
    if (!isAdmin) return {};
    return {
      onMouseDown: (e) => { e.stopPropagation(); setKanbanArmed({ estado, index }); },
      onMouseUp: (e) => { e.stopPropagation(); setKanbanArmed(null); },
      onTouchStart: (e) => { e.stopPropagation(); setKanbanArmed({ estado, index }); },
      onTouchEnd: (e) => { e.stopPropagation(); setKanbanArmed(null); },
      onClick: (e) => { e.stopPropagation(); },
    };
  }
  function kanbanCardProps(estado, index, item, colItems) {
    if (!isAdmin) return {};
    return {
      draggable: !!kanbanArmed && kanbanArmed.estado === estado && kanbanArmed.index === index,
      onDragStart: (e) => {
        kanbanDragRef.current = { estado, index };
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", String(item.id)); } catch (_) { console.error(_); }
      },
      onDragEnter: (e) => {
        if (kanbanDragRef.current && kanbanDragRef.current.estado === estado) {
          e.preventDefault();
          setKanbanOverId(item.id);
        }
      },
      onDragOver: (e) => {
        if (kanbanDragRef.current && kanbanDragRef.current.estado === estado) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      },
      onDragLeave: () => setKanbanOverId((cur) => (cur === item.id ? null : cur)),
      onDrop: (e) => {
        const from = kanbanDragRef.current;
        kanbanDragRef.current = null;
        setKanbanOverId(null);
        setKanbanArmed(null);
        if (!from || from.estado !== estado)
          return;
        e.preventDefault();
        if (from.index === index) return;
        handleKanbanReorder(colItems, from.index, index);
      },
      onDragEnd: () => {
        kanbanDragRef.current = null;
        setKanbanOverId(null);
        setKanbanArmed(null);
      },
    };
  }

  const kpiScopedTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeTasks.filter((t) => {
      if (fResp.length && !fResp.some((x) => normalizePersonKey(x) === normalizePersonKey(t.responsable))) return false;
      if (q && !(`${t.tarea ?? ""} ${t.responsable ?? ""} ${t.obs ?? ""}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [activeTasks, fResp, search]);

  const kpiScopedTrash = useMemo(() => {
    const q = search.trim().toLowerCase();
    return trashedTasks.filter((t) => {
      if (fResp.length && !fResp.some((x) => normalizePersonKey(x) === normalizePersonKey(t.responsable))) return false;
      if (q && !(`${t.tarea ?? ""} ${t.responsable ?? ""} ${t.obs ?? ""}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [trashedTasks, fResp, search]);

  const kpis = useMemo(() => {
    const activeScoped = kpiScopedTasks;
    const trashedScoped = kpiScopedTrash;
    const total = activeScoped.length + trashedScoped.length;
    const completado = activeScoped.filter((t) => normEstado(t.estado) === "COMPLETADO").length;
    const encurso = activeScoped.filter((t) => normEstado(t.estado) === "EN CURSO").length;
    const noempezado = activeScoped.filter((t) => normEstado(t.estado) === "NO EMPEZADO").length;
    const demoradas = activeScoped.filter((t) => cumplimiento(t) === "Demorado").length;
    const activos = activeScoped.length;
    const pctEnPlazo = activos ? Math.round(((activos - demoradas) / activos) * 100) : 0;
    return { total, completado, encurso, noempezado, demoradas, pctEnPlazo, enPapelera: trashedScoped.length, activos };
  }, [kpiScopedTasks, kpiScopedTrash]);

  const estadoChartData = useMemo(() => {
    return [
      { name: "Completado", value: kpis.completado, color: TC_COLORS.green },
      { name: "En curso", value: kpis.encurso, color: TC_COLORS.amber },
      { name: "No empezado", value: kpis.noempezado, color: TC_COLORS.slate },
    ].filter((d) => d.value > 0);
  }, [kpis]);

  const respChartData = useMemo(() => {
    const scopedResponsables = [...new Set(filtered.map((t) => t.responsable).filter(Boolean))].sort();
    return scopedResponsables.map((r) => {
      const mine = filtered.filter((t) => t.responsable === r);
      return {
        name: r,
        enPlazo: mine.filter((t) => cumplimiento(t) !== "Demorado").length,
        demorado: mine.filter((t) => cumplimiento(t) === "Demorado").length,
      };
    });
  }, [filtered]);

  const alertas = useMemo(() => {
    return filtered
      .filter((t) => normEstado(t.estado) !== "COMPLETADO")
      .map((t) => ({ t, dias: diasRestantes(t.fin), cump: cumplimiento(t) }))
      .filter((x) => x.cump === "Demorado" || (x.dias !== null && x.dias >= 0 && x.dias <= 3))
      .sort((a, b) => (a.dias ?? 9999) - (b.dias ?? 9999))
      .slice(0, 10);
  }, [filtered]);

  const kanbanColumns = useMemo(() => ESTADOS.map((estado) => ({ estado, items: sorted.filter((t) => t.estado === estado) })), [sorted]);

  function resetFilters() {
    setFResp([]); setKpiFilters([]); setSearch("");
  }
  function toggleKpiFilter(key) {
    setKpiFilters((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }
  const filtersActive = fResp.length || kpiFilters.length || search;
  const onlyMineActive = !isAdmin && fResp.length === 1 && normalizePersonKey(fResp[0]) === normalizePersonKey(me || "");

  async function exportAllPagesCsv() {
    setExportingAll(true);
    try {
      await C.downloadXlsxWorkbook(sheetsTorre(), "torre-de-control");
    } catch (e) {
      console.error("exportAllPagesCsv error", e);
      alert("Ocurrió un error al generar la descarga. Intenta nuevamente.");
    } finally {
      setExportingAll(false);
    }
  }
  function sheetsTorre() {
    const tareasHeader = ["ID", "Tarea", "Responsable", "Prioridad", "Inicio", "Fin", "Dias", "Estado", "Cumplimiento", "Observaciones"];
    return [{
      name: "Control de Tareas",
      records: sorted,
      headers: tareasHeader,
      rowMapper: (t, idx) => [
        idx + 1, t.tarea, t.responsable, t.prioridad, t.inicio, t.fin, diasRestantes(t.fin) ?? "", t.estado, cumplimiento(t), t.obs,
      ],
    }];
  }
  const carpetaLocal = useCarpetaLocal("torre");
  useEffect(() => {
    if (!tasks) return;
    carpetaLocal.programarGuardado(nombreArchivoAnual("operaciones-torre-de-control"), sheetsTorre);
  }, [tasks]);

  if (loading || !tasks) {
    return (
      <div style={{ minHeight: 300, display: "flex", alignItems: "center", justifyContent: "center", background: TC_COLORS.bg, borderRadius: 12, color: TC_COLORS.dim, fontFamily: "'Inter',sans-serif", fontSize: 13 }}>
        Conectando con la base de datos compartida…
      </div>
    );
  }

  const lockStyle = { opacity: 0.55, cursor: "not-allowed" };

  return (
    <div style={{ background: TC_COLORS.bg, color: TC_COLORS.text, fontFamily: "'Inter',sans-serif", fontSize: 13, padding: isMobile ? 10 : 16, borderRadius: 14 }}>
      <style>{`
        .tc-th { position: sticky; top: 0; background: ${TC_COLORS.panel2}; text-align: left; padding: 9px 10px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .5px; color: ${TC_COLORS.dim}; border-bottom: 1px solid ${TC_COLORS.border}; cursor: pointer; user-select: none; white-space: nowrap; }
        .tc-th:hover { color: ${TC_COLORS.amber}; }
        .tc-td { padding: 6px 8px; border-bottom: 1px solid ${TC_COLORS.grid}; vertical-align: middle; }
        .tc-row:hover { background: rgba(242,167,59,.05); }
        .tc-input { background: transparent; border: 1px solid transparent; color: ${TC_COLORS.text}; font-family: 'Inter',sans-serif; font-size: 12.5px; padding: 6px 7px; border-radius: 6px; width: 100%; outline: none; box-sizing: border-box; }
        .tc-input:hover { background: ${TC_COLORS.panel2}; border-color: ${TC_COLORS.border}; }
        .tc-input:focus { background: ${TC_COLORS.panel2}; border-color: ${TC_COLORS.amber}; }
        .tc-scroll::-webkit-scrollbar { height: 8px; width: 8px; }
        .tc-scroll::-webkit-scrollbar-thumb { background: ${TC_COLORS.border}; border-radius: 4px; }
        .tc-card { background: ${TC_COLORS.panel2}; border: 1px solid ${TC_COLORS.border}; border-radius: 9px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
        .tc-filebtn { display: inline-flex; align-items: center; gap: 6px; background: ${TC_COLORS.panel2}; border: 1px dashed ${TC_COLORS.border}; color: ${TC_COLORS.text}; padding: 8px 14px; border-radius: 7px; font-size: 12.5px; cursor: pointer; }
        .tc-filebtn:hover { border-color: ${TC_COLORS.amber}; color: ${TC_COLORS.amber}; }
        .tc-detailbtn { background: transparent; border: 1px solid ${TC_COLORS.border}; color: ${TC_COLORS.dim}; border-radius: 6px; padding: 5px 10px; font-size: 11px; cursor: pointer; white-space: nowrap; }
        .tc-detailbtn:hover { border-color: ${TC_COLORS.amber}; color: ${TC_COLORS.amber}; }
      `}</style>

      {needsTorreBootstrap && isAdmin && (
        <div style={{ background: "rgba(230,162,60,.12)", border: `1px solid ${TC_COLORS.amber}`, borderRadius: 10, padding: "14px 18px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12.5, color: TC_COLORS.text, lineHeight: 1.5 }}>
            <strong>No se encontraron datos de Torre de Control en la base de datos.</strong> Por seguridad, ya no se inicializa la lista de usuarios automaticamente (eso es lo que antes podia borrar la contraseña del admin, por ejemplo justo despues de un despliegue). Confirma para crear los datos iniciales, o recarga la pagina si esperabas ver datos existentes.
          </div>
          <button onClick={confirmBootstrapTorre} disabled={bootstrapping} style={{ background: TC_COLORS.amber, border: "none", color: TC_COLORS.amberText, borderRadius: 7, padding: "9px 16px", fontSize: 12.5, fontWeight: 600, cursor: bootstrapping ? "default" : "pointer", flexShrink: 0, opacity: bootstrapping ? 0.7 : 1 }}>
            {bootstrapping ? "Inicializando..." : "Inicializar Torre de Control"}
          </button>
        </div>
      )}

      <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "center", justifyContent: "space-between", background: TC_COLORS.panel, border: `1px solid ${TC_COLORS.border}`, borderRadius: 10, padding: "14px 18px", marginBottom: 14, flexWrap: "wrap", gap: 12, flexDirection: isMobile ? "column" : "row" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src={TC_LOGO_SHIELD} alt="Operaciones" style={{ width: 40, height: "auto", flexShrink: 0, display: "block" }} />
          <div>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 600 }}>CONTROL DE TAREAS</div>
            <div style={{ fontSize: 11, color: TC_COLORS.dim, display: "flex", alignItems: "center", gap: 4 }}>
              Base de datos compartida en vivo
              <SyncDot syncState={syncState} palette={TC_COLORS} />
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ textAlign: "right", fontSize: 11 }}>
            <div style={{ color: TC_COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, fontSize: 10 }}>Ultima actualizacion</div>
            <div style={{ color: TC_COLORS.text }}>{lastSync ? `${lastSync.updatedBy} · ${fmtRelTime(lastSync.updatedAt)}` : "—"}</div>
          </div>
        </div>
      </div>

      {kpis && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 14 }}>
          <div
            onClick={kpis.enPapelera > 0 ? () => setShowTrash(true) : undefined}
            style={{
              background: TC_COLORS.panel,
              border: `1px solid ${TC_COLORS.border}`,
              borderRadius: 10, padding: "14px 16px",
              cursor: kpis.enPapelera > 0 ? "pointer" : "default",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ fontSize: 11, color: TC_COLORS.dim, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Total tareas</div>
              <div style={{ opacity: 0.7 }}>◆</div>
            </div>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 26, fontWeight: 700, marginTop: 6, color: TC_COLORS.text }}>{kpis.total}</div>
            {kpis.enPapelera > 0 && <div style={{ fontSize: 10, color: TC_COLORS.faint, marginTop: 2 }}>{kpis.enPapelera} en papelera</div>}
            <div onClick={(e) => e.stopPropagation()}>
              <DropdownSelect
                value={fResp.length === 1 ? fResp[0] : ""}
                onChange={(v) => setFResp(v ? [v] : [])}
                placeholder="Todos los usuarios"
                options={responsables}
                arrowStyle={{ color: TC_COLORS.dim }}
                buttonStyle={{
                  marginTop: 8, width: "100%", background: TC_COLORS.panel2, border: `1px solid ${TC_COLORS.border}`,
                  color: TC_COLORS.text, borderRadius: 6, padding: "5px 6px", fontSize: 11,
                }}
              />
            </div>
          </div>
          <TcKpi label="Completadas" value={kpis.completado} icon="✓" tone="green" onClick={() => toggleKpiFilter("completado")} active={kpiFilters.includes("completado")} />
          <TcKpi label="En curso" value={kpis.encurso} icon="●" tone="amber" onClick={() => toggleKpiFilter("encurso")} active={kpiFilters.includes("encurso")} />
          <TcKpi label="No empezadas" value={kpis.noempezado} icon="○" onClick={() => toggleKpiFilter("noempezado")} active={kpiFilters.includes("noempezado")} />
          <TcKpi label="Demoradas" value={kpis.demoradas} icon="!" tone={kpis.demoradas ? "red" : "green"} onClick={() => toggleKpiFilter("demoradas")} active={kpiFilters.includes("demoradas")} />
          <TcKpi label="% en plazo" value={`${kpis.pctEnPlazo}%`} icon="✓" tone={kpis.pctEnPlazo >= 70 ? "green" : "amber"} onClick={() => toggleKpiFilter("enplazo")} active={kpiFilters.includes("enplazo")} />
        </div>
      )}

      <div style={{ background: TC_COLORS.panel, border: `1px solid ${TC_COLORS.border}`, borderRadius: 10, padding: "12px 16px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: 10, top: 9, fontSize: 12, color: TC_COLORS.faint }}>⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar tarea, responsable, obs…"
            style={{ background: TC_COLORS.panel2, border: `1px solid ${TC_COLORS.border}`, color: TC_COLORS.text, borderRadius: 7, padding: "8px 10px 8px 30px", fontSize: 12.5, outline: "none", width: isMobile ? "100%" : 210 }}
          />
        </div>
        {!isAdmin && (
          onlyMineActive ? (
            <button
              onClick={() => setFResp([])}
              style={{ display: "flex", alignItems: "center", gap: 6, background: TC_COLORS.amberDim, border: `1px solid ${TC_COLORS.amber}`, color: TC_COLORS.amber, padding: "7px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer" }}
            >
              👤 Viendo solo tus tareas · Ver todo el equipo
            </button>
          ) : (
            <button
              onClick={() => {
                const match = responsables.find((r) => r.toLowerCase() === (me || "").toLowerCase());
                setFResp(match ? [match] : []);
              }}
              style={{ background: TC_COLORS.panel2, border: `1px solid ${TC_COLORS.border}`, color: TC_COLORS.text, padding: "7px 14px", borderRadius: 20, fontSize: 12, cursor: "pointer" }}
            >
              Ver solo mis tareas
            </button>
          )
        )}
        {filtersActive ? (
          <button onClick={resetFilters} style={{ background: "transparent", border: `1px solid ${TC_COLORS.amber}`, color: TC_COLORS.amber, padding: "7px 14px", borderRadius: 7, fontSize: 12, cursor: "pointer" }}>
            Limpiar filtros
          </button>
        ) : (
          <div style={{ background: TC_COLORS.panel2, border: `1px solid ${TC_COLORS.border}`, borderRadius: 20, padding: "6px 12px", fontSize: 11.5, color: TC_COLORS.dim }}>
            <b style={{ color: TC_COLORS.amber }}>{sorted.length}</b> de {activeTasks.length} tareas
          </div>
        )}
        <div style={{ marginLeft: isMobile ? 0 : "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", background: TC_COLORS.panel2, border: `1px solid ${TC_COLORS.border}`, borderRadius: 7, overflow: "hidden" }}>
            <button onClick={() => setView("tabla")} style={{ padding: "7px 12px", fontSize: 12, border: "none", cursor: "pointer", background: view === "tabla" ? TC_COLORS.amber : "transparent", color: view === "tabla" ? TC_COLORS.amberText : TC_COLORS.dim, fontWeight: view === "tabla" ? 600 : 400 }}>Tabla</button>
            <button onClick={() => setView("kanban")} style={{ padding: "7px 12px", fontSize: 12, border: "none", cursor: "pointer", background: view === "kanban" ? TC_COLORS.amber : "transparent", color: view === "kanban" ? TC_COLORS.amberText : TC_COLORS.dim, fontWeight: view === "kanban" ? 600 : 400 }}>Kanban</button>
          </div>
          <button onClick={() => setShowHistory(true)} style={{ background: TC_COLORS.panel2, border: `1px solid ${TC_COLORS.border}`, color: TC_COLORS.text, padding: "7px 12px", borderRadius: 7, fontSize: 12, cursor: "pointer" }}>
            🕘 Historial
          </button>
          <button onClick={() => setShowTrash(true)} style={{ background: TC_COLORS.panel2, border: `1px solid ${TC_COLORS.border}`, color: TC_COLORS.text, padding: "7px 12px", borderRadius: 7, fontSize: 12, cursor: "pointer" }}>
            🗑 Papelera{trashedTasks.length > 0 ? ` (${trashedTasks.length})` : ""}
          </button>
          {puedeExportar && (
            <button
              onClick={exportAllPagesCsv}
              disabled={exportingAll}
              title="Descarga en un archivo Excel la información de esta página (Control de Tareas)"
              style={{ display: "flex", alignItems: "center", gap: 6, background: TC_COLORS.amber, color: TC_COLORS.amberText, fontWeight: 600, border: "none", padding: "7px 12px", borderRadius: 7, fontSize: 12, cursor: exportingAll ? "not-allowed" : "pointer", opacity: exportingAll ? 0.6 : 1 }}
            >
              {exportingAll ? "Generando…" : "⬇ Descargar"}
            </button>
          )}
          {puedeExportar && <BotonCarpetaLocal carpeta={carpetaLocal} />}
        </div>
      </div>

      <div style={{ background: TC_COLORS.panel, border: `1px solid ${TC_COLORS.border}`, borderRadius: 10, padding: "16px 18px", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600 }}>Tareas ({sorted.length})</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {puedeAgregar && (
              <button onClick={() => setShowAdd(true)} style={{ display: "flex", alignItems: "center", gap: 6, background: TC_COLORS.amber, color: TC_COLORS.amberText, fontWeight: 600, fontSize: 12.5, padding: "8px 14px", borderRadius: 7, border: "none", cursor: "pointer" }}>
                + Nueva tarea
              </button>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12, padding: "8px 12px", background: TC_COLORS.panel2, borderRadius: 8, fontSize: 11.5 }}>
          {!puedeEditar && <span style={{ color: TC_COLORS.faint }}>· Modo equipo: solo puedes cambiar estado y observaciones</span>}
        </div>

        {view === "tabla" ? (
          <>
            <div className="tc-scroll" style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto", borderRadius: 8, border: `1px solid ${TC_COLORS.border}` }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 980 }}>
                <thead>
                  <tr>
                    <th className="tc-th" style={{ width: 40 }} onClick={() => toggleSort("id")}>#</th>
                    <th className="tc-th" style={{ minWidth: 220 }} onClick={() => toggleSort("tarea")}>Tarea</th>
                    <th className="tc-th" onClick={() => toggleSort("responsable")}>Responsable</th>
                    <th className="tc-th" onClick={() => toggleSort("prioridad")}>Prioridad</th>
                    <th className="tc-th" onClick={() => toggleSort("inicio")}>Inicio</th>
                    <th className="tc-th" onClick={() => toggleSort("fin")}>Fin</th>
                    <th className="tc-th" onClick={() => toggleSort("dias")}>Dias</th>
                    <th className="tc-th" onClick={() => toggleSort("estado")}>Estado</th>
                    <th className="tc-th" onClick={() => toggleSort("cumplimiento")}>Cumplimiento</th>
                    <th className="tc-th" style={{ minWidth: 160 }}>Observaciones</th>
                    <th className="tc-th" style={{ cursor: "default", minWidth: 130 }}>🔁 Recurrente</th>
                    <th className="tc-th" style={{ cursor: "default" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((t, idx) => {
                    const dias = diasRestantes(t.fin);
                    const cump = cumplimiento(t);
                    const dh = rowDrag.getHandlers(idx, t);
                    const isOver = rowDrag.dragOverId === t.id;
                    return (
                      <tr
                        key={t.id}
                        className="tc-row"
                        {...dh}
                        onClick={(e) => { if (!isInteractiveTarget(e.target)) openDetalle(t.id); }}
                        style={{ cursor: "pointer", ...(isOver ? { boxShadow: `inset 0 2px 0 ${TC_COLORS.amber}` } : {}) }}
                      >
                        <td className="tc-td" style={{ color: TC_COLORS.faint, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, display: "flex", alignItems: "center", gap: 2 }}>
                          <DragHandle show={isAdmin} isMobile={isMobile} color={TC_COLORS.faint} dragProps={rowDrag.getHandleProps(idx)} dragging={rowDrag.armedIndex === idx} canMoveUp={idx > 0} canMoveDown={idx < sorted.length - 1} onMoveUp={() => rowDrag.moveBy(idx, -1, sorted.length)} onMoveDown={() => rowDrag.moveBy(idx, 1, sorted.length)} />
                          {idx + 1}
                        </td>
                        <td className="tc-td">
                          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            {t.recurrente && <span title={`Recurrente · ${t.frecuencia || "Semanal"}`} style={{ fontSize: 11, flexShrink: 0 }}>🔁</span>}
                            <span>{t.tarea}</span>
                          </div>
                        </td>
                        <td className="tc-td">
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ width: 18, height: 18, borderRadius: 50, background: colorForResp(t.responsable, responsables), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8.5, fontWeight: 700, color: TC_COLORS.dark, flexShrink: 0 }}>{tcInitials(t.responsable)}</div>
                            <span>{t.responsable}</span>
                          </div>
                        </td>
                        <td className="tc-td" style={{ color: t.prioridad === "Alta" ? TC_COLORS.red : t.prioridad === "Media" ? TC_COLORS.amber : TC_COLORS.faint }}>{t.prioridad}</td>
                        <td className="tc-td">{fmtDate(t.inicio)}</td>
                        <td className="tc-td">{fmtDate(t.fin)}</td>
                        <td className="tc-td" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: dias === null ? TC_COLORS.faint : dias < 0 ? TC_COLORS.red : TC_COLORS.text }}>
                          {dias === null ? "—" : dias}
                        </td>
                        <td className="tc-td">
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: ESTADO_COLOR[t.estado] }}>
                            <span style={{ width: 7, height: 7, borderRadius: 3, background: ESTADO_COLOR[t.estado], display: "inline-block" }} />
                            {t.estado}
                          </span>
                        </td>
                        <td className="tc-td">
                          <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 20, whiteSpace: "nowrap", background: cump === "Demorado" ? TC_COLORS.redDim : TC_COLORS.greenDim, color: cump === "Demorado" ? TC_COLORS.redSoft : TC_COLORS.greenSoft }}>
                            {cump}
                          </span>
                        </td>
                        <td className="tc-td">{t.obs || "—"}</td>
                        <td className="tc-td">
                          {t.recurrente ? `🔁 ${t.frecuencia || "Semanal"}` : "—"}
                        </td>
                        <td className="tc-td">
                          {!puedeEliminar ? (
                            <span style={{ color: TC_COLORS.faint, fontSize: 13 }} title="No tienes permiso para eliminar en Control de Tareas">🔒</span>
                          ) : confirmDelete === t.id ? (
                            <div style={{ display: "flex", gap: 4 }}>
                              <button onClick={() => moveToTrash(t.id)} style={{ background: TC_COLORS.red, border: "none", color: TC_COLORS.white, borderRadius: 5, width: 24, height: 24, cursor: "pointer", fontSize: 12 }} title="Confirmar">✓</button>
                              <button onClick={() => setConfirmDelete(null)} style={{ background: TC_COLORS.panel2, border: `1px solid ${TC_COLORS.border}`, color: TC_COLORS.dim, borderRadius: 5, width: 24, height: 24, cursor: "pointer", fontSize: 12 }} title="Cancelar">✕</button>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmDelete(t.id)} style={{ background: "transparent", border: "none", color: TC_COLORS.faint, cursor: "pointer", padding: 4, fontSize: 14 }} title="Eliminar tarea">
                              🗑
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {sorted.length === 0 && (
                    <tr><td colSpan={12} style={{ textAlign: "center", padding: 30, color: TC_COLORS.faint }}>No hay tareas que coincidan con los filtros</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 11, color: TC_COLORS.faint, marginTop: 8 }}>
              Los cambios se guardan automaticamente y se sincronizan con todo el equipo en unos segundos.
            </div>
          </>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3,1fr)", gap: 12 }}>
            {kanbanColumns.map((col) => (
              <div key={col.estado}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, padding: "0 2px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 3, background: ESTADO_COLOR[col.estado], display: "inline-block" }} />
                    {col.estado}
                  </div>
                  <span style={{ fontSize: 11, color: TC_COLORS.faint }}>{col.items.length}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 60, maxHeight: isMobile ? "none" : 560, overflowY: isMobile ? "visible" : "auto" }} className="tc-scroll">
                  {col.items.map((t, tIdx) => {
                    const dias = diasRestantes(t.fin);
                    const cump = cumplimiento(t);
                    const kdh = kanbanCardProps(col.estado, tIdx, t, col.items);
                    const kOver = kanbanOverId === t.id;
                    return (
                      <div
                        key={t.id}
                        className="tc-card"
                        {...kdh}
                        onClick={(e) => { if (!isInteractiveTarget(e.target)) openDetalle(t.id); }}
                        style={{ cursor: "pointer", borderLeft: `3px solid ${cump === "Demorado" ? TC_COLORS.red : ESTADO_COLOR[t.estado]}`, ...(kOver ? { boxShadow: `inset 0 0 0 2px ${TC_COLORS.amber}` } : {}) }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <DragHandle show={isAdmin} isMobile={isMobile} color={TC_COLORS.faint} dragProps={kanbanHandleProps(col.estado, tIdx)} dragging={!!kanbanArmed && kanbanArmed.estado === col.estado && kanbanArmed.index === tIdx} canMoveUp={tIdx > 0} canMoveDown={tIdx < col.items.length - 1} onMoveUp={() => moveKanbanBy(tIdx, -1, col.items)} onMoveDown={() => moveKanbanBy(tIdx, 1, col.items)} />
                          <div style={{ fontSize: 12.5, fontWeight: 500 }}>{t.recurrente ? `🔁 ${t.tarea}` : t.tarea}</div>
                          {puedeEliminar && (
                            confirmDelete === t.id ? (
                              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                                <button onClick={() => moveToTrash(t.id)} style={{ background: TC_COLORS.red, border: "none", color: TC_COLORS.white, borderRadius: 5, width: 20, height: 20, cursor: "pointer", fontSize: 10 }}>✓</button>
                                <button onClick={() => setConfirmDelete(null)} style={{ background: "transparent", border: `1px solid ${TC_COLORS.border}`, color: TC_COLORS.dim, borderRadius: 5, width: 20, height: 20, cursor: "pointer", fontSize: 10 }}>✕</button>
                              </div>
                            ) : (
                              <button onClick={() => setConfirmDelete(t.id)} style={{ background: "transparent", border: "none", color: TC_COLORS.faint, cursor: "pointer", flexShrink: 0, fontSize: 12 }}>🗑</button>
                            )
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: TC_COLORS.dim }}>
                          <div style={{ width: 16, height: 16, borderRadius: 50, background: colorForResp(t.responsable, responsables), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7.5, fontWeight: 700, color: TC_COLORS.dark, flexShrink: 0 }}>{tcInitials(t.responsable)}</div>
                          {t.responsable}
                          <span style={{ color: t.prioridad === "Alta" ? TC_COLORS.red : t.prioridad === "Media" ? TC_COLORS.amber : TC_COLORS.faint }}>· {t.prioridad}</span>
                        </div>
                        <div style={{ display: "flex", gap: 10, fontSize: 10.5, color: TC_COLORS.faint }}>
                          <span>Inicio: {fmtDate(t.inicio)}</span>
                          <span>Fin: {fmtDate(t.fin)}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 10.5 }}>
                          <span style={{ padding: "2px 8px", borderRadius: 20, background: cump === "Demorado" ? TC_COLORS.redDim : TC_COLORS.greenDim, color: cump === "Demorado" ? TC_COLORS.redSoft : TC_COLORS.greenSoft }}>{cump}</span>
                          <span style={{ color: TC_COLORS.faint, fontFamily: "'JetBrains Mono',monospace" }}>{dias === null ? "—" : `${dias}d`}</span>
                        </div>
                        {t.obs && <div style={{ fontSize: 11.5, color: TC_COLORS.dim }}>{t.obs}</div>}
                        {t.recurrente && (
                          <div style={{ fontSize: 10.5, color: TC_COLORS.faint }}>🔁 Recurrente · {t.frecuencia || "Semanal"}</div>
                        )}
                      </div>
                    );
                  })}
                  {col.items.length === 0 && <div style={{ fontSize: 11.5, color: TC_COLORS.faint, padding: "10px 4px" }}>Sin tareas</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.3fr 1fr", gap: 14, marginBottom: 14 }}>
        <div style={{ background: TC_COLORS.panel, border: `1px solid ${TC_COLORS.border}`, borderRadius: 10, padding: "16px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
            <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600 }}>Carga por responsable</h2>
            <div style={{ display: "flex", gap: 12, fontSize: 10.5, color: TC_COLORS.dim }}>
              <span><span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 2, background: TC_COLORS.green, marginRight: 5 }} />En plazo</span>
              <span><span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 2, background: TC_COLORS.red, marginRight: 5 }} />Demorado</span>
            </div>
          </div>
          {respChartData.length === 0 ? (
            <div style={{ color: TC_COLORS.faint, fontSize: 12, minHeight: 130, display: "flex", alignItems: "center", justifyContent: "center" }}>Sin datos</div>
          ) : (() => {
            const sortedResp = [...respChartData].sort((a, b) => (b.enPlazo + b.demorado) - (a.enPlazo + a.demorado));
            const maxTotal = Math.max(...sortedResp.map((r) => r.enPlazo + r.demorado), 1);
            const nameColWidth = isMobile ? 92 : 128;
            const axisSteps = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxTotal * f));
            return (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <div style={{ width: nameColWidth, flexShrink: 0 }} />
                  <div style={{ flex: 1, display: "flex", justifyContent: "space-between", fontSize: 10, color: TC_COLORS.faint, fontFamily: "'JetBrains Mono',monospace" }}>
                    {axisSteps.map((v, i) => <span key={i}>{v}</span>)}
                  </div>
                  <div style={{ width: 40, flexShrink: 0 }} />
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {sortedResp.map((r, i) => {
                    const total = r.enPlazo + r.demorado;
                    const pctWidth = (total / maxTotal) * 100;
                    const enPlazoPct = total ? (r.enPlazo / total) * pctWidth : 0;
                    const demoradoPct = total ? (r.demorado / total) * pctWidth : 0;
                    return (
                      <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: i === sortedResp.length - 1 ? "none" : `1px solid ${TC_COLORS.grid}` }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, width: nameColWidth, flexShrink: 0 }}>
                          <div style={{ width: 18, height: 18, borderRadius: 50, background: colorForResp(r.name, responsables), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, color: TC_COLORS.dark, flexShrink: 0 }}>{tcInitials(r.name)}</div>
                          <div style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
                        </div>
                        <div
                          style={{
                            position: "relative",
                            flex: 1,
                            height: 18,
                            borderRadius: 4,
                            background: TC_COLORS.panel2,
                            backgroundImage: `repeating-linear-gradient(to right, ${TC_COLORS.grid} 0, ${TC_COLORS.grid} 1px, transparent 1px, transparent 25%)`,
                          }}
                        >
                          <div style={{ position: "absolute", inset: 0, display: "flex", borderRadius: 4, overflow: "hidden" }}>
                            <div style={{ width: `${enPlazoPct}%`, background: TC_COLORS.green }} />
                            <div style={{ width: `${demoradoPct}%`, background: TC_COLORS.red }} />
                          </div>
                        </div>
                        <div style={{ width: 40, textAlign: "right", fontSize: 11.5, fontWeight: 600, color: TC_COLORS.text, flexShrink: 0, fontFamily: "'JetBrains Mono',monospace" }}>{total}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
        <div style={{ background: TC_COLORS.panel, border: `1px solid ${TC_COLORS.border}`, borderRadius: 10, padding: "16px 18px" }}>
          <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600, marginBottom: 14 }}>Distribucion por estado</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 20, minHeight: 130 }}>
            <svg width={isMobile ? 110 : 128} height={isMobile ? 110 : 128} viewBox="0 0 128 128" style={{ flexShrink: 0 }}>
              {(() => {
                const r = 50, cx = 64, cy = 64, circ = 2 * Math.PI * r;
                const total = kpis.activos || 1;
                let acc = 0;
                return estadoChartData.map((d) => {
                  const frac = d.value / total;
                  const dash = frac * circ;
                  const el = (
                    <circle
                      key={d.name}
                      cx={cx} cy={cy} r={r}
                      fill="none"
                      stroke={d.color}
                      strokeWidth="16"
                      strokeDasharray={`${dash} ${circ - dash}`}
                      strokeDashoffset={-acc}
                      transform={`rotate(-90 ${cx} ${cy})`}
                      strokeLinecap={estadoChartData.length > 1 ? "butt" : "round"}
                    >
                      <title>{`${d.name}: ${d.value}`}</title>
                    </circle>
                  );
                  acc += dash;
                  return el;
                });
              })()}
              <circle cx="64" cy="64" r="35" fill={TC_COLORS.panel} />
              <text x="64" y="60" textAnchor="middle" fontSize="22" fontWeight="700" fill={TC_COLORS.text} fontFamily="'Space Grotesk',sans-serif">{kpis.activos}</text>
              <text x="64" y="76" textAnchor="middle" fontSize="9.5" fill={TC_COLORS.faint}>tareas</text>
            </svg>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
              {estadoChartData.length === 0 && <div style={{ color: TC_COLORS.faint, fontSize: 12 }}>Sin datos</div>}
              {estadoChartData.map((d) => (
                <div key={d.name}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: d.color, display: "inline-block" }} />
                      {d.name}
                    </span>
                    <span style={{ color: TC_COLORS.dim, fontFamily: "'JetBrains Mono',monospace" }}>{d.value} · {Math.round((d.value / (kpis.activos || 1)) * 100)}%</span>
                  </div>
                  <div style={{ height: 4, borderRadius: 3, background: TC_COLORS.panel2, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${(d.value / (kpis.activos || 1)) * 100}%`, background: d.color, borderRadius: 3 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {alertas.length > 0 && (
        <div style={{ background: TC_COLORS.panel, border: `1px solid ${TC_COLORS.border}`, borderRadius: 10, padding: "16px 18px", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
              <span style={{ color: TC_COLORS.amber }}>!</span> Alertas ({alertas.length})
            </h2>
            {editingPhone ? (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  className="tc-input"
                  autoFocus
                  placeholder="Ej. 51987654321"
                  value={phoneDraft}
                  onChange={(e) => setPhoneDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveAlertPhone(); if (e.key === "Escape") setEditingPhone(false); }}
                  style={{ border: `1px solid ${TC_COLORS.border}`, fontSize: 11.5, padding: "5px 8px", width: 150 }}
                />
                <button onClick={saveAlertPhone} style={{ background: TC_COLORS.green, color: TC_COLORS.greenTextDark, border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
                <button onClick={() => setEditingPhone(false)} style={{ background: "transparent", color: TC_COLORS.faint, border: "none", fontSize: 11, cursor: "pointer" }}>Cancelar</button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {alertPhone && (
                  <span style={{ fontSize: 10.5, color: TC_COLORS.faint }}>
                    a +{alertPhone} <button onClick={() => { setPhoneDraft(alertPhone); setEditingPhone(true); }} style={{ background: "transparent", border: "none", color: TC_COLORS.dim, cursor: "pointer", textDecoration: "underline", fontSize: 10.5, padding: 0 }}>cambiar</button>
                  </span>
                )}
                <button onClick={sendAlertasWhatsApp} style={{ background: TC_COLORS.green, color: TC_COLORS.greenTextDark, border: "none", borderRadius: 7, padding: "6px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                  Enviar por WhatsApp
                </button>
                {isAdmin && (
                  <button onClick={enviarNotificacionesCorreo} disabled={enviandoNotifCorreo} style={{ background: TC_COLORS.amber, color: TC_COLORS.amberText, border: "none", borderRadius: 7, padding: "6px 12px", fontSize: 11.5, fontWeight: 600, cursor: enviandoNotifCorreo ? "default" : "pointer", opacity: enviandoNotifCorreo ? 0.7 : 1, display: "flex", alignItems: "center", gap: 6 }}>
                    {enviandoNotifCorreo ? "Enviando…" : "Enviar notificaciones por correo"}
                  </button>
                )}
              </div>
            )}
          </div>
          {resultNotifCorreo && (
            <div style={{ fontSize: 10.5, marginBottom: 8, color: resultNotifCorreo.tipo === "ok" ? TC_COLORS.green : TC_COLORS.red }}>
              {resultNotifCorreo.texto}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 220, overflowY: "auto" }} className="tc-scroll">
            {alertas.map(({ t, dias, cump }) => (
              <div key={t.id} style={{ display: "flex", gap: 10, padding: "9px 12px", borderRadius: 8, background: TC_COLORS.panel2, borderLeft: `3px solid ${cump === "Demorado" ? TC_COLORS.red : TC_COLORS.amber}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>{t.tarea}</div>
                  <div style={{ fontSize: 10.5, color: TC_COLORS.dim, marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span>{t.responsable}</span>
                    <span style={{ color: t.prioridad === "Alta" ? TC_COLORS.red : TC_COLORS.amber }}>{t.prioridad}</span>
                    <span>{cump === "Demorado" ? `${Math.abs(dias)} dias de atraso` : `vence en ${dias} dia(s)`}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isAdmin && (
        <div style={{ background: TC_COLORS.panel, border: `1px solid ${TC_COLORS.border}`, borderRadius: 10, padding: "16px 18px", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600, margin: 0 }}>
              Respaldos anuales
            </h2>
            <button onClick={generarRespaldoAhora} disabled={generandoRespaldo} style={{ background: TC_COLORS.amber, color: TC_COLORS.amberText, border: "none", borderRadius: 7, padding: "6px 12px", fontSize: 11.5, fontWeight: 600, cursor: generandoRespaldo ? "default" : "pointer", opacity: generandoRespaldo ? 0.7 : 1 }}>
              {generandoRespaldo ? "Generando…" : "Generar respaldo ahora"}
            </button>
          </div>
          <div style={{ fontSize: 10.5, color: TC_COLORS.dim, marginBottom: 10 }}>
            Cada 1 de enero se genera automáticamente un respaldo con todos los datos de la app correspondientes al año que acaba de cerrar. También puedes generar o refrescar manualmente el respaldo del año en curso.
          </div>
          {resultRespaldo && (
            <div style={{ fontSize: 10.5, marginBottom: 8, color: resultRespaldo.tipo === "ok" ? TC_COLORS.green : TC_COLORS.red }}>
              {resultRespaldo.texto}
            </div>
          )}
          {respaldos.length === 0 ? (
            <div style={{ fontSize: 11, color: TC_COLORS.faint }}>Todavía no hay respaldos generados.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {respaldos.map((r) => (
                <div key={r.anio} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 12px", borderRadius: 8, background: TC_COLORS.panel2, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{r.anio}</div>
                    <div style={{ fontSize: 10.5, color: TC_COLORS.dim }}>Generado: {fmtDateTime(r.generado_en)} · {fmtBytes(r.bytes)}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => descargarRespaldoJson(r.anio)} disabled={descargandoRespaldo === `${r.anio}-json`} style={{ background: "transparent", border: `1px solid ${TC_COLORS.border}`, color: TC_COLORS.dim, borderRadius: 6, padding: "5px 10px", fontSize: 11, cursor: descargandoRespaldo ? "default" : "pointer" }}>
                      {descargandoRespaldo === `${r.anio}-json` ? "Descargando…" : "Descargar JSON"}
                    </button>
                    <button onClick={() => descargarRespaldoExcel(r.anio)} disabled={descargandoRespaldo === `${r.anio}-xlsx`} style={{ background: "transparent", border: `1px solid ${TC_COLORS.border}`, color: TC_COLORS.dim, borderRadius: 6, padding: "5px 10px", fontSize: 11, cursor: descargandoRespaldo ? "default" : "pointer" }}>
                      {descargandoRespaldo === `${r.anio}-xlsx` ? "Descargando…" : "Descargar Excel"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {detalle && currentTask && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }} onClick={closeDetalle}>
          <div style={{ background: TC_COLORS.panel, border: `1px solid ${TC_COLORS.border}`, borderRadius: 12, padding: 22, width: 620, maxWidth: "100%", maxHeight: "85vh", overflowY: "auto", boxSizing: "border-box" }} className="tc-scroll" onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <div>
                <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: 15 }}>{currentTask.recurrente ? "🔁 " : ""}{currentTask.tarea}</div>
                <div style={{ fontSize: 11.5, color: TC_COLORS.dim, marginTop: 2 }}>{currentTask.responsable} · {fmtDate(currentTask.inicio)} → {fmtDate(currentTask.fin)}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {!editing && (
                  <button onClick={startEditDetalle} style={{ background: TC_COLORS.panel2, border: `1px solid ${TC_COLORS.border}`, color: TC_COLORS.text, padding: "6px 12px", borderRadius: 7, fontSize: 12, cursor: "pointer" }}>
                    ✎ Editar
                  </button>
                )}
                <button onClick={closeDetalle} style={{ background: "transparent", border: "none", color: TC_COLORS.faint, cursor: "pointer", fontSize: 16 }}>✕</button>
              </div>
            </div>
            {!puedeEditar && (
              <div style={{ fontSize: 11, color: TC_COLORS.faint, marginBottom: 10 }}>🔒 Modo equipo: solo puedes cambiar estado y observaciones</div>
            )}

            {editing ? (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <input className="tc-input" style={{ border: `1px solid ${TC_COLORS.border}`, ...(!puedeEditar ? lockStyle : {}) }} disabled={!puedeEditar} placeholder="Descripcion de la tarea" value={draftEdit.tarea} onChange={(e) => setDraftEdit({ ...draftEdit, tarea: e.target.value.toUpperCase() })} />
                  <input className="tc-input" style={{ border: `1px solid ${TC_COLORS.border}`, ...(!puedeEditar ? lockStyle : {}) }} disabled={!puedeEditar} placeholder="Responsable" list="resp-list-detalle" value={draftEdit.responsable} onChange={(e) => setDraftEdit({ ...draftEdit, responsable: e.target.value.toUpperCase() })} />
                  <datalist id="resp-list-detalle">{responsables.map((r) => <option key={r} value={r} />)}</datalist>
                  <div style={{ display: "flex", gap: 8 }}>
                    <DropdownSelect buttonClassName="tc-input" buttonStyle={{ border: `1px solid ${TC_COLORS.border}`, ...(!puedeEditar ? lockStyle : {}) }} disabled={!puedeEditar} value={draftEdit.prioridad} onChange={(v) => setDraftEdit({ ...draftEdit, prioridad: v })} arrowStyle={{ color: TC_COLORS.dim }} options={PRIORIDADES} />
                    <DropdownSelect buttonClassName="tc-input" buttonStyle={{ border: `1px solid ${TC_COLORS.border}` }} value={draftEdit.estado} onChange={(v) => setDraftEdit({ ...draftEdit, estado: v })} arrowStyle={{ color: TC_COLORS.dim }} options={ESTADOS} />
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <DateInput value={draftEdit.inicio || ""} onChange={(inicio) => setDraftEdit({ ...draftEdit, inicio })} inputClassName="tc-input" showLabel={false} palette={TC_COLORS} disabled={!puedeEditar} style={{ border: `1px solid ${TC_COLORS.border}`, ...(!puedeEditar ? lockStyle : {}) }} />
                    <DateInput value={draftEdit.fin || ""} onChange={(fin) => setDraftEdit({ ...draftEdit, fin })} inputClassName="tc-input" showLabel={false} palette={TC_COLORS} disabled={!puedeEditar} style={{ border: `1px solid ${TC_COLORS.border}`, ...(!puedeEditar ? lockStyle : {}) }} />
                  </div>
                  <input className="tc-input" style={{ border: `1px solid ${TC_COLORS.border}` }} placeholder="Observaciones" value={draftEdit.obs} onChange={(e) => setDraftEdit({ ...draftEdit, obs: e.target.value.toUpperCase() })} />
                  {puedeEditar && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: TC_COLORS.panel2, borderRadius: 7 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 12 }}>
                        <input type="checkbox" checked={!!draftEdit.recurrente} onChange={(e) => setDraftEdit({ ...draftEdit, recurrente: e.target.checked })} style={{ accentColor: TC_COLORS.amber, cursor: "pointer" }} />
                        🔁 Tarea recurrente
                      </label>
                      {draftEdit.recurrente && (
                        <DropdownSelect buttonClassName="tc-input" buttonStyle={{ border: `1px solid ${TC_COLORS.border}`, flex: 1 }} value={draftEdit.frecuencia || "Semanal"} onChange={(v) => setDraftEdit({ ...draftEdit, frecuencia: v })} arrowStyle={{ color: TC_COLORS.dim }} options={FRECUENCIAS} />
                      )}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 14, borderTop: `1px solid ${TC_COLORS.border}` }}>
                  {!puedeEliminar ? <div /> : confirmDeleteDetalle ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11.5, color: TC_COLORS.red }}>¿Eliminar esta tarea?</span>
                      <button onClick={deleteCurrentTask} style={{ background: TC_COLORS.red, color: TC_COLORS.white, border: "none", padding: "6px 12px", borderRadius: 7, fontSize: 12, cursor: "pointer" }}>Confirmar</button>
                      <button onClick={() => setConfirmDeleteDetalle(false)} style={{ background: "transparent", border: `1px solid ${TC_COLORS.border}`, color: TC_COLORS.dim, padding: "6px 12px", borderRadius: 7, fontSize: 12, cursor: "pointer" }}>Cancelar</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDeleteDetalle(true)} style={{ background: "transparent", border: `1px solid ${TC_COLORS.redDim}`, color: TC_COLORS.red, padding: "7px 14px", borderRadius: 7, fontSize: 12, cursor: "pointer" }}>
                      Eliminar tarea
                    </button>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={cancelEditDetalle} style={{ background: "transparent", border: `1px solid ${TC_COLORS.border}`, color: TC_COLORS.dim, padding: "8px 16px", borderRadius: 7, fontSize: 12.5, cursor: "pointer" }}>Cancelar</button>
                    <button onClick={saveEditDetalle} style={{ background: TC_COLORS.amber, color: TC_COLORS.amberText, border: "none", padding: "8px 16px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Guardar cambios</button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                  <InfoRow label="Responsable" value={currentTask.responsable} />
                  <InfoRow label="Prioridad" value={currentTask.prioridad} />
                  <InfoRow label="Estado" value={currentTask.estado} />
                  <InfoRow label="Cumplimiento" value={cumplimiento(currentTask)} />
                  <InfoRow label="Inicio" value={fmtDate(currentTask.inicio)} />
                  <InfoRow label="Fin" value={fmtDate(currentTask.fin)} />
                  <InfoRow label="Dias restantes" value={diasRestantes(currentTask.fin) === null ? "—" : diasRestantes(currentTask.fin)} />
                  <InfoRow label="Recurrente" value={currentTask.recurrente ? `Si · ${currentTask.frecuencia || "Semanal"}` : "No"} />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.5, color: TC_COLORS.faint, marginBottom: 4 }}>Observaciones</div>
                  <div style={{ fontSize: 13, lineHeight: 1.5 }}>{currentTask.obs || "—"}</div>
                </div>

                <div style={{ borderTop: `1px solid ${TC_COLORS.border}`, paddingTop: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>Fotos y documentos {docs.length > 0 ? `(${docs.length})` : ""}</div>
                    <label className="tc-filebtn" style={{ display: puedeAdjuntar ? "inline-flex" : "none" }}>
                      {uploading ? "Subiendo…" : "+ Agregar archivo"}
                      <input
                        type="file"
                        multiple
                        accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
                        style={{ display: "none" }}
                        disabled={uploading}
                        onChange={(e) => { onFilesSelectedTask(e.target.files); e.target.value = ""; }}
                      />
                    </label>
                  </div>
                  {docsLoading ? (
                    <div style={{ fontSize: 11.5, color: TC_COLORS.faint }}>Cargando archivos…</div>
                  ) : docs.length === 0 ? (
                    <div style={{ fontSize: 11.5, color: TC_COLORS.faint }}>Sin fotos ni documentos adjuntos todavia</div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                      {docs.map((att) => <AttachmentThumb key={att.id} att={att} onRemove={removeAttachmentTask} />)}
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
          <div style={{ background: TC_COLORS.panel, border: `1px solid ${TC_COLORS.border}`, borderRadius: 12, padding: 22, width: 380, maxWidth: "100%", boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: 14 }}>Nueva tarea</div>
              <button onClick={() => setShowAdd(false)} style={{ background: "transparent", border: "none", color: TC_COLORS.faint, cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input className="tc-input" style={{ border: `1px solid ${TC_COLORS.border}` }} placeholder="Descripcion de la tarea" value={draft.tarea} onChange={(e) => setDraft({ ...draft, tarea: e.target.value.toUpperCase() })} autoFocus />
              <input className="tc-input" style={{ border: `1px solid ${TC_COLORS.border}` }} placeholder="Responsable" list="resp-list" value={draft.responsable} onChange={(e) => setDraft({ ...draft, responsable: e.target.value.toUpperCase() })} />
              <datalist id="resp-list">{responsables.map((r) => <option key={r} value={r} />)}</datalist>
              <div style={{ display: "flex", gap: 8 }}>
                <DropdownSelect buttonClassName="tc-input" buttonStyle={{ border: `1px solid ${TC_COLORS.border}` }} value={draft.prioridad} onChange={(v) => setDraft({ ...draft, prioridad: v })} arrowStyle={{ color: TC_COLORS.dim }} options={PRIORIDADES} />
                <DropdownSelect buttonClassName="tc-input" buttonStyle={{ border: `1px solid ${TC_COLORS.border}` }} value={draft.estado} onChange={(v) => setDraft({ ...draft, estado: v })} arrowStyle={{ color: TC_COLORS.dim }} options={ESTADOS} />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <DateInput value={draft.inicio} onChange={(inicio) => setDraft({ ...draft, inicio })} inputClassName="tc-input" showLabel={false} palette={TC_COLORS} style={{ border: `1px solid ${TC_COLORS.border}` }} />
                <DateInput value={draft.fin} onChange={(fin) => setDraft({ ...draft, fin })} inputClassName="tc-input" showLabel={false} palette={TC_COLORS} style={{ border: `1px solid ${TC_COLORS.border}` }} />
              </div>
              <input className="tc-input" style={{ border: `1px solid ${TC_COLORS.border}` }} placeholder="Observaciones (opcional)" value={draft.obs} onChange={(e) => setDraft({ ...draft, obs: e.target.value.toUpperCase() })} />
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: TC_COLORS.panel2, borderRadius: 7 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 12 }}>
                  <input type="checkbox" checked={draft.recurrente} onChange={(e) => setDraft({ ...draft, recurrente: e.target.checked })} style={{ accentColor: TC_COLORS.amber, cursor: "pointer" }} />
                  🔁 Tarea recurrente
                </label>
                {draft.recurrente && (
                  <DropdownSelect buttonClassName="tc-input" buttonStyle={{ border: `1px solid ${TC_COLORS.border}`, flex: 1 }} value={draft.frecuencia} onChange={(v) => setDraft({ ...draft, frecuencia: v })} arrowStyle={{ color: TC_COLORS.dim }} options={FRECUENCIAS} />
                )}
              </div>
              {draft.recurrente && (
                <div style={{ fontSize: 10.5, color: TC_COLORS.faint }}>Al marcarla como "Completado" se reiniciara sola a "No empezado" y sus fechas avanzaran segun la frecuencia elegida.</div>
              )}
              <button onClick={addTask} disabled={!draft.tarea.trim()} style={{ marginTop: 6, background: draft.tarea.trim() ? TC_COLORS.amber : TC_COLORS.panel2, color: draft.tarea.trim() ? TC_COLORS.amberText : TC_COLORS.faint, border: "none", borderRadius: 7, padding: "10px 0", fontWeight: 600, fontSize: 13, cursor: draft.tarea.trim() ? "pointer" : "default" }}>
                Agregar tarea
              </button>
            </div>
          </div>
        </div>
      )}

      {showTrash && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }} onClick={() => setShowTrash(false)}>
          <div style={{ background: TC_COLORS.panel, border: `1px solid ${TC_COLORS.border}`, borderRadius: 12, padding: 22, width: 480, maxWidth: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column", boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: 14 }}>Papelera ({trashedTasks.length})</div>
              <button onClick={() => setShowTrash(false)} style={{ background: "transparent", border: "none", color: TC_COLORS.faint, cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            <div style={{ fontSize: 11, color: TC_COLORS.faint, marginBottom: 12, lineHeight: 1.5 }}>
              Las tareas completadas hace mas de {MESES_ANTIGUEDAD_AUTOARCHIVO} meses se envian aqui automaticamente. Todo elemento se elimina de forma permanente {DIAS_RETENCION_PAPELERA} dias despues de llegar a la papelera.
            </div>
            <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, marginBottom: puedeEliminar && trashedTasks.length > 0 ? 12 : 0 }} className="tc-scroll">
              {trashedTasks.length === 0 && <div style={{ color: TC_COLORS.faint, fontSize: 12.5, textAlign: "center", padding: "20px 0" }}>La papelera esta vacia</div>}
              {trashedTasks.map((t) => {
                const diasRestPurga = t.deletedAt ? Math.max(0, DIAS_RETENCION_PAPELERA - Math.floor((Date.now() - t.deletedAt) / MS_POR_DIA)) : null;
                return (
                <div key={t.id} style={{ background: TC_COLORS.panel2, borderRadius: 8, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500, textDecoration: "line-through", color: TC_COLORS.dim }}>{t.tarea}</div>
                    <div style={{ fontSize: 10.5, color: TC_COLORS.faint, marginTop: 2 }}>{t.responsable} · eliminada {fmtRelTime(t.deletedAt)}</div>
                    {diasRestPurga !== null && (
                      <div style={{ fontSize: 10.5, color: diasRestPurga <= 5 ? TC_COLORS.red : TC_COLORS.faint, marginTop: 2 }}>
                        {diasRestPurga === 0 ? "Se eliminara definitivamente hoy" : `Se elimina definitivamente en ${diasRestPurga} dia${diasRestPurga === 1 ? "" : "s"}`}
                      </div>
                    )}
                  </div>
                  {puedeEliminar && (
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button onClick={() => restoreTask(t.id)} style={{ background: TC_COLORS.green, border: "none", color: TC_COLORS.greenTextDark, borderRadius: 6, padding: "6px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Restaurar</button>
                      {confirmPermanent === t.id ? (
                        <button onClick={() => permanentDelete(t.id)} style={{ background: TC_COLORS.red, border: "none", color: TC_COLORS.white, borderRadius: 6, padding: "6px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Confirmar</button>
                      ) : (
                        <button onClick={() => setConfirmPermanent(t.id)} style={{ background: "transparent", border: `1px solid ${TC_COLORS.border}`, color: TC_COLORS.faint, borderRadius: 6, padding: "6px 10px", fontSize: 11, cursor: "pointer" }}>Eliminar</button>
                      )}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
            {puedeEliminar && trashedTasks.length > 0 && (
              <button onClick={emptyTrash} style={{ background: "transparent", border: `1px solid ${TC_COLORS.red}`, color: TC_COLORS.red, borderRadius: 7, padding: "9px 0", fontSize: 12.5, cursor: "pointer" }}>
                Vaciar papelera definitivamente
              </button>
            )}
          </div>
        </div>
      )}

      {showCreateWizard && isAdmin && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110, padding: 16, visibility: "visible" }} onClick={closeCreateWizard}>
          <div style={{ background: TC_COLORS.panel, border: `1px solid ${TC_COLORS.border}`, borderRadius: 12, padding: 22, width: 560, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: 15 }}>Nuevo usuario</div>
              <button onClick={closeCreateWizard} style={{ background: "transparent", border: "none", color: TC_COLORS.faint, cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>

            {}
            <div style={{ display: "flex", alignItems: "center", marginBottom: 18, marginTop: 8 }}>
              {wizardSteps.map((s, i) => (
                <div key={s.key} style={{ display: "flex", alignItems: "center", flex: i < wizardSteps.length - 1 ? 1 : "0 0 auto" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 700,
                      background: i < wizardStep ? TC_COLORS.green : i === wizardStep ? TC_COLORS.amber : TC_COLORS.panel2,
                      color: i <= wizardStep ? TC_COLORS.amberText : TC_COLORS.faint,
                      border: i === wizardStep ? `1px solid ${TC_COLORS.amber}` : `1px solid ${TC_COLORS.border}`,
                      transition: "background .15s",
                    }}>
                      {i < wizardStep ? "✓" : s.short}
                    </div>
                    <div style={{ fontSize: 9.5, color: i === wizardStep ? TC_COLORS.text : TC_COLORS.faint, fontWeight: i === wizardStep ? 600 : 400, whiteSpace: "nowrap" }}>{s.label}</div>
                  </div>
                  {i < wizardSteps.length - 1 && (
                    <div style={{ flex: 1, height: 2, background: i < wizardStep ? TC_COLORS.green : TC_COLORS.border, margin: "0 6px", marginBottom: 14 }} />
                  )}
                </div>
              ))}
            </div>

            <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 10 }} className="tc-scroll">

              {wizardStepKey === "datos" && (
                <>
                  <div style={{ fontSize: 12, color: TC_COLORS.faint }}>Selecciona un trabajador ya registrado. La cuenta quedará vinculada a esa persona y el acceso de trabajador se limitará a su propia información.</div>
                  <OCSelector
                    value={selectedWorker}
                    onChange={(w) => { setSelectedWorker(w); if (!newUserName.trim()) setNewUserName(usernameFromWorker(w)); }}
                    placeholder="Seleccionar trabajador registrado…"
                    options={workers.map((w) => {
                      const ocupado = usersRef.current.some((u) => u.trabajador && normalizePersonKey(u.trabajador) === normalizePersonKey(w));
                      return { value: w, label: `${w}${ocupado ? " · ya tiene usuario" : ""}`, disabled: ocupado };
                    })}
                  />
                  {selectedWorker && <div style={{ background: TC_COLORS.panel2, border: `1px solid ${TC_COLORS.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 11, color: TC_COLORS.text }}>Cuenta para: <strong>{selectedWorker}</strong></div>}
                  <input className="tc-input" style={{ border: `1px solid ${TC_COLORS.border}` }} placeholder="Usuario para iniciar sesión" value={newUserName} onChange={(e) => setNewUserName(e.target.value)} />
                  <input className="tc-input" type="password" style={{ border: `1px solid ${TC_COLORS.border}` }} placeholder="Contraseña" value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} />
                  <input className="tc-input" type="email" style={{ border: `1px solid ${TC_COLORS.border}` }} placeholder="Correo electrónico (opcional, para notificaciones)" value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} />

                  <div style={{ fontSize: 11, color: TC_COLORS.faint, fontWeight: 600, marginTop: 6 }}>Tipo de cuenta</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {[
                      { value: "member", title: "Equipo (personalizado)", desc: "Elige a continuación qué páginas y acciones puede usar." },
                      { value: "asistencia_viewer", title: "Solo Asistencia · lectura", desc: "Acceso único al módulo de Asistencia, sin poder editar." },
                      { value: "asistencia_editor", title: "Solo Asistencia · edición", desc: "Acceso al módulo de Asistencia con permiso para ver, agregar y editar." },
                      { value: "admin", title: "Administrador", desc: "Acceso total a todas las páginas y acciones." },
                    ].map((opt) => (
                      <div key={opt.value} onClick={() => setNewUserRole(opt.value)} style={{
                        cursor: "pointer", borderRadius: 8, padding: "10px 12px",
                        border: `1px solid ${newUserRole === opt.value ? TC_COLORS.amber : TC_COLORS.border}`,
                        background: newUserRole === opt.value ? TC_COLORS.amberDim : TC_COLORS.panel2,
                        display: "flex", alignItems: "flex-start", gap: 10,
                      }}>
                        <div style={{
                          marginTop: 2, width: 15, height: 15, borderRadius: "50%", flexShrink: 0,
                          border: `2px solid ${newUserRole === opt.value ? TC_COLORS.amber : TC_COLORS.faint}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          {newUserRole === opt.value && <div style={{ width: 7, height: 7, borderRadius: "50%", background: TC_COLORS.amber }} />}
                        </div>
                        <div>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: newUserRole === opt.value ? TC_COLORS.text : TC_COLORS.text }}>{opt.title}</div>
                          <div style={{ fontSize: 10.5, color: TC_COLORS.faint, marginTop: 2 }}>{opt.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {wizardStepKey === "paginas" && (
                <>
                  <div style={{ fontSize: 12, color: TC_COLORS.faint }}>Elige a qué páginas podrá entrar <strong style={{ color: TC_COLORS.text }}>{newUserName.trim() || "este usuario"}</strong>. Podrás afinar los permisos exactos en el siguiente paso.</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {NAV_ITEMS_DEFAULT.map((n) => {
                      const active = newUserPages.includes(n.key);
                      return (
                        <div key={n.key} onClick={() => toggleNewUserPage(n.key)} style={{
                          cursor: "pointer", borderRadius: 8, padding: "10px 12px",
                          border: `1px solid ${active ? TC_COLORS.amber : TC_COLORS.border}`,
                          background: active ? TC_COLORS.amberDim : TC_COLORS.panel2,
                          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                        }}>
                          <div style={{ fontSize: 12.5, fontWeight: 500 }}>{n.label}</div>
                          <div style={{
                            width: 34, height: 19, borderRadius: 10, flexShrink: 0, position: "relative",
                            background: active ? TC_COLORS.amber : TC_COLORS.border, transition: "background .15s",
                          }}>
                            <div style={{
                              position: "absolute", top: 2, left: active ? 17 : 2, width: 15, height: 15, borderRadius: "50%",
                              background: active ? TC_COLORS.amberText : TC_COLORS.faint, transition: "left .15s",
                            }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 10.5, color: TC_COLORS.faint }}>{newUserPages.length} de {NAV_ITEMS_DEFAULT.length} páginas seleccionadas</div>
                </>
              )}

              {wizardStepKey === "permisos" && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 12, color: TC_COLORS.faint }}>Define qué acciones puede hacer en cada página habilitada.</div>
                    <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                      <button onClick={() => setNewUserPermisos((prev) => ({ ...prev, ...Object.fromEntries(newUserPages.map((k) => [k, Object.fromEntries(PERMISSION_ACTIONS.map(a => [a.key, true]))])) }))} style={{ background: TC_COLORS.greenDim, color: TC_COLORS.green, border: `1px solid ${TC_COLORS.green}`, borderRadius: 5, padding: "4px 7px", fontSize: 9.5, cursor: "pointer" }}>Dar todos</button>
                      <button onClick={() => setNewUserPermisos((prev) => ({ ...prev, ...Object.fromEntries(newUserPages.map((k) => [k, Object.fromEntries(PERMISSION_ACTIONS.map(a => [a.key, false]))])) }))} style={{ background: "transparent", color: TC_COLORS.faint, border: `1px solid ${TC_COLORS.border}`, borderRadius: 5, padding: "4px 7px", fontSize: 9.5, cursor: "pointer" }}>Quitar todos</button>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {NAV_ITEMS_DEFAULT.filter((n) => newUserPages.includes(n.key)).map((n) => (
                      <div key={n.key} style={{ background: TC_COLORS.panel2, border: `1px solid ${TC_COLORS.border}`, borderRadius: 8, padding: "9px 12px" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: 7 }}>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>{n.label}</div>
                          <div style={{ display:"flex", gap:4 }}>
                            <button type="button" onClick={()=>setNewUserPermisos(prev=>({ ...prev, [n.key]: Object.fromEntries(PERMISSION_ACTIONS.map(a=>[a.key,true])) }))} style={{ background:"transparent", color:TC_COLORS.green, border:`1px solid ${TC_COLORS.green}`, borderRadius:4, padding:"2px 6px", fontSize:8.5, cursor:"pointer" }}>Todo</button>
                            <button type="button" onClick={()=>setNewUserPermisos(prev=>({ ...prev, [n.key]: Object.fromEntries(PERMISSION_ACTIONS.map(a=>[a.key,false])) }))} style={{ background:"transparent", color:TC_COLORS.faint, border:`1px solid ${TC_COLORS.border}`, borderRadius:4, padding:"2px 6px", fontSize:8.5, cursor:"pointer" }}>Nada</button>
                          </div>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {PERMISSION_ACTIONS.map((a) => {
                            const on = !!newUserPermisos[n.key]?.[a.key];
                            return (
                              <div key={a.key} onClick={() => toggleMatrixPermission(n.key, a.key)} title={a.label} style={{
                                cursor: "pointer", userSelect: "none", fontSize: 10.5, padding: "5px 9px", borderRadius: 6,
                                border: `1px solid ${on ? TC_COLORS.amber : TC_COLORS.border}`,
                                background: on ? TC_COLORS.amberDim : "transparent",
                                color: on ? TC_COLORS.text : TC_COLORS.faint, fontWeight: on ? 600 : 400,
                              }}>
                                {a.label}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    {!NAV_ITEMS_DEFAULT.some((n) => newUserPages.includes(n.key)) && (
                      <div style={{ color: TC_COLORS.faint, fontSize: 12, textAlign: "center", padding: "10px 0" }}>Vuelve al paso anterior y elige al menos una página.</div>
                    )}
                  </div>
                </>
              )}

              {wizardStepKey === "confirmar" && (
                <>
                  <div style={{ fontSize: 12, color: TC_COLORS.faint, marginBottom: 2 }}>Revisa los datos antes de crear el usuario.</div>
                  <div style={{ background: TC_COLORS.panel2, border: `1px solid ${TC_COLORS.border}`, borderRadius: 8, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 11, color: TC_COLORS.faint }}>Nombre</span>
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{newUserName.trim() || "—"}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 11, color: TC_COLORS.faint }}>Tipo de cuenta</span>
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                        {newUserRole === "admin" ? "Administrador"
                          : newUserRole === "asistencia_viewer" ? "Solo Asistencia · lectura"
                          : newUserRole === "asistencia_editor" ? "Solo Asistencia · edición"
                          : "Equipo (personalizado)"}
                      </span>
                    </div>
                    {newUserRole === "member" && (
                      <>
                        <div style={{ borderTop: `1px solid ${TC_COLORS.border}`, paddingTop: 8 }}>
                          <div style={{ fontSize: 11, color: TC_COLORS.faint, marginBottom: 4 }}>Páginas con acceso</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                            {NAV_ITEMS_DEFAULT.filter((n) => newUserPages.includes(n.key)).map((n) => (
                              <span key={n.key} style={{ fontSize: 10.5, padding: "3px 8px", borderRadius: 5, background: TC_COLORS.amberDim, color: TC_COLORS.text }}>{n.label}</span>
                            ))}
                            {!newUserPages.length && <span style={{ fontSize: 10.5, color: TC_COLORS.red }}>Ninguna</span>}
                          </div>
                        </div>
                        <div style={{ fontSize: 10.5, color: TC_COLORS.faint }}>
                          {Object.values(newUserPermisos).reduce((a, m) => a + Object.values(m).filter(Boolean).length, 0)} acciones habilitadas en total
                        </div>
                      </>
                    )}
                    {newUserRole !== "member" && (
                      <div style={{ fontSize: 10.5, color: TC_COLORS.faint }}>
                        {newUserRole === "admin" ? "Acceso total a todas las páginas y permisos." : "Acceso restringido únicamente al módulo de Asistencia."}
                      </div>
                    )}
                  </div>
                </>
              )}

              {userError && <div style={{ color: TC_COLORS.red, fontSize: 11.5 }}>{userError}</div>}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 16, borderTop: `1px solid ${TC_COLORS.border}`, paddingTop: 14 }}>
              {wizardStep > 0 && (
                <button onClick={wizardGoBack} style={{ background: "transparent", border: `1px solid ${TC_COLORS.border}`, color: TC_COLORS.text, borderRadius: 7, padding: "10px 16px", fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}>
                  Atrás
                </button>
              )}
              <div style={{ flex: 1 }} />
              {wizardStepKey !== "confirmar" ? (
                <button onClick={wizardGoNext} style={{ background: TC_COLORS.amber, color: TC_COLORS.amberText, border: "none", borderRadius: 7, padding: "10px 18px", fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}>
                  Siguiente
                </button>
              ) : (
                <button onClick={wizardFinish} style={{ background: TC_COLORS.green, color: TC_COLORS.greenTextDark, border: "none", borderRadius: 7, padding: "10px 18px", fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}>
                  Crear usuario
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showHistory && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }} onClick={() => setShowHistory(false)}>
          <div style={{ background: TC_COLORS.panel, border: `1px solid ${TC_COLORS.border}`, borderRadius: 12, padding: 22, width: 520, maxWidth: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column", boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: 14 }}>Historial de cambios</div>
              <button onClick={() => setShowHistory(false)} style={{ background: "transparent", border: "none", color: TC_COLORS.faint, cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }} className="tc-scroll">
              {history.length === 0 && <div style={{ color: TC_COLORS.faint, fontSize: 12.5, textAlign: "center", padding: "20px 0" }}>Todavia no hay cambios registrados</div>}
              {[...history].sort((a, b) => b.ts - a.ts).slice(0, 100).map((entry) => (
                <div key={entry.id} style={{ background: TC_COLORS.panel2, borderRadius: 8, padding: "9px 12px", fontSize: 12 }}>
                  <div style={{ color: TC_COLORS.text }}>{describeLog(entry)}</div>
                  <div style={{ color: TC_COLORS.faint, fontSize: 10.5, marginTop: 3 }}>{fmtRelTime(entry.ts)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {sustentoGate.modal}
    </div>
  );
}


export { TcKpi, TorreControl };
