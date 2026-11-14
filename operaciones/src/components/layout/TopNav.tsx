"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import CambiarContrasena from "./CambiarContrasena";
import { useMe, resetMe, borrarDatosSinConexion } from "@/lib/client";
import { rutaUltimaLista } from "@/components/lista/filtrosLista";

const LINKS = [
  { href: "/dashboard", label: "Panel" },
  { href: "/correctivos", label: "Correctivos" },
  { href: "/materiales", label: "Materiales" },
];

export default function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const me = useMe();
  // La pestaña "Correctivos" vuelve a la lista tal como la dejaste (filtros, búsqueda, orden y página),
  // no a la lista vacía. Se lee al cambiar de página, en el navegador (la guarda la propia lista).
  const [hrefLista, setHrefLista] = useState("/correctivos");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHrefLista(rutaUltimaLista());
  }, [pathname]);
  const links =
    me?.rol === "admin"
      ? [...LINKS, { href: "/proveedores", label: "Proveedores" }, { href: "/usuarios", label: "Usuarios" }]
      : LINKS.filter((l) => !me?.paginas || me.paginas.includes(l.href));

  // La página de una pestaña se pide en cuanto el dedo toca la pantalla o el mouse se posa encima (antes
  // de soltar): al terminar el toque ya viene en camino y se abre casi al instante. Una vez por pestaña.
  const pedidas = useRef(new Set<string>());
  const alApuntar = (href: string) => {
    const precargar = () => {
      if (pedidas.current.has(href) || pathname === href.split("?")[0]) return;
      pedidas.current.add(href);
      router.prefetch(href);
    };
    return { onMouseEnter: precargar, onTouchStart: precargar, onFocus: precargar };
  };
  useEffect(() => {
    pedidas.current.clear(); // al cambiar de página los datos pueden haber cambiado
  }, [pathname]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    resetMe();
    await borrarDatosSinConexion();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-t-[3px] border-t-amber border-b border-line bg-white sm:bg-white/95 sm:backdrop-blur shadow-[0_1px_0_rgba(19,23,34,0.04),0_8px_20px_-14px_rgba(19,23,34,0.25)] sticky top-0 z-20">
      <div className="max-w-7xl mx-auto px-3 sm:px-5 flex items-center justify-between h-14 sm:h-16">
        <div className="flex items-center gap-8 h-full">
          <div className="flex items-center gap-2">
            <LogoUPC className="w-7 h-7" />
            <span className="font-display font-bold text-xl sm:text-2xl tracking-tight leading-none">
              CORRECTIVOS
            </span>
          </div>
          <nav className="hidden sm:flex items-stretch gap-2 h-full">
            {links.map((l) => {
              const active = pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href === "/correctivos" ? hrefLista : l.href}
                  prefetch={false} // sin precarga automática (costo en Vercel): se precarga al apuntarla
                  {...alApuntar(l.href === "/correctivos" ? hrefLista : l.href)}
                  className={`inline-flex items-center px-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    active
                      ? "text-amber-hover border-amber"
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
      {/* En el celular: barra de pestañas fija abajo, al alcance del pulgar (respeta la zona segura del iPhone). */}
      <nav className="nav-movil sm:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-line flex pb-[env(safe-area-inset-bottom)]">
        {links.map((l) => {
          const active = pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href === "/correctivos" ? hrefLista : l.href}
              prefetch={false}
              {...alApuntar(l.href === "/correctivos" ? hrefLista : l.href)}
              className={`flex-1 min-w-0 flex flex-col items-center justify-center h-14 text-[11px] font-medium border-t-2 -mt-px ${
                active ? "text-amber-hover border-amber" : "text-ink-soft border-transparent"
              }`}
            >
              <span aria-hidden="true" className="text-lg leading-none mb-0.5">{ICONOS[l.href] ?? "•"}</span>
              <span className="truncate max-w-full px-1">{l.label}</span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

const ICONOS: Record<string, string> = {
  "/dashboard": "📊",
  "/correctivos": "🛠",
  "/materiales": "📦",
  "/proveedores": "🏢",
  "/usuarios": "👤",
};

/* Logo institucional (public/logo-upc.png, fondo transparente). Lo usan la barra y el inicio de sesión. */
export function LogoUPC({ className = "w-6 h-6" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/logo-upc.png" alt="" aria-hidden="true" className={`${className} object-contain`} />
  );
}
