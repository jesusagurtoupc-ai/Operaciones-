import TopNav from "@/components/TopNav";
import CorrectivoForm from "@/components/CorrectivoForm";
import { sql } from "@/lib/db";
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

  const rows = await sql`SELECT * FROM correctivos WHERE id = ${Number(id)}`;
  const correctivo = rows[0]
    ? (normalizeCorrectivo(rows[0] as Record<string, unknown>) as unknown as Correctivo)
    : undefined;

  if (!correctivo) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-concrete">
      <TopNav />
      <main className="max-w-4xl mx-auto px-5 py-8">
        <h1 className="font-display font-700 text-4xl tracking-tight mb-6">
          Editar Ticket <span className="font-mono-tag text-2xl text-ink-soft">#{correctivo.refer ?? correctivo.id}</span>
        </h1>
        <CorrectivoForm initial={correctivo} id={correctivo.id} />
      </main>
    </div>
  );
}
