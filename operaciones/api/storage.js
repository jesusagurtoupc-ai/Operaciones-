import { neon } from "@neondatabase/serverless";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { getFreshSession } from "./auth.js";

const sql = neon(process.env.DATABASE_URL);
const PROPOSALS_KEY = "wilarcon_propuestas";
// El frontend (AppShell.jsx, NAV_ORDER_STORAGE_KEY en core-common.jsx) guarda el orden del
// menu de navegacion bajo "wilarcon_nav_order" para CUALQUIER usuario logueado, sin importar
// su rol o permisos de modulo -- no pertenece a ningun modulo real. moduleForKey no la
// reconocia (no calzaba con "torre_nav_order", una clave vieja de otro proposito) y caia al
// fallback "solo admin", asi que cualquier no-admin recibia 403 al leer o guardar su propio
// orden de menu. Se trata igual que PROPOSALS_KEY: acceso libre para cualquier sesion valida.
const NAV_ORDER_KEY = "wilarcon_nav_order";
const ENCRYPTED_PREFIX = "enc:v1:";
let warnedMissingEncryptionKey = false;
function encryptionKey() {
  const explicit = process.env.ACCOUNTS_ENCRYPTION_KEY;
  if (explicit) return crypto.createHash("sha256").update(String(explicit)).digest();
  if (!warnedMissingEncryptionKey) {
    warnedMissingEncryptionKey = true;
    console.warn("[storage] ACCOUNTS_ENCRYPTION_KEY no esta configurada; se esta usando una clave derivada de DATABASE_URL. Configurar ACCOUNTS_ENCRYPTION_KEY en produccion.");
  }
  const fallbackSource = process.env.DATABASE_URL || "operaciones-encryption-fallback";
  return crypto.createHash("sha256").update("accounts-encryption:" + String(fallbackSource)).digest();
}
function encryptSensitive(value) {
  if (typeof value !== "string" || !value) return value;
  if (value.startsWith(ENCRYPTED_PREFIX)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENCRYPTED_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}
function legacyEncryptionKeys() {
  const keys = [];
  if (process.env.AUTH_SECRET) keys.push(crypto.createHash("sha256").update(String(process.env.AUTH_SECRET)).digest());
  if (process.env.DATABASE_URL) keys.push(crypto.createHash("sha256").update(String(process.env.DATABASE_URL)).digest());
  return keys;
}
function tryDecryptWithKey(key, iv, tag, ciphertext) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
export function decryptSensitive(value) {
  if (typeof value !== "string" || !value.startsWith(ENCRYPTED_PREFIX)) return value;
  try {
    const raw = Buffer.from(value.slice(ENCRYPTED_PREFIX.length), "base64url");
    const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), ciphertext = raw.subarray(28);
    try {
      return tryDecryptWithKey(encryptionKey(), iv, tag, ciphertext);
    } catch (_) {
      for (const legacyKey of legacyEncryptionKeys()) {
        try { return tryDecryptWithKey(legacyKey, iv, tag, ciphertext); } catch (_) { console.error(_); }
      }
      throw new Error("ninguna clave (actual ni legacy) pudo descifrar el valor");
    }
  } catch (e) { console.error("decryptSensitive: no se pudo descifrar el valor, se devuelve tal cual", e); return value; }
}


const KEY_MODULES = [
  ["wilarcon_trabajos_", "trabajos"],
  ["wilarcon_asistencia_", "asistencia"],
  ["wilarcon_contactos_", "contactos"],
  ["wilarcon_cuentas_", "contactos"],
  ["wilarcon_viaticos_", "viaticos"],
  ["wilarcon_gastos_", "gastos"],
  ["wilarcon_caja_chica_", "caja_chica"],
  ["wilarcon_responsabilidades_", "responsabilidades"],
  // El frontend (page-informes.jsx, STORAGE_KEY_INFORMES) guarda los informes tecnicos bajo
  // "wilarcon_informes_records". Esta entrada nunca existio en KEY_MODULES, asi que
  // moduleForKey devolvia null para esa clave y tanto isAuthorized como canWriteModule caian
  // al fallback "solo admin" -- ningun usuario no-admin podia leer ni crear informes, sin
  // importar que tuviera Ver/Agregar activos en permisosPorPagina.informes (esos permisos
  // se guardaban bien desde la pantalla de Accesos; el problema era solo del lado del server).
  ["wilarcon_informes_", "informes"],
  // El frontend (page-cotizacion.jsx) guarda las cotizaciones bajo
  // "wilarcon_cotizaciones_records". Sin esta entrada, moduleForKey no reconocia
  // la clave (modulo = null) y isAuthorized/canWriteModule caian al fallback
  // "solo admin", por lo que ningun usuario no-admin podia ver ni guardar
  // cotizaciones aunque tuviera los permisos V/agregar/editar activos en
  // permisosPorPagina.cotizacion.
  ["wilarcon_cotizaciones_", "cotizacion"],
  // El frontend (core-common.jsx, STORAGE_KEY_COTIZACION_REVISIONES) guarda las revisiones
  // de cotizacion bajo "wilarcon_cotizacion_revisiones" (singular "cotizacion", sin la "es"
  // de "cotizaciones_"). Sin esta entrada, moduleForKey no reconocia esa clave especifica
  // (no calzaba con el prefijo "wilarcon_cotizaciones_" de arriba) y cualquier usuario
  // no-admin recibia 403 al leer o guardar revisiones, aunque tuviera permisos de cotizacion.
  ["wilarcon_cotizacion_revisiones", "cotizacion"],
  // El frontend (page-visitas.jsx, STORAGE_KEY_VISITAS) guarda los informes de visita tecnica
  // bajo "wilarcon_visitas_records". Igual que paso antes con "wilarcon_informes_" y
  // "wilarcon_cotizaciones_", esta entrada nunca existio en KEY_MODULES: moduleForKey
  // devolvia null para esa clave y tanto isAuthorized como canWriteModule caian al fallback
  // "solo admin", asi que cualquier usuario no-admin recibia 403 al leer o guardar visitas
  // aunque tuviera Ver/Agregar/Editar activos en permisosPorPagina.visitas. En el frontend
  // ese 403 se mostraba con el mismo mensaje generico de "otro usuario modifico estos
  // registros" (conflicto de version), lo cual era enganoso: el problema real era de permisos.
  ["wilarcon_visitas_", "visitas"],
  ["torre_ops_", "torre"],
  ["torre_alert_phone", "torre"],
  // Corregido: el frontend (page-torre.jsx) guarda los adjuntos de Torre bajo el prefijo
  // "wilarcon_torre_docs_", no "torre_tc_docs_" (ese prefijo nunca se usaba en el cliente).
  // Con el prefijo equivocado, moduleForKey no reconocia la clave y solo el admin podia
  // leer/escribir adjuntos de Torre.
  ["wilarcon_torre_docs_", "torre"],
  ["torre_nav_order", "torre"],
];

function moduleForKey(key) {
  return KEY_MODULES.find(([prefix]) => key === prefix || key.startsWith(prefix))?.[1] || null;
}

function canAction(session, module, action) {
  if (!session) return false;
  if (session.role === "admin") return true;
  if (session.role === "asistencia_viewer") return module === "asistencia" && action === "ver";
  if (session.role === "asistencia_editor") return module === "asistencia" && ["ver", "agregar", "editar"].includes(action);
  const matrix = session.permisosPorPagina || {};
  return !!matrix?.[module]?.[action];
}

function canWriteModule(session, module, intent) {
  if (intent === "eliminar") return canAction(session, module, "eliminar");
  if (intent === "crear") return canAction(session, module, "agregar");
  if (intent === "editar") return canAction(session, module, "editar");
  if (intent === "adjuntar") return canAction(session, module, "adjuntar");
  if (module === "torre") return canAction(session, module, "editar") || canAction(session, module, "agregar") || canAction(session, module, "eliminar");
  return canAction(session, module, "editar") || canAction(session, module, "agregar");
}

function isAuthorized(session, key, action, intent) {
  if (!session)
    return false;
  if (key === PROPOSALS_KEY || key === NAV_ORDER_KEY) {
    return true;
  }
  const module = moduleForKey(key);
  if (!module) return session.role === "admin";
  if (action === "write") return canWriteModule(session, module, intent);
  return canAction(session, module, action);
}


const WORKER_SCOPED_KEYS = new Set([
  "wilarcon_trabajos_records",
  "wilarcon_asistencia_registros",
  "wilarcon_viaticos_records",
  "wilarcon_gastos_records",
  "wilarcon_responsabilidades_records",
]);

function normalizePerson(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es");
}

function workerName(session) {
  return String(session?.trabajador || "").trim();
}

function recordBelongsToWorker(key, record, worker) {
  const target = normalizePerson(worker);
  if (!target) return false;
  if (key === "wilarcon_trabajos_records") {
    if (normalizePerson(record?.trabajador || record?.responsable) === target) return true;
    // Una OC puede tener varias personas en "personalAsignado" ademas de un unico "responsable".
    // Si no se incluye aqui, el resto del equipo asignado nunca ve la OC en su sesion.
    const personal = String(record?.personalAsignado || "").split(/[,;\n]+/).map((s) => normalizePerson(s)).filter(Boolean);
    return personal.includes(target);
  }
  if (key === "wilarcon_asistencia_registros" || key === "wilarcon_viaticos_records" || key === "wilarcon_responsabilidades_records") {
    return normalizePerson(record?.trabajador || record?.responsable) === target;
  }
  if (key === "wilarcon_gastos_records") {
    const raw = record?.destinatario;
    if (Array.isArray(raw)) return raw.some((x) => normalizePerson(x) === target);
    return String(raw || "").split(/[,;|]/).some((x) => normalizePerson(x) === target);
  }
  return false;
}

// --- Adjuntos por registro (docs) ---------------------------------------
// Los adjuntos de trabajos/gastos/torre se guardan bajo una clave por-ID
// (p.ej. "wilarcon_trabajos_docs_45") que NO esta en WORKER_SCOPED_KEYS porque
// no es una lista de registros: es un archivo colgado de un registro puntual.
// Sin este chequeo, cualquier usuario con permiso de "ver" sobre el modulo
// podia pedir el ID de la OC/gasto/tarea de OTRO trabajador y descargar sus
// adjuntos, ya que la autorizacion solo validaba el modulo, no el dueño del
// registro. Aqui resolvemos la clave al registro padre y confirmamos que
// pertenece al trabajador de la sesion antes de permitir lectura o escritura.
const DOC_KEY_CONFIGS = [
  { prefix: "wilarcon_trabajos_docs_", recordsKey: "wilarcon_trabajos_records", kind: "records" },
  { prefix: "wilarcon_gastos_docs_", recordsKey: "wilarcon_gastos_records", kind: "records" },
  { prefix: "wilarcon_torre_docs_", recordsKey: "torre_ops_data", kind: "torre_task" },
  { prefix: "wilarcon_caja_chica_docs_", recordsKey: "wilarcon_caja_chica_records", kind: "records" },
];

function docKeyConfig(key) {
  for (const cfg of DOC_KEY_CONFIGS) {
    if (key.startsWith(cfg.prefix)) return { ...cfg, recordId: key.slice(cfg.prefix.length) };
  }
  return null;
}

async function docRecordBelongsToWorker(cfg, worker) {
  if (!worker) return false;
  try {
    const rows = await sql`SELECT value FROM app_storage WHERE key = ${cfg.recordsKey}`;
    if (!rows.length) return false;
    const data = JSON.parse(rows[0].value);
    if (cfg.kind === "torre_task") {
      const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
      const task = tasks.find((t) => String(t?.id ?? "") === String(cfg.recordId));
      if (!task) return false;
      return normalizePerson(task?.responsable) === normalizePerson(worker);
    }
    const records = Array.isArray(data) ? data : [];
    const record = records.find((r) => String(r?.id ?? "") === String(cfg.recordId));
    if (!record) return false;
    return recordBelongsToWorker(cfg.recordsKey, record, worker);
  } catch (e) {
    console.error("recordBelongsToWorker: no se pudo evaluar el registro", e);
    return false;
  }
}

// La letra "T" (permiso "todos" del modulo, ver PERMISSION_ACTIONS en core-common.jsx) le permite
// a un usuario vinculado a un trabajador ver la informacion de TODOS los usuarios en ese modulo en
// vez de solo la suya. Sigue limitado por las demas letras: sin "ver" la solicitud ya fue rechazada
// en isAuthorized mas arriba, y esto no toca los permisos de escritura (agregar/editar/eliminar),
// que se siguen validando aparte via canWriteModule.
function tieneVerTodos(session, module) {
  return !!module && canAction(session, module, "todos");
}

function filterWorkerData(key, value, session) {
  if (!session || session.role === "admin" || !session.trabajador) return value;
  const worker = workerName(session);
  if (!worker) return value;
  const module = moduleForKey(key);
  const verTodos = tieneVerTodos(session, module);
  try {
    const data = JSON.parse(value);
    if (key === "wilarcon_asistencia_trabajadores" && Array.isArray(data)) {
      if (verTodos) return value;
      return JSON.stringify(data.filter((x) => normalizePerson(x) === normalizePerson(worker)));
    }
    if (WORKER_SCOPED_KEYS.has(key) && Array.isArray(data)) {
      if (verTodos) return value;
      return JSON.stringify(data.filter((r) => recordBelongsToWorker(key, r, worker)));
    }
    if (key === "torre_ops_data" && data && typeof data === "object") {
      return JSON.stringify({
        tasks: verTodos
          ? (Array.isArray(data.tasks) ? data.tasks : [])
          : (Array.isArray(data.tasks) ? data.tasks.filter((r) => normalizePerson(r?.responsable) === normalizePerson(worker)) : []),
        history: [],
        users: [],
      });
    }
  } catch (_) { console.error(_); }
  return value;
}

function mergeWorkerScopedWrite(key, incomingValue, existingValue, session) {
  if (!session || session.role === "admin" || !session.trabajador || !WORKER_SCOPED_KEYS.has(key)) return incomingValue;
  // Con la letra "T" activa, el GET ya entrego el modulo completo (ver filterWorkerData), por lo
  // que cualquier guardado parte de la lista entera de todos los usuarios. Restringir aqui a "solo
  // sus propios registros" rompería ese guardado; el alcance de la escritura ya quedo validado por
  // canWriteModule (letras agregar/editar/eliminar) antes de llegar aqui.
  if (tieneVerTodos(session, moduleForKey(key))) return incomingValue;
  const worker = workerName(session);
  if (!worker) throw new Error("usuario_sin_trabajador");
  let incoming, existing;
  try { incoming = JSON.parse(incomingValue); existing = JSON.parse(existingValue); } catch (e) { console.error("JSON invalido al validar guardado", e); throw new Error("datos_invalidos"); }
  if (!Array.isArray(incoming) || !Array.isArray(existing)) throw new Error("datos_invalidos");
  const ownIncoming = incoming.filter((r) => recordBelongsToWorker(key, r, worker));
  const invalid = incoming.some((r) => !recordBelongsToWorker(key, r, worker));
  if (invalid) throw new Error("alcance_no_autorizado");
  const ownIds = new Set(ownIncoming.map((r) => String(r?.id ?? r?.n ?? "")));
  const preserved = existing.filter((r) => !recordBelongsToWorker(key, r, worker));
  const result = [...preserved, ...ownIncoming];
  return JSON.stringify(result);
}


// --- Reposicion automatica de caja chica -----------------------------------
// Cuando el saldo de caja chica cae por debajo del umbral se crea (una sola vez,
// mientras no se complete) una tarea en Torre de Control; cuando el saldo vuelve
// a superar el umbral, esa tarea se marca como Completado automaticamente.
const CAJA_CHICA_REPOSICION_UMBRAL = 500;
const CAJA_CHICA_REPOSICION_TAREA = "REPOSICION DE CAJA CHICA";
const CAJA_CHICA_REPOSICION_RESPONSABLE = "Geane";

function calcularSaldoCajaChica(recordsJson) {
  let records;
  try { records = JSON.parse(recordsJson); } catch (e) { console.error("calcularSaldoCajaChica: JSON invalido", e); return null; }
  if (!Array.isArray(records)) return null;
  return records.reduce((s, r) => {
    const n = Number(String(r?.importe ?? "").replace(/,/g, ""));
    const monto = Number.isFinite(n) ? n : 0;
    return s + (String(r?.tipo || "").toUpperCase() === "EGRESO" ? -monto : monto);
  }, 0);
}

function fechaHoyStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function sumarDiasStr(fechaStr, dias) {
  const [y, m, d] = String(fechaStr).split("-").map(Number);
  const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + dias);
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function siguienteIdNumerico(list) {
  return list.length ? Math.max(...list.map((x) => Number(x?.id) || 0)) + 1 : 1;
}

// Se ejecuta como accion de sistema (no depende de los permisos de modulo "torre" del
// usuario que registro el gasto de caja chica) y nunca debe romper el guardado de caja
// chica si algo falla: los errores se registran y se ignoran.
async function sincronizarTareaReposicionCajaChica(saldo) {
  if (saldo === null || !Number.isFinite(saldo)) return;
  try {
    const rows = await sql`SELECT value FROM app_storage WHERE key = 'torre_ops_data'`;
    let data;
    try { data = rows.length ? JSON.parse(rows[0].value) : null; } catch (e) { console.error("sincronizarTareaReposicionCajaChica: JSON invalido en torre_ops_data", e); data = null; }
    if (!data || typeof data !== "object") data = { tasks: [], history: [], users: [] };
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    const history = Array.isArray(data.history) ? data.history : [];
    const esReposicion = (t) => !t?.deleted && String(t?.tarea || "").trim().toUpperCase() === CAJA_CHICA_REPOSICION_TAREA;
    const tareaActiva = tasks.find((t) => esReposicion(t) && t.estado !== "Completado");

    let nextTasks = null;
    let logEntry = null;

    if (saldo < CAJA_CHICA_REPOSICION_UMBRAL) {
      // Mientras la tarea no se complete, no se crea una nueva.
      if (!tareaActiva) {
        const inicio = fechaHoyStr();
        const nuevaTarea = {
          id: siguienteIdNumerico(tasks),
          tarea: CAJA_CHICA_REPOSICION_TAREA,
          responsable: CAJA_CHICA_REPOSICION_RESPONSABLE,
          prioridad: "Alta",
          inicio,
          fin: sumarDiasStr(inicio, 3),
          estado: "En curso",
          obs: "coordinar la reposicion de la caja chica saldo menor a S/ 500.00.",
          recurrente: false,
          frecuencia: "Semanal",
          deleted: false,
          deletedAt: null,
          completadoAt: null,
        };
        nextTasks = [...tasks, nuevaTarea];
        logEntry = { action: "add", taskId: nuevaTarea.id, taskTarea: nuevaTarea.tarea };
      }
    } else if (tareaActiva) {
      nextTasks = tasks.map((t) => (t.id === tareaActiva.id ? { ...t, estado: "Completado", completadoAt: Date.now() } : t));
      logEntry = { action: "edit", taskId: tareaActiva.id, taskTarea: tareaActiva.tarea };
    }

    if (!nextTasks) return;
    const nextHistory = [...history, { id: siguienteIdNumerico(history), ts: Date.now(), actor: "Sistema (automatico)", ...logEntry }];
    const nextValue = JSON.stringify({ ...data, tasks: nextTasks, history: nextHistory });
    await sql`
      INSERT INTO app_storage (key, value, version, updated_at)
      VALUES ('torre_ops_data', ${nextValue}, 1, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, version = app_storage.version + 1, updated_at = now()
    `;
    // El frontend de Torre de Control (page-torre.jsx) solo vuelve a leer "torre_ops_data"
    // cuando detecta que "torre_ops_meta.updatedAt" cambio (poll cada 4s). Sin esta escritura,
    // una pantalla ya abierta seguiria mostrando la tarea como "En curso" (o sin la nueva tarea)
    // hasta que alguien recargue la pagina por completo.
    const meta = JSON.stringify({ updatedAt: Date.now(), updatedBy: "Sistema (automatico)", count: nextTasks.length });
    await sql`
      INSERT INTO app_storage (key, value, version, updated_at)
      VALUES ('torre_ops_meta', ${meta}, 1, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, version = app_storage.version + 1, updated_at = now()
    `;
  } catch (e) {
    console.error("no se pudo sincronizar la tarea de reposicion de caja chica", e);
  }
}

async function obtenerSaldoCajaChicaActual() {
  try {
    const rows = await sql`SELECT value FROM app_storage WHERE key = 'wilarcon_caja_chica_records'`;
    if (!rows.length) return 0;
    const saldo = calcularSaldoCajaChica(rows[0].value);
    return saldo === null ? 0 : saldo;
  } catch (e) {
    console.error("no se pudo leer el saldo de caja chica", e);
    return null;
  }
}

// Se ejecuta despues de CUALQUIER guardado de torre_ops_data (por ejemplo cuando alguien
// completa manualmente la tarea "REPOSICION DE CAJA CHICA" desde Torre de Control). Si tras
// ese guardado ya no queda ninguna tarea de reposicion activa y el saldo de caja chica sigue
// por debajo del umbral, se crea una nueva tarea (reutilizando la misma logica de arriba).
async function revisarReposicionTrasGuardarTorre(torreValueJson) {
  try {
    let data;
    try { data = JSON.parse(torreValueJson); } catch (e) { console.error("revisarReposicionTrasGuardarTorre: JSON invalido", e); return; }
    if (!data || typeof data !== "object") return;
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    const esReposicion = (t) => !t?.deleted && String(t?.tarea || "").trim().toUpperCase() === CAJA_CHICA_REPOSICION_TAREA;
    if (tasks.some((t) => esReposicion(t) && t.estado !== "Completado")) return; // ya hay una activa

    const saldo = await obtenerSaldoCajaChicaActual();
    if (saldo === null || saldo >= CAJA_CHICA_REPOSICION_UMBRAL) return;

    await sincronizarTareaReposicionCajaChica(saldo);
  } catch (e) {
    console.error("no se pudo revisar la reposicion de caja chica tras guardar torre", e);
  }
}

function validateCajaChicaWrite(incomingValue, existingValue, session, intent) {
  if (!session || session.role === "admin") return;
  let incoming, existing;
  try { incoming = JSON.parse(incomingValue); existing = JSON.parse(existingValue || "[]"); } catch (e) { console.error("JSON invalido al validar guardado", e); throw new Error("datos_invalidos"); }
  if (!Array.isArray(incoming) || !Array.isArray(existing)) throw new Error("datos_invalidos");
  const puedeAprobar = canAction(session, "caja_chica", "aprobar");
  const oldById = new Map(existing.map(r => [String(r?.id ?? ""), r]));
  for (const r of incoming) {
    const id = String(r?.id ?? "");
    const old = oldById.get(id);
    if (!old) {
      if (!puedeAprobar && String(r?.estado || "PENDIENTE").toUpperCase() !== "PENDIENTE") throw new Error("estado_no_autorizado");
      continue;
    }
    if (!puedeAprobar && String(r?.estado || "PENDIENTE").toUpperCase() !== String(old?.estado || "PENDIENTE").toUpperCase()) {
      throw new Error("cambio_estado_no_autorizado");
    }
  }
}

function mergeTorreWorkerWrite(incomingValue, existingValue, session) {
  if (!session || session.role === "admin" || !session.trabajador) return incomingValue;
  let incoming, existing;
  try { incoming = JSON.parse(incomingValue); existing = JSON.parse(existingValue); } catch (e) { console.error("JSON invalido al validar guardado", e); throw new Error("datos_invalidos"); }
  if (!incoming || typeof incoming !== "object" || !existing || typeof existing !== "object") throw new Error("datos_invalidos");
  const worker = workerName(session);
  const incomingTasks = Array.isArray(incoming.tasks) ? incoming.tasks : [];
  const existingTasks = Array.isArray(existing.tasks) ? existing.tasks : [];
  // "users" e "history" NUNCA deben confiarse desde un cliente no-admin, ni siquiera cuando
  // tiene el permiso "T" (verTodos). El GET de torre_ops_data siempre entrega users:[] e
  // history:[] a los no-admin (filterWorkerData), asi que cualquier guardado que reenvie esos
  // campos tal cual traeria un valor vacio o, peor, un placeholder del frontend (ver bug de
  // "DEFAULT_USERS" corregido en page-torre.jsx) — y eso borraria a todos los usuarios reales
  // de la base de datos. Por eso se preservan siempre desde "existing", sin excepcion.
  if (tieneVerTodos(session, "torre")) {
    // Con "T" activo el cliente ya tiene la lista completa de tareas, asi que se confia en
    // "incoming.tasks" tal cual. Lo unico que se sigue protegiendo son users/history.
    return JSON.stringify({
      ...existing,
      tasks: incomingTasks,
      history: existing.history || [],
      users: existing.users || [],
    });
  }
  if (incomingTasks.some((r) => normalizePerson(r?.responsable) !== normalizePerson(worker))) throw new Error("alcance_no_autorizado");
  const preserved = existingTasks.filter((r) => normalizePerson(r?.responsable) !== normalizePerson(worker));
  return JSON.stringify({
    ...existing,
    tasks: [...preserved, ...incomingTasks],
    history: existing.history || [],
    users: existing.users || [],
  });
}

export function sanitizeTorreData(value) {
  try {
    const data = JSON.parse(value);
    if (Array.isArray(data.users)) {
      data.users = data.users.map(({ password: _password, passwordHash: _hash, ...user }) => user);
    }
    return JSON.stringify(data);
  } catch (e) {
    console.error("sanitizeTorreData: no se pudo sanear el valor, se devuelve tal cual", e);
    return value;
  }
}

const scryptAsync = promisify(crypto.scrypt);
async function hashPassword(value) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scryptAsync(String(value), salt, 64);
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

async function normalizeTorreDataForSave(value) {
  try {
    const data = JSON.parse(value);
    if (Array.isArray(data.users)) {
      // El GET de torre_ops_data nunca envia password ni passwordHash al cliente (por seguridad,
      // ver sanitizeTorreData). Eso significa que cualquier guardado que reutilice esa lista de
      // usuarios sin haber cambiado la contraseña llega aqui SIN passwordHash. Si simplemente
      // guardaramos eso tal cual, se borraria (silenciosamente) la contraseña de todos los usuarios
      // en el primer guardado que ocurra despues de refrescar datos (por ejemplo, al editar una
      // tarea de Torre de Control minutos despues de crear un usuario nuevo). Por eso, para todo
      // usuario que NO trae una contraseña nueva en texto plano, se conserva el passwordHash que
      // ya existia en la base de datos, en vez de perderlo.
      let existingByName = new Map();
      try {
        const rows = await sql`SELECT value FROM app_storage WHERE key = 'torre_ops_data'`;
        if (rows.length) {
          const existingData = JSON.parse(rows[0].value);
          if (Array.isArray(existingData.users)) {
            existingData.users.forEach((u) => {
              const key = String(u.name || "").toLowerCase();
              if (key) existingByName.set(key, u);
            });
          }
        }
      } catch (_) { console.error(_); }
      data.users = await Promise.all(data.users.map(async user => {
        const next = { ...user };
        if (next.password) {
          next.passwordHash = await hashPassword(next.password);
          delete next.password;
        } else if (!next.passwordHash) {
          const prev = existingByName.get(String(next.name || "").toLowerCase());
          if (prev && prev.passwordHash) next.passwordHash = prev.passwordHash;
        }
        return next;
      }));
    }
    return JSON.stringify(data);
  } catch (e) {
    console.error("sanitizeTorreData: no se pudo sanear el valor, se devuelve tal cual", e);
    return value;
  }
}

// Un usuario que no es admin NUNCA puede cambiar la lista de usuarios (roles, permisos ni
// contraseñas). Antes, quien tenía permiso de edición en Torre pero no estaba vinculado a un
// trabajador caía en la rama "sin protección" y el servidor aceptaba el campo `users` tal cual lo
// mandaba el cliente (incluso convertía un `password` en texto plano en hash), lo que permitía
// subirse el rol o cambiar la contraseña del admin con una petición manual. Los trabajadores ya
// estaban protegidos por mergeTorreWorkerWrite; esto cierra el mismo hueco para el resto. En la
// interfaz solo el admin puede crear/editar usuarios, así que no cambia ningún flujo legítimo.
async function preserveUsersForNonAdmin(incomingValue) {
  let incoming;
  try { incoming = JSON.parse(incomingValue); } catch (e) { console.error("JSON invalido al validar guardado", e); throw new Error("datos_invalidos"); }
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) throw new Error("datos_invalidos");
  let existingUsers = [];
  const rows = await sql`SELECT value FROM app_storage WHERE key = 'torre_ops_data'`;
  if (rows.length) {
    try {
      const existing = JSON.parse(rows[0].value);
      if (Array.isArray(existing.users)) existingUsers = existing.users;
    } catch (e) { console.error(e); }
  }
  return JSON.stringify({ ...incoming, users: existingUsers });
}

export default async function handler(req, res) {
  try {
    let requestBody = {};
    if (req.method !== "GET") {
      try {
        requestBody = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      } catch (e) {
        console.error("handler: cuerpo de la peticion invalido", e);
        return res.status(400).json({ error: "cuerpo_invalido" });
      }
      if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) {
        return res.status(400).json({ error: "cuerpo_invalido" });
      }
    }
    const key = req.method === "GET" ? req.query.key : requestBody.key;
    if (typeof key !== "string" || !key.trim()) return res.status(400).json({ error: "key requerido" });
    const action = req.method === "GET" ? "ver" : "write";
    const session = await getFreshSession(req);
    if (!isAuthorized(session, key, action, requestBody.intent)) return res.status(403).json({ error: "sin permisos" });

    // Un usuario vinculado a un trabajador (no admin) solo puede leer/escribir/eliminar
    // adjuntos del registro (OC, gasto, tarea de Torre) que le pertenece a EL, aunque
    // tenga permiso de modulo. Sin esto, cualquier ID ajeno servido por adivinanza
    // exponia adjuntos de otro trabajador (ver docRecordBelongsToWorker arriba).
    if (session && session.role !== "admin" && session.trabajador) {
      const docCfg = docKeyConfig(key);
      if (docCfg && !tieneVerTodos(session, moduleForKey(key))) {
        const belongs = await docRecordBelongsToWorker(docCfg, workerName(session));
        if (!belongs) return res.status(403).json({ error: "sin permisos" });
      }
    }

    if (req.method === "GET") {
      if (!key) return res.status(400).json({ error: "key requerido" });
      const rows = await sql`SELECT value, version FROM app_storage WHERE key = ${key}`;
      if (!rows.length) return res.status(404).json({ error: "not found" });
      let value = key === "torre_ops_data" ? sanitizeTorreData(rows[0].value) : rows[0].value;
      if (key === "wilarcon_cuentas_records") value = decryptSensitive(value);
      value = filterWorkerData(key, value, session);
      return res.status(200).json({ key, value, version: rows[0].version });
    }

    if (req.method === "POST" || req.method === "PUT") {
      const body = requestBody;
      const { key, value, ifVersion, intent } = body;
      const isAdmin = session?.role === "admin";
      const module = moduleForKey(key);
      if (key !== PROPOSALS_KEY && key !== NAV_ORDER_KEY && !isAdmin && !canWriteModule(session, module, intent))
        return res.status(403).json({ error: "sin permisos" });
      let stringValue;
      if (key === "torre_ops_data") {
        if (session.role !== "admin" && session.trabajador) {
          // Se consulta el valor existente SIEMPRE (incluso si se sospecha que no existe aun)
          // para no caer nunca en la rama "sin protección" de abajo cuando el que escribe es un
          // trabajador. Si la clave realmente no existe todavia, se usa un objeto vacio como base:
          // mergeTorreWorkerWrite igual fuerza users:[] y history:[] en ese caso, en vez de confiar
          // en lo que mande el cliente.
          const existingRows = await sql`SELECT value FROM app_storage WHERE key = ${key}`;
          const existingBase = existingRows.length ? existingRows[0].value : JSON.stringify({ tasks: [], history: [], users: [] });
          stringValue = mergeTorreWorkerWrite(String(value), existingBase, session);
        } else if (session.role !== "admin") {
          stringValue = await preserveUsersForNonAdmin(String(value));
        } else {
          stringValue = await normalizeTorreDataForSave(String(value));
        }
        stringValue = await normalizeTorreDataForSave(stringValue);
      } else {
        stringValue = String(value);
        if (key === "wilarcon_caja_chica_records" && session.role !== "admin") {
          const existingRows = await sql`SELECT value FROM app_storage WHERE key = ${key}`;
          validateCajaChicaWrite(stringValue, existingRows.length ? existingRows[0].value : "[]", session, intent);
        }
        if (session.role !== "admin" && session.trabajador && WORKER_SCOPED_KEYS.has(key)) {
          const existingRows = await sql`SELECT value FROM app_storage WHERE key = ${key}`;
          if (!existingRows.length) return res.status(404).json({ error: "not found" });
          stringValue = mergeWorkerScopedWrite(key, stringValue, existingRows[0].value, session);
        }
      }
      if (key === "wilarcon_cuentas_records") stringValue = encryptSensitive(stringValue);

      if (ifVersion !== undefined && ifVersion !== null) {
        const updated = await sql`
          UPDATE app_storage
          SET value = ${stringValue}, version = version + 1, updated_at = now()
          WHERE key = ${key} AND version = ${ifVersion}
          RETURNING value, version
        `;
        if (updated.length) {
          if (key === "wilarcon_caja_chica_records") await sincronizarTareaReposicionCajaChica(calcularSaldoCajaChica(updated[0].value));
          if (key === "torre_ops_data") await revisarReposicionTrasGuardarTorre(updated[0].value);
          return res.status(200).json({ key, value: updated[0].value, version: updated[0].version });
        }

        const current = await sql`SELECT value, version FROM app_storage WHERE key = ${key}`;
        if (!current.length) {
          const inserted = await sql`
            INSERT INTO app_storage (key, value, version, updated_at)
            VALUES (${key}, ${stringValue}, 1, now())
            ON CONFLICT (key) DO NOTHING
            RETURNING value, version
          `;
          if (inserted.length) {
            if (key === "wilarcon_caja_chica_records") await sincronizarTareaReposicionCajaChica(calcularSaldoCajaChica(inserted[0].value));
            if (key === "torre_ops_data") await revisarReposicionTrasGuardarTorre(inserted[0].value);
            return res.status(200).json({ key, value: inserted[0].value, version: inserted[0].version });
          }
        }
        let currentValue = key === "wilarcon_cuentas_records" ? decryptSensitive(current[0]?.value) : current[0]?.value;
        if (key === "torre_ops_data") currentValue = sanitizeTorreData(currentValue);
        currentValue = filterWorkerData(key, currentValue, session);
        return res.status(409).json({ error: "conflicto_version", key, value: currentValue, version: current[0]?.version });
      }

      const result = await sql`
        INSERT INTO app_storage (key, value, version, updated_at)
        VALUES (${key}, ${stringValue}, 1, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, version = app_storage.version + 1, updated_at = now()
        RETURNING value, version
      `;
      if (key === "wilarcon_caja_chica_records") await sincronizarTareaReposicionCajaChica(calcularSaldoCajaChica(result[0].value));
      if (key === "torre_ops_data") await revisarReposicionTrasGuardarTorre(result[0].value);
      return res.status(200).json({ key, value: result[0].value, version: result[0].version });
    }

    if (req.method === "DELETE") {
      return res.status(405).json({ error: "metodo no soportado" });
    }

    res.setHeader("Allow", "GET, POST, PUT");
    return res.status(405).json({ error: "metodo no soportado" });
  } catch (err) {
    console.error("storage api error", err);
    return res.status(500).json({ error: "error interno" });
  }
}
