import TopNav from "@/components/layout/TopNav";
import CorrectivoForm from "@/components/ticket/CorrectivoForm";
import TicketImprimible from "@/components/ticket/TicketImprimible";
import BotonImprimir from "@/components/ticket/BotonImprimir";
import Documentos from "@/components/ticket/Documentos";
import Historial, { leerHistorial } from "@/components/ticket/Historial";
import CondicionesCotizacion from "@/components/ticket/CondicionesCotizacion";
import GuardarCarpeta from "@/components/ticket/GuardarCarpeta";
import AutoGuardarAlSalir from "@/components/ticket/AutoGuardarAlSalir";
import { sql, ensureSchema } from "@/lib/server/db";
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
  // El ticket y su historial se piden a la vez (antes el historial esperaba al ticket: una ida y
  // vuelta más a la base en cada apertura).
  const [rows, historial] = await Promise.all([
    sql`SELECT * FROM correctivos WHERE id = ${Number(id)} AND eliminado_en IS NULL`,
    leerHistorial(Number(id)),
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
        <main className="max-w-4xl mx-auto px-5 py-8">
          <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
            <h1 className="font-display font-bold text-4xl tracking-tight">
              Ticket <span className="font-mono-tag text-2xl text-ink-soft">#{correctivo.refer ?? correctivo.id}</span>
            </h1>
            <div className="flex items-start gap-2 flex-wrap">
              <GuardarCarpeta correctivo={correctivo} />
              <BotonImprimir />
            </div>
          </div>
          <CorrectivoForm initial={correctivo} id={correctivo.id}>
            <CondicionesCotizacion c={correctivo} />
            <Documentos
              correctivoId={correctivo.id}
              inicial={correctivo.documentos ?? {}}
              numeroOc={correctivo.n_oc}
            />
            <Historial filas={historial} />
          </CorrectivoForm>
          <AutoGuardarAlSalir id={correctivo.id} />
        </main>
      </div>
      <TicketImprimible c={correctivo} />
    </div>
  );
}
