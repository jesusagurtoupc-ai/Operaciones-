import TopNav from "@/components/TopNav";
import CorrectivoForm from "@/components/CorrectivoForm";

export default function NuevoCorrectivoPage() {
  return (
    <div className="min-h-screen bg-concrete">
      <TopNav />
      <main className="max-w-4xl mx-auto px-5 py-8">
        <h1 className="font-display font-700 text-4xl tracking-tight mb-6">
          Nuevo Ticket
        </h1>
        <CorrectivoForm />
      </main>
    </div>
  );
}
