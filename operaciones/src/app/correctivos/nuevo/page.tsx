import TopNav from "@/components/layout/TopNav";
import NuevoDesdeOC from "@/components/ticket/NuevoDesdeOC";
import NuevasDesdeOCMasivo from "@/components/ticket/NuevasDesdeOCMasivo";

export default function NuevoCorrectivoPage() {
  return (
    <div className="min-h-screen bg-page">
      <TopNav />
      <main className="max-w-4xl mx-auto px-5 py-8">
        <h1 className="font-display font-700 text-4xl tracking-tight mb-6">
          Nuevo Ticket desde OC
        </h1>
        <NuevoDesdeOC />
        <NuevasDesdeOCMasivo />
      </main>
    </div>
  );
}
