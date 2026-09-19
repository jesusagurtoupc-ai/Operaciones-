"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo iniciar sesión");
        setLoading(false);
        return;
      }
      const next = params.get("next") || "/dashboard";
      router.push(next);
      router.refresh();
    } catch {
      setError("Error de conexión");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-concrete flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-8">
          <span className="inline-block w-3.5 h-3.5 bg-amber border border-ink" />
          <h1 className="font-display font-700 text-3xl tracking-tight">
            CORRECTIVOS
          </h1>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white border-2 border-ink p-6 space-y-4"
        >
          <div>
            <p className="font-mono-tag text-[11px] uppercase tracking-widest text-ink-soft mb-4">
              Acceso al sistema
            </p>
          </div>

          <div>
            <label className="block text-xs font-mono-tag uppercase tracking-wide text-ink-soft mb-1">
              Usuario
            </label>
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full border border-line px-3 py-2 focus:outline-none focus:border-ink bg-concrete"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-mono-tag uppercase tracking-wide text-ink-soft mb-1">
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-line px-3 py-2 focus:outline-none focus:border-ink bg-concrete"
              required
            />
          </div>

          {error && (
            <p className="text-sm text-danger bg-[var(--danger-soft)] border border-danger/30 px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-ink text-concrete font-mono-tag uppercase tracking-widest text-sm py-2.5 hover:bg-amber hover:text-ink transition-colors disabled:opacity-50"
          >
            {loading ? "Ingresando..." : "Ingresar"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
