import TopNav, { EncabezadoPagina } from "@/components/layout/TopNav";
import CorrectivoForm, { AvisoGarantia, EquipoDelTicket } from "@/components/ticket/CorrectivoForm";
import TicketImprimible from "@/components/ticket/TicketImprimible";
import Documentos from "@/components/ticket/Documentos";
import Historial, {
  leerHistorial,
  leerMaterialesDelTicket,
  MaterialesDelTicket,
  leerRucRegistro,
  RevisionAutomatica,
} from "@/components/ticket/Historial";
import CondicionesCotizacion from "@/components/ticket/CondicionesCotizacion";
import GuardarCarpeta, { AutoGuardarAlSalir, BotonImprimir, RecordatorioProveedor } from "@/components/ticket/GuardarCarpeta";
import { sql, ensureSchema } from "@/lib/server/db";
import { getCurrentUser } from "@/lib/server/auth";
import { tipoCambioReferencia } from "@/lib/server/utils";
import { notFound } from "next/navigation";
import type { Correctivo } from "@/lib/shared";
import { normalizeCorrectivo } from "@/lib/shared";

export const dynamic = "force-dynamic";

export default async function EditarCorrectivoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Si el id no es numérico, evitamos que la consulta SQL falle y en
  // vez de un error 500 mostramos el 404 normal de Next.js.
  if (!/^\d+$/.test(id)) {
    notFound();
  }

  await ensureSchema(); // asegura la columna `documentos` antes de leer
  // Solo tickets de los campus que el usuario puede ver (uno de otro campus responde 404).
  const usuario = await getCurrentUser();
  const permitidos = usuario?.campusPermitidos ?? [];
  // El ticket y su historial se piden a la vez (antes el historial esperaba al ticket: una ida y
  // vuelta más a la base en cada apertura).
  const [rows, historial, materiales, rucRegistro, tcRef] = await Promise.all([
    sql`SELECT * FROM correctivos WHERE id = ${Number(id)} AND campus = ANY(${permitidos}::text[]) AND eliminado_en IS NULL`,
    leerHistorial(Number(id)),
    leerMaterialesDelTicket(Number(id)),
    leerRucRegistro(Number(id)),
    tipoCambioReferencia(),
  ]);
  const correctivo = rows[0]
    ? (normalizeCorrectivo(rows[0] as Record<string, unknown>) as unknown as Correctivo)
    : undefined;

  if (!correctivo) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-page">
      <div className="no-print">
        <TopNav />
        <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          <EncabezadoPagina
            seccion={<a href="/correctivos" className="hover:underline">← Correctivos</a>}
            titulo={<>Ticket <span className="font-mono-tag text-2xl text-ink-soft">#{correctivo.refer ?? correctivo.id}</span></>}
            descripcion={[correctivo.estado, correctivo.proveedor].filter(Boolean).join(" · ") || undefined}
            acciones={
              <>
                <RecordatorioProveedor c={correctivo} />
                <GuardarCarpeta correctivo={correctivo} />
                <BotonImprimir />
              </>
            }
          />
          <CorrectivoForm initial={correctivo} id={correctivo.id} tcReferencia={tcRef?.valor ?? null}>
            <RevisionAutomatica c={correctivo} rucRegistro={rucRegistro} />
            <EquipoDelTicket id={correctivo.id} />
            <AvisoGarantia id={correctivo.id} />
            <CondicionesCotizacion c={correctivo} />
            <Documentos
              correctivoId={correctivo.id}
              inicial={correctivo.documentos ?? {}}
              numeroOc={correctivo.n_oc}
            />
            <MaterialesDelTicket filas={materiales} />
            <Historial filas={historial} idTicket={correctivo.id} puedeComentar={usuario?.rol === "admin"} />
          </CorrectivoForm>
          <AutoGuardarAlSalir id={correctivo.id} />
        </main>
      </div>
      <TicketImprimible c={correctivo} />
    </div>
  );
}
