"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import LogoUPC from "./LogoUPC";
import CambiarContrasena from "./CambiarContrasena";
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
      ? [...LINKS, { href: "/usuarios", label: "Usuarios" }]
      : LINKS;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    resetMe();
    router.push("/login");
    router.refresh();
  }

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
          <nav className="hidden sm:flex items-stretch gap-2 h-full">
            {links.map((l) => {
              const active = pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`inline-flex items-center px-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
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
        </div>
        <div className="flex items-center gap-3">
          {me && (
            <span className="hidden sm:inline text-xs text-ink-soft">
              {me.username} · {me.rol === "admin" ? "Admin" : "Solo lectura"}
            </span>
          )}
        <CambiarContrasena />
        <button
          onClick={logout}
          className="text-xs font-medium text-ink-soft hover:text-ink border border-line-strong rounded-md hover:bg-concrete-dim px-3 py-1.5 transition-colors"
        >
          Salir
        </button>
        </div>
      </div>
    </header>
  );
}
