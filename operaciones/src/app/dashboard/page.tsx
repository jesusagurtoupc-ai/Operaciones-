"use client";

import { useEffect, useState } from "react";
import TopNav from "@/components/TopNav";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from "recharts";

interface Agg {
  label: string;
  cantidad: number;
  monto: number;
}

interface DashboardData {
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
}

// Grises azulados con un solo acento (azul acero) para el dato principal.
const ACENTO = "#2f5d8a";
const APOYO = "#8fa3b8";
const REJILLA = "#e5e9ef";
const PALETA = ["#2f5d8a", "#5b7fa3", "#8fa3b8", "#b4c2d1", "#d3dce6", "#6b7a8c"];

function formatoSoles(n: number) {
  return new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "PEN",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

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
        className={`font-display font-700 leading-none ${
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

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }, []);

  const tendenciaMonto = data ? calcularTendencia(data.porMes, "monto") : null;

  return (
    <div className="min-h-screen bg-page">
      <TopNav />
      <main className="max-w-7xl mx-auto px-5 py-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-6">
          <div className="flex items-baseline gap-3">
            <h1 className="font-display font-700 text-4xl tracking-tight">
              Panel General
            </h1>
            {data && (
              <span className="text-xs text-ink-soft">
                {data.totales.total_tickets} tickets registrados
              </span>
            )}
          </div>
          <span className="text-xs text-ink-soft">
            {new Date().toLocaleDateString("es-PE", {
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}
          </span>
        </div>

        {loading || !data ? (
          <p className="text-sm text-ink-soft">Cargando datos…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
              <div className="col-span-2">
                <KpiCard
                  label="Monto total"
                  value={formatoSoles(data.totales.monto_total)}
                  accentBar="#c3c8d0"
                  peso="primario"
                  sublabel={<Tendencia valor={tendenciaMonto} />}
                />
              </div>

              <KpiCard
                label="Atrasados +30 días"
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
                accentBar="#58585d"
                sublabel={
                  <span className="text-xs text-ink-soft">
                    en proceso
                  </span>
                }
              />

              <KpiCard
                label="Finalizados"
                value={String(data.totales.finalizados)}
                accentBar="#2f6e52"
                textColor="#2f6e52"
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

            <div className="grid lg:grid-cols-2 gap-6 mb-6">
              <div className="bg-white border border-line rounded-lg shadow-card p-5">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-soft mb-4">
                  Monto por Estado
                </h2>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={data.porEstado} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={REJILLA} horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => formatoSoles(v)} />
                    <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(v) => formatoSoles(Number(v))} />
                    <Bar dataKey="monto" fill={ACENTO} radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white border border-line rounded-lg shadow-card p-5">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-soft mb-4">
                  Distribución por Tipo de Trabajo
                </h2>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={data.porTipo}
                      dataKey="monto"
                      nameKey="label"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                    >
                      {data.porTipo.map((_, i) => (
                        <Cell key={i} fill={PALETA[i % PALETA.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => formatoSoles(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              <div className="bg-white border border-line rounded-lg shadow-card p-5">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-soft mb-4">
                  Tendencia mensual (Monto)
                </h2>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={data.porMes}>
                    <CartesianGrid strokeDasharray="3 3" stroke={REJILLA} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatoSoles(v)} />
                    <Tooltip formatter={(v) => formatoSoles(Number(v))} />
                    <Line type="monotone" dataKey="monto" stroke={ACENTO} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white border border-line rounded-lg shadow-card p-5">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-soft mb-4">
                  Monto por Área
                </h2>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.porArea}>
                    <CartesianGrid strokeDasharray="3 3" stroke={REJILLA} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatoSoles(v)} />
                    <Tooltip formatter={(v) => formatoSoles(Number(v))} />
                    <Bar dataKey="monto" fill={APOYO} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white border border-line rounded-lg shadow-card p-5 mt-6">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-soft mb-4">
                Monto por Proveedor (los 8 mayores)
              </h2>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.porProveedor} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={REJILLA} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => formatoSoles(v)} />
                  <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => formatoSoles(Number(v))} />
                  <Bar dataKey="monto" fill={APOYO} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
