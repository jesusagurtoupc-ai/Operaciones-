"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { resetMe } from "@/lib/client/useMe";
import { MIN_PASSWORD } from "@/lib/shared/passwords";

const inputCls =
  "w-full border border-line rounded-md px-3 py-2 bg-white text-sm focus:outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-200/70";
const labelCls = "block text-xs font-medium text-ink-soft mb-1";

/**
 * `forzado`: pantalla obligatoria del primer ingreso (clave temporal). Se muestra
 * abierta, sin botón de cancelar, y al terminar lleva al panel.
 */
export default function CambiarContrasena({ forzado = false }: { forzado?: boolean }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(forzado);
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
        if (forzado) {
          resetMe();
          router.push("/dashboard");
          router.refresh();
        }
      }
    } catch {
      setError("Error de conexión");
    }
    setEnviando(false);
  }

  return (
    <>
      {!forzado && (
        <button
          onClick={() => setAbierto(true)}
          className="text-xs font-medium text-ink-soft hover:text-ink border border-line-strong rounded-md hover:bg-concrete-dim px-3 py-1.5 transition-colors"
        >
          Contraseña
        </button>
      )}

      {abierto && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4"
          onClick={forzado ? undefined : cerrar}
        >
          <form
            onSubmit={enviar}
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-line rounded-lg shadow-xl p-6 w-full max-w-sm space-y-4"
          >
            <h2 className="font-display font-700 text-2xl tracking-tight">Cambiar contraseña</h2>
            {forzado && !ok && (
              <p className="text-sm text-ink-soft">
                Tu contraseña es temporal. Elige una nueva para continuar.
              </p>
            )}

            {ok ? (
              <>
                <p className="text-sm bg-teal-soft border border-teal/30 px-3 py-2">
                  Contraseña actualizada. Úsala la próxima vez que ingreses.
                </p>
                <button
                  type="button"
                  onClick={cerrar}
                  className="w-full bg-amber text-white rounded-md font-medium text-sm py-2.5 hover:bg-amber-hover transition-colors"
                >
                  Cerrar
                </button>
              </>
            ) : (
              <>
                <div>
                  <label className={labelCls} htmlFor="pw-1">Contraseña actual</label>
                  <input id="pw-1"
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
                  <label className={labelCls} htmlFor="pw-2">{`Nueva contraseña (mínimo ${MIN_PASSWORD})`}</label>
                  <input id="pw-2"
                    required
                    type="password"
                    minLength={MIN_PASSWORD}
                    autoComplete="new-password"
                    className={inputCls}
                    value={nueva}
                    onChange={(e) => setNueva(e.target.value)}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="pw-3">Repetir nueva contraseña</label>
                  <input id="pw-3"
                    required
                    type="password"
                    autoComplete="new-password"
                    className={inputCls}
                    value={repetir}
                    onChange={(e) => setRepetir(e.target.value)}
                  />
                </div>

                {error && (
                  <p role="alert" className="text-sm text-danger bg-[var(--danger-soft)] border border-danger/30 px-3 py-2">
                    {error}
                  </p>
                )}

                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={enviando}
                    className="flex-1 bg-amber text-white rounded-md font-medium text-sm py-2.5 hover:bg-amber-hover transition-colors disabled:opacity-50"
                  >
                    {enviando ? "Guardando..." : "Guardar"}
                  </button>
                  {forzado ? (
                    <button
                      type="button"
                      onClick={async () => {
                        await fetch("/api/auth/logout", { method: "POST" });
                        resetMe();
                        router.push("/login");
                        router.refresh();
                      }}
                      className="border border-line-strong rounded-md px-4 text-sm font-medium hover:bg-concrete-dim transition-colors"
                    >
                      Salir
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={cerrar}
                      className="border border-line-strong rounded-md px-4 text-sm font-medium hover:bg-concrete-dim transition-colors"
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </>
            )}
          </form>
        </div>
      )}
    </>
  );
}
