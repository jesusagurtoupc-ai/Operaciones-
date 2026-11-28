// Lo que se ve MIENTRAS el servidor prepara una página (abrir un ticket, la lista, el panel): aparece al
// instante al hacer clic, en vez de quedarse la pantalla anterior sin respuesta.
export default function Cargando() {
  return (
    <div className="min-h-screen bg-page" aria-busy="true" aria-live="polite">
      {/* Igual a la barra superior real (alto y franja roja), para que la página no «salte» al cargar. */}
      <div className="h-14 sm:h-16 border-t-[3px] border-t-amber border-b border-line bg-white" />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 animate-pulse">
        <div className="h-3 w-24 rounded bg-concrete-dim" />
        <div className="mt-2 h-9 w-56 rounded bg-concrete-dim" />
        <div className="mt-5 border-b border-line" />
        <div className="mt-6 space-y-3 rounded-lg border border-line bg-white p-6 shadow-card">
          <div className="h-4 w-3/4 rounded bg-concrete-dim" />
          <div className="h-4 w-1/2 rounded bg-concrete-dim" />
          <div className="h-4 w-2/3 rounded bg-concrete-dim" />
          <div className="h-4 w-1/3 rounded bg-concrete-dim" />
        </div>
        <p className="mt-4 text-sm text-ink-soft">Cargando…</p>
      </main>
    </div>
  );
}
