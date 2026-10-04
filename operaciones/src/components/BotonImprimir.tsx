"use client";

export default function BotonImprimir() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="border-2 border-ink px-4 py-2 text-sm font-mono-tag uppercase tracking-wide hover:bg-ink hover:text-concrete transition-colors"
    >
      Imprimir
    </button>
  );
}
