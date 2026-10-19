"use client";

import { useEffect, useState } from "react";
import TopNav from "@/components/layout/TopNav";
import dynamic from "next/dynamic";
import { DIAS_ATRASO } from "@/lib/shared/opciones";
import { formatoSoles } from "@/lib/shared/formato";
import type { Agg, DashboardData } from "@/components/dashboard/tipos";

// Los gráficos (recharts) pesan bastante: se descargan aparte, solo en esta página.
const Graficos = dynamic(() => import("@/components/dashboard/Graficos"), {
  ssr: false,
  loading: () => <p className="text-sm text-ink-soft">Cargando gráficos…</p>,
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
  const [error, setError] = useState("");

  useEffect(() => {
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

        {error ? (
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
                  accentBar="#c3c8d0"
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

            <Graficos data={data} />
          </>
        )}
      </main>
    </div>
  );
}
