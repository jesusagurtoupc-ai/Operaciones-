import { SEED_DATA, ASISTENCIA_SEED_TRABAJADORES, ASISTENCIA_SEED_DATA, DEFAULT_MODULE_PERMISSIONS, DEFAULT_USERS, INITIAL_TASKS, CONTACTOS_SEED, VIATICOS_SEED, GASTOS_SEED, RESPONSABILIDADES_SEED, NAV_ITEMS_DEFAULT, COTIZACIONES_SEED } from "./data/seed-data";
import { useState, useEffect, useRef, useMemo } from "react";

if (typeof window !== "undefined") {
  const local = window.localStorage;
  const knownVersions = new Map();
  const WORKER_SCOPED_STORAGE_KEYS = new Set([
    "wilarcon_trabajos_records",
    "wilarcon_asistencia_registros",
    "wilarcon_viaticos_records",
    "wilarcon_gastos_records",
    "wilarcon_responsabilidades_records",
    "torre_ops_data",
  ]);

  const remoteGet = async (key) => {
    let res;
    try {
      res = await fetch(`/api/storage?key=${encodeURIComponent(key)}`, { credentials: "include" });
    } catch (e) {
      throw new Error(`NETWORK:${e?.message || "sin conexion"}`);
    }
    if (res.status === 404) throw new Error("Storage key not found: " + key);
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new Error(`AUTH:${res.status}`);
      throw new Error(`storage get failed (${res.status}) for ${key}`);
    }
    const data = await res.json();
    if (data.version !== undefined) knownVersions.set(key, data.version);
    return data;
  };

  const remoteSet = async (key, value, expectedVersion, intent) => {
    const stringValue = String(value);
    const ifVersion = expectedVersion !== undefined ? expectedVersion : knownVersions.get(key);
    let res;
    try {
      res = await fetch("/api/storage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ key, value: stringValue, ifVersion, intent }),
      });
    } catch (e) {
      throw new Error(`NETWORK:${e?.message || "sin conexion"}`);
    }
    if (res.status === 409) {
      const current = await res.json().catch(() => ({}));
      if (current.version !== undefined) knownVersions.set(key, current.version);
      const err = new Error(`CONFLICT: "${key}" fue modificado por otro usuario mientras editabas; tu cambio no se guardo`);
      err.conflict = true;
      err.serverValue = current.value;
      throw err;
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new Error(`AUTH:${res.status}`);
      throw new Error(`storage set failed (${res.status}) for ${key}`);
    }
    const data = await res.json();
    if (data.version !== undefined) knownVersions.set(key, data.version);
    return data;
  };

  window.storage = {
    async get(key) {
      try {
        const result = await remoteGet(key);
        if (key !== "wilarcon_cuentas_records" && !WORKER_SCOPED_STORAGE_KEYS.has(key)) { try { local.setItem(key, String(result.value)); } catch (_) { console.error(_); } }
        return result;
      } catch (error) {
        if (String(error.message).startsWith("AUTH:") || String(error.message).includes("not found")) throw error;
        if (WORKER_SCOPED_STORAGE_KEYS.has(key)) throw error;
        const cached = local.getItem(key);
        if (cached !== null) {
          console.warn(`[storage] servidor no disponible, usando copia local en cache para "${key}"`, error);
          return { value: cached };
        }
        throw error;
      }
    },
    async set(key, value, opts) {
      const expectedVersion = (opts && typeof opts === "object" && Object.prototype.hasOwnProperty.call(opts, "ifVersion"))
        ? opts.ifVersion
        : undefined;
      const intent = (opts && typeof opts === "object" && Object.prototype.hasOwnProperty.call(opts, "intent"))
        ? opts.intent
        : undefined;
      try {
        const result = await remoteSet(key, value, expectedVersion, intent);
        if (key !== "wilarcon_cuentas_records" && !WORKER_SCOPED_STORAGE_KEYS.has(key))
          { try { local.setItem(key, String(value)); } catch (_) { console.error(_); } }
        return result;
      } catch (error) {
        // Nunca simular un guardado exitoso si el servidor no confirmó la escritura.
        // El cache local solo se actualiza después de una respuesta exitosa del backend.
        console.error(`[storage] no se pudo guardar "${key}" en el servidor`, error);
        throw error;
      }
    },
    getVersion(key) {
      return knownVersions.get(key);
    },
  };
}
const APP_VERSION = "3.6.55";
async function storageJSON(key, fallback) {
  try {
    const res = await window.storage.get(key, true);
    const parsed = JSON.parse(res.value);
    return parsed ?? fallback;
  } catch (error) {
    // Una clave inexistente equivale a una colección vacía/valor inicial.
    // Errores de red, autenticación, permisos o servidor deben propagarse para
    // que la interfaz pueda informar que los datos no pudieron cargarse.
    const msg = String(error?.message || error || "");
    if (msg.includes("Storage key not found")) return fallback;
    throw error;
  }
}
async function mutateStorageJSON(key, fallback, mutateFn, maxRetries = 4, intent) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const current = await storageJSON(key, fallback);
    const next = await mutateFn(current);
    if (next === undefined) return current;
    try {
      await window.storage.set(key, JSON.stringify(next), { intent });
      return next;
    } catch (e) {
      if (e && e.conflict && attempt < maxRetries) continue;
      throw e;
    }
  }
}
// Mueve el valor guardado bajo `oldName` a la llave `newName` en un mapa objeto {nombre: valor}
// (usado por sueldos/monto de planilla/descuentos-bonos, que se guardan por nombre de
// trabajador). Si ya existe un valor bajo `newName`, se conserva ese y se descarta el de
// `oldName` en vez de sobreescribir, para no perder un dato ya configurado a propósito.
async function renombrarClaveEnMapa(storageKey, oldName, newName) {
  return mutateStorageJSON(
    storageKey,
    {},
    (current) => {
      const obj = current && typeof current === "object" ? current : {};
      const oldKey = Object.keys(obj).find((k) => normalizePersonKey(k) === normalizePersonKey(oldName));
      if (oldKey === undefined) return undefined;
      const resto = { ...obj };
      const valor = resto[oldKey];
      delete resto[oldKey];
      if (Object.prototype.hasOwnProperty.call(resto, newName)) return resto;
      resto[newName] = valor;
      return resto;
    },
    4,
    "editar"
  );
}
function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}
function normalizePersonKey(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}
// Reemplaza un nombre dentro de un campo de texto libre que puede contener varios nombres
// separados por coma/punto y coma/salto de línea (ej. "personalAsignado" en Trabajos).
// Si el nombre no aparece, devuelve el valor original sin tocar (misma referencia).
function reemplazarNombreEnListaDelimitada(valor, oldName, newName) {
  const partes = String(valor || "").split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  if (!partes.length) return valor;
  let changed = false;
  const siguientes = partes.map((p) => {
    if (normalizePersonKey(p) === normalizePersonKey(oldName)) { changed = true; return newName; }
    return p;
  });
  return changed ? siguientes.join(", ") : valor;
}
function canonicalPersonName(value, people = []) {
  const raw = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!raw) return "";
  const key = normalizePersonKey(raw);
  return (people || []).find((p) => normalizePersonKey(p) === key) || raw;
}
function canonicalizePeople(people = []) {
  const out = []; const seen = new Set();
  (people || []).forEach((p) => {
    const raw = String(p ?? "").trim().replace(/\s+/g, " ");
    const key = normalizePersonKey(raw);
    if (!key || seen.has(key)) return;
    seen.add(key); out.push(raw);
  });
  return out.sort((a,b) => a.localeCompare(b, "es", { sensitivity: "base" }));
}
function canonicalizeWorkerRecords(records = [], workers = []) {
  return (records || []).map((r) => ({ ...r, trabajador: canonicalPersonName(r?.trabajador, workers) }));
}
function canonicalizeWorkerSalaryMap(sueldos = {}, workers = []) {
  const out = {};
  Object.entries(sueldos || {}).forEach(([name, value]) => {
    const canonical = canonicalPersonName(name, workers) || name;
    const previous = Number(out[canonical]) || 0;
    out[canonical] = Math.max(previous, Number(value) || 0);
  });
  return out;
}


const SYNC_STATES = {
  ok:          { color: "green",   label: "Sincronizado" },
  pendiente:   { color: "pending", label: "Guardando..." },
  conflicto:   { color: "conflict",label: "Conflicto: otro usuario guardó un cambio al mismo tiempo" },
  sinConexion: { color: "blue",    label: "Sin conexión: usando copia local hasta reconectar" },
  sinPermisos: { color: "red",     label: "Sin permisos para guardar este cambio" },
  error:       { color: "red",     label: "No se pudo guardar; revisa e inténtalo de nuevo" },
};
function classifySyncError(error) {
  if (error && error.conflict) return "conflicto";
  const msg = String(error && error.message || "");
  if (msg.startsWith("AUTH:")) return "sinPermisos";
  if (msg.startsWith("NETWORK:")) return "sinConexion";
  return "error";
}
function SyncDot({ syncState, palette }) {
  const meta = SYNC_STATES[syncState] || SYNC_STATES.pendiente;
  const color = palette[meta.color] || palette.amber;
  return (
    <span
      title={meta.label}
      style={{ display: "inline-block", width: 7, height: 7, borderRadius: 50, background: color, boxShadow: `0 0 6px ${color}` }}
    />
  );
}

// Barra de filtros compartida por todas las páginas con listado (Trabajos, Gastos,
// Viáticos, Caja Chica, Asistencia, Responsabilidades, Cotización, Contactos, Informes).
// Antes cada página repetía este mismo contenedor con estilo inline; ahora es un solo lugar.
function FilterBar({ children, style, marginBottom = 14 }) {
  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "12px 16px", marginBottom, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", ...style }}>
      {children}
    </div>
  );
}

// Botón "Limpiar filtros" compartido, con el mismo diseño (borde/texto gris) en toda la app.
function ClearFiltersButton({ onClick, title, children = "Limpiar filtros", style }) {
  return (
    <button onClick={onClick} title={title} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, padding: "8px 12px", borderRadius: 7, fontSize: 11.5, cursor: "pointer", ...style }}>
      {children}
    </button>
  );
}

// Visor del PDF ya generado (no la vista previa en HTML): recibe el jsPDF ya construido,
// lo muestra embebido en un iframe a partir de un blob URL, y ofrece descargarlo, abrirlo
// para imprimir en una pestaña nueva, o cerrarlo sin descargar. Compartido por Cotización
// e Informes (y cualquier otra página que genere PDFs con jsPDF).
function PdfViewerModal({ pdf, onClose }) {
  if (!pdf) return null;
  const { url, fileName, doc } = pdf;

  function descargar() {
    try { doc.save(fileName); } catch (e) { console.error(e); alert("No se pudo descargar el PDF."); }
  }

  function abrirEnPestana() {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 18 }}
      onClick={onClose}
    >
      <div
        style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, width: "min(920px, 100%)", height: "min(92vh, 1100px)", display: "flex", flexDirection: "column", overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: `1px solid ${COLORS.border}`, gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={abrirEnPestana} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
              Abrir en pestaña
            </button>
            <button onClick={descargar} style={{ background: COLORS.amber, color: COLORS.amberText, border: "none", borderRadius: 7, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              Descargar
            </button>
            <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
              Cerrar
            </button>
          </div>
        </div>
        <iframe title={fileName} src={url} style={{ flex: 1, border: "none", background: "#525659" }} />
      </div>
    </div>
  );
}

import LOGO_SHIELD from "./assets/logo-shield.png";
import LOGO_LAUREATE from "./assets/logo-laureate.png";

const COLORS = {
  bg: "#0a0e15", panel: "#121821", panel2: "#19212c", border: "#262f3d",
  grid: "#1f2733", text: "#eef2f8", dim: "#95a2b5", faint: "#6d7889",
  amber: "#5eb1ff", amberDim: "#16324f", amberText: "#030c16", amberDeep: "#3d8fe0", green: "#3ddc97", greenDim: "#123c2c",
  red: "#ff5c66", redDim: "#3d151a", slate: "#9aa5b5", blue: "#5eb1ff",
  purple: "#a78bfa", purpleDim: "#291f47",
  pending: "#f2c94c", conflict: "#f2994a",
  // Tokens de texto/acento compartidos por todas las páginas (antes hardcodeados por archivo)
  white: "#ffffff", dark: "#12161c",
  greenSoft: "#8ff0bf", redSoft: "#ff9c8a", blueSoft: "#bcd9ee",
  greenTextDark: "#0e2a1c", borderHover: "#465567",
  overlayDark: "rgba(0,0,0,.6)",
};

const CONTACTO_PALETTE = ["#f2a73b", "#5eb1ff", "#3ddc97", "#ff6b5e", "#a78bfa", "#f26fa0", "#4dd0d6", "#e0c34d", "#7fd66a", "#e08fe0"];

const STORAGE_KEY_RECORDS = "wilarcon_trabajos_records";
const STORAGE_KEY_META = "wilarcon_trabajos_meta";
const DOCS_KEY_PREFIX = "wilarcon_trabajos_docs_";
const STORAGE_KEY_KPI_LABELS = "wilarcon_trabajos_kpi_labels";
const STORAGE_KEY_HISTORY = "wilarcon_trabajos_history";
const MAX_HISTORY = 150;
const DIAS_URGENTE = 30;

const DEFAULT_KPI_LABELS = {
  montoTotalOC: "Monto total OC",
  pendienteCobro: "Pendiente de cobro",
  informesPendientes: "Informes pendientes",
  actasPendientes: "Actas pendientes",
  facturasPendientes: "Facturas pendientes",
  totalOC: "Total OC",
};
const MAX_FILE_BYTES = 4 * 1024 * 1024;

const FIELD_DEFS = [
  { key: "oc", label: "N\u00b0 OC", type: "text" },
  { key: "cliente", label: "Cliente / Empresa", type: "text" },
  { key: "proyecto", label: "Proyecto / Servicio", type: "text" },
  { key: "responsable", label: "Responsable", type: "text" },
  { key: "personalAsignado", label: "Personal asignado", type: "text", full: true },
  { key: "proveedor", label: "Proveedor", type: "text" },
  { key: "estadoOC", label: "Estado OC", type: "select", options: ["", "PENDIENTE", "EN EJECUCION", "COMPLETADA", "CERRADA", "CANCELADA"] },
  { key: "prioridad", label: "Prioridad", type: "select", options: ["", "BAJA", "MEDIA", "ALTA", "CRITICA"] },
  { key: "contacto", label: "Contacto", type: "text" },
  { key: "emision", label: "Emision", type: "date" },
  { key: "fechaInicio", label: "Inicio programado", type: "date" },
  { key: "fechaEntrega", label: "Entrega programada", type: "date" },
  { key: "fechaFinReal", label: "Cierre real", type: "date" },
  { key: "ubicacion", label: "Ubicacion", type: "text" },
  { key: "descripcion", label: "Descripcion", type: "textarea", full: true },
  { key: "observacion", label: "Observacion", type: "text", full: true },
  { key: "avance", label: "Avance (%)", type: "number", step: "1" },
  { key: "subtotal", label: "Subtotal (S/)", type: "number" },
  { key: "igv", label: "IGV (18%, S/)", type: "number", readOnly: true },
  { key: "total", label: "Total (S/)", type: "number", readOnly: true },
  { key: "costoMateriales", label: "Costo materiales (S/)", type: "number" },
  { key: "costoPersonal", label: "Costo personal (S/)", type: "number" },
  { key: "costoTransporte", label: "Costo transporte (S/)", type: "number" },
  { key: "costoViaticos", label: "Costo viaticos (S/)", type: "number" },
  { key: "otrosCostos", label: "Otros costos (S/)", type: "number" },
  { key: "nInforme", label: "N\u00b0 Informe", type: "text" },
  { key: "anexoInforme", label: "Link Informe (Drive)", type: "text", noUppercase: true },
  { key: "estadoInforme", label: "Estado Informe (auto)", type: "select", options: ["", "LISTO", "PENDIENTE"], readOnly: true },
  { key: "nAC", label: "N\u00b0 AC", type: "text" },
  { key: "anexoAC", label: "Link AC (Drive)", type: "text", noUppercase: true },
  { key: "estadoAC", label: "Estado AC (auto)", type: "select", options: ["", "LISTO", "PENDIENTE"], readOnly: true },
  { key: "nFactura", label: "N\u00b0 Factura", type: "text" },
  { key: "anexoFactura", label: "Link Factura (Drive)", type: "text", noUppercase: true },
  { key: "estadoFactura", label: "Estado Factura (auto)", type: "select", options: ["", "APROBADA", "PENDIENTE"], readOnly: true },
  { key: "fechaPago", label: "Fecha de pago", type: "date" },
  { key: "medioPago", label: "Medio de pago", type: "select", options: ["", "PAGADO", "FACTORING", "PENDIENTE"] },
];

function emptyDraft() {
  const d = {};
  FIELD_DEFS.forEach((f) => { d[f.key] = f.type === "number" ? "" : ""; });
  return d;
}

function hasLink(v) {
  return v !== null && v !== undefined && v.toString().trim() !== "";
}

function computeAutoEstados(rec) {
  const costs = ["costoMateriales", "costoPersonal", "costoTransporte", "costoViaticos", "otrosCostos"]
    .reduce((s, k) => s + (Number(rec[k]) || 0), 0);
  const total = Number(rec.total) || 0;
  const hasCostBreakdown = ["costoMateriales", "costoPersonal", "costoTransporte", "costoViaticos", "otrosCostos"].some((k) => rec[k] !== "" && rec[k] !== null && rec[k] !== undefined);
  const rentabilidadCalculada = hasCostBreakdown ? total - costs : (Number.isFinite(Number(rec.rentabilidad)) ? Number(rec.rentabilidad) : null);
  const costoFinal = hasCostBreakdown ? costs : (rentabilidadCalculada === null ? null : total - rentabilidadCalculada);
  const pctCalculado = total > 0 && rentabilidadCalculada !== null ? rentabilidadCalculada / total : (Number.isFinite(Number(rec.pctRentabilidad)) ? Number(rec.pctRentabilidad) : null);
  const avance = rec.avance === "" || rec.avance == null ? "" : Math.max(0, Math.min(100, Number(rec.avance) || 0));
  // Cierre real (fechaFinReal): solo se completa por dos vías —
  // 1) el usuario lo edita a mano (ver EditForm: fechaFinRealAuto = false, se
  //    congela y ya no se toca aquí), o
  // 2) se carga el link del Informe: se fija a la fecha de hoy (fecha de la
  //    "subida" del informe) y también se congela.
  // Ya NO se autocompleta con Emisión. Mientras ninguna de las dos pase,
  // queda en blanco.
  const informeListo = hasLink(rec.anexoInforme);
  let fechaFinReal = rec.fechaFinReal || "";
  let fechaFinRealAuto = rec.fechaFinRealAuto !== false;
  if (fechaFinRealAuto && informeListo) {
    fechaFinReal = new Date().toISOString().slice(0, 10);
    fechaFinRealAuto = false;
  }
  return {
    ...rec,
    avance,
    costoTotal: costoFinal,
    rentabilidadCalculada,
    pctRentabilidadCalculada: pctCalculado,
    estadoInforme: informeListo ? "LISTO" : "PENDIENTE",
    estadoAC: hasLink(rec.anexoAC) ? "LISTO" : "PENDIENTE",
    estadoFactura: hasLink(rec.anexoFactura) ? "APROBADA" : "PENDIENTE",
    fechaFinReal,
    fechaFinRealAuto,
  };
}

function fmtMoney(v) {
  if (v === null || v === undefined || v === "") return "\u2014";
  const n = Number(v);
  if (Number.isNaN(n)) return "\u2014";
  return "S/ " + n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtMoneyCompact(v) {
  if (v === null || v === undefined || v === "") return "\u2014";
  const n = Number(v);
  if (Number.isNaN(n)) return "\u2014";
  if (Math.abs(n) >= 1000) {
    return "S/ " + (n / 1000).toLocaleString("es-PE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "k";
  }
  return "S/ " + n.toLocaleString("es-PE", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtPct(v) {
  if (v === null || v === undefined || v === "") return "\u2014";
  const n = Number(v);
  if (Number.isNaN(n)) return "\u2014";
  return (n * 100).toFixed(1) + "%";
}
function fmtDate(d) {
  if (!d) return "\u2014";
  const parts = String(d).split("-");
  if (parts.length !== 3) return d;
  const [y, m, day] = parts;
  return `${day}/${m}/${y}`;
}
function fmtDateTime(ts) {
  if (!ts) return "\u2014";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "\u2014";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
function isUrgente(rec) {
  const pendiente = normEstado(rec.estadoInforme) !== "LISTO" || normEstado(rec.estadoAC) !== "LISTO" || normEstado(rec.estadoFactura) === "PENDIENTE";
  if (!pendiente) return false;
  const dias = daysSince(rec.emision);
  return dias !== null && dias > DIAS_URGENTE;
}
function monthLabel(ym) {
  const [y, m] = ym.split("-");
  const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];
  return `${meses[Number(m) - 1] || m} ${y}`;
}
function groupByMonth(data) {
  const map = new Map();
  data.forEach((d) => {
    if (!d.emision) return;
    const ym = String(d.emision).slice(0, 7);
    if (!map.has(ym)) map.set(ym, { key: ym, label: monthLabel(ym), count: 0, monto: 0 });
    const g = map.get(ym);
    g.count += 1;
    g.monto += Number(d.total) || 0;
  });
  return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}
function groupByField(data, field) {
  const map = new Map();
  data.forEach((d) => {
    const key = d[field] || "Sin dato";
    if (!map.has(key)) map.set(key, { key, label: key, count: 0, monto: 0 });
    const g = map.get(key);
    g.count += 1;
    g.monto += Number(d.total) || 0;
  });
  return [...map.values()].sort((a, b) => b.monto - a.monto);
}
function fmtBytes(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function initials(name) {
  return (name || "?").trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
function colorForContacto(name, list) {
  const idx = list.indexOf(name);
  return CONTACTO_PALETTE[idx % CONTACTO_PALETTE.length] || COLORS.slate;
}
function normEstado(v) {
  return (v || "").trim().toUpperCase();
}
function estadoFacturaColor(v) {
  const n = normEstado(v);
  if (n === "APROBADA") return { bg: COLORS.greenDim, fg: COLORS.greenSoft };
  if (n === "EN PROCESO") return { bg: COLORS.amberDim, fg: COLORS.blueSoft };
  if (n === "PENDIENTE") return { bg: COLORS.redDim, fg: COLORS.redSoft };
  return { bg: COLORS.panel2, fg: COLORS.faint };
}
function medioPagoColor(v) {
  const n = normEstado(v);
  if (n === "PAGADO") return { bg: COLORS.greenDim, fg: COLORS.greenSoft };
  if (n === "FACTORING") return { bg: COLORS.purpleDim, fg: "#d8bfff" };
  if (n === "PENDIENTE") return { bg: COLORS.redDim, fg: COLORS.redSoft };
  return { bg: COLORS.panel2, fg: COLORS.faint };
}
function docEstadoColor(v) {
  const n = normEstado(v);
  if (n === "LISTO") return { bg: COLORS.greenDim, fg: COLORS.greenSoft };
  if (!v) return { bg: COLORS.panel2, fg: COLORS.faint };
  return { bg: COLORS.amberDim, fg: COLORS.blueSoft };
}
function gastoEstadoColor(v) {
  const n = normEstado(v);
  if (n === "FACTURA") return { bg: COLORS.greenDim, fg: COLORS.greenSoft };
  if (n === "EMITIDO") return { bg: COLORS.amberDim, fg: COLORS.blueSoft };
  if (n === "PENDIENTE") return { bg: COLORS.redDim, fg: COLORS.redSoft };
  return { bg: COLORS.panel2, fg: COLORS.faint };
}
function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
async function buildXlsxSheet(records, headers, rowMapper, XLSX) {
  const list = Array.isArray(records) ? records : [];
  const cols = headers;
  const rows = list.map(rowMapper);
  const aoa = list.length ? [cols, ...rows] : [cols, ["(sin registros)"]];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = cols.map((c, i) => {
    const maxLen = aoa.reduce((m, r) => Math.max(m, String(r[i] ?? "").length), String(c).length);
    return { wch: Math.min(Math.max(maxLen + 2, 10), 45) };
  });
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(cols.length - 1, 0) } }) };
  return ws;
}
async function downloadXlsxWorkbook(sheets, filenamePrefix) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const { name, records, headers, rowMapper } of sheets) {
    XLSX.utils.book_append_sheet(wb, await buildXlsxSheet(records, headers, rowMapper, XLSX), name);
  }
  const fecha = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `operaciones-${filenamePrefix}-${fecha}.xlsx`);
}
function celdaRespaldo(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}
// Construye un Excel con una hoja por cada clave del respaldo (torre_ops_data,
// wilarcon_trabajos_records, etc.). Cada clave puede tener una forma distinta, así que
// las columnas se detectan automáticamente en vez de venir fijas como en
// buildXlsxSheet: si el valor es una lista de objetos, la hoja tiene una columna por
// cada campo que aparezca en al menos un registro; si es un objeto suelto (ej.
// torre_ops_data), se vuelca como una tabla de 2 columnas (campo/valor).
async function buildRespaldoXlsx(anio, datosPorClave) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const nombresUsados = new Set();
  for (const clave of Object.keys(datosPorClave || {})) {
    const valor = datosPorClave[clave];
    let ws;
    if (Array.isArray(valor)) {
      const cols = Array.from(valor.reduce((set, item) => {
        if (item && typeof item === "object" && !Array.isArray(item)) Object.keys(item).forEach((k) => set.add(k));
        return set;
      }, new Set()));
      if (!cols.length) cols.push("valor");
      const filas = valor.map((item) => cols.map((c) => (item && typeof item === "object" ? celdaRespaldo(item[c]) : (c === "valor" ? celdaRespaldo(item) : ""))));
      ws = XLSX.utils.aoa_to_sheet(filas.length ? [cols, ...filas] : [cols, ["(sin registros)"]]);
    } else if (valor && typeof valor === "object") {
      const entradas = Object.entries(valor);
      ws = XLSX.utils.aoa_to_sheet([["campo", "valor"], ...entradas.map(([k, v]) => [k, celdaRespaldo(v)])]);
    } else {
      ws = XLSX.utils.aoa_to_sheet([["valor"], [celdaRespaldo(valor)]]);
    }
    let nombreHoja = clave.replace(/[\\/?*[\]:]/g, "").slice(0, 31) || "hoja";
    let sufijo = 2;
    while (nombresUsados.has(nombreHoja)) { nombreHoja = `${clave.slice(0, 28)}_${sufijo++}`; }
    nombresUsados.add(nombreHoja);
    XLSX.utils.book_append_sheet(wb, ws, nombreHoja);
  }
  XLSX.writeFile(wb, `respaldo-wilarcon-${anio}.xlsx`);
}
async function readXlsxRows(file) {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(ws, { defval: "", raw: true });
}

// ===== Guardado automático en carpeta local (File System Access API) =====
// Cada página puede recordar una carpeta del computador del usuario donde se
// sobrescribe siempre el mismo archivo Excel con los datos vigentes de esa página.
// Solo funciona en navegadores basados en Chromium (Chrome/Edge de escritorio);
// la carpeta elegida vive únicamente en ese navegador/computador (no se sincroniza
// entre usuarios ni dispositivos, es una copia local además del guardado en la
// base de datos compartida).
const CARPETA_LOCAL_DB = "wilarcon_carpetas_locales";
const CARPETA_LOCAL_STORE = "carpetas";
function abrirCarpetaLocalDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CARPETA_LOCAL_DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(CARPETA_LOCAL_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function guardarHandleCarpetaLocal(moduleKey, handle) {
  const db = await abrirCarpetaLocalDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CARPETA_LOCAL_STORE, "readwrite");
    tx.objectStore(CARPETA_LOCAL_STORE).put(handle, moduleKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function leerHandleCarpetaLocal(moduleKey) {
  const db = await abrirCarpetaLocalDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CARPETA_LOCAL_STORE, "readonly");
    const req = tx.objectStore(CARPETA_LOCAL_STORE).get(moduleKey);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function borrarHandleCarpetaLocal(moduleKey) {
  const db = await abrirCarpetaLocalDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CARPETA_LOCAL_STORE, "readwrite");
    tx.objectStore(CARPETA_LOCAL_STORE).delete(moduleKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function guardarWorkbookEnCarpetaLocal(dirHandle, nombreArchivo, sheets) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const { name, records, headers, rowMapper } of sheets) {
    XLSX.utils.book_append_sheet(wb, await buildXlsxSheet(records, headers, rowMapper, XLSX), name);
  }
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const fileHandle = await dirHandle.getFileHandle(nombreArchivo, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(buf);
  await writable.close();
}
// Guarda una lista de PDFs ya generados (uno por elemento) en la carpeta local elegida,
// sobrescribiendo cada archivo por su propio nombre. A diferencia de
// guardarWorkbookEnCarpetaLocal (que arma un único Excel con todas las filas), aquí cada
// entrada de `archivos` ya trae su nombre de archivo y su contenido (ArrayBuffer) — usado por
// la página de Visita Técnica para guardar el PDF de cada visita en vez de un resumen en Excel.
async function guardarPdfsEnCarpetaLocal(dirHandle, archivos) {
  for (const { nombre, arrayBuffer } of archivos || []) {
    if (!nombre || !arrayBuffer) continue;
    const fileHandle = await dirHandle.getFileHandle(nombre, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(arrayBuffer);
    await writable.close();
  }
}
// Nombre de archivo con el año actual al final (ej. "operaciones-gastos" ->
// "operaciones-gastos-2026.xlsx"), para que el guardado automático en carpeta local
// de cada página no sobrescriba el Excel del año anterior: en enero simplemente
// empieza a escribir un archivo nuevo, y el del año que cerró queda intacto.
function nombreArchivoAnual(base) {
  return `${base}-${new Date().getFullYear()}.xlsx`;
}
// Hook reutilizable: cada página lo llama con una clave propia (moduleKey) y obtiene
// controles para elegir/recordar una carpeta y guardar (o programar el guardado
// con un pequeño debounce) el Excel de esa página en ella.
function useCarpetaLocal(moduleKey) {
  const soportado = typeof window !== "undefined" && typeof window.showDirectoryPicker === "function" && typeof window.indexedDB !== "undefined";
  const [estado, setEstado] = useState(soportado ? "cargando" : "no-soportado");
  const [nombreCarpeta, setNombreCarpeta] = useState("");
  const dirHandleRef = useRef(null);
  const estadoRef = useRef(estado);
  const saveTimerRef = useRef(null);
  useEffect(() => { estadoRef.current = estado; }, [estado]);

  useEffect(() => {
    if (!soportado) return;
    let cancelado = false;
    (async () => {
      try {
        const handle = await leerHandleCarpetaLocal(moduleKey);
        if (cancelado) return;
        if (!handle) { setEstado("sin-conectar"); return; }
        dirHandleRef.current = handle;
        setNombreCarpeta(handle.name);
        const permiso = await handle.queryPermission({ mode: "readwrite" });
        if (cancelado) return;
        setEstado(permiso === "granted" ? "conectada" : "permiso-pendiente");
      } catch (e) {
        console.error("[carpeta local] error al restaurar carpeta", e);
        if (!cancelado) setEstado("sin-conectar");
      }
    })();
    return () => { cancelado = true; };
  }, [moduleKey, soportado]);

  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

  async function elegirCarpeta() {
    if (!soportado) return;
    try {
      const handle = await window.showDirectoryPicker({ id: moduleKey, mode: "readwrite" });
      dirHandleRef.current = handle;
      setNombreCarpeta(handle.name);
      await guardarHandleCarpetaLocal(moduleKey, handle);
      setEstado("conectada");
    } catch (e) {
      if (e && e.name === "AbortError") return;
      console.error("[carpeta local] error al elegir carpeta", e);
      alert("No se pudo conectar la carpeta. Intenta de nuevo.");
    }
  }

  async function reconectar() {
    if (!dirHandleRef.current) return elegirCarpeta();
    try {
      const permiso = await dirHandleRef.current.requestPermission({ mode: "readwrite" });
      setEstado(permiso === "granted" ? "conectada" : "permiso-pendiente");
    } catch (e) {
      console.error("[carpeta local] error al reconectar", e);
    }
  }

  async function desconectar() {
    dirHandleRef.current = null;
    setNombreCarpeta("");
    setEstado("sin-conectar");
    try { await borrarHandleCarpetaLocal(moduleKey); } catch (e) { console.error("[carpeta local] error al olvidar carpeta", e); }
  }

  // `tipo` = "xlsx" (por defecto, `payload` son las hojas para guardarWorkbookEnCarpetaLocal)
  // o "pdfs" (`payload` es la lista de { nombre, arrayBuffer } para guardarPdfsEnCarpetaLocal).
  async function guardarAhora(nombreArchivo, payload, tipo = "xlsx") {
    if (!dirHandleRef.current || estadoRef.current === "permiso-pendiente" || estadoRef.current === "no-soportado") return;
    setEstado("guardando");
    try {
      if (tipo === "pdfs") {
        await guardarPdfsEnCarpetaLocal(dirHandleRef.current, payload);
      } else {
        await guardarWorkbookEnCarpetaLocal(dirHandleRef.current, nombreArchivo, payload);
      }
      setEstado("conectada");
    } catch (e) {
      console.error("[carpeta local] error al guardar", e);
      setEstado(e && (e.name === "NotAllowedError" || e.name === "NotFoundError") ? "permiso-pendiente" : "error");
    }
  }

  // `builder` puede ser síncrono (devuelve las hojas, caso "xlsx") o asíncrono (devuelve la
  // lista de PDFs, caso "pdfs"): en ambos casos se espera su resultado antes de guardar.
  function programarGuardado(nombreArchivo, builder, delay = 1200, tipo = "xlsx") {
    if (!dirHandleRef.current || estadoRef.current === "permiso-pendiente" || estadoRef.current === "no-soportado" || estadoRef.current === "cargando") return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        const payload = await builder();
        guardarAhora(nombreArchivo, payload, tipo);
      } catch (e) {
        console.error("[carpeta local] error al preparar el guardado", e);
      }
    }, delay);
  }

  return { soportado, estado, nombreCarpeta, elegirCarpeta, reconectar, desconectar, guardarAhora, programarGuardado };
}
const CARPETA_LOCAL_LABELS = {
  "permiso-pendiente": { texto: "Permiso vencido — click para reconectar", color: "amber" },
  conectada: { texto: "Copia local sincronizada", color: "green" },
  guardando: { texto: "Guardando copia local…", color: "pending" },
  error: { texto: "Error al guardar — click para reintentar", color: "red" },
};
// Botón/indicador compartido por todas las páginas para elegir y mostrar el estado
// de la carpeta local. `carpeta` es el objeto devuelto por useCarpetaLocal(...).
// `formato` ajusta el texto del tooltip: "xlsx" (por defecto, un Excel con todas las filas)
// o "pdf" (un PDF por cada elemento, ej. Visita Técnica).
function BotonCarpetaLocal({ carpeta, formato = "xlsx" }) {
  const { soportado, estado, nombreCarpeta, elegirCarpeta, reconectar, desconectar } = carpeta;
  const descArchivo = formato === "pdf" ? "los PDF de cada registro, actualizados" : "un Excel actualizado";
  if (!soportado) {
    return (
      <span title="Guardar una copia local requiere Chrome o Edge de escritorio" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: COLORS.faint, padding: "7px 10px" }}>
        📁 Copia local no disponible en este navegador
      </span>
    );
  }
  if (estado === "cargando") {
    return <span style={{ fontSize: 11.5, color: COLORS.dim, padding: "7px 10px" }}>📁 Verificando carpeta…</span>;
  }
  if (estado === "sin-conectar") {
    return (
      <button
        onClick={elegirCarpeta}
        title={`Elige una carpeta de tu computadora: cada cambio en esta página guardará ahí ${descArchivo}`}
        style={{ display: "flex", alignItems: "center", gap: 6, background: COLORS.panel2, color: COLORS.text, fontSize: 12, padding: "7px 12px", borderRadius: 7, border: `1px dashed ${COLORS.border}`, cursor: "pointer" }}
      >
        📁 Guardar copia en carpeta…
      </button>
    );
  }
  const meta = CARPETA_LOCAL_LABELS[estado] || CARPETA_LOCAL_LABELS.conectada;
  const color = COLORS[meta.color] || COLORS.dim;
  const clickable = estado === "permiso-pendiente" || estado === "error";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 7, padding: "6px 6px 6px 10px", fontSize: 11.5 }}>
      <span
        onClick={clickable ? reconectar : undefined}
        title={nombreCarpeta}
        style={{ display: "flex", alignItems: "center", gap: 6, cursor: clickable ? "pointer" : "default", color, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 50, background: color, flexShrink: 0 }} />
        📁 {nombreCarpeta || "carpeta"} · {meta.texto}
      </span>
      <button onClick={desconectar} title="Dejar de guardar copia en esta carpeta" style={{ background: "none", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 13, padding: "2px 4px", lineHeight: 1 }}>✕</button>
    </div>
  );
}
function normalizeFechaImportada(value) {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  return s;
}
function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
function isInteractiveTarget(el) {
  const tag = el && el.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "OPTION" || tag === "BUTTON" || tag === "LABEL" || tag === "TEXTAREA" || tag === "A";
}
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
function isImageType(type) {
  return (type || "").startsWith("image/");
}

function moveInArray(arr, fromIndex, toIndex) {
  const copy = arr.slice();
  const [item] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, item);
  return copy;
}

function reorderWithinFull(fullList, visibleList, fromVisibleIndex, toVisibleIndex, idKey = "id") {
  if (fromVisibleIndex === toVisibleIndex || fromVisibleIndex == null || toVisibleIndex == null) return fullList;
  const reorderedVisible = moveInArray(visibleList, fromVisibleIndex, toVisibleIndex);
  const visibleIds = new Set(visibleList.map((it) => it[idKey]));
  let vi = 0;
  return fullList.map((item) => (visibleIds.has(item[idKey]) ? reorderedVisible[vi++] : item));
}

// En celular el teclado virtual tapa el campo que se está editando (el navegador no siempre
// hace scroll solo, sobre todo si el teclado recién está terminando de abrirse). Se espera un
// instante a que el teclado abra del todo y recién ahí se centra el campo en la pantalla visible.
// Se puede usar directo en un input/textarea (onFocus={scrollFieldIntoViewOnFocus}) o una sola
// vez en el contenedor del formulario/modal: como el foco burbujea, atrapa el foco de cualquier
// campo hijo sin tener que repetirlo en cada uno.
function scrollFieldIntoViewOnFocus(e) {
  const el = e.target;
  if (!el || typeof el.scrollIntoView !== "function") return;
  const tag = (el.tagName || "").toLowerCase();
  if (tag !== "input" && tag !== "textarea" && tag !== "select") return;
  setTimeout(() => {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, 300);
}

// Detecta celular/pantalla angosta por ancho real (no por user-agent), para que cualquier
// pantalla pueda adaptar su layout (menú de navegación, formularios, etc.) a un dedo en vez
// de un mouse. Compartido por AppShell y por las páginas que necesiten el mismo criterio.
function useIsMobile(breakpoint = 760) {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= breakpoint
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = (e) => setIsMobile(e.matches);
    handler(mql);
    if (mql.addEventListener) mql.addEventListener("change", handler);
    else mql.addListener(handler);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", handler);
      else mql.removeListener(handler);
    };
  }, [breakpoint]);
  return isMobile;
}

// Autoguardado: mientras `active` es true (hay un formulario de edición abierto),
// guarda automáticamente los cambios pendientes de `draft` cuando el usuario "sale":
// cambia de pestaña del navegador, minimiza/oculta la ventana, o quita el foco de la
// app. No dispara guardados repetidos si no hubo cambios desde el último guardado,
// ni si `isValid` (cuando se pasa) rechaza el borrador actual.
function useAutoSaveOnLeave({ active, draft, saveFn, isValid }) {
  const draftRef = useRef(draft);
  const savedSnapshotRef = useRef(null);
  const savingRef = useRef(false);
  const activeRef = useRef(active);
  draftRef.current = draft;
  const wasActive = activeRef.current;
  activeRef.current = active;
  useEffect(() => {
    // Al abrir un formulario de edición, el borrador inicial cuenta como "ya guardado"
    // (es una copia del registro original), para no disparar un guardado espurio.
    if (active && !wasActive) savedSnapshotRef.current = JSON.stringify(draft);
    if (!active) savedSnapshotRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  useEffect(() => {
    async function trigger() {
      if (!activeRef.current || savingRef.current) return;
      const current = draftRef.current;
      if (current == null) return;
      const snapshot = JSON.stringify(current);
      if (snapshot === savedSnapshotRef.current) return;
      if (typeof isValid === "function" && !isValid(current)) return;
      savingRef.current = true;
      try {
        await saveFn(current);
        savedSnapshotRef.current = snapshot;
      } catch (e) {
        console.error("autoguardado fallido", e);
      } finally {
        savingRef.current = false;
      }
    }
    function onWindowBlur() { trigger(); }
    function onVisibility() { if (document.hidden) trigger(); }
    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveFn, isValid]);
  // Expone una función para forzar el guardado inmediato (ej: al cerrar el modal
  // con "Cancelar" o al hacer clic fuera), reutilizando la misma lógica anti-duplicados.
  async function flush() {
    if (!activeRef.current || savingRef.current) return;
    const current = draftRef.current;
    if (current == null) return;
    const snapshot = JSON.stringify(current);
    if (snapshot === savedSnapshotRef.current) return;
    if (typeof isValid === "function" && !isValid(current)) return;
    savingRef.current = true;
    try {
      await saveFn(current);
      savedSnapshotRef.current = snapshot;
    } catch (e) {
      console.error("autoguardado fallido", e);
    } finally {
      savingRef.current = false;
    }
  }
  return flush;
}

// Autoguardado continuo mientras se edita: a diferencia de useAutoSaveOnLeave (que solo guarda
// al salir/perder foco de la ventana), este dispara saveFn poco después de que el usuario deja
// de escribir (debounce), y ADEMÁS guarda de inmediato si cambia de pestaña/oculta la ventana o
// se llama a flush() a mano (p.ej. antes de navegar). Se usa para reemplazar botones de "Guardar"
// explícitos por guardado 100% automático.
function useAutoSaveDebounced({ active, draft, saveFn, delayMs = 1500, isValid }) {
  const draftRef = useRef(draft);
  const savedSnapshotRef = useRef(null);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const activeRef = useRef(active);
  const timerRef = useRef(null);
  draftRef.current = draft;
  const wasActive = activeRef.current;
  activeRef.current = active;

  useEffect(() => {
    // Al abrir el editor, el borrador inicial cuenta como "ya guardado" (evita un
    // guardado espurio apenas se monta el formulario).
    if (active && !wasActive) savedSnapshotRef.current = JSON.stringify(draft);
    if (!active) {
      savedSnapshotRef.current = null;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  async function runSave() {
    if (!activeRef.current || savingRef.current) return;
    const current = draftRef.current;
    if (current == null) return;
    const snapshot = JSON.stringify(current);
    if (snapshot === savedSnapshotRef.current) return;
    if (typeof isValid === "function" && !isValid(current)) return;
    savingRef.current = true;
    try {
      await saveFn(current);
      savedSnapshotRef.current = snapshot;
    } catch (e) {
      console.error("autoguardado fallido", e);
    } finally {
      savingRef.current = false;
      if (pendingRef.current) { pendingRef.current = false; schedule(); }
    }
  }

  function schedule() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { timerRef.current = null; runSave(); }, delayMs);
  }

  useEffect(() => {
    if (!active || draft == null) return;
    if (savingRef.current) { pendingRef.current = true; return; }
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, draft]);

  useEffect(() => {
    function onLeave() {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      runSave();
    }
    function onVisibility() { if (document.hidden) onLeave(); }
    window.addEventListener("blur", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveFn, isValid]);

  async function flush() {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    await runSave();
  }
  return flush;
}

function useRowDrag({ enabled, onReorder, idKey = "id" }) {
  const dragIndexRef = useRef(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [armedIndex, setArmedIndex] = useState(null);

  // El drag-and-drop nativo (arriba) no dispara con el dedo en celular, así que esto da una
  // forma alternativa de reordenar por toque: mover un puesto arriba/abajo con un botón.
  function moveBy(index, delta, length) {
    if (!enabled) return;
    const target = index + delta;
    if (target < 0 || target >= length) return;
    onReorder(index, target);
  }

  function getHandleProps(index) {
    if (!enabled) return {};
    return {
      onMouseDown: (e) => { e.stopPropagation(); setArmedIndex(index); },
      onMouseUp: (e) => { e.stopPropagation(); setArmedIndex(null); },
      onTouchStart: (e) => { e.stopPropagation(); setArmedIndex(index); },
      onTouchEnd: (e) => { e.stopPropagation(); setArmedIndex(null); },
      onClick: (e) => { e.stopPropagation(); },
    };
  }

  function getHandlers(index, item) {
    if (!enabled) return {};
    return {
      draggable: armedIndex === index,
      onDragStart: (e) => {
        dragIndexRef.current = index;
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", String(item[idKey])); } catch (_) { console.error(_); }
      },
      onDragEnter: (e) => {
        e.preventDefault();
        setDragOverId(item[idKey]);
      },
      onDragOver: (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      },
      onDragLeave: () => {
        setDragOverId((cur) => (cur === item[idKey] ? null : cur));
      },
      onDrop: (e) => {
        e.preventDefault();
        const from = dragIndexRef.current;
        setDragOverId(null);
        dragIndexRef.current = null;
        setArmedIndex(null);
        if (from === null || from === undefined || from === index) return;
        onReorder(from, index);
      },
      onDragEnd: () => {
        dragIndexRef.current = null;
        setDragOverId(null);
        setArmedIndex(null);
      },
    };
  }

  return { getHandleProps, getHandlers, dragOverId, armedIndex, moveBy };
}

function DragHandle(
  {
    show,
    color,
    title = "Arrastrar para reordenar",
    dragProps,
    dragging = false,
    // En celular el arrastre nativo no funciona con el dedo: en vez del ícono ⠿ se muestran
    // dos botones (subir/bajar) que hacen lo mismo con un toque.
    isMobile = false,
    onMoveUp,
    onMoveDown,
    canMoveUp = true,
    canMoveDown = true,
  }
) {
  if (!show) return null;
  if (isMobile) {
    const btnStyle = (enabled) => ({
      background: "transparent",
      border: "none",
      color: enabled ? (color || "#8a8f98") : "#4a4f58",
      fontSize: 15,
      lineHeight: 1,
      padding: "6px 5px",
      cursor: enabled ? "pointer" : "default",
      touchAction: "manipulation",
    });
    return (
      <span style={{ display: "inline-flex", flexDirection: "column", flexShrink: 0 }}>
        <button
          type="button"
          title="Subir"
          disabled={!canMoveUp}
          onClick={(e) => { e.stopPropagation(); onMoveUp && onMoveUp(); }}
          style={btnStyle(canMoveUp)}
        >
          ▲
        </button>
        <button
          type="button"
          title="Bajar"
          disabled={!canMoveDown}
          onClick={(e) => { e.stopPropagation(); onMoveDown && onMoveDown(); }}
          style={btnStyle(canMoveDown)}
        >
          ▼
        </button>
      </span>
    );
  }
  return (
    <span
      title={title}
      {...(dragProps || {})}
      style={{ cursor: dragging ? "grabbing" : "grab", color: color || "#8a8f98", fontSize: 14, lineHeight: 1, padding: "0 4px", userSelect: "none", flexShrink: 0, touchAction: "none" }}
    >
      ⠿
    </span>
  );
}
function Badge({ text, colors }) {
  if (!text) return <span style={{ color: COLORS.faint, fontSize: 11.5 }}>—</span>;
  return (
    <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 20, whiteSpace: "nowrap", background: colors.bg, color: colors.fg, fontWeight: 600 }}>
      {text}
    </span>
  );
}

function MultiSelect({ label, allLabel, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const toggle = (v) => {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  };
  let btnText = allLabel;
  if (selected.length === 1) btnText = selected[0];
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 6, height: 34, padding: "0 10px",
          borderRadius: 7, background: COLORS.panel2, border: `1px solid ${open ? COLORS.amber : COLORS.border}`,
          color: open ? COLORS.amber : COLORS.text, fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap",
        }}
      >
        {btnText}
        {selected.length > 1 && (
          <span style={{ background: COLORS.amber, color: COLORS.amberText, fontSize: 10, fontWeight: 700, borderRadius: 10, padding: "1px 6px" }}>
            {selected.length}
          </span>
        )}
        <span style={{ fontSize: 9, color: COLORS.faint }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 30, background: COLORS.panel2,
          border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: 8, minWidth: 200, maxHeight: 260,
          overflowY: "auto", boxShadow: "0 10px 30px rgba(0,0,0,.4)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 6px 8px", marginBottom: 6, borderBottom: `1px solid ${COLORS.border}`, fontSize: 10.5 }}>
            <span style={{ color: COLORS.blue, cursor: "pointer" }} onClick={() => onChange(options)}>Marcar todos</span>
            <span style={{ color: COLORS.blue, cursor: "pointer" }} onClick={() => onChange([])}>Limpiar</span>
          </div>
          {options.map((v) => (
            <label key={v} className={`wc-dd-opt${selected.includes(v) ? " is-selected" : ""}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 6px", borderRadius: 6, cursor: "pointer", fontSize: 12.5 }}>
              <input type="checkbox" checked={selected.includes(v)} onChange={() => toggle(v)} style={{ accentColor: COLORS.amber, cursor: "pointer" }} />
              <span>{v}</span>
            </label>
          ))}
          {options.length === 0 && <div style={{ padding: 6, fontSize: 11.5, color: COLORS.faint }}>Sin opciones</div>}
        </div>
      )}
    </div>
  );
}

function DropdownMultiSelect({ value = [], onChange, options = [], placeholder = "Seleccionar…", disabled = false, buttonClassName = "ct-input2", buttonStyle, wrapperStyle, arrowStyle, panelStyle }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const normalized = useMemo(() => (options || []).map((o) =>
    typeof o === "string" ? { value: o, label: o || "—" } : { value: o.value, label: o.label ?? (o.value || "—") }
  ), [options]);
  useEffect(() => {
    const onDoc = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const toggle = (v) => {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  };
  const selectedLabels = normalized.filter((o) => value.includes(o.value));
  let btnText = placeholder;
  if (selectedLabels.length === 1) btnText = selectedLabels[0].label;
  else if (selectedLabels.length > 1) btnText = `${selectedLabels.length} seleccionados`;
  return (
    <div ref={rootRef} style={{ position: "relative", ...wrapperStyle }}>
      <button
        type="button"
        className={buttonClassName}
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 8, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.7 : 1, whiteSpace: "nowrap", appearance: "none", WebkitAppearance: "none", MozAppearance: "none", ...buttonStyle }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", color: selectedLabels.length ? "inherit" : COLORS.faint }}>{btnText}</span>
        {selectedLabels.length > 1 && (
          <span style={{ background: COLORS.amber, color: COLORS.amberText, fontSize: 10, fontWeight: 700, borderRadius: 10, padding: "1px 6px" }}>
            {selectedLabels.length}
          </span>
        )}
        <span style={{ fontSize: 9, color: COLORS.faint, ...arrowStyle }}>▾</span>
      </button>
      {open && !disabled && (
        <div style={{ position: "absolute", zIndex: 120, top: "calc(100% + 6px)", left: 0, minWidth: 180, maxHeight: 300, overflowY: "auto", background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 9, boxShadow: "0 12px 30px rgba(0,0,0,.4)", padding: 8, ...panelStyle }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 6px 8px", marginBottom: 6, borderBottom: `1px solid ${COLORS.border}`, fontSize: 10.5 }}>
            <span style={{ color: COLORS.blue, cursor: "pointer" }} onClick={() => onChange(normalized.map((o) => o.value))}>Marcar todos</span>
            <span style={{ color: COLORS.blue, cursor: "pointer" }} onClick={() => onChange([])}>Limpiar</span>
          </div>
          {normalized.map((o) => (
            <label key={o.value} className={`wc-dd-opt${value.includes(o.value) ? " is-selected" : ""}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 6px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
              <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} style={{ accentColor: COLORS.amber, cursor: "pointer" }} />
              <span>{o.label}</span>
            </label>
          ))}
          {!normalized.length && <div style={{ padding: 6, fontSize: 11.5, color: COLORS.faint }}>Sin opciones</div>}
        </div>
      )}
    </div>
  );
}

function MiniBarChart({ data, valueKey, formatValue, barColor }) {
  const max = Math.max(1, ...data.map((d) => d[valueKey] || 0));
  if (!data.length) {
    return <div style={{ fontSize: 11.5, color: COLORS.faint, padding: "10px 0" }}>Sin datos para mostrar</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {data.map((d) => (
        <div key={d.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 90, fontSize: 11, color: COLORS.dim, flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={d.label}>{d.label}</div>
          <div style={{ flex: 1, background: COLORS.panel2, borderRadius: 5, height: 16, position: "relative", overflow: "hidden" }}>
            <div style={{ width: `${Math.max(3, ((d[valueKey] || 0) / max) * 100)}%`, height: "100%", background: barColor || COLORS.amber, borderRadius: 5, transition: "width .2s" }} />
          </div>
          <div style={{ width: 92, fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: COLORS.text, textAlign: "right", flexShrink: 0 }}>
            {formatValue ? formatValue(d[valueKey]) : d[valueKey]}
          </div>
        </div>
      ))}
    </div>
  );
}

function ChartPanel({ title, children }) {
  return (
    <div style={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: "14px 16px" }}>
      <div style={{ fontSize: 11.5, color: COLORS.dim, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

function Kpi({ label, value, icon, tone, onClick, onLabelChange, active, title }) {
  const toneColor = tone === "red" ? COLORS.red : tone === "green" ? COLORS.green : tone === "amber" ? COLORS.amber : COLORS.text;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const inputRef = useRef(null);

  useEffect(() => { setDraft(label); }, [label]);
  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);

  function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== label && onLabelChange) onLabelChange(next);
    else setDraft(label);
  }

  return (
    <div
      onClick={editing ? undefined : onClick}
      title={title}
      style={{ background: COLORS.panel, border: `1px solid ${active ? COLORS.amber : tone === "red" ? COLORS.redDim : COLORS.border}`, borderRadius: 10, padding: "14px 16px", cursor: onClick && !editing ? "pointer" : "default", transition: "border-color .15s, box-shadow .15s", boxShadow: active ? `0 0 0 1px ${COLORS.amber}` : "none" }}
      onMouseEnter={onClick && !editing ? (e) => { e.currentTarget.style.borderColor = COLORS.amber; } : undefined}
      onMouseLeave={onClick && !editing ? (e) => { e.currentTarget.style.borderColor = active ? COLORS.amber : tone === "red" ? COLORS.redDim : COLORS.border; } : undefined}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") { setDraft(label); setEditing(false); }
            }}
            style={{
              fontSize: 11, color: COLORS.text, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600,
              background: COLORS.panel2, border: `1px solid ${COLORS.amber}`, borderRadius: 4, padding: "1px 4px",
              width: "100%", marginRight: 6, fontFamily: "inherit", outline: "none",
            }}
          />
        ) : (
          <div
            onClick={(e) => { if (onLabelChange) { e.stopPropagation(); setEditing(true); } }}
            title={onLabelChange ? "Doble clic o clic para editar el titulo" : undefined}
            style={{ fontSize: 11, color: COLORS.dim, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, cursor: onLabelChange ? "text" : "default" }}
          >
            {label}
          </div>
        )}
        <div style={{ opacity: 0.7, flexShrink: 0 }}>{icon}</div>
      </div>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 24, fontWeight: 700, marginTop: 6, color: toneColor }}>{value}</div>
    </div>
  );
}

function KpiHorasExtra({ value, label = "Horas extras (mes)" }) {
  const horasVisibles = Math.max(0, Number(value) || 0);
  const tieneHorasExtras = horasVisibles > 0.0084;
  const color = tieneHorasExtras ? COLORS.green : COLORS.text;
  return (
    <div title="Muestra únicamente las horas extras a favor. Los saldos negativos se mantienen en el cálculo interno, pero no son visibles en este KPI." style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: 11, color: COLORS.dim, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
          {label}
        </div>
        <div style={{ opacity: 0.7, flexShrink: 0 }}>🕐</div>
      </div>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 26, fontWeight: 700, color }}>
        {fmtHoras(horasVisibles, { signo: false })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: tieneHorasExtras ? COLORS.greenSoft : COLORS.dim }}>
        <span>{tieneHorasExtras ? "✓" : "—"}</span>
        <span>{tieneHorasExtras ? "Acumulado del mes" : "Sin horas extras a favor"}</span>
      </div>
    </div>
  );
}

function KpiPuntualidad({ value }) {
  const tieneDatos = value !== null;
  const esExcelente = tieneDatos && value >= 90;
  const esBuena = tieneDatos && value >= 80 && value < 90;
  const esBaja = tieneDatos && value < 80;
  const color = !tieneDatos ? COLORS.text : esBaja ? COLORS.red : COLORS.green;
  const barColor = !tieneDatos ? COLORS.border : esBaja ? COLORS.red : COLORS.green;
  const desempeno = !tieneDatos ? "Sin datos para el periodo" : esExcelente ? "Excelente desempeño" : esBuena ? "Buen desempeño" : "Bajo desempeño";
  return (
    <div title="Porcentaje de dias 'Presente' sobre los dias que tocaba trabajar en el periodo elegido (lunes a sabado, sin domingos ni feriados), segun el trabajador elegido arriba." style={{ background: COLORS.panel, border: `1px solid ${esBaja ? COLORS.redDim : COLORS.border}`, borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: 11, color: COLORS.dim, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
          Mi Puntualidad (Mes)
        </div>
        <div style={{ opacity: 0.7, flexShrink: 0 }}>⏳</div>
      </div>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 26, fontWeight: 700, color }}>
        {tieneDatos ? `${value}%` : "—"}
      </div>
      <div style={{ width: "100%", height: 5, borderRadius: 3, background: COLORS.panel2, overflow: "hidden" }}>
        <div style={{ width: `${tieneDatos ? Math.max(0, Math.min(100, value)) : 0}%`, height: "100%", borderRadius: 3, background: barColor, transition: "width .2s" }} />
      </div>
      <div style={{ fontSize: 10.5, color: COLORS.faint }}>{desempeno}</div>
    </div>
  );
}

const VACACIONES_DIAS_ANIO = 15;

function KpiVacaciones({ value, anio }) {
  const tieneTecnico = value !== null;
  const restantes = tieneTecnico ? value.restantes : null;
  const esNegativo = tieneTecnico && restantes < 0;
  const color = !tieneTecnico ? COLORS.text : esNegativo ? COLORS.red : COLORS.text;
  const pct = tieneTecnico && value.disponible > 0 ? Math.max(0, Math.min(100, (restantes / value.disponible) * 100)) : 0;
  return (
    <div title={`Saldo acumulado de vacaciones: se suman ${VACACIONES_DIAS_ANIO} dias cada 1 de enero (no se resetea) y se restan los dias 'Vacaciones' tomados en toda su historia. Se actualiza automaticamente al registrar una salida o al entrar un año nuevo. Elegir un tecnico arriba para verlo.`} style={{ background: COLORS.panel, border: `1px solid ${esNegativo ? COLORS.redDim : COLORS.border}`, borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: 11, color: COLORS.dim, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
          Saldo de Vacaciones
        </div>
        <div style={{ opacity: 0.7, flexShrink: 0 }}>🌴</div>
      </div>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 26, fontWeight: 700, color }}>
        {tieneTecnico ? restantes : "—"}
      </div>
      {tieneTecnico && (
        <div style={{ width: "100%", height: 5, borderRadius: 3, background: COLORS.panel2, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: COLORS.blue, transition: "width .2s" }} />
        </div>
      )}
      <div style={{ fontSize: 10.5, color: COLORS.faint }}>
        {tieneTecnico
          ? `${value.tomados} tomados de ${value.disponible} acumulados`
          : "Elige un tecnico para ver su saldo"}
      </div>
    </div>
  );
}

function KpiFaltas({ value, onClick, active }) {
  const esAlta = value > 0;
  const color = esAlta ? COLORS.red : COLORS.text;
  return (
    <div
      onClick={onClick}
      title="Dias con estado 'Falta' en el periodo elegido. El valor respeta el tecnico elegido arriba."
      style={{ background: COLORS.panel, border: `1px solid ${esAlta || active ? COLORS.red : COLORS.border}`, borderRadius: 10, padding: "14px 16px", cursor: onClick ? "pointer" : "default", display: "flex", flexDirection: "column", gap: 10, transition: "border-color .15s, box-shadow .15s", boxShadow: active ? `0 0 0 1px ${COLORS.red}` : "none" }}
      onMouseEnter={onClick ? (e) => { e.currentTarget.style.borderColor = COLORS.red; } : undefined}
      onMouseLeave={onClick ? (e) => { e.currentTarget.style.borderColor = esAlta || active ? COLORS.red : COLORS.border; } : undefined}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: 11, color: COLORS.dim, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
          Faltas (mes)
        </div>
        <div style={{ opacity: 0.7, flexShrink: 0 }}>⚠</div>
      </div>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 26, fontWeight: 700, color }}>{value}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: esAlta ? COLORS.redSoft : COLORS.faint }}>
        <span>{esAlta ? "❗" : "✓"}</span>
        <span>{esAlta ? "Atención requerida" : "Sin faltas registradas"}</span>
      </div>
    </div>
  );
}


function KpiPresentes({ value, tone, onClick, active, title, trabajadores, selected, onSelect }) {
  const toneColor = tone === "red" ? COLORS.red : tone === "green" ? COLORS.green : tone === "amber" ? COLORS.amber : COLORS.text;
  return (
    <div
      onClick={onClick}
      title={title}
      style={{ background: COLORS.panel, border: `1px solid ${active ? COLORS.amber : COLORS.border}`, borderRadius: 10, padding: "14px 16px", cursor: onClick ? "pointer" : "default", display: "flex", flexDirection: "column", gap: 8, transition: "border-color .15s, box-shadow .15s", boxShadow: active ? `0 0 0 1px ${COLORS.amber}` : "none" }}
      onMouseEnter={onClick ? (e) => { e.currentTarget.style.borderColor = COLORS.amber; } : undefined}
      onMouseLeave={onClick ? (e) => { e.currentTarget.style.borderColor = active ? COLORS.amber : COLORS.border; } : undefined}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: 11, color: COLORS.dim, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
          Presentes (mes)
        </div>
        <div style={{ opacity: 0.7, flexShrink: 0 }}>✓</div>
      </div>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 24, fontWeight: 700, color: toneColor }}>{value}</div>
      <div onClick={(e) => e.stopPropagation()}>
        <DropdownSelect
          value={selected}
          onChange={onSelect}
          placeholder="Todos los tecnicos"
          options={trabajadores}
          buttonStyle={{ width: "100%", background: COLORS.panel2, border: `1px solid ${COLORS.border}`, color: COLORS.text, fontSize: 11, padding: "5px 6px", borderRadius: 6 }}
        />
      </div>
    </div>
  );
}


function parseOcList(value) {
  return String(value ?? "")
    .split(/[,;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

// Texto a mostrar en las filas/opciones de un selector de OC: el N° de OC
// y, si el registro de Control de Trabajo tiene descripción (o, en su
// defecto, proyecto/servicio), esa descripción separada por un guion.
function ocLabel(rec) {
  const oc = String(rec?.oc ?? "").trim();
  if (!oc) return "";
  const desc = String(rec?.descripcion || rec?.proyecto || "").trim();
  return desc ? `${oc} - ${desc}` : oc;
}

// Arma la lista de opciones { value, label } para OCSelector a partir de
// los registros de Control de Trabajo (ordenados por N° descendente y sin
// duplicados de OC), con label = "N° OC - descripción".
function buildOcOptions(records) {
  const ordered = (records || [])
    .filter((r) => String(r?.oc ?? "").trim())
    .slice()
    .sort((a, b) => (Number(b?.n) || 0) - (Number(a?.n) || 0));
  const seen = new Set();
  const list = [];
  ordered.forEach((r) => {
    const oc = String(r.oc).trim();
    const k = oc.toLocaleLowerCase();
    if (!seen.has(k)) { seen.add(k); list.push({ value: oc, label: ocLabel(r) }); }
  });
  return list;
}

function OCSelector({ value = "", onChange, options = [], placeholder = "Seleccionar o buscar OC…", multiple = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  // Cada opción puede venir como texto plano (solo el N° de OC) o como
  // { value, label } cuando el llamador quiere mostrar la descripción de
  // la OC además del número (label = "N° - descripción"). El valor
  // efectivo (lo que se guarda/compara) siempre es .value / el string.
  const unique = useMemo(() => {
    const seen = new Set();
    return (options || [])
      .map((x) => (x && typeof x === "object")
        ? { value: String(x.value ?? "").trim(), label: String(x.label ?? x.value ?? "").trim(), disabled: !!x.disabled }
        : { value: String(x ?? "").trim(), label: String(x ?? "").trim(), disabled: false })
      .filter((x) => x.value)
      .filter((x) => {
        const k = x.value.toLocaleLowerCase();
        if (seen.has(k)) return false;
        seen.add(k); return true;
      });
  }, [options]);
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return q ? unique.filter((x) => x.label.toLocaleLowerCase().includes(q)) : unique;
  }, [unique, query]);
  const selectedList = useMemo(() => (multiple ? parseOcList(value) : []), [multiple, value]);
  useEffect(() => {
    const onDoc = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (multiple) {
    const toggle = (oc) => {
      const has = selectedList.some((x) => x.toLocaleLowerCase() === oc.toLocaleLowerCase());
      const next = has ? selectedList.filter((x) => x.toLocaleLowerCase() !== oc.toLocaleLowerCase()) : [...selectedList, oc];
      onChange(next.join(", "));
    };
    const removeChip = (oc) => onChange(selectedList.filter((x) => x !== oc).join(", "));
    const addCustom = () => {
      const v = query.trim();
      if (!v) return;
      if (!selectedList.some((x) => x.toLocaleLowerCase() === v.toLocaleLowerCase())) {
        onChange([...selectedList, v].join(", "));
      }
      setQuery("");
    };
    return (
      <div ref={rootRef} style={{ position:"relative" }}>
        <div
          className="ct-input2"
          onClick={() => setOpen(true)}
          style={{ display:"flex", flexWrap:"wrap", gap:5, alignItems:"center", minHeight:36, cursor:"text", padding: selectedList.length ? "5px 7px" : undefined }}
        >
          {selectedList.map((oc) => (
            <span key={oc} style={{ display:"inline-flex", alignItems:"center", gap:4, background:COLORS.panel2, border:`1px solid ${COLORS.border}`, borderRadius:20, padding:"2px 4px 2px 8px", fontSize:11.5 }}>
              {oc}
              <button type="button" onClick={(e) => { e.stopPropagation(); removeChip(oc); }} style={{ background:"transparent", border:"none", color:COLORS.faint, cursor:"pointer", fontSize:12, lineHeight:1, padding:"0 2px" }}>×</button>
            </span>
          ))}
          <input
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }}
            placeholder={selectedList.length ? "" : placeholder}
            autoComplete="off"
            style={{ flex:1, minWidth:80, background:"transparent", border:"none", outline:"none", color:COLORS.text, fontSize:12.5, fontFamily:"'Inter',sans-serif", padding:"3px 2px" }}
          />
        </div>
        {open && (
          <div style={{ position:"absolute", zIndex:120, top:"calc(100% + 4px)", left:0, right:0, minWidth:260, maxHeight:310, overflowY:"auto", background:COLORS.panel, border:`1px solid ${COLORS.border}`, borderRadius:8, boxShadow:"0 12px 30px rgba(0,0,0,.35)", padding:6 }}>
            {filtered.map((opt) => {
              const checked = selectedList.some((x) => x.toLocaleLowerCase() === opt.value.toLocaleLowerCase());
              return (
                <button key={`m-${opt.value}`} type="button" onClick={() => toggle(opt.value)} className={`wc-dd-opt${checked ? " is-selected" : ""}`} style={{ display:"flex", alignItems:"center", gap:8, width:"100%", textAlign:"left", border:"none", padding:"6px 8px", borderRadius:6, cursor:"pointer", fontSize:11.5 }}>
                  <span style={{ width:14, height:14, borderRadius:4, border:`1px solid ${checked ? COLORS.amber : COLORS.border}`, background: checked ? COLORS.amber : "transparent", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, color:COLORS.amberText }}>{checked ? "✓" : ""}</span>
                  {opt.label}
                </button>
              );
            })}
            {!filtered.length && <div style={{ padding:"7px 8px", color:COLORS.faint, fontSize:11 }}>{query.trim() ? "Sin coincidencias — presiona Enter para agregarla." : "No se encontraron OC."}</div>}
          </div>
        )}
      </div>
    );
  }

  const choose = (opt) => { if (opt.disabled) return; onChange(opt.value); setQuery(""); setOpen(false); };
  return (
    <div ref={rootRef} style={{ position:"relative" }}>
      <input
        className="ct-input2"
        value={value ?? ""}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => { onChange(e.target.value); setQuery(e.target.value); setOpen(true); }}
        onClick={() => setOpen(true)}
        autoComplete="off"
        style={{ paddingRight: 28, cursor: "pointer" }}
      />
      <span style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", pointerEvents:"none", color:COLORS.dim, fontSize:10 }}>▼</span>
      {open && (
        <div style={{ position:"absolute", zIndex:120, top:"calc(100% + 4px)", left:0, right:0, minWidth:260, maxHeight:310, overflowY:"auto", background:COLORS.panel, border:`1px solid ${COLORS.border}`, borderRadius:8, boxShadow:"0 12px 30px rgba(0,0,0,.35)", padding:6 }}>
          <input className="ct-input2" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Escribe para buscar…" autoFocus={false} />
          <div style={{ marginTop:5 }}>
            {filtered.map((opt) => (
              <button key={`a-${opt.value}`} type="button" disabled={opt.disabled} onClick={() => choose(opt)} className={`wc-dd-opt${opt.value === value ? " is-selected" : ""}`} style={{ display:"block", width:"100%", textAlign:"left", border:"none", padding:"6px 8px", borderRadius:6, cursor: opt.disabled ? "not-allowed" : "pointer", fontSize:11.5, opacity: opt.disabled ? 0.5 : 1 }}>{opt.label}</button>
            ))}
            {!filtered.length && <div style={{ padding:"7px 8px", color:COLORS.faint, fontSize:11 }}>Sin resultados.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// Selector de opciones cerradas (no texto libre) con el MISMO panel visual
// que OCSelector: caja ct-input2 + flecha, y lista desplegable oscura con
// borde/sombra idénticos. Reemplaza al <select> nativo del navegador para
// que el desplegable se vea exactamente igual en cualquier equipo/navegador
// (el <select> nativo delega el estilo del panel abierto al sistema
// operativo y por eso puede verse distinto de un equipo a otro).
function DropdownSelect({ value = "", onChange, options = [], placeholder = "Seleccionar…", disabled = false, buttonClassName = "ct-input2", buttonStyle, wrapperStyle, arrowStyle, panelStyle }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const normalized = useMemo(() => (options || []).map((o) =>
    typeof o === "string" ? { value: o, label: o || "—", disabled: false } : { value: o.value, label: o.label ?? (o.value || "—"), disabled: !!o.disabled }
  ), [options]);
  const selected = normalized.find((o) => o.value === value);
  useEffect(() => {
    const onDoc = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const choose = (o) => { if (o.disabled) return; onChange(o.value); setOpen(false); };
  return (
    <div ref={rootRef} style={{ position: "relative", ...wrapperStyle }}>
      <button
        type="button"
        className={buttonClassName}
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, textAlign: "left", paddingRight: 28, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.7 : 1, appearance: "none", WebkitAppearance: "none", MozAppearance: "none", ...buttonStyle }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: selected && selected.value !== "" ? "inherit" : COLORS.faint }}>
          {selected ? selected.label : placeholder}
        </span>
      </button>
      <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: COLORS.dim, fontSize: 10, ...arrowStyle }}>▼</span>
      {open && !disabled && (
        <div style={{ position: "absolute", zIndex: 120, top: "calc(100% + 4px)", left: 0, right: 0, minWidth: 260, maxHeight: 310, overflowY: "auto", background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 8, boxShadow: "0 12px 30px rgba(0,0,0,.35)", padding: 6, ...panelStyle }}>
          {normalized.map((o) => (
            <button
              key={o.value || "none"}
              type="button"
              onClick={() => choose(o)}
              disabled={o.disabled}
              className={`wc-dd-opt${o.value === value ? " is-selected" : ""}`}
              style={{ display: "block", width: "100%", textAlign: "left", border: "none", padding: "6px 8px", borderRadius: 6, cursor: o.disabled ? "not-allowed" : "pointer", fontSize: 11.5, opacity: o.disabled ? 0.5 : 1 }}
            >
              {o.label}
            </button>
          ))}
          {!normalized.length && <div style={{ padding: "7px 8px", color: COLORS.faint, fontSize: 11 }}>Sin opciones.</div>}
        </div>
      )}
    </div>
  );
}

function EditForm({ value, onChange, ocOptions = [] }) {
  const isMobile = useIsMobile();
  function set(key, v) {
    let next = { ...value, [key]: v };
    if (key === "subtotal") {
      const sub = v === "" ? "" : Number(v);
      const igv = sub === "" ? "" : Math.round(sub * 0.18 * 100) / 100;
      const total = sub === "" ? "" : Math.round((sub + igv) * 100) / 100;
      next = { ...next, igv, total };
    }
    if (key === "fechaFinReal") {
      // El usuario editó "Cierre real" a mano: se congela y deja de
      // sincronizarse automáticamente con la emisión o el informe.
      next = { ...next, fechaFinRealAuto: false };
    }
    next = computeAutoEstados(next);
    onChange(next);
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
      {FIELD_DEFS.map((f) => (
        <div key={f.key} style={{ gridColumn: f.full ? "1 / -1" : "auto" }}>
          <div style={{ fontSize: 10, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>{f.label}</div>
          {f.key === "oc" ? (
            <OCSelector value={value[f.key] ?? ""} onChange={(v) => set(f.key, v)} options={ocOptions} />
          ) : f.type === "select" ? (
            <DropdownSelect value={value[f.key] ?? ""} onChange={(v) => set(f.key, v)} options={f.options} disabled={f.readOnly} placeholder="—" />
          ) : f.type === "textarea" ? (
            <textarea className="ct-input2" rows={3} value={value[f.key] ?? ""} onChange={(e) => set(f.key, f.noUppercase ? e.target.value : e.target.value.toUpperCase())} />
          ) : (
            <input
              className="ct-input2"
              type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
              step={f.step}
              readOnly={f.readOnly}
              disabled={f.readOnly}
              value={value[f.key] ?? ""}
              onChange={(e) => set(f.key, f.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : (f.noUppercase ? e.target.value : e.target.value.toUpperCase()))}
              style={f.readOnly ? { opacity: 0.7, cursor: "not-allowed" } : undefined}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function AttachmentThumb({ att, onRemove }) {
  const isImg = isImageType(att.type);
  // Los adjuntos nuevos se guardan como driveFileId (no dataUrl) para no llenar Neon; los
  // registros viejos que aún tengan dataUrl guardado directamente siguen funcionando igual.
  const href = att.driveFileId ? urlFotoDrive(att.driveFileId) : att.dataUrl;
  return (
    <div style={{ position: "relative", background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 8, overflow: "hidden", width: 110 }}>
      <button
        onClick={() => onRemove(att.id)}
        title="Quitar archivo"
        style={{ position: "absolute", top: 3, right: 3, width: 18, height: 18, borderRadius: 50, border: "none", background: "rgba(0,0,0,.6)", color: "#fff", fontSize: 10, cursor: "pointer", zIndex: 2, lineHeight: "18px", padding: 0 }}
      >
        ✕
      </button>
      <a href={href} download={att.name} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
        {isImg ? (
          <img src={href} alt={att.name} style={{ width: "100%", height: 78, objectFit: "cover", display: "block" }} />
        ) : (
          <div style={{ width: "100%", height: 78, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>📄</div>
        )}
        <div style={{ padding: "5px 7px", fontSize: 10, color: COLORS.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={att.name}>
          {att.name}
        </div>
        <div style={{ padding: "0 7px 6px", fontSize: 9.5, color: COLORS.faint }}>{fmtBytes(att.size)}</div>
      </a>
    </div>
  );
}
function InfoRow({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12.5, color: COLORS.text }}>{value || "—"}</div>
    </div>
  );
}

function DocRow({ titulo, numero, estado, link, colorFn }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: COLORS.panel2, borderRadius: 8, padding: "9px 12px" }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600 }}>{titulo}</div>
        <div style={{ fontSize: 11, color: COLORS.faint, fontFamily: "'JetBrains Mono',monospace" }}>{numero || "sin numero"}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Badge text={estado} colors={colorFn ? colorFn(estado) : titulo === "Factura" ? estadoFacturaColor(estado) : docEstadoColor(estado)} />
        {link && <a className="ct-link" href={link} target="_blank" rel="noreferrer" style={{ fontSize: 11.5 }}>Ver documento ↗</a>}
      </div>
    </div>
  );
}

const STORAGE_KEY_ASISTENCIA_REGISTROS = "wilarcon_asistencia_registros";
const STORAGE_KEY_ASISTENCIA_TRABAJADORES = "wilarcon_asistencia_trabajadores";
const STORAGE_KEY_ASISTENCIA_UBICACIONES = "wilarcon_asistencia_ubicaciones";
const STORAGE_KEY_ASISTENCIA_SUELDOS = "wilarcon_asistencia_sueldos";
const STORAGE_KEY_ASISTENCIA_PLANILLA_FIJA = "wilarcon_asistencia_planilla_fija";
const STORAGE_KEY_ASISTENCIA_DESCUENTOS_BONOS = "wilarcon_asistencia_descuentos_bonos";
const ESTADOS_ASISTENCIA = ["Presente", "Tardanza", "Falta", "Permiso", "Vacaciones"];
const ESTADOS_ASISTENCIA_FORM = ESTADOS_ASISTENCIA.filter((e) => e !== "Tardanza");
const TURNOS_ASISTENCIA = ["D", "N"];

function HoraInput(
  { label, value, onChange, disabled = false, turno = "D", isEntrada = false }
) {
  const sugerencias = turno === "N"
    ? (isEntrada ? ["19:00", "20:00", "21:00", "22:00"] : ["05:00", "06:00", "07:00", "08:00"])
    : (isEntrada ? ["07:30", "08:00", "08:30", "09:00"] : ["17:00", "17:30", "18:00", "18:30"]);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef(null);
  const [typed, setTyped] = useState(value || "");

  useEffect(() => setTyped(value || ""), [value]);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const parseValue = (v) => {
    const m = String(v || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = Number(m[1]), min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return { h, min };
  };

  const parsed = parseValue(value);
  const selectedHour = parsed?.h ?? 0;
  const selectedMinute = parsed?.min ?? 0;
  const minutes = Array.from({ length: 60 }, (_, i) => i);
  const hours = Array.from({ length: 24 }, (_, i) => i);

  const commitTyped = (raw) => {
    const clean = String(raw || "").replace(/[^0-9:]/g, "");
    setTyped(clean);
    const normalized = clean.match(/^(\d{1,2}):(\d{2})$/);
    if (normalized) {
      const h = Number(normalized[1]), min = Number(normalized[2]);
      if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
        const v = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
        setTyped(v);
        onChange(v);
      }
    }
  };

  const setPart = (part, n) => {
    const h = part === "hour" ? n : selectedHour;
    const min = part === "minute" ? n : selectedMinute;
    const v = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    setTyped(v);
    onChange(v);
  };

  const ahora = () => {
    const d = new Date();
    const v = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    setTyped(v);
    onChange(v);
    setOpen(false);
  };

  return (
    <div ref={popoverRef} style={{ position: "relative" }}>
      <div style={{ fontSize: 10.5, color: COLORS.dim, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ display: "flex", gap: 6 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <input className="as-input" type="text" inputMode="numeric" value={typed} disabled={disabled} placeholder="HH:MM" maxLength={5}
            onFocus={() => !disabled && setOpen(true)} onChange={(e) => commitTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
            aria-label={label} title="Formato 24 horas. Puedes escribir HH:MM o seleccionar desde el menú."
            style={{ paddingRight: 34, fontSize: 15, fontWeight: 700, letterSpacing: 0.8 }} />
          <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: COLORS.dim, pointerEvents: "none", fontSize: 14 }}>◷</span>
        </div>
        <button type="button" disabled={disabled} onClick={() => setOpen(v => !v)}
          style={{ width: 42, border: `1px solid ${COLORS.border}`, background: open ? COLORS.blue : COLORS.panel2, color: open ? COLORS.amberText : COLORS.text, borderRadius: 7, cursor: disabled ? "default" : "pointer", fontSize: 15, fontWeight: 800 }}
          title="Seleccionar hora" aria-expanded={open}>⌄</button>
        {value && !disabled && <button type="button" onClick={() => { setTyped(""); onChange(""); setOpen(false); }}
          title="Limpiar hora" style={{ width: 34, border: `1px solid ${COLORS.border}`, background: COLORS.panel2, color: COLORS.dim, borderRadius: 7, cursor: "pointer", fontSize: 17 }}>×</button>}
      </div>
      {open && !disabled && (
        <div style={{ position: "absolute", zIndex: 1000, top: "100%", left: 0, right: 0, marginTop: 6, background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, boxShadow: "0 14px 34px rgba(0,0,0,.45)", overflow: "hidden" }}>
          <div style={{ padding: "9px 10px 7px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div><div style={{ fontSize: 10, color: COLORS.faint, textTransform: "uppercase", letterSpacing: .7 }}>Selecciona la hora</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.text, marginTop: 2 }}>{value || "--:--"}</div></div>
            <button type="button" onClick={ahora} style={{ border: `1px solid ${COLORS.border}`, background: COLORS.panel2, color: COLORS.blue, borderRadius: 7, padding: "5px 8px", fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}>Ahora</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, maxHeight: 190 }}>
            <div style={{ borderRight: `1px solid ${COLORS.border}` }}><div style={{ padding: "6px 10px", fontSize: 9.5, color: COLORS.faint, background: COLORS.panel2, textTransform: "uppercase", letterSpacing: .7 }}>Hora</div>
              <div style={{ overflowY: "auto", maxHeight: 155, padding: 6 }}>{hours.map((h) => { const active = h === selectedHour; return <button key={h} type="button" onClick={() => setPart("hour", h)} style={{ display: "block", width: "100%", border: 0, background: active ? COLORS.blue : "transparent", color: active ? COLORS.amberText : COLORS.text, borderRadius: 6, padding: "6px 8px", marginBottom: 2, textAlign: "center", fontSize: 12, fontWeight: active ? 800 : 600, cursor: "pointer" }}>{String(h).padStart(2, "0")}</button>; })}</div>
            </div>
            <div><div style={{ padding: "6px 10px", fontSize: 9.5, color: COLORS.faint, background: COLORS.panel2, textTransform: "uppercase", letterSpacing: .7 }}>Minuto</div>
              <div style={{ overflowY: "auto", maxHeight: 155, padding: 6 }}>{minutes.map((m) => { const active = m === selectedMinute; return <button key={m} type="button" onClick={() => setPart("minute", m)} style={{ display: "block", width: "100%", border: 0, background: active ? COLORS.blue : "transparent", color: active ? COLORS.amberText : COLORS.text, borderRadius: 6, padding: "6px 8px", marginBottom: 2, textAlign: "center", fontSize: 12, fontWeight: active ? 800 : 600, cursor: "pointer" }}>{String(m).padStart(2, "0")}</button>; })}</div>
            </div>
          </div>
          <div style={{ padding: 8, borderTop: `1px solid ${COLORS.border}` }}><div style={{ fontSize: 9.5, color: COLORS.faint, marginBottom: 5 }}>Sugerencias rápidas</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{sugerencias.map((hora) => { const active = value === hora; return <button key={hora} type="button" onClick={() => { setTyped(hora); onChange(hora); setOpen(false); }} style={{ border: `1px solid ${active ? COLORS.blue : COLORS.border}`, background: active ? COLORS.blue : COLORS.panel2, color: active ? COLORS.amberText : COLORS.text, borderRadius: 6, padding: "5px 8px", fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}>{hora}</button>; })}</div>
          </div>
        </div>
      )}
      <div style={{ fontSize: 10, color: COLORS.faint, marginTop: 4 }}>24 horas · selecciona HH y MM o escribe HH:MM</div>
    </div>
  );
}


function DateInput({
  label = "Fecha",
  value = "",
  onChange,
  disabled = false,
  palette = COLORS,
  inputClassName = "",
  style = {},
  showLabel = true,
  compact = false,
  placeholder = "DD/MM/AAAA",
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef(null);
  const [typed, setTyped] = useState("");
  const [view, setView] = useState(() => {
    const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return { y: Number(m[1]), m: Number(m[2]) - 1 };
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  const parseDate = (raw) => {
    const v = String(raw || "").trim();
    let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) {
      const y = Number(m[1]), mo = Number(m[2]), day = Number(m[3]);
      if (!y || mo < 1 || mo > 12 || day < 1 || day > new Date(y, mo, 0).getDate()) return null;
      return { y, m: mo - 1, d: day };
    }
    m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (!m) return null;
    const y = Number(m[3]), mo = Number(m[2]), day = Number(m[1]);
    if (!y || mo < 1 || mo > 12 || day < 1 || day > new Date(y, mo, 0).getDate()) return null;
    return { y, m: mo - 1, d: day };
  };

  const toISO = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const formatDisplay = (iso) => {
    const p = parseDate(iso);
    return p ? `${String(p.d).padStart(2, "0")}/${String(p.m + 1).padStart(2, "0")}/${p.y}` : "";
  };

  useEffect(() => {
    setTyped(formatDisplay(value));
    const p = parseDate(value);
    if (p)
      setView({ y: p.y, m: p.m });
    // formatDisplay/parseDate son funciones puras redefinidas en cada render que solo dependen
    // del argumento recibido (value); no aportan nada nuevo como dependencias.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const commitTyped = (raw, close = false) => {
    const clean = String(raw || "").replace(/[^0-9/-]/g, "").slice(0, 10);
    setTyped(clean);
    const p = parseDate(clean);
    if (p) {
      const iso = toISO(p.y, p.m, p.d);
      setTyped(formatDisplay(iso));
      setView({ y: p.y, m: p.m });
      onChange(iso);
      if (close) setOpen(false);
    }
  };

  const selectDay = (d) => {
    const iso = toISO(view.y, view.m, d);
    setTyped(formatDisplay(iso));
    onChange(iso);
    setOpen(false);
  };

  const today = new Date();
  const todayISO = toISO(today.getFullYear(), today.getMonth(), today.getDate());
  const selected = parseDate(value);
  const firstDay = new Date(view.y, view.m, 1);
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const startMonday = (firstDay.getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < startMonday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const monthName = new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric" }).format(new Date(view.y, view.m, 1));
  const shiftMonth = (delta) => {
    const d = new Date(view.y, view.m + delta, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  };
  const quick = [
    { label: "Hoy", iso: todayISO },
    { label: "Ayer", iso: (() => { const d = new Date(today); d.setDate(d.getDate() - 1); return toISO(d.getFullYear(), d.getMonth(), d.getDate()); })() },
    { label: "Inicio de mes", iso: toISO(today.getFullYear(), today.getMonth(), 1) },
    { label: "Fin de mes", iso: toISO(today.getFullYear(), today.getMonth(), new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()) },
  ];

  return (
    <div ref={popoverRef} style={{ position: "relative", width: "100%" }}>
      {showLabel && <div style={{ fontSize: 10.5, color: palette.dim, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>}
      <div style={{ display: "flex", gap: 6, width: "100%" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <input
            className={inputClassName}
            type="text"
            inputMode="numeric"
            value={typed}
            disabled={disabled}
            placeholder={placeholder}
            maxLength={10}
            onFocus={() => !disabled && setOpen(true)}
            onChange={(e) => commitTyped(e.target.value)}
            onBlur={() => { const p = parseDate(typed); if (!p && typed) setTyped(formatDisplay(value)); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitTyped(e.currentTarget.value, true); }
              if (e.key === "Escape") setOpen(false);
            }}
            aria-label={label}
            title="Formato DD/MM/AAAA. Puedes escribir la fecha o seleccionarla en el calendario."
            style={{ ...style, paddingRight: 38 }}
          />
          <span style={{ position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)", color: palette.dim, pointerEvents: "none", fontSize: 14 }}>▣</span>
        </div>
        <button type="button" disabled={disabled} onClick={() => setOpen(v => !v)}
          style={{ width: compact ? 36 : 42, border: `1px solid ${palette.border}`, background: open ? palette.blue : palette.panel2, color: open ? palette.amberText : palette.text, borderRadius: 7, cursor: disabled ? "default" : "pointer", fontSize: 14, fontWeight: 800 }}
          title="Abrir calendario" aria-expanded={open}>⌄</button>
        {value && !disabled && <button type="button" onClick={() => { setTyped(""); onChange(""); setOpen(false); }}
          title="Limpiar fecha" style={{ width: 34, border: `1px solid ${palette.border}`, background: palette.panel2, color: palette.dim, borderRadius: 7, cursor: "pointer", fontSize: 17 }}>×</button>}
      </div>
      {open && !disabled && (
        <div style={{ position: "absolute", zIndex: 1100, top: "100%", left: 0, width: compact ? 300 : 330, maxWidth: "min(330px, calc(100vw - 28px))", marginTop: 6, background: palette.panel, border: `1px solid ${palette.border}`, borderRadius: 10, boxShadow: "0 14px 34px rgba(0,0,0,.45)", overflow: "hidden" }}>
          <div style={{ padding: "9px 10px 7px", borderBottom: `1px solid ${palette.border}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <button type="button" onClick={() => shiftMonth(-1)} style={{ width: 30, height: 30, border: `1px solid ${palette.border}`, background: palette.panel2, color: palette.text, borderRadius: 7, cursor: "pointer", fontSize: 16 }}>‹</button>
              <div style={{ textAlign: "center", flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: palette.text, textTransform: "capitalize" }}>{monthName}</div>
                <div style={{ fontSize: 9.5, color: palette.faint, marginTop: 2 }}>Selecciona un día</div>
              </div>
              <button type="button" onClick={() => shiftMonth(1)} style={{ width: 30, height: 30, border: `1px solid ${palette.border}`, background: palette.panel2, color: palette.text, borderRadius: 7, cursor: "pointer", fontSize: 16 }}>›</button>
            </div>
            <div style={{ display: "flex", gap: 5, marginTop: 8 }}>
              {quick.map((q) => <button key={q.label} type="button" onClick={() => { const p = parseDate(q.iso); setView({ y: p.y, m: p.m }); setTyped(formatDisplay(q.iso)); onChange(q.iso); setOpen(false); }}
                style={{ flex: 1, border: `1px solid ${value === q.iso ? palette.blue : palette.border}`, background: value === q.iso ? palette.blue : palette.panel2, color: value === q.iso ? palette.amberText : palette.text, borderRadius: 6, padding: "5px 4px", fontSize: 9.5, fontWeight: 700, cursor: "pointer" }}>{q.label}</button>)}
            </div>
          </div>
          <div style={{ padding: 9 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, marginBottom: 4 }}>
              {["L", "M", "X", "J", "V", "S", "D"].map((d) => <div key={d} style={{ textAlign: "center", fontSize: 9.5, fontWeight: 800, color: palette.faint, padding: 4 }}>{d}</div>)}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
              {cells.map((d, idx) => {
                if (!d) return <div key={`blank-${idx}`} style={{ height: 30 }} />;
                const iso = toISO(view.y, view.m, d);
                const active = selected && selected.y === view.y && selected.m === view.m && selected.d === d;
                const isToday = iso === todayISO;
                return <button key={iso} type="button" onClick={() => selectDay(d)}
                  style={{ height: 30, border: `1px solid ${active ? palette.blue : isToday ? palette.blue : "transparent"}`, background: active ? palette.blue : isToday ? palette.amberDim : "transparent", color: active ? palette.amberText : palette.text, borderRadius: 6, cursor: "pointer", fontSize: 11.5, fontWeight: active || isToday ? 800 : 600 }}>{d}</button>;
              })}
            </div>
          </div>
          <div style={{ borderTop: `1px solid ${palette.border}`, padding: "7px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 9.5, color: palette.faint }}>Formato: DD/MM/AAAA</span>
            <button type="button" onClick={() => { setTyped(formatDisplay(value)); setOpen(false); }} style={{ border: 0, background: "transparent", color: palette.blue, fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}>Cerrar</button>
          </div>
        </div>
      )}
    </div>
  );
}

const JORNADA_HORAS_ASISTENCIA = 9;
const RECARGO_DOMINGO_FERIADO = 1;

const FERIADOS_FIJOS_PERU = [
  [1, 1],
  [5, 1],
  [6, 7],
  [6, 29],
  [7, 23],
  [7, 28],
  [7, 29],
  [8, 6],
  [8, 30],
  [10, 8],
  [11, 1],
  [12, 8],
  [12, 9],
  [12, 25],
];

function pascuaFecha(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return { mes, dia };
}

function sumarDiasFecha(year, mes, dia, delta) {
  const d = new Date(Date.UTC(year, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() + delta);
  return { year: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
}

function esFeriadoPeru(fechaStr) {
  if (!fechaStr) return false;
  const [yStr, mStr, dStr] = fechaStr.split("-");
  const year = Number(yStr), mes = Number(mStr), dia = Number(dStr);
  if (!year || !mes || !dia) return false;
  if (FERIADOS_FIJOS_PERU.some(([fm, fd]) => fm === mes && fd === dia)) return true;
  const pascua = pascuaFecha(year);
  const viernesSanto = sumarDiasFecha(year, pascua.mes, pascua.dia, -2);
  const juevesSanto = sumarDiasFecha(year, pascua.mes, pascua.dia, -3);
  if (mes === viernesSanto.mes && dia === viernesSanto.dia) return true;
  if (mes === juevesSanto.mes && dia === juevesSanto.dia) return true;
  return false;
}

function esDomingo(fechaStr) {
  if (!fechaStr) return false;
  const [y, m, d] = fechaStr.split("-").map(Number);
  if (!y || !m || !d) return false;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0;
}

function esDiaBonoPeru(fechaStr) {
  return esDomingo(fechaStr) || esFeriadoPeru(fechaStr);
}

function diasLaborablesDelMes(mesStr, fechaLimiteStr) {
  const [y, m] = mesStr.split("-").map(Number);
  if (!y || !m) return 0;
  const ultimoDiaMes = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const limiteEsDelMes = (fechaLimiteStr || "").slice(0, 7) === mesStr;
  const diaLimite = limiteEsDelMes ? Number(fechaLimiteStr.slice(8, 10)) : ultimoDiaMes;
  let count = 0;
  for (let dia = 1; dia <= Math.min(diaLimite, ultimoDiaMes); dia++) {
    const fecha = `${y}-${String(m).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    if (!esDiaBonoPeru(fecha)) count += 1;
  }
  return count;
}

function estadoAsistenciaColor(v) {
  const n = (v || "").trim();
  if (n === "Presente") return { bg: COLORS.greenDim, fg: COLORS.greenSoft };
  if (n === "Tardanza") return { bg: COLORS.amberDim, fg: COLORS.blueSoft };
  if (n === "Falta") return { bg: COLORS.redDim, fg: COLORS.redSoft };
  if (n === "Permiso") return { bg: COLORS.purpleDim, fg: "#d8bfff" };
  return { bg: COLORS.panel2, fg: COLORS.faint };
}

function emptyAsistenciaDraft() {
  return { id: null, trabajador: "", fecha: todayStr(), horaEntrada: "", horaSalida: "", ubicacion: "", turno: "D", estado: "Presente", observacion: "" };
}

function asistenciaDraftValido(d, ubicacionSedes) {
  const sedes = ubicacionSedes || UBICACION_SEDES;
  if (!d.trabajador || !d.fecha) return false;
  if (d.estado === "Presente" || d.estado === "Permiso") {
    const [sede, ...resto] = (d.ubicacion || "").split(" ");
    const campus = resto.join(" ");
    const ubicacionCompleta = !!(sedes[sede] && sedes[sede].includes(campus));
    return !!(d.horaEntrada && ubicacionCompleta);
  }
  return true;
}

function groupAsistenciaBy(data, field) {
  const map = new Map();
  data.forEach((d) => {
    const key = d[field] || "Sin dato";
    if (!map.has(key)) map.set(key, { key, label: key, count: 0 });
    map.get(key).count += 1;
  });
  return [...map.values()].sort((a, b) => b.count - a.count);
}

function horasEntreHorarios(horaEntrada, horaSalida) {
  if (!horaEntrada || !horaSalida) return null;
  const validaHora = (v) => typeof v === "string" && /^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(v);
  if (!validaHora(horaEntrada) || !validaHora(horaSalida)) return null;
  const [eh, em] = horaEntrada.split(":").map(Number);
  const [sh, sm] = horaSalida.split(":").map(Number);
  let minutos = (sh * 60 + sm) - (eh * 60 + em);
  if (minutos < 0) minutos += 24 * 60;
  return minutos / 60;
}

function fmtHoras(h, { signo = false } = {}) {
  if (h === null || h === undefined || Number.isNaN(h)) return "—";
  const esNegativo = h < 0;
  const abs = Math.abs(h);
  const hh = Math.floor(abs + 1e-9);
  const mm = Math.round((abs - hh) * 60);
  const hhAdj = mm === 60 ? hh + 1 : hh;
  const mmAdj = mm === 60 ? 0 : mm;
  const prefijo = esNegativo ? "-" : signo ? "+" : "";
  return `${prefijo}${hhAdj}h ${String(mmAdj).padStart(2, "0")}m`;
}

function calcularHorasRegistro(r) {
  const horas = horasEntreHorarios(r.horaEntrada, r.horaSalida);
  if (horas === null) {
    if (r.estado === "Falta")
      return { horas: null, diferencia: -8, esBono: false };
    return { horas: null, diferencia: null, esBono: false };
  }
  const esBono = esDiaBonoPeru(r.fecha);
  const diferencia = esBono ? horas * (1 + RECARGO_DOMINGO_FERIADO) : horas - JORNADA_HORAS_ASISTENCIA;
  return { horas, diferencia, esBono };
}

function resumenHorasPorTrabajador(data) {
  const map = new Map();
  const mesesPorTrabajador = new Map();
  data.forEach((r) => {
    const key = r.trabajador || "Sin dato";
    if (!map.has(key)) map.set(key, { trabajador: key, registros: 0, diasConHorario: 0, horasTrabajadas: 0, horasEsperadas: 0, diferencia: 0, diasBono: 0, diasFalta: 0 });
    const acc = map.get(key);
    acc.registros += 1;
    const { horas, diferencia, esBono } = calcularHorasRegistro(r);
    if (r.estado === "Falta") acc.diasFalta += 1;
    if (horas !== null) {
      acc.diasConHorario += 1;
      acc.horasTrabajadas += horas;
      acc.diferencia += diferencia;
      if (esBono) acc.diasBono += 1;
    } else if (diferencia !== null) {
      acc.diferencia += diferencia;
    }
    const mes = (r.fecha || "").slice(0, 7);
    if (mes) {
      if (!mesesPorTrabajador.has(key)) mesesPorTrabajador.set(key, new Set());
      mesesPorTrabajador.get(key).add(mes);
    }
  });
  mesesPorTrabajador.forEach((meses, key) => {
    const acc = map.get(key);
    acc.horasEsperadas = [...meses].reduce((sum, mes) => sum + diasLaborablesDelMes(mes) * JORNADA_HORAS_ASISTENCIA, 0);
  });
  return [...map.values()]
    .map((acc) => ({
      ...acc,
      horasExtra: acc.diferencia > 0 ? acc.diferencia : 0,
      horasPorDevolver: acc.diferencia < 0 ? -acc.diferencia : 0,
    }))
    .sort((a, b) => b.horasTrabajadas - a.horasTrabajadas);
}

const ASISTENCIA_SEED_SUELDOS = { Milder: 2800, Cristian: 1600, Wanderly: 1900 };
const DIAS_MES_PLANILLA = 30;
const RECARGO_HORA_EXTRA_TRAMO1 = 0.25;
const RECARGO_HORA_EXTRA_TRAMO2 = 0.35;
const RECARGO_TURNO_NOCTURNO = 0.35;
// Lili tiene, además de su sueldo mensual configurado, un pago adicional
// por cada día que se le marca "Presente" en Asistencia (S/50 si trabajó menos
// de una jornada completa, S/100 si completó la jornada), más un viático automático
// de supervisión ese mismo día. Los nombres deben coincidir (sin distinguir mayúsculas
// ni tildes) con el nombre del trabajador tal como está registrado en Asistencia.
const BONO_DIARIO_TRABAJADORES = ["Lili"];
const BONO_DIARIO_MONTO = 100; // día completo (jornada de JORNADA_HORAS_ASISTENCIA horas o más)
const BONO_DIARIO_MONTO_MEDIO_DIA = 50; // menos de una jornada completa
const VIATICO_AUTO_SUPERVISION_MONTO = 10;
const VIATICO_AUTO_SUPERVISION_CONCEPTO = "SUPERVISIÓN DE TRABAJOS";
function esBonoDiarioTrabajador(nombre) {
  const key = normalizePersonKey(nombre);
  return BONO_DIARIO_TRABAJADORES.some((n) => normalizePersonKey(n) === key);
}
// Si el registro tiene hora de entrada y salida y suman menos que la jornada completa,
// se paga medio día (S/50); si no hay forma de saber las horas (falta la hora de salida)
// o la jornada se completó, se paga el día completo (S/100), igual que antes.
function montoBonoDiarioRegistro(r) {
  const horas = horasEntreHorarios(r.horaEntrada, r.horaSalida);
  if (horas === null) return BONO_DIARIO_MONTO;
  return horas < JORNADA_HORAS_ASISTENCIA ? BONO_DIARIO_MONTO_MEDIO_DIA : BONO_DIARIO_MONTO;
}
function calcularMontoHorasExtraRegistro(r, valorHoraOrdinaria) {
  const horas = horasEntreHorarios(r.horaEntrada, r.horaSalida);
  if (horas === null || !valorHoraOrdinaria || horas <= 0) return 0;
  const recargoNocturno = r.turno === "N" ? RECARGO_TURNO_NOCTURNO : 0;
  if (esDiaBonoPeru(r.fecha)) {
    const multiplicador = 1 + RECARGO_DOMINGO_FERIADO + recargoNocturno;
    return horas * valorHoraOrdinaria * multiplicador;
  }
  const extra = horas - JORNADA_HORAS_ASISTENCIA;
  if (extra <= 0) return 0;
  const horasTramo1 = Math.min(extra, 2);
  const horasTramo2 = Math.max(0, extra - 2);
  const multTramo1 = 1 + RECARGO_HORA_EXTRA_TRAMO1 + recargoNocturno;
  const multTramo2 = 1 + RECARGO_HORA_EXTRA_TRAMO2 + recargoNocturno;
  return horasTramo1 * valorHoraOrdinaria * multTramo1 + horasTramo2 * valorHoraOrdinaria * multTramo2;
}

function resumenPlanillaPorTrabajador(registros, mesYM, sueldos = ASISTENCIA_SEED_SUELDOS, montosPlanilla = {}, descuentosBonos = {}) {
  return Object.keys(sueldos || {}).filter((nombre) => Number(sueldos[nombre]) > 0).map((nombre) => {
    const sueldoBase = Number(sueldos[nombre]) || 0;
    const valorDia = sueldoBase / DIAS_MES_PLANILLA;
    const valorHora = valorDia / JORNADA_HORAS_ASISTENCIA;
    const workerKey = normalizePersonKey(nombre);
    const registrosMes = (registros || []).filter((r) => normalizePersonKey(r.trabajador) === workerKey && (r.fecha || "").slice(0, 7) === mesYM);
    const diasFalta = registrosMes.filter((r) => r.estado === "Falta").length;
    const descuentoFaltas = diasFalta * valorDia;
    const registrosPresente = registrosMes.filter((r) => r.estado === "Presente");
    const diasPresente = registrosPresente.length;
    const bonoDiario = esBonoDiarioTrabajador(nombre)
      ? registrosPresente.reduce((sum, r) => sum + montoBonoDiarioRegistro(r), 0)
      : 0;
    const montoPlanilla = Number((montosPlanilla || {})[nombre]) || 0;
    const descuentoBono = Number((descuentosBonos || {})[nombre]) || 0;
    const sueldoNeto = Math.max(0, sueldoBase - descuentoFaltas) + bonoDiario + montoPlanilla + descuentoBono;

    const montoHorasExtraBruto = registrosMes.reduce(
      (sum, r) => sum + calcularMontoHorasExtraRegistro(r, valorHora),
      0
    );

    const horasNegativas = registrosMes.reduce((sum, r) => {
      const { horas, diferencia, esBono } = calcularHorasRegistro(r);
      if (r.estado === "Falta" || horas === null || esBono || diferencia === null || diferencia >= 0) return sum;
      return sum + Math.abs(diferencia);
    }, 0);
    const descuentoHorasNegativas = horasNegativas * valorHora;
    const montoHorasExtra = Math.max(0, montoHorasExtraBruto - descuentoHorasNegativas);

    return {
      trabajador: nombre,
      sueldoBase,
      diasFalta,
      descuentoFaltas,
      diasPresente,
      bonoDiario,
      montoPlanilla,
      descuentoBono,
      sueldoNeto,
      montoHorasExtraBruto,
      horasNegativas,
      descuentoHorasNegativas,
      montoHorasExtra
    };
  });
}

const UBICACION_SEDES = {
  UPC: ["SAN ISIDRO", "SAN MIGUEL", "VILLA", "MONTERRICO"],
  UPN: ["LOS OLIVOS", "COMAS", "LIMA CENTRO", "SAN JUAN", "ATE"],
};

const ASISTENCIA_SEED_UBICACIONES = UBICACION_SEDES;

const TC_LOGO_SHIELD = LOGO_SHIELD;

// Alias de COLORS: Control de Tareas usa exactamente la misma paleta que el resto de la app.
const TC_COLORS = COLORS;

const ESTADOS = ["No empezado", "En curso", "Completado"];
const PRIORIDADES = ["Baja", "Media", "Alta"];
const FRECUENCIAS = ["Diaria", "Semanal", "Mensual"];
const ESTADO_COLOR = { "Completado": TC_COLORS.green, "En curso": TC_COLORS.amber, "No empezado": TC_COLORS.slate };
const TC_KPI_DEFS = {
  completado: { predicate: (t) => normEstado(t.estado) === "COMPLETADO" },
  encurso: { predicate: (t) => normEstado(t.estado) === "EN CURSO" },
  noempezado: { predicate: (t) => normEstado(t.estado) === "NO EMPEZADO" },
  demoradas: { predicate: (t) => cumplimiento(t) === "Demorado" },
  enplazo: { predicate: (t) => cumplimiento(t) !== "Demorado" },
};
const RESP_PALETTE = CONTACTO_PALETTE;
const DEFAULT_ALERT_PHONE = "51963325324";
const MESES_ANTIGUEDAD_AUTOARCHIVO = 2;
const DIAS_RETENCION_PAPELERA = 30;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

function monthsAgoTs(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() - n);
  return d.getTime();
}

const PERMISSION_ACTIONS = [
  { key: "ver", label: "Ver", short: "V" },
  { key: "agregar", label: "Agregar", short: "A" },
  { key: "editar", label: "Editar", short: "E" },
  { key: "eliminar", label: "Eliminar", short: "D" },
  { key: "exportar", label: "Exportar", short: "X" },
  { key: "aprobar", label: "Aprobar", short: "P" },
  { key: "adjuntar", label: "Adjuntar archivos", short: "F" },
  { key: "todos", label: "Ver información de todos los usuarios", short: "T" },
];
function makeFullPermissionMatrix() {
  return Object.fromEntries(Object.entries(DEFAULT_MODULE_PERMISSIONS).map(([k,v]) => [k, { ...v }]));
}
function normalizePermissionMatrix(user) {
  if (!user || user.role === "admin") return makeFullPermissionMatrix();
  const matrix = user.permisosPorPagina || {};
  const legacy = user.permisos || {};
  return Object.fromEntries(Object.entries(DEFAULT_MODULE_PERMISSIONS).map(([page, defaults]) => {
    const saved = matrix[page] || {};
    return [page, {
      ...defaults,
      ...saved,
      ...(matrix[page] ? {} : {
        editar: legacy.editar !== false && defaults.editar,
        agregar: legacy.agregar !== false && defaults.agregar,
        eliminar: legacy.eliminar === true && defaults.eliminar,
      }),
    }];
  }));
}
function hasModulePermission(user, page, action = "ver") {
  if (!user || user.role === "admin") return true;
  if (user.role === "asistencia_viewer") return page === "asistencia" && action === "ver";
  if (user.role === "asistencia_editor") return page === "asistencia" && ["ver", "agregar", "editar"].includes(action);
  const matrix = normalizePermissionMatrix(user);
  return !!(matrix[page] && matrix[page][action]);
}
function ownerIdentityOf(user) {
  if (!user) return "";
  const raw = typeof user === "string" ? user : (user.trabajador || user.name || "");
  return String(raw || "").trim();
}
function puedeVerTodos(user, page) {
  if (!user || user.role === "admin") return true;
  return hasModulePermission(user, page, "todos");
}
function filterOwnRecords(records, identity, fields) {
  if (!Array.isArray(records)) return records;
  const ownKey = normalizePersonKey(identity);
  if (!ownKey) return records;
  const fieldList = Array.isArray(fields) ? fields : [fields];
  return records.filter((r) => fieldList.some((f) => normalizePersonKey(r?.[f]) === ownKey));
}

const STORAGE_KEY_PROPUESTAS = "wilarcon_propuestas";

async function cargarPropuestas() {
  return await storageJSON(STORAGE_KEY_PROPUESTAS, []);
}
async function mutarPropuestas(mutateFn) {
  return mutateStorageJSON(STORAGE_KEY_PROPUESTAS, [], mutateFn);
}
function diffCampos(original, propuesto, labels = {}) {
  const cambios = [];
  const ignorar = new Set(["id", "n", "_updatedAt"]);
  const keys = new Set([...Object.keys(original || {}), ...Object.keys(propuesto || {})]);
  keys.forEach((k) => {
    if (ignorar.has(k)) return;
    const antes = (original || {})[k];
    const despues = (propuesto || {})[k];
    const a = antes === undefined || antes === null ? "" : antes;
    const b = despues === undefined || despues === null ? "" : despues;
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      cambios.push({ campo: k, etiqueta: labels[k] || k, antes: a, despues: b });
    }
  });
  return cambios;
}
function notificarCambioPropuestas() {
  try { window.dispatchEvent(new CustomEvent("wilarcon:propuestas-changed")); } catch (_) { console.error(_); }
}
async function crearPropuestaEdicion(
  { modulo, moduloLabel, storageKey, contenedor, idField = "id", recordId, original, propuesto, labels, autor, docsKeyToClear, historialEntry, sustento }
) {
  const cambios = diffCampos(original, propuesto, labels);
  if (!cambios.length) return null;
  const autorNombre = (autor && (autor.nombre || autor.name)) || autor || "Usuario";
  let resultado = null;
  try {
    await mutarPropuestas((lista) => {
      // Autoguardado continuo: mientras el mismo usuario sigue editando el mismo registro
      // (varias pausas de escritura -> varios intentos de guardado antes de que un admin
      // resuelva algo), esto ACTUALIZA la propuesta pendiente existente en vez de crear una
      // nueva cada vez. Sin esto, cada pausa generaría una solicitud de aprobación separada
      // y superpuesta para el mismo cambio.
      const idx = lista.findIndex((p) =>
        p.estado === "pendiente" && p.accion === "editar" && p.modulo === modulo &&
        String(p.recordId) === String(recordId) && p.autor === autorNombre
      );
      if (idx !== -1) {
        resultado = {
          ...lista[idx], propuesto, cambios, fecha: Date.now(),
          sustento: sustento || lista[idx].sustento || "",
        };
        const next = [...lista];
        next[idx] = resultado;
        return next;
      }
      resultado = {
        id: uid(), modulo, moduloLabel, storageKey, contenedor: contenedor || null, idField, recordId,
        accion: "editar", original, propuesto, cambios,
        autor: autorNombre,
        fecha: Date.now(), estado: "pendiente", vistoAutor: false,
        sustento: sustento || "",
        docsKeyToClear: docsKeyToClear || null, historialEntry: historialEntry || null,
      };
      return [resultado, ...lista];
    });
    notificarCambioPropuestas();
    return resultado;
  } catch (e) {
    console.error("no se pudo guardar la propuesta", e);
    throw new Error("No se pudo enviar la solicitud de aprobación. El cambio no fue aplicado.");
  }
}
async function crearPropuestaEliminacion(
  { modulo, moduloLabel, storageKey, contenedor, idField = "id", recordId, resumen, autor, docsKeyToClear, historialEntry, sustento }
) {
  const nueva = {
    id: uid(), modulo, moduloLabel, storageKey, contenedor: contenedor || null, idField, recordId,
    accion: "eliminar", original: null, propuesto: null, cambios: [], resumen: resumen || "",
    autor: (autor && (autor.nombre || autor.name)) || autor || "Usuario",
    fecha: Date.now(), estado: "pendiente", vistoAutor: false,
    sustento: sustento || "",
    docsKeyToClear: docsKeyToClear || null, historialEntry: historialEntry || null,
  };
  try {
    await mutarPropuestas((lista) => [nueva, ...lista]);
    notificarCambioPropuestas();
    return nueva;
  } catch (e) {
    console.error("no se pudo guardar la propuesta de eliminación", e);
    throw new Error("No se pudo enviar la solicitud de aprobación. El registro no fue eliminado.");
  }
}
async function aprobarPropuesta(propuestaId, adminUser) {
  const nombreAdmin = (adminUser && (adminUser.nombre || adminUser.name)) || adminUser || "Administrador";
  let propuesta = null;
  try {
    await mutarPropuestas((lista) => {
      const idx = lista.findIndex((x) => x.id === propuestaId);
      if (idx === -1 || lista[idx].estado !== "pendiente") return lista;
      propuesta = lista[idx];
      const next = [...lista];
      next[idx] = { ...next[idx], estado: "procesando", procesadoPor: nombreAdmin, procesadoFecha: Date.now() };
      return next;
    });
  } catch (e) {
    console.error("no se pudo reservar la propuesta", e);
    return { ok: false, reason: "error_reserva" };
  }
  if (!propuesta) return { ok: false, reason: "no_pendiente" };
  const esEliminacion = propuesta.accion === "eliminar";
  let aplicado = false;
  try {
    await mutateStorageJSON(propuesta.storageKey, propuesta.contenedor ? {} : [], (data) => {
      if (propuesta.contenedor) {
        const arr = Array.isArray(data?.[propuesta.contenedor]) ? data[propuesta.contenedor] : [];
        const found = arr.some((r) => String(r?.[propuesta.idField]) === String(propuesta.recordId));
        if (!found) throw new Error("registro_no_encontrado");
        aplicado = true;
        if (esEliminacion) {
          return { ...data, [propuesta.contenedor]: arr.filter((r) => String(r?.[propuesta.idField]) !== String(propuesta.recordId)) };
        }
        return { ...data, [propuesta.contenedor]: arr.map((r) => String(r?.[propuesta.idField]) === String(propuesta.recordId) ? { ...r, ...propuesta.propuesto, _updatedAt: Date.now() } : r) };
      }
      const arr = Array.isArray(data) ? data : [];
      const found = arr.some((r) => String(r?.[propuesta.idField]) === String(propuesta.recordId));
      if (!found) throw new Error("registro_no_encontrado");
      aplicado = true;
      if (esEliminacion) {
        return arr.filter((r) => String(r?.[propuesta.idField]) !== String(propuesta.recordId));
      }
      return arr.map((r) => String(r?.[propuesta.idField]) === String(propuesta.recordId) ? { ...r, ...propuesta.propuesto, _updatedAt: Date.now() } : r);
    });
    if (!aplicado) throw new Error("registro_no_encontrado");
  } catch (e) {
    console.error("no se pudo aplicar la propuesta aprobada", e);
    try {
      await mutarPropuestas((lista) => lista.map((x) => x.id === propuestaId ? { ...x, estado: "conflicto", motivoConflicto: String(e?.message || "No se pudo aplicar el cambio"), resueltoPor: nombreAdmin, resueltoFecha: Date.now() } : x));
      notificarCambioPropuestas();
    } catch (_) { console.error(_); }
    return { ok: false, reason: "conflicto", propuesta };
  }
  if (propuesta.docsKeyToClear) {
    try { await window.storage.set(propuesta.docsKeyToClear, JSON.stringify([]), true); } catch (e) { console.error("no se pudo limpiar adjuntos de la propuesta aprobada", e); }
  }
  if (propuesta.historialEntry) {
    try {
      await mutateStorageJSON(STORAGE_KEY_HISTORY, [], (data) => {
        const prev = Array.isArray(data) ? data : [];
        return [{ ts: Date.now(), ...propuesta.historialEntry }, ...prev].slice(0, MAX_HISTORY);
      });
    } catch (e) { console.error("no se pudo registrar en el historial la propuesta aprobada", e); }
  }
  try {
    await mutarPropuestas((lista) => lista.map((x) => x.id === propuestaId ? { ...x, estado: "aprobada", resueltoPor: nombreAdmin, resueltoFecha: Date.now() } : x));
    notificarCambioPropuestas();
    return { ok: true, propuesta };
  } catch (e) {
    console.error("no se pudo marcar la propuesta como aprobada", e);
    return { ok: false, reason: "estado_no_actualizado", propuesta };
  }
}

async function rechazarPropuesta(propuestaId, adminUser, motivo) {
  try {
    let encontrada = false;
    await mutarPropuestas((lista) => {
      const idx = lista.findIndex((p) => p.id === propuestaId && p.estado === "pendiente");
      if (idx === -1) return lista;
      encontrada = true;
      const next = [...lista];
      next[idx] = { ...next[idx], estado: "rechazada", resueltoPor: (adminUser && (adminUser.nombre || adminUser.name)) || adminUser || "Administrador", resueltoFecha: Date.now(), motivoRechazo: motivo || "" };
      return next;
    });
    if (encontrada) notificarCambioPropuestas();
    return { ok: encontrada, reason: encontrada ? undefined : "no_pendiente" };
  } catch (e) { console.error("no se pudo rechazar la propuesta", e); return { ok: false, reason: "error" }; }
}
async function intentarGuardarConAprobacion(
  { puedeAprobar, modulo, moduloLabel, storageKey, contenedor, idField = "id", recordId, original, propuesto, labels, autor, persistDirecto, docsKeyToClear, historialEntry, pedirSustento, sustentoRef }
) {
  if (puedeAprobar) {
    await persistDirecto(original ? "editar" : "crear");
    return { enviadoAprobacion: false };
  }
  // sustentoRef (opcional): un ref mutable ({current}) que vive mientras dura la sesión de
  // edición del formulario. Con autoguardado continuo, esta función puede llamarse varias
  // veces (una por cada pausa de escritura) para el mismo registro; sin este cache se
  // pediría el sustento una y otra vez. Se pide una sola vez por sesión y se reutiliza en
  // los siguientes autoguardados hasta que el llamador reinicie el ref (nueva edición).
  let sustento = (sustentoRef && sustentoRef.current) || "";
  if (!sustento && pedirSustento) {
    sustento = await pedirSustento();
    if (!sustento) return { enviadoAprobacion: false, cancelado: true };
    if (sustentoRef) sustentoRef.current = sustento;
  }
  const propuesta = await crearPropuestaEdicion({ modulo, moduloLabel, storageKey, contenedor, idField, recordId, original, propuesto, labels, autor, docsKeyToClear, historialEntry, sustento });
  if (!propuesta)
    return { enviadoAprobacion: false };
  return { enviadoAprobacion: true, propuesta };
}
async function intentarEliminarConAprobacion(
  { puedeAprobar, modulo, moduloLabel, storageKey, contenedor, idField = "id", recordId, resumen, autor, persistDirecto, docsKeyToClear, historialEntry, pedirSustento }
) {
  if (puedeAprobar) {
    await persistDirecto("eliminar");
    return { enviadoAprobacion: false };
  }
  let sustento = "";
  if (pedirSustento) {
    sustento = await pedirSustento();
    if (!sustento) return { enviadoAprobacion: false, cancelado: true };
  }
  const propuesta = await crearPropuestaEliminacion({ modulo, moduloLabel, storageKey, contenedor, idField, recordId, resumen, autor, docsKeyToClear, historialEntry, sustento });
  return { enviadoAprobacion: true, propuesta };
}
function usePropuestasPendientes(activo) {
  const [propuestas, setPropuestas] = useState([]);
  useEffect(() => {
    if (!activo) { setPropuestas([]); return; }
    let cancelado = false;
    async function tick() {
      if (document.hidden) return;
      try {
        const lista = await cargarPropuestas();
        if (!cancelado) setPropuestas(Array.isArray(lista) ? lista.filter((p) => p.estado === "pendiente").sort((a, b) => b.fecha - a.fecha) : []);
      } catch (_) { console.error(_); }
    }
    tick();
    const onChange = () => tick();
    const onVisible = () => { if (!document.hidden) tick(); };
    window.addEventListener("wilarcon:propuestas-changed", onChange);
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(tick, 25000);
    return () => { cancelado = true; clearInterval(id); window.removeEventListener("wilarcon:propuestas-changed", onChange); document.removeEventListener("visibilitychange", onVisible); };
  }, [activo]);
  return propuestas;
}
function usePropuestasUsuario(autor, activo) {
  const [propuestas, setPropuestas] = useState([]);
  useEffect(() => {
    if (!activo || !autor) { setPropuestas([]); return; }
    let cancelado = false;
    async function tick() {
      if (document.hidden) return;
      try {
        const lista = await cargarPropuestas();
        if (!cancelado) {
          setPropuestas(
            Array.isArray(lista)
              ? lista
                  .filter((p) => p.autor === autor && p.estado !== "pendiente" && p.estado !== "procesando" && !p.vistoAutor)
                  .sort((a, b) => (b.resueltoFecha || b.fecha) - (a.resueltoFecha || a.fecha))
              : []
          );
        }
      } catch (_) { console.error(_); }
    }
    tick();
    const onChange = () => tick();
    const onVisible = () => { if (!document.hidden) tick(); };
    window.addEventListener("wilarcon:propuestas-changed", onChange);
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(tick, 45000);
    return () => { cancelado = true; clearInterval(id); window.removeEventListener("wilarcon:propuestas-changed", onChange); document.removeEventListener("visibilitychange", onVisible); };
  }, [activo, autor]);
  return propuestas;
}
async function marcarPropuestasVistasPorAutor(autor) {
  if (!autor) return;
  try {
    await mutarPropuestas((lista) => lista.map((p) => (p.autor === autor && p.estado !== "pendiente" && p.estado !== "procesando" && !p.vistoAutor) ? { ...p, vistoAutor: true } : p));
    notificarCambioPropuestas();
  } catch (e) { console.error("no se pudo marcar las solicitudes como vistas", e); }
}
const STORAGE_KEY_COTIZACION_REVISIONES = "wilarcon_cotizacion_revisiones";

async function cargarRevisionesCotizacion() {
  return await storageJSON(STORAGE_KEY_COTIZACION_REVISIONES, []);
}
async function mutarRevisionesCotizacion(mutateFn) {
  return mutateStorageJSON(STORAGE_KEY_COTIZACION_REVISIONES, [], mutateFn);
}
function notificarCambioRevisionesCotizacion() {
  try { window.dispatchEvent(new CustomEvent("wilarcon:revisiones-cotizacion-changed")); } catch (_) { console.error(_); }
}
// Solicitud de revisión de una cotización: se crea cuando el usuario presiona "Presentar" y
// queda pendiente hasta que alguien con permiso de aprobar (o admin) la aprueba desde el
// panel de la página de Cotización (ahí también puede ver el PDF antes de decidir).
async function crearSolicitudRevisionCotizacion({ cotizacionId, numero, contacto, solicitud, autor }) {
  const nueva = {
    id: uid(), cotizacionId, numero: numero || "", contacto: contacto || "", solicitud: solicitud || "",
    autor: (autor && (autor.nombre || autor.name)) || autor || "Usuario",
    fecha: Date.now(), estado: "pendiente",
  };
  try {
    await mutarRevisionesCotizacion((lista) => [nueva, ...lista]);
    notificarCambioRevisionesCotizacion();
    return nueva;
  } catch (e) {
    console.error("no se pudo crear la solicitud de revisión de cotización", e);
    throw new Error("No se pudo enviar la solicitud de revisión.");
  }
}
// Resuelve (aprueba o rechaza) una solicitud pendiente. Al aprobar, además marca la
// cotización correspondiente como "aprobada" (queda lista para el botón azul "Enviar").
// `comentario` es opcional: si el aprobador escribe algo, queda guardado en la propia
// solicitud para que el usuario que la creó lo vea en su panel "Respuestas a tus solicitudes".
async function resolverRevisionCotizacion(solicitudId, aprobador, aprobar, comentario) {
  const nombre = (aprobador && (aprobador.nombre || aprobador.name)) || aprobador || "Administrador";
  let solicitud = null;
  try {
    await mutarRevisionesCotizacion((lista) => {
      const idx = lista.findIndex((x) => x.id === solicitudId && x.estado === "pendiente");
      if (idx === -1) return lista;
      solicitud = lista[idx];
      const next = [...lista];
      next[idx] = { ...next[idx], estado: aprobar ? "aprobada" : "rechazada", resueltoPor: nombre, resueltoFecha: Date.now(), comentario: String(comentario || "").trim() };
      return next;
    });
  } catch (e) {
    console.error("no se pudo resolver la solicitud de revisión de cotización", e);
    return { ok: false, reason: "error" };
  }
  if (!solicitud) return { ok: false, reason: "no_pendiente" };
  if (aprobar) {
    try {
      await mutateStorageJSON(STORAGE_KEY_COTIZACIONES, [], (data) => {
        const arr = Array.isArray(data) ? data : [];
        return arr.map((c) => (c.id === solicitud.cotizacionId
          ? { ...c, estadoRevision: "aprobada", revisionAprobadaPor: nombre, revisionAprobadaFecha: Date.now() }
          : c));
      });
    } catch (e) {
      console.error("no se pudo marcar la cotización como aprobada", e);
      return { ok: false, reason: "error_aplicar", solicitud };
    }
  }
  notificarCambioRevisionesCotizacion();
  return { ok: true, solicitud };
}
function useRevisionesCotizacionPendientes(activo) {
  const [revisiones, setRevisiones] = useState([]);
  useEffect(() => {
    if (!activo) { setRevisiones([]); return; }
    let cancelado = false;
    async function tick() {
      if (document.hidden) return;
      try {
        const lista = await cargarRevisionesCotizacion();
        if (!cancelado) setRevisiones(Array.isArray(lista) ? lista.filter((r) => r.estado === "pendiente").sort((a, b) => b.fecha - a.fecha) : []);
      } catch (_) { console.error(_); }
    }
    tick();
    const onChange = () => tick();
    const onVisible = () => { if (!document.hidden) tick(); };
    window.addEventListener("wilarcon:revisiones-cotizacion-changed", onChange);
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(tick, 25000);
    return () => { cancelado = true; clearInterval(id); window.removeEventListener("wilarcon:revisiones-cotizacion-changed", onChange); document.removeEventListener("visibilitychange", onVisible); };
  }, [activo]);
  return revisiones;
}
// Respuestas (aprobada/rechazada, con el comentario del aprobador) a las solicitudes de
// revisión de cotización que presentó este usuario, todavía no vistas por él. Mismo patrón
// que usePropuestasUsuario para el flujo de ediciones.
function useRevisionesCotizacionUsuario(autor, activo) {
  const [revisiones, setRevisiones] = useState([]);
  useEffect(() => {
    if (!activo || !autor) { setRevisiones([]); return; }
    let cancelado = false;
    async function tick() {
      if (document.hidden) return;
      try {
        const lista = await cargarRevisionesCotizacion();
        if (!cancelado) {
          setRevisiones(
            Array.isArray(lista)
              ? lista
                  .filter((r) => r.autor === autor && r.estado !== "pendiente" && !r.vistoAutor)
                  .sort((a, b) => (b.resueltoFecha || b.fecha) - (a.resueltoFecha || a.fecha))
              : []
          );
        }
      } catch (_) { console.error(_); }
    }
    tick();
    const onChange = () => tick();
    const onVisible = () => { if (!document.hidden) tick(); };
    window.addEventListener("wilarcon:revisiones-cotizacion-changed", onChange);
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(tick, 45000);
    return () => { cancelado = true; clearInterval(id); window.removeEventListener("wilarcon:revisiones-cotizacion-changed", onChange); document.removeEventListener("visibilitychange", onVisible); };
  }, [activo, autor]);
  return revisiones;
}
async function marcarRevisionesCotizacionVistas(autor) {
  if (!autor) return;
  try {
    await mutarRevisionesCotizacion((lista) => lista.map((r) => (r.autor === autor && r.estado !== "pendiente" && !r.vistoAutor) ? { ...r, vistoAutor: true } : r));
    notificarCambioRevisionesCotizacion();
  } catch (e) { console.error("no se pudo marcar las revisiones de cotización como vistas", e); }
}

function fmtFechaHora(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function resumenPropuesta(p) {
  if (p.resumen)
    return p.resumen;
  const rec = p.propuesto || p.original || {};
  const partes = (() => {
    switch (p.modulo) {
      case "trabajos": return [rec.oc && `OC ${rec.oc}`, rec.cliente || rec.proyecto, rec.proveedor];
      case "torre": return [rec.tarea, rec.responsable];
      case "asistencia": return [rec.trabajador, rec.fecha];
      case "contactos": return [rec.contacto, rec.cargo];
      case "cuentas": return [rec.nombre, rec.usuario];
      case "gastos": return [rec.descripcion || rec.tipo, rec.oc && `OC ${rec.oc}`];
      case "responsabilidades": return [rec.area, rec.tarea, rec.responsable];
      case "viaticos": return [rec.trabajador, rec.descripcion];
      default: return [];
    }
  })();
  return partes.filter(Boolean).join(" — ");
}
function PropuestasPanel({ propuestas, onAprobar, onRechazar, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: 16 }} onClick={onClose}>
      <div style={{ background: "#121821", border: "1px solid #262f3d", borderRadius: 12, padding: 20, width: 660, maxWidth: "100%", maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <b style={{ color: "#eef2f8", fontSize: 15 }}>Solicitudes pendientes de aprobación {propuestas.length ? `(${propuestas.length})` : ""}</b>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "#6d7889", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        {!propuestas.length && (
          <div style={{ padding: 28, textAlign: "center", color: "#3ddc97", fontSize: 12.5 }}>✓ No hay solicitudes pendientes de aprobación.</div>
        )}
        {propuestas.map((p) => {
          const esEliminacion = p.accion === "eliminar";
          const resumen = resumenPropuesta(p);
          return (
            <div key={p.id} style={{ border: `1px solid ${esEliminacion ? "#4a2530" : "#262f3d"}`, borderRadius: 9, padding: 13, marginBottom: 10, background: "#19212c" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", fontSize: 11, color: "#95a2b5", marginBottom: 4, gap: 10 }}>
                <span>
                  <span style={{ background: esEliminacion ? "#3a1c22" : "#132a20", color: esEliminacion ? "#ff5c66" : "#3ddc97", borderRadius: 5, padding: "2px 6px", fontSize: 10, fontWeight: 700, marginRight: 6 }}>
                    {esEliminacion ? "ELIMINAR" : "EDITAR"}
                  </span>
                  <b style={{ color: "#eef2f8" }}>{p.moduloLabel}</b> · propuesto por {p.autor}
                </span>
                <span style={{ whiteSpace: "nowrap" }}>{fmtFechaHora(p.fecha)}</span>
              </div>
              {resumen && (
                <div style={{ fontSize: 13, color: "#c8d0dd", fontWeight: 600, marginBottom: 9 }}>{resumen}</div>
              )}
              <div style={{ marginBottom: 10 }}>
                {esEliminacion ? (
                  <div style={{ fontSize: 12.5, color: "#eef2f8" }}>
                    Solicita eliminar este registro{p.recordId ? <span style={{ color: "#6d7889" }}> (id {p.recordId})</span> : null}.
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 10, color: "#6d7889", fontWeight: 700, marginBottom: 5, textTransform: "uppercase", letterSpacing: .3 }}>
                      {p.cambios.length} campo{p.cambios.length === 1 ? "" : "s"} modificado{p.cambios.length === 1 ? "" : "s"}
                    </div>
                    {p.cambios.map((c, i) => (
                      <div key={i} style={{ fontSize: 12.5, color: "#eef2f8", marginBottom: 3 }}>
                        <b>{c.etiqueta}:</b>{" "}
                        <span style={{ color: "#ff5c66", textDecoration: "line-through" }}>{String(c.antes) || "—"}</span>
                        {" → "}
                        <span style={{ color: "#3ddc97" }}>{String(c.despues) || "—"}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
              {p.sustento && (
                <div style={{ background: "#121821", border: "1px solid #262f3d", borderRadius: 7, padding: "8px 10px", marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: "#6d7889", fontWeight: 700, marginBottom: 3, textTransform: "uppercase", letterSpacing: .3 }}>Sustento</div>
                  <div style={{ fontSize: 12, color: "#c7cedb", whiteSpace: "pre-wrap" }}>{p.sustento}</div>
                </div>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => onRechazar(p)} style={{ background: "transparent", border: "1px solid #ff5c66", color: "#ff5c66", borderRadius: 7, padding: "6px 13px", fontSize: 12, cursor: "pointer" }}>Rechazar</button>
                <button onClick={() => onAprobar(p)} style={{ background: esEliminacion ? "#ff5c66" : "#3ddc97", border: "none", color: esEliminacion ? "#2a0d10" : "#08251b", borderRadius: 7, padding: "6px 13px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{esEliminacion ? "Aprobar y eliminar" : "Aprobar"}</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function MisPropuestasPanel({ propuestas, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: 16 }} onClick={onClose}>
      <div style={{ background: "#121821", border: "1px solid #262f3d", borderRadius: 12, padding: 20, width: 620, maxWidth: "100%", maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <b style={{ color: "#eef2f8", fontSize: 15 }}>Respuestas a tus solicitudes {propuestas.length ? `(${propuestas.length})` : ""}</b>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "#6d7889", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        {!propuestas.length && (
          <div style={{ padding: 28, textAlign: "center", color: "#95a2b5", fontSize: 12.5 }}>No tienes respuestas nuevas.</div>
        )}
        {propuestas.map((p) => {
          const esEliminacion = p.accion === "eliminar";
          const aprobada = p.estado === "aprobada";
          const colorEstado = aprobada ? "#3ddc97" : p.estado === "conflicto" ? COLORS.conflict : "#ff5c66";
          const textoEstado = aprobada ? "Aprobada" : p.estado === "conflicto" ? "No se pudo aplicar" : "Rechazada";
          return (
            <div key={p.id} style={{ border: "1px solid #262f3d", borderRadius: 9, padding: 13, marginBottom: 10, background: "#19212c" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#95a2b5", marginBottom: 8 }}>
                <span>
                  {esEliminacion && <span style={{ background: "#3a1c22", color: "#ff5c66", borderRadius: 5, padding: "2px 6px", fontSize: 10, fontWeight: 700, marginRight: 6 }}>ELIMINAR</span>}
                  <b style={{ color: "#eef2f8" }}>{p.moduloLabel}</b>
                </span>
                <span style={{ color: colorEstado, fontWeight: 700 }}>{textoEstado}</span>
              </div>
              <div style={{ fontSize: 12.5, color: "#eef2f8", marginBottom: 6 }}>
                {resumenPropuesta(p) || (esEliminacion ? `registro ${p.recordId}` : "")}
                {!esEliminacion && <span style={{ color: "#95a2b5" }}>{resumenPropuesta(p) ? " · " : ""}{p.cambios.length} campo(s) modificado(s)</span>}
              </div>
              {p.motivoRechazo && <div style={{ fontSize: 11.5, color: "#95a2b5" }}>Motivo: {p.motivoRechazo}</div>}
              <div style={{ fontSize: 10.5, color: "#6d7889", marginTop: 6 }}>por {p.resueltoPor || "—"} · {fmtFechaHora(p.resueltoFecha || p.fecha)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MisRevisionesCotizacionPanel({ revisiones, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: 16 }} onClick={onClose}>
      <div style={{ background: "#121821", border: "1px solid #262f3d", borderRadius: 12, padding: 20, width: 560, maxWidth: "100%", maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <b style={{ color: "#eef2f8", fontSize: 15 }}>Respuestas a tus solicitudes de cotización {revisiones.length ? `(${revisiones.length})` : ""}</b>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "#6d7889", cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        {!revisiones.length && (
          <div style={{ padding: 28, textAlign: "center", color: "#95a2b5", fontSize: 12.5 }}>No tienes respuestas nuevas.</div>
        )}
        {revisiones.map((r) => {
          const aprobada = r.estado === "aprobada";
          return (
            <div key={r.id} style={{ border: "1px solid #262f3d", borderRadius: 9, padding: 13, marginBottom: 10, background: "#19212c" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#95a2b5", marginBottom: 8 }}>
                <span>
                  <b style={{ color: "#eef2f8" }}>{r.numero || "—"}</b>{r.contacto ? ` · ${r.contacto}` : ""}
                </span>
                <span style={{ color: aprobada ? "#3ddc97" : "#ff5c66", fontWeight: 700 }}>{aprobada ? "Aprobada" : "Rechazada"}</span>
              </div>
              {r.comentario && (
                <div style={{ background: "#121821", border: "1px solid #262f3d", borderRadius: 7, padding: "8px 10px", marginBottom: 8 }}>
                  <div style={{ fontSize: 10, color: "#6d7889", fontWeight: 700, marginBottom: 3, textTransform: "uppercase", letterSpacing: .3 }}>Comentario</div>
                  <div style={{ fontSize: 12, color: "#c7cedb", whiteSpace: "pre-wrap" }}>{r.comentario}</div>
                </div>
              )}
              <div style={{ fontSize: 10.5, color: "#6d7889" }}>por {r.resueltoPor || "—"} · {fmtFechaHora(r.resueltoFecha || r.fecha)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function AprobarRevisionCotizacionModal({ revision, onConfirmar, onCancelar }) {
  const [comentario, setComentario] = useState("");
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500, padding: 16 }} onClick={onCancelar}>
      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20, width: 460, maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <b style={{ color: COLORS.text, fontSize: 15 }}>Aprobar cotización {revision?.numero || ""}</b>
          <button onClick={onCancelar} style={{ background: "transparent", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: COLORS.dim, marginBottom: 10, lineHeight: 1.4 }}>
          Puedes dejar un comentario opcional para {revision?.autor || "quien la solicitó"}; lo verá en sus respuestas.
        </div>
        <textarea
          autoFocus
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          placeholder="Ej: revisado, todo conforme. / Ej: falta ajustar el ítem 3 antes de enviar..."
          rows={4}
          style={{ width: "100%", boxSizing: "border-box", background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text, padding: 10, fontSize: 12.5, resize: "vertical", fontFamily: "inherit" }}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onCancelar} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, borderRadius: 7, padding: "7px 14px", fontSize: 12, cursor: "pointer" }}>Cancelar</button>
          <button
            onClick={() => onConfirmar(comentario.trim())}
            style={{ background: COLORS.green, border: "none", color: COLORS.greenTextDark, borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
          >Aprobar</button>
        </div>
      </div>
    </div>
  );
}

function SustentoModal({ onConfirmar, onCancelar }) {
  const [texto, setTexto] = useState("");
  const puedeEnviar = texto.trim().length >= 5;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500, padding: 16 }} onClick={onCancelar}>
      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20, width: 460, maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <b style={{ color: COLORS.text, fontSize: 15 }}>Sustento del cambio</b>
          <button onClick={onCancelar} style={{ background: "transparent", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: COLORS.dim, marginBottom: 10, lineHeight: 1.4 }}>
          Este cambio requiere aprobación de un administrador. Escribe brevemente el motivo antes de enviarlo.
        </div>
        <textarea
          autoFocus
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Ej: se corrige el monto porque el proveedor emitió una nueva factura..."
          rows={4}
          style={{ width: "100%", boxSizing: "border-box", background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text, padding: 10, fontSize: 12.5, resize: "vertical", fontFamily: "inherit" }}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onCancelar} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, borderRadius: 7, padding: "7px 14px", fontSize: 12, cursor: "pointer" }}>Cancelar</button>
          <button
            disabled={!puedeEnviar}
            onClick={() => puedeEnviar && onConfirmar(texto.trim())}
            style={{ background: puedeEnviar ? COLORS.amber : COLORS.border, border: "none", color: puedeEnviar ? COLORS.amberText : COLORS.faint, borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: puedeEnviar ? "pointer" : "not-allowed" }}
          >Enviar solicitud</button>
        </div>
      </div>
    </div>
  );
}
function MensajeModal({ tipo = "info", titulo, mensaje, onClose }) {
  const acento = tipo === "error" ? COLORS.red : tipo === "exito" ? COLORS.green : COLORS.amber;
  const icono = tipo === "error" ? "✕" : tipo === "exito" ? "✓" : "!";
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500, padding: 16 }} onClick={onClose}>
      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20, width: 400, maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 14 }}>
          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: "50%", background: `${acento}22`, color: acento, fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{icono}</span>
          <div style={{ flex: 1 }}>
            <b style={{ color: COLORS.text, fontSize: 14.5 }}>{titulo || "Aviso"}</b>
            <div style={{ fontSize: 12.5, color: COLORS.dim, marginTop: 6, lineHeight: 1.45 }}>{mensaje}</div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: COLORS.amber, border: "none", color: COLORS.amberText, borderRadius: 7, padding: "7px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Entendido</button>
        </div>
      </div>
    </div>
  );
}
function useSustentoGate() {
  const [pendiente, setPendiente] = useState(null);
  const solicitar = () => new Promise((resolve) => setPendiente({ resolve }));
  const confirmar = (texto) => { if (pendiente) pendiente.resolve(texto); setPendiente(null); };
  const cancelar = () => { if (pendiente) pendiente.resolve(null); setPendiente(null); };
  const modal = pendiente ? <SustentoModal onConfirmar={confirmar} onCancelar={cancelar} /> : null;
  return { solicitar, modal };
}

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function nowTimeStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function diasRestantes(fin) {
  if (!fin) return null;
  const [y, m, d] = fin.split("-").map(Number);
  if (![y, m, d].every(Number.isInteger) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const target = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / MS_POR_DIA);
}
function cumplimiento(t) {
  if (t.estado === "Completado") {
    // Si se cerró después del fin del día de la fecha límite, cuenta como demorado.
    // Tareas legacy sin completadoAt (creadas antes de registrar este dato) no se
    // pueden verificar retroactivamente, así que se mantienen como "En plazo".
    if (!t.completadoAt || !t.fin) return "En plazo";
    const [y, m, d] = t.fin.split("-").map(Number);
    if (![y, m, d].every(Number.isInteger) || m < 1 || m > 12 || d < 1 || d > 31) return "En plazo";
    const finLimite = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
    return t.completadoAt > finLimite ? "Demorado" : "En plazo";
  }
  const dias = diasRestantes(t.fin);
  if (dias === null) return "En plazo";
  return dias < 0 ? "Demorado" : "En plazo";
}
function addPeriod(dateStr, frecuencia) {
  if (!dateStr) return dateStr;
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (frecuencia === "Diaria") date.setDate(date.getDate() + 1);
  else if (frecuencia === "Semanal") date.setDate(date.getDate() + 7);
  else if (frecuencia === "Mensual") date.setMonth(date.getMonth() + 1);
  else return dateStr;
  return date.toISOString().slice(0, 10);
}
function tcInitials(name) {
  return (name || "?").trim().slice(0, 2).toUpperCase();
}
function colorForResp(name, list) {
  const idx = list.indexOf(name);
  return RESP_PALETTE[idx % RESP_PALETTE.length] || TC_COLORS.slate;
}
function fmtRelTime(ts) {
  if (!ts) return "nunca";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return "justo ahora";
  if (s < 60) return `hace ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const dd = Math.round(h / 24);
  return `hace ${dd} d`;
}
function tcCsvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function fieldLabel(field) {
  const map = { tarea: "tarea", responsable: "responsable", prioridad: "prioridad", inicio: "fecha de inicio", fin: "fecha de fin", estado: "estado", obs: "observaciones" };
  return map[field] || field;
}
function describeLog(entry) {
  const who = entry.actor || "Alguien";
  const name = entry.taskTarea ? `"${entry.taskTarea}"` : "una tarea";
  if (entry.action === "add") return `${who} creo la tarea ${name}`;
  if (entry.action === "trash") return `${who} elimino la tarea ${name}`;
  if (entry.action === "auto_trash") return `Sistema envio automaticamente a la papelera la tarea ${name} (completada hace mas de ${MESES_ANTIGUEDAD_AUTOARCHIVO} meses)`;
  if (entry.action === "auto_purge") return `Sistema elimino definitivamente la tarea ${name} (${DIAS_RETENCION_PAPELERA} dias en papelera)`;
  if (entry.action === "restore") return `${who} restauro la tarea ${name} desde la papelera`;
  if (entry.action === "permanent_delete") return `${who} elimino definitivamente la tarea ${name}`;
  if (entry.action === "empty_trash") return `${who} vacio la papelera (${entry.count} tarea${entry.count === 1 ? "" : "s"})`;
  if (entry.action === "user_add") return `${who} creo el usuario "${entry.targetUser}"`;
  if (entry.action === "user_reset_password") return `${who} restablecio la contraseña de "${entry.targetUser}"`;
  if (entry.action === "user_delete") return `${who} elimino el usuario "${entry.targetUser}"`;
  if (entry.action === "recurring_reset") return `${who} completo el ciclo de ${name}${entry.nextFin ? ` y se reprogramo para el ${entry.nextFin}` : " y se reprogramo"}`;
  if (entry.action === "edit") {
    const before = entry.before === "" || entry.before == null ? "(vacio)" : entry.before;
    const after = entry.after === "" || entry.after == null ? "(vacio)" : entry.after;
    return `${who} cambio ${fieldLabel(entry.field)} de ${name}: "${before}" → "${after}"`;
  }
  return `${who} hizo un cambio en ${name}`;
}

function TcKpi({ label, value, icon, tone, onClick, active, sub }) {
  const toneColor = tone === "red" ? TC_COLORS.red : tone === "green" ? TC_COLORS.green : tone === "amber" ? TC_COLORS.amber : TC_COLORS.text;
  return (
    <div
      onClick={onClick}
      style={{
        background: active ? TC_COLORS.amberDim : TC_COLORS.panel,
        border: `1px solid ${active ? TC_COLORS.amber : tone === "red" ? TC_COLORS.redDim : TC_COLORS.border}`,
        borderRadius: 10, padding: "14px 16px",
        cursor: onClick ? "pointer" : "default",
        transition: "border-color .15s, background .15s",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: 11, color: active ? TC_COLORS.amber : TC_COLORS.dim, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
        <div style={{ opacity: 0.7 }}>{icon}</div>
      </div>
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 26, fontWeight: 700, marginTop: 6, color: toneColor }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: TC_COLORS.faint, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const STORAGE_KEY_CONTACTOS = "wilarcon_contactos_records";
const STORAGE_KEY_CUENTAS = "wilarcon_cuentas_records";

function emptyContactoDraft() {
  return { contacto: "", cargo: "", direccion: "", telefono: "" };
}
function emptyCuentaDraft() {
  return { nombre: "", ruc: "", telefono: "", banco: "", numeroCuenta: "" };
}

const STORAGE_KEY_VIATICOS = "wilarcon_viaticos_records";

function emptyViaticoDraft() {
  return { trabajador: "", fecha: "", descripcion: "", oc: "", monto: "" };
}

function ViaticoForm({ value, onChange, trabajadores = [], ocOptions = [] }) {
  const isMobile = useIsMobile();
  const fields = [
    { key: "trabajador", label: "Trabajador" },
    { key: "fecha", label: "Fecha", type: "date" },
    { key: "descripcion", label: "Descripción", full: true },
    { key: "oc", label: "OC" },
    { key: "monto", label: "Monto (S/) — negativo = descuento", type: "number" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
      {fields.map((f) => (
        <div key={f.key} style={{ gridColumn: f.full ? "1 / -1" : "auto" }}>
          <div style={{ fontSize: 10, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>{f.label}</div>
          {f.key === "oc" ? (
            <OCSelector value={value[f.key] ?? ""} onChange={(v) => onChange({ ...value, oc: v })} options={ocOptions} />
          ) : f.key === "trabajador" && trabajadores.length > 0 ? (
            <OCSelector
              value={value[f.key] ?? ""}
              onChange={(v) => onChange({ ...value, trabajador: v })}
              options={trabajadores}
              placeholder="Seleccionar trabajador…"
            />
          ) : (
            <input
              className="ct-input2"
              type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
              step={f.type === "number" ? "0.01" : undefined}
              value={value[f.key] ?? ""}
              onChange={(e) => onChange({ ...value, [f.key]: f.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : f.type === "date" ? e.target.value : e.target.value.toUpperCase() })}
            />
          )}
        </div>
      ))}
    </div>
  );
}

const STORAGE_KEY_GASTOS = "wilarcon_gastos_records";

function emptyGastoDraft() {
  return {
    tipo: "egreso",
    descripcion: "",
    fecha: todayStr(),
    oc: "",
    subTotal: "",
    igv: "",
    total: "",
    anexo: "",
    importe: "",
    destinatario: "",
    factura: "",
    anexo2: "",
    nRecibo: "",
    emision: "",
    anexo3: "",
    estado: "",
  };
}

function parseMontoGasto(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value).trim().replace(/S\/\.?\s*/gi, "").replace(/\s/g, "");
  if (!raw)
    return 0;
  const normalized = raw.includes(",") && raw.includes(".")
    ? (raw.lastIndexOf(",") > raw.lastIndexOf(".") ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, ""))
    : raw.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function montoGasto(g = {}) {
  const tipo = String(g.tipo || g.type || "").trim().toLowerCase();
  if (tipo === "egreso") {
    const importe = parseMontoGasto(g.importe);
    if (importe > 0) return importe;
    const total = parseMontoGasto(g.total ?? g.monto ?? g.montoTotal ?? g.valor);
    return total > 0 ? total : 0;
  }
  if (tipo === "saldo_inicial") {
    return parseMontoGasto(g.total ?? g.importe ?? g.monto ?? g.montoTotal ?? g.valor);
  }
  const total = parseMontoGasto(g.total ?? g.monto ?? g.montoTotal ?? g.valor);
  if (total > 0) return total;
  return parseMontoGasto(g.subTotal) + parseMontoGasto(g.igv);
}

const ESTADO_GASTO_OPTIONS = ["PENDIENTE", "EMITIDO", "FACTURA"];

function personasDeRegistroOC(rec = {}) {
  const personal = String(rec.personalAsignado || "").split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  return personal.length ? personal : (rec.responsable ? [String(rec.responsable).trim()] : []);
}

function registroOCCoincideConMes(rec = {}, mesYYYYMM = "") {
  if (!mesYYYYMM) return false;
  if (!rec.fechaFinReal) return false;
  return String(rec.fechaFinReal).slice(0, 7) === mesYYYYMM;
}

function ocsParaTrabajadoresEnMes(records = [], nombresTrabajadores = [], mesYYYYMM = "") {
  // Ya no filtra por personal asignado / responsable: basta con que la OC
  // tenga el mismo mes (Cierre real, o Emisión como fallback) que el gasto.
  if (!mesYYYYMM) return [];
  const seen = new Set();
  const out = [];
  (records || []).forEach((rec) => {
    const oc = String(rec?.oc || "").trim();
    if (!oc) return;
    if (!registroOCCoincideConMes(rec, mesYYYYMM)) return;
    const k = oc.toLocaleLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(oc);
  });
  return out;
}

function GastoForm({ value, onChange, ocOptions = [], trabajadores = [], ocRecords = [] }) {
  const isMobile = useIsMobile();
  const set = (k, v) => {
    if (k === "total") {
      const total = v === "" ? "" : Number(v);
      const subTotal = total === "" ? "" : Math.round(total * 0.82 * 100) / 100;
      const igv = total === "" ? "" : Math.round(total * 0.18 * 100) / 100;
      onChange({ ...value, total, subTotal, igv });
      return;
    }
    if (k === "destinatario") {
      const mes = String(value.fecha || "").slice(0, 7);
      const nombres = parseOcList(v);
      const ocsAuto = ocsParaTrabajadoresEnMes(ocRecords, nombres, mes);
      const ocActuales = parseOcList(value.oc);
      const merged = [...ocActuales];
      ocsAuto.forEach((oc) => {
        if (!merged.some((x) => x.toLocaleLowerCase() === oc.toLocaleLowerCase())) merged.push(oc);
      });
      const nombresTrabajadores = nombres.filter((n) => trabajadores.some((t) => normalizePersonKey(t) === normalizePersonKey(n)));
      const descripcion = nombresTrabajadores.length
        ? `PAGO DE HABERES ${nombresTrabajadores.join(", ")}`
        : value.descripcion;
      onChange({ ...value, destinatario: v, oc: merged.join(", "), descripcion });
      return;
    }
    onChange({ ...value, [k]: v });
  };
  const isEgreso = value.tipo === "egreso";
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
      <div style={{ gridColumn: "1 / -1" }}>
        <div style={{ fontSize: 10, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Tipo</div>
        <div style={{ display: "flex", gap: 8 }}>
          {["egreso", "ingreso"].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => set("tipo", t)}
              style={{
                flex: 1,
                padding: "8px 0",
                borderRadius: 7,
                border: `1px solid ${value.tipo === t ? COLORS.amber : COLORS.border}`,
                background: value.tipo === t ? COLORS.amberDim : COLORS.panel2,
                color: value.tipo === t ? COLORS.amber : COLORS.dim,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <div style={{ fontSize: 10, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Descripción</div>
        <input className="ct-input2" value={value.descripcion ?? ""} onChange={(e) => set("descripcion", e.target.value.toUpperCase())} />
      </div>
      <div>
        <div style={{ fontSize: 10, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Fecha</div>
        <DateInput value={value.fecha ?? ""} onChange={(fecha) => set("fecha", fecha)} inputClassName="ct-input2" showLabel={false} palette={COLORS} />
      </div>
      <div>
        <div style={{ fontSize: 10, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>OC{isEgreso ? " (puedes elegir varias)" : ""}</div>
        <OCSelector value={value.oc ?? ""} onChange={(v) => set("oc", v)} options={ocOptions} multiple={isEgreso} />
      </div>

      {isEgreso ? (
        <>
          <div>
            <div style={{ fontSize: 10, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Importe (S/)</div>
            <input className="ct-input2" type="number" step="0.01" value={value.importe ?? ""} onChange={(e) => set("importe", e.target.value === "" ? "" : Number(e.target.value))} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Destinatario RxH</div>
            <OCSelector
              value={value.destinatario ?? ""}
              onChange={(v) => set("destinatario", v)}
              options={trabajadores}
              multiple
              placeholder="Seleccionar trabajador(es) o escribir un nombre…"
            />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ fontSize: 10, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Link comprobante / sustento (Anexo2)</div>
            <input className="ct-input2" placeholder="https://drive.google.com/..." value={value.anexo2 ?? ""} onChange={(e) => set("anexo2", e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>N.º Recibo</div>
            <input className="ct-input2" value={value.nRecibo ?? ""} onChange={(e) => set("nRecibo", e.target.value.toUpperCase())} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Emisión recibo</div>
            <DateInput value={value.emision ?? ""} onChange={(fecha) => set("emision", fecha)} inputClassName="ct-input2" showLabel={false} palette={COLORS} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ fontSize: 10, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Link recibo (Anexo3)</div>
            <input className="ct-input2" placeholder="https://drive.google.com/..." value={value.anexo3 ?? ""} onChange={(e) => set("anexo3", e.target.value)} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ fontSize: 10, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Estado</div>
            <DropdownSelect buttonClassName="ct-input2" value={value.estado ?? ""} onChange={(v) => set("estado", v)} placeholder="— Sin estado —" options={ESTADO_GASTO_OPTIONS} />
          </div>
        </>
      ) : (
        <>
          <div>
            <div style={{ fontSize: 10, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Total (S/)</div>
            <input className="ct-input2" type="number" step="0.01" value={value.total ?? ""} onChange={(e) => set("total", e.target.value === "" ? "" : Number(e.target.value))} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Sub total (S/) — auto</div>
            <input className="ct-input2" type="number" step="0.01" readOnly disabled value={value.subTotal ?? ""} style={{ opacity: 0.7, cursor: "not-allowed" }} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>IGV (18%, S/) — auto</div>
            <input className="ct-input2" type="number" step="0.01" readOnly disabled value={value.igv ?? ""} style={{ opacity: 0.7, cursor: "not-allowed" }} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ fontSize: 10, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Link sustento (Anexo)</div>
            <input className="ct-input2" placeholder="https://drive.google.com/..." value={value.anexo ?? ""} onChange={(e) => set("anexo", e.target.value)} />
          </div>
        </>
      )}
    </div>
  );
}

const STORAGE_KEY_RESPONSABILIDADES = "wilarcon_responsabilidades_records";

function emptyRespDraft(area) {
  return { area: area || "", tarea: "", responsable: "", nota: "", hecho: false };
}

function RespForm({ value, onChange, areasDisponibles }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <div style={{ fontSize: 10, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Área</div>
        <input className="ct-input2" list="resp-areas" value={value.area ?? ""} onChange={(e) => onChange({ ...value, area: e.target.value.toUpperCase() })} />
        <datalist id="resp-areas">{areasDisponibles.map((a) => <option key={a} value={a} />)}</datalist>
      </div>
      <div>
        <div style={{ fontSize: 10, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Tarea / responsabilidad</div>
        <textarea className="ct-input2" rows={3} value={value.tarea ?? ""} onChange={(e) => onChange({ ...value, tarea: e.target.value.toUpperCase() })} />
      </div>
      <div>
        <div style={{ fontSize: 10, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Responsable</div>
        <input className="ct-input2" value={value.responsable ?? ""} onChange={(e) => onChange({ ...value, responsable: e.target.value.toUpperCase() })} />
      </div>
      <div>
        <div style={{ fontSize: 10, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Nota</div>
        <input className="ct-input2" value={value.nota ?? ""} onChange={(e) => onChange({ ...value, nota: e.target.value.toUpperCase() })} />
      </div>
    </div>
  );
}

const STORAGE_KEY_COTIZACIONES = "wilarcon_cotizaciones_records";

const WILARCON_EMPRESA = {
  nombre: "WILARCON SERVICIOS SAC",
  direccion: "Jr. Tupac Amaru Nro. 1459",
  telefono: "967 111 912",
  ruc: "20610308814",
  email: "wilarcon.serviciossac@gmail.com",
  // Datos de contacto que se muestran solo en el pie de página (franja azul) de la cotización
  telefonoFooter: "967 111 912",
  emailFooter: "pepe.zuniga@wilarcon.com",
};

const COTIZACION_MEDIDAS = ["und", "glb", "m2", "m", "kg", "gal", "día", "hora", "servicio", "-"];

const COTIZACION_TERMINOS_DEFAULT = [
  { label: "VALOR MONETARIO", value: "SOLES" },
  { label: "FORMAS DE PAGO", value: "60 DIAS CALENDARIO" },
  { label: "VALIDEZ DE COTIZACION", value: "15 DIAS HABILES" },
  { label: "TIEMPO DE ENTREGA", value: "5 DIAS HABILES" },
  { label: "LUGAR DE ENTREGA", value: "INSTALACIONES DEL CLIENTE" },
  { label: "GARANTIA DEL PRODUCTO", value: "POR DEFECTO DE FABRICA" },
  { label: "GARANTIA DEL SERVICIO", value: "6 MESES" },
];

function emptyCotizacionItem() {
  return { id: uid(), detalle: "", cantidad: 1, medida: "und", precioUnd: "" };
}

function emptyCotizacionSeccion(numero) {
  return { id: uid(), numero: numero || 1, titulo: "", items: [emptyCotizacionItem()] };
}

// Plantilla con los títulos/ítems habituales de una cotización de servicios (instalación de
// vidrio templado), para no tener que tipearlos de cero cada vez. El precio unitario queda
// vacío a propósito porque varía según el proyecto; cantidad y medida sí quedan precargadas.
function plantillaSeccionesCotizacionServicios() {
  const item = (detalle) => ({ ...emptyCotizacionItem(), detalle, cantidad: 1, medida: "glb" });
  return [
    {
      ...emptyCotizacionSeccion(1),
      titulo: "TRABAJOS PRELIMINARES",
      items: [item("Documentos de homologacion\nSctr pension salud\nPlan de trabajo\nSupervision ssoma")],
    },
    {
      ...emptyCotizacionSeccion(2),
      titulo: "MANO DE OBRA",
      items: [item("")],
    },
    {
      ...emptyCotizacionSeccion(3),
      titulo: "MATERIALES Y EQUIPOS",
      items: [item("")],
    },
    {
      ...emptyCotizacionSeccion(4),
      titulo: "ENTREGABLES",
      items: [item("Informe tecnico\nFicha tecnica")],
    },
  ];
}

function emptyCotizacionDraft() {
  return {
    id: uid(),
    numero: "",
    tipo: "SERVICIOS",
    fecha: todayStr(),
    contacto: "",
    direccion: "",
    telefono: "",
    solicitud: "",
    moneda: "SOLES",
    descuentoCorp: 0,
    secciones: plantillaSeccionesCotizacionServicios(),
    terminos: COTIZACION_TERMINOS_DEFAULT.map((t) => ({ ...t })),
    creadoPor: "",
    actualizadoEn: Date.now(),
    visitaCodigo: "", // código (IV-xxx) de la Visita Técnica de la que se generó, si aplica
  };
}

// Arma un draft de cotización precargado con los datos compatibles de una Visita Técnica
// (contacto, teléfono, lugar->dirección, y la Solicitud/Proyecto de la visita), y convierte
// la mano de obra (texto libre) y los materiales anotados en la visita en ítems de secciones
// nuevas (cantidad y medida/unidad ya puestas, precio en blanco porque varía según el
// proyecto y debe completarlo el usuario). Si no se pasa una visita (o es null), devuelve un
// draft en blanco normal.
function cotizacionDraftDesdeVisita(visita) {
  const base = emptyCotizacionDraft();
  if (!visita) return base;

  base.contacto = visita.contacto || "";
  base.telefono = visita.telefono || "";
  base.direccion = visita.lugar || "";
  base.solicitud = visita.nombreProyecto || ""; // "Solicitud / Proyecto" de la visita
  base.visitaCodigo = visita.codigo || "";

  const seccionesGeneradas = [];

  // "Mano de obra" (antes "Solicitud del cliente"): líneas de texto libre, se pasan como
  // ítems de cantidad 1 y medida "glb" (precio en blanco para completar).
  const manoDeObra = (visita.requisitos || []).map((r) => String(r || "").trim()).filter(Boolean);
  if (manoDeObra.length) {
    seccionesGeneradas.push({
      ...emptyCotizacionSeccion(seccionesGeneradas.length + 1),
      titulo: "MANO DE OBRA (de Visita Técnica)",
      items: manoDeObra.map((detalle) => ({
        ...emptyCotizacionItem(),
        detalle,
        cantidad: 1,
        medida: "glb",
        precioUnd: "",
      })),
    });
  }

  // Materiales anotados en campo: nombre/cantidad/unidad ya vienen definidos por registro.
  const materiales = (visita.materiales || []).filter((m) => String(m?.nombre || "").trim());
  if (materiales.length) {
    seccionesGeneradas.push({
      ...emptyCotizacionSeccion(seccionesGeneradas.length + 1),
      titulo: "MATERIALES (de Visita Técnica)",
      items: materiales.map((m) => ({
        ...emptyCotizacionItem(),
        detalle: String(m.nombre || "").trim(),
        cantidad: Number(m.cantidad) || 1,
        medida: String(m.unidad || "").trim() || "und",
        precioUnd: "",
      })),
    });
  }

  if (seccionesGeneradas.length) base.secciones = seccionesGeneradas;

  return base;
}

function siguienteNumeroCotizacion(cotizaciones) {
  // "WS" es fijo, el año son los ultimos 2 digitos del año actual (se actualiza solo cada año),
  // y la numeracion arranca en 28 (la primera cotizacion generada sera WS_AA 28).
  let max = 27;
  for (const c of cotizaciones || []) {
    const m = String(c?.numero || "").match(/(\d+)\s*$/);
    if (m) { const n = parseInt(m[1], 10); if (Number.isFinite(n) && n > max) max = n; }
  }
  const yy = String(new Date().getFullYear() % 100).padStart(2, "0");
  return `WS_${yy} ${max + 1}`;
}

function itemTotalCotizacion(item) {
  const cant = Number(item?.cantidad);
  const precio = Number(item?.precioUnd);
  if (!Number.isFinite(cant) || !Number.isFinite(precio)) return 0;
  return cant * precio;
}

function seccionTotalCotizacion(seccion) {
  return (seccion?.items || []).reduce((sum, it) => sum + itemTotalCotizacion(it), 0);
}

function cotizacionTotales(cot) {
  const subtotal = (cot?.secciones || []).reduce((sum, s) => sum + seccionTotalCotizacion(s), 0);
  const descuento = Number(cot?.descuentoCorp) || 0;
  const base = Math.max(subtotal - descuento, 0);
  // Redondeado a centavos (igual que en Gastos) para que el valor exportado a Excel
  // coincida exactamente con lo que se muestra en pantalla/PDF via toLocaleString.
  const igv = Math.round(base * 0.18 * 100) / 100;
  const total = Math.round((base + igv) * 100) / 100;
  return { subtotal, descuento, base, igv, total };
}

// Numeracion tipo "1.00" para secciones y "1.10", "1.20"... para items (formato de la plantilla oficial)
function seccionNumeroLabel(seccion) {
  return `${Number(seccion?.numero) || 0}.00`;
}
function itemNumeroLabel(seccion, idx) {
  return `${Number(seccion?.numero) || 0}.${(idx + 1) * 10}`;
}
// Monto con 2 decimales fijos, sin simbolo de moneda (para filas de item/seccion)
function cotMontoFijo(v) {
  if (v === "" || v === null || v === undefined) return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// Monto "inteligente" sin simbolo: sin decimales si es entero, con 2 si no; "-" si es cero (para el cuadro de totales)
function cotMontoSmart(v) {
  const n = Number(v) || 0;
  if (n === 0) return "-";
  const tieneDecimales = Math.abs(n % 1) > 0.004;
  return n.toLocaleString("es-PE", { minimumFractionDigits: tieneDecimales ? 2 : 0, maximumFractionDigits: 2 });
}

async function buildCotizacionXlsx(cot) {
  const XLSX = await import("xlsx");
  const totales = cotizacionTotales(cot);
  const aoa = [];
  const merges = [];
  aoa.push([]);
  aoa.push([]);
  aoa.push(["", "", "", "", "", WILARCON_EMPRESA.nombre]);
  aoa.push(["", "", "", "", "", WILARCON_EMPRESA.direccion]);
  aoa.push(["", "", "", "", "", "RUC:" + WILARCON_EMPRESA.ruc]);
  aoa.push(["", "", "", "", "", WILARCON_EMPRESA.telefono]);
  aoa.push([]);
  aoa.push(["CONTACTO:", cot.contacto || ""]);
  aoa.push(["DIRECCION:", cot.direccion || ""]);
  aoa.push(["TELEFONO:", cot.telefono || "", "", "", "", "COTIZACION N°", cot.numero || ""]);
  aoa.push(["FECHA:", fmtDate(cot.fecha) || cot.fecha || ""]);
  aoa.push(["SOLICITUD:", cot.solicitud || ""]);
  aoa.push([]);
  const headerRowIdx = aoa.length;
  aoa.push(["Nº", "DESCRIPCION", "", "CANTIDAD", "MEDIDA", "PRECIO UND", "TOTAL"]);
  (cot.secciones || []).forEach((s) => {
    aoa.push([seccionNumeroLabel(s), s.titulo || "", "", "", "", "", seccionTotalCotizacion(s)]);
    (s.items || []).forEach((it, idx) => {
      const detalleConViñetas = String(it.detalle || "").split("\n").map((linea) => `• ${linea}`).join("\n");
      aoa.push([itemNumeroLabel(s, idx), detalleConViñetas, "", it.cantidad ?? "", it.medida || "", it.precioUnd ?? "", itemTotalCotizacion(it)]);
    });
  });
  aoa.push([]);
  aoa.push(["", "", "", "", "", "DESC.CORP", totales.descuento ? totales.descuento : "-"]);
  aoa.push(["", "", "", "", "", "SUB TOTAL", totales.base]);
  aoa.push(["", "", "", "", "", "IGV", totales.igv]);
  aoa.push(["", "", "", "", "", "PRECIO TOTAL", totales.total]);
  aoa.push([]);
  aoa.push(["TERMINOS Y CONDICIONES"]);
  aoa.push([]);
  (cot.terminos || []).forEach((t) => aoa.push([`${t.label}: ${t.value}`]));
  aoa.push([]);
  aoa.push([`${WILARCON_EMPRESA.nombre}\n${WILARCON_EMPRESA.telefonoFooter}\n${WILARCON_EMPRESA.emailFooter}`]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 8 }, { wch: 46 }, { wch: 6 }, { wch: 10 }, { wch: 9 }, { wch: 13 }, { wch: 13 }];
  ws["!merges"] = [{ s: { r: headerRowIdx, c: 1 }, e: { r: headerRowIdx, c: 2 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, cot.tipo === "MATERIALES" ? "MATERIALES" : "SERVICIOS");
  const nombreArchivo = `${(cot.numero || "cotizacion").replace(/[^\w-]+/g, "_")}.xlsx`;
  XLSX.writeFile(wb, nombreArchivo);
}

// Paleta tomada directamente del logo WILARCON (antes usaba el azul/rojo por defecto de Office,
// que no correspondian a los tonos reales del escudo). Todos los tonos derivados (grisHeader,
// azulClaro, zebra, totalesBg) se calculan como mezclas del azul real de marca con blanco, para
// que toda la jerarquia visual de la tabla se sienta parte de un mismo sistema de color.
const COTIZACION_PDF_COLORS = {
  rojo: [230, 45, 53],
  azul: [56, 98, 140],
  negro: [20, 20, 20],
  // Encabezado de la tabla de items: gris-azulado (antes era gris neutro sin relacion con la marca).
  grisHeader: [211, 220, 230],
  // Franja para separar secciones dentro de la tabla de items.
  azulClaro: [225, 231, 238],
  // Franja "cebra" muy sutil para que las filas largas se seccionen mejor al leer.
  zebra: [245, 247, 249],
  // Fondo de las filas DESC.CORP / SUB TOTAL / IGV en el cuadro de totales, para que PRECIO TOTAL
  // (en azul solido) resalte por contraste como cierre del documento.
  totalesBg: [231, 236, 241],
};

function loadImageAsDataUrl(src) {
  return new Promise((resolve) => {
    try {
      fetch(src)
        .then((r) => (r && r.ok ? r.blob() : Promise.reject(new Error("logo fetch failed"))))
        .then((blob) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result || null);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        })
        .catch(() => resolve(null));
    } catch (e) {
      console.warn("loadImageAsDataUrl: no se pudo cargar el logo, se omite", e);
      resolve(null);
    }
  });
}

// Escalas a probar (de mayor a menor) para forzar que todo el documento entre en UNA sola pagina:
// primero se recortan margenes/espacios (arriba y abajo), y solo si aun no alcanza se reduce la
// letra. Se usan tal cual en Cotizacion (mas abajo) y tambien en el Informe Tecnico y el Informe
// de Infraestructura, para que los tres PDF se ajusten con el mismo criterio.
const PDF_FIT_SCALES = [1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.65, 0.6, 0.55, 0.5];

// Fraccion del margen blanco (entre el contenido/franja de color y el borde de la hoja) a usar,
// de mayor a menor. Para cada tamaño de letra se prueba primero con el margen completo y, si no
// alcanza el espacio, se va recortando progresivamente hasta llegar a 0 (pegado al borde) ANTES
// de reducir la letra, porque perder espacio en blanco afecta menos la legibilidad que achicar
// el texto.
const PDF_FIT_MARGIN_FRACTIONS = [1, 0.8, 0.6, 0.4, 0.2, 0];

// Alias historicos: el resto del bloque de Cotizacion (mas abajo) usa estos nombres.
const COTIZACION_PDF_SCALES = PDF_FIT_SCALES;
const COTIZACION_PDF_MARGIN_FRACTIONS = PDF_FIT_MARGIN_FRACTIONS;

// Señal interna: la escala actual no alcanza para que el contenido no se solape con el
// pie de pagina. Se lanza para abortar el intento en curso y probar con una escala menor,
// en vez de seguir dibujando encima del espacio reservado para la franja azul inferior.
class RetrySmallerScale extends Error {}

async function buildCotizacionPdf(cot, { download = true } = {}) {
  const { jsPDF } = await import("jspdf");
  const autoTableMod = await import("jspdf-autotable");
  const autoTable = autoTableMod.default || autoTableMod;
  const { rojo, azul, grisHeader, negro, azulClaro, zebra, totalesBg } = COTIZACION_PDF_COLORS;
  const totales = cotizacionTotales(cot);
  const logoData = await loadImageAsDataUrl(LOGO_SHIELD);

  let lastDoc = null;
  let lastPages = Infinity;

  scaleLoop:
  for (let i = 0; i < COTIZACION_PDF_SCALES.length; i++) {
    const scale = COTIZACION_PDF_SCALES[i];
    const isLastScale = i === COTIZACION_PDF_SCALES.length - 1;
  for (let mi = 0; mi < COTIZACION_PDF_MARGIN_FRACTIONS.length; mi++) {
    const marginFraction = COTIZACION_PDF_MARGIN_FRACTIONS[mi];
    const isLastAttempt = isLastScale && mi === COTIZACION_PDF_MARGIN_FRACTIONS.length - 1;
    try {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    doc.setProperties({
      title: `Cotizacion ${cot.numero || ""}`.trim(),
      subject: `Cotizacion ${cot.tipo === "MATERIALES" ? "de materiales" : "de servicios"} para ${cot.contacto || "cliente"}`,
      author: WILARCON_EMPRESA.nombre,
      creator: WILARCON_EMPRESA.nombre,
    });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const marginX = Math.max(24, 42 * scale);

    // Logo + wordmark a la izquierda y datos de la empresa a la derecha, EN LA MISMA FILA,
    // como un membrete compacto de carta. La franja roja va debajo de esa fila, como
    // separador, en vez de partir el membrete en dos bloques con un salto grande entre ellos.
    // El espacio antes de la fila (rowTopY) es lo primero que se recorta (hasta 0) cuando
    // falta lugar, igual que antes se recortaba el espacio antes de la franja.
    const LOGO_ASPECT = 226 / 200; // ancho / alto real del PNG del logo (assets/logo-shield.png)
    const logoHeight = 34 * scale;
    const logoWidth = logoHeight * LOGO_ASPECT;
    const wordmarkFontSize = 15 * scale;
    const logoGap = 8 * scale;
    const rowTopY = 26 * scale * marginFraction;

    // Logo a la izquierda, alineado al margen del contenido (no centrado en la hoja).
    if (logoData) {
      try { doc.addImage(logoData, "PNG", marginX, rowTopY, logoWidth, logoHeight); } catch (e) { console.error(e); }
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(wordmarkFontSize);
    doc.setTextColor(...azul);
    doc.text("WILARCON", marginX + logoWidth + logoGap, rowTopY + logoHeight / 2 + wordmarkFontSize * 0.36, { align: "left" });

    // Datos de la empresa a la derecha, alineados con el logo. El nombre va en el mismo azul
    // de marca que el logo (para que quede como titulo del membrete); la direccion, el RUC y el
    // telefono van en gris oscuro neutro, como dato secundario, para que no compitan visualmente
    // con el nombre ni con el wordmark.
    const empresaTopY = rowTopY + 2 * scale;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5 * scale);
    doc.setTextColor(...azul);
    doc.text(WILARCON_EMPRESA.nombre, pageW - marginX, empresaTopY, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5 * scale);
    doc.setTextColor(110, 110, 110);
    doc.text(WILARCON_EMPRESA.direccion, pageW - marginX, empresaTopY + 12 * scale, { align: "right" });
    doc.text("RUC:" + WILARCON_EMPRESA.ruc, pageW - marginX, empresaTopY + 23 * scale, { align: "right" });
    doc.text(WILARCON_EMPRESA.telefono, pageW - marginX, empresaTopY + 34 * scale, { align: "right" });

    // Punto mas bajo entre el bloque del logo y el bloque de datos de la empresa: la franja
    // roja arranca debajo del que sea mas alto de los dos.
    const headerRowBottom = Math.max(rowTopY + logoHeight, empresaTopY + 34 * scale);
    const BAND_H = 40 * scale;
    const bandY = headerRowBottom + 14 * scale;
    doc.setFillColor(...rojo);
    doc.rect(0, bandY, pageW, BAND_H, "F");

    // Bloque de datos del cliente (izquierda), debajo de la franja.
    const clientBlockGap = 20 * scale;
    let y = bandY + BAND_H + clientBlockGap;
    const clientBlockTopY = y;
    const leftLabelX = marginX;
    const leftValueX = marginX + 62 * scale;
    const leftValueWidth = pageW - leftValueX - marginX - 150 * scale;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5 * scale);
    doc.setTextColor(...negro);
    const labelRow = (label, value) => {
      doc.setFont("helvetica", "bold");
      doc.text(label, leftLabelX, y);
      doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(String(value || "-"), leftValueWidth);
      doc.text(lines, leftValueX, y);
      y += 10.5 * scale * Math.max(lines.length, 1);
    };
    labelRow("CONTACTO:", cot.contacto);
    labelRow("DIRECCION:", cot.direccion);
    labelRow("TELEFONO:", cot.telefono);
    labelRow("FECHA:", fmtDate(cot.fecha) || cot.fecha);
    labelRow("SOLICITUD:", cot.solicitud);

    // N° de cotización (derecha, en azul) — a la misma altura que el inicio del bloque del cliente,
    // igual que en la plantilla original.
    doc.setTextColor(...azul);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5 * scale);
    doc.text("COTIZACION N\u00b0", pageW - marginX, clientBlockTopY + 10 * scale, { align: "right" });
    doc.text(String(cot.numero || "-"), pageW - marginX, clientBlockTopY + 23 * scale, { align: "right" });

    y += 10 * scale;

    // Tabla de items: 6 columnas -> N°, DESCRIPCION, CANTIDAD, MEDIDA, PRECIO UND, TOTAL
    // (antes la moneda "S/" iba en su propia columna separada del monto; ahora va junta,
    // como en un comprobante real, para que se lea como un solo valor).
    const rows = [];
    let itemRowIndex = 0;
    (cot.secciones || []).forEach((s) => {
      rows.push([
        { content: seccionNumeroLabel(s), styles: { fontStyle: "bold", halign: "center", valign: "middle", fillColor: azulClaro } },
        { content: s.titulo || "", styles: { fontStyle: "bold", halign: "left", valign: "middle", textColor: azul, fillColor: azulClaro } },
        { content: "", styles: { valign: "middle", fillColor: azulClaro } },
        { content: "", styles: { valign: "middle", fillColor: azulClaro } },
        { content: "", styles: { valign: "middle", fillColor: azulClaro } },
        { content: "S/ " + cotMontoFijo(seccionTotalCotizacion(s)), styles: { fontStyle: "bold", halign: "right", valign: "middle", fillColor: azulClaro } },
      ]);
      (s.items || []).forEach((it, idx) => {
        const sinPrecio = it.precioUnd === "" || it.precioUnd === undefined || it.precioUnd === null;
        const detalleConViñetas = String(it.detalle || "").split("\n").map((linea) => `• ${linea}`).join("\n");
        const filaFill = itemRowIndex % 2 === 1 ? zebra : [255, 255, 255];
        itemRowIndex++;
        rows.push([
          { content: itemNumeroLabel(s, idx), styles: { halign: "center", valign: "middle", fillColor: filaFill } },
          { content: detalleConViñetas, styles: { fontStyle: "normal", valign: "top", fillColor: filaFill } },
          { content: it.cantidad === "" || it.cantidad === undefined || it.cantidad === null ? "" : String(it.cantidad), styles: { halign: "center", valign: "middle", fillColor: filaFill } },
          { content: it.medida || "", styles: { halign: "center", valign: "middle", fillColor: filaFill } },
          { content: sinPrecio ? "-" : "S/ " + cotMontoFijo(it.precioUnd), styles: { halign: "right", valign: "middle", fillColor: filaFill } },
          { content: "S/ " + cotMontoFijo(itemTotalCotizacion(it)), styles: { halign: "right", valign: "middle", fillColor: filaFill } },
        ]);
      });
    });

    // Pie de pagina (franja azul) - se calcula dinamicamente para nunca solaparse con el contenido.
    // Al reducir la escala, tambien se acerca mas al borde inferior para ganar espacio abajo.
    // Se calcula ANTES de la tabla de items (y no despues, como antes) para poder reservarle a esa
    // tabla el mismo margen inferior: asi, si autoTable pagina la tabla de items por su cuenta
    // (ademas de las paginas que abre ensureSpace() mas abajo), tampoco dibuja filas encima del
    // area del pie de pagina.
    const footerH = 40 * scale;
    // Mismo margen que separa las letras "WILARCON SERVICIOS SAC" del borde superior (empresaTopY),
    // para que el borde blanco de arriba y de abajo tengan exactamente el mismo tamaño. Antes se
    // tomaba como referencia bandY (el inicio de la franja roja) y luego headerRowBottom (el final
    // del bloque del membrete); ahora se toma empresaTopY, el punto donde arrancan esas letras, que
    // es el margen en blanco real desde el borde superior hasta el texto (sin incluir la altura del
    // propio texto/logo).
    const footerMarginBottom = empresaTopY;
    const pageBottomMargin = Math.max(10, 50 * scale);
    const contMaxY = pageH - footerH - footerMarginBottom - pageBottomMargin;
    // Margen superior para cualquier pagina nueva (se abra por ensureSpace() como ultimo recurso, o
    // por la propia paginacion interna de autoTable): deja lugar para el mini-encabezado de
    // continuacion (nombre de empresa + N° de cotizacion) que se agrega al final en todas las
    // paginas siguientes a la primera.
    const topMarginNewPage = Math.max(30, 40 * scale);

    autoTable(doc, {
      startY: y,
      margin: { left: marginX, right: marginX, top: topMarginNewPage, bottom: pageH - contMaxY },
      head: [[
        { content: "N\u00b0" },
        { content: "DESCRIPCION" },
        { content: "CANTIDAD" },
        { content: "MEDIDA" },
        { content: "PRECIO UND" },
        { content: "TOTAL" },
      ]],
      body: rows,
      styles: { font: "helvetica", fontSize: 8 * scale, cellPadding: 4 * scale, lineColor: [190, 190, 190], lineWidth: 0.5, textColor: negro, valign: "middle" },
      headStyles: { fillColor: grisHeader, textColor: [0, 0, 0], fontStyle: "bold", halign: "center", lineColor: [150, 150, 150], lineWidth: 0.5 },
      columnStyles: {
        0: { cellWidth: 28 * scale, halign: "center" },
        1: { cellWidth: "auto" },
        2: { cellWidth: 58 * scale, halign: "center" },
        3: { cellWidth: 42 * scale, halign: "center" },
        4: { cellWidth: 70 * scale, halign: "right" },
        5: { cellWidth: 74 * scale, halign: "right" },
      },
      theme: "grid",
      // Evita que una fila (p.ej. un detalle largo con varias lineas) quede cortada a la mitad
      // entre el fondo de una pagina y el inicio de la siguiente.
      rowPageBreak: "avoid",
      // En el ultimo intento se permite que autoTable pagine si de verdad no entra;
      // en los intentos previos igual puede paginar, y eso es justamente la señal para reintentar con una escala menor.
    });

    let finalY = doc.lastAutoTable.finalY + 8 * scale;

    // Caja de totales (derecha): etiqueta | monto (con simbolo de moneda incluido) — DESC.CORP
    // siempre visible (con "-" si es 0). La fila de PRECIO TOTAL se resalta con el azul de marca
    // para que sea lo primero que salte a la vista, igual que en un comprobante.
    const totalsWidth = 200 * scale;
    const totalsX = pageW - marginX - totalsWidth;
    const totalRows = [
      [
        { content: "DESC.CORP", styles: { fillColor: totalesBg } },
        { content: "S/ " + cotMontoSmart(totales.descuento), styles: { fillColor: totalesBg } },
      ],
      [
        { content: "SUB TOTAL", styles: { fillColor: totalesBg } },
        { content: "S/ " + cotMontoSmart(totales.base), styles: { fillColor: totalesBg } },
      ],
      [
        { content: "IGV", styles: { fillColor: totalesBg } },
        { content: "S/ " + cotMontoSmart(totales.igv), styles: { fillColor: totalesBg } },
      ],
      [
        { content: "PRECIO TOTAL", styles: { fontStyle: "bold", textColor: [255, 255, 255], fillColor: azul } },
        { content: "S/ " + cotMontoSmart(totales.total), styles: { fontStyle: "bold", textColor: [255, 255, 255], fillColor: azul } },
      ],
    ];

    // Solo en el ultimo intento (escala minima) se permite abrir una segunda pagina como ultimo recurso,
    // para nunca perder ni cortar informacion. En los intentos previos, si el contenido no entra,
    // se aborta este intento y se reintenta con una escala menor (en vez de seguir dibujando encima
    // del espacio reservado para la franja azul inferior, que es lo que tapaba las letras).
    const ensureSpace = (neededHeight) => {
      if (finalY + neededHeight > contMaxY) {
        if (isLastAttempt) {
          doc.addPage();
          finalY = topMarginNewPage;
        } else {
          throw new RetrySmallerScale();
        }
      }
    };

    // La caja de "PRECIO TOTAL" nunca debe partirse a mitad de tabla ni quedar tan pegada al
    // pie de pagina que la franja azul termine dibujandose encima de sus letras: se reserva su
    // espacio completo ANTES de dibujarla, igual que se hace con los terminos y condiciones.
    const totalsRowH = (8.5 * scale) + 2 * (4 * scale) + 1.2;
    ensureSpace(totalsRowH * totalRows.length);

    autoTable(doc, {
      startY: finalY,
      margin: { left: totalsX, bottom: pageH - contMaxY },
      tableWidth: totalsWidth,
      body: totalRows,
      styles: { font: "helvetica", fontSize: 8.5 * scale, cellPadding: 4 * scale, lineColor: [190, 190, 190], lineWidth: 0.5, textColor: negro },
      columnStyles: { 0: { cellWidth: 125 * scale }, 1: { halign: "right", cellWidth: 75 * scale } },
      theme: "grid",
      rowPageBreak: "avoid",
    });

    finalY = doc.lastAutoTable.finalY + 18 * scale;

    ensureSpace(13 * scale + 11 * scale);
    doc.setTextColor(...negro);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5 * scale);
    doc.text("TERMINOS Y CONDICIONES", marginX, finalY);
    finalY += 13 * scale;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5 * scale);
    (cot.terminos || []).forEach((t) => {
      const texto = `${t.label}: ${t.value}`;
      const lines = doc.splitTextToSize(texto, pageW - marginX * 2);
      ensureSpace(11 * scale * lines.length);
      doc.text(lines, marginX, finalY);
      finalY += 11 * scale * lines.length;
    });

    const pageCount = doc.internal.getNumberOfPages();
    lastDoc = doc;
    lastPages = pageCount;

    if (pageCount > 1 && !isLastAttempt) {
      // No entro en una sola pagina con este margen/escala: se prueba primero con menos margen
      // blanco y, si ya esta en 0, con una escala de letra mas chica.
      continue;
    }

    // Franja azul inferior + numeracion "Pagina X de Y": se dibuja en TODAS las paginas del
    // documento (antes solo se dibujaba una vez, en la ultima pagina). Ademas, a partir de la
    // pagina 2 se agrega un mini-encabezado (nombre de empresa + N° de cotizacion) para que quede
    // claro de que documento se trata si el PDF llego a paginar.
    const footerY = pageH - footerH - footerMarginBottom;
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);

      if (p > 1) {
        doc.setTextColor(...azul);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9 * scale);
        doc.text(WILARCON_EMPRESA.nombre, marginX, 24 * scale);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5 * scale);
        doc.text("COTIZACION N\u00b0 " + (cot.numero || "-"), pageW - marginX, 24 * scale, { align: "right" });
        doc.setDrawColor(...azul);
        doc.setLineWidth(0.75);
        doc.line(marginX, 30 * scale, pageW - marginX, 30 * scale);
      }

      doc.setFillColor(...azul);
      doc.rect(0, footerY, pageW, footerH, "F");
      doc.setTextColor(255, 255, 255);
      // Las 3 líneas van con el mismo tamaño de letra y centradas tanto horizontal como
      // verticalmente dentro de la franja azul (antes el nombre iba más grande que el resto).
      const footerFontSize = 9 * scale;
      const footerLineGap = 12 * scale;
      const footerCenterY = footerY + footerH / 2;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(footerFontSize);
      doc.text(WILARCON_EMPRESA.nombre, pageW / 2, footerCenterY - footerLineGap, { align: "center", baseline: "middle" });
      doc.setFont("helvetica", "normal");
      doc.text(WILARCON_EMPRESA.telefonoFooter, pageW / 2, footerCenterY, { align: "center", baseline: "middle" });
      doc.text(WILARCON_EMPRESA.emailFooter, pageW / 2, footerCenterY + footerLineGap, { align: "center", baseline: "middle" });

      if (pageCount > 1) {
        doc.setTextColor(...negro);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5 * scale);
        doc.text(`P\u00e1gina ${p} de ${pageCount}`, pageW - marginX, footerY - 6 * scale, { align: "right" });
      }
    }

    break scaleLoop;
    } catch (e) {
      if (e instanceof RetrySmallerScale) {
        // Este margen/escala no alcanzaba para que todo el contenido respete el espacio del pie de
        // pagina sin taparse; se prueba con el siguiente margen mas chico (y, si ya es 0, con la
        // siguiente escala de letra mas chica de la lista).
        continue;
      }
      throw e;
    }
  }
  }

  if (!lastDoc) {
    throw new Error("No se pudo generar el PDF de la cotización.");
  }

  const nombreArchivo = `${(cot.solicitud || cot.numero || "cotizacion").replace(/[^\w-]+/g, "_")}.pdf`;
  if (download) {
    lastDoc.save(nombreArchivo);
  }
  // Se devuelve el documento generado (y su nombre de archivo) para que quien llama pueda,
  // por ejemplo, mostrarlo en un visor antes de descargarlo, sin tener que reconstruirlo.
  return { doc: lastDoc, fileName: nombreArchivo };
}
// ===================== INFORMES TECNICOS =====================
// Modulo para redactar y descargar (PDF) informes tecnicos de servicio, con el mismo
// formato de membrete/pie de pagina que ya usa Cotizacion (logo + WILARCON_EMPRESA),
// pero con la estructura de secciones de un informe tecnico real (Datos generales,
// Objetivo, Descripcion del trabajo, Trabajos ejecutados, Evidencia fotografica,
// Observaciones y Comentarios adicionales).
const STORAGE_KEY_INFORMES = "wilarcon_informes_records";

function emptyInformeDraft() {
  return {
    id: uid(),
    tipo: "tecnico",
    codigo: "",
    version: "01",
    fecha: todayStr(),
    cliente: "",
    ubicacion: "",
    telefono: "",
    fechaVisita: todayStr(),
    fechaInicio: "",
    fechaFin: "",
    ordenCompra: "",
    objetivo: "",
    descripcion: "",
    trabajos: [""],
    fotos: [],
    observaciones: [""],
    comentarios: "",
    creadoPor: "",
    actualizadoEn: Date.now(),
    cotizacionNumero: "", // N° de la Cotización de la que se extrajeron los datos, si aplica
    cotizacionSolicitud: "", // Solicitud/Proyecto de esa cotización, solo para mostrar en el indicador
  };
}

// Segundo tipo de informe: reporte de avance de obra/infraestructura, con el formato de
// tabla (membrete WILARCON + LAUREATE + logo cliente, rango de fechas, datos de proyecto,
// Inicio de Obra / Avance Final con texto+fotos, y 3 firmas) tomado del PDF de referencia
// del usuario. Comparte el mismo storage que Informe Técnico (wilarcon_informes_records),
// distinguido por el campo "tipo".
function emptyInformeInfraDraft() {
  return {
    id: uid(),
    tipo: "infraestructura",
    codigo: "",
    proyecto: "",
    fechaInicio: todayStr(),
    fechaFin: todayStr(),
    numeroProyecto: "",
    proveedor: "",
    ordenCompra: "",
    descripcionProyecto: "",
    inicioObraTexto: "",
    inicioObraFotos: [],
    avanceFinalTexto: "",
    avanceFinalFotos: [],
    firmaProveedor: "",
    firmaGerente: "",
    firmaDirector: "",
    creadoPor: "",
    actualizadoEn: Date.now(),
    cotizacionNumero: "", // N° de la Cotización de la que se extrajeron los datos, si aplica
    cotizacionSolicitud: "", // Solicitud/Proyecto de esa cotización, solo para mostrar en el indicador
  };
}

// Arma un draft de Informe (Técnico o Infraestructura) precargado con los datos
// compatibles de una Cotización ya guardada, para no volver a tipear lo que ya se cotizó.
// Igual criterio que cotizacionDraftDesdeVisita: solo llena los campos que tengan un dato
// equivalente en la cotización, dejando intacto el resto del draft (id, código, tipo,
// fotos ya cargadas, etc.), y guarda el número de cotización de origen en
// cotizacionNumero para trazabilidad. "Trabajos ejecutados" se arma SOLO con los ítems de
// la(s) sección(es) tituladas "MANO DE OBRA" de la cotización (no con Trabajos preliminares,
// Materiales y equipos ni Entregables, que no son trabajo ejecutado en campo).
function informeDraftDesdeCotizacion(draft, cotizacion) {
  if (!draft || !cotizacion) return draft;
  const detallesManoDeObra = [];
  (cotizacion.secciones || []).forEach((s) => {
    if (!/mano de obra/i.test(String(s?.titulo || ""))) return;
    (s.items || []).forEach((it) => {
      String(it?.detalle || "").split("\n").map((l) => l.trim()).filter(Boolean).forEach((l) => detallesManoDeObra.push(l));
    });
  });
  if (draft.tipo === "infraestructura") {
    return {
      ...draft,
      proyecto: draft.proyecto || (cotizacion.solicitud || "").toUpperCase(),
      descripcionProyecto: detallesManoDeObra.length ? detallesManoDeObra.join("\n") : (cotizacion.solicitud || draft.descripcionProyecto),
      cotizacionNumero: cotizacion.numero || "",
      cotizacionSolicitud: cotizacion.solicitud || "",
    };
  }
  return {
    ...draft,
    cliente: (cotizacion.contacto || draft.cliente || "").toUpperCase(),
    ubicacion: (cotizacion.direccion || draft.ubicacion || "").toUpperCase(),
    telefono: cotizacion.telefono || draft.telefono,
    objetivo: cotizacion.solicitud || draft.objetivo,
    trabajos: detallesManoDeObra.length ? detallesManoDeObra : draft.trabajos,
    cotizacionNumero: cotizacion.numero || "",
    cotizacionSolicitud: cotizacion.solicitud || "",
  };
}

function siguienteCodigoInforme(informes, tipo = "tecnico") {
  const prefix = tipo === "infraestructura" ? "II-" : "IT-";
  let max = 0;
  (informes || []).forEach((i) => {
    const esInfra = i?.tipo === "infraestructura";
    if ((tipo === "infraestructura") !== esInfra) return;
    const m = String(i?.codigo || "").match(/(\d+)\s*$/);
    if (m) { const n = parseInt(m[1], 10); if (Number.isFinite(n) && n > max) max = n; }
  });
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

// Calcula el siguiente "# de Proyecto" para un informe de infraestructura, tomando como
// base el numero mas alto ya usado entre los informes de infraestructura existentes
// (buscando la parte numerica del campo, sin importar si tiene prefijo/sufijo de texto),
// y respetando la cantidad de digitos (padding) del numero mas alto encontrado.
function siguienteNumeroProyecto(informes) {
  let max = 0;
  let maxLen = 3;
  (informes || []).forEach((i) => {
    if (i?.tipo !== "infraestructura") return;
    const raw = String(i?.numeroProyecto || "").trim();
    const m = raw.match(/(\d+)/);
    if (!m) return;
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > max) { max = n; maxLen = m[1].length; }
  });
  return String(max + 1).padStart(maxLen, "0");
}

// Redimensiona/comprime una foto subida por el usuario ANTES de guardarla (se guarda como
// base64 dentro del propio registro del informe, igual que otros adjuntos de la app), para
// no inflar demasiado el tamaño del registro en Neon. Devuelve tambien el ancho/alto ya
// redimensionados, para poder dibujar la imagen en el PDF respetando su proporcion real
// (sin estirarla ni deformarla).
function resizeImageFile(file, maxDim = 1000, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("No se pudo leer la imagen"));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        let dataUrl;
        try { dataUrl = canvas.toDataURL("image/jpeg", quality); } catch (e) { reject(e); return; }
        resolve({ dataUrl, width: w, height: h });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Sube una foto (ya redimensionada por resizeImageFile, como dataUrl) a la carpeta de Drive
// de fotos de Visita Técnica a través de /api/fotos-visitas, en vez de guardarla como dataUrl
// dentro del registro en Neon. Devuelve el fileId de Drive para guardar en su lugar.
async function subirFotoADrive(dataUrl, filename) {
  const comma = dataUrl.indexOf(",");
  const mimeType = (dataUrl.slice(5, comma).split(";")[0]) || "image/jpeg";
  const dataBase64 = dataUrl.slice(comma + 1);
  const res = await fetch("/api/fotos-visitas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ dataBase64, mimeType, filename }),
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* respuesta invalida, cae al throw de abajo */ }
  if (!res.ok || !data || !data.ok) throw new Error((data && data.reason) || `No se pudo subir la foto (${res.status})`);
  return data.fileId;
}
// URL para usar directo en <img src>: el navegador la pide a nuestro propio dominio
// (no a Drive), así la Content-Security-Policy (img-src 'self') no necesita cambiar.
function urlFotoDrive(fileId) {
  return `/api/fotos-visitas?fileId=${encodeURIComponent(fileId)}`;
}
// Elimina una foto de Drive. Es "best-effort" (no se espera ni se bloquea la UI por esto):
// si falla, la foto queda huérfana en Drive pero eso no debe impedir que el usuario
// continúe editando el registro.
function eliminarFotoDrive(fileId) {
  if (!fileId) return;
  fetch(`/api/fotos-visitas?fileId=${encodeURIComponent(fileId)}`, { method: "DELETE", credentials: "include" })
    .catch((e) => console.error("[fotos drive] no se pudo eliminar", fileId, e));
}
// Descarga una foto de Drive y la devuelve como dataUrl (usado por buildVisitaPdf para
// poder incrustarla en el PDF, que necesita los bytes en el momento, no una URL).
async function obtenerFotoDriveComoDataUrl(fileId) {
  const res = await fetch(urlFotoDrive(fileId), { credentials: "include" });
  if (!res.ok) throw new Error(`No se pudo descargar la foto (${res.status})`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

// El Informe Tecnico (buildInformePdf) y el Informe de Infraestructura (buildInformeInfraPdf), mas
// abajo, reutilizan PDF_FIT_SCALES/PDF_FIT_MARGIN_FRACTIONS (definidas junto a Cotizacion) para
// entrar en una sola pagina con margen superior/inferior iguales, con el mismo criterio.

function imageFormatFromDataUrl(dataUrl) {
  if (/^data:image\/png/i.test(dataUrl || "")) return "PNG";
  if (/^data:image\/webp/i.test(dataUrl || "")) return "WEBP";
  return "JPEG";
}

// Ajusta una imagen ya cargada como dataUrl dentro de una celda de destino (targetW x targetH)
// SIN recortarla, tal como "object-fit: contain" en CSS: se escala la imagen entera (sin
// deformarla) para que quepa completa dentro de la celda, centrada, rellenando con blanco el
// espacio sobrante a los lados o arriba/abajo si la proporción no coincide exactamente.
function containFitDataUrl(dataUrl, srcW, srcH, targetW, targetH) {
  return new Promise((resolve) => {
    if (!dataUrl || !srcW || !srcH) { resolve(dataUrl); return; }
    const img = new Image();
    img.onload = () => {
      try {
        const outW = Math.max(1, Math.round(targetW * 2));
        const outH = Math.max(1, Math.round(targetH * 2));
        const scale = Math.min(outW / srcW, outH / srcH);
        const drawW = srcW * scale, drawH = srcH * scale;
        const dx = (outW - drawW) / 2, dy = (outH - drawH) / 2;
        const canvas = document.createElement("canvas");
        canvas.width = outW; canvas.height = outH;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, outW, outH);
        ctx.drawImage(img, 0, 0, srcW, srcH, dx, dy, drawW, drawH);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      } catch (e) { console.error(e); resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// Igual que containFitDataUrl, pero en vez de encoger la foto para que quepa
// completa (dejando franjas blancas cuando su proporción no coincide con la
// celda), la escala para CUBRIR el recuadro completo y recorta el sobrante
// (equivalente a "object-fit: cover" en CSS). Corrige el espacio en blanco
// de las fotos en Informes, Informe de Infraestructura y Visita Técnica.
function coverFitDataUrl(dataUrl, srcW, srcH, targetW, targetH) {
  return new Promise((resolve) => {
    if (!dataUrl || !srcW || !srcH) { resolve(dataUrl); return; }
    const img = new Image();
    img.onload = () => {
      try {
        const outW = Math.max(1, Math.round(targetW * 2));
        const outH = Math.max(1, Math.round(targetH * 2));
        const scale = Math.max(outW / srcW, outH / srcH);
        const drawW = srcW * scale, drawH = srcH * scale;
        const dx = (outW - drawW) / 2, dy = (outH - drawH) / 2;
        const canvas = document.createElement("canvas");
        canvas.width = outW; canvas.height = outH;
        const ctx = canvas.getContext("2d");
        // Sin fondo blanco: con Math.max la imagen siempre cubre todo el canvas.
        ctx.drawImage(img, 0, 0, srcW, srcH, dx, dy, drawW, drawH);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      } catch (e) { console.error(e); resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// Grilla de fotos con el NOMBRE en su propio marco y la foto llenando TODA la celda (sin
// franjas en blanco). Es la única implementación: antes había tres copias casi idénticas en
// buildInformePdf, buildInformeInfraPdf y buildVisitaPdf, y el mismo error (fotos con espacio
// en blanco y nombre "flotando") hubo que corregirlo en los tres sitios.
//
// Cada generador la llama con sus propias medidas. Como el eje vertical `y` y el salto de
// página (`ensureSpace`) viven dentro de cada generador, se reciben como getY/setY/ensureSpace.
//   proporcionAlto : alto de la foto = ancho de columna * scale * proporcionAlto.
//                    1 = celdas cuadradas mientras el ancho alcance (con escalas chicas se
//                    "aplanan" un poco para entrar en una página); Visita usa 0.62 (apaisadas).
//   nombreDefecto  : texto del nombre cuando la foto no trae uno.
//   cajaVaciaAlto  : si no hay fotos, alto de un recuadro vacío (null = no dibujar nada).
//   estiloBorde    : { color, ancho } para fijar el trazo antes de las líneas (null = el actual).
//   aireDespues    : espacio extra debajo de la grilla.
async function dibujarGrillaFotos(doc, fotos, o) {
  const { marginX, contentW, scale, ensureSpace, getY, setY } = o;
  const proporcionAlto = o.proporcionAlto ?? 1;
  const nombreDefecto = o.nombreDefecto || ((i) => `Fotografía ${i + 1}`);
  const validas = (fotos || []).filter((f) => f && f.dataUrl);
  if (!validas.length) {
    if (o.cajaVaciaAlto) {
      ensureSpace(o.cajaVaciaAlto);
      doc.rect(marginX, getY(), contentW, o.cajaVaciaAlto);
      setY(getY() + o.cajaVaciaAlto);
    }
    return;
  }
  const cols = 2;
  const colW = contentW / cols;
  const imgH = colW * scale * proporcionAlto;
  const captionH = 13 * scale;
  const rows = Math.ceil(validas.length / cols);
  const boxH = rows * (imgH + captionH);
  ensureSpace(boxH);
  const boxY = getY();
  const captionPad = 5 * scale;
  function captionLine(texto, maxWidth) {
    const lines = doc.splitTextToSize(String(texto || ""), maxWidth);
    if (!lines.length) return "";
    let line = lines[0];
    if (lines.length > 1) { while (line.length > 1 && doc.getTextWidth(line + "…") > maxWidth) line = line.slice(0, -1); line += "…"; }
    return line;
  }
  // Primero se dibujan las fotos y recién encima el recuadro y las líneas divisorias,
  // para que el borde superior y las líneas entre celdas NO queden tapados por las imágenes.
  for (let fi = 0; fi < validas.length; fi++) {
    const col = fi % cols, row = Math.floor(fi / cols);
    const foto = validas[fi];
    const cellX = marginX + col * colW;
    const cellY = boxY + row * (imgH + captionH);
    const imgY = cellY + captionH;
    const imgW = foto.width || colW, imgHOrig = foto.height || imgH;
    // Marco propio del nombre: fondo gris claro, para que se lea como un recuadro
    // separado y no como texto flotando sobre el borde de la celda.
    doc.setFillColor(245, 245, 245);
    doc.rect(cellX, cellY, colW, captionH, "F");
    let dataUrl = foto.dataUrl;
    try { dataUrl = await coverFitDataUrl(foto.dataUrl, imgW, imgHOrig, colW, imgH); } catch (e) { console.error(e); }
    try { doc.addImage(dataUrl, imageFormatFromDataUrl(dataUrl), cellX, imgY, colW, imgH, undefined, "FAST"); } catch (e) { console.error(e); }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8 * scale);
    doc.setTextColor(60, 60, 60);
    const nombre = foto.nombre || nombreDefecto(fi);
    doc.text(captionLine(nombre, colW - captionPad * 2), cellX + colW / 2, cellY + captionH / 2 + 2.5 * scale, { align: "center" });
  }
  if (o.estiloBorde) {
    doc.setDrawColor(...o.estiloBorde.color);
    doc.setLineWidth(o.estiloBorde.ancho);
  }
  doc.rect(marginX, boxY, contentW, boxH);
  // Línea central que separa las dos columnas de fotos.
  doc.line(marginX + colW, boxY, marginX + colW, boxY + boxH);
  // Línea entre el marco del nombre y la foto en TODAS las filas (antes solo se dibujaban
  // divisorias ENTRE filas, así que con 1 o 2 fotos el nombre quedaba sin marco separador).
  for (let r = 0; r < rows; r++) {
    const ly = boxY + r * (imgH + captionH) + captionH;
    doc.line(marginX, ly, marginX + contentW, ly);
  }
  // Líneas horizontales entre filas (si hay más de una).
  for (let r = 1; r < rows; r++) {
    const ly = boxY + r * (imgH + captionH);
    doc.line(marginX, ly, marginX + contentW, ly);
  }
  setY(boxY + boxH + (o.aireDespues || 0));
}

async function buildInformePdf(informe, { download = true } = {}) {
  const { jsPDF } = await import("jspdf");
  const logoData = await loadImageAsDataUrl(LOGO_SHIELD);
  const fotosParaPdf = await resolverFotosParaPdf(informe.fotos, "informe pdf");

  let lastDoc = null;

  // Mismo enfoque de Cotizacion: se prueba primero con el margen completo y letra normal: si el
  // contenido no entra en una sola pagina, se va recortando el margen en blanco de arriba/abajo
  // y, si eso ya llego a 0, se reduce la letra un escalon y se vuelve a probar con margen completo.
  // Solo en el ultimo intento (escala minima, margen 0) se acepta abrir una segunda pagina, para
  // nunca cortar informacion.
  scaleLoop:
  for (let i = 0; i < PDF_FIT_SCALES.length; i++) {
    const scale = PDF_FIT_SCALES[i];
    const isLastScale = i === PDF_FIT_SCALES.length - 1;
    for (let mi = 0; mi < PDF_FIT_MARGIN_FRACTIONS.length; mi++) {
      const marginFraction = PDF_FIT_MARGIN_FRACTIONS[mi];
      const isLastAttempt = isLastScale && mi === PDF_FIT_MARGIN_FRACTIONS.length - 1;
      try {
        const doc = new jsPDF({ unit: "pt", format: "a4" });
        doc.setProperties({
          title: `Informe Tecnico ${informe.codigo || ""}`.trim(),
          subject: `Informe técnico de servicio para ${informe.cliente || "cliente"}`,
          author: WILARCON_EMPRESA.nombre,
          creator: WILARCON_EMPRESA.nombre,
        });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const marginX = Math.max(28, 42 * scale);
        const contentW = pageW - 2 * marginX;
        // Margen en blanco de arriba (desde el borde de la hoja hasta el logo) y de abajo (desde
        // la ultima linea del pie de pagina hasta el borde) exactamente del mismo tamaño: es el
        // valor que se recorta primero (via marginFraction) antes de tocar la letra.
        const marginTop = Math.max(14, 24 * scale * marginFraction);

        function drawHeader() {
          const LOGO_ASPECT = 226 / 200;
          const logoHeight = 30 * scale;
          const logoWidth = logoHeight * LOGO_ASPECT;
          const logoTopY = marginTop;
          const topY = logoTopY + logoHeight - 6 * scale;
          if (logoData) {
            try { doc.addImage(logoData, "PNG", marginX, logoTopY, logoWidth, logoHeight); } catch (e) { console.error(e); }
          }
          doc.setFont("helvetica", "bold");
          doc.setFontSize(14 * scale);
          doc.setTextColor(56, 98, 140);
          doc.text("WILARCON", marginX + logoWidth + 8 * scale, topY, { align: "left" });

          doc.setFont("helvetica", "bold");
          doc.setFontSize(12.5 * scale);
          doc.setTextColor(20, 20, 20);
          doc.text("INFORME TÉCNICO", pageW - marginX, topY - 13 * scale, { align: "right" });
          doc.text("DE SERVICIO", pageW - marginX, topY, { align: "right" });
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8.5 * scale);
          doc.setTextColor(56, 98, 140);
          doc.text(`Código: ${informe.codigo || "-"}`, pageW - marginX, topY + 11 * scale, { align: "right" });
          doc.text(`Versión: ${informe.version || "01"}`, pageW - marginX, topY + 21 * scale, { align: "right" });
          doc.text(`Fecha: ${fmtDate(informe.fecha) || informe.fecha || "-"}`, pageW - marginX, topY + 31 * scale, { align: "right" });

          const headerBottom = topY + 34 * scale;
          doc.setDrawColor(200, 200, 200);
          doc.setLineWidth(0.75);
          doc.line(marginX, headerBottom, pageW - marginX, headerBottom);
          return headerBottom + 22 * scale;
        }

        // Se ancla el pie de pagina desde ABAJO tomando marginTop como referencia (igual que el
        // margen de arriba), en vez de una distancia fija al borde: asi ambos margenes miden lo
        // mismo sea cual sea la escala/fraccion en uso.
        const pageNumY = pageH - marginTop;
        const contactY = pageNumY - 16 * scale;
        const footerLineY = contactY - 16 * scale;
        const contMaxY = footerLineY - 8 * scale;

        function drawFooter(pageNum, pageCount) {
          doc.setDrawColor(200, 200, 200);
          doc.setLineWidth(0.75);
          doc.line(marginX, footerLineY, pageW - marginX, footerLineY);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8 * scale);
          doc.setTextColor(56, 98, 140);
          doc.text(`Tel: ${WILARCON_EMPRESA.telefonoFooter}   |   Email: ${WILARCON_EMPRESA.emailFooter}`, pageW / 2, contactY, { align: "center" });
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7.5 * scale);
          doc.setTextColor(120, 120, 120);
          doc.text(`Página ${pageNum} de ${pageCount}`, pageW - marginX, pageNumY, { align: "right" });
        }

        let y = drawHeader();
        function ensureSpace(needed) {
          if (y + needed > contMaxY) {
            if (isLastAttempt) {
              doc.addPage();
              y = drawHeader();
            } else {
              throw new RetrySmallerScale();
            }
          }
        }
        function sectionTitle(n, text) {
          ensureSpace(30 * scale);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11 * scale);
          doc.setTextColor(56, 98, 140);
          doc.text(`${n}. ${text}`, marginX, y);
          y += 8 * scale;
          doc.setDrawColor(220, 226, 232);
          doc.setLineWidth(0.5);
          doc.line(marginX, y, pageW - marginX, y);
          y += 16 * scale;
        }
        function paragraph(text) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9.5 * scale);
          doc.setTextColor(30, 30, 30);
          const lines = doc.splitTextToSize(String(text || "-"), contentW);
          lines.forEach((line) => { ensureSpace(14 * scale); doc.text(line, marginX, y); y += 13.5 * scale; });
          y += 6 * scale;
        }
        function labelValueRow(label, value) {
          ensureSpace(15 * scale);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(9.5 * scale);
          doc.setTextColor(20, 20, 20);
          doc.text(label, marginX, y);
          doc.setFont("helvetica", "normal");
          doc.setTextColor(50, 50, 50);
          doc.text(String(value || "-"), marginX + 120 * scale, y);
          y += 15 * scale;
        }
        function numberedList(items) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9.5 * scale);
          doc.setTextColor(30, 30, 30);
          (items || []).filter((t) => String(t || "").trim()).forEach((t, idx) => {
            const prefix = `${idx + 1}. `;
            const lines = doc.splitTextToSize(String(t), contentW - 18 * scale);
            lines.forEach((line, li) => {
              ensureSpace(14 * scale);
              doc.text(li === 0 ? prefix + line : line, marginX + (li === 0 ? 0 : 18 * scale), y);
              y += 13.5 * scale;
            });
          });
          y += 6 * scale;
        }
        // Misma organizacion de fotos que el Informe de Infraestructura (fotosBox de
        // buildInformeInfraPdf): grilla de 2 columnas rellena con cover-crop (sin dejar
        // franjas en blanco), en un solo recuadro con lineas divisorias entre celdas, en vez
        // del layout anterior (una foto por celda "contenida" con su leyenda "Fotografia N").
                function fotosBox(fotos) {
          return dibujarGrillaFotos(doc, fotos, {
            marginX, contentW, scale, ensureSpace,
            getY: () => y, setY: (v) => { y = v; },
            estiloBorde: { color: [150, 150, 150], ancho: 0.75 },
            // Aire extra (mayor que el de paragraph/numberedList) para que el título de la
            // siguiente sección no quede pegado al borde inferior de la cuadrícula de fotos.
            aireDespues: 16 * scale,
          });
        }

        sectionTitle(1, "DATOS GENERALES");
        labelValueRow("Cliente:", informe.cliente);
        labelValueRow("Ubicación:", informe.ubicacion);
        if (informe.telefono) labelValueRow("Teléfono:", informe.telefono);
        if (informe.ordenCompra) labelValueRow("Orden de Compra:", informe.ordenCompra);
        labelValueRow("Fecha de Visita:", fmtDate(informe.fechaVisita) || informe.fechaVisita);
        labelValueRow("Fecha de Inicio:", fmtDate(informe.fechaInicio) || informe.fechaInicio);
        labelValueRow("Fecha de Fin:", fmtDate(informe.fechaFin) || informe.fechaFin);
        y += 8 * scale;

        sectionTitle(2, "OBJETIVO DEL SERVICIO");
        paragraph(informe.objetivo);

        sectionTitle(3, "DESCRIPCIÓN DEL TRABAJO REALIZADO");
        paragraph(informe.descripcion);

        const trabajosValidos = (informe.trabajos || []).filter((t) => String(t || "").trim());
        if (trabajosValidos.length) {
          sectionTitle(4, "TRABAJOS EJECUTADOS");
          numberedList(trabajosValidos);
        }

        const fotosValidas = fotosParaPdf.filter((f) => f && f.dataUrl);
        if (fotosValidas.length) {
          sectionTitle(5, "EVIDENCIA FOTOGRÁFICA");
          await fotosBox(fotosParaPdf);
        }

        const obsValidas = (informe.observaciones || []).filter((o) => String(o || "").trim());
        if (obsValidas.length) {
          sectionTitle(6, "OBSERVACIONES Y HALLAZGOS");
          numberedList(obsValidas);
        }

        if (String(informe.comentarios || "").trim()) {
          sectionTitle(7, "RECOMENDACIONES");
          paragraph(informe.comentarios);
        }

        const totalPages = doc.internal.getNumberOfPages();
        for (let p = 1; p <= totalPages; p++) {
          doc.setPage(p);
          drawFooter(p, totalPages);
        }

        lastDoc = doc;
        break scaleLoop;
      } catch (e) {
        if (e instanceof RetrySmallerScale) continue;
        throw e;
      }
    }
  }

  if (!lastDoc) {
    throw new Error("No se pudo generar el PDF del informe.");
  }

  // Nombre de archivo: código + objetivo del servicio (p.ej. "IT-001_MANTENIMIENTO_PREVENTIVO_DE_LOGO.pdf"),
  // para que el archivo descargado ya diga de qué trata sin tener que abrirlo.
  const nombreBase = `${informe.codigo || "IT"}_${informe.objetivo || ""}`.trim();
  const nombreArchivo = `${nombreBase.replace(/[^\w-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "")}.pdf`;
  if (download) lastDoc.save(nombreArchivo);
  return { doc: lastDoc, fileName: nombreArchivo };
}

// ===== INFORME INFRAESTRUCTURA (reporte de avance de obra, formato tabla) =====
// Los logos LAUREATE y del cliente son fijos (mismos en todos los informes de este tipo,
// según se confirmó); por ahora se dibuja el nombre "LAUREATE" en texto porque el archivo
// de imagen del logo no fue provisto — si se agrega el PNG/JPG a src/assets se puede sumar
// aquí con doc.addImage igual que el logo de WILARCON.
function drawInfraCellText(doc, text, x, y, w, opts = {}) {
  const { align = "left", bold = false, size = 8.5, color = [20, 20, 20] } = opts;
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(size);
  doc.setTextColor(...color);
  const tx = align === "center" ? x + w / 2 : align === "right" ? x + w : x;
  doc.text(String(text || ""), tx, y, { align });
}

async function buildInformeInfraPdf(informe, { download = true } = {}) {
  const { jsPDF } = await import("jspdf");
  const logoData = await loadImageAsDataUrl(LOGO_SHIELD);
  const logoLaureateData = await loadImageAsDataUrl(LOGO_LAUREATE);
  const inicioObraFotosPdf = await resolverFotosParaPdf(informe.inicioObraFotos, "informe infra pdf");
  const avanceFinalFotosPdf = await resolverFotosParaPdf(informe.avanceFinalFotos, "informe infra pdf");

  let lastDoc = null;

  // Mismo criterio de "una sola pagina, margen superior/inferior igual" que Cotizacion y el
  // Informe Tecnico (ver PDF_FIT_SCALES/PDF_FIT_MARGIN_FRACTIONS): se prueba primero recortando
  // el margen en blanco de arriba/abajo y, si no alcanza, se reduce la letra y las cajas/fotos
  // un escalon a la vez. Solo en el ultimo intento se acepta abrir una segunda pagina.
  scaleLoop:
  for (let i = 0; i < PDF_FIT_SCALES.length; i++) {
    const scale = PDF_FIT_SCALES[i];
    const isLastScale = i === PDF_FIT_SCALES.length - 1;
    for (let mi = 0; mi < PDF_FIT_MARGIN_FRACTIONS.length; mi++) {
      const marginFraction = PDF_FIT_MARGIN_FRACTIONS[mi];
      const isLastAttempt = isLastScale && mi === PDF_FIT_MARGIN_FRACTIONS.length - 1;
      try {
        const doc = new jsPDF({ unit: "pt", format: "a4" });
        doc.setProperties({
          title: `Reporte de Avance ${informe.codigo || ""}`.trim(),
          subject: `Reporte de avance de obra — ${informe.proyecto || "proyecto"}`,
          author: WILARCON_EMPRESA.nombre,
          creator: WILARCON_EMPRESA.nombre,
        });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        // Un solo margen para los 4 lados (izquierda, derecha, arriba y abajo), para que el
        // contenido aproveche el mayor espacio posible en cada página: es lo primero que se
        // recorta (via marginFraction) antes de reducir la letra.
        const margin = Math.max(12, 24 * scale * marginFraction);
        const marginX = margin;
        const contentW = pageW - 2 * marginX;
        let y = margin;

        doc.setDrawColor(150, 150, 150);
        doc.setLineWidth(0.75);

        // ---- Cabecera de 3 columnas: WILARCON | Título del proyecto | LAUREATE + cliente ----
        const headerH = 46 * scale;
        const colWilarconW = contentW * 0.22;
        const colTituloW = contentW * 0.52;
        const colLogosW = contentW - colWilarconW - colTituloW;
        const xWilarcon = marginX;
        const xTitulo = marginX + colWilarconW;
        const xLogos = xTitulo + colTituloW;

        doc.rect(marginX, y, contentW, headerH);
        doc.line(xTitulo, y, xTitulo, y + headerH);
        doc.line(xLogos, y, xLogos, y + headerH);
        if (logoData) {
          try {
            const logoH = 24 * scale, logoW = logoH * (226 / 200);
            doc.addImage(logoData, "PNG", xWilarcon + (colWilarconW - logoW) / 2, y + (headerH - logoH) / 2, logoW, logoH);
          } catch (e) { console.error(e); }
        }
        drawInfraCellText(doc, informe.proyecto || "-", xTitulo + colTituloW / 2, y + headerH / 2 - 2 * scale, 0, { align: "center", bold: true, size: 10.5 * scale });
        drawInfraCellText(doc, "REPORTE DE AVANCE DE OBRA", xTitulo + colTituloW / 2, y + headerH / 2 + 13 * scale, 0, { align: "center", size: 7.5 * scale, color: [90, 90, 90] });
        if (logoLaureateData) {
          try {
            const maxLogoW = colLogosW - 16 * scale;
            const naturalRatio = 250 / 74;
            let laureateW = maxLogoW, laureateH = laureateW / naturalRatio;
            const maxLogoH = headerH - 12 * scale;
            if (laureateH > maxLogoH) { laureateH = maxLogoH; laureateW = laureateH * naturalRatio; }
            doc.addImage(logoLaureateData, "PNG", xLogos + (colLogosW - laureateW) / 2, y + (headerH - laureateH) / 2, laureateW, laureateH);
          } catch (e) { console.error(e); }
        }
        y += headerH;

        // ---- Rango de fechas + "REPORTE DEL AVANCE" ----
        const subH = 30 * scale;
        doc.rect(marginX, y, contentW, subH);
        drawInfraCellText(doc, `Del ${fmtDate(informe.fechaInicio) || informe.fechaInicio || "-"} al ${fmtDate(informe.fechaFin) || informe.fechaFin || "-"}`, marginX + contentW / 2, y + 13 * scale, 0, { align: "center", bold: true, size: 10 * scale });
        drawInfraCellText(doc, "REPORTE DEL AVANCE", marginX + contentW / 2, y + 25 * scale, 0, { align: "center", bold: true, size: 9.5 * scale });
        y += subH;

        // ---- Datos de proyecto (# de proyecto / proveedor / orden de compra) ----
        const datos = [
          ["# DE PROYECTO", informe.numeroProyecto],
          ["PROVEEDOR", informe.proveedor],
          ["ORDEN DE COMPRA", informe.ordenCompra],
        ];
        const filaH = 16 * scale;
        datos.forEach(([label, val]) => {
          doc.rect(marginX, y, contentW, filaH);
          drawInfraCellText(doc, label, marginX + 8 * scale, y + 11 * scale, 0, { bold: true, size: 8.5 * scale });
          drawInfraCellText(doc, val || "-", marginX + 150 * scale, y + 11 * scale, 0, { size: 8.5 * scale });
          y += filaH;
        });

        function sectionBar(titulo) {
          const barH = 16 * scale;
          doc.rect(marginX, y, contentW, barH);
          drawInfraCellText(doc, titulo, marginX + contentW / 2, y + 11 * scale, 0, { align: "center", bold: true, size: 9 * scale });
          y += barH;
        }

        // El numero de pagina se ancla desde ABAJO usando el mismo margin que arriba/izquierda/
        // derecha, para que los 4 lados midan exactamente lo mismo en cualquier escala.
        const pageNumY = pageH - margin;
        const contMaxY = pageNumY - 10 * scale;

        function ensureSpace(needed) {
          if (y + needed > contMaxY) {
            if (isLastAttempt) { doc.addPage(); y = margin; }
            else throw new RetrySmallerScale();
          }
        }
        function textBox(texto, minH = 46) {
          const pad = 8 * scale;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9 * scale);
          doc.setTextColor(30, 30, 30);
          const lines = doc.splitTextToSize(String(texto || "-"), contentW - pad * 2);
          const boxH = Math.max(minH * scale, lines.length * 12 * scale + pad * 2);
          ensureSpace(boxH);
          doc.rect(marginX, y, contentW, boxH);
          lines.forEach((line, li) => doc.text(line, marginX + pad, y + pad + 9 * scale + li * 12 * scale));
          y += boxH;
        }
                function fotosBox(fotos) {
          return dibujarGrillaFotos(doc, fotos, {
            marginX, contentW, scale, ensureSpace,
            getY: () => y, setY: (v) => { y = v; },
          });
        }

        ensureSpace(16 * scale);
        sectionBar("DESCRIPCIÓN DE PROYECTO");
        textBox(informe.descripcionProyecto, 40);

        ensureSpace(16 * scale);
        sectionBar("INICIO DE OBRA");
        textBox(informe.inicioObraTexto, 40);
        await fotosBox(inicioObraFotosPdf);

        // AVANCE FINAL va SIEMPRE en la página 2, sin excepción (aunque hubiera espacio de
        // sobra en la página 1): se fuerza el salto de página aquí en vez de decidirlo según
        // el espacio restante.
        doc.addPage();
        y = margin;
        sectionBar("AVANCE FINAL");
        textBox(informe.avanceFinalTexto, 40);
        await fotosBox(avanceFinalFotosPdf);

        // ---- Firmas ----
        const firmaH = 52 * scale;
        ensureSpace(firmaH);
        y += 14 * scale;
        const firmaColW = contentW / 2;
        function firma(x, w, nombre, cargo) {
          const lineY = y + 26 * scale;
          doc.setDrawColor(60, 60, 60);
          doc.line(x + 20 * scale, lineY, x + w - 20 * scale, lineY);
          drawInfraCellText(doc, nombre || "", x + w / 2, lineY - 4 * scale, 0, { align: "center", size: 8.5 * scale });
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7.5 * scale);
          const lines = doc.splitTextToSize(cargo, w - 30 * scale);
          lines.forEach((line, li) => doc.text(line, x + w / 2, lineY + 12 * scale + li * 9 * scale, { align: "center" }));
        }
        firma(marginX, firmaColW, informe.firmaProveedor, "PROVEEDOR");
        firma(marginX + firmaColW, firmaColW, informe.firmaGerente, "GERENTE DE PROYECTOS DE INFRAESTRUCTURA O COORDINADOR REMODELACIONES");
        y += firmaH;
        firma(marginX + firmaColW / 2, firmaColW, informe.firmaDirector, "DIRECTOR DE REAL ESTATE");
        y += firmaH;

        const totalPages = doc.internal.getNumberOfPages();
        for (let p = 1; p <= totalPages; p++) {
          doc.setPage(p);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7.5 * scale);
          doc.setTextColor(120, 120, 120);
          doc.text(`Página ${p} de ${totalPages}`, pageW - marginX, pageNumY, { align: "right" });
        }

        lastDoc = doc;
        break scaleLoop;
      } catch (e) {
        if (e instanceof RetrySmallerScale) continue;
        throw e;
      }
    }
  }

  if (!lastDoc) {
    throw new Error("No se pudo generar el PDF del reporte de avance.");
  }

  const nombreArchivo = `Reporte_${(informe.codigo || "infra").replace(/[^\w-]+/g, "_")}.pdf`;
  if (download) lastDoc.save(nombreArchivo);
  return { doc: lastDoc, fileName: nombreArchivo };
}
// ===================== VISITAS TÉCNICAS (página aparte) =====================
// Módulo independiente (no un tercer "tipo" dentro de Informes Técnicos): tiene su propio
// storage, su propio correlativo y su propio generador de PDF. Formato de formulario con
// recuadros/líneas tomado del PDF de referencia del usuario: Requerimiento / Lugar+Fecha /
// Responsable+Hora / Contacto+Teléfono / Presupuesto, luego Requisitos del cliente,
// Diagramas/Fotos y Observaciones.
const STORAGE_KEY_VISITAS = "wilarcon_visitas_records";

function emptyVisitaDraft() {
  return {
    id: uid(),
    codigo: "",
    nombreProyecto: "",
    lugar: "",
    fecha: todayStr(),
    responsable: "",
    hora: nowTimeStr(),
    contacto: "",
    telefono: "",
    presupuesto: "",
    requisitos: [""],
    materiales: [],
    fotos: [],
    observaciones: "",
    creadoPor: "",
    actualizadoEn: Date.now(),
  };
}

function siguienteCodigoVisita(visitas) {
  let max = 0;
  (visitas || []).forEach((v) => {
    const m = String(v?.codigo || "").match(/(\d+)\s*$/);
    if (m) { const n = parseInt(m[1], 10); if (Number.isFinite(n) && n > max) max = n; }
  });
  return `IV-${String(max + 1).padStart(3, "0")}`;
}

// Las fotos nuevas se guardan como driveFileId (no dataUrl) para no llenar Neon; esta funcion
// las descarga una sola vez, antes del bucle de reintentos de escala de cada PDF, para poder
// incrustarlas. Los registros viejos que aun tengan dataUrl guardado directamente siguen
// funcionando igual que antes, sin necesidad de migrarlos. Usada por buildVisitaPdf,
// buildInformePdf y buildInformeInfraPdf.
async function resolverFotosParaPdf(fotos, logLabel = "pdf") {
  return Promise.all(
    (fotos || []).map(async (f) => {
      if (f && f.dataUrl) return f;
      if (f && f.driveFileId) {
        try {
          const dataUrl = await obtenerFotoDriveComoDataUrl(f.driveFileId);
          return { ...f, dataUrl };
        } catch (e) {
          console.error(`[${logLabel}] no se pudo descargar foto de Drive`, f.driveFileId, e);
          return f;
        }
      }
      return f;
    })
  );
}

async function buildVisitaPdf(visita, { download = true } = {}) {
  const { jsPDF } = await import("jspdf");
  const logoData = await loadImageAsDataUrl(LOGO_SHIELD);

  const fotosParaPdf = await resolverFotosParaPdf(visita.fotos, "visita pdf");

  let lastDoc = null;

  scaleLoop:
  for (let i = 0; i < PDF_FIT_SCALES.length; i++) {
    const scale = PDF_FIT_SCALES[i];
    const isLastScale = i === PDF_FIT_SCALES.length - 1;
    for (let mi = 0; mi < PDF_FIT_MARGIN_FRACTIONS.length; mi++) {
      const marginFraction = PDF_FIT_MARGIN_FRACTIONS[mi];
      const isLastAttempt = isLastScale && mi === PDF_FIT_MARGIN_FRACTIONS.length - 1;
      try {
        const doc = new jsPDF({ unit: "pt", format: "a4" });
        doc.setProperties({
          title: `Informe de Visita Técnica ${visita.codigo || ""}`.trim(),
          subject: `Informe de visita técnica — ${visita.nombreProyecto || "proyecto"}`,
          author: WILARCON_EMPRESA.nombre,
          creator: WILARCON_EMPRESA.nombre,
        });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const margin = Math.max(12, 24 * scale * marginFraction);
        const marginX = margin;
        const contentW = pageW - 2 * marginX;
        let y = margin;

        doc.setDrawColor(120, 120, 120);
        doc.setLineWidth(0.75);

        const pageNumY = pageH - margin;
        const contMaxY = pageNumY - 10 * scale;
        function ensureSpace(needed) {
          if (y + needed > contMaxY) {
            if (isLastAttempt) { doc.addPage(); y = margin; }
            else throw new RetrySmallerScale();
          }
        }

        // ---- Cabecera: logo + título ----
        const headerH = 34 * scale;
        const logoW = headerH * 0.85;
        doc.rect(marginX, y, contentW, headerH);
        doc.line(marginX + logoW + 14 * scale, y, marginX + logoW + 14 * scale, y + headerH);
        if (logoData) {
          try { doc.addImage(logoData, "PNG", marginX + 6 * scale, y + (headerH - logoW * (200 / 226)) / 2, logoW, logoW * (200 / 226)); } catch (e) { console.error(e); }
        }
        drawInfraCellText(doc, "INFORME DE VISITA TÉCNICA", marginX + logoW + 14 * scale + (contentW - logoW - 14 * scale) / 2, y + headerH / 2 + 3 * scale, 0, { align: "center", bold: true, size: 12 * scale });
        y += headerH;

        // ---- Datos generales (formulario con recuadros, igual al PDF de referencia) ----
        const rowH = 17 * scale;
        function fieldRow(label, value) {
          doc.rect(marginX, y, contentW, rowH);
          drawInfraCellText(doc, `${label}:`, marginX + 8 * scale, y + rowH / 2 + 3 * scale, 0, { bold: true, size: 8.5 * scale });
          const labelW = doc.getTextWidth(`${label}: `);
          drawInfraCellText(doc, value || "-", marginX + 8 * scale + labelW + 4 * scale, y + rowH / 2 + 3 * scale, 0, { size: 8.5 * scale });
          y += rowH;
        }
        function twoFieldRow(labelL, valL, labelR, valR) {
          const halfW = contentW / 2;
          doc.rect(marginX, y, contentW, rowH);
          doc.line(marginX + halfW, y, marginX + halfW, y + rowH);
          drawInfraCellText(doc, `${labelL}:`, marginX + 8 * scale, y + rowH / 2 + 3 * scale, 0, { bold: true, size: 8.5 * scale });
          const wL = doc.getTextWidth(`${labelL}: `);
          drawInfraCellText(doc, valL || "-", marginX + 8 * scale + wL + 4 * scale, y + rowH / 2 + 3 * scale, 0, { size: 8.5 * scale });
          drawInfraCellText(doc, `${labelR}:`, marginX + halfW + 8 * scale, y + rowH / 2 + 3 * scale, 0, { bold: true, size: 8.5 * scale });
          const wR = doc.getTextWidth(`${labelR}: `);
          drawInfraCellText(doc, valR || "-", marginX + halfW + 8 * scale + wR + 4 * scale, y + rowH / 2 + 3 * scale, 0, { size: 8.5 * scale });
          y += rowH;
        }

        fieldRow("SOLICITUD / PROYECTO", visita.nombreProyecto);
        twoFieldRow("LUGAR", visita.lugar, "FECHA", fmtDate(visita.fecha) || visita.fecha);
        twoFieldRow("RESPONSABLE", visita.responsable, "HORA", visita.hora);
        twoFieldRow("CONTACTO", visita.contacto, "TELÉFONO", visita.telefono);
        fieldRow("PRESUPUESTO", visita.presupuesto);

        function sectionBar(titulo) {
          const barH = 16 * scale;
          ensureSpace(barH);
          doc.rect(marginX, y, contentW, barH);
          drawInfraCellText(doc, titulo, marginX + 8 * scale, y + barH / 2 + 3 * scale, 0, { bold: true, size: 8.5 * scale });
          y += barH;
        }
        function textBox(texto, minH = 60) {
          const pad = 8 * scale;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9 * scale);
          doc.setTextColor(30, 30, 30);
          const lines = doc.splitTextToSize(String(texto || "-"), contentW - pad * 2);
          const boxH = Math.max(minH * scale, lines.length * 12 * scale + pad * 2);
          ensureSpace(boxH);
          doc.rect(marginX, y, contentW, boxH);
          lines.forEach((line, li) => doc.text(line, marginX + pad, y + pad + 9 * scale + li * 12 * scale));
          y += boxH;
        }
                function fotosBox(fotos) {
          return dibujarGrillaFotos(doc, fotos, {
            marginX, contentW, scale, ensureSpace,
            getY: () => y, setY: (v) => { y = v; },
            proporcionAlto: 0.62, // celdas apaisadas
            nombreDefecto: (i) => String(i + 1),
            cajaVaciaAlto: 46 * scale,
          });
        }
        function materialesTable(materiales) {
          const lista = (materiales || []).filter((m) => m && String(m.nombre || "").trim());
          const colMaterialW = contentW * 0.6;
          const colUnidadW = contentW * 0.2;
          const headH = 15 * scale;
          const rowH2 = 15 * scale;
          function verticalLines(yy, hh) {
            doc.line(marginX + colMaterialW, yy, marginX + colMaterialW, yy + hh);
            doc.line(marginX + colMaterialW + colUnidadW, yy, marginX + colMaterialW + colUnidadW, yy + hh);
          }
          ensureSpace(headH);
          doc.rect(marginX, y, contentW, headH);
          verticalLines(y, headH);
          drawInfraCellText(doc, "MATERIAL", marginX + 8 * scale, y + headH / 2 + 3 * scale, 0, { bold: true, size: 8 * scale });
          drawInfraCellText(doc, "UNIDAD", marginX + colMaterialW + 8 * scale, y + headH / 2 + 3 * scale, 0, { bold: true, size: 8 * scale });
          drawInfraCellText(doc, "CANTIDAD", marginX + colMaterialW + colUnidadW + 8 * scale, y + headH / 2 + 3 * scale, 0, { bold: true, size: 8 * scale });
          y += headH;
          if (!lista.length) {
            ensureSpace(rowH2);
            doc.rect(marginX, y, contentW, rowH2);
            verticalLines(y, rowH2);
            drawInfraCellText(doc, "-", marginX + 8 * scale, y + rowH2 / 2 + 3 * scale, 0, { size: 8.5 * scale });
            y += rowH2;
            return;
          }
          lista.forEach((m) => {
            ensureSpace(rowH2);
            doc.rect(marginX, y, contentW, rowH2);
            verticalLines(y, rowH2);
            drawInfraCellText(doc, String(m.nombre || "-"), marginX + 8 * scale, y + rowH2 / 2 + 3 * scale, 0, { size: 8.5 * scale });
            drawInfraCellText(doc, String(m.unidad || "-"), marginX + colMaterialW + 8 * scale, y + rowH2 / 2 + 3 * scale, 0, { size: 8.5 * scale });
            drawInfraCellText(doc, String(m.cantidad || "-"), marginX + colMaterialW + colUnidadW + 8 * scale, y + rowH2 / 2 + 3 * scale, 0, { size: 8.5 * scale });
            y += rowH2;
          });
        }

        sectionBar("MANO DE OBRA");
        textBox(Array.isArray(visita.requisitos) ? visita.requisitos.filter((f) => String(f || "").trim()).join("\n") : visita.requisitos, 130);

        sectionBar("MATERIALES");
        materialesTable(visita.materiales);

        sectionBar("DIAGRAMAS / FOTOS");
        await fotosBox(fotosParaPdf);

        sectionBar("OBSERVACIONES");
        textBox(visita.observaciones, 60);

        const totalPages = doc.internal.getNumberOfPages();
        for (let p = 1; p <= totalPages; p++) {
          doc.setPage(p);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7.5 * scale);
          doc.setTextColor(120, 120, 120);
          doc.text(`Página ${p} de ${totalPages}`, pageW - marginX, pageNumY, { align: "right" });
        }

        lastDoc = doc;
        break scaleLoop;
      } catch (e) {
        if (e instanceof RetrySmallerScale) continue;
        throw e;
      }
    }
  }

  if (!lastDoc) {
    throw new Error("No se pudo generar el PDF del informe de visita técnica.");
  }

  // Mismo detalle que Informe Técnico: código + el campo descriptivo principal (aquí
  // "Nombre del proyecto", que es el equivalente de "objetivo del servicio" en esta página),
  // para que el archivo descargado ya diga de qué trata sin tener que abrirlo.
  const nombreBase = `${visita.codigo || "IV"}_${visita.nombreProyecto || ""}`.trim();
  const nombreArchivo = `${nombreBase.replace(/[^\w-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "")}.pdf`;
  if (download) lastDoc.save(nombreArchivo);
  return { doc: lastDoc, fileName: nombreArchivo };
}

const NAV_ORDER_STORAGE_KEY = "wilarcon_nav_order";

const SESSION_STORAGE_KEY = "torre_ops_session";




function AccesosPersonal({ isAdmin = false, canDelete = true, readOnly = false, onOpenCreateUser }) {
  const [trabajadores, setTrabajadores] = useState([]);
  const [ubicacionSedes, setUbicacionSedes] = useState(ASISTENCIA_SEED_UBICACIONES);
  const [sueldos, setSueldos] = useState({});

  const [showTrabajadores, setShowTrabajadores] = useState(false);
  const [newTrabajador, setNewTrabajador] = useState("");
  const [confirmDeleteTrabajador, setConfirmDeleteTrabajador] = useState(null);
  const [editTrabajadorValue, setEditTrabajadorValue] = useState("");
  const [renamingTrabajador, setRenamingTrabajador] = useState(false);

  const [showUbicaciones, setShowUbicaciones] = useState(false);
  const [newSede, setNewSede] = useState("");
  const [newCampusBySede, setNewCampusBySede] = useState({});
  const [confirmDeleteSede, setConfirmDeleteSede] = useState(null);
  const [confirmDeleteCampus, setConfirmDeleteCampus] = useState(null);

  const [sueldoDraftByTrabajador, setSueldoDraftByTrabajador] = useState({});
  const [montosPlanilla, setMontosPlanilla] = useState({});
  const [planillaDraftByTrabajador, setPlanillaDraftByTrabajador] = useState({});
  const [descuentosBonos, setDescuentosBonos] = useState({});
  const [descuentoBonoDraftByTrabajador, setDescuentoBonoDraftByTrabajador] = useState({});

  // Pestaña de edición por trabajador (nombre, sueldo, planilla, descuentos/bonos y accesos)
  const [workerEditing, setWorkerEditing] = useState(null);
  const [torreUsers, setTorreUsers] = useState(null);
  const [loadingTorreUsers, setLoadingTorreUsers] = useState(false);
  const [accesoError, setAccesoError] = useState("");
  const [accesoPermMatrix, setAccesoPermMatrix] = useState({});
  const [accesoActive, setAccesoActive] = useState(true);
  const [accesoEmail, setAccesoEmail] = useState("");
  const [accesoResetPassword, setAccesoResetPassword] = useState("");
  const [savingAcceso, setSavingAcceso] = useState(false);
  const [newAccesoUsername, setNewAccesoUsername] = useState("");
  const [newAccesoPassword, setNewAccesoPassword] = useState("");
  const [newAccesoEmail, setNewAccesoEmail] = useState("");
  const [newAccesoRole, setNewAccesoRole] = useState("member");
  const [newAccesoPermMatrix, setNewAccesoPermMatrix] = useState(makeFullPermissionMatrix());

  useEffect(() => {
    (async () => {
      try {
        const res2 = await window.storage.get(STORAGE_KEY_ASISTENCIA_TRABAJADORES, true);
        const data2 = JSON.parse(res2.value);
        setTrabajadores(canonicalizePeople(Array.isArray(data2) && data2.length ? data2 : ASISTENCIA_SEED_TRABAJADORES));
      } catch (e) {
        setTrabajadores(canonicalizePeople(ASISTENCIA_SEED_TRABAJADORES));
      }
      try {
        const res3 = await window.storage.get(STORAGE_KEY_ASISTENCIA_UBICACIONES, true);
        const data3 = JSON.parse(res3.value);
        setUbicacionSedes(data3 && typeof data3 === "object" && Object.keys(data3).length ? data3 : ASISTENCIA_SEED_UBICACIONES);
      } catch (e) {
        setUbicacionSedes(ASISTENCIA_SEED_UBICACIONES);
      }
      try {
        const res4 = await window.storage.get(STORAGE_KEY_ASISTENCIA_SUELDOS, true);
        const data4 = JSON.parse(res4.value);
        setSueldos(data4 && typeof data4 === "object" && Object.keys(data4).length ? data4 : ASISTENCIA_SEED_SUELDOS);
      } catch (e) {
        setSueldos(ASISTENCIA_SEED_SUELDOS);
      }
      try {
        const res5 = await window.storage.get(STORAGE_KEY_ASISTENCIA_PLANILLA_FIJA, true);
        const data5 = JSON.parse(res5.value);
        setMontosPlanilla(data5 && typeof data5 === "object" ? data5 : {});
      } catch (e) {
        setMontosPlanilla({});
      }
      try {
        const res6 = await window.storage.get(STORAGE_KEY_ASISTENCIA_DESCUENTOS_BONOS, true);
        const data6 = JSON.parse(res6.value);
        setDescuentosBonos(data6 && typeof data6 === "object" ? data6 : {});
      } catch (e) {
        setDescuentosBonos({});
      }
    })();
  }, []);

  useEffect(() => {
    if (!isAdmin || readOnly) return;
    persistTrabajadores((current) => {
      const list = Array.isArray(current) ? current : [];
      const normalized = canonicalizePeople(list.map((t) => String(t || "").toUpperCase()));
      return JSON.stringify(normalized) !== JSON.stringify(list) ? normalized : undefined;
    });
  }, [isAdmin, readOnly]);

  // Limpia registros huérfanos de sueldo/planilla: trabajadores que ya no están en la
  // lista de Trabajadores (fueron eliminados antes de que existiera la limpieza automática
  // en removeTrabajador) pero cuyo sueldo/monto de planilla/descuento-bono seguía guardado
  // en su propia clave de storage, y por eso seguían apareciendo en la "Planilla estimada".
  useEffect(() => {
    if (!isAdmin || readOnly || !trabajadores.length) return;
    const validKeys = new Set(trabajadores.map((t) => normalizePersonKey(t)));
    const limpiarHuerfanos = (obj) => {
      const entries = Object.entries(obj || {});
      const filtradas = entries.filter(([nombre]) => validKeys.has(normalizePersonKey(nombre)));
      return filtradas.length === entries.length ? undefined : Object.fromEntries(filtradas);
    };
    persistSueldos(limpiarHuerfanos);
    persistMontosPlanilla(limpiarHuerfanos);
    persistDescuentosBonos(limpiarHuerfanos);
  }, [isAdmin, readOnly, trabajadores]);

  async function persistTrabajadores(next, intent) {
    try {
      const applied = await mutateStorageJSON(STORAGE_KEY_ASISTENCIA_TRABAJADORES, [], (current) => next(Array.isArray(current) ? current : []), 4, intent);
      setTrabajadores(applied);
      return applied;
    } catch (e) {
      console.error("persist trabajadores error", e);
      alert("No se pudo guardar el cambio: otro usuario modificó la lista de trabajadores al mismo tiempo y los reintentos automáticos no lograron aplicarlo. Recarga la página e inténtalo de nuevo.");
    }
  }

  function addTrabajador() {
    if (readOnly) return;
    const name = newTrabajador.trim();
    if (!name) return;
    if (trabajadores.some((t) => normalizePersonKey(t) === normalizePersonKey(name))) { setNewTrabajador(""); return; }
    persistTrabajadores((current) => current.some((t) => normalizePersonKey(t) === normalizePersonKey(name)) ? current : [...current, name].sort((a, b) => a.localeCompare(b)), "crear");
    setNewTrabajador("");
  }

  async function removeTrabajador(name) {
    if (!canDelete) return;
    await persistTrabajadores((current) => current.filter((t) => t !== name), "eliminar");
    setConfirmDeleteTrabajador(null);
    // Limpia también sus registros de sueldo/planilla, que se guardan en claves aparte
    // (por nombre) y no se borran solos al quitar al trabajador de esta lista — si no,
    // seguían apareciendo en el KPI "Planilla estimada" del Inicio con datos huérfanos.
    quitarSueldo(name);
    quitarMontoPlanilla(name);
    quitarDescuentoBono(name);
  }

  function cancelEditTrabajador() {
    setEditTrabajadorValue("");
  }

  function usernameFromWorker(worker) {
    return String(worker || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
  }

  // Une un trabajador con su cuenta de acceso (usuario de Gestión de usuarios). Normalmente
  // es por el campo "trabajador" del usuario, pero la cuenta Admin (ver DEFAULT_USERS en
  // api/auth.js) no tiene ese campo seteado, así que para el trabajador "ADMIN" se cae al
  // usuario con role "admin" — esto es lo que permite restablecer su contraseña desde aquí.
  function findAccesoLinkedTo(users, workerName) {
    if (!Array.isArray(users)) return undefined;
    const key = normalizePersonKey(workerName);
    return users.find((u) => u && (
      (u.trabajador && normalizePersonKey(u.trabajador) === key) ||
      (key === "admin" && u.role === "admin")
    ));
  }

  const linkedAcceso = workerEditing && Array.isArray(torreUsers)
    ? findAccesoLinkedTo(torreUsers, workerEditing)
    : undefined;

  async function loadTorreUsersForEdit() {
    setLoadingTorreUsers(true);
    try {
      const data = await storageJSON("torre_ops_data", { tasks: [], history: [], users: [] });
      setTorreUsers(Array.isArray(data.users) ? data.users : []);
    } catch (e) {
      console.error("no se pudo cargar accesos", e);
      setTorreUsers([]);
    } finally {
      setLoadingTorreUsers(false);
    }
  }

  function openWorkerEdit(name) {
    if (!isAdmin || readOnly) return;
    setWorkerEditing(name);
    setEditTrabajadorValue(name);
    setAccesoError("");
    setAccesoResetPassword("");
    setTorreUsers(null);
    setNewAccesoUsername(usernameFromWorker(name));
    setNewAccesoPassword("");
    setNewAccesoEmail("");
    setNewAccesoRole("member");
    setNewAccesoPermMatrix(makeFullPermissionMatrix());
    loadTorreUsersForEdit();
  }

  function closeWorkerEdit() {
    setWorkerEditing(null);
    cancelEditTrabajador();
    setAccesoError("");
    setAccesoResetPassword("");
  }

  useEffect(() => {
    if (!workerEditing || !Array.isArray(torreUsers)) return;
    const linked = findAccesoLinkedTo(torreUsers, workerEditing);
    if (linked) {
      setAccesoPermMatrix(normalizePermissionMatrix(linked));
      setAccesoActive(linked.activo !== false);
      setAccesoEmail(linked.email || "");
    }
  }, [workerEditing, torreUsers]);

  function toggleAccesoPermission(pageKey, actionKey, isNew) {
    const setter = isNew ? setNewAccesoPermMatrix : setAccesoPermMatrix;
    setter((prev) => ({ ...prev, [pageKey]: { ...(prev[pageKey] || DEFAULT_MODULE_PERMISSIONS[pageKey]), [actionKey]: !prev[pageKey]?.[actionKey] } }));
  }

  async function guardarAccesos() {
    if (!isAdmin || !workerEditing) return;
    if (accesoEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accesoEmail.trim())) { setAccesoError("El correo electrónico no es válido"); return; }
    setSavingAcceso(true);
    setAccesoError("");
    try {
      const next = await mutateStorageJSON(
        "torre_ops_data",
        { tasks: [], history: [], users: [] },
        (current) => {
          const data = current && typeof current === "object" ? current : { tasks: [], history: [], users: [] };
          const users = Array.isArray(data.users) ? data.users : [];
          const target = users.find((u) => u && u.trabajador && normalizePersonKey(u.trabajador) === normalizePersonKey(workerEditing));
          if (!target || target.role === "admin") return undefined;
          const nextUsers = users.map((u) => u === target ? {
            ...u,
            activo: accesoActive,
            email: accesoEmail.trim(),
            paginas: Object.entries(accesoPermMatrix).filter(([, m]) => m.ver).map(([k]) => k),
            permisosPorPagina: accesoPermMatrix,
          } : u);
          return { ...data, users: nextUsers };
        },
        4,
        "editar"
      );
      if (next) setTorreUsers(next.users || []);
    } catch (e) {
      console.error("guardar accesos error", e);
      setAccesoError("No se pudo guardar los accesos: otro usuario modificó los accesos al mismo tiempo. Intenta de nuevo.");
    } finally {
      setSavingAcceso(false);
    }
  }

  async function restablecerPasswordAcceso() {
    if (!isAdmin || !workerEditing) return;
    if (!accesoResetPassword) { setAccesoError("Ingresa una nueva contraseña"); return; }
    setSavingAcceso(true);
    setAccesoError("");
    try {
      const next = await mutateStorageJSON(
        "torre_ops_data",
        { tasks: [], history: [], users: [] },
        (current) => {
          const data = current && typeof current === "object" ? current : { tasks: [], history: [], users: [] };
          const users = Array.isArray(data.users) ? data.users : [];
          const target = findAccesoLinkedTo(users, workerEditing);
          if (!target) return undefined;
          const nextUsers = users.map((u) => u === target ? { ...u, password: accesoResetPassword } : u);
          return { ...data, users: nextUsers };
        },
        4,
        "editar"
      );
      if (next) setTorreUsers(next.users || []);
      setAccesoResetPassword("");
    } catch (e) {
      console.error("reset password acceso error", e);
      setAccesoError("No se pudo restablecer la contraseña. Intenta de nuevo.");
    } finally {
      setSavingAcceso(false);
    }
  }

  async function crearAcceso() {
    if (!isAdmin || !workerEditing) return;
    const username = newAccesoUsername.trim();
    if (!username || !newAccesoPassword) { setAccesoError("Completa usuario y contraseña"); return; }
    if (newAccesoEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newAccesoEmail.trim())) { setAccesoError("El correo electrónico no es válido"); return; }
    if (newAccesoRole === "member" && !Object.values(newAccesoPermMatrix).some((m) => m.ver)) { setAccesoError("Activa al menos un módulo con permiso Ver"); return; }
    setSavingAcceso(true);
    setAccesoError("");
    try {
      const next = await mutateStorageJSON(
        "torre_ops_data",
        { tasks: [], history: [], users: [] },
        (current) => {
          const data = current && typeof current === "object" ? current : { tasks: [], history: [], users: [] };
          const users = Array.isArray(data.users) ? data.users : [];
          if (users.some((u) => String(u.name || "").toLowerCase() === username.toLowerCase())) {
            const err = new Error("EXISTS"); throw err;
          }
          if (users.some((u) => u.trabajador && normalizePersonKey(u.trabajador) === normalizePersonKey(workerEditing))) {
            const err = new Error("LINKED"); throw err;
          }
          const nuevo = {
            name: username,
            password: newAccesoPassword,
            email: newAccesoEmail.trim(),
            role: newAccesoRole,
            trabajador: workerEditing,
            trabajadorId: `worker:${normalizePersonKey(workerEditing)}`,
            ...(newAccesoRole === "member" ? { paginas: Object.entries(newAccesoPermMatrix).filter(([, m]) => m.ver).map(([k]) => k), permisosPorPagina: newAccesoPermMatrix } : {}),
            activo: true,
            createdAt: Date.now(),
          };
          return { ...data, users: [...users, nuevo] };
        },
        4,
        "crear"
      );
      if (next) { setTorreUsers(next.users || []); setNewAccesoPassword(""); setNewAccesoEmail(""); }
    } catch (e) {
      if (e && e.message === "EXISTS") setAccesoError("Ya existe un usuario con ese nombre");
      else if (e && e.message === "LINKED") setAccesoError("Ese trabajador ya tiene un usuario vinculado");
      else { console.error("crear acceso error", e); setAccesoError("No se pudo crear el acceso. Intenta de nuevo."); }
    } finally {
      setSavingAcceso(false);
    }
  }

  // Renombra un trabajador en la lista de Trabajadores y propaga el cambio a los demás
  // lugares donde ese nombre queda guardado como texto libre o como llave, para que no se
  // rompan vínculos ni queden registros "huérfanos" con el nombre viejo:
  // - el usuario de acceso vinculado (Torre de Control -> Gestión de usuarios)
  // - las tareas de Torre de Control (campo "responsable")
  // - los registros de Asistencia (campo "trabajador")
  // - los registros de Viáticos (campo "trabajador")
  // - los registros de Trabajos (campo "responsable" y la lista "Personal asignado")
  // - sus propias llaves de sueldo base, monto de planilla y descuentos/bonos
  // No se tocan Gastos ni Caja Chica (esos módulos no guardan un nombre de trabajador por
  // registro). Cada parte se intenta de forma independiente: si alguna falla, las demás
  // igual se aplican y al final se avisa cuáles quedaron pendientes de ajustar a mano.
  async function renameTrabajador(oldName) {
    if (!isAdmin || readOnly) return;
    const newName = editTrabajadorValue.trim().toUpperCase();
    if (!newName) { alert("Escribe un nombre."); return; }
    if (newName === oldName) { cancelEditTrabajador(); return; }
    if (trabajadores.some((t) => t !== oldName && normalizePersonKey(t) === normalizePersonKey(newName))) {
      alert("Ya existe un trabajador con ese nombre.");
      return;
    }
    setRenamingTrabajador(true);
    const fallos = [];
    try {
      await persistTrabajadores(
        (current) => current.map((t) => (t === oldName ? newName : t)).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" })),
        "editar"
      );

      try {
        await mutateStorageJSON(
          "torre_ops_data",
          { tasks: [], history: [], users: [] },
          (current) => {
            const data = current && typeof current === "object" ? current : { tasks: [], history: [], users: [] };
            const users = Array.isArray(data.users) ? data.users : [];
            const tasks = Array.isArray(data.tasks) ? data.tasks : [];
            let changed = false;
            const nextUsers = users.map((u) => {
              if (u && u.trabajador && normalizePersonKey(u.trabajador) === normalizePersonKey(oldName)) {
                changed = true;
                // El usuario de acceso (nombre de login) sigue automáticamente al nuevo nombre
                // del trabajador, salvo que ese nombre de usuario ya esté tomado por otra
                // cuenta — en ese caso se deja el usuario como estaba, solo se actualiza el
                // vínculo "trabajador".
                const nuevoUsuario = usernameFromWorker(newName);
                const usuarioOcupado = nuevoUsuario && nuevoUsuario !== u.name &&
                  users.some((o) => o !== u && o.name && o.name.toLowerCase() === nuevoUsuario.toLowerCase());
                return {
                  ...u,
                  trabajador: newName,
                  trabajadorId: `worker:${normalizePersonKey(newName)}`,
                  ...(nuevoUsuario && !usuarioOcupado ? { name: nuevoUsuario } : {}),
                };
              }
              return u;
            });
            const nextTasks = tasks.map((t) => {
              if (t && t.responsable && normalizePersonKey(t.responsable) === normalizePersonKey(oldName)) {
                changed = true;
                return { ...t, responsable: newName };
              }
              return t;
            });
            if (!changed) return undefined;
            return { ...data, users: nextUsers, tasks: nextTasks };
          },
          4,
          "editar"
        );
      } catch (e) {
        console.error("no se pudo actualizar el usuario/tareas de Torre tras renombrar", e);
        fallos.push("la cuenta de usuario vinculada y/o las tareas de Torre de Control");
      }

      try {
        await mutateStorageJSON(
          STORAGE_KEY_ASISTENCIA_REGISTROS,
          [],
          (current) => {
            const list = Array.isArray(current) ? current : [];
            let changed = false;
            const next = list.map((r) => {
              if (r && r.trabajador && normalizePersonKey(r.trabajador) === normalizePersonKey(oldName)) {
                changed = true;
                return { ...r, trabajador: newName };
              }
              return r;
            });
            return changed ? next : undefined;
          },
          4,
          "editar"
        );
      } catch (e) {
        console.error("no se pudo actualizar Asistencia tras renombrar", e);
        fallos.push("los registros de Asistencia");
      }

      try {
        await mutateStorageJSON(
          STORAGE_KEY_VIATICOS,
          [],
          (current) => {
            const list = Array.isArray(current) ? current : [];
            let changed = false;
            const next = list.map((v) => {
              if (v && v.trabajador && normalizePersonKey(v.trabajador) === normalizePersonKey(oldName)) {
                changed = true;
                return { ...v, trabajador: newName };
              }
              return v;
            });
            return changed ? next : undefined;
          },
          4,
          "editar"
        );
      } catch (e) {
        console.error("no se pudo actualizar Viáticos tras renombrar", e);
        fallos.push("los registros de Viáticos");
      }

      try {
        await mutateStorageJSON(
          STORAGE_KEY_RECORDS,
          [],
          (current) => {
            const list = Array.isArray(current) ? current : [];
            let changed = false;
            const next = list.map((r) => {
              if (!r) return r;
              let siguiente = r;
              if (r.responsable && normalizePersonKey(r.responsable) === normalizePersonKey(oldName)) {
                changed = true;
                siguiente = { ...siguiente, responsable: newName };
              }
              const personalNuevo = reemplazarNombreEnListaDelimitada(r.personalAsignado, oldName, newName);
              if (personalNuevo !== r.personalAsignado) {
                changed = true;
                siguiente = { ...siguiente, personalAsignado: personalNuevo };
              }
              return siguiente;
            });
            return changed ? next : undefined;
          },
          4,
          "editar"
        );
      } catch (e) {
        console.error("no se pudo actualizar Trabajos tras renombrar", e);
        fallos.push("los registros de Trabajos");
      }

      try {
        await renombrarClaveEnMapa(STORAGE_KEY_ASISTENCIA_SUELDOS, oldName, newName);
        await renombrarClaveEnMapa(STORAGE_KEY_ASISTENCIA_PLANILLA_FIJA, oldName, newName);
        await renombrarClaveEnMapa(STORAGE_KEY_ASISTENCIA_DESCUENTOS_BONOS, oldName, newName);
        setSueldos((p) => (Object.prototype.hasOwnProperty.call(p, oldName) ? (() => { const n = { ...p }; n[newName] = n[oldName]; delete n[oldName]; return n; })() : p));
        setMontosPlanilla((p) => (Object.prototype.hasOwnProperty.call(p, oldName) ? (() => { const n = { ...p }; n[newName] = n[oldName]; delete n[oldName]; return n; })() : p));
        setDescuentosBonos((p) => (Object.prototype.hasOwnProperty.call(p, oldName) ? (() => { const n = { ...p }; n[newName] = n[oldName]; delete n[oldName]; return n; })() : p));
      } catch (e) {
        console.error("no se pudo actualizar sueldo/planilla/descuentos tras renombrar", e);
        fallos.push("su sueldo base, monto de planilla y/o descuentos-bonos");
      }

      if (fallos.length) {
        alert(`Se renombró a "${newName}", pero no se pudo actualizar automáticamente: ${fallos.join("; ")}. Revísalo a mano si hace falta.`);
      }
      if (workerEditing === oldName) { setWorkerEditing(newName); setEditTrabajadorValue(newName); setTorreUsers(null); loadTorreUsersForEdit(); }
      else cancelEditTrabajador();
    } finally {
      setRenamingTrabajador(false);
    }
  }

  async function persistUbicacionSedes(next) {
    try {
      const applied = await mutateStorageJSON(STORAGE_KEY_ASISTENCIA_UBICACIONES, {}, (current) => next(current && typeof current === "object" ? current : {}));
      setUbicacionSedes(applied);
      return applied;
    } catch (e) {
      console.error("persist ubicaciones error", e);
      alert("No se pudo guardar el cambio: otro usuario modificó las ubicaciones al mismo tiempo y los reintentos automáticos no lograron aplicarlo. Recarga la página e inténtalo de nuevo.");
    }
  }

  async function persistSueldos(next) {
    try {
      const applied = await mutateStorageJSON(STORAGE_KEY_ASISTENCIA_SUELDOS, {}, (current) => next(current && typeof current === "object" ? current : {}));
      setSueldos(applied);
      return applied;
    } catch (e) {
      console.error("persist sueldos error", e);
      alert("No se pudo guardar el cambio: otro usuario modificó los sueldos al mismo tiempo y los reintentos automáticos no lograron aplicarlo. Recarga la página e inténtalo de nuevo.");
    }
  }

  function guardarSueldo(nombre) {
    if (!isAdmin) return;
    const raw = sueldoDraftByTrabajador[nombre];
    const monto = Number(raw);
    if (raw === undefined || raw === "" || Number.isNaN(monto) || monto < 0) return;
    persistSueldos((current) => ({ ...current, [nombre]: monto }));
    setSueldoDraftByTrabajador((p) => { const n = { ...p }; delete n[nombre]; return n; });
  }

  function quitarSueldo(nombre) {
    if (!isAdmin) return;
    persistSueldos((current) => { const next = { ...current }; delete next[nombre]; return next; });
  }

  async function persistMontosPlanilla(next) {
    try {
      const applied = await mutateStorageJSON(STORAGE_KEY_ASISTENCIA_PLANILLA_FIJA, {}, (current) => next(current && typeof current === "object" ? current : {}));
      setMontosPlanilla(applied);
      return applied;
    } catch (e) {
      console.error("persist montos planilla error", e);
      alert("No se pudo guardar el cambio: otro usuario modificó los montos de planilla al mismo tiempo y los reintentos automáticos no lograron aplicarlo. Recarga la página e inténtalo de nuevo.");
    }
  }

  function guardarMontoPlanilla(nombre) {
    if (!isAdmin) return;
    const raw = planillaDraftByTrabajador[nombre];
    const monto = Number(raw);
    if (raw === undefined || raw === "" || Number.isNaN(monto)) return;
    persistMontosPlanilla((current) => ({ ...current, [nombre]: monto }));
    setPlanillaDraftByTrabajador((p) => { const n = { ...p }; delete n[nombre]; return n; });
  }

  function quitarMontoPlanilla(nombre) {
    if (!isAdmin) return;
    persistMontosPlanilla((current) => { const next = { ...current }; delete next[nombre]; return next; });
  }

  async function persistDescuentosBonos(next) {
    try {
      const applied = await mutateStorageJSON(STORAGE_KEY_ASISTENCIA_DESCUENTOS_BONOS, {}, (current) => next(current && typeof current === "object" ? current : {}));
      setDescuentosBonos(applied);
      return applied;
    } catch (e) {
      console.error("persist descuentos/bonos error", e);
      alert("No se pudo guardar el cambio: otro usuario modificó los descuentos/bonos al mismo tiempo y los reintentos automáticos no lograron aplicarlo. Recarga la página e inténtalo de nuevo.");
    }
  }

  function guardarDescuentoBono(nombre) {
    if (!isAdmin) return;
    const raw = descuentoBonoDraftByTrabajador[nombre];
    const monto = Number(raw);
    if (raw === undefined || raw === "" || Number.isNaN(monto)) return;
    persistDescuentosBonos((current) => ({ ...current, [nombre]: monto }));
    setDescuentoBonoDraftByTrabajador((p) => { const n = { ...p }; delete n[nombre]; return n; });
  }

  function quitarDescuentoBono(nombre) {
    if (!isAdmin) return;
    persistDescuentosBonos((current) => { const next = { ...current }; delete next[nombre]; return next; });
  }

  function addSede() {
    if (readOnly) return;
    const name = newSede.trim().toUpperCase();
    if (!name) return;
    if (ubicacionSedes[name]) { setNewSede(""); return; }
    persistUbicacionSedes((current) => current[name] ? current : { ...current, [name]: [] });
    setNewSede("");
  }

  function removeSede(sede) {
    if (!canDelete) return;
    persistUbicacionSedes((current) => { const next = { ...current }; delete next[sede]; return next; });
    setConfirmDeleteSede(null);
  }

  function addCampus(sede) {
    if (readOnly) return;
    const name = (newCampusBySede[sede] || "").trim().toUpperCase();
    if (!name) return;
    persistUbicacionSedes((current) => (current[sede] || []).includes(name) ? current : { ...current, [sede]: [...(current[sede] || []), name] });
    setNewCampusBySede((p) => ({ ...p, [sede]: "" }));
  }

  function removeCampus(sede, campus) {
    if (!canDelete) return;
    persistUbicacionSedes((current) => ({ ...current, [sede]: (current[sede] || []).filter((c) => c !== campus) }));
    setConfirmDeleteCampus(null);
  }

  return (
    <>
      <style>{`
        .ap-input { width: 100%; background: ${COLORS.panel2}; border: 1px solid ${COLORS.border}; color: ${COLORS.text}; font-family: 'Inter',sans-serif; font-size: 12.5px; padding: 7px 9px; border-radius: 6px; outline: none; box-sizing: border-box; }
        .ap-input:focus { border-color: ${COLORS.amber}; }
        .ap-scroll::-webkit-scrollbar { height: 8px; width: 8px; }
        .ap-scroll::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 4px; }
      `}</style>
      {!readOnly && (
        <button className="wc-btn" onClick={() => setShowTrabajadores(true)} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          👤 Trabajadores ({trabajadores.length})
        </button>
      )}
      {!readOnly && (
        <button className="wc-btn" onClick={() => setShowUbicaciones(true)} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          📍 Ubicaciones ({Object.keys(ubicacionSedes).length})
        </button>
      )}
      {showTrabajadores && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }} onClick={() => setShowTrabajadores(false)}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 22, width: isAdmin ? 460 : 400, maxWidth: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column", boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: 14 }}>Trabajadores</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                {isAdmin && !readOnly && onOpenCreateUser && (
                  <button onClick={() => { setShowTrabajadores(false); onOpenCreateUser(); }} style={{ background: COLORS.amber, color: COLORS.amberText, border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>＋ Crear usuario</button>
                )}
                <button onClick={() => setShowTrabajadores(false)} style={{ background: "transparent", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 16 }}>✕</button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <input
                className="ap-input"
                value={newTrabajador}
                onChange={(e) => setNewTrabajador(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === "Enter") addTrabajador(); }}
                placeholder="Nombre del trabajador"
              />
              <button onClick={addTrabajador} disabled={!newTrabajador.trim()} style={{ background: newTrabajador.trim() ? COLORS.amber : COLORS.panel2, color: newTrabajador.trim() ? COLORS.amberText : COLORS.faint, border: "none", borderRadius: 7, padding: "0 16px", fontWeight: 600, fontSize: 13, cursor: newTrabajador.trim() ? "pointer" : "default", flexShrink: 0 }}>
                + Agregar
              </button>
            </div>
            <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }} className="ap-scroll">
              {trabajadores.length === 0 && <div style={{ color: COLORS.faint, fontSize: 12.5, textAlign: "center", padding: "20px 0" }}>Todavia no hay trabajadores registrados</div>}
              {trabajadores.map((t) => {
                return (
                <div key={t} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: COLORS.panel2, borderRadius: 8, padding: "8px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <div style={{ width: 20, height: 20, borderRadius: 50, background: colorForContacto(t, trabajadores), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#12161c", flexShrink: 0 }}>{initials(t)}</div>
                    <span style={{ fontSize: 12.5 }}>{t}</span>
                  </div>
                  {confirmDeleteTrabajador === t ? (
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button onClick={() => removeTrabajador(t)} style={{ background: COLORS.red, color: "#fff", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 11, cursor: "pointer" }}>Confirmar</button>
                      <button onClick={() => setConfirmDeleteTrabajador(null)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, borderRadius: 6, padding: "4px 8px", fontSize: 11, cursor: "pointer" }}>Cancelar</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      {isAdmin && !readOnly && (
                        <button onClick={() => openWorkerEdit(t)} style={{ display: "flex", alignItems: "center", gap: 5, background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.dim, borderRadius: 14, padding: "5px 11px", fontSize: 11, cursor: "pointer" }} title="Editar">✎ Editar</button>
                      )}
                      {canDelete && (
                        <button onClick={() => setConfirmDeleteTrabajador(t)} style={{ background: "transparent", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 13 }} title="Eliminar">🗑</button>
                      )}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
            {isAdmin && (
              <div style={{ color: COLORS.faint, fontSize: 10.5, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${COLORS.border}` }}>
                El sueldo base se usa para calcular el sueldo neto y las horas extra en el KPI "Planilla estimada". El monto de planilla y los descuentos/bonos son montos fijos adicionales que se suman cada mes al sueldo neto (usa un valor positivo para un bono, negativo para un descuento). Solo se muestran en la planilla los trabajadores con sueldo base configurado.
              </div>
            )}
          </div>
        </div>
      )}

      {workerEditing && (() => {
        const t = workerEditing;
        const sueldoActual = sueldos[t];
        const sueldoDraft = sueldoDraftByTrabajador[t];
        const sueldoInput = sueldoDraft !== undefined ? sueldoDraft : (sueldoActual !== undefined && sueldoActual !== null ? String(sueldoActual) : "");
        const planillaActual = montosPlanilla[t];
        const planillaDraft = planillaDraftByTrabajador[t];
        const planillaInput = planillaDraft !== undefined ? planillaDraft : (planillaActual !== undefined && planillaActual !== null ? String(planillaActual) : "");
        const descuentoBonoActual = descuentosBonos[t];
        const descuentoBonoDraft = descuentoBonoDraftByTrabajador[t];
        const descuentoBonoInput = descuentoBonoDraft !== undefined ? descuentoBonoDraft : (descuentoBonoActual !== undefined && descuentoBonoActual !== null ? String(descuentoBonoActual) : "");
        return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110, padding: 16 }} onClick={closeWorkerEdit}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 22, width: 560, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexShrink: 0 }}>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: 14 }}>Editar trabajador</div>
              <button onClick={closeWorkerEdit} style={{ background: "transparent", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }} className="ap-scroll">
              {/* Nombre */}
              <div>
                <div style={{ fontSize: 10.5, color: COLORS.faint, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4 }}>Nombre</div>
                {(() => {
                  const nombreEditDuplicado = !!editTrabajadorValue.trim() && trabajadores.some((tr) => tr !== t && normalizePersonKey(tr) === normalizePersonKey(editTrabajadorValue));
                  const nombreEditCambio = editTrabajadorValue.trim().toUpperCase() !== t;
                  return (
                  <>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      className="ap-input"
                      style={{ flex: 1 }}
                      value={editTrabajadorValue}
                      onChange={(e) => setEditTrabajadorValue(e.target.value.toUpperCase())}
                      onKeyDown={(e) => { if (e.key === "Enter" && !nombreEditDuplicado) renameTrabajador(t); }}
                    />
                    {nombreEditCambio && (
                      <button onClick={() => renameTrabajador(t)} disabled={renamingTrabajador || nombreEditDuplicado} title={nombreEditDuplicado ? "Ya existe un trabajador con ese nombre" : undefined} style={{ background: (renamingTrabajador || nombreEditDuplicado) ? COLORS.panel2 : COLORS.amber, color: (renamingTrabajador || nombreEditDuplicado) ? COLORS.faint : COLORS.amberText, border: "none", borderRadius: 6, padding: "0 14px", fontSize: 12, fontWeight: 600, cursor: (renamingTrabajador || nombreEditDuplicado) ? "default" : "pointer", opacity: renamingTrabajador ? 0.6 : 1, flexShrink: 0 }}>Guardar</button>
                    )}
                  </div>
                  {nombreEditDuplicado && (
                    <div style={{ color: COLORS.red, fontSize: 11, marginTop: 6 }}>Ya existe un trabajador con ese nombre.</div>
                  )}
                  </>
                  );
                })()}
              </div>

              {/* Sueldo / Planilla / Descuentos-Bonos */}
              <div>
                <div style={{ fontSize: 10.5, color: COLORS.faint, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>Sueldo y planilla</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                    <span style={{ fontSize: 11.5, color: COLORS.dim, flexShrink: 0 }}>Sueldo base</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, color: COLORS.faint }}>S/</span>
                      <input className="ap-input" type="number" min="0" step="0.01" style={{ width: 92, fontSize: 12 }} value={sueldoInput} onChange={(e) => setSueldoDraftByTrabajador((p) => ({ ...p, [t]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") guardarSueldo(t); }} placeholder="0.00" />
                      {sueldoDraft !== undefined && sueldoDraft !== String(sueldoActual ?? "") && (
                        <button onClick={() => guardarSueldo(t)} style={{ background: COLORS.amber, color: COLORS.amberText, border: "none", borderRadius: 6, padding: "4px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
                      )}
                      {sueldoActual !== undefined && sueldoActual !== null && sueldoDraft === undefined && (
                        <button onClick={() => quitarSueldo(t)} style={{ background: "transparent", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 13 }} title="Quitar de la planilla">🗑</button>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                    <span style={{ fontSize: 11.5, color: COLORS.dim, flexShrink: 0 }}>Monto planilla</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, color: COLORS.faint }}>S/</span>
                      <input className="ap-input" type="number" step="0.01" style={{ width: 92, fontSize: 12 }} value={planillaInput} onChange={(e) => setPlanillaDraftByTrabajador((p) => ({ ...p, [t]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") guardarMontoPlanilla(t); }} placeholder="0.00" />
                      {planillaDraft !== undefined && planillaDraft !== String(planillaActual ?? "") && (
                        <button onClick={() => guardarMontoPlanilla(t)} style={{ background: COLORS.amber, color: COLORS.amberText, border: "none", borderRadius: 6, padding: "4px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
                      )}
                      {planillaActual !== undefined && planillaActual !== null && planillaDraft === undefined && (
                        <button onClick={() => quitarMontoPlanilla(t)} style={{ background: "transparent", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 13 }} title="Quitar monto de planilla">🗑</button>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                    <span style={{ fontSize: 11.5, color: COLORS.dim, flexShrink: 0 }}>Descuentos/Bonos</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <span style={{ fontSize: 11, color: COLORS.faint }}>S/</span>
                      <input className="ap-input" type="number" step="0.01" style={{ width: 92, fontSize: 12 }} value={descuentoBonoInput} onChange={(e) => setDescuentoBonoDraftByTrabajador((p) => ({ ...p, [t]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") guardarDescuentoBono(t); }} placeholder="0.00" title="Positivo suma (bono), negativo resta (descuento)" />
                      {descuentoBonoDraft !== undefined && descuentoBonoDraft !== String(descuentoBonoActual ?? "") && (
                        <button onClick={() => guardarDescuentoBono(t)} style={{ background: COLORS.amber, color: COLORS.amberText, border: "none", borderRadius: 6, padding: "4px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
                      )}
                      {descuentoBonoActual !== undefined && descuentoBonoActual !== null && descuentoBonoDraft === undefined && (
                        <button onClick={() => quitarDescuentoBono(t)} style={{ background: "transparent", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 13 }} title="Quitar descuento/bono">🗑</button>
                      )}
                    </div>
                  </div>
                </div>
                <div style={{ color: COLORS.faint, fontSize: 10, marginTop: 8 }}>
                  El sueldo base se usa para calcular el sueldo neto y las horas extra en el KPI "Planilla estimada". El monto de planilla y los descuentos/bonos son montos fijos adicionales que se suman cada mes (usa un valor positivo para un bono, negativo para un descuento).
                </div>
              </div>

              {/* Accesos */}
              <div>
                <div style={{ fontSize: 10.5, color: COLORS.faint, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>Accesos</div>
                {loadingTorreUsers && <div style={{ color: COLORS.faint, fontSize: 12, textAlign: "center", padding: "12px 0" }}>Cargando accesos...</div>}
                {!loadingTorreUsers && accesoError && (
                  <div style={{ color: COLORS.red, fontSize: 11.5, marginBottom: 8 }}>{accesoError}</div>
                )}
                {!loadingTorreUsers && linkedAcceso && linkedAcceso.role === "admin" && (
                  <div style={{ background: COLORS.panel2, borderRadius: 8, padding: "10px 12px", fontSize: 12, color: COLORS.dim }}>
                    <div style={{ marginBottom: 6 }}>Usuario <strong style={{ color: COLORS.text }}>{linkedAcceso.name}</strong> — administrador con acceso total a todos los módulos.</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
                      <input className="ap-input" type="password" style={{ flex: 1, fontSize: 12 }} placeholder="Nueva contraseña" value={accesoResetPassword} onChange={(e) => setAccesoResetPassword(e.target.value)} />
                      <button onClick={restablecerPasswordAcceso} disabled={savingAcceso} style={{ background: COLORS.amber, color: COLORS.amberText, border: "none", borderRadius: 6, padding: "7px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>Restablecer</button>
                    </div>
                  </div>
                )}
                {!loadingTorreUsers && linkedAcceso && linkedAcceso.role !== "admin" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontSize: 12, color: COLORS.dim }}>Usuario: <strong style={{ color: COLORS.text }}>{linkedAcceso.name}</strong></div>
                      <label style={{ fontSize: 10.5, color: COLORS.text, display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                        <input type="checkbox" checked={accesoActive} onChange={(e) => setAccesoActive(e.target.checked)} style={{ accentColor: COLORS.amber, cursor: "pointer" }} /> Activo
                      </label>
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, color: COLORS.faint, marginBottom: 4 }}>Correo electrónico</div>
                      <input className="ap-input" type="email" style={{ width: "100%", boxSizing: "border-box" }} placeholder="Correo electrónico (opcional, para notificaciones)" value={accesoEmail} onChange={(e) => setAccesoEmail(e.target.value)} />
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => setAccesoPermMatrix(Object.fromEntries(Object.keys(DEFAULT_MODULE_PERMISSIONS).map((k) => [k, Object.fromEntries(PERMISSION_ACTIONS.map((a) => [a.key, true]))])))} style={{ background: COLORS.greenDim, color: COLORS.green, border: `1px solid ${COLORS.green}`, borderRadius: 5, padding: "5px 8px", fontSize: 9.5, cursor: "pointer" }}>Dar todos</button>
                      <button onClick={() => setAccesoPermMatrix(Object.fromEntries(Object.keys(DEFAULT_MODULE_PERMISSIONS).map((k) => [k, Object.fromEntries(PERMISSION_ACTIONS.map((a) => [a.key, false]))])))} style={{ background: "transparent", color: COLORS.faint, border: `1px solid ${COLORS.border}`, borderRadius: 5, padding: "5px 8px", fontSize: 9.5, cursor: "pointer" }}>Quitar todos</button>
                    </div>
                    <div style={{ overflowX: "auto" }} className="ap-scroll">
                      {NAV_ITEMS_DEFAULT.map((n) => {
                        const rowPerms = accesoPermMatrix[n.key] || DEFAULT_MODULE_PERMISSIONS[n.key];
                        return (
                          <div key={n.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: `1px solid ${COLORS.border}` }}>
                            <span style={{ fontSize: 11, width: 130, flexShrink: 0 }}>{n.label}</span>
                            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                              {PERMISSION_ACTIONS.map((a) => (
                                <label key={a.key} title={a.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", fontSize: 8.5, color: COLORS.faint, cursor: "pointer", gap: 2 }}>
                                  {a.short}
                                  <input type="checkbox" checked={!!rowPerms[a.key]} onChange={() => toggleAccesoPermission(n.key, a.key, false)} style={{ accentColor: COLORS.amber, cursor: "pointer" }} />
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <button onClick={guardarAccesos} disabled={savingAcceso} style={{ background: COLORS.amber, color: COLORS.amberText, border: "none", borderRadius: 6, padding: "7px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", alignSelf: "flex-start" }}>Guardar accesos</button>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, paddingTop: 8, borderTop: `1px solid ${COLORS.border}` }}>
                      <input className="ap-input" type="password" style={{ flex: 1, fontSize: 12 }} placeholder="Nueva contraseña" value={accesoResetPassword} onChange={(e) => setAccesoResetPassword(e.target.value)} />
                      <button onClick={restablecerPasswordAcceso} disabled={savingAcceso} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, borderRadius: 6, padding: "7px 12px", fontSize: 11.5, cursor: "pointer", flexShrink: 0 }}>Restablecer contraseña</button>
                    </div>
                  </div>
                )}
                {!loadingTorreUsers && !linkedAcceso && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ fontSize: 11.5, color: COLORS.faint }}>Este trabajador no tiene una cuenta de acceso vinculada.</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input className="ap-input" style={{ flex: 1 }} placeholder="Usuario" value={newAccesoUsername} onChange={(e) => setNewAccesoUsername(e.target.value)} />
                      <input className="ap-input" style={{ flex: 1 }} type="password" placeholder="Contraseña" value={newAccesoPassword} onChange={(e) => setNewAccesoPassword(e.target.value)} />
                    </div>
                    <input className="ap-input" type="email" placeholder="Correo electrónico (opcional, para notificaciones)" value={newAccesoEmail} onChange={(e) => setNewAccesoEmail(e.target.value)} />
                    <div style={{ display: "flex", gap: 14 }}>
                      <label style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                        <input type="radio" checked={newAccesoRole === "member"} onChange={() => setNewAccesoRole("member")} /> Miembro (permisos personalizados)
                      </label>
                      <label style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                        <input type="radio" checked={newAccesoRole === "admin"} onChange={() => setNewAccesoRole("admin")} /> Administrador (acceso total)
                      </label>
                    </div>
                    {newAccesoRole === "member" && (
                      <>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => setNewAccesoPermMatrix(Object.fromEntries(Object.keys(DEFAULT_MODULE_PERMISSIONS).map((k) => [k, Object.fromEntries(PERMISSION_ACTIONS.map((a) => [a.key, true]))])))} style={{ background: COLORS.greenDim, color: COLORS.green, border: `1px solid ${COLORS.green}`, borderRadius: 5, padding: "5px 8px", fontSize: 9.5, cursor: "pointer" }}>Dar todos</button>
                          <button onClick={() => setNewAccesoPermMatrix(Object.fromEntries(Object.keys(DEFAULT_MODULE_PERMISSIONS).map((k) => [k, Object.fromEntries(PERMISSION_ACTIONS.map((a) => [a.key, false]))])))} style={{ background: "transparent", color: COLORS.faint, border: `1px solid ${COLORS.border}`, borderRadius: 5, padding: "5px 8px", fontSize: 9.5, cursor: "pointer" }}>Quitar todos</button>
                        </div>
                        <div style={{ overflowX: "auto" }} className="ap-scroll">
                          {NAV_ITEMS_DEFAULT.map((n) => {
                            const rowPerms = newAccesoPermMatrix[n.key] || DEFAULT_MODULE_PERMISSIONS[n.key];
                            return (
                              <div key={n.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: `1px solid ${COLORS.border}` }}>
                                <span style={{ fontSize: 11, width: 130, flexShrink: 0 }}>{n.label}</span>
                                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                                  {PERMISSION_ACTIONS.map((a) => (
                                    <label key={a.key} title={a.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", fontSize: 8.5, color: COLORS.faint, cursor: "pointer", gap: 2 }}>
                                      {a.short}
                                      <input type="checkbox" checked={!!rowPerms[a.key]} onChange={() => toggleAccesoPermission(n.key, a.key, true)} style={{ accentColor: COLORS.amber, cursor: "pointer" }} />
                                    </label>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                    <button onClick={crearAcceso} disabled={savingAcceso} style={{ background: COLORS.amber, color: COLORS.amberText, border: "none", borderRadius: 6, padding: "7px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", alignSelf: "flex-start" }}>Crear acceso</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {showUbicaciones && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }} onClick={() => setShowUbicaciones(false)}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 22, width: 440, maxWidth: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column", boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: 14 }}>Ubicaciones</div>
              <button onClick={() => setShowUbicaciones(false)} style={{ background: "transparent", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <input
                className="ap-input"
                value={newSede}
                onChange={(e) => setNewSede(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === "Enter") addSede(); }}
                placeholder="Nueva sede (ej. UPC)"
              />
              <button onClick={addSede} disabled={!newSede.trim()} style={{ background: newSede.trim() ? COLORS.amber : COLORS.panel2, color: newSede.trim() ? COLORS.amberText : COLORS.faint, border: "none", borderRadius: 7, padding: "0 16px", fontWeight: 600, fontSize: 13, cursor: newSede.trim() ? "pointer" : "default", flexShrink: 0 }}>
                + Agregar
              </button>
            </div>
            <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }} className="ap-scroll">
              {Object.keys(ubicacionSedes).length === 0 && <div style={{ color: COLORS.faint, fontSize: 12.5, textAlign: "center", padding: "20px 0" }}>Todavia no hay sedes registradas</div>}
              {Object.keys(ubicacionSedes).sort().map((sede) => (
                <div key={sede} style={{ background: COLORS.panel2, borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: 0.3 }}>{sede}</span>
                    {confirmDeleteSede === sede ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => removeSede(sede)} style={{ background: COLORS.red, color: "#fff", border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 11, cursor: "pointer" }}>Confirmar</button>
                        <button onClick={() => setConfirmDeleteSede(null)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, borderRadius: 6, padding: "4px 8px", fontSize: 11, cursor: "pointer" }}>Cancelar</button>
                      </div>
                    ) : canDelete ? (
                      <button onClick={() => setConfirmDeleteSede(sede)} style={{ background: "transparent", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 13 }} title="Eliminar sede">🗑</button>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                    {(ubicacionSedes[sede] || []).length === 0 && (
                      <div style={{ color: COLORS.faint, fontSize: 11.5 }}>Sin campus/ubicaciones aun</div>
                    )}
                    {(ubicacionSedes[sede] || []).map((campus) => (
                      <div key={campus} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: COLORS.panel, borderRadius: 6, padding: "5px 9px" }}>
                        <span style={{ fontSize: 12 }}>{campus}</span>
                        {confirmDeleteCampus === `${sede}|${campus}` ? (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => removeCampus(sede, campus)} style={{ background: COLORS.red, color: "#fff", border: "none", borderRadius: 6, padding: "3px 7px", fontSize: 10.5, cursor: "pointer" }}>Confirmar</button>
                            <button onClick={() => setConfirmDeleteCampus(null)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, borderRadius: 6, padding: "3px 7px", fontSize: 10.5, cursor: "pointer" }}>Cancelar</button>
                          </div>
                        ) : canDelete ? (
                          <button onClick={() => setConfirmDeleteCampus(`${sede}|${campus}`)} style={{ background: "transparent", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 12 }} title="Eliminar campus">🗑</button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      className="ap-input"
                      style={{ fontSize: 12 }}
                      value={newCampusBySede[sede] || ""}
                      onChange={(e) => setNewCampusBySede((p) => ({ ...p, [sede]: e.target.value.toUpperCase() }))}
                      onKeyDown={(e) => { if (e.key === "Enter") addCampus(sede); }}
                      placeholder="Nuevo campus/ubicacion"
                    />
                    <button onClick={() => addCampus(sede)} disabled={!(newCampusBySede[sede] || "").trim()} style={{ background: (newCampusBySede[sede] || "").trim() ? COLORS.amber : COLORS.panel, color: (newCampusBySede[sede] || "").trim() ? COLORS.amberText : COLORS.faint, border: "none", borderRadius: 6, padding: "0 12px", fontWeight: 600, fontSize: 11.5, cursor: (newCampusBySede[sede] || "").trim() ? "pointer" : "default", flexShrink: 0 }}>
                      + Agregar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </>
  );
}

export {
  SYNC_STATES,
  classifySyncError,
  SyncDot,
  FilterBar,
  ClearFiltersButton,
  PdfViewerModal,
  storageJSON,
  mutateStorageJSON,
  normalizeText,
  normalizePersonKey,
  canonicalPersonName,
  canonicalizePeople,
  canonicalizeWorkerRecords,
  canonicalizeWorkerSalaryMap,
  APP_VERSION,
  LOGO_SHIELD,
  COLORS,
  CONTACTO_PALETTE,
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
  hasLink,
  computeAutoEstados,
  fmtMoney,
  fmtMoneyCompact,
  fmtPct,
  fmtDate,
  fmtDateTime,
  daysSince,
  isUrgente,
  monthLabel,
  groupByMonth,
  groupByField,
  fmtBytes,
  initials,
  colorForContacto,
  normEstado,
  estadoFacturaColor,
  medioPagoColor,
  docEstadoColor,
  gastoEstadoColor,
  csvEscape,
  buildXlsxSheet,
  downloadXlsxWorkbook,
  buildRespaldoXlsx,
  readXlsxRows,
  useCarpetaLocal,
  BotonCarpetaLocal,
  nombreArchivoAnual,
  normalizeFechaImportada,
  uid,
  isInteractiveTarget,
  fileToDataURL,
  isImageType,
  moveInArray,
  reorderWithinFull,
  scrollFieldIntoViewOnFocus,
  useRowDrag,
  useIsMobile,
  useAutoSaveOnLeave,
  useAutoSaveDebounced,
  DragHandle,
  Badge,
  MultiSelect,
  DropdownMultiSelect,
  MiniBarChart,
  ChartPanel,
  Kpi,
  KpiHorasExtra,
  KpiPuntualidad,
  VACACIONES_DIAS_ANIO,
  KpiVacaciones,
  KpiFaltas,
  KpiPresentes,
  HoraInput,
  DateInput,
  EditForm,
  OCSelector,
  DropdownSelect,
  parseOcList,
  ocLabel,
  buildOcOptions,
  AttachmentThumb,
  InfoRow,
  DocRow,
  AccesosPersonal,
  STORAGE_KEY_ASISTENCIA_REGISTROS,
  STORAGE_KEY_ASISTENCIA_TRABAJADORES,
  STORAGE_KEY_ASISTENCIA_UBICACIONES,
  STORAGE_KEY_ASISTENCIA_SUELDOS,
  STORAGE_KEY_ASISTENCIA_PLANILLA_FIJA,
  STORAGE_KEY_ASISTENCIA_DESCUENTOS_BONOS,
  ASISTENCIA_SEED_UBICACIONES,
  ESTADOS_ASISTENCIA,
  ESTADOS_ASISTENCIA_FORM,
  TURNOS_ASISTENCIA,
  JORNADA_HORAS_ASISTENCIA,
  RECARGO_DOMINGO_FERIADO,
  FERIADOS_FIJOS_PERU,
  pascuaFecha,
  sumarDiasFecha,
  esFeriadoPeru,
  esDomingo,
  esDiaBonoPeru,
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
  ASISTENCIA_SEED_SUELDOS,
  DIAS_MES_PLANILLA,
  calcularMontoHorasExtraRegistro,
  resumenPlanillaPorTrabajador,
  BONO_DIARIO_TRABAJADORES,
  BONO_DIARIO_MONTO,
  VIATICO_AUTO_SUPERVISION_MONTO,
  VIATICO_AUTO_SUPERVISION_CONCEPTO,
  esBonoDiarioTrabajador,
  UBICACION_SEDES,
  TC_LOGO_SHIELD,
  TC_COLORS,
  ESTADOS,
  PRIORIDADES,
  FRECUENCIAS,
  ESTADO_COLOR,
  TC_KPI_DEFS,
  RESP_PALETTE,
  DEFAULT_ALERT_PHONE,
  MESES_ANTIGUEDAD_AUTOARCHIVO,
  DIAS_RETENCION_PAPELERA,
  MS_POR_DIA,
  monthsAgoTs,
  PERMISSION_ACTIONS,
  DEFAULT_MODULE_PERMISSIONS,
  makeFullPermissionMatrix,
  normalizePermissionMatrix,
  hasModulePermission,
  ownerIdentityOf,
  puedeVerTodos,
  filterOwnRecords,
  DEFAULT_USERS,
  INITIAL_TASKS,
  todayStr,
  diasRestantes,
  cumplimiento,
  addPeriod,
  tcInitials,
  colorForResp,
  fmtRelTime,
  tcCsvEscape,
  fieldLabel,
  describeLog,
  CONTACTOS_SEED,
  STORAGE_KEY_CONTACTOS,
  STORAGE_KEY_CUENTAS,
  emptyContactoDraft,
  emptyCuentaDraft,
  VIATICOS_SEED,
  STORAGE_KEY_VIATICOS,
  emptyViaticoDraft,
  GASTOS_SEED,
  STORAGE_KEY_GASTOS,
  emptyGastoDraft,
  montoGasto,
  parseMontoGasto,
  ESTADO_GASTO_OPTIONS,
  ViaticoForm,
  GastoForm,
  RespForm,
  TcKpi,
  RESPONSABILIDADES_SEED,
  STORAGE_KEY_RESPONSABILIDADES,
  emptyRespDraft,
  COTIZACIONES_SEED,
  STORAGE_KEY_COTIZACIONES,
  WILARCON_EMPRESA,
  COTIZACION_MEDIDAS,
  COTIZACION_TERMINOS_DEFAULT,
  emptyCotizacionItem,
  emptyCotizacionSeccion,
  emptyCotizacionDraft,
  cotizacionDraftDesdeVisita,
  siguienteNumeroCotizacion,
  itemTotalCotizacion,
  seccionTotalCotizacion,
  cotizacionTotales,
  seccionNumeroLabel,
  itemNumeroLabel,
  cotMontoFijo,
  cotMontoSmart,
  buildCotizacionXlsx,
  buildCotizacionPdf,
  STORAGE_KEY_INFORMES,
  emptyInformeDraft,
  emptyInformeInfraDraft,
  informeDraftDesdeCotizacion,
  siguienteCodigoInforme,
  siguienteNumeroProyecto,
  resizeImageFile,
  subirFotoADrive,
  urlFotoDrive,
  eliminarFotoDrive,
  obtenerFotoDriveComoDataUrl,
  buildInformePdf,
  buildInformeInfraPdf,
  STORAGE_KEY_VISITAS,
  emptyVisitaDraft,
  siguienteCodigoVisita,
  buildVisitaPdf,
  NAV_ITEMS_DEFAULT,
  NAV_ORDER_STORAGE_KEY,
  SESSION_STORAGE_KEY,
  STORAGE_KEY_PROPUESTAS,
  cargarPropuestas,
  diffCampos,
  crearPropuestaEdicion,
  crearPropuestaEliminacion,
  aprobarPropuesta,
  rechazarPropuesta,
  intentarGuardarConAprobacion,
  intentarEliminarConAprobacion,
  usePropuestasPendientes,
  usePropuestasUsuario,
  marcarPropuestasVistasPorAutor,
  PropuestasPanel,
  MisPropuestasPanel,
  MensajeModal,
  SustentoModal,
  useSustentoGate,
  fmtFechaHora,
  STORAGE_KEY_COTIZACION_REVISIONES,
  crearSolicitudRevisionCotizacion,
  resolverRevisionCotizacion,
  useRevisionesCotizacionPendientes,
  useRevisionesCotizacionUsuario,
  marcarRevisionesCotizacionVistas,
  MisRevisionesCotizacionPanel,
  AprobarRevisionCotizacionModal
};
