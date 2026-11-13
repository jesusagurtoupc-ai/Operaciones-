import TopNav from "@/components/layout/TopNav";

// Se muestra al instante mientras el servidor prepara la lista (p. ej. si la base está despertando).
export default function Loading() {
  return (
    <div className="min-h-screen bg-page">
      <TopNav />
      <main className="max-w-7xl mx-auto px-5 py-8">
        <p className="text-sm text-ink-soft">Cargando tickets…</p>
      </main>
    </div>
  );
}
