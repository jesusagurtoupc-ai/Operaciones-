"use client";

import { Children, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import TopNav, { CONTENEDOR, EncabezadoPagina } from "@/components/layout/TopNav";
import { formatoSoles, CAMPUS_PRINCIPAL, nombreCampus } from "@/lib/shared";
import { useMe } from "@/lib/client";
import {
  SubirExcel, ESTADOS, ESTADO_CODIGO, FECHA_INFORME_EXCEL, serieMala, sinTildes, compacto,
  type Equipo, type Datos,
} from "@/components/inventario/CargaExcel";
import { descargarExcelInventario } from "@/lib/importarExcel";
import { qrSvg } from "@/lib/qr";
import FotosMaterial from "@/components/materiales/FotosMaterial";

/**
 * Inventario de equipos (aire acondicionado, ventilación, extracción, presurización, cortinas de aire).
 *
 * Datos: el inventario guardado desde la app (/api/inventario) o, si nunca se guardó, la consolidación
 * de tres Excel (public/inventario-equipos.json). Un equipo que aparece en varios archivos es UNA fila;
 * los repetidos (misma serie, marca y modelo) se omiten. Todo se calcula aquí, en el navegador.
 *
 * Secciones: KPI · tipo de equipo y buscador · gráficos (estado por tipo, antigüedad) · mapa por pabellón
 * y piso · cantidades por tipo · prioridad de reemplazo · datos por completar · correctivos por ambiente
 * · lista con ficha (QR, edición tras el mantenimiento, correctivos del ambiente) · subir Excel.
 */

/** Lo que acompaña al inventario (de /api/inventario?extra=1). */
type Extra = {
  tickets: Record<string, { n: number; monto: number }>;
  verificado: Record<string, string>;
  mantenimiento: Record<string, string>;
  fallas: Record<string, number>;
  config: { precios?: Record<string, number>; presupuesto?: Record<string, number>; frecuencias?: Record<string, number> };
  evolucion: { mes: string; datos: Record<string, number> }[];
};
const EXTRA_VACIO: Extra = { tickets: {}, verificado: {}, mantenimiento: {}, fallas: {}, config: {}, evolucion: [] };
const DATOS_VACIOS: Datos = {
  generado: "", corte: "", fuentes: [], leidos: {}, contable_total: 0, contable_baja: 0, contable_enlazados: 0, repetidos: [], equipos: [],
};
type Ticket = { id: number; refer: number | null; ticket: string | null; descripcion: string; lugar: string | null; estado: string; monto: number | null; f_reg: string | null };

/* ───────── Clasificaciones ───────── */

const estadoDe = (e: Equipo) => ESTADOS[e.estado] ?? e.estado;
const COLOR_ESTADO: Record<string, string> = {
  Operativo: "bg-emerald-50 text-emerald-800 border-emerald-200",
  "Con observación": "bg-amber-50 text-amber-900 border-amber-200",
  Inoperativo: "bg-red-50 text-red-800 border-red-200",
  "Sin informe": "bg-slate-50 text-slate-600 border-slate-200",
};
const RELLENO_ESTADO: Record<string, string> = {
  Operativo: "#1f8a64",
  "Con observación": "#e0a33a",
  Inoperativo: "#d0112d",
  "Sin informe": "#c3c9d4",
};

/**
 * Tipo de equipo, de lo registrado, como "Categoría/Subtipo": Aire acondicionado (Split, VRV/VRF, Fan coil
 * de agua helada), Ventilación (Inyector, Ventilador centrífugo, Jetfan), Extracción (Extractor, Extractor
 * de monóxido), Presurizador, Cortina de aire, Damper.
 */
const SISTEMAS_HVAC = ["Agua helada", "Expansión directa", "Ventilación mecánica", "Monóxido y jetfan", "Cortinas de aire", "Presurización"];
function tipoEquipo(e: Equipo): string {
  // Otros sistemas (bombas, tableros, UPS…) cargados por Excel: su sistema es la categoría y su tipo, el subtipo.
  if (e.sistema && !SISTEMAS_HVAC.includes(e.sistema)) return e.tipo ? `${e.sistema}/${e.tipo}` : e.sistema;
  // El "tipo" del Excel dice "VM - INYECTOR / EXTRACTOR" para ambos: se decide por el nombre y el subtipo.
  const n = `${e.nombre} ${e.subtipo ?? ""}`.toUpperCase();
  if (n.includes("DAMPER")) return "Damper";
  if (e.sistema === "Agua helada" || e.sistema === "Expansión directa") {
    const t = (e.tipo ?? "").toUpperCase();
    const sub = t === "SPLIT" ? "Split" : t === "VRV/VRF" ? "VRV/VRF" : t === "AGUA HELADA" || e.sistema === "Agua helada" ? "Fan coil de agua helada" : "Sin dato";
    return `Aire acondicionado/${sub}`;
  }
  if (n.includes("JETFAN")) return "Ventilación/Jetfan";
  if (n.includes("PRESURIZADOR") || e.sistema === "Presurización") return "Presurizador";
  if (n.includes("CORTINA")) return "Cortina de aire";
  if (n.includes("MONOXIDO") || e.sistema === "Monóxido y jetfan") return "Extracción/Extractor de monóxido";
  if (n.includes("INYECTOR")) return "Ventilación/Inyector";
  if (n.includes("EXTRACTOR")) return "Extracción/Extractor";
  return "Ventilación/Ventilador centrífugo";
}
const ORDEN_TIPOS = ["Aire acondicionado", "Ventilación", "Extracción", "Presurizador", "Cortina de aire", "Damper"];
const enTipo = (e: Equipo, v: string) => !v || tipoEquipo(e) === v || tipoEquipo(e).startsWith(v + "/");
const tipoTexto = (e: Equipo) => tipoEquipo(e).replace("/", " · ");

const vidaDe = (e: Equipo) =>
  e.meses_excedidos == null ? "Sin dato" : e.meses_excedidos > 0 ? "Vida útil superada" : "Dentro de su vida útil";
const reemplazo = (e: Equipo) => /reemplazo/i.test(e.alerta);

/** Datos que faltan, para completarlos en la próxima visita de mantenimiento. */
const FALTANTES: { clave: string; texto: string; falta: (e: Equipo) => boolean }[] = [
  { clave: "informe", texto: "Sin informe de mantenimiento", falta: (e) => !e.estado },
  { clave: "anio", texto: "Sin año de fabricación o ingreso", falta: (e) => !e.anio },
  { clave: "serie", texto: "Sin N° de serie (o ilegible)", falta: (e) => serieMala(e.serie) },
  { clave: "marca", texto: "Sin marca o modelo", falta: (e) => !e.marca || !e.modelo },
  { clave: "codigo", texto: "Sin código de equipo", falta: (e) => !e.codigo },
  { clave: "pabellon", texto: "Sin pabellón o piso", falta: (e) => !e.pabellon || !e.piso },
];

/* ───────── Mantenimiento preventivo ───────── */
/** Frecuencia sugerida (meses) por categoría; se cambia en la página y queda para todos. */
const FRECUENCIA_SUGERIDA: Record<string, number> = {
  "Aire acondicionado": 3, Ventilación: 6, Extracción: 6, Presurizador: 6, "Cortina de aire": 6, Damper: 12,
};
const hoyISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
function sumarMesesISO(f: string, m: number) {
  const [y, mo, d] = f.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + m, Math.min(d, 28)));
  return t.toISOString().slice(0, 10);
}
function mantDe(e: Equipo, extra: Extra) {
  const cat = tipoEquipo(e).split("/")[0];
  const frec = extra.config.frecuencias?.[cat] ?? FRECUENCIA_SUGERIDA[cat] ?? 6;
  const ultimo = [extra.mantenimiento[e.codigo], e.ultimo_mant, e.informe ? FECHA_INFORME_EXCEL : undefined]
    .filter((x): x is string => !!x).sort().pop() ?? null;
  const proximo = ultimo ? sumarMesesISO(ultimo, frec) : null;
  const hoy = hoyISO();
  const estado = !proximo ? "Sin registro" : proximo < hoy ? "Vencido" : proximo <= sumarMesesISO(hoy, 1) ? "Próximo" : "Al día";
  return { frec, ultimo, proximo, estado, cat };
}

/**
 * Puntaje de prioridad de reemplazo: fallas registradas (15 c/u, máx. 45) + inoperativo (100) + recomienda reemplazo (60) + con observación (10)
 * + meses que pasó su vida útil (0,3 por mes, máx. 60). Cuanto más alto, antes conviene reemplazarlo.
 */
function prioridad(e: Equipo, fallas = 0): number {
  let p = Math.min(45, fallas * 15); // fallas registradas en la bitácora (pasó a inoperativo o con observación)
  if (e.estado === "INOPERATIVO") p += 100;
  if (reemplazo(e)) p += 60;
  if (e.estado === "OPERATIVO CON OBSERVACION") p += 10;
  if ((e.meses_excedidos ?? 0) > 0) p += Math.min(60, (e.meses_excedidos ?? 0) * 0.3);
  return Math.round(p);
}
const razones = (e: Equipo, fallas = 0) =>
  [
    fallas > 0 && `${fallas} falla(s) registrada(s)`,
    e.estado === "INOPERATIVO" && "inoperativo",
    reemplazo(e) && "el informe recomienda reemplazo",
    e.estado === "OPERATIVO CON OBSERVACION" && "con observación",
    (e.meses_excedidos ?? 0) > 0 && `${e.meses_excedidos} meses pasado de su vida útil`,
  ]
    .filter(Boolean)
    .join(" · ");

/* ───────── Filtros ───────── */

type Filtros = {
  q: string;
  equipo: string;
  reemplazo: boolean;
  estado: string;
  vida: string;
  pabellon: string;
  piso: string;
  falta: string;
  /** Control: "no_verificado", "mant:Vencido", "mant:Sin registro", "mant:Próximo", "con_tickets", "fallas". */
  control: string;
};
const VACIO: Filtros = { q: "", equipo: "", reemplazo: false, estado: "", vida: "", pabellon: "", piso: "", falta: "", control: "" };
const TEXTO_CONTROL: Record<string, string> = {
  no_verificado: "No verificados este año",
  "mant:Vencido": "Mantenimiento vencido",
  "mant:Próximo": "Mantenimiento en los próximos 30 días",
  "mant:Sin registro": "Sin mantenimiento registrado",
  con_tickets: "Con correctivos enlazados",
  fallas: "Con fallas registradas",
};
const CLAVE = "inventario-filtros";
const CLAVE_VISTA = "inventario-pestana";
const ORDEN_PISO_N = (p?: string) => {
  const n = Number(/(\d+)/.exec(p ?? "")?.[1] ?? 0);
  return !p ? 999 : p === "Azotea" ? 100 : p.startsWith("Sótano") ? -n : n;
};
const ORD_ESTADO: Record<string, number> = { INOPERATIVO: 0, "OPERATIVO CON OBSERVACION": 1, "": 2, OPERATIVO: 3 };
/** Órdenes de la lista de equipos. */
const ORDENES: Record<string, { texto: string; cmp: (a: Equipo, b: Equipo, x: Extra) => number }> = {
  ubicacion: { texto: "Ubicación (pabellón y piso)", cmp: (a, b) =>
    (a.pabellon ? 0 : 1) - (b.pabellon ? 0 : 1) || (a.pabellon ?? "").localeCompare(b.pabellon ?? "") || ORDEN_PISO_N(a.piso) - ORDEN_PISO_N(b.piso) || a.ubicacion.localeCompare(b.ubicacion) },
  prioridad: { texto: "Prioridad de reemplazo", cmp: (a, b, x) => prioridad(b, x.fallas[b.codigo] ?? 0) - prioridad(a, x.fallas[a.codigo] ?? 0) },
  estado: { texto: "Estado (inoperativos primero)", cmp: (a, b) => (ORD_ESTADO[a.estado] ?? 2) - (ORD_ESTADO[b.estado] ?? 2) },
  antiguedad: { texto: "Más antiguos primero", cmp: (a, b) => (a.anio ?? 9999) - (b.anio ?? 9999) },
  mantenimiento: { texto: "Mantenimiento más atrasado", cmp: (a, b, x) => (mantDe(a, x).proximo ?? "0").localeCompare(mantDe(b, x).proximo ?? "0") },
  tipo: { texto: "Tipo de equipo", cmp: (a, b) => tipoEquipo(a).localeCompare(tipoEquipo(b)) },
};
type Vista = "resumen" | "equipos" | "mantenimiento" | "reemplazo" | "datos";
const VISTAS: { id: Vista; texto: string }[] = [
  { id: "resumen", texto: "Resumen" },
  { id: "equipos", texto: "Equipos" },
  { id: "mantenimiento", texto: "Mantenimiento" },
  { id: "reemplazo", texto: "Reemplazo y costos" },
  { id: "datos", texto: "Datos" },
];
type Salvo = keyof Filtros;

type Control = (e: Equipo, clave: string) => boolean;
function cumple(e: Equipo, f: Filtros, q: string, salvo?: Salvo, ctl?: Control) {
  if (salvo !== "control" && f.control && ctl && !ctl(e, f.control)) return false;
  if (salvo !== "equipo" && !enTipo(e, f.equipo)) return false;
  if (salvo !== "estado" && f.estado && estadoDe(e) !== f.estado) return false;
  if (salvo !== "vida" && f.vida && vidaDe(e) !== f.vida) return false;
  if (salvo !== "reemplazo" && f.reemplazo && !reemplazo(e)) return false;
  if (salvo !== "pabellon" && f.pabellon && (e.pabellon || "Sin dato") !== f.pabellon) return false;
  if (salvo !== "piso" && f.piso && (e.piso || "Sin dato") !== f.piso) return false;
  if (salvo !== "falta" && f.falta && !FALTANTES.find((x) => x.clave === f.falta)?.falta(e)) return false;
  if (q) {
    const t = sinTildes(
      `${tipoTexto(e)} ${e.codigo} ${e.nombre} ${e.ubicacion} ${e.pabellon ?? ""} ${e.piso ?? ""} ${e.marca ?? ""} ${e.modelo ?? ""} ${e.serie ?? ""} ${e.sistema} ${e.observaciones ?? ""}`
    );
    if (!q.split(" ").every((p) => t.includes(p))) return false;
  }
  return true;
}

/* ───────── Correctivos del mismo ambiente (cruce aproximado por ubicación) ───────── */

/** Códigos de ambiente en un texto: "A617", "A-617", "aula B406", "laboratorio 406 B". */
function codigosAmbiente(texto: string): Set<string> {
  const t = sinTildes(texto).toUpperCase();
  const r = new Set<string>();
  for (const m of t.matchAll(/(?<![A-Z0-9])([AB])\s*-?\s*(\d{3})(?!\d)/g)) r.add(m[1] + m[2]);
  for (const m of t.matchAll(/(?<!\d)(\d{3})\s*-?\s*([AB])(?![A-Z0-9])/g)) r.add(m[2] + m[1]);
  return r;
}
function claveAmbiente(e: Equipo): { codigos: Set<string>; frase: string; pab: string } {
  const pab = /Pabellón ([AB])/.exec(e.pabellon ?? "")?.[1] ?? "";
  const codigos = codigosAmbiente(e.ubicacion);
  if (pab) {
    const m = /(?:AULA|LAB(?:ORATORIO)?|SALON|OFICINA)\.?\s*(\d{3})(?!\d)/i.exec(sinTildes(e.ubicacion));
    if (m) codigos.add(pab + m[1]);
  }
  const frase = compacto(e.ubicacion);
  return { codigos, frase: codigos.size === 0 && frase.length >= 10 ? frase : "", pab };
}
function correctivosDe(e: Equipo, tickets: { t: Ticket; codigos: Set<string>; texto: string; pab: string }[]) {
  const k = claveAmbiente(e);
  if (k.codigos.size === 0 && !k.frase) return [];
  return tickets
    .filter((x) => {
      if (k.codigos.size) return [...k.codigos].some((c) => x.codigos.has(c));
      // Por nombre del ambiente: además, el ticket no debe ser de otro pabellón.
      return x.texto.includes(k.frase) && (!k.pab || !x.pab || x.pab.includes(k.pab));
    })
    .map((x) => x.t);
}

/* ───────── Página ───────── */

export default function InventarioPage() {
  const me = useMe();
  const esAdmin = me?.rol === "admin";
  const [datos, setDatos] = useState<Datos | null>(null);
  // "vacio": campus sin inventario todavía (el archivo consolidado es solo del campus principal).
  const [fuente, setFuente] = useState<"app" | "archivo" | "vacio">("archivo");
  const [error, setError] = useState("");
  const [f, setF] = useState<Filtros>(VACIO);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>("resumen");
  const [orden, setOrden] = useState<keyof typeof ORDENES>("ubicacion");
  const [mostrar, setMostrar] = useState(50);
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [cargandoTickets, setCargandoTickets] = useState(false);
  const [extra, setExtra] = useState<Extra>(EXTRA_VACIO);
  const qDiferida = useDeferredValue(f.q);

  useEffect(() => {
    // Primero el inventario guardado desde la app; si nunca se guardó, el archivo consolidado.
    fetch("/api/inventario", { cache: "no-cache" })
      .then(async (r) => {
        if (r.ok) {
          setFuente("app");
          return r.json();
        }
        if (r.status !== 404) throw new Error(String(r.status));
        if (me?.campus && me.campus !== CAMPUS_PRINCIPAL) {
          setFuente("vacio");
          return { ...DATOS_VACIOS, generado: new Date().toISOString(), corte: new Date().toISOString().slice(0, 10) };
        }
        const a = await fetch("/inventario-equipos.json");
        if (!a.ok) throw new Error(String(a.status));
        setFuente("archivo");
        return a.json();
      })
      .then((d: Datos) => setDatos(d))
      .catch(() => setError("No se pudo cargar el inventario. Revisa tu conexión y recarga la página."));
    try {
      // Un QR abre /inventario?equipo=CÓDIGO: se busca ese equipo y se abre su ficha.
      const desdeQr = new URLSearchParams(window.location.search).get("equipo");
      if (desdeQr) {
        setF({ ...VACIO, q: desdeQr }); // eslint-disable-line react-hooks/set-state-in-effect
        setAbierto(desdeQr);
        setVista("equipos");
        return;
      }
      const v = sessionStorage.getItem(CLAVE_VISTA);
      if (v && VISTAS.some((x) => x.id === v)) setVista(v as Vista);
      const g = JSON.parse(sessionStorage.getItem(CLAVE) || "null");
      if (g && typeof g === "object") {
        const s = (v: unknown) => (typeof v === "string" ? v : "");
        setF({ q: s(g.q), equipo: s(g.equipo), reemplazo: g.reemplazo === true, estado: s(g.estado), vida: s(g.vida),
          pabellon: s(g.pabellon), piso: s(g.piso), falta: s(g.falta), control: s(g.control) });
      }
    } catch {
      /* sin almacenamiento */
    }
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(CLAVE, JSON.stringify(f));
    } catch {
      /* sin almacenamiento */
    }
    setMostrar(50); // eslint-disable-line react-hooks/set-state-in-effect
  }, [f]);

  // Datos de control (correctivos enlazados, verificaciones, mantenimientos, fallas, configuración y
  // evolución). Si el inventario aún es el del archivo, la primera visita de un administrador lo guarda en
  // la app: desde ahí hay bitácora, evolución mensual y edición.
  async function cargarExtra() {
    try {
      const r = await fetch("/api/inventario?extra=1");
      if (r.ok) setExtra({ ...EXTRA_VACIO, ...(await r.json()) });
    } catch {
      /* sin conexión: se ve el inventario sin los datos de control */
    }
  }
  useEffect(() => {
    if (!datos) return;
    if (fuente === "app" || fuente === "vacio") {
      void cargarExtra();
      return;
    }
    if (!esAdmin) return;
    void fetch("/api/inventario", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...datos, motivo: "Consolidación inicial de los 3 Excel" }),
    }).then((r) => {
      if (r.ok) setFuente("app"); // dispara la carga de los datos de control
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos !== null, fuente, esAdmin]);
  async function guardarConfig(clave: "precios" | "presupuesto" | "frecuencias", valor: Record<string, number>) {
    setExtra((x) => ({ ...x, config: { ...x.config, [clave]: valor } }));
    const r = await fetch("/api/inventario?accion=config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clave, valor }),
    });
    if (!r.ok) setError((await r.json().catch(() => ({}))).error || "No se pudo guardar la configuración");
  }
  const anioActual = hoyISO().slice(0, 4);
  const ctl: Control = (e, c) => {
    if (c === "no_verificado") return !(extra.verificado[e.codigo] ?? "").startsWith(anioActual);
    if (c === "con_tickets") return !!extra.tickets[e.codigo];
    if (c === "fallas") return (extra.fallas[e.codigo] ?? 0) > 0;
    if (c.startsWith("mant:")) return mantDe(e, extra).estado === c.slice(5);
    return true;
  };

  const q = sinTildes(qDiferida.trim()).replace(/\s+/g, " ");
  const equipos: Equipo[] = useMemo(() => datos?.equipos ?? [], [datos]);
  const visibles: Equipo[] = useMemo(() => equipos.filter((e) => cumple(e, f, q, undefined, ctl)), [equipos, f, q, extra]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opciones del selector "Tipo de equipo", con cuántos hay (con los demás filtros aplicados).
  const opcionesTipo = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of equipos) {
      if (!cumple(e, f, q, "equipo", ctl)) continue;
      const t = tipoEquipo(e);
      const [cat] = t.split("/");
      m.set(cat, (m.get(cat) ?? 0) + 1);
      if (t !== cat) m.set(t, (m.get(t) ?? 0) + 1);
    }
    const ord = (c: string) => ORDEN_TIPOS.indexOf(c) + 1 || 99;
    const cats = [...new Set(equipos.map((e) => tipoEquipo(e).split("/")[0]))].sort((a, b) => ord(a) - ord(b));
    const out: { valor: string; texto: string; n: number; sub: boolean }[] = [];
    for (const c of cats) {
      const subs = [...new Set(equipos.map(tipoEquipo).filter((t) => t.startsWith(c + "/")))].sort(
        (a, b) => (m.get(b) ?? 0) - (m.get(a) ?? 0) || a.localeCompare(b)
      );
      out.push({ valor: c, texto: subs.length ? `${c} (todos)` : c, n: m.get(c) ?? 0, sub: false });
      for (const t of subs) out.push({ valor: t, texto: t.slice(c.length + 1), n: m.get(t) ?? 0, sub: true });
    }
    return out;
  }, [equipos, f, q, extra]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalSinTipo = useMemo(() => equipos.filter((e) => cumple(e, f, q, "equipo", ctl)).length, [equipos, f, q, extra]); // eslint-disable-line react-hooks/exhaustive-deps

  const kpi = useMemo(() => {
    const k = { total: visibles.length, op: 0, obs: 0, inop: 0, sin: 0, reemp: 0, vida: 0, verif: 0, vencido: 0 };
    for (const e of visibles) {
      const s = estadoDe(e);
      if (s === "Operativo") k.op++;
      else if (s === "Con observación") k.obs++;
      else if (s === "Inoperativo") k.inop++;
      else k.sin++;
      if (reemplazo(e)) k.reemp++;
      if ((e.meses_excedidos ?? 0) > 0) k.vida++;
      if ((extra.verificado[e.codigo] ?? "").startsWith(anioActual)) k.verif++;
      if (mantDe(e, extra).estado === "Vencido") k.vencido++;
    }
    return k;
  }, [visibles, extra, anioActual]);

  // Correctivos: se cargan solo si se piden (cada página de la lista es una consulta al servidor).
  const ticketsIdx = useMemo(
    () =>
      (tickets ?? []).map((t) => ({
        t,
        codigos: codigosAmbiente(t.descripcion ?? ""),
        texto: compacto(`${t.descripcion ?? ""}`),
        pab: (t.lugar ?? "").toUpperCase().replace(/PABELLON\s*/g, ""),
      })),
    [tickets]
  );
  async function cargarCorrectivos() {
    if (tickets || cargandoTickets) return;
    setCargandoTickets(true);
    try {
      const todos: Ticket[] = [];
      for (let p = 1; p <= 20; p++) {
        const r = await fetch(`/api/correctivos?pageSize=200&page=${p}`);
        if (!r.ok) throw new Error(String(r.status));
        const d = await r.json();
        todos.push(...(d.data as Ticket[]));
        if (p >= (d.pagination?.totalPages ?? 1)) break;
      }
      setTickets(todos);
    } catch {
      setError("No se pudieron cargar los correctivos para cruzarlos con el inventario.");
    } finally {
      setCargandoTickets(false);
    }
  }

  const set = (cambio: Partial<Filtros>) => setF((x) => ({ ...x, ...cambio }));
  const irA = (v: Vista) => {
    setVista(v);
    try {
      sessionStorage.setItem(CLAVE_VISTA, v);
    } catch {
      /* sin almacenamiento */
    }
  };
  /** Abre la ficha de un equipo en la pestaña Equipos. */
  const abrir = (codigo: string) => {
    set({ q: codigo });
    setAbierto(codigo);
    irA("equipos");
    document.getElementById("pestanas")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const hayFiltros = Object.entries(f).some(([, v]) => !!v);
  const chips: { texto: string; quitar: Partial<Filtros> }[] = [
    f.equipo && { texto: f.equipo.replace("/", " · "), quitar: { equipo: "" } },
    f.q && { texto: `“${f.q}”`, quitar: { q: "" } },
    f.estado && { texto: f.estado, quitar: { estado: "" } },
    f.vida && { texto: f.vida, quitar: { vida: "" } },
    f.reemplazo && { texto: "Recomienda reemplazo", quitar: { reemplazo: false } },
    (f.pabellon || f.piso) && { texto: [f.pabellon, f.piso].filter(Boolean).join(" · "), quitar: { pabellon: "", piso: "" } },
    f.falta && { texto: FALTANTES.find((x) => x.clave === f.falta)?.texto ?? f.falta, quitar: { falta: "" } },
    f.control && { texto: TEXTO_CONTROL[f.control] ?? f.control, quitar: { control: "" } },
  ].filter(Boolean) as { texto: string; quitar: Partial<Filtros> }[];
  // El mapa usa todos los filtros menos pabellón y piso (si no, al tocar una casilla quedaría solo ella).
  const baseMapa: Equipo[] = useMemo(
    () => (f.pabellon || f.piso ? equipos.filter((e) => cumple(e, { ...f, pabellon: "", piso: "" }, q, undefined, ctl)) : visibles),
    [equipos, f, q, extra, visibles] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const ordenados: Equipo[] = useMemo(() => [...visibles].sort((a, b) => ORDENES[orden].cmp(a, b, extra)), [visibles, orden, extra]);
  const nPrioridad = visibles.filter((e) => e.estado === "INOPERATIVO" || reemplazo(e) || (extra.fallas[e.codigo] ?? 0) >= 2).length;

  function exportar() {
    const cols = [
      ["Código", 11], ["Tipo de equipo", 30], ["Sistema", 18], ["Tipo", 16], ["Subtipo", 14], ["Equipo", 26], ["Pabellón", 11],
      ["Piso", 9], ["Ubicación", 32], ["Marca", 15], ["Modelo", 20], ["N° Serie", 22], ["Capacidad", 14], ["Año", 7],
      ["Vida útil (meses)", 10], ["Meses de uso", 10], ["Meses excedidos", 10], ["Estado", 16], ["Alerta", 26],
      ["Informe de mantenimiento", 26], ["Observaciones", 60], ["Prioridad de reemplazo", 10], ["Precio S/ (contable)", 12],
      ["Fecha de ingreso", 12], ["Último mantenimiento", 12], ["Próximo mantenimiento", 12], ["Mantenimiento", 12],
      ["Verificado en campo", 12], ["Correctivos enlazados", 10], ["Gastado en correctivos S/", 12], ["Fuentes", 30],
    ] as const;
    descargarExcelInventario(
      cols.map(([titulo, ancho]) => ({ titulo, ancho })),
      visibles.map((e) => [
        e.codigo || null, tipoTexto(e), e.sistema, e.tipo || null, e.subtipo || null, e.nombre || null, e.pabellon || null,
        e.piso || null, e.ubicacion || null, e.marca || null, e.modelo || null, e.serie || null, e.capacidad || null,
        e.anio ?? null, e.vida_util ?? null, e.meses_uso ?? null, e.meses_excedidos ?? null, estadoDe(e), e.alerta || null,
        e.informe || null, (e.observaciones || "").replace(/\s*\n\s*/g, " · ") || null, prioridad(e, extra.fallas[e.codigo] ?? 0) || null,
        e.precio ?? null, e.fecha_ingreso ?? null, mantDe(e, extra).ultimo, mantDe(e, extra).proximo, mantDe(e, extra).estado,
        extra.verificado[e.codigo]?.slice(0, 10) ?? null, extra.tickets[e.codigo]?.n ?? null, extra.tickets[e.codigo]?.monto ?? null,
        e.fuentes.join(", "),
      ]),
      {
        titulo: `INVENTARIO DE EQUIPOS – ${nombreCampus(me?.campus ?? CAMPUS_PRINCIPAL).toUpperCase()}`,
        detalle: `${visibles.length} equipo(s)${hayFiltros ? " (con filtros)" : ""} · datos al ${fecha(datos?.corte)}`,
      }
    );
  }

  /** Etiquetas con QR de los equipos visibles (con código), en una ventana lista para imprimir. */
  function imprimirEtiquetas() {
    const conCodigo = visibles.filter((e) => e.codigo);
    const w = window.open("", "_blank");
    if (!w) return;
    const base = `${window.location.origin}/inventario?equipo=`;
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
    const etiquetas = conCodigo
      .map(
        (e) => `<div class="et">${qrSvg(base + encodeURIComponent(e.codigo), 110)}<div class="tx"><b>${esc(e.codigo)}</b>
<span>${esc(e.nombre || tipoTexto(e))}</span><span>${esc([e.pabellon, e.piso].filter(Boolean).join(" · "))}</span>
<span>${esc(e.ubicacion)}</span><span class="m">${esc([e.marca, e.modelo].filter(Boolean).join(" "))}</span></div></div>`
      )
      .join("");
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiquetas QR · Inventario</title>
<style>body{font-family:Arial,sans-serif;margin:12px}h1{font-size:14px;margin:0 0 8px}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.et{display:flex;gap:6px;align-items:center;border:1px dashed #999;padding:6px;break-inside:avoid}.et svg{flex:none}.tx{display:flex;flex-direction:column;font-size:10px;line-height:1.25;min-width:0}
.tx b{font-size:13px}.tx span{overflow:hidden;text-overflow:ellipsis}.m{color:#555}@media print{h1,button{display:none}body{margin:6mm}}
button{margin:0 0 10px;padding:6px 12px}</style></head><body><h1>${conCodigo.length} etiqueta(s) · al escanear se abre la ficha del equipo</h1>
<button onclick="print()">Imprimir</button><div class="g">${etiquetas}</div></body></html>`);
    w.document.close();
  }

  return (
    <div className="min-h-screen bg-page">
      <TopNav />
      <main className={CONTENEDOR}>
        <EncabezadoPagina
          titulo="Inventario de equipos"
          descripcion={
            <>
              Equipos del campus, su estado, mantenimiento y reemplazo
              {datos?.corte ? ` · datos al ${fecha(datos.corte)}` : ""}
              {fuente === "app" && datos?.motivo ? ` · ${datos.motivo}` : ""}
            </>
          }
          acciones={
            datos ? (
              <>
                <button type="button" onClick={exportar} disabled={visibles.length === 0} className={BOTON}>
                  Descargar Excel ({visibles.length})
                </button>
                <button type="button" onClick={imprimirEtiquetas} disabled={!visibles.some((e) => e.codigo)} className={BOTON}>
                  Etiquetas QR ({visibles.filter((e) => e.codigo).length})
                </button>
              </>
            ) : undefined
          }
        />

        {error && <p className="mb-4 text-sm text-danger bg-white border border-line p-3">{error}</p>}
        {!datos && !error && <div className="h-40 bg-white border border-line animate-pulse" aria-busy="true" />}

        {datos && (
          <>
            {/* Indicadores: siguen a los filtros; un toque filtra. */}
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
              <button type="button" onClick={() => setF(VACIO)}
                className={`${TARJETA} col-span-2 lg:col-span-1 text-left px-4 py-3 ${!hayFiltros ? "ring-1 ring-ink border-ink" : "hover:bg-slate-50"}`}>
                <span className="block text-[11px] uppercase tracking-wider text-ink-soft">Equipos</span>
                <span className="block font-display font-bold text-4xl tabular-nums leading-tight">{kpi.total.toLocaleString("es-PE")}</span>
                <span className="block text-xs text-ink-soft">{hayFiltros ? `de ${equipos.length} · toca para ver todos` : "únicos en el inventario"}</span>
              </button>
              <EstadoResumen kpi={kpi} activo={f.estado} alElegir={(s2) => set({ estado: f.estado === s2 ? "" : s2 })} />
              <Par titulo="Riesgo" filas={[
                { texto: "Recomienda reemplazo", n: kpi.reemp, total: kpi.total, color: "#7a1f9c", activo: f.reemplazo, alTocar: () => set({ reemplazo: !f.reemplazo }) },
                { texto: "Vida útil superada", n: kpi.vida, total: kpi.total, color: "#9c4a1f", activo: f.vida === "Vida útil superada",
                  alTocar: () => set({ vida: f.vida ? "" : "Vida útil superada" }) },
              ]} />
              <Par titulo="Control" filas={[
                { texto: `Verificados ${anioActual}`, n: kpi.verif, total: kpi.total, color: "#1f6f8a", activo: f.control === "no_verificado",
                  alTocar: () => set({ control: f.control === "no_verificado" ? "" : "no_verificado" }), nota: "toca: los no verificados" },
                { texto: "Mantenimiento vencido", n: kpi.vencido, total: kpi.total, color: "#b4531f", activo: f.control === "mant:Vencido",
                  alTocar: () => set({ control: f.control === "mant:Vencido" ? "" : "mant:Vencido" }) },
              ]} />
            </div>

            {/* Filtros y pestañas: quedan a la vista al bajar */}
            <div id="pestanas" className="sticky top-14 sm:top-16 z-20 -mx-3 sm:-mx-5 px-3 sm:px-5 pt-3 bg-page/95 backdrop-blur-sm scroll-mt-16">
              <div className={`${TARJETA} p-2.5 flex flex-wrap gap-2 items-center`}>
                <select
                  value={f.equipo}
                  onChange={(e) => set({ equipo: e.target.value })}
                  aria-label="Tipo de equipo"
                  className={`border rounded-md px-2 py-2 text-sm bg-white max-w-[15rem] ${f.equipo ? "border-ink font-medium" : "border-line-strong"}`}
                >
                  <option value="">Todos los tipos ({totalSinTipo})</option>
                  {opcionesTipo.map((o) => (
                    <option key={o.valor} value={o.valor} disabled={o.n === 0 && o.valor !== f.equipo}>
                      {o.sub ? "\u00a0\u00a0\u00a0– " : ""}
                      {o.texto} ({o.n})
                    </option>
                  ))}
                </select>
                <input
                  type="search"
                  value={f.q}
                  onChange={(e) => set({ q: e.target.value })}
                  placeholder="Buscar código, equipo, ubicación, marca, modelo, serie…"
                  className="flex-1 min-w-[200px] border border-line-strong rounded-md px-3 py-2 text-sm"
                />
                {chips.map((c) => (
                  <button key={c.texto} type="button" onClick={() => set(c.quitar)} title="Quitar este filtro"
                    className="text-xs bg-ink text-white rounded-full pl-3 pr-2 py-1 flex items-center gap-1 max-w-[16rem]">
                    <span className="truncate">{c.texto}</span><span aria-hidden="true" className="opacity-70">✕</span>
                  </button>
                ))}
                {chips.length > 1 && (
                  <button type="button" onClick={() => setF(VACIO)} className="text-xs underline text-ink-soft px-1">Quitar todos</button>
                )}
              </div>
              <nav className="flex gap-1 overflow-x-auto mt-2 border-b border-line" aria-label="Secciones del inventario">
                {VISTAS.map((v) => {
                  const n = v.id === "equipos" ? visibles.length : v.id === "mantenimiento" ? kpi.vencido : v.id === "reemplazo" ? nPrioridad : null;
                  return (
                    <button key={v.id} type="button" onClick={() => irA(v.id)}
                      className={`whitespace-nowrap px-3 sm:px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
                        vista === v.id ? "border-amber text-ink font-semibold" : "border-transparent text-ink-soft hover:text-ink"}`}>
                      {v.texto}
                      {n !== null && <span className={`ml-1.5 text-xs tabular-nums ${vista === v.id ? "text-amber-hover" : ""}`}>{n}</span>}
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="mt-4 space-y-5">
              {visibles.length === 0 && vista !== "datos" && (
                <p className={`${TARJETA} p-6 text-sm text-ink-soft`}>Ningún equipo cumple estos filtros.</p>
              )}

              {vista === "resumen" && visibles.length > 0 && (
                <>
                  <div className="grid lg:grid-cols-2 gap-5">
                    <EstadoPorTipo visibles={visibles} alElegir={(t) => set({ equipo: t === f.equipo ? "" : t })} />
                    <Antiguedad visibles={visibles} />
                  </div>
                  <Mapa base={baseMapa} f={f} alAbrir={abrir} alElegir={(pabellon, piso) =>
                    set(f.pabellon === pabellon && f.piso === piso ? { pabellon: "", piso: "" } : { pabellon, piso })} />
                  <div className={`grid gap-5 items-start ${extra.evolucion.length ? "lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" : ""}`}>
                    <CantidadPorTipo visibles={visibles} alElegir={(t) => set({ equipo: t === f.equipo ? "" : t })} />
                    <Evolucion filas={extra.evolucion} />
                  </div>
                </>
              )}

              {vista === "equipos" && visibles.length > 0 && (
                <section className={TARJETA}>
                  <div className="px-4 py-2 flex flex-wrap items-center justify-between gap-2 border-b border-line">
                    <span className="text-xs text-ink-soft">{visibles.length} equipo(s) · toca uno para ver su ficha</span>
                    <label className="text-xs flex items-center gap-1.5">
                      <span className="text-ink-soft">Ordenar por</span>
                      <select value={orden} onChange={(e) => setOrden(e.target.value as keyof typeof ORDENES)}
                        className="border border-line-strong rounded px-2 py-1 text-xs bg-white">
                        {Object.entries(ORDENES).map(([k, o]) => <option key={k} value={k}>{o.texto}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="hidden sm:grid grid-cols-[7rem_1fr_14rem_9rem] gap-x-4 px-4 py-1.5 text-[11px] uppercase tracking-wider text-ink-soft bg-slate-50 border-b border-line">
                    <span>Código</span><span>Equipo · ubicación</span><span>Marca y modelo · año</span><span className="text-right">Estado</span>
                  </div>
                  {visibles.length === 0 ? (
                    <p className="p-6 text-sm text-ink-soft">Ningún equipo cumple estos filtros.</p>
                  ) : (
                    <ul>
                      {ordenados.slice(0, mostrar).map((e, i) => {
                        const id = e.codigo || `s${i}-${e.ubicacion}`;
                        const est = estadoDe(e);
                        const abiertoAqui = abierto === id;
                        return (
                          <li key={id} className="border-b border-line/60 last:border-0">
                                <button
                                  type="button"
                                  onClick={() => setAbierto(abiertoAqui ? null : id)}
                                  className="w-full text-left px-4 py-2.5 hover:bg-slate-50 grid gap-x-4 gap-y-0.5 sm:grid-cols-[7rem_1fr_14rem_9rem] items-center"
                                >
                                  <span className="font-mono text-xs text-ink-soft">{e.codigo || "sin código"}</span>
                                  <span className="min-w-0">
                                    <span className="font-medium">{e.nombre || e.tipo || "Equipo"}</span>
                                    <span className="ml-1.5 text-[11px] text-ink-soft border border-line rounded px-1.5 py-px align-middle">{tipoTexto(e)}</span>
                                    <span className="block text-xs text-ink-soft truncate">
                                      {[e.pabellon, e.piso, e.ubicacion].filter(Boolean).join(" · ")}
                                    </span>
                                  </span>
                                  <span className="text-xs text-ink-soft truncate">
                                    {[e.marca, e.modelo].filter(Boolean).join(" ") || "—"}
                                    {e.anio ? ` · ${e.anio}` : ""}
                                  </span>
                                  <span className="flex flex-wrap gap-1 sm:justify-end">
                                    <span className={`text-[11px] px-2 py-0.5 border rounded-full ${COLOR_ESTADO[est] ?? COLOR_ESTADO["Sin informe"]}`}>{est}</span>
                                    {reemplazo(e) && <span className="text-[11px] px-2 py-0.5 border rounded-full bg-purple-50 text-purple-800 border-purple-200">Reemplazo</span>}
                                  </span>
                                </button>
                                {abiertoAqui && (
                                  <Detalle
                                    e={e}
                                    esAdmin={esAdmin}
                                    extra={extra}
                                    alVerificar={(fechaIso) => setExtra((x) => ({ ...x, verificado: { ...x.verificado, [e.codigo]: fechaIso } }))}
                                    tickets={tickets ? correctivosDe(e, ticketsIdx) : null}
                                    cargando={cargandoTickets}
                                    alCargarTickets={() => void cargarCorrectivos()}
                                    alGuardar={async (cambios) => {
                                      if (!datos) return "Sin datos";
                                      // La primera edición guarda en la app el inventario del archivo (luego, solo el equipo).
                                      if (fuente === "archivo") {
                                        const r0 = await fetch("/api/inventario", {
                                          method: "POST",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ ...datos, motivo: "Consolidación de los 3 Excel (19/11/2026)" }),
                                        });
                                        if (!r0.ok) return (await r0.json().catch(() => ({}))).error || "No se pudo guardar";
                                        setFuente("app");
                                      }
                                      const r = await fetch("/api/inventario", {
                                        method: "PATCH",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ codigo: e.codigo, cambios }),
                                      });
                                      const d = await r.json().catch(() => ({}));
                                      if (!r.ok) return d.error || "No se pudo guardar";
                                      setDatos((x) => x && { ...x, equipos: x.equipos.map((y) => (y.codigo === e.codigo ? { ...y, ...d.equipo } : y)) });
                                      void cargarExtra(); // bitácora, fallas, mantenimiento y evolución al día
                                      return "";
                                    }}
                                  />
                                )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {visibles.length > mostrar && (
                    <button type="button" onClick={() => setMostrar((m) => m + 100)} className="w-full text-sm py-2.5 border-t border-line hover:bg-slate-50">
                      Ver más ({visibles.length - mostrar} restantes)
                    </button>
                  )}
                </section>
              )}

              {vista === "mantenimiento" && visibles.length > 0 && (
                <Preventivo visibles={visibles} extra={extra} f={f} editable={esAdmin}
                  alElegir={(c) => set({ control: f.control === c ? "" : c })} alGuardar={(v) => void guardarConfig("frecuencias", v)}
                  alVer={() => irA("equipos")} />
              )}

              {vista === "reemplazo" && visibles.length > 0 && (
                <>
                  <Prioridad visibles={visibles} extra={extra} editable={esAdmin}
                    alGuardarPrecios={(v) => void guardarConfig("precios", v)} alAbrir={abrir} />
                  <PlanPorAnios visibles={visibles} extra={extra} editable={esAdmin}
                    alGuardar={(v) => void guardarConfig("presupuesto", v)} alAbrir={abrir} />
                  <div className="grid lg:grid-cols-2 gap-5 items-start">
                    <GastoPorEquipo visibles={visibles} extra={extra} alAbrir={abrir}
                      alElegir={(c) => set({ control: f.control === c ? "" : c })} f={f} />
                    <CorrectivosPorAmbiente visibles={visibles} ticketsIdx={tickets ? ticketsIdx : null} cargando={cargandoTickets}
                      alCargar={() => void cargarCorrectivos()} alBuscar={(u) => { set({ q: u }); irA("equipos"); }} />
                  </div>
                </>
              )}

              {vista === "datos" && (
                <>
                  <DatosPorCompletar visibles={visibles} f={f} alElegir={(c) => { set({ falta: f.falta === c ? "" : c }); irA("equipos"); }} />
                  {esAdmin && <SubirExcel actual={datos} alGuardar={(d) => { setDatos(d); setFuente("app"); setF(VACIO); void cargarExtra(); }} />}

                  <details className={`${TARJETA} text-xs text-ink-soft px-4 py-3`} open>
                    <summary className="cursor-pointer font-medium text-ink">Origen de los datos y repetidos omitidos</summary>
                    <ul className="list-disc pl-5 mt-2 space-y-1">
                      <li>
                        {fuente === "app"
                          ? "Inventario guardado en la app (se edita equipo por equipo o subiendo un Excel)."
                          : "Consolidación inicial de los tres Excel (aún no se ha editado en la app)."}
                      </li>
                      {datos.leidos && (
                        <li>
                          Se leyeron {Object.entries(datos.leidos).map(([k, v]) => `${v} de ${k}`).join(", ")}: un equipo que está en varios
                          archivos cuenta una sola vez (se unen por su código).
                        </li>
                      )}
                      {datos.contable_total > 0 && (
                        <li>
                          Registro contable de aire acondicionado: {datos.contable_total} activos ({datos.contable_baja} de baja). Usa otros
                          códigos, así que no se suma; {datos.contable_enlazados} se enlazaron por N° de serie o código de barra.
                        </li>
                      )}
                      {datos.repetidos?.length > 0 && (
                        <li>
                          {datos.repetidos.length} repetidos omitidos (misma serie, marca y modelo):{" "}
                          {datos.repetidos.map((r) => `${r.codigo}${r.se_conserva ? ` (se conserva ${r.se_conserva})` : ""}`).join(", ")}.
                        </li>
                      )}
                      {datos.fuentes?.length > 0 && <li>Archivos: {datos.fuentes.join(" · ")}.</li>}
                    </ul>
                  </details>
                </>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

const BOTON =
  "border border-line-strong rounded-md px-4 py-2 text-sm font-medium bg-white hover:bg-concrete-dim disabled:opacity-50";
const TARJETA = "bg-white border border-line rounded-lg";

/** Estado de mantenimiento: barra con las 4 partes y sus cantidades (un toque filtra por esa parte). */
function EstadoResumen({ kpi, activo, alElegir }: {
  kpi: { total: number; op: number; obs: number; inop: number; sin: number }; activo: string; alElegir: (s: string) => void;
}) {
  const partes: [string, number][] = [["Operativo", kpi.op], ["Con observación", kpi.obs], ["Inoperativo", kpi.inop], ["Sin informe", kpi.sin]];
  return (
    <div className={`${TARJETA} px-4 py-3 col-span-2 lg:col-span-3`}>
      <span className="block text-[11px] uppercase tracking-wider text-ink-soft">Estado según el último mantenimiento</span>
      <div className="flex h-3 rounded-full overflow-hidden bg-slate-100 mt-2" aria-hidden="true">
        {partes.map(([s, n]) => n > 0 && <span key={s} style={{ width: `${(n / (kpi.total || 1)) * 100}%`, background: RELLENO_ESTADO[s] }} />)}
      </div>
      <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-1">
        {partes.map(([s, n]) => (
          <button key={s} type="button" onClick={() => alElegir(s)}
            className={`text-left rounded-md px-2 py-1 ${activo === s ? "bg-ink text-white" : "hover:bg-slate-50"}`}>
            <span className="flex items-center gap-1.5 text-xs">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: RELLENO_ESTADO[s] }} />
              <span className={activo === s ? "" : "text-ink-soft"}>{s}</span>
            </span>
            <span className="font-display font-bold text-2xl tabular-nums leading-tight">{n.toLocaleString("es-PE")}</span>
            <span className={`text-xs ml-1 ${activo === s ? "text-white/80" : "text-ink-soft"}`}>{kpi.total ? Math.round((n / kpi.total) * 100) : 0}%</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Tarjeta con dos indicadores (riesgo o control); cada uno filtra al tocarlo. */
function Par({ titulo, filas }: {
  titulo: string;
  filas: { texto: string; n: number; total: number; color: string; activo: boolean; alTocar: () => void; nota?: string }[];
}) {
  return (
    <div className={`${TARJETA} px-2 py-2`}>
      <span className="block px-2 text-[11px] uppercase tracking-wider text-ink-soft">{titulo}</span>
      {filas.map((x) => (
        <button key={x.texto} type="button" onClick={x.alTocar} title={x.nota}
          className={`w-full text-left rounded-md px-2 py-1 mt-0.5 flex items-baseline gap-2 ${x.activo ? "bg-ink text-white" : "hover:bg-slate-50"}`}>
          <span className="w-1 self-stretch rounded-full" style={{ background: x.color }} />
          <span className="font-display font-bold text-2xl tabular-nums leading-tight">{x.n.toLocaleString("es-PE")}</span>
          <span className="text-xs leading-tight">
            {x.texto}
            <span className={`block ${x.activo ? "text-white/80" : "text-ink-soft"}`}>{x.total ? Math.round((x.n / x.total) * 100) : 0}%</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function Titulo({ children, nota }: { children: ReactNode; nota?: string }) {
  return (
    <div className="px-4 pt-3 pb-2">
      <h2 className="font-semibold text-sm">{children}</h2>
      {nota && <p className="text-xs text-ink-soft">{nota}</p>}
    </div>
  );
}

/** Barras apiladas: estado de mantenimiento de cada tipo de equipo. */
function EstadoPorTipo({ visibles, alElegir }: { visibles: Equipo[]; alElegir: (t: string) => void }) {
  const filas = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const e of visibles) {
      const t = tipoEquipo(e);
      const r = m.get(t) ?? {};
      r[estadoDe(e)] = (r[estadoDe(e)] ?? 0) + 1;
      m.set(t, r);
    }
    const cat = (t: string) => ORDEN_TIPOS.indexOf(t.split("/")[0]) + 1 || 99;
    return [...m].map(([t, r]) => ({ t, r, n: Object.values(r).reduce((a, b) => a + b, 0) }))
      .sort((a, b) => cat(a.t) - cat(b.t) || b.n - a.n);
  }, [visibles]);
  const max = Math.max(...filas.map((x) => x.n));
  return (
    <section className={TARJETA}>
      <Titulo nota="Toca un tipo para filtrar por él">Estado de mantenimiento por tipo de equipo</Titulo>
      <div className="px-4 pb-3 space-y-1.5">
        {filas.map(({ t, r, n }) => (
          <button key={t} type="button" onClick={() => alElegir(t)} className="w-full flex items-center gap-2 text-xs text-left group">
            <span className="w-44 shrink-0 truncate group-hover:underline" title={t.replace("/", " · ")}>{t.replace("/", " · ")}</span>
            <span className="flex-1 flex h-4 bg-slate-100">
              {Object.keys(RELLENO_ESTADO).map((s) =>
                r[s] ? <span key={s} title={`${s}: ${r[s]}`} style={{ width: `${(r[s] / max) * 100}%`, background: RELLENO_ESTADO[s] }} /> : null
              )}
            </span>
            <span className="w-9 text-right tabular-nums font-medium">{n}</span>
          </button>
        ))}
      </div>
      <Leyenda />
    </section>
  );
}
function Leyenda() {
  return (
    <div className="px-4 pb-3 flex flex-wrap gap-3 text-[11px] text-ink-soft">
      {Object.entries(RELLENO_ESTADO).map(([s, c]) => (
        <span key={s} className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 inline-block" style={{ background: c }} />
          {s}
        </span>
      ))}
    </div>
  );
}

/** Antigüedad: cuántos equipos por periodo de fabricación o ingreso. */
function Antiguedad({ visibles }: { visibles: Equipo[] }) {
  const tramos = [
    { t: "Antes de 2005", d: (a: number) => a < 2005 },
    { t: "2005 – 2009", d: (a: number) => a >= 2005 && a <= 2009 },
    { t: "2010 – 2014", d: (a: number) => a >= 2010 && a <= 2014 },
    { t: "2015 – 2019", d: (a: number) => a >= 2015 && a <= 2019 },
    { t: "2020 en adelante", d: (a: number) => a >= 2020 },
  ];
  const cuenta = tramos.map((x) => visibles.filter((e) => e.anio && x.d(e.anio)).length);
  const sinDato = visibles.filter((e) => !e.anio).length;
  const max = Math.max(1, ...cuenta, sinDato);
  const conAnio = visibles.filter((e) => e.anio);
  const prom = conAnio.length ? Math.round(conAnio.reduce((s, e) => s + (2026 - (e.anio as number)), 0) / conAnio.length) : null;
  return (
    <section className={TARJETA}>
      <Titulo nota={prom !== null ? `Edad promedio: ${prom} años (de ${conAnio.length} equipos con año)` : undefined}>
        Antigüedad (año de fabricación o ingreso)
      </Titulo>
      <div className="px-4 pb-4 flex items-end gap-3 h-44">
        {[...tramos.map((x, i) => ({ t: x.t, n: cuenta[i] })), { t: "Sin dato", n: sinDato }].map(({ t, n }) => (
          <div key={t} className="flex-1 flex flex-col items-center justify-end h-full min-w-0">
            <span className="text-xs tabular-nums font-medium">{n}</span>
            <div className="w-full" style={{ height: `${(n / max) * 100}%`, minHeight: n ? 2 : 0, background: t === "Sin dato" ? "#c3c9d4" : "#4f8fc0" }} />
            <span className="mt-1 text-[10px] text-ink-soft text-center leading-tight">{t}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Mapa: pisos de cada pabellón, con cuántos equipos y cuántos con problemas (color por % con problemas). */
/**
 * Mapa: pisos de cada pabellón, con cuántos equipos y cuántos con problemas (color según la gravedad).
 * A la derecha, el detalle del piso elegido o, si no hay uno, los pisos con más problemas.
 * `base` son los equipos con todos los filtros salvo pabellón y piso (para que el mapa no se reduzca
 * a la casilla elegida).
 */
function Mapa({ base, f, alElegir, alAbrir }: {
  base: Equipo[]; f: Filtros; alElegir: (pab: string, piso: string) => void; alAbrir: (codigo: string) => void;
}) {
  const ordenPiso = (p: string) => {
    const n = Number(/(\d+)/.exec(p)?.[1] ?? 0);
    return p === "Azotea" ? 100 : p.startsWith("Sótano") ? -n : p === "Sin dato" ? -100 : n;
  };
  const pabs = [...new Set(base.map((e) => e.pabellon || "Sin dato"))].sort((a, b) => (a === "Sin dato" ? 1 : b === "Sin dato" ? -1 : a.localeCompare(b)));
  const pisos = [...new Set(base.map((e) => e.piso || "Sin dato"))].sort((a, b) => ordenPiso(b) - ordenPiso(a));
  const de = (pab: string, piso: string) => base.filter((e) => (e.pabellon || "Sin dato") === pab && (e.piso || "Sin dato") === piso);
  const resumen = (es: Equipo[]) => {
    const inop = es.filter((e) => e.estado === "INOPERATIVO").length;
    const obs = es.filter((e) => e.estado === "OPERATIVO CON OBSERVACION").length;
    return { n: es.length, inop, obs, pct: es.length ? (inop * 2 + obs) / (es.length * 2) : 0 };
  };
  const color = (pct: number) => (pct >= 0.6 ? "#f6c7ce" : pct >= 0.35 ? "#fbe0b8" : pct > 0 ? "#fdf1d8" : "#e6f4ec");
  const elegido = f.pabellon && f.piso ? { pab: f.pabellon, piso: f.piso } : null;
  const ranking = pabs
    .flatMap((pab) => pisos.map((piso) => ({ pab, piso, ...resumen(de(pab, piso)) })))
    .filter((c) => c.inop + c.obs > 0)
    .sort((a, b) => b.inop - a.inop || b.pct - a.pct || b.obs - a.obs)
    .slice(0, 8);
  return (
    <section className={TARJETA}>
      <Titulo nota="Cada casilla: equipos · inoperativos (rojo) · con observación (ámbar). Toca una para ver su detalle y filtrar.">
        Mapa por pabellón y piso
      </Titulo>
      <div className="px-4 pb-4 grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-5">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-separate border-spacing-1 table-fixed">
            <thead>
              <tr>
                <th className="w-16" />
                {pabs.map((p) => (
                  <th key={p} className="font-medium text-ink-soft px-2 text-center">{p}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pisos.map((piso) => (
                <tr key={piso}>
                  <td className="pr-2 text-ink-soft whitespace-nowrap">{piso}</td>
                  {pabs.map((pab) => {
                    const c = resumen(de(pab, piso));
                    const sel = elegido?.pab === pab && elegido?.piso === piso;
                    return (
                      <td key={pab} className="p-0">
                        {c.n > 0 ? (
                          <button
                            type="button"
                            onClick={() => alElegir(pab, piso)}
                            className={`w-full min-w-[5rem] h-12 flex flex-col items-center justify-center rounded ${sel ? "ring-2 ring-ink" : "hover:ring-1 hover:ring-ink-soft"}`}
                            style={{ background: color(c.pct) }}
                            title={`${pab} · ${piso}: ${c.n} equipos, ${c.inop} inoperativos, ${c.obs} con observación`}
                          >
                            <span className="font-semibold text-sm tabular-nums">{c.n}</span>
                            <span className="tabular-nums">
                              <span className="text-red-700">{c.inop}</span> · <span className="text-amber-800">{c.obs}</span>
                            </span>
                          </button>
                        ) : (
                          <span className="w-full min-w-[5rem] h-12 block rounded bg-slate-50" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-ink-soft">
            {[["#e6f4ec", "Sin problemas"], ["#fdf1d8", "Pocos"], ["#fbe0b8", "Varios"], ["#f6c7ce", "Muchos (inoperativos)"]].map(([c, t]) => (
              <span key={t} className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: c }} />{t}</span>
            ))}
          </div>
        </div>

        {/* Panel derecho: detalle del piso elegido, o los pisos con más problemas */}
        <div className="border-t lg:border-t-0 lg:border-l border-line pt-4 lg:pt-0 lg:pl-5 min-w-0">
          {elegido ? (
            <DetallePiso es={de(elegido.pab, elegido.piso)} titulo={`${elegido.pab} · ${elegido.piso}`}
              alCerrar={() => alElegir(elegido.pab, elegido.piso)} alAbrir={alAbrir} />
          ) : (
            <>
              <p className="text-sm font-semibold">Pisos con más problemas</p>
              <p className="text-xs text-ink-soft mb-2">Primero los que tienen más inoperativos. Toca uno para ver su detalle.</p>
              {ranking.length === 0 ? (
                <p className="text-sm text-ink-soft">Ningún piso tiene equipos inoperativos o con observación.</p>
              ) : (
                <ol className="space-y-1">
                  {ranking.map((c, i) => (
                    <li key={c.pab + c.piso}>
                      <button type="button" onClick={() => alElegir(c.pab, c.piso)}
                        className="w-full flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-slate-50 text-left">
                        <span className="w-5 text-xs text-ink-soft tabular-nums">{i + 1}</span>
                        <span className="flex-1 min-w-0">
                          <span className="text-sm font-medium">{c.pab} · {c.piso}</span>
                          <span className="flex h-1.5 mt-1 rounded-full overflow-hidden bg-slate-100">
                            <span style={{ width: `${(c.inop / c.n) * 100}%`, background: RELLENO_ESTADO.Inoperativo }} />
                            <span style={{ width: `${(c.obs / c.n) * 100}%`, background: RELLENO_ESTADO["Con observación"] }} />
                          </span>
                        </span>
                        <span className="text-xs tabular-nums text-right whitespace-nowrap">
                          <b className="text-red-700">{c.inop}</b> inop. · <b className="text-amber-800">{c.obs}</b> obs.
                          <span className="block text-ink-soft">de {c.n} equipos</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <p className="text-sm font-semibold mt-5 mb-1">Por pabellón</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-ink-soft border-b border-line">
                    <th className="py-1 font-medium">Pabellón</th>
                    <th className="py-1 font-medium text-right">Equipos</th>
                    <th className="py-1 font-medium text-right">Inop.</th>
                    <th className="py-1 font-medium text-right">Obs.</th>
                    <th className="py-1 font-medium w-1/3 pl-3">Con problemas</th>
                  </tr>
                </thead>
                <tbody>
                  {pabs.map((pab) => {
                    const c = resumen(base.filter((e) => (e.pabellon || "Sin dato") === pab));
                    const pct = c.n ? Math.round(((c.inop + c.obs) / c.n) * 100) : 0;
                    return (
                      <tr key={pab} className="border-b border-line/60 last:border-0">
                        <td className="py-1.5 font-medium">{pab}</td>
                        <td className="py-1.5 text-right tabular-nums">{c.n}</td>
                        <td className="py-1.5 text-right tabular-nums text-red-700">{c.inop}</td>
                        <td className="py-1.5 text-right tabular-nums text-amber-800">{c.obs}</td>
                        <td className="py-1.5 pl-3">
                          <span className="flex items-center gap-2">
                            <span className="flex-1 flex h-1.5 rounded-full overflow-hidden bg-slate-100">
                              <span style={{ width: `${c.n ? (c.inop / c.n) * 100 : 0}%`, background: RELLENO_ESTADO.Inoperativo }} />
                              <span style={{ width: `${c.n ? (c.obs / c.n) * 100 : 0}%`, background: RELLENO_ESTADO["Con observación"] }} />
                            </span>
                            <span className="tabular-nums w-8 text-right">{pct}%</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/** Detalle de un piso: estado, tipos de equipo y los equipos con problemas (un toque abre su ficha). */
function DetallePiso({ es, titulo, alCerrar, alAbrir }: { es: Equipo[]; titulo: string; alCerrar: () => void; alAbrir: (c: string) => void }) {
  const estados = Object.keys(RELLENO_ESTADO).map((s) => [s, es.filter((e) => estadoDe(e) === s).length] as const);
  const tipos = [...es.reduce((m, e) => m.set(tipoTexto(e), (m.get(tipoTexto(e)) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  // Todos los equipos del piso: primero los inoperativos y con observación.
  const lista = [...es].sort((a, b) => (ORD_ESTADO[a.estado] ?? 2) - (ORD_ESTADO[b.estado] ?? 2) || a.ubicacion.localeCompare(b.ubicacion));
  const nProblemas = es.filter((e) => e.estado === "INOPERATIVO" || e.estado === "OPERATIVO CON OBSERVACION").length;
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{titulo}</p>
          <p className="text-xs text-ink-soft">{es.length} equipo(s)</p>
        </div>
        <button type="button" onClick={alCerrar} className="text-xs underline text-ink-soft">Ver todos los pisos</button>
      </div>
      <div className="flex h-2.5 mt-2 rounded-full overflow-hidden bg-slate-100">
        {estados.map(([s, n]) => n > 0 && <span key={s} title={`${s}: ${n}`} style={{ width: `${(n / (es.length || 1)) * 100}%`, background: RELLENO_ESTADO[s] }} />)}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
        {estados.map(([s, n]) => (
          <span key={s} className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: RELLENO_ESTADO[s] }} />{s} <b>{n}</b></span>
        ))}
      </div>
      <p className="text-[11px] uppercase tracking-wider text-ink-soft mt-3 mb-1">Tipos de equipo</p>
      <div className="flex flex-wrap gap-1">
        {tipos.map(([t, n]) => <span key={t} className="text-xs border border-line rounded px-1.5 py-0.5">{t} <b>{n}</b></span>)}
      </div>
      <p className="text-[11px] uppercase tracking-wider text-ink-soft mt-3 mb-1">
        Equipos del piso ({es.length}) · {nProblemas} con problemas, primero
      </p>
      {lista.length === 0 ? (
        <p className="text-xs text-ink-soft">Sin equipos.</p>
      ) : (
        <ul className="max-h-[26rem] overflow-y-auto divide-y divide-line/60">
          {lista.map((e, i) => (
            <li key={(e.codigo || "") + i}>
              <button type="button" disabled={!e.codigo} onClick={() => e.codigo && alAbrir(e.codigo)}
                className="w-full text-left py-1.5 flex items-center gap-2 hover:bg-slate-50 rounded px-1">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: RELLENO_ESTADO[estadoDe(e)] }} />
                <span className="min-w-0 flex-1">
                  <span className="text-xs font-medium">{e.nombre}</span>
                  <span className="text-xs text-ink-soft"> · {e.ubicacion}</span>
                </span>
                <span className="text-[11px] text-ink-soft whitespace-nowrap">{estadoDe(e)}</span>
                <span className="font-mono text-[11px] text-ink-soft w-16 text-right">{e.codigo || "s/c"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CantidadPorTipo({ visibles, alElegir }: { visibles: Equipo[]; alElegir: (t: string) => void }) {
  const pabs = [...new Set(visibles.map((e) => e.pabellon || "Sin dato"))].sort();
  const m = new Map<string, Map<string, number>>();
  for (const e of visibles) {
    const fila = m.get(tipoEquipo(e)) ?? new Map<string, number>();
    fila.set(e.pabellon || "Sin dato", (fila.get(e.pabellon || "Sin dato") ?? 0) + 1);
    m.set(tipoEquipo(e), fila);
  }
  const cat = (t: string) => ORDEN_TIPOS.indexOf(t.split("/")[0]) + 1 || 99;
  const filas = [...m].sort((a, b) => cat(a[0]) - cat(b[0]) || sum(b[1]) - sum(a[1]));
  return (
    <section className={`${TARJETA} overflow-x-auto`}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-soft border-b border-line">
            <th className="px-4 py-2 font-medium">Cantidad por tipo de equipo</th>
            {pabs.map((p) => (
              <th key={p} className="px-3 py-2 font-medium text-right">{p}</th>
            ))}
            <th className="px-4 py-2 font-medium text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {filas.map(([t, f]) => (
            <tr key={t} className="border-b border-line/60 last:border-0">
              <td className="px-4 py-1.5">
                <button type="button" className="hover:underline text-left" onClick={() => alElegir(t)}>{t.replace("/", " · ")}</button>
              </td>
              {pabs.map((p) => (
                <td key={p} className="px-3 py-1.5 text-right tabular-nums">{f.get(p) ?? "—"}</td>
              ))}
              <td className="px-4 py-1.5 text-right tabular-nums font-semibold">{sum(f)}</td>
            </tr>
          ))}
          <tr className="bg-slate-50 font-semibold">
            <td className="px-4 py-1.5">Total</td>
            {pabs.map((p) => (
              <td key={p} className="px-3 py-1.5 text-right tabular-nums">{filas.reduce((s, [, f]) => s + (f.get(p) ?? 0), 0)}</td>
            ))}
            <td className="px-4 py-1.5 text-right tabular-nums">{visibles.length}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

/** Entrada de un número que se guarda al salir del campo (precio, presupuesto, meses). */
function Numero({ valor, alCambiar, editable, ancho = "w-24", paso = 100, prefijo }: {
  valor?: number; alCambiar: (v: number | null) => void; editable: boolean; ancho?: string; paso?: number; prefijo?: string;
}) {
  if (!editable) return <span className="tabular-nums">{valor ? `${prefijo ?? ""}${valor.toLocaleString("es-PE")}` : "—"}</span>;
  return (
    <input type="number" min={0} step={paso} defaultValue={valor ?? ""} key={valor ?? "x"}
      onBlur={(e) => {
        const n = Number(e.target.value.replace(",", "."));
        const v = e.target.value.trim() && n > 0 ? n : null;
        if (v !== (valor ?? null)) alCambiar(v);
      }}
      className={`${ancho} border border-line-strong rounded px-1 py-0.5 text-right`} placeholder={prefijo ?? ""} />
  );
}
const conValor = (o: Record<string, number> | undefined, k: string, v: number | null) => {
  const n = { ...(o ?? {}) };
  if (v === null) delete n[k];
  else n[k] = v;
  return n;
};

/** Prioridad de reemplazo, con costo estimado según un precio de referencia por tipo (compartido). */
function Prioridad({ visibles, extra, editable, alGuardarPrecios, alAbrir }: {
  visibles: Equipo[]; extra: Extra; editable: boolean; alGuardarPrecios: (v: Record<string, number>) => void; alAbrir: (codigo: string) => void;
}) {
  const [ver, setVer] = useState(15);
  const precios = extra.config.precios ?? {};
  const fallas = (e: Equipo) => extra.fallas[e.codigo] ?? 0;
  const lista: Equipo[] = useMemo(
    () => visibles.filter((e) => e.estado === "INOPERATIVO" || reemplazo(e) || fallas(e) >= 2)
      .sort((a, b) => prioridad(b, fallas(b)) - prioridad(a, fallas(a))),
    [visibles, extra] // eslint-disable-line react-hooks/exhaustive-deps
  );
  if (lista.length === 0) return null;
  const tipos = [...new Set(lista.map(tipoEquipo))].sort();
  const costo = lista.reduce((s, e) => s + (precios[tipoEquipo(e)] ?? 0), 0);
  const sinPrecio = lista.filter((e) => !precios[tipoEquipo(e)]).length;
  return (
    <details className={TARJETA} open>
      <summary className="cursor-pointer list-none">
        <Titulo nota="Inoperativos, con reemplazo recomendado o con 2+ fallas registradas; por puntaje: fallas, inoperativo, recomienda reemplazo, observación y meses pasado de su vida útil.">
          Prioridad de reemplazo · {lista.length} equipo(s)
          {costo > 0 && <span className="font-normal text-ink-soft"> · costo estimado {formatoSoles(costo, 0)}{sinPrecio ? ` (falta precio de ${sinPrecio})` : ""}</span>}
        </Titulo>
      </summary>
      <div className="px-4 pb-3">
        <p className="text-xs text-ink-soft mb-1">
          Precio de referencia por equipo (S/, sin IGV){editable ? " — lo usan todos y el plan por años:" : ":"}
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {tipos.map((t) => (
            <label key={t} className="flex items-center gap-1 text-xs border border-line rounded px-2 py-1">
              <span>{t.replace("/", " · ")}</span>
              <Numero valor={precios[t]} editable={editable} prefijo="S/ " alCambiar={(v) => alGuardarPrecios(conValor(precios, t, v))} />
            </label>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-soft border-b border-line">
                <th className="py-1.5 pr-2 font-medium">#</th>
                <th className="py-1.5 pr-2 font-medium">Equipo</th>
                <th className="py-1.5 pr-2 font-medium">Por qué</th>
                <th className="py-1.5 pr-2 font-medium text-right">Puntaje</th>
                <th className="py-1.5 font-medium text-right">Costo ref.</th>
              </tr>
            </thead>
            <tbody>
              {lista.slice(0, ver).map((e, i) => (
                <tr key={(e.codigo || "") + i} className="border-b border-line/60 last:border-0 align-top">
                  <td className="py-1.5 pr-2 tabular-nums text-ink-soft">{i + 1}</td>
                  <td className="py-1.5 pr-2">
                    <button type="button" className="text-left hover:underline" onClick={() => e.codigo && alAbrir(e.codigo)}>
                      <span className="font-mono text-xs text-ink-soft">{e.codigo || "sin código"}</span> {e.nombre}
                    </button>
                    <span className="block text-xs text-ink-soft">{[e.pabellon, e.piso, e.ubicacion].filter(Boolean).join(" · ")}</span>
                  </td>
                  <td className="py-1.5 pr-2 text-xs">{razones(e, fallas(e))}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums font-semibold">{prioridad(e, fallas(e))}</td>
                  <td className="py-1.5 text-right tabular-nums text-xs">{precios[tipoEquipo(e)] ? formatoSoles(precios[tipoEquipo(e)], 0) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {lista.length > ver && (
          <button type="button" onClick={() => setVer(lista.length)} className="mt-2 text-xs underline">Ver los {lista.length}</button>
        )}
      </div>
    </details>
  );
}

/** Plan de reemplazo por años: reparte la lista de prioridad según el presupuesto de cada año. */
function PlanPorAnios({ visibles, extra, editable, alGuardar, alAbrir }: {
  visibles: Equipo[]; extra: Extra; editable: boolean; alGuardar: (v: Record<string, number>) => void; alAbrir: (codigo: string) => void;
}) {
  const precios = extra.config.precios ?? {};
  const presupuesto = extra.config.presupuesto ?? {};
  const base = Number(hoyISO().slice(0, 4));
  const anios = [base + 1, base + 2, base + 3].map(String);
  const fallas = (e: Equipo) => extra.fallas[e.codigo] ?? 0;
  const candidatos = visibles
    .filter((e) => e.estado === "INOPERATIVO" || reemplazo(e) || fallas(e) >= 2 || (e.meses_excedidos ?? 0) > 0)
    .sort((a, b) => prioridad(b, fallas(b)) - prioridad(a, fallas(a)));
  const conPrecio = candidatos.filter((e) => precios[tipoEquipo(e)]);
  // Reparto: en orden de prioridad, cada equipo va al primer año con presupuesto suficiente.
  const plan = anios.map((a) => ({ anio: a, tope: presupuesto[a] ?? 0, usado: 0, equipos: [] as Equipo[] }));
  const fuera: Equipo[] = [];
  for (const e of conPrecio) {
    const c = precios[tipoEquipo(e)];
    const p = plan.find((x) => x.tope - x.usado >= c);
    if (p) {
      p.usado += c;
      p.equipos.push(e);
    } else fuera.push(e);
  }
  const [abierto, setAbierto] = useState<string | null>(null);
  return (
    <section className={TARJETA}>
      <Titulo nota="Reparte los equipos en orden de prioridad (inoperativos, reemplazo recomendado, fallas y vida útil superada) según el presupuesto de cada año y el precio de referencia de su tipo.">
        Plan de reemplazo por años
      </Titulo>
      <div className="px-4 pb-3">
        {Object.keys(precios).length === 0 ? (
          <p className="text-sm text-ink-soft">Primero pon un precio de referencia por tipo en «Prioridad de reemplazo».</p>
        ) : (
          <>
            <div className="grid sm:grid-cols-3 gap-3">
              {plan.map((p) => (
                <div key={p.anio} className="border border-line rounded p-3">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <b>{p.anio}</b>
                    <label className="text-xs flex items-center gap-1">
                      Presupuesto
                      <Numero valor={presupuesto[p.anio]} editable={editable} ancho="w-28" paso={1000} prefijo="S/ "
                        alCambiar={(v) => alGuardar(conValor(presupuesto, p.anio, v))} />
                    </label>
                  </div>
                  <p className="mt-2 text-2xl font-display font-bold tabular-nums">{p.equipos.length} <span className="text-sm font-normal text-ink-soft">equipo(s)</span></p>
                  <p className="text-xs text-ink-soft">{formatoSoles(p.usado, 0)} de {formatoSoles(p.tope, 0)}{p.tope ? ` · queda ${formatoSoles(p.tope - p.usado, 0)}` : ""}</p>
                  {p.equipos.length > 0 && (
                    <button type="button" className="mt-1 text-xs underline" onClick={() => setAbierto(abierto === p.anio ? null : p.anio)}>
                      {abierto === p.anio ? "Ocultar" : "Ver equipos"}
                    </button>
                  )}
                  {abierto === p.anio && (
                    <ul className="mt-1 text-xs space-y-0.5 max-h-48 overflow-y-auto">
                      {p.equipos.map((e, i) => (
                        <li key={(e.codigo || "") + i}>
                          <button type="button" className="hover:underline text-left" onClick={() => e.codigo && alAbrir(e.codigo)}>
                            {e.codigo || "s/c"} · {e.nombre} · {e.ubicacion}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-soft">
              {fuera.length > 0 && `${fuera.length} equipo(s) no entran en los 3 años con estos presupuestos. `}
              {candidatos.length - conPrecio.length > 0 && `${candidatos.length - conPrecio.length} sin precio de referencia para su tipo.`}
            </p>
          </>
        )}
      </div>
    </section>
  );
}

/** Mantenimiento preventivo: último registrado + frecuencia por categoría → vencidos y próximos. */
function Preventivo({ visibles, extra, f, editable, alElegir, alGuardar, alVer }: {
  visibles: Equipo[]; extra: Extra; f: Filtros; editable: boolean; alElegir: (c: string) => void; alGuardar: (v: Record<string, number>) => void;
  alVer: () => void;
}) {
  const ESTADOS_M = ["Vencido", "Próximo", "Al día", "Sin registro"] as const;
  const cuenta: Record<string, number> = { Vencido: 0, Próximo: 0, "Al día": 0, "Sin registro": 0 };
  const porCat = new Map<string, Record<string, number>>();
  for (const e of visibles) {
    const m = mantDe(e, extra);
    cuenta[m.estado]++;
    const fila = porCat.get(m.cat) ?? { Vencido: 0, Próximo: 0, "Al día": 0, "Sin registro": 0 };
    fila[m.estado]++;
    porCat.set(m.cat, fila);
  }
  const cats = [...new Set(visibles.map((e) => tipoEquipo(e).split("/")[0]))].sort(
    (a, b) => (ORDEN_TIPOS.indexOf(a) + 1 || 99) - (ORDEN_TIPOS.indexOf(b) + 1 || 99)
  );
  const frec = extra.config.frecuencias ?? {};
  const color: Record<string, string> = { Vencido: "#d0112d", Próximo: "#e0a33a", "Al día": "#1f8a64", "Sin registro": "#8a8f9c" };
  return (
    <section className={TARJETA}>
      <Titulo nota={`Último mantenimiento: el registrado en la app o, si no hay, el informe del Excel (nov-2025). Toca un estado para ver esos equipos.`}>
        Mantenimiento preventivo
      </Titulo>
      <div className="px-4 pb-3">
        <div className="flex flex-wrap gap-2">
          {Object.entries(cuenta).map(([k, n]) => (
            <button key={k} type="button" onClick={() => alElegir(k === "Al día" ? "" : `mant:${k}`)} disabled={k === "Al día"}
              className={`text-xs border rounded-full px-3 py-1 ${f.control === `mant:${k}` ? "bg-ink text-white border-ink" : "border-line hover:bg-slate-50"}`}>
              <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: color[k] }} />
              {k === "Próximo" ? "Próximos 30 días" : k} <b className="tabular-nums">{n}</b>
            </button>
          ))}
          {f.control.startsWith("mant:") && (
            <button type="button" onClick={alVer} className="text-xs underline font-medium ml-1">Ver estos equipos →</button>
          )}
        </div>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-soft border-b border-line">
                <th className="py-1.5 font-medium">Categoría</th>
                <th className="py-1.5 font-medium text-right">Cada</th>
                {ESTADOS_M.map((k) => <th key={k} className="py-1.5 font-medium text-right">{k === "Próximo" ? "Próx. 30 días" : k}</th>)}
              </tr>
            </thead>
            <tbody>
              {cats.map((c) => (
                <tr key={c} className="border-b border-line/60 last:border-0">
                  <td className="py-1.5">{c}</td>
                  <td className="py-1.5 text-right">
                    <Numero valor={frec[c] ?? FRECUENCIA_SUGERIDA[c] ?? 6} editable={editable} ancho="w-14" paso={1}
                      alCambiar={(v) => alGuardar(conValor(frec, c, v))} /> <span className="text-xs text-ink-soft">meses</span>
                  </td>
                  {ESTADOS_M.map((k) => (
                    <td key={k} className={`py-1.5 text-right tabular-nums ${k === "Vencido" && porCat.get(c)?.[k] ? "text-danger font-semibold" : ""}`}>
                      {porCat.get(c)?.[k] || "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-soft mt-2">
          Frecuencias sugeridas{editable ? ": cámbialas en la columna «Cada» según tu contrato (se guardan para todos)" : ""}.
        </p>
      </div>
    </section>
  );
}

/** Evolución mensual de los KPI (una foto por mes, desde que el inventario está en la app). */
function Evolucion({ filas }: { filas: Extra["evolucion"] }) {
  if (filas.length === 0) return null;
  const max = Math.max(...filas.map((x) => Number(x.datos.total) || 0), 1);
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const partes: [string, string][] = [["operativos", "Operativo"], ["observacion", "Con observación"], ["inoperativos", "Inoperativo"], ["sin_informe", "Sin informe"]];
  return (
    <section className={TARJETA}>
      <Titulo nota={filas.length === 1 ? "Se guarda una foto por mes: desde el próximo mes se verá la tendencia." : "Una foto por mes (la última de cada mes)."}>
        Evolución del inventario
      </Titulo>
      <div className="px-4 pb-3 flex items-end gap-3 h-48 overflow-x-auto">
        {filas.map(({ mes, datos: d }) => (
          <div key={mes} className="flex flex-col items-center justify-end h-full min-w-14">
            <span className="text-[10px] text-ink-soft tabular-nums">{d.inoperativos ?? 0} inop.</span>
            <div className="w-10 flex flex-col-reverse" style={{ height: `${((Number(d.total) || 0) / max) * 100}%` }}>
              {partes.map(([k, s]) => (
                <div key={k} title={`${s}: ${d[k] ?? 0}`} style={{ height: `${((Number(d[k]) || 0) / (Number(d.total) || 1)) * 100}%`, background: RELLENO_ESTADO[s] }} />
              ))}
            </div>
            <span className="mt-1 text-[10px] text-ink-soft">{MESES[Number(mes.slice(5, 7)) - 1]} {mes.slice(2, 4)}</span>
          </div>
        ))}
      </div>
      <Leyenda />
    </section>
  );
}

/** Gasto en correctivos por equipo (tickets enlazados al equipo exacto) y fallas registradas. */
function GastoPorEquipo({ visibles, extra, f, alAbrir, alElegir }: {
  visibles: Equipo[]; extra: Extra; f: Filtros; alAbrir: (c: string) => void; alElegir: (c: string) => void;
}) {
  const precios = extra.config.precios ?? {};
  const filas = visibles
    .filter((e) => extra.tickets[e.codigo])
    .map((e) => ({ e, ...extra.tickets[e.codigo], precio: precios[tipoEquipo(e)] ?? 0 }))
    .sort((a, b) => b.monto - a.monto)
    .slice(0, 15);
  const conFallas = visibles.filter((e) => (extra.fallas[e.codigo] ?? 0) >= 2).length;
  return (
    <section className={TARJETA}>
      <Titulo nota="Tickets enlazados al equipo exacto (en cada ticket: «Equipo del inventario»). Si lo gastado en correctivos pasa la mitad del precio de reemplazo, conviene evaluar reemplazarlo.">
        Gasto en correctivos por equipo
      </Titulo>
      <div className="px-4 pb-3">
        <div className="flex flex-wrap gap-2 mb-2">
          <button type="button" onClick={() => alElegir("con_tickets")}
            className={`text-xs border rounded-full px-3 py-1 ${f.control === "con_tickets" ? "bg-ink text-white border-ink" : "border-line hover:bg-slate-50"}`}>
            Con correctivos enlazados <b>{visibles.filter((e) => extra.tickets[e.codigo]).length}</b>
          </button>
          <button type="button" onClick={() => alElegir("fallas")}
            className={`text-xs border rounded-full px-3 py-1 ${f.control === "fallas" ? "bg-ink text-white border-ink" : "border-line hover:bg-slate-50"}`}>
            Con fallas registradas <b>{visibles.filter((e) => (extra.fallas[e.codigo] ?? 0) > 0).length}</b>
            {conFallas > 0 && <span> (2 o más: {conFallas})</span>}
          </button>
        </div>
        {filas.length === 0 ? (
          <p className="text-sm text-ink-soft">Aún no hay tickets enlazados a equipos de esta lista.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-soft border-b border-line">
                <th className="py-1.5 font-medium">Equipo</th>
                <th className="py-1.5 font-medium text-right">Correctivos</th>
                <th className="py-1.5 font-medium text-right">Gastado</th>
                <th className="py-1.5 font-medium text-right">vs. reemplazo</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(({ e, n, monto, precio }) => {
                const pct = precio ? Math.round((monto / precio) * 100) : null;
                return (
                  <tr key={e.codigo} className="border-b border-line/60 last:border-0">
                    <td className="py-1.5">
                      <button type="button" className="hover:underline text-left" onClick={() => alAbrir(e.codigo)}>
                        <span className="font-mono text-xs text-ink-soft">{e.codigo}</span> {e.nombre} · {e.ubicacion}
                      </button>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{n}</td>
                    <td className="py-1.5 text-right tabular-nums font-semibold">{formatoSoles(monto, 0)}</td>
                    <td className={`py-1.5 text-right tabular-nums ${pct !== null && pct >= 50 ? "text-danger font-semibold" : "text-ink-soft"}`}>
                      {pct === null ? "—" : `${pct}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function DatosPorCompletar({ visibles, f, alElegir }: { visibles: Equipo[]; f: Filtros; alElegir: (clave: string) => void }) {
  const filas = FALTANTES.map((x) => ({ ...x, n: visibles.filter(x.falta).length })).filter((x) => x.n > 0);
  if (filas.length === 0) return null;
  return (
    <section className={TARJETA}>
      <Titulo nota="Para pedirlos en la próxima visita de mantenimiento. Toca uno para ver esos equipos.">Datos por completar</Titulo>
      <div className="px-4 pb-3 flex flex-wrap gap-2">
        {filas.map((x) => (
          <button key={x.clave} type="button" onClick={() => alElegir(x.clave)}
            className={`text-xs border rounded-full px-3 py-1 ${f.falta === x.clave ? "bg-ink text-white border-ink" : "border-line hover:bg-slate-50"}`}>
            {x.texto} <b className="tabular-nums">{x.n}</b>
          </button>
        ))}
      </div>
    </section>
  );
}

type IdxTicket = { t: Ticket; codigos: Set<string>; texto: string; pab: string };
function CorrectivosPorAmbiente({ visibles, ticketsIdx, cargando, alCargar, alBuscar }: {
  visibles: Equipo[]; ticketsIdx: IdxTicket[] | null; cargando: boolean; alCargar: () => void; alBuscar: (u: string) => void;
}) {
  const ranking = useMemo(() => {
    if (!ticketsIdx) return [];
    const m = new Map<string, { ubic: string; equipos: number; tickets: Map<number, Ticket> }>();
    for (const e of visibles) {
      const ts = correctivosDe(e, ticketsIdx);
      if (ts.length === 0) continue;
      // Un mismo ambiente escrito de varias formas ("AULA 408 (LAB…) N° 01", "AULA 408 ( LAB…)") se agrupa por su código.
      const amb = claveAmbiente(e);
      const k = amb.codigos.size ? [...amb.codigos].sort().join(" / ") : `${e.pabellon ?? ""} · ${e.ubicacion}`;
      const r = m.get(k) ?? { ubic: amb.codigos.size ? `${e.pabellon ?? ""} · ${e.ubicacion}` : e.ubicacion, equipos: 0, tickets: new Map<number, Ticket>() };
      r.equipos++;
      ts.forEach((t) => r.tickets.set(t.id, t));
      m.set(k, r);
    }
    return [...m].map(([k, r]) => ({ k: /^[AB]\d{3}/.test(k) ? `${k} · ${r.ubic.split(" · ").slice(1).join(" · ")}` : k, ubic: r.ubic.split(" · ").pop() ?? r.ubic, equipos: r.equipos, n: r.tickets.size,
      monto: [...r.tickets.values()].reduce((s, t) => s + (Number(t.monto) || 0), 0) }))
      .sort((a, b) => b.n - a.n || b.monto - a.monto).slice(0, 12);
  }, [visibles, ticketsIdx]);
  return (
    <section className={TARJETA}>
      <Titulo nota="Cruce aproximado por ubicación (código de aula como A617 o nombre del ambiente): los tickets no traen el código del equipo.">
        Ambientes con más correctivos
      </Titulo>
      <div className="px-4 pb-3">
        {!ticketsIdx ? (
          <button type="button" onClick={alCargar} disabled={cargando} className={BOTON}>
            {cargando ? "Cargando correctivos…" : "Cruzar con los correctivos"}
          </button>
        ) : ranking.length === 0 ? (
          <p className="text-sm text-ink-soft">Ningún ambiente de estos equipos aparece en los correctivos.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-soft border-b border-line">
                <th className="py-1.5 font-medium">Ambiente</th>
                <th className="py-1.5 font-medium text-right">Equipos</th>
                <th className="py-1.5 font-medium text-right">Correctivos</th>
                <th className="py-1.5 font-medium text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((r) => (
                <tr key={r.k} className="border-b border-line/60 last:border-0">
                  <td className="py-1.5"><button type="button" className="hover:underline text-left" onClick={() => alBuscar(r.ubic)}>{r.k}</button></td>
                  <td className="py-1.5 text-right tabular-nums">{r.equipos}</td>
                  <td className="py-1.5 text-right tabular-nums font-semibold">{r.n}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatoSoles(r.monto, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

type Bitacora = { id: number; tipo: string; detalle: Record<string, string | null>; usuario: string | null; creado_en: string };
type TicketExacto = { id: number; refer: number | null; descripcion: string; estado: string; monto: number | null };

function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-ink border-b border-line pb-1 mb-2">{titulo}</p>
      {Children.toArray(children).length ? <dl className="space-y-1.5">{children}</dl> : <p className="text-xs text-ink-soft">Sin datos en el inventario.</p>}
    </div>
  );
}

function Detalle({ e, esAdmin, extra, alVerificar, tickets, cargando, alCargarTickets, alGuardar }: {
  e: Equipo;
  esAdmin: boolean;
  extra: Extra;
  alVerificar: (fechaIso: string) => void;
  tickets: Ticket[] | null;
  cargando: boolean;
  alCargarTickets: () => void;
  alGuardar: (cambios: Record<string, string>) => Promise<string>;
}) {
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState({ estado: estadoDe(e), informe: e.informe ?? "", alerta: e.alerta ?? "", observaciones: e.observaciones ?? "", fecha: "" });
  const [bitacora, setBitacora] = useState<Bitacora[] | null>(null);
  const [exactos, setExactos] = useState<TicketExacto[] | null>(null);
  const [nota, setNota] = useState("");
  const mant = mantDe(e, extra);
  const verificado = extra.verificado[e.codigo];
  // Bitácora y correctivos enlazados del equipo (solo los que tienen código).
  useEffect(() => {
    if (!e.codigo) return;
    const c = encodeURIComponent(e.codigo);
    fetch(`/api/inventario?bitacora=${c}`).then((r) => (r.ok ? r.json() : { data: [] })).then((d) => setBitacora(d.data ?? [])).catch(() => setBitacora([]));
    fetch(`/api/inventario?tickets=${c}`).then((r) => (r.ok ? r.json() : { data: [] })).then((d) => setExactos(d.data ?? [])).catch(() => setExactos([]));
  }, [e.codigo, e.editado_en, verificado]);
  async function verificar() {
    setMsg("");
    const r = await fetch("/api/inventario?accion=verificar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo: e.codigo, nota }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setMsg(d.error || "No se pudo registrar");
    setNota("");
    setMsg("✓ Verificado hoy");
    alVerificar(new Date().toISOString());
  }
  const [msg, setMsg] = useState("");
  const [guardando, setGuardando] = useState(false);
  const campo = (t: string, v: string | number | null | undefined) =>
    v === null || v === undefined || v === "" ? null : (
      <div>
        <dt className="text-[11px] uppercase tracking-wider text-ink-soft">{t}</dt>
        <dd className="text-sm">{v}</dd>
      </div>
    );
  const url = typeof window !== "undefined" && e.codigo ? `${window.location.origin}/inventario?equipo=${encodeURIComponent(e.codigo)}` : "";
  async function guardar() {
    setGuardando(true);
    setMsg("");
    const cambios: Record<string, string> = { estado: ESTADO_CODIGO[form.estado] ?? "", informe: form.informe, alerta: form.alerta, observaciones: form.observaciones };
    if (form.fecha) cambios.ultimo_mant = form.fecha;
    const r = await alGuardar(cambios);
    setGuardando(false);
    if (r) setMsg(r);
    else {
      setMsg("✓ Guardado");
      setEditando(false);
    }
  }
  return (
    <div className="px-4 pb-4 pt-1 bg-slate-50/60">
      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-[260px] grid sm:grid-cols-3 gap-4">
          <Bloque titulo="Identificación">
            {campo("Tipo / subtipo", [e.tipo, e.subtipo].filter(Boolean).join(" / "))}
            {campo("Marca y modelo", [e.marca, e.modelo].filter(Boolean).join(" "))}
            {campo("N° de serie", e.serie)}
            {campo("Capacidad", e.capacidad)}
            {campo("Registro contable", e.cod_contable ? `${e.cod_contable}${e.estado_contable ? ` · ${e.estado_contable}` : ""}` : null)}
            {campo("Precio y fecha de ingreso", e.precio ? `${formatoSoles(e.precio)}${e.fecha_ingreso ? ` · ${fecha(e.fecha_ingreso)}` : ""}` : null)}
            {campo("OC de compra", e.oc)}
          </Bloque>
          <Bloque titulo="Estado y vida útil">
            {campo("Informe de mantenimiento", e.informe)}
            {campo("Alerta", e.alerta)}
            {campo("Año", e.anio ? `${e.anio}${e.base_anio ? ` (${e.base_anio})` : ""}${e.confianza ? ` · confianza ${e.confianza.toLowerCase()}` : ""}` : null)}
            {campo("Vida útil y uso", e.vida_util ? `${e.vida_util} meses · ${e.meses_uso ?? "—"} de uso${(e.meses_excedidos ?? 0) > 0 ? ` · ${e.meses_excedidos} excedidos` : ""}` : null)}
            {campo("Prioridad de reemplazo", prioridad(e, extra.fallas[e.codigo] ?? 0) || null)}
          </Bloque>
          <Bloque titulo="Mantenimiento y control">
            {campo("Último mantenimiento", mant.ultimo ? `${fecha(mant.ultimo)}${mant.ultimo === FECHA_INFORME_EXCEL ? " (informe del Excel)" : ""}` : "Sin registro")}
            {campo("Próximo", mant.proximo ? `${fecha(mant.proximo)} · ${mant.estado} (cada ${mant.frec} meses)` : null)}
            {campo("Verificado en campo", verificado ? fecha(verificado) : "Nunca")}
            {campo("Fallas registradas", extra.fallas[e.codigo] || null)}
            {campo("Correctivos enlazados", extra.tickets[e.codigo] ? `${extra.tickets[e.codigo].n} · ${formatoSoles(extra.tickets[e.codigo].monto, 0)}` : null)}
            {campo("Última edición", e.editado_por ? `${e.editado_por} · ${fecha(e.editado_en)}` : null)}
            {campo("Fuentes", e.fuentes.join(", "))}
          </Bloque>
        </div>
        {url && (
          <div className="text-center">
            <div className="bg-white border border-line p-1 inline-block" dangerouslySetInnerHTML={{ __html: qrSvg(url, 112) }} />
            <p className="text-[10px] text-ink-soft">QR de la ficha</p>
          </div>
        )}
      </div>
      {e.observaciones && e.observaciones !== "Sin observaciones (NA)" && !editando && (
        <div className="mt-3">
          <p className="text-[11px] uppercase tracking-wider text-ink-soft">Observaciones del mantenimiento</p>
          <p className="text-sm whitespace-pre-line">{e.observaciones}</p>
        </div>
      )}

      <div className="mt-4 grid lg:grid-cols-2 gap-x-6 gap-y-3">
        <div className="min-w-0">
      {/* Fotos de la placa (serie, marca, modelo) */}
      {e.codigo && (
        <div className="mt-3">
          <p className="text-[11px] uppercase tracking-wider text-ink-soft mb-1">Fotos de la placa</p>
          <FotosMaterial clave={`equipo:${e.codigo}`} descripcion={[e.marca, e.modelo, e.nombre].filter(Boolean).join(" ")} editable={esAdmin} />
        </div>
      )}

      {/* Correctivos enlazados a este equipo (exactos) */}
      {exactos && exactos.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] uppercase tracking-wider text-ink-soft">Correctivos de este equipo</p>
          <ul className="text-sm">
            {exactos.map((t) => (
              <li key={t.id}>
                <a href={`/correctivos/${t.id}`} className="hover:underline">
                  <span className="font-mono text-xs text-ink-soft">Ref {t.refer ?? "—"}</span> {t.descripcion?.slice(0, 90)}
                </a>
                <span className="text-xs text-ink-soft"> · {t.estado}{t.monto ? ` · ${formatoSoles(Number(t.monto), 0)}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Correctivos del mismo ambiente */}
      <div className="mt-3">
        <p className="text-[11px] uppercase tracking-wider text-ink-soft">Correctivos del mismo ambiente (aproximado)</p>
        {!tickets ? (
          <button type="button" onClick={alCargarTickets} disabled={cargando} className="text-xs underline">
            {cargando ? "Cargando…" : "Ver correctivos de este ambiente"}
          </button>
        ) : tickets.length === 0 ? (
          <p className="text-xs text-ink-soft">No se encontraron correctivos de este ambiente.</p>
        ) : (
          <ul className="text-sm">
            {tickets.slice(0, 10).map((t) => (
              <li key={t.id}>
                <a href={`/correctivos/${t.id}`} className="hover:underline">
                  <span className="font-mono text-xs text-ink-soft">Ref {t.refer ?? "—"}</span> {t.descripcion?.slice(0, 90)}
                </a>
                <span className="text-xs text-ink-soft"> · {t.estado}{t.monto ? ` · ${formatoSoles(Number(t.monto), 0)}` : ""}</span>
              </li>
            ))}
            {tickets.length > 10 && <li className="text-xs text-ink-soft">…y {tickets.length - 10} más</li>}
          </ul>
        )}
      </div>

        </div>
        <div className="min-w-0">
      {/* Bitácora del equipo */}
      {bitacora && bitacora.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] uppercase tracking-wider text-ink-soft">Bitácora</p>
          <ol className="text-xs border-l-2 border-line pl-3 space-y-1">
            {bitacora.slice(0, 20).map((b) => (
              <li key={b.id}>
                <b>{fecha(b.creado_en)}</b> · {b.usuario ?? "—"} ·{" "}
                {b.tipo === "verificacion"
                  ? `Verificado en campo${b.detalle?.nota ? ` (${b.detalle.nota})` : ""}`
                  : b.tipo === "mantenimiento"
                    ? `Mantenimiento del ${fecha(b.detalle?.fecha)}${b.detalle?.informe ? ` · ${b.detalle.informe}` : ""}`
                    : b.detalle?.despues !== null && b.detalle?.despues !== undefined
                      ? `Estado: ${ESTADOS[b.detalle.antes ?? ""] ?? b.detalle.antes} → ${ESTADOS[b.detalle.despues] ?? b.detalle.despues}`
                      : "Observaciones actualizadas"}
              </li>
            ))}
          </ol>
        </div>
      )}

        </div>
      </div>
      {/* Verificación en campo (administradores) */}
      {esAdmin && e.codigo && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={nota} onChange={(x) => setNota(x.target.value)} placeholder="Nota (opcional): placa legible, ubicación correcta…"
            className="flex-1 min-w-[200px] border border-line-strong rounded px-2 py-1 text-sm" />
          <button type="button" onClick={() => void verificar()} className="border border-line-strong rounded-md px-3 py-1 text-sm font-medium bg-white">
            ✓ Verificado hoy
          </button>
        </div>
      )}

      {/* Edición tras el mantenimiento (administradores, equipos con código) */}
      {esAdmin && e.codigo && (
        <div className="mt-3">
          {!editando ? (
            <button type="button" onClick={() => setEditando(true)} className="text-xs underline">Actualizar estado tras el mantenimiento</button>
          ) : (
            <div className="grid sm:grid-cols-4 gap-2 bg-white border border-line p-3">
              <label className="text-xs">Estado
                <select value={form.estado} onChange={(x) => setForm({ ...form, estado: x.target.value })} className="mt-0.5 w-full border border-line-strong rounded px-2 py-1.5 text-sm">
                  {Object.values(ESTADOS).map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label className="text-xs">Informe de mantenimiento
                <input value={form.informe} onChange={(x) => setForm({ ...form, informe: x.target.value })} className="mt-0.5 w-full border border-line-strong rounded px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs">Fecha del mantenimiento (si se hizo)
                <input type="date" value={form.fecha} max={hoyISO()} onChange={(x) => setForm({ ...form, fecha: x.target.value })} className="mt-0.5 w-full border border-line-strong rounded px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs">Alerta (p. ej. "Recomienda reemplazo")
                <input value={form.alerta} onChange={(x) => setForm({ ...form, alerta: x.target.value })} className="mt-0.5 w-full border border-line-strong rounded px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs sm:col-span-4">Observaciones
                <textarea value={form.observaciones} onChange={(x) => setForm({ ...form, observaciones: x.target.value })} rows={3} className="mt-0.5 w-full border border-line-strong rounded px-2 py-1.5 text-sm" />
              </label>
              <div className="sm:col-span-4 flex items-center gap-3">
                <button type="button" onClick={() => void guardar()} disabled={guardando} className="bg-amber text-white rounded-md px-4 py-1.5 text-sm font-medium disabled:opacity-50">
                  {guardando ? "Guardando…" : "Guardar"}
                </button>
                <button type="button" onClick={() => setEditando(false)} className="text-sm underline">Cancelar</button>
              </div>
            </div>
          )}
          {msg && <p className={`text-xs mt-1 ${msg.startsWith("✓") ? "text-emerald-700" : "text-danger"}`}>{msg}</p>}
        </div>
      )}
    </div>
  );
}

const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
const fecha = (iso?: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};
