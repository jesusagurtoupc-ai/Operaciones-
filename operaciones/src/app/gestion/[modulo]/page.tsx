"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import TopNav from "@/components/layout/TopNav";
import { useMe } from "@/lib/client";
import { MODULOS } from "@/lib/gestion";
import { Agenda, Garantias, Informe, Presupuesto, Preventivos, Reportes } from "@/components/gestion/Modulos";

const DESCRIPCION: Record<string, string> = {
  garantias: "Trabajos que siguen en garantía, cuándo vence cada una y fallas repetidas que conviene reclamar al proveedor.",
  agenda: "Qué contratista trabaja dónde cada día, su documentación (SCTR) y los permisos de trabajo de riesgo.",
  presupuesto: "Presupuesto anual por cuenta frente a lo comprometido y ejecutado en los tickets, con aviso al 80 %.",
  preventivos: "Servicios contratados por frecuencia (ITSE, ascensores, cisternas, pozos a tierra…): último, próximo e informe.",
  reportes: "Fallas reportadas por cualquier persona desde el QR pegado en el ambiente, sin iniciar sesión.",
  informe: "Resumen del mes para gerencia, listo para descargar en PDF.",
};

/** Páginas de Gestión: una sola página que muestra el módulo de la dirección (/gestion/garantias, …). */
export default function GestionPage() {
  const { modulo } = useParams<{ modulo: string }>();
  const me = useMe();
  const actual = MODULOS.find((m) => m.clave === modulo);
  const permitidos = MODULOS.filter((m) => me?.rol === "admin" || !me?.paginas || me.paginas.includes(m.href));
  return (
    <div className="min-h-screen bg-page">
      <TopNav />
      <main className="max-w-7xl mx-auto px-3 sm:px-5 py-6 sm:py-8 pb-24 sm:pb-8">
        <nav className="flex gap-1 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 mb-5 border-b border-line" aria-label="Gestión">
          {permitidos.map((m) => (
            <Link key={m.clave} href={m.href} prefetch={false}
              className={`whitespace-nowrap px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                m.clave === modulo ? "border-amber text-amber-hover" : "border-transparent text-ink-soft hover:text-ink"
              }`}>
              <span aria-hidden="true">{m.icono}</span> {m.label}
            </Link>
          ))}
        </nav>
        {!actual ? (
          <p className="text-sm text-ink-soft bg-white border border-line p-4 rounded-lg">Esta sección no existe.</p>
        ) : (
          <>
            <div className="mb-5">
              <h1 className="font-display font-bold text-3xl sm:text-4xl tracking-tight">{actual.label}</h1>
              <p className="text-sm text-ink-soft mt-1">{DESCRIPCION[actual.clave]}</p>
            </div>
            {modulo === "garantias" && <Garantias />}
            {modulo === "agenda" && <Agenda />}
            {modulo === "presupuesto" && <Presupuesto />}
            {modulo === "preventivos" && <Preventivos />}
            {modulo === "reportes" && <Reportes />}
            {modulo === "informe" && <Informe />}
          </>
        )}
      </main>
    </div>
  );
}
