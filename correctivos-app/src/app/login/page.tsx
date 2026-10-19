"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import LogoUPC from "@/components/layout/LogoUPC";
import { resetMe } from "@/lib/client/useMe";

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
      resetMe();
      // Solo rutas internas: evita redirigir a sitios externos (//x.com, https://x.com, /\\x.com).
      const pedido = params.get("next") || "";
      const next =
        pedido.startsWith("/") && !pedido.startsWith("//") && !pedido.includes("\\")
          ? pedido
          : "/dashboard";
      router.push(next);
      router.refresh();
    } catch {
      setError("Error de conexión");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-page flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-8">
          <LogoUPC className="w-10 h-10" />
          <h1 className="font-display font-700 text-3xl tracking-tight">
            CORRECTIVOS
          </h1>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white border border-line rounded-lg shadow-card p-6 space-y-4"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft mb-4">
              Acceso al sistema
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-soft mb-1">
              Usuario
            </label>
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full border border-line rounded-md px-3 py-2 focus:outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-200/70 bg-white"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-soft mb-1">
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-line rounded-md px-3 py-2 focus:outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-200/70 bg-white"
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
            className="w-full bg-amber text-white rounded-md font-medium text-sm py-2.5 hover:bg-amber-hover transition-colors disabled:opacity-50"
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
