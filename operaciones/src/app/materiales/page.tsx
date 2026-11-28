import TopNav, { CONTENEDOR, EncabezadoPagina } from "@/components/layout/TopNav";
import SolicitudMateriales from "@/components/materiales/SolicitudMateriales";

export const metadata = { title: "Solicitud de materiales" };

export default function MaterialesPage() {
  return (
    <div className="min-h-screen bg-page">
      <TopNav />
      <main className={CONTENEDOR}>
        <EncabezadoPagina
          titulo="Solicitud de materiales"
          descripcion="Busca en el catálogo, agrega las cantidades y exporta la solicitud en PDF."
        />
        <SolicitudMateriales />
      </main>
    </div>
  );
}
