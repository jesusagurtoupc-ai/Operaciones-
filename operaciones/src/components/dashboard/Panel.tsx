"use client";

import { useEffect, useState } from "react";
import { useMe } from "@/lib/client";
import TopNav, { CONTENEDOR, EncabezadoPagina, CambiarContrasena } from "@/components/layout/TopNav";
import dynamic from "next/dynamic";
import { DIAS_ATRASO, TODOS_LOS_CAMPUS } from "@/lib/shared";
import { formatoSoles, formatoFecha } from "@/lib/shared";
import Link from "next/link";

/* ───── Tipos del panel (los usa también la página del servidor) ───── */
export interface Agg {
  label: string;
  cantidad: number;
  monto: number;
}

export interface DashboardData {
  porEstado: Agg[];
  porTipo: Agg[];
  porArea: Agg[];
  porMes: Agg[];
  porProveedor: Agg[];
  totales: {
    total_tickets: number;
    monto_total: number;
    finalizados: number;
    pendientes: number;
    atrasados: number;
  };
  /** Solo para administradores: espacio que ocupa la base de datos (los adjuntos van dentro). */
  almacenamiento?: {
    baseBytes: number;
    archivosBytes: number;
    archivos: number;
    limiteBytes: number;
    /** Adjuntos ya guardados en Vercel Blob (fuera de la base). */
    blobBytes?: number;
    archivosBlob?: number;
    blobConectado?: boolean;
  } | null;
  /** Panel de proveedores (null si no se pudo calcular). */
  proveedores?: {
    anio: number;
    filas: {
      proveedor: string; ruc: string | null; total: number; tickets_anio: number; monto_anio: number; monto_total: number;
      abiertos: number; dias_prom: number | null; dias_max: number | null; con_plazo: number;
    }[];
  } | null;
  /** SLA cotización → OC en días hábiles (null si no se pudo calcular). */
  sla?: {
    meta: number;
    totales: { n: number; promedio: number | null; en_meta: number; esperando: number; fuera: number };
    meses: { mes: string; n: number; promedio: number; en_meta: number }[];
    proveedores: { proveedor: string; n: number; promedio: number; en_meta: number }[];
    pendientes: { id: number; refer: number | null; ticket: string | null; proveedor: string | null; descripcion: string; f_coti: string; espera: number }[];
  } | null;
  /** Panel de materiales, de las solicitudes registradas sin las anuladas (null si no se pudo calcular). */
  materiales?: {
    anio: number;
    totales: {
      solicitudes: number; gasto: number; gasto_catalogo: number; gasto_fuera: number;
      lineas: number; lineas_fuera: number; sin_precio: number;
    };
    meses: { mes: string; solicitudes: number; gasto: number }[];
    top: { descripcion: string; codigo: string | null; unidad: string; veces: number; cantidad: number; gasto: number }[];
    lugares: { lugar: string; gasto: number; lineas: number }[];
  } | null;
}

// Los gráficos (recharts) pesan bastante: se descargan aparte, solo en esta página.
const Usuarios = dynamic(() => import("./Usuarios"), { ssr: false, loading: () => <p className="text-sm text-ink-soft">Cargando usuarios…</p> });
const Proveedores = dynamic(() => import("./Proveedores"), { ssr: false, loading: () => <p className="text-sm text-ink-soft">Cargando proveedores…</p> });
type Vista = "usuarios" | "proveedores" | "excel";
const SubirExcel = dynamic(() => import("@/components/inventario/CargaExcel").then((m) => m.SubirExcel), { ssr: false });
const Graficos = dynamic(() => import("@/components/dashboard/Graficos"), {
  ssr: false,
  // Ocupa el lugar de los gráficos mientras se descargan: la página no "salta" cuando aparecen.
  loading: () => (
    <div className="grid lg:grid-cols-2 gap-6 animate-pulse" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-[340px] bg-white border border-line rounded-lg" />
      ))}
    </div>
  ),
});

/** Variación porcentual entre los dos últimos meses con datos. */
function calcularTendencia(porMes: Agg[], campo: "monto" | "cantidad") {
  if (porMes.length < 2) return null;
  const actual = porMes[porMes.length - 1][campo];
  const anterior = porMes[porMes.length - 2][campo];
  if (!anterior) return null;
  const variacion = ((actual - anterior) / anterior) * 100;
  return Math.round(variacion);
}

function Tendencia({ valor }: { valor: number | null }) {
  if (valor === null) return null;
  const subiendo = valor > 0;
  const plano = valor === 0;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-mono-tag ${
        plano ? "text-ink-soft" : subiendo ? "text-teal" : "text-ink-soft"
      }`}
    >
      {plano ? "→" : subiendo ? "▲" : "▼"} {Math.abs(valor)}% vs mes anterior
    </span>
  );
}

/**
 * Tarjeta KPI con lenguaje visual de "orden de trabajo": borde punteado
 * a la izquierda, como el talonario de un ticket. `peso` controla la
 * jerarquía visual — no todas las cifras importan lo mismo.
 */
function KpiCard({
  label,
  value,
  sublabel,
  accentBar,
  textColor,
  peso = "normal",
}: {
  label: string;
  value: string;
  sublabel?: React.ReactNode;
  accentBar: string;
  textColor?: string;
  peso?: "primario" | "normal";
}) {
  return (
    <div
      className="bg-white border border-line rounded-lg shadow-card flex flex-col gap-1.5 p-4"
    >
      <span className="flex items-center gap-2 text-xs font-medium text-ink-soft">
        <span
          aria-hidden
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: accentBar }}
        />
        {label}
      </span>
      <span
        className={`font-display font-bold leading-none ${
          peso === "primario" ? "text-4xl" : "text-3xl"
        }`}
        style={textColor ? { color: textColor } : undefined}
      >
        {value}
      </span>
      {sublabel && <div className="mt-0.5">{sublabel}</div>}
    </div>
  );
}

const mb = (b: number) => `${(b / 1024 / 1024).toLocaleString("es-PE", { maximumFractionDigits: 0 })} MB`;

/** Espacio que ocupa la base de datos (solo administradores): avisa antes de que se llene el plan. */
function EspacioUsado({ a }: { a: NonNullable<DashboardData["almacenamiento"]> }) {
  const pct = Math.min(100, Math.round((a.baseBytes / a.limiteBytes) * 100));
  const color = pct >= 90 ? "#d0112d" : pct >= 70 ? "#d97706" : "#1f8a64";
  return (
    <section className="mt-6 rounded-lg border border-line bg-white px-4 py-3 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Espacio de la base de datos · {pct} %</h2>
        <span className="text-xs text-ink-soft">
          {mb(a.baseBytes)} de {mb(a.limiteBytes)} · adjuntos en la base: {mb(a.archivosBytes)} en {a.archivos} archivos
          {a.blobConectado ? ` · en Vercel Blob: ${mb(a.blobBytes ?? 0)} en ${a.archivosBlob ?? 0}` : ""}
        </span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-concrete-dim" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      {a.blobConectado && a.archivos > 0 && (
        <p className="mt-2 text-xs text-ink-soft">
          Vercel Blob está conectado: los {a.archivos} adjuntos que quedan en la base se van moviendo solos, de a
          poco, mientras se usa la app. El espacio de la base se libera a medida que la base lo recupera.
        </p>
      )}
      {pct >= 70 && !a.blobConectado && (
        <p className="mt-2 text-xs" style={{ color }}>
          La base está al {pct} %. Los adjuntos se guardan dentro de ella: conviene ampliar el plan o pasar los
          archivos a un almacenamiento aparte (por ejemplo, Vercel Blob) antes de que se llene.
        </p>
      )}
    </section>
  );
}

/**
 * Panel General. Los datos llegan ya en el HTML (los consulta la página en el servidor); si eso falló,
 * se piden desde el navegador como antes.
 */
export default function Panel({ inicial }: { inicial: DashboardData | null }) {
  const [data, setData] = useState<DashboardData | null>(inicial);
  const [loading, setLoading] = useState(!inicial);
  const [error, setError] = useState("");

  useEffect(() => {
    if (inicial) return;
    fetch("/api/dashboard")
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok || !d?.totales) {
          throw new Error(d?.error || "No se pudo cargar el panel");
        }
        setData(d);
      })
      .catch((e: Error) => setError(e.message || "No se pudo cargar el panel"))
      .finally(() => setLoading(false));
  }, [inicial]);

  const tendenciaMonto = data ? calcularTendencia(data.porMes, "monto") : null;

  // Pestaña elegida: se recuerda en este equipo (sin guardar nada en el servidor).
  const pestanas = [
    { clave: "resumen", label: "Resumen" },
    { clave: "gastos", label: "Gastos" },
    ...(data?.sla ? [{ clave: "sla", label: "SLA cotización → OC" }] : []),
    ...(data?.proveedores && data.proveedores.filas.length > 0 ? [{ clave: "proveedores", label: "Proveedores" }] : []),
    ...(data?.materiales ? [{ clave: "materiales", label: "Materiales" }] : []),
  ] as { clave: Pestana; label: string }[];
  const [pestana, setPestanaEstado] = useState<Pestana>("resumen");
  useEffect(() => {
    try {
      const g = localStorage.getItem("panel:pestana") as Pestana | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (g && g !== "resumen") setPestanaEstado(g);
    } catch {
      /* sin almacenamiento local: queda Resumen */
    }
  }, []);
  const setPestana = (p: Pestana) => {
    setPestanaEstado(p);
    try {
      localStorage.setItem("panel:pestana", p);
    } catch {
      /* nada */
    }
  };
  // Si la pestaña guardada ya no existe (p. ej. sin materiales), se vuelve al resumen.
  const actual: Pestana = pestanas.some((t) => t.clave === pestana) ? pestana : "resumen";

  // Usuarios (administradores) y Proveedores (administrador de todos los campus) se abren dentro del panel;
  // /usuarios y /proveedores redirigen aquí con ?vista=...
  const me = useMe();
  const esAdmin = me?.rol === "admin";
  const veProveedores = esAdmin && (me?.campusAsignado === TODOS_LOS_CAMPUS || !me?.campusAsignado);
  const [vista, setVistaEstado] = useState<Vista | null>(null);
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("vista");
    if (v === "usuarios" || v === "proveedores" || v === "excel") setVistaEstado(v);
  }, []);
  function abrir(v: Vista | null) {
    setVistaEstado(v);
    const url = new URL(window.location.href);
    if (v) url.searchParams.set("vista", v);
    else url.searchParams.delete("vista");
    window.history.replaceState(null, "", url);
    window.scrollTo({ top: 0 });
  }
  const verUsuarios = esAdmin && vista === "usuarios";
  const verProveedores = veProveedores && vista === "proveedores";
  const verExcel = esAdmin && vista === "excel";
  const botonVista = (activo: boolean) =>
    `text-xs font-medium border rounded-md px-3 py-1.5 transition-colors ${
      activo ? "bg-ink text-white border-ink" : "text-ink-soft hover:text-ink border-line-strong hover:bg-concrete-dim"
    }`;

  return (
    <div className="min-h-screen bg-page">
      <TopNav />
      <main className={CONTENEDOR}>
        <EncabezadoPagina
          titulo="Panel general"
          extra={data ? `${data.totales.total_tickets} tickets registrados` : undefined}
          descripcion="Estado de los correctivos, gasto y lo que requiere atención."
          acciones={
            <>
            <span className="text-xs text-ink-soft first-letter:uppercase">
              {new Date().toLocaleDateString("es-PE", {
                timeZone: "America/Lima", // igual en el servidor y en el navegador
                weekday: "long",
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
            </span>
            {esAdmin && (
              <button type="button" onClick={() => abrir(verExcel ? null : "excel")} className={botonVista(verExcel)}>
                Cargar Excel
              </button>
            )}
            {veProveedores && (
              <button type="button" onClick={() => abrir(verProveedores ? null : "proveedores")} className={botonVista(verProveedores)}>
                Proveedores
              </button>
            )}
            {esAdmin && (
              <button type="button" onClick={() => abrir(verUsuarios ? null : "usuarios")} className={botonVista(verUsuarios)}>
                Usuarios
              </button>
            )}
            <CambiarContrasena />
            </>
          }
        />

        {verUsuarios ? (
          <Usuarios onCerrar={() => abrir(null)} />
        ) : verProveedores ? (
          <Proveedores onCerrar={() => abrir(null)} />
        ) : verExcel ? (
          <CargarExcel campus={me?.campus} onCerrar={() => abrir(null)} />
        ) : error ? (
          <p className="text-sm text-danger bg-danger-soft border border-danger/30 px-3 py-2">
            {error}. Recarga la página o intenta de nuevo en unos minutos.
          </p>
        ) : loading || !data ? (
          <p className="text-sm text-ink-soft">Cargando datos…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
              <div className="col-span-2">
                <KpiCard
                  label="Monto total"
                  value={formatoSoles(data.totales.monto_total, 0)}
                  accentBar="#4f8fc0"
                  peso="primario"
                  sublabel={<Tendencia valor={tendenciaMonto} />}
                />
              </div>

              <KpiCard
                label={`Atrasados +${DIAS_ATRASO} días`}
                value={String(data.totales.atrasados)}
                accentBar={data.totales.atrasados > 0 ? "#d0112d" : "#dcdcdf"}
                textColor={data.totales.atrasados > 0 ? "#d0112d" : undefined}
                sublabel={
                  <span className="text-xs text-ink-soft">
                    {data.totales.atrasados > 0
                      ? "requieren atención"
                      : "sin retrasos"}
                  </span>
                }
              />

              <KpiCard
                label="Pendientes"
                value={String(data.totales.pendientes)}
                accentBar="#1f3a5f"
                sublabel={
                  <span className="text-xs text-ink-soft">
                    en proceso
                  </span>
                }
              />

              <KpiCard
                label="Finalizados"
                value={String(data.totales.finalizados)}
                accentBar="#1f8a64"
                textColor="#1f8a64"
                sublabel={
                  <span className="text-xs text-ink-soft">
                    {data.totales.total_tickets > 0
                      ? Math.round(
                          (data.totales.finalizados / data.totales.total_tickets) * 100
                        )
                      : 0}
                    % del total
                  </span>
                }
              />
            </div>

            <Atencion data={data} irA={setPestana} />

            {/* Pestañas: el resumen muestra lo de todos los días; el detalle queda a un toque. */}
            <nav className="flex gap-1 overflow-x-auto border-b border-line mb-6" aria-label="Secciones del panel">
              {pestanas.map((t) => (
                <button
                  key={t.clave}
                  type="button"
                  onClick={() => setPestana(t.clave)}
                  aria-current={actual === t.clave ? "page" : undefined}
                  className={`whitespace-nowrap px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                    actual === t.clave ? "border-amber text-amber-hover" : "border-transparent text-ink-soft hover:text-ink"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>

            {actual === "resumen" && (
              <>
                <Graficos data={data} vista="resumen" />
                {data.almacenamiento && <EspacioUsado a={data.almacenamiento} />}
              </>
            )}
            {actual === "gastos" && <Graficos data={data} vista="gastos" />}
            {actual === "sla" && data.sla && <PanelSla s={data.sla} />}
            {actual === "proveedores" && data.proveedores && <PanelProveedores p={data.proveedores} />}
            {actual === "materiales" && data.materiales && <PanelMateriales m={data.materiales} />}
          </>
        )}
      </main>
    </div>
  );
}

type Pestana = "resumen" | "gastos" | "sla" | "proveedores" | "materiales";

/**
 * Lo que requiere atención, en una sola línea de avisos (cada uno lleva a donde se resuelve). Si no hay
 * nada pendiente, lo dice en una línea.
 */
function Atencion({ data, irA }: { data: DashboardData; irA: (p: Pestana) => void }) {
  const t = data.totales;
  const avisos: { texto: string; href?: string; pestana?: Pestana; grave?: boolean }[] = [];
  if (t.atrasados > 0) avisos.push({ texto: `${t.atrasados} ticket(s) atrasado(s) más de ${DIAS_ATRASO} días`, href: "/correctivos", grave: true });
  if (data.sla && data.sla.totales.fuera > 0) {
    avisos.push({ texto: `${data.sla.totales.fuera} cotizado(s) sin OC fuera del SLA`, pestana: "sla", grave: true });
  }
  const alm = data.almacenamiento;
  if (alm && alm.baseBytes / alm.limiteBytes >= 0.7) avisos.push({ texto: `Base de datos al ${Math.round((alm.baseBytes / alm.limiteBytes) * 100)} %`, pestana: "resumen" });
  const cls = (g?: boolean) =>
    `inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
      g ? "border-[#d0112d]/40 bg-[#d0112d]/5 text-[#d0112d] hover:bg-[#d0112d]/10" : "border-line-strong bg-white hover:bg-concrete-dim"
    }`;
  return (
    <div className="flex flex-wrap items-center gap-2 mb-6">
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft mr-1">Requiere atención</span>
      {avisos.length === 0 ? (
        <span className="text-xs text-[#1f8a64]">Nada pendiente ✓</span>
      ) : (
        avisos.map((a) =>
          a.href ? (
            <Link key={a.texto} href={a.href} className={cls(a.grave)}>⚠ {a.texto}</Link>
          ) : (
            <button key={a.texto} type="button" onClick={() => a.pestana && irA(a.pestana)} className={cls(a.grave)}>⚠ {a.texto}</button>
          )
        )
      )}
    </div>
  );
}

/* ───── SLA cotización → OC ───── */
type PS = NonNullable<DashboardData["sla"]>;
const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];

function PanelSla({ s }: { s: PS }) {
  const t = s.totales;
  const pct = t.n ? Math.round((t.en_meta / t.n) * 100) : null;
  const tono = (prom: number | null) => (prom === null ? "" : prom <= s.meta ? "text-[#1f8a64]" : prom <= s.meta * 2 ? "text-amber-700" : "text-[#d0112d]");
  const maxMes = Math.max(s.meta, ...s.meses.map((m) => m.promedio));
  // Los últimos 12 meses, aunque alguno no tenga OC (así se ve cuándo hubo compras).
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
  const doce = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)) - 12 + i, 1));
    const mes = d.toISOString().slice(0, 7);
    return s.meses.find((m) => m.mes === mes) ?? { mes, n: 0, promedio: 0, en_meta: 0 };
  });
  return (
    <section className="bg-white border border-line rounded-lg shadow-card overflow-hidden">
      <div className="px-4 pt-4">
        <h2 className="font-display font-bold text-2xl tracking-tight">SLA cotización → OC</h2>
        <p className="text-xs text-ink-soft">
          Días hábiles (lunes a viernes) desde la fecha de la cotización hasta la emisión de la OC. Meta: <b>{s.meta} días hábiles</b>.
          OC de los últimos 12 meses.
        </p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-line mt-3 border-y border-line">
        <div className="bg-white px-4 py-3">
          <span className="block text-[11px] uppercase tracking-wider text-ink-soft">Promedio</span>
          <span className={`block font-display font-bold text-3xl tabular-nums ${tono(t.promedio)}`}>{t.promedio === null ? "—" : `${t.promedio.toLocaleString("es-PE")} d`}</span>
          <span className="text-xs text-ink-soft">días hábiles · {t.n} OC medidas</span>
        </div>
        <div className="bg-white px-4 py-3">
          <span className="block text-[11px] uppercase tracking-wider text-ink-soft">Dentro de la meta</span>
          <span className={`block font-display font-bold text-3xl tabular-nums ${pct === null ? "" : pct >= 80 ? "text-[#1f8a64]" : pct >= 50 ? "text-amber-700" : "text-[#d0112d]"}`}>{pct === null ? "—" : `${pct} %`}</span>
          <span className="text-xs text-ink-soft">{t.en_meta} de {t.n} OC en {s.meta} días o menos</span>
        </div>
        <div className="bg-white px-4 py-3">
          <span className="block text-[11px] uppercase tracking-wider text-ink-soft">Esperando OC</span>
          <span className="block font-display font-bold text-3xl tabular-nums">{t.esperando}</span>
          <span className="text-xs text-ink-soft">cotizados, aún sin OC</span>
        </div>
        <div className="bg-white px-4 py-3">
          <span className="block text-[11px] uppercase tracking-wider text-ink-soft">Fuera de la meta</span>
          <span className={`block font-display font-bold text-3xl tabular-nums ${t.fuera ? "text-[#d0112d]" : ""}`}>{t.fuera}</span>
          <span className="text-xs text-ink-soft">sin OC hace más de {s.meta} días hábiles</span>
        </div>
      </div>
      <div className="grid lg:grid-cols-3 gap-6 p-4">
        <div>
          <p className="text-xs font-medium text-ink-soft uppercase tracking-wider mb-2">Promedio por mes de emisión de la OC</p>
          {s.meses.length === 0 ? <p className="text-sm text-ink-soft">Aún no hay OC con fecha de cotización.</p> : (
            <div className="relative flex items-end gap-1 h-32 border-b border-line pt-4">
              {doce.map((m) => (
                <div key={m.mes} className="flex-1 flex flex-col items-center justify-end h-full"
                  title={m.n ? `${m.mes}: ${m.promedio} días hábiles en promedio · ${m.en_meta} de ${m.n} OC en meta` : `${m.mes}: sin OC`}>
                  {m.n > 0 && <span className="text-[10px] tabular-nums text-ink-soft">{m.promedio}</span>}
                  <div className={`w-full max-w-8 rounded-t ${m.promedio <= s.meta ? "bg-[#1f8a64]" : m.promedio <= s.meta * 2 ? "bg-amber-500" : "bg-[#d0112d]"}`}
                    style={{ height: `${(m.promedio / maxMes) * 85}%` }} />
                </div>
              ))}
              <div className="absolute inset-x-0 z-10 border-t-2 border-dashed border-ink/50 pointer-events-none" style={{ bottom: `${(s.meta / maxMes) * 85}%` }} title={`Meta: ${s.meta} días`} />
            </div>
          )}
          {s.meses.length > 0 && (
            <div className="flex gap-1 mt-1">
              {doce.map((m) => <span key={m.mes} className="flex-1 text-center text-[10px] text-ink-soft">{MESES_CORTOS[Number(m.mes.slice(5)) - 1]}</span>)}
            </div>
          )}
          {s.meses.length > 0 && <p className="text-[11px] text-ink-soft mt-1">Línea punteada: meta de {s.meta} días hábiles. Verde: dentro de la meta.</p>}
        </div>
        <div>
          <p className="text-xs font-medium text-ink-soft uppercase tracking-wider mb-2">Por proveedor (los que más tardan)</p>
          {s.proveedores.length === 0 ? <p className="text-sm text-ink-soft">Sin datos.</p> : (
            <ul className="text-sm space-y-1">
              {s.proveedores.map((p) => (
                <li key={p.proveedor} className="flex justify-between gap-2">
                  <span className="truncate" title={p.proveedor}>{p.proveedor}</span>
                  <span className="whitespace-nowrap tabular-nums"><b className={tono(p.promedio)}>{p.promedio} d</b> <span className="text-xs text-ink-soft">· {p.en_meta}/{p.n}</span></span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-xs font-medium text-ink-soft uppercase tracking-wider mb-2">Esperando OC fuera de la meta</p>
          {s.pendientes.length === 0 ? <p className="text-sm text-[#1f8a64]">Ninguno ✓</p> : (
            <ul className="text-sm space-y-1">
              {s.pendientes.map((p) => (
                <li key={p.id}>
                  <Link href={`/correctivos/${p.id}`} className="font-mono text-xs underline">#{p.refer ?? p.id}</Link>{" "}
                  <b className="text-[#d0112d]">{p.espera} d</b> <span className="text-xs text-ink-soft">desde {formatoFecha(p.f_coti)}</span>
                  <span className="block text-xs text-ink-soft truncate" title={p.descripcion}>{p.proveedor ? `${p.proveedor} · ` : ""}{p.descripcion}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/* ───── Panel de proveedores ───── */
type PP = NonNullable<DashboardData["proveedores"]>;
const dias = (d: number | null) => (d === null ? "—" : `${d.toLocaleString("es-PE", { maximumFractionDigits: 1 })} d`);

function PanelProveedores({ p }: { p: PP }) {
  const [verTodos, setVerTodos] = useState(false);
  const [orden, setOrden] = useState<"monto" | "dias" | "abiertos">("monto");
  const filas = [...p.filas].sort((a, b) =>
    orden === "dias"
      ? (b.dias_prom ?? -1) - (a.dias_prom ?? -1)
      : orden === "abiertos"
        ? b.abiertos - a.abiertos || b.monto_anio - a.monto_anio
        : b.monto_anio - a.monto_anio || b.monto_total - a.monto_total
  );
  const visibles = verTodos ? filas : filas.slice(0, 10);
  // "Los que más demoran": promedio OC → fin del trabajo, con al menos 2 trabajos medidos.
  const lentos = p.filas
    .filter((f) => f.dias_prom !== null && f.con_plazo >= 2)
    .sort((a, b) => (b.dias_prom ?? 0) - (a.dias_prom ?? 0))
    .slice(0, 3);
  const umbralLento = lentos.length ? (lentos[lentos.length - 1].dias_prom ?? Infinity) : Infinity;
  const totalAnio = p.filas.reduce((s, f) => s + f.monto_anio, 0);
  const abiertos = p.filas.reduce((s, f) => s + f.abiertos, 0);
  const boton = (k: typeof orden, t: string) => (
    <button
      type="button"
      onClick={() => setOrden(k)}
      className={`px-2 py-1 text-xs border ${orden === k ? "bg-ink text-white border-ink" : "border-line hover:bg-slate-50"}`}
    >
      {t}
    </button>
  );
  return (
    <section className="bg-white border border-line rounded-lg shadow-card overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
        <div>
          <h2 className="font-display font-bold text-2xl tracking-tight">Proveedores</h2>
          <p className="text-xs text-ink-soft">
            Comprado en {p.anio} (por fecha de OC): <b>{formatoSoles(totalAnio, 0)}</b> · {abiertos} ticket(s) abiertos ·
            plazo = días desde la OC hasta el fin del trabajo
          </p>
        </div>
        <div className="flex gap-1">
          {boton("monto", `Más comprado ${p.anio}`)}
          {boton("dias", "Más demora")}
          {boton("abiertos", "Más abiertos")}
        </div>
      </div>
      {lentos.length > 0 && (
        <p className="mx-4 mt-3 text-xs bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2">
          ⏱ Los que más demoran:{" "}
          {lentos.map((f, i) => (
            <span key={f.proveedor}>
              {i > 0 && " · "}
              <b>{f.proveedor}</b> ({dias(f.dias_prom)} en promedio, máx. {dias(f.dias_max)})
            </span>
          ))}
        </p>
      )}
      <div className="overflow-x-auto mt-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-soft border-b border-line">
              <th className="px-4 py-2 font-medium">Proveedor</th>
              <th className="px-2 py-2 font-medium text-right">Tickets {p.anio}</th>
              <th className="px-2 py-2 font-medium text-right">Monto {p.anio}</th>
              <th className="px-2 py-2 font-medium text-right hidden sm:table-cell">Monto histórico</th>
              <th className="px-2 py-2 font-medium text-right">Abiertos</th>
              <th className="px-2 py-2 font-medium text-right">Plazo prom.</th>
              <th className="px-4 py-2 font-medium text-right hidden sm:table-cell">Máx.</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((f) => {
              const lento = f.dias_prom !== null && f.con_plazo >= 2 && f.dias_prom >= umbralLento;
              return (
                <tr key={f.proveedor} className="border-b border-line/60 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <a
                      href={`/correctivos?proveedor=${encodeURIComponent(f.proveedor)}`}
                      className="font-medium hover:underline"
                      title="Ver sus tickets"
                    >
                      {f.proveedor}
                    </a>
                    {f.ruc && <span className="block text-[11px] text-ink-soft font-mono">RUC {f.ruc}</span>}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{f.tickets_anio}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-medium">{formatoSoles(f.monto_anio, 0)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink-soft hidden sm:table-cell">{formatoSoles(f.monto_total, 0)}</td>
                  <td className={`px-2 py-2 text-right tabular-nums ${f.abiertos > 0 ? "text-[#1f3a5f] font-medium" : "text-ink-soft"}`}>
                    {f.abiertos}
                  </td>
                  <td className={`px-2 py-2 text-right tabular-nums ${lento ? "text-danger font-semibold" : ""}`}>
                    {dias(f.dias_prom)}
                    {f.con_plazo > 0 && <span className="block text-[11px] text-ink-soft font-normal">{f.con_plazo} medido(s)</span>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-soft hidden sm:table-cell">{dias(f.dias_max)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filas.length > 10 && (
        <button type="button" onClick={() => setVerTodos((v) => !v)} className="w-full text-xs py-2 border-t border-line hover:bg-slate-50">
          {verTodos ? "Ver solo los 10 primeros" : `Ver los ${filas.length}`}
        </button>
      )}
    </section>
  );
}

/* ───── Panel de materiales ───── */
type PM = NonNullable<DashboardData["materiales"]>;
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const nombreMes = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(2, 4)}`;

function Barra({ etiqueta, valor, max, texto, color = "#4f8fc0" }: { etiqueta: string; valor: number; max: number; texto: string; color?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-32 shrink-0 truncate" title={etiqueta}>{etiqueta}</span>
      <div className="flex-1 h-3 bg-slate-100">
        <div className="h-3" style={{ width: `${max > 0 ? Math.max(1, (valor / max) * 100) : 0}%`, background: color }} />
      </div>
      <span className="w-24 shrink-0 text-right tabular-nums">{texto}</span>
    </div>
  );
}

function PanelMateriales({ m }: { m: PM }) {
  const t = m.totales;
  if (!t || (m.meses.length === 0 && m.top.length === 0)) {
    return (
      <section className="bg-white border border-line rounded-lg shadow-card p-4">
        <h2 className="font-display font-bold text-2xl tracking-tight">Materiales</h2>
        <p className="text-sm text-ink-soft mt-1">Aún no hay solicitudes de materiales registradas.</p>
      </section>
    );
  }
  const maxMes = Math.max(0, ...m.meses.map((x) => x.gasto));
  const maxLugar = Math.max(0, ...m.lugares.map((x) => x.gasto));
  const pctCat = t.gasto > 0 ? Math.round((t.gasto_catalogo / t.gasto) * 100) : 0;
  return (
    <section className="bg-white border border-line rounded-lg shadow-card overflow-hidden">
      <div className="px-4 pt-4">
        <h2 className="font-display font-bold text-2xl tracking-tight">Materiales</h2>
        <p className="text-xs text-ink-soft">
          De las solicitudes registradas (sin las anuladas) · importes sin IGV
          {t.sin_precio > 0 && ` · ${t.sin_precio} material(es) de ${m.anio} sin precio no suman`}
        </p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-4">
        <KpiCard label={`Gasto ${m.anio}`} value={formatoSoles(t.gasto, 0)} accentBar="#4f8fc0" peso="primario" />
        <KpiCard label={`Solicitudes ${m.anio}`} value={String(t.solicitudes)} accentBar="#1f3a5f"
          sublabel={<span className="text-xs text-ink-soft">{t.lineas} material(es)</span>} />
        <KpiCard label="De catálogo" value={formatoSoles(t.gasto_catalogo, 0)} accentBar="#1f8a64"
          sublabel={<span className="text-xs text-ink-soft">{pctCat}% del gasto</span>} />
        <KpiCard label="Fuera de catálogo" value={formatoSoles(t.gasto_fuera, 0)} accentBar="#c07a1f"
          sublabel={<span className="text-xs text-ink-soft">{t.lineas_fuera} material(es) · {t.gasto > 0 ? 100 - pctCat : 0}%</span>} />
      </div>
      {t.gasto > 0 && (
        <div className="mx-4 mb-2 flex h-2" title={`Catálogo ${pctCat}% · Fuera de catálogo ${100 - pctCat}%`}>
          <div style={{ width: `${pctCat}%`, background: "#1f8a64" }} />
          <div style={{ width: `${100 - pctCat}%`, background: "#c07a1f" }} />
        </div>
      )}
      <div className="grid lg:grid-cols-2 gap-6 p-4">
        <div>
          <h3 className="text-sm font-semibold mb-2">Gasto por mes (últimos 12)</h3>
          {m.meses.length === 0 ? (
            <p className="text-xs text-ink-soft">Sin solicitudes en los últimos 12 meses.</p>
          ) : (
            <div className="flex items-end gap-1 h-36 border-b border-line">
              {m.meses.map((x) => (
                <div key={x.mes} className="flex-1 flex flex-col items-center justify-end h-full min-w-0"
                  title={`${nombreMes(x.mes)}: ${formatoSoles(x.gasto, 0)} · ${x.solicitudes} solicitud(es)`}>
                  <div className="w-full bg-[#4f8fc0]" style={{ height: `${maxMes > 0 ? Math.max(2, (x.gasto / maxMes) * 100) : 2}%` }} />
                </div>
              ))}
            </div>
          )}
          {m.meses.length > 0 && (
            <div className="flex gap-1 mt-1">
              {m.meses.map((x) => (
                <span key={x.mes} className="flex-1 text-center text-[10px] text-ink-soft truncate">{nombreMes(x.mes)}</span>
              ))}
            </div>
          )}
        </div>
        <div>
          <h3 className="text-sm font-semibold mb-2">Gasto por lugar (según el ticket del material)</h3>
          <div className="space-y-1.5">
            {m.lugares.map((x) => (
              <Barra key={x.lugar} etiqueta={x.lugar} valor={x.gasto} max={maxLugar} texto={formatoSoles(x.gasto, 0)}
                color={x.lugar === "Sin ticket" || x.lugar === "Ticket no encontrado" ? "#b8b8bd" : "#4f8fc0"} />
            ))}
          </div>
        </div>
      </div>
      <div className="px-4 pb-4">
        <h3 className="text-sm font-semibold mb-2">Materiales más pedidos</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-soft border-b border-line">
                <th className="py-2 pr-2 font-medium">Material</th>
                <th className="px-2 py-2 font-medium text-right">Solicitudes</th>
                <th className="px-2 py-2 font-medium text-right">Cantidad</th>
                <th className="pl-2 py-2 font-medium text-right">Gasto</th>
              </tr>
            </thead>
            <tbody>
              {m.top.map((x, i) => (
                <tr key={i} className="border-b border-line/60 last:border-0">
                  <td className="py-1.5 pr-2">
                    {x.descripcion}
                    <span className="block text-[11px] text-ink-soft">{x.codigo ? `Catálogo · ${x.codigo}` : "Fuera de catálogo"}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{x.veces}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {x.cantidad.toLocaleString("es-PE", { maximumFractionDigits: 2 })} {x.unidad}
                  </td>
                  <td className="pl-2 py-1.5 text-right tabular-nums">{formatoSoles(x.gasto, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/** «Cargar Excel» del panel: agrega (o reemplaza) equipos del inventario del campus desde un Excel. */
function CargarExcel({ campus, onCerrar }: { campus?: string; onCerrar: () => void }) {
  const [actual, setActual] = useState<import("@/components/inventario/CargaExcel").Datos | null>(null);
  const [error, setError] = useState("");
  const [listo, setListo] = useState(false);
  useEffect(() => {
    import("@/components/inventario/CargaExcel")
      .then((m) => m.cargarInventarioActual(campus))
      .then(setActual)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar el inventario."));
  }, [campus]);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="font-display font-bold text-2xl tracking-tight">Cargar datos desde Excel</h2>
          <p className="text-sm text-ink-soft">
            Equipos al inventario del campus{actual ? ` (hoy hay ${actual.equipos.length})` : ""}: tableros, bombas, UPS, aire acondicionado…
          </p>
        </div>
        <button type="button" onClick={onCerrar} className="text-sm font-medium border border-line-strong rounded-md px-4 py-2 hover:bg-concrete-dim">
          ← Volver al panel
        </button>
      </div>
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : !actual ? (
        <p className="text-sm text-ink-soft">Cargando inventario…</p>
      ) : (
        <>
          <SubirExcel actual={actual} alGuardar={(d) => { setActual(d); setListo(true); }} />
          {listo && (
            <p className="mt-3 text-sm">
              Listo. <Link href="/inventario" className="underline font-medium">Ver el inventario →</Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}
