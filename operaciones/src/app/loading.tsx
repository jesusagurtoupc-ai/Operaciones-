// Lo que se ve MIENTRAS el servidor prepara una página (abrir un ticket, la lista, el panel): aparece al
// instante al hacer clic, en vez de quedarse la pantalla anterior sin respuesta.
export default function Cargando() {
  return (
    <div className="min-h-screen bg-page" aria-busy="true" aria-live="polite">
      <div className="h-14 border-b border-line bg-white" />
      <main className="max-w-4xl mx-auto px-5 py-8 animate-pulse">
        <div className="h-9 w-56 rounded bg-concrete-dim" />
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
