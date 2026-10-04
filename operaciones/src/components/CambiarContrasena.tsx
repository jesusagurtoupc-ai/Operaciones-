"use client";

import { useState } from "react";

const inputCls =
  "w-full border border-line px-3 py-2 bg-white text-sm focus:outline-none focus:border-ink";
const labelCls = "block text-[10px] font-mono-tag uppercase tracking-widest text-ink-soft mb-1";

export default function CambiarContrasena() {
  const [abierto, setAbierto] = useState(false);
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);
  const [enviando, setEnviando] = useState(false);

  function cerrar() {
    setAbierto(false);
    setActual("");
    setNueva("");
    setRepetir("");
    setError("");
    setOk(false);
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (nueva !== repetir) {
      setError("La confirmación no coincide con la nueva contraseña");
      return;
    }
    setEnviando(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actual, nueva }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error || "No se pudo cambiar la contraseña");
      } else {
        setOk(true);
        setActual("");
        setNueva("");
        setRepetir("");
      }
    } catch {
      setError("Error de conexión");
    }
    setEnviando(false);
  }

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        className="text-xs font-mono-tag uppercase tracking-widest text-ink-soft hover:text-ink border border-line hover:border-ink px-3 py-1.5 transition-colors"
      >
        Contraseña
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4"
          onClick={cerrar}
        >
          <form
            onSubmit={enviar}
            onClick={(e) => e.stopPropagation()}
            className="bg-white border-2 border-ink p-6 w-full max-w-sm space-y-4"
          >
            <h2 className="font-display font-700 text-2xl tracking-tight">Cambiar contraseña</h2>

            {ok ? (
              <>
                <p className="text-sm bg-teal-soft border border-teal/30 px-3 py-2">
                  Contraseña actualizada. Úsala la próxima vez que ingreses.
                </p>
                <button
                  type="button"
                  onClick={cerrar}
                  className="w-full bg-ink text-concrete font-mono-tag uppercase tracking-widest text-sm py-2.5 hover:bg-amber hover:text-ink transition-colors"
                >
                  Cerrar
                </button>
              </>
            ) : (
              <>
                <div>
                  <label className={labelCls}>Contraseña actual</label>
                  <input
                    autoFocus
                    required
                    type="password"
                    autoComplete="current-password"
                    className={inputCls}
                    value={actual}
                    onChange={(e) => setActual(e.target.value)}
                  />
                </div>
                <div>
                  <label className={labelCls}>Nueva contraseña (mínimo 6)</label>
                  <input
                    required
                    type="password"
                    minLength={6}
                    autoComplete="new-password"
                    className={inputCls}
                    value={nueva}
                    onChange={(e) => setNueva(e.target.value)}
                  />
                </div>
                <div>
                  <label className={labelCls}>Repetir nueva contraseña</label>
                  <input
                    required
                    type="password"
                    autoComplete="new-password"
                    className={inputCls}
                    value={repetir}
                    onChange={(e) => setRepetir(e.target.value)}
                  />
                </div>

                {error && (
                  <p className="text-sm text-danger bg-[var(--danger-soft)] border border-danger/30 px-3 py-2">
                    {error}
                  </p>
                )}

                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={enviando}
                    className="flex-1 bg-ink text-concrete font-mono-tag uppercase tracking-widest text-sm py-2.5 hover:bg-amber hover:text-ink transition-colors disabled:opacity-50"
                  >
                    {enviando ? "Guardando..." : "Guardar"}
                  </button>
                  <button
                    type="button"
                    onClick={cerrar}
                    className="border border-line px-4 text-sm font-mono-tag uppercase tracking-wide hover:border-ink transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </>
            )}
          </form>
        </div>
      )}
    </>
  );
}
