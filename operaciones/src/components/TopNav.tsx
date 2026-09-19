"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Panel" },
  { href: "/correctivos", label: "Correctivos" },
];

export default function TopNav() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b-2 border-ink bg-concrete sticky top-0 z-20">
      <div className="max-w-7xl mx-auto px-5 flex items-center justify-between h-16">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 bg-amber border border-ink" />
            <span className="font-display font-700 text-2xl tracking-tight leading-none">
              CORRECTIVOS
            </span>
          </div>
          <nav className="hidden sm:flex items-center gap-1">
            {LINKS.map((l) => {
              const active = pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`px-3 py-1.5 text-sm font-medium font-mono-tag tracking-wide uppercase transition-colors ${
                    active
                      ? "bg-ink text-concrete"
                      : "text-ink-soft hover:text-ink hover:bg-concrete-dim"
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <button
          onClick={logout}
          className="text-xs font-mono-tag uppercase tracking-widest text-ink-soft hover:text-danger border border-line hover:border-danger px-3 py-1.5 transition-colors"
        >
          Salir
        </button>
      </div>
    </header>
  );
}
