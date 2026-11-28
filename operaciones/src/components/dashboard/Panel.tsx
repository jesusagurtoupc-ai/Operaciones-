"use client";

import { useEffect, useRef, useState } from "react";
import { useMe } from "@/lib/client";
import TopNav, { CONTENEDOR, EncabezadoPagina, CambiarContrasena } from "@/components/layout/TopNav";
import dynamic from "next/dynamic";
import { DIAS_ATRASO, TODOS_LOS_CAMPUS, nombreCampus, SLA_COTI_OC_DIAS } from "@/lib/shared";
import { formatoSoles, formatoFecha } from "@/lib/shared";
import Link from "next/link";
import GuardarCarpeta from "@/components/ticket/GuardarCarpeta";
import PanelNotificaciones from "@/components/lista/PanelNotificaciones";
import type { Correctivo } from "@/lib/shared";

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
      medidas: number; a_tiempo: number; vencidos: number; sin_informe: number;
    }[];
  } | null;
  /** Finalizados por mes (fecha de fin), para el mini gráfico. */
  finalizadosMes?: { mes: string; n: number }[];
  /** Presupuesto anual del campus contra lo gastado este año (total y por tipo de trabajo). */
  presupuesto?: { anio: number; total: number; porTipo: Record<string, number>; gasto: number; gastoPorTipo: Record<string, number> } | null;
  /** Equipos del inventario con 3 o más correctivos en 6 meses. */
  equiposRepetidos?: number;
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
type Vista = "usuarios" | "proveedores" | "excel" | "velocidad";

/** Todos los tickets activos del campus (de 200 en 200), para «Guardar en carpeta». */
async function todosLosTickets() {
  const todos: Correctivo[] = [];
  for (let p = 1; ; p++) {
    const res = await fetch(`/api/correctivos?page=${p}&pageSize=200&facetas=0`);
    if (!res.ok) throw new Error("No se pudo leer la lista de tickets");
    const d = await res.json();
    todos.push(...d.data);
    if (p >= d.pagination.totalPages) break;
  }
  return todos;
}
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
  serie,
}: {
  label: string;
  value: string;
  sublabel?: React.ReactNode;
  accentBar: string;
  textColor?: string;
  peso?: "primario" | "normal";
  /** Valores de los últimos meses (del más antiguo al actual) para el mini gráfico. */
  serie?: { mes: string; v: number }[];
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
      {serie && serie.length >= 2 && <MiniGrafico serie={serie} color={accentBar === "#d5dbe4" ? "#1e3a5f" : accentBar} />}
    </div>
  );
}

const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** Últimos 6 meses (AAAA-MM), con 0 donde no hubo datos. */
function ultimosMeses(datos: { mes: string; v: number }[], n = 6): { mes: string; v: number }[] {
  const hoy = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" }) + "T12:00:00Z");
  const out: { mes: string; v: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - i, 1));
    const clave = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    out.push({ mes: clave, v: datos.find((x) => x.mes === clave)?.v ?? 0 });
  }
  return out;
}
/** Mini gráfico de barras de los últimos meses (el mes actual resaltado). */
function MiniGrafico({ serie, color }: { serie: { mes: string; v: number }[]; color: string }) {
  const max = Math.max(...serie.map((s) => s.v), 1);
  return (
    <div className="mt-2" aria-label={`Últimos ${serie.length} meses`}>
      <div className="flex items-end gap-1 h-9">
        {serie.map((s, i) => (
          <div
            key={s.mes}
            title={`${MES_CORTO[Number(s.mes.slice(5)) - 1]} ${s.mes.slice(0, 4)}: ${s.v.toLocaleString("es-PE", { maximumFractionDigits: 0 })}`}
            className="flex-1 rounded-sm"
            style={{ height: `${Math.max(6, (s.v / max) * 100)}%`, background: color, opacity: i === serie.length - 1 ? 1 : 0.28 }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-ink-soft mt-0.5">
        <span>{MES_CORTO[Number(serie[0].mes.slice(5)) - 1]}</span>
        <span>{MES_CORTO[Number(serie[serie.length - 1].mes.slice(5)) - 1]}</span>
      </div>
    </div>
  );
}

const mb = (b: number) => `${(b / 1024 / 1024).toLocaleString("es-PE", { maximumFractionDigits: 0 })} MB`;

/** Espacio que ocupa la base de datos (solo administradores): avisa antes de que se llene el plan. */
function EspacioUsado({ a }: { a: NonNullable<DashboardData["almacenamiento"]> }) {
  const pct = Math.min(100, Math.round((a.baseBytes / a.limiteBytes) * 100));
  const color = pct >= 90 ? "#d0112d" : pct >= 70 ? "#d97706" : "#127a56";
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
  const [presentando, setPresentando] = useState(false);
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("vista");
    if (v === "usuarios" || v === "proveedores" || v === "excel" || v === "velocidad") setVistaEstado(v);
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
  const verVelocidad = esAdmin && vista === "velocidad";
  // Exportar y Guardar en carpeta leen los tickets: solo si la persona tiene acceso a la página Correctivos.
  const veTickets = esAdmin || !me?.paginas || me.paginas.includes("/correctivos");
  const botonVista = (activo: boolean) =>
    `inline-flex items-center text-xs font-medium border rounded-md px-3 py-1.5 transition-colors disabled:opacity-50 ${
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
          seccion={
            <span>
              {me?.campus ? `${nombreCampus(me.campus)} · ` : ""}
              {new Date().toLocaleDateString("es-PE", {
                timeZone: "America/Lima", // igual en el servidor y en el navegador
                weekday: "long",
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
            </span>
          }
          acciones={
            // Herramientas agrupadas: datos de los tickets | administración | cuenta.
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Datos">
                {data && (
                  <button type="button" onClick={() => setPresentando(true)} className={botonVista(false)} title="Todo el panel en una sola pantalla, para reuniones">
                    Presentar
                  </button>
                )}
                {veTickets && (
                  <>
                    <a href="/api/export" target="_blank" rel="noopener" className={botonVista(false)} title="Excel con todos los tickets del campus">
                      Exportar Excel
                    </a>
                    <GuardarCarpeta cargarTodos={todosLosTickets} etiqueta="Guardar en carpeta" claseBoton={botonVista(false)} />
                  </>
                )}
                {esAdmin && (
                  <button type="button" onClick={() => abrir(verExcel ? null : "excel")} className={botonVista(verExcel)}>
                    Cargar Excel
                  </button>
                )}
              </div>
              {esAdmin && (
                <div className="flex flex-wrap items-center gap-2 sm:border-l sm:border-line sm:pl-3" role="group" aria-label="Administración">
                  <Link href="/correctivos?papelera=1" className={botonVista(false)}>
                    Papelera
                  </Link>
                  {veProveedores && (
                    <button type="button" onClick={() => abrir(verProveedores ? null : "proveedores")} className={botonVista(verProveedores)}>
                      Proveedores
                    </button>
                  )}
                  <button type="button" onClick={() => abrir(verUsuarios ? null : "usuarios")} className={botonVista(verUsuarios)}>
                    Usuarios
                  </button>
                  <a href="/api/correctivos/avisos?resumen=semanal" target="_blank" rel="noopener" className={botonVista(false)} title="Vista previa del correo que se envía cada lunes (8:00 a. m.)">
                    Resumen semanal
                  </a>
                  <button type="button" onClick={() => abrir(verVelocidad ? null : "velocidad")} className={botonVista(verVelocidad)} title="Mide la velocidad del servidor y de la base de datos">
                    Velocidad
                  </button>
                </div>
              )}
              <div className="sm:border-l sm:border-line sm:pl-3">
                <CambiarContrasena />
              </div>
            </div>
          }
        />

        {presentando && data && <ModoPresentacion data={data} campus={me?.campus} onCerrar={() => setPresentando(false)} />}

        {/* Notificaciones (tickets atrasados, sin OC, sin informe…): se abren desde aquí; llevan a cada ticket. */}
        {veTickets && !vista && <PanelNotificaciones refrescar={0} />}

        {verUsuarios ? (
          <Usuarios onCerrar={() => abrir(null)} />
        ) : verProveedores ? (
          <Proveedores onCerrar={() => abrir(null)} />
        ) : verVelocidad ? (
          <Velocidad onCerrar={() => abrir(null)} />
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
                  accentBar="#2f6fb0"
                  peso="primario"
                  sublabel={<Tendencia valor={tendenciaMonto} />}
                  serie={ultimosMeses(data.porMes.map((m) => ({ mes: m.label, v: m.monto })))}
                />
              </div>

              <KpiCard
                label={`Atrasados +${DIAS_ATRASO} días`}
                value={String(data.totales.atrasados)}
                accentBar={data.totales.atrasados > 0 ? "#d0112d" : "#d5dbe4"}
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
                accentBar="#1e3a5f"
                sublabel={
                  <span className="text-xs text-ink-soft">
                    en proceso · barras: tickets nuevos por mes
                  </span>
                }
                serie={ultimosMeses(data.porMes.map((m) => ({ mes: m.label, v: m.cantidad })))}
              />

              <KpiCard
                label="Finalizados"
                value={String(data.totales.finalizados)}
                accentBar="#127a56"
                textColor="#127a56"
                sublabel={
                  <span className="text-xs text-ink-soft">
                    {data.totales.total_tickets > 0
                      ? Math.round(
                          (data.totales.finalizados / data.totales.total_tickets) * 100
                        )
                      : 0}
                    % del total · barras: cerrados por mes
                  </span>
                }
                serie={data.finalizadosMes ? ultimosMeses(data.finalizadosMes.map((m) => ({ mes: m.mes, v: m.n }))) : undefined}
              />
            </div>

            <Atencion data={data} irA={setPestana} />

            {data.presupuesto && (esAdmin || data.presupuesto.total > 0) && (
              <Presupuesto p={data.presupuesto} editable={esAdmin}
                alGuardar={(nuevo) => setData((d) => (d && d.presupuesto ? { ...d, presupuesto: { ...d.presupuesto, ...nuevo } } : d))} />
            )}

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
  const pr = data.presupuesto;
  if (pr && pr.total > 0 && pr.gasto / pr.total >= 0.8) {
    avisos.push({ texto: `Presupuesto ${pr.anio} al ${Math.round((pr.gasto / pr.total) * 100)} %`, grave: pr.gasto >= pr.total });
  }
  if ((data.equiposRepetidos ?? 0) > 0) {
    avisos.push({ texto: `${data.equiposRepetidos} equipo(s) con fallas repetidas`, href: "/inventario" });
  }
  const alm = data.almacenamiento;
  if (alm && alm.baseBytes / alm.limiteBytes >= 0.7) avisos.push({ texto: `Base de datos al ${Math.round((alm.baseBytes / alm.limiteBytes) * 100)} %`, pestana: "resumen" });
  const cls = (g?: boolean) =>
    `inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
      g ? "border-danger/40 bg-danger/5 text-danger hover:bg-danger/10" : "border-line-strong bg-white hover:bg-concrete-dim"
    }`;
  return (
    <div className="flex flex-wrap items-center gap-2 mb-6">
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft mr-1">Requiere atención</span>
      {avisos.length === 0 ? (
        <span className="text-xs text-teal">Nada pendiente ✓</span>
      ) : (
        avisos.map((a) =>
          !a.href && !a.pestana ? (
            <span key={a.texto} className={cls(a.grave)}><IconoAlerta /> {a.texto}</span>
          ) : a.href ? (
            <Link key={a.texto} href={a.href} className={cls(a.grave)}><IconoAlerta /> {a.texto}</Link>
          ) : (
            <button key={a.texto} type="button" onClick={() => a.pestana && irA(a.pestana)} className={cls(a.grave)}><IconoAlerta /> {a.texto}</button>
          )
        )
      )}
    </div>
  );
}

/* ───── Presupuesto anual ───── */
type PPres = NonNullable<DashboardData["presupuesto"]>;

/** Barra de avance del gasto contra el presupuesto: verde, ámbar desde 80 % y roja al pasarse. */
function BarraAvance({ gasto, total }: { gasto: number; total: number }) {
  const pct = total > 0 ? (gasto / total) * 100 : 0;
  const color = pct >= 100 ? "#d0112d" : pct >= 80 ? "#d49a1e" : "#127a56";
  return (
    <div className="h-2 rounded-full bg-concrete-dim overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  );
}

/**
 * Presupuesto del año del campus: gasto (por fecha de OC, o de registro si no tiene) contra el monto asignado,
 * en total y por tipo de trabajo. Los administradores lo editan aquí mismo.
 */
function Presupuesto({ p, editable, alGuardar }: { p: PPres; editable: boolean; alGuardar: (v: Pick<PPres, "total" | "porTipo">) => void }) {
  const [editando, setEditando] = useState(false);
  const [total, setTotal] = useState(String(p.total || ""));
  const [porTipo, setPorTipo] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const tipos = [...new Set([...Object.keys(p.gastoPorTipo), ...Object.keys(p.porTipo)])].sort(
    (a, b) => (p.gastoPorTipo[b] ?? 0) - (p.gastoPorTipo[a] ?? 0)
  );
  const pct = p.total > 0 ? Math.round((p.gasto / p.total) * 100) : null;

  function abrir() {
    setTotal(String(p.total || ""));
    setPorTipo(Object.fromEntries(tipos.map((t) => [t, p.porTipo[t] ? String(p.porTipo[t]) : ""])));
    setError("");
    setEditando(true);
  }
  async function guardar() {
    setGuardando(true);
    setError("");
    const num = (v: string) => Number(v.replace(/[^\d.]/g, "")) || 0;
    const partes: Record<string, number> = {};
    for (const k of Object.keys(porTipo)) {
      const v = num(String(porTipo[k] ?? ""));
      if (v > 0) partes[k] = v;
    }
    const nuevo = { total: num(total), porTipo: partes };
    try {
      const r = await fetch("/api/dashboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ anio: p.anio, ...nuevo }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "No se pudo guardar");
      alGuardar(nuevo);
      setEditando(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="bg-white border border-line rounded-lg shadow-card p-5 mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Presupuesto {p.anio}</h2>
        {editable && !editando && (
          <button type="button" onClick={abrir} className="text-xs underline text-ink-soft hover:text-ink">
            {p.total > 0 ? "Editar presupuesto" : "Definir presupuesto"}
          </button>
        )}
      </div>
      {editando ? (
        <div className="mt-3 space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <span className="w-48 font-medium">Presupuesto total del año (S/)</span>
            <input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} className="border border-line-strong rounded px-2 py-1 w-40 text-right tabular-nums" />
          </label>
          <p className="text-xs text-ink-soft pt-1">Opcional, por tipo de trabajo:</p>
          {tipos.map((t) => (
            <label key={t} className="flex items-center gap-2 text-sm">
              <span className="w-48 truncate" title={t}>{t}</span>
              <input inputMode="decimal" value={porTipo[t] ?? ""} onChange={(e) => setPorTipo((x) => ({ ...x, [t]: e.target.value }))}
                className="border border-line-strong rounded px-2 py-1 w-40 text-right tabular-nums" />
            </label>
          ))}
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => void guardar()} disabled={guardando} className="bg-ink text-white text-sm rounded-md px-4 py-1.5 disabled:opacity-50">
              {guardando ? "Guardando…" : "Guardar"}
            </button>
            <button type="button" onClick={() => setEditando(false)} className="text-sm border border-line-strong rounded-md px-4 py-1.5">Cancelar</button>
          </div>
        </div>
      ) : p.total <= 0 ? (
        <p className="text-sm text-ink-soft mt-2">
          Gastado en {p.anio}: <b className="text-ink">{formatoSoles(p.gasto, 0)}</b>. Aún no hay un presupuesto definido para comparar.
        </p>
      ) : (
        <div className="mt-3">
          <div className="flex flex-wrap items-baseline gap-x-3 mb-1.5">
            <span className="text-2xl font-semibold tabular-nums">{formatoSoles(p.gasto, 0)}</span>
            <span className="text-sm text-ink-soft">de {formatoSoles(p.total, 0)} · <b className={pct! >= 100 ? "text-danger" : pct! >= 80 ? "text-aviso" : "text-teal"}>{pct} %</b></span>
            <span className="text-sm text-ink-soft ml-auto">Disponible: <b className="text-ink">{formatoSoles(Math.max(0, p.total - p.gasto), 0)}</b></span>
          </div>
          <BarraAvance gasto={p.gasto} total={p.total} />
          {Object.keys(p.porTipo).length > 0 && (
            <ul className="mt-4 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {Object.entries(p.porTipo).sort((a, b) => b[1] - a[1]).map(([t, monto]) => {
                const g = p.gastoPorTipo[t] ?? 0;
                return (
                  <li key={t}>
                    <div className="flex justify-between gap-2 text-xs mb-1">
                      <span className="truncate">{t}</span>
                      <span className="tabular-nums text-ink-soft">{formatoSoles(g, 0)} / {formatoSoles(monto, 0)} · {Math.round((g / monto) * 100)} %</span>
                    </div>
                    <BarraAvance gasto={g} total={monto} />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/* ───── SLA cotización → OC ───── */
type PS = NonNullable<DashboardData["sla"]>;
const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];

function PanelSla({ s }: { s: PS }) {
  const t = s.totales;
  const pct = t.n ? Math.round((t.en_meta / t.n) * 100) : null;
  const tono = (prom: number | null) => (prom === null ? "" : prom <= s.meta ? "text-teal" : prom <= s.meta * 2 ? "text-aviso" : "text-danger");
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
          <span className={`block font-display font-bold text-3xl tabular-nums ${pct === null ? "" : pct >= 80 ? "text-teal" : pct >= 50 ? "text-aviso" : "text-danger"}`}>{pct === null ? "—" : `${pct} %`}</span>
          <span className="text-xs text-ink-soft">{t.en_meta} de {t.n} OC en {s.meta} días o menos</span>
        </div>
        <div className="bg-white px-4 py-3">
          <span className="block text-[11px] uppercase tracking-wider text-ink-soft">Esperando OC</span>
          <span className="block font-display font-bold text-3xl tabular-nums">{t.esperando}</span>
          <span className="text-xs text-ink-soft">cotizados, aún sin OC</span>
        </div>
        <div className="bg-white px-4 py-3">
          <span className="block text-[11px] uppercase tracking-wider text-ink-soft">Fuera de la meta</span>
          <span className={`block font-display font-bold text-3xl tabular-nums ${t.fuera ? "text-danger" : ""}`}>{t.fuera}</span>
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
                  <div className={`w-full max-w-8 rounded-t ${m.promedio <= s.meta ? "bg-teal" : m.promedio <= s.meta * 2 ? "bg-aviso" : "bg-danger"}`}
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
          {s.pendientes.length === 0 ? <p className="text-sm text-teal">Ninguno ✓</p> : (
            <ul className="text-sm space-y-1">
              {s.pendientes.map((p) => (
                <li key={p.id}>
                  <Link href={`/correctivos/${p.id}`} className="font-mono text-xs underline">#{p.refer ?? p.id}</Link>{" "}
                  <b className="text-danger">{p.espera} d</b> <span className="text-xs text-ink-soft">desde {formatoFecha(p.f_coti)}</span>
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

/**
 * Nota de cumplimiento del proveedor: A (cumple), B (regular), C (bajo). Pesa el % de entregas a tiempo y
 * penaliza las entregas vencidas hoy y los trabajos terminados sin informe. Sin datos suficientes: «—».
 */
function notaProveedor(f: PP["filas"][number]): { nota: "A" | "B" | "C" | "—"; pct: number | null; motivo: string } {
  const pct = f.medidas > 0 ? Math.round((f.a_tiempo / f.medidas) * 100) : null;
  const pendientes = f.vencidos + f.sin_informe;
  if (pct === null && pendientes === 0) return { nota: "—", pct, motivo: "Aún sin entregas medidas (falta fecha de entrega o de fin)" };
  const base = pct ?? 70;
  const puntaje = base - Math.min(40, f.vencidos * 10 + f.sin_informe * 5);
  const motivo = `${pct === null ? "Sin entregas medidas" : `${pct}% a tiempo (${f.a_tiempo} de ${f.medidas})`} · ${f.vencidos} vencida(s) hoy · ${f.sin_informe} sin informe`;
  return { nota: puntaje >= 85 ? "A" : puntaje >= 65 ? "B" : "C", pct, motivo };
}
const COLOR_NOTA = { A: "bg-teal-soft text-teal ring-teal/30", B: "bg-aviso-soft text-aviso ring-aviso/30", C: "bg-danger-soft text-danger ring-danger/30", "—": "bg-concrete-dim text-ink-soft ring-line" } as const;

function PanelProveedores({ p }: { p: PP }) {
  const [verTodos, setVerTodos] = useState(false);
  const [orden, setOrden] = useState<"monto" | "dias" | "abiertos" | "cumplimiento">("monto");
  const rango = { A: 0, B: 1, C: 2, "—": 3 } as const;
  const filas = [...p.filas].sort((a, b) =>
    orden === "cumplimiento"
      ? rango[notaProveedor(b).nota] - rango[notaProveedor(a).nota] || b.vencidos + b.sin_informe - (a.vencidos + a.sin_informe)
      : orden === "dias"
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
      className={`px-2 py-1 text-xs border ${orden === k ? "bg-ink text-white border-ink" : "border-line hover:bg-page"}`}
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
            plazo = días desde la OC hasta el fin del trabajo · nota: A cumple, B regular, C bajo (pasa el mouse para ver el detalle)
          </p>
        </div>
        <div className="flex gap-1">
          {boton("monto", `Más comprado ${p.anio}`)}
          {boton("dias", "Más demora")}
          {boton("abiertos", "Más abiertos")}
          {boton("cumplimiento", "Peor cumplimiento")}
        </div>
      </div>
      {lentos.length > 0 && (
        <p className="mx-4 mt-3 text-xs bg-aviso-soft border border-aviso/30 text-aviso px-3 py-2">
          Los que más demoran:{" "}
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
              <th className="px-2 py-2 font-medium text-right hidden sm:table-cell">Máx.</th>
              <th className="px-2 py-2 font-medium text-right" title="Entregas terminadas hasta la fecha de entrega de la OC">A tiempo</th>
              <th className="px-2 py-2 font-medium text-right" title="Tickets en curso con la entrega vencida y sin informe">Vencidos</th>
              <th className="px-2 py-2 font-medium text-right" title="Trabajos terminados que aún no tienen informe">Sin informe</th>
              <th className="px-4 py-2 font-medium text-center" title="A cumple · B regular · C bajo">Nota</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((f) => {
              const lento = f.dias_prom !== null && f.con_plazo >= 2 && f.dias_prom >= umbralLento;
              return (
                <tr key={f.proveedor} className="border-b border-line/60 last:border-0 hover:bg-page">
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
                  <td className={`px-2 py-2 text-right tabular-nums ${f.abiertos > 0 ? "text-slate-ink font-medium" : "text-ink-soft"}`}>
                    {f.abiertos}
                  </td>
                  <td className={`px-2 py-2 text-right tabular-nums ${lento ? "text-danger font-semibold" : ""}`}>
                    {dias(f.dias_prom)}
                    {f.con_plazo > 0 && <span className="block text-[11px] text-ink-soft font-normal">{f.con_plazo} medido(s)</span>}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink-soft hidden sm:table-cell">{dias(f.dias_max)}</td>
                  {(() => {
                    const n = notaProveedor(f);
                    return (
                      <>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {n.pct === null ? <span className="text-ink-soft">—</span> : `${n.pct}%`}
                          {f.medidas > 0 && <span className="block text-[11px] text-ink-soft">{f.a_tiempo}/{f.medidas}</span>}
                        </td>
                        <td className={`px-2 py-2 text-right tabular-nums ${f.vencidos > 0 ? "text-danger font-semibold" : "text-ink-soft"}`}>{f.vencidos}</td>
                        <td className={`px-2 py-2 text-right tabular-nums ${f.sin_informe > 0 ? "text-aviso font-semibold" : "text-ink-soft"}`}>{f.sin_informe}</td>
                        <td className="px-4 py-2 text-center">
                          <span title={n.motivo} className={`inline-flex w-7 h-7 items-center justify-center rounded-full text-xs font-bold ring-1 ring-inset ${COLOR_NOTA[n.nota]}`}>
                            {n.nota}
                          </span>
                        </td>
                      </>
                    );
                  })()}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filas.length > 10 && (
        <button type="button" onClick={() => setVerTodos((v) => !v)} className="w-full text-xs py-2 border-t border-line hover:bg-page">
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

function Barra({ etiqueta, valor, max, texto, color = "#2f6fb0" }: { etiqueta: string; valor: number; max: number; texto: string; color?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-32 shrink-0 truncate" title={etiqueta}>{etiqueta}</span>
      <div className="flex-1 h-3 bg-concrete-dim">
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
        <KpiCard label={`Gasto ${m.anio}`} value={formatoSoles(t.gasto, 0)} accentBar="#2f6fb0" peso="primario" />
        <KpiCard label={`Solicitudes ${m.anio}`} value={String(t.solicitudes)} accentBar="#1e3a5f"
          sublabel={<span className="text-xs text-ink-soft">{t.lineas} material(es)</span>} />
        <KpiCard label="De catálogo" value={formatoSoles(t.gasto_catalogo, 0)} accentBar="#127a56"
          sublabel={<span className="text-xs text-ink-soft">{pctCat}% del gasto</span>} />
        <KpiCard label="Fuera de catálogo" value={formatoSoles(t.gasto_fuera, 0)} accentBar="#c07a1f"
          sublabel={<span className="text-xs text-ink-soft">{t.lineas_fuera} material(es) · {t.gasto > 0 ? 100 - pctCat : 0}%</span>} />
      </div>
      {t.gasto > 0 && (
        <div className="mx-4 mb-2 flex h-2" title={`Catálogo ${pctCat}% · Fuera de catálogo ${100 - pctCat}%`}>
          <div style={{ width: `${pctCat}%`, background: "#127a56" }} />
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
                  <div className="w-full bg-info" style={{ height: `${maxMes > 0 ? Math.max(2, (x.gasto / maxMes) * 100) : 2}%` }} />
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
                color={x.lugar === "Sin ticket" || x.lugar === "Ticket no encontrado" ? "#b8b8bd" : "#2f6fb0"} />
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

// ───────── Diagnóstico de velocidad (administradores) ─────────

const NOMBRE_REGION: Record<string, string> = {
  iad1: "Washington, EE. UU.", cle1: "Cleveland, EE. UU.", pdx1: "Portland, EE. UU.", sfo1: "San Francisco, EE. UU.",
  gru1: "São Paulo, Brasil", fra1: "Fráncfort, Alemania", lhr1: "Londres, Reino Unido", sin1: "Singapur", syd1: "Sídney", hnd1: "Tokio",
  "us-east-1": "Virginia, EE. UU.", "us-east-2": "Ohio, EE. UU.", "us-west-2": "Oregón, EE. UU.", "sa-east-1": "São Paulo, Brasil",
  "eu-central-1": "Fráncfort, Alemania", "eu-west-2": "Londres, Reino Unido", "ap-southeast-1": "Singapur", "ap-southeast-2": "Sídney", "ap-northeast-1": "Tokio",
};
type DatosVelocidad = { servidor: string | null; base: string | null; sugerida: string | null; alineadas: boolean; primeraMs: number; idaVueltaMs: number };

/** Mide (en el servidor) dónde corre la app, dónde está la base y cuánto tarda cada consulta; da la recomendación. */
function Velocidad({ onCerrar }: { onCerrar: () => void }) {
  const [d, setD] = useState<DatosVelocidad | null>(null);
  const [navegador, setNavegador] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [n, setN] = useState(0);
  useEffect(() => {
    setD(null);
    setError("");
    const t = performance.now();
    fetch("/api/auth/velocidad", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || "No se pudo medir");
        setNavegador(Math.round(performance.now() - t));
        setD(j);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo medir"));
  }, [n]);
  const nombre = (r: string | null) => (r ? `${NOMBRE_REGION[r] ?? r} (${r})` : "no se pudo saber");
  const nivel = (ms: number, bien: number, regular: number) => (ms <= bien ? "text-teal" : ms <= regular ? "text-aviso" : "text-danger");
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="font-display font-bold text-2xl tracking-tight">Velocidad del sistema</h2>
          <p className="text-sm text-ink-soft">Dónde corre la app, dónde está la base de datos y cuánto tarda cada consulta.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setN((x) => x + 1)} className="text-sm font-medium border border-line-strong rounded-md px-4 py-2 hover:bg-concrete-dim">
            Medir otra vez
          </button>
          <button type="button" onClick={onCerrar} className="text-sm font-medium border border-line-strong rounded-md px-4 py-2 hover:bg-concrete-dim">
            ← Volver al panel
          </button>
        </div>
      </div>
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : !d ? (
        <p className="text-sm text-ink-soft">Midiendo…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="bg-white border border-line rounded-lg shadow-card p-5 space-y-3 text-sm">
            <p><span className="text-ink-soft">Servidor de la app (Vercel):</span> <b>{nombre(d.servidor)}</b></p>
            <p><span className="text-ink-soft">Base de datos (Neon):</span> <b>{nombre(d.base)}</b></p>
            <p>
              <span className="text-ink-soft">Cada consulta a la base:</span>{" "}
              <b className={nivel(d.idaVueltaMs, 15, 60)}>{d.idaVueltaMs} ms</b>
              <span className="text-ink-soft"> (una página usa de 2 a 6 consultas)</span>
            </p>
            <p>
              <span className="text-ink-soft">Primera consulta:</span> <b className={nivel(d.primeraMs, 100, 600)}>{d.primeraMs} ms</b>
              {d.primeraMs > 600 && <span className="text-ink-soft"> · la base estaba «dormida» y tuvo que arrancar</span>}
            </p>
            {navegador !== null && (
              <p><span className="text-ink-soft">Desde tu equipo hasta el servidor y de vuelta:</span> <b>{navegador} ms</b></p>
            )}
          </section>
          <section className="bg-white border border-line rounded-lg shadow-card p-5 text-sm space-y-2">
            <h3 className="font-semibold">Recomendación</h3>
            {d.alineadas ? (
              <p className="text-teal">✓ El servidor y la base están en la misma región: es la configuración más rápida.</p>
            ) : d.sugerida ? (
              <>
                <p>
                  El servidor está en <b>{nombre(d.servidor)}</b> y la base en <b>{nombre(d.base)}</b>: cada consulta viaja entre las dos.
                  Para que cada consulta tarde pocos milisegundos, pon el servidor junto a la base:
                </p>
                <ol className="list-decimal pl-5 space-y-1 text-ink-soft">
                  <li>Vercel → tu proyecto → <b>Settings → Functions → Function Region</b>.</li>
                  <li>Elige <b>{nombre(d.sugerida)}</b> y guarda.</li>
                  <li>Vuelve a desplegar (Deployments → ⋯ → Redeploy) y mide otra vez aquí.</li>
                </ol>
              </>
            ) : (
              <p className="text-ink-soft">No se pudo identificar la región de la base; revísala en la consola de Neon (junto al nombre del proyecto).</p>
            )}
            <p className="text-ink-soft pt-2 border-t border-line">
              Si la «primera consulta» sale alta seguido, la base se apaga por falta de uso (plan gratuito de Neon, tras 5 min). La app ya la
              despierta al abrir la pantalla de ingreso y al volver a la pestaña; para evitarlo del todo, en Neon → Compute se puede desactivar
              «Scale to zero» (requiere plan de pago).
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

// ───────── Modo presentación: el panel en una sola pantalla (para reuniones) ─────────
function ModoPresentacion({ data, campus, onCerrar }: { data: DashboardData; campus?: string; onCerrar: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cerrar = useRef(onCerrar);
  cerrar.current = onCerrar;
  useEffect(() => {
    // Pantalla completa si el navegador lo permite; Esc (o salir de pantalla completa) cierra.
    ref.current?.requestFullscreen?.().catch(() => {});
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && cerrar.current();
    const salir = () => !document.fullscreenElement && cerrar.current();
    document.addEventListener("keydown", tecla);
    document.addEventListener("fullscreenchange", salir);
    return () => {
      document.removeEventListener("keydown", tecla);
      document.removeEventListener("fullscreenchange", salir);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);
  const t = data.totales;
  const meses = ultimosMeses(data.porMes.map((m) => ({ mes: m.label, v: m.monto })), 12);
  const maxMes = Math.max(...meses.map((m) => m.v), 1);
  const estados = ["cotizar", "enviado", "Ingresado a PS", "Por Ejecutar", "Finalizado"].map((e) => ({
    e,
    n: data.porEstado.find((x) => x.label === e)?.cantidad ?? 0,
  }));
  const colorEstado: Record<string, string> = { cotizar: "#8391a7", enviado: "#0b84c6", "Ingresado a PS": "#d98a04", "Por Ejecutar": "#e2580e", Finalizado: "#0e9468" };
  const totalEstados = Math.max(1, estados.reduce((a, b) => a + b.n, 0));
  const top = [...data.porProveedor].sort((a, b) => b.monto - a.monto).slice(0, 5);
  const fecha = new Date().toLocaleDateString("es-PE", { timeZone: "America/Lima", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const caja = "bg-white border border-line rounded-xl p-6 shadow-card";
  return (
    <div ref={ref} className="fixed inset-0 z-[60] bg-page overflow-auto p-6 lg:p-10">
      <div className="max-w-[1600px] mx-auto">
        <div className="flex items-end justify-between gap-4 mb-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber">
              {campus ? nombreCampus(campus) : "Operaciones"} · <span className="first-letter:uppercase inline-block">{fecha}</span>
            </p>
            <h2 className="font-display font-bold text-5xl tracking-tight mt-1">Sistema de Correctivos</h2>
          </div>
          <button type="button" onClick={onCerrar} className="text-sm border border-line-strong rounded-md px-4 py-2 bg-white hover:bg-concrete-dim">
            Salir de la presentación (Esc)
          </button>
        </div>
        <div className="grid grid-cols-4 gap-5">
          <div className={`${caja} col-span-2 !bg-slate-ink !border-slate-ink text-white`}>
            <p className="text-sm text-white/70">Monto total</p>
            <p className="font-display font-bold text-7xl leading-none mt-2">{formatoSoles(t.monto_total, 0)}</p>
            <p className="text-sm text-white/70 mt-3">{t.total_tickets} tickets registrados</p>
          </div>
          <div className={caja}>
            <p className="text-sm text-ink-soft">Atrasados +{DIAS_ATRASO} días</p>
            <p className="font-display font-bold text-6xl leading-none mt-2" style={{ color: t.atrasados > 0 ? "#d0112d" : undefined }}>{t.atrasados}</p>
            <p className="text-sm text-ink-soft mt-2">{t.atrasados > 0 ? "requieren atención" : "sin retrasos"}</p>
          </div>
          <div className={caja}>
            <p className="text-sm text-ink-soft">SLA cotización → OC</p>
            <p className="font-display font-bold text-6xl leading-none mt-2">
              {data.sla?.totales.promedio != null ? `${data.sla.totales.promedio.toLocaleString("es-PE", { maximumFractionDigits: 1 })} d` : "—"}
            </p>
            <p className="text-sm text-ink-soft mt-2">meta {data.sla?.meta ?? SLA_COTI_OC_DIAS} días hábiles · {data.sla?.totales.fuera ?? 0} fuera</p>
          </div>
          <div className={`${caja} col-span-2 row-span-2`}>
            <p className="text-sm text-ink-soft mb-4">Gasto por mes (últimos 12 meses)</p>
            <div className="flex items-end gap-2 h-64">
              {meses.map((m, i) => (
                <div key={m.mes} className="flex-1 flex flex-col items-center justify-end h-full">
                  <span className="text-[11px] text-ink-soft mb-1 tabular-nums">{m.v > 0 ? `${Math.round(m.v / 1000)}k` : ""}</span>
                  <div className="w-full rounded-t" style={{ height: `${Math.max(2, (m.v / maxMes) * 85)}%`, background: i === meses.length - 1 ? "#d0112d" : "#2f6fb0" }} />
                  <span className="text-xs text-ink-soft mt-1">{MES_CORTO[Number(m.mes.slice(5)) - 1]}</span>
                </div>
              ))}
            </div>
          </div>
          <div className={`${caja} col-span-2`}>
            <p className="text-sm text-ink-soft mb-3">Tickets por estado</p>
            <div className="flex h-6 rounded overflow-hidden">
              {estados.map((x) => (
                <div key={x.e} style={{ flex: x.n, background: colorEstado[x.e] }} title={`${x.e}: ${x.n}`} />
              ))}
            </div>
            <div className="grid grid-cols-5 gap-2 mt-3">
              {estados.map((x) => (
                <div key={x.e}>
                  <p className="text-xs text-ink-soft flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: colorEstado[x.e] }} />{x.e}</p>
                  <p className="font-display font-bold text-3xl">{x.n}</p>
                  <p className="text-[11px] text-ink-soft">{Math.round((x.n / totalEstados) * 100)}%</p>
                </div>
              ))}
            </div>
          </div>
          <div className={`${caja} col-span-2`}>
            <p className="text-sm text-ink-soft mb-3">Proveedores con más gasto</p>
            <ol className="space-y-2">
              {top.map((p, i) => (
                <li key={p.label} className="flex items-center gap-3 text-base">
                  <span className="w-6 text-ink-soft font-semibold">{i + 1}.</span>
                  <span className="flex-1 truncate">{p.label}</span>
                  <span className="font-semibold tabular-nums">{formatoSoles(p.monto, 0)}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Ícono de alerta (en vez de emoji, para que se vea igual en todos los equipos). */
function IconoAlerta() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="inline -mt-0.5">
      <path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17h.01" />
    </svg>
  );
}

