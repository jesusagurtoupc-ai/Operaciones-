"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatoSoles } from "@/lib/shared/formato";
import { ACENTO_ESTADO } from "@/components/lista/filtrosLista";
import type { Agg, DashboardData } from "./tipos";

/* ───────── Paleta de la marca: rojo UPC como acento, grises y verde ───────── */
const ROJO = "#d0112d";
const TINTA = "#141416";
const GRIS = "#c3c8d0"; // barras secundarias
const REJILLA = "#eceef2";
const VERDE = "#2f6e52";
// Tipos de trabajo: colores bien distintos entre sí (rojo, negro, verde y grises/rosas).
const PALETA = [ROJO, TINTA, VERDE, "#8c8c90", "#e58a97", "#58585d", "#c3c8d0"];

const soles = (v: number) => formatoSoles(v || 0, 0);
const compacto = (v: number) =>
  new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "PEN",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(v || 0);

const mesCorto = (etiqueta: string) =>
  new Date(`${etiqueta}-01T00:00:00`).toLocaleDateString("es-PE", {
    month: "short",
    year: "2-digit",
  });

const estiloTooltip = {
  contentStyle: {
    border: "1px solid #dfe2e7",
    borderRadius: 8,
    boxShadow: "0 1px 2px rgba(16,24,40,0.08)",
    fontSize: 12,
    padding: "8px 10px",
  },
  labelStyle: { fontWeight: 600, marginBottom: 2 },
  cursor: { fill: "rgba(20,20,22,0.04)" },
};

function Tarjeta({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-line rounded-lg shadow-card p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-soft mb-4">
        {titulo}
      </h2>
      {children}
    </div>
  );
}

/** Colores: la barra más alta en rojo, el resto en gris. */
function colorDestacado(datos: Agg[], i: number) {
  const max = Math.max(...datos.map((d) => d.monto));
  return datos[i].monto === max && max > 0 ? ROJO : GRIS;
}

export default function Graficos({ data }: { data: DashboardData }) {
  const totalTipos = data.porTipo.reduce((n, t) => n + t.monto, 0);
  const promedioMes = data.porMes.length
    ? data.porMes.reduce((n, m) => n + m.monto, 0) / data.porMes.length
    : 0;
  const ultimo = data.porMes.length - 1;

  return (
    <>
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        {/* Monto por estado: mismo color que las tarjetas de la lista */}
        <Tarjeta titulo="Monto por Estado">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.porEstado} layout="vertical" margin={{ left: 10, right: 56 }}>
              <CartesianGrid stroke={REJILLA} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={compacto} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => soles(Number(v))} {...estiloTooltip} />
              <Bar dataKey="monto" radius={[0, 4, 4, 0]} animationDuration={600}>
                {data.porEstado.map((e) => (
                  <Cell key={e.label} fill={ACENTO_ESTADO[e.label] ?? GRIS} />
                ))}
                <LabelList dataKey="monto" position="right" formatter={(v) => compacto(Number(v))} style={{ fontSize: 11, fill: "#58585d" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Tarjeta>

        {/* Tipo de trabajo: donut con total al centro y leyenda con porcentajes */}
        <Tarjeta titulo="Distribución por Tipo de Trabajo">
          <div className="relative">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={data.porTipo}
                  dataKey="monto"
                  nameKey="label"
                  innerRadius={62}
                  outerRadius={92}
                  paddingAngle={2}
                  stroke="#fff"
                  strokeWidth={2}
                  animationDuration={600}
                >
                  {data.porTipo.map((_, i) => (
                    <Cell key={i} fill={PALETA[i % PALETA.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => soles(Number(v))} {...estiloTooltip} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-display font-700 text-2xl leading-none">{compacto(totalTipos)}</span>
              <span className="text-[11px] text-ink-soft mt-1">monto total</span>
            </div>
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
            {data.porTipo.map((t, i) => (
              <li key={t.label} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    aria-hidden
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: PALETA[i % PALETA.length] }}
                  />
                  <span className="truncate">{t.label}</span>
                </span>
                <span className="font-mono-tag text-ink-soft shrink-0">
                  {totalTipos > 0 ? Math.round((t.monto / totalTipos) * 100) : 0}%
                </span>
              </li>
            ))}
          </ul>
        </Tarjeta>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Tendencia: área con degradado, promedio y último mes marcado */}
        <Tarjeta titulo="Tendencia mensual (Monto)">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data.porMes} margin={{ top: 16, right: 16 }}>
              <defs>
                <linearGradient id="degradadoMonto" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ROJO} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={ROJO} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={REJILLA} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickFormatter={mesCorto} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={compacto} axisLine={false} tickLine={false} width={64} />
              <Tooltip
                formatter={(v) => soles(Number(v))}
                labelFormatter={(l) => mesCorto(String(l))}
                {...estiloTooltip}
                cursor={{ stroke: GRIS }}
              />
              {promedioMes > 0 && (
                <ReferenceLine
                  y={promedioMes}
                  stroke="#8c8c90"
                  strokeDasharray="4 4"
                  label={{ value: "Promedio", position: "insideTopRight", fontSize: 11, fill: "#58585d" }}
                />
              )}
              <Area
                type="monotone"
                dataKey="monto"
                stroke={ROJO}
                strokeWidth={2}
                fill="url(#degradadoMonto)"
                animationDuration={700}
                dot={(p: { cx?: number; cy?: number; index?: number }) =>
                  p.index === ultimo && p.cx !== undefined && p.cy !== undefined ? (
                    <circle key="ultimo" cx={p.cx} cy={p.cy} r={5} fill={ROJO} stroke="#fff" strokeWidth={2} />
                  ) : (
                    <g key={p.index} />
                  )
                }
                activeDot={{ r: 5, fill: ROJO, stroke: "#fff", strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Tarjeta>

        {/* Área: la mayor en rojo, las demás en gris */}
        <Tarjeta titulo="Monto por Área">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.porArea} margin={{ top: 22 }}>
              <CartesianGrid stroke={REJILLA} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={compacto} axisLine={false} tickLine={false} width={64} />
              <Tooltip formatter={(v) => soles(Number(v))} {...estiloTooltip} />
              <Bar dataKey="monto" radius={[4, 4, 0, 0]} animationDuration={600}>
                {data.porArea.map((_, i) => (
                  <Cell key={i} fill={colorDestacado(data.porArea, i)} />
                ))}
                <LabelList dataKey="monto" position="top" formatter={(v) => compacto(Number(v))} style={{ fontSize: 11, fill: "#58585d" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Tarjeta>
      </div>

      {/* Proveedores: el mayor en rojo, los demás en gris */}
      <div className="mt-6">
        <Tarjeta titulo="Monto por Proveedor (los 8 mayores)">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.porProveedor} layout="vertical" margin={{ left: 10, right: 56 }}>
              <CartesianGrid stroke={REJILLA} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={compacto} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => soles(Number(v))} {...estiloTooltip} />
              <Bar dataKey="monto" radius={[0, 4, 4, 0]} animationDuration={600}>
                {data.porProveedor.map((_, i) => (
                  <Cell key={i} fill={colorDestacado(data.porProveedor, i)} />
                ))}
                <LabelList dataKey="monto" position="right" formatter={(v) => compacto(Number(v))} style={{ fontSize: 11, fill: "#58585d" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Tarjeta>
      </div>
    </>
  );
}
