import TopNav from "@/components/TopNav";
import CorrectivoForm from "@/components/CorrectivoForm";
import TicketImprimible from "@/components/TicketImprimible";
import BotonImprimir from "@/components/BotonImprimir";
import Documentos from "@/components/Documentos";
import Historial from "@/components/Historial";
import GuardarCarpeta from "@/components/GuardarCarpeta";
import AutoGuardarAlSalir from "@/components/AutoGuardarAlSalir";
import { sql, ensureSchema } from "@/lib/db";
import { notFound } from "next/navigation";
import type { Correctivo } from "@/lib/types";
import { normalizeCorrectivo } from "@/lib/types";

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
  const rows = await sql`SELECT * FROM correctivos WHERE id = ${Number(id)}`;
  const correctivo = rows[0]
    ? (normalizeCorrectivo(rows[0] as Record<string, unknown>) as unknown as Correctivo)
    : undefined;

  if (!correctivo) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-concrete">
      <div className="no-print">
        <TopNav />
        <main className="max-w-4xl mx-auto px-5 py-8">
          <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
            <h1 className="font-display font-700 text-4xl tracking-tight">
              Ticket <span className="font-mono-tag text-2xl text-ink-soft">#{correctivo.refer ?? correctivo.id}</span>
            </h1>
            <div className="flex items-start gap-2 flex-wrap">
              <GuardarCarpeta correctivo={correctivo} />
              <BotonImprimir />
            </div>
          </div>
          <CorrectivoForm initial={correctivo} id={correctivo.id}>
            <Documentos
              correctivoId={correctivo.id}
              inicial={correctivo.documentos ?? {}}
              numeroOc={correctivo.n_oc}
            />
            <Historial correctivoId={correctivo.id} />
          </CorrectivoForm>
          <AutoGuardarAlSalir id={correctivo.id} />
        </main>
      </div>
      <TicketImprimible c={correctivo} />
    </div>
  );
}
