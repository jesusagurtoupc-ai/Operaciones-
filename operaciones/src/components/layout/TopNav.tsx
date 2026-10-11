"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import LogoUPC from "./LogoUPC";
import CambiarContrasena from "./CambiarContrasena";
import VerificacionDosPasos from "./VerificacionDosPasos";
import { useMe, resetMe } from "@/lib/client/useMe";

const LINKS = [
  { href: "/dashboard", label: "Panel" },
  { href: "/correctivos", label: "Correctivos" },
];

export default function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const me = useMe();
  const links =
    me?.rol === "admin"
      ? [
          ...LINKS,
          { href: "/correctivos/eliminados", label: "Eliminados" },
          { href: "/usuarios", label: "Usuarios" },
        ]
      : LINKS;

  async function logout(todas = false) {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ todas }),
    });
    resetMe();
    router.push("/login");
    router.refresh();
  }

  // Mismo menú para escritorio (en la barra) y celular (en una segunda fila).
  const menu = (clase: string) => (
    <nav aria-label="Principal" className={clase}>
      {links.map((l) => {
        // Gana el enlace más específico: /correctivos/eliminados no marca también "Correctivos".
        const masEspecifico = links.some(
          (o) => o.href.length > l.href.length && pathname.startsWith(o.href)
        );
        const active = pathname.startsWith(l.href) && !masEspecifico;
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex items-center px-3 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              active
                ? "text-ink border-amber"
                : "text-ink-soft border-transparent hover:text-ink hover:border-line-strong"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <header className="border-b border-line bg-concrete sticky top-0 z-20">
      <div className="max-w-7xl mx-auto px-5 flex items-center justify-between h-16">
        <div className="flex items-center gap-8 h-full">
          <div className="flex items-center gap-2">
            <LogoUPC className="w-7 h-7" />
            <span className="font-display font-700 text-2xl tracking-tight leading-none">
              CORRECTIVOS
            </span>
          </div>
          {menu("hidden sm:flex items-stretch gap-2 h-full")}
        </div>
        <div className="flex items-center gap-3">
          {me && (
            <span className="hidden sm:inline text-xs text-ink-soft">
              {me.username} · {me.rol === "admin" ? "Admin" : "Solo lectura"}
            </span>
          )}
        <CambiarContrasena />
        <VerificacionDosPasos />
        <button
          onClick={() => logout(false)}
          className="text-xs font-medium text-ink-soft hover:text-ink border border-line-strong rounded-md hover:bg-concrete-dim px-3 py-1.5 transition-colors"
        >
          Salir
        </button>
        <button
          onClick={() => {
            if (window.confirm("¿Cerrar tu sesión en todos los dispositivos?")) void logout(true);
          }}
          title="Cierra tu sesión aquí y en cualquier otro dispositivo"
          className="hidden sm:inline text-xs font-medium text-ink-soft hover:text-ink underline-offset-2 hover:underline"
        >
          Salir de todos
        </button>
        </div>
      </div>
    {menu("sm:hidden flex items-stretch gap-1 h-11 px-3 border-t border-line overflow-x-auto")}
      {me?.mfaRequerido && (
        <p role="alert" className="text-sm text-danger bg-[var(--danger-soft)] border-t border-danger/30 px-5 py-2 text-center">
          Tu cuenta de administrador debe activar la verificación en dos pasos. Usa el botón «2FA» de la barra para continuar.
        </p>
      )}
    </header>
  );
}
