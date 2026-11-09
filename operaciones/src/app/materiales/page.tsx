import TopNav from "@/components/layout/TopNav";
import SolicitudMateriales from "@/components/materiales/SolicitudMateriales";

export const metadata = { title: "Solicitud de materiales" };

export default function MaterialesPage() {
  return (
    <div className="min-h-screen bg-page">
      <TopNav />
      <main className="max-w-6xl mx-auto px-5 py-8">
        <h1 className="font-display font-700 text-4xl tracking-tight mb-1">Solicitud de materiales</h1>
        <p className="text-sm text-ink-soft mb-6">
          Busca en el catálogo, agrega las cantidades y exporta la solicitud en PDF.
        </p>
        <SolicitudMateriales />
      </main>
    </div>
  );
}
