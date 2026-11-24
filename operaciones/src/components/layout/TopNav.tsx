"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMe, resetMe, borrarDatosSinConexion } from "@/lib/client";
import { rutaUltimaLista } from "@/components/lista/filtrosLista";
import { MODULOS } from "@/lib/gestion";
import { nombreCampus } from "@/lib/shared";

const LINKS = [
  { href: "/dashboard", label: "Panel" },
  { href: "/correctivos", label: "Correctivos" },
  { href: "/materiales", label: "Materiales" },
  { href: "/inventario", label: "Inventario" },
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
  // "Gestión" (garantías, agenda, presupuesto, preventivos, reportes, informe) es una sola pestaña: lleva a la
  // primera de esas páginas a la que el usuario tiene acceso; dentro, cada una tiene su propia pestaña.
  const gestion = MODULOS.find((m) => me?.rol === "admin" || !me?.paginas || me.paginas.includes(m.href));
  const conGestion = (l: { href: string; label: string }[]) =>
    gestion ? [...l.slice(0, 4), { href: gestion.href, label: "Gestión" }, ...l.slice(4)] : l;
  const links =
    me?.rol === "admin"
      ? conGestion([
          ...LINKS,
          // Proveedores es común a todos los campus: solo lo ve quien administra todos.
        ])
      : conGestion(LINKS.filter((l) => !me?.paginas || me.paginas.includes(l.href)));
  const activa = (href: string) => (href.startsWith("/gestion") ? pathname.startsWith("/gestion") : pathname.startsWith(href));

  // La página de una pestaña se pide en cuanto el dedo toca la pantalla o el mouse se posa encima (antes
  // de soltar): al terminar el toque ya viene en camino y se abre casi al instante. Una vez por pestaña.
  const pedidas = useRef(new Set<string>());

  // Al volver a la app tras 4 minutos o más en otra pestaña (o al recuperar la conexión), se «despierta» la
  // base de datos de inmediato: cuando la persona hace clic, ya está lista y no espera el arranque.
  useEffect(() => {
    let ocultaDesde = document.visibilityState === "hidden" ? Date.now() : 0;
    const despertar = () => fetch("/api/auth/despertar", { cache: "no-store", keepalive: true }).catch(() => {});
    const alCambiar = () => {
      if (document.visibilityState === "hidden") ocultaDesde = Date.now();
      else if (ocultaDesde && Date.now() - ocultaDesde >= 4 * 60_000) {
        ocultaDesde = 0;
        despertar();
      }
    };
    document.addEventListener("visibilitychange", alCambiar);
    window.addEventListener("online", despertar);
    return () => {
      document.removeEventListener("visibilitychange", alCambiar);
      window.removeEventListener("online", despertar);
    };
  }, []);
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
            {/* En el celular el espacio es para el campus (con el logo basta para reconocer la app). */}
            <span className={`font-display font-bold text-xl sm:text-2xl tracking-tight leading-none ${me?.campus ? "hidden sm:inline" : ""}`}>
              CORRECTIVOS
            </span>
            <SelectorCampus />
          </div>
          <nav className="hidden sm:flex items-stretch gap-2 h-full">
            {links.map((l) => {
              const active = activa(l.href);
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
          const active = activa(l.href);
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
              <span aria-hidden="true" className="text-lg leading-none mb-0.5">{ICONOS[l.href] ?? (l.href.startsWith("/gestion") ? "🗂" : "•")}</span>
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
  "/inventario": "🗄",
};

/* Logo institucional (public/logo-upc.png, fondo transparente). Lo usan la barra y el inicio de sesión. */
export function LogoUPC({ className = "w-6 h-6" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/logo-upc.png" alt="" aria-hidden="true" className={`${className} object-contain`} />
  );
}

// ───────── Campus (selector de la barra) ─────────

/**
 * Campus cuyos datos se ven. Quien puede ver varios elige aquí; al cambiar se recarga la página entera
 * (la lista, el panel y las copias sin conexión son del campus anterior). Con uno solo, es un rótulo.
 */
function SelectorCampus() {
  const me = useMe();
  const [cambiando, setCambiando] = useState(false);
  if (!me?.campus) return null;
  const permitidos = me.campusPermitidos ?? [me.campus];
  const clase = "ml-1 w-auto max-w-[9rem] lg:max-w-[11rem] text-xs font-medium rounded-full border border-line-strong bg-white px-2 py-0.5 truncate";
  if (permitidos.length < 2) return <span className={`${clase} text-ink-soft`} title="Campus">{nombreCampus(me.campus)}</span>;
  async function cambiar(c: string) {
    setCambiando(true);
    const r = await fetch("/api/auth/campus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campus: c }),
    }).catch(() => null);
    if (!r?.ok) {
      setCambiando(false);
      return;
    }
    await borrarDatosSinConexion(); // las copias guardadas para usar sin internet eran del otro campus
    window.location.reload();
  }
  return (
    <select
      aria-label="Campus"
      value={me.campus}
      disabled={cambiando}
      onChange={(e) => void cambiar(e.target.value)}
      className={`${clase} text-amber-hover border-amber/50 cursor-pointer disabled:opacity-60`}
    >
      {permitidos.map((c) => <option key={c} value={c}>{nombreCampus(c)}</option>)}
    </select>
  );
}

// ───────── Cambiar contraseña (botón de la barra) ─────────

const inputCls =
  "w-full border border-line rounded-md px-3 py-2 bg-white text-sm focus:outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-200/70";
const labelCls = "block text-xs font-medium text-ink-soft mb-1";

/** Botón y ventana para cambiar la propia contraseña (se muestra en la página Panel). */
export function CambiarContrasena() {
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
        className="text-xs font-medium text-ink-soft hover:text-ink border border-line-strong rounded-md hover:bg-concrete-dim px-3 py-1.5 transition-colors"
      >
        Cambiar contraseña
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4"
          onClick={cerrar}
        >
          <form
            onSubmit={enviar}
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-line rounded-lg shadow-xl p-6 w-full max-w-sm space-y-4"
          >
            <h2 className="font-display font-bold text-2xl tracking-tight">Cambiar contraseña</h2>

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
                  <label className={labelCls}>Nueva contraseña (mínimo 8)</label>
                  <input
                    required
                    type="password"
                    minLength={8}
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
                    className="flex-1 bg-amber text-white rounded-md font-medium text-sm py-2.5 hover:bg-amber-hover transition-colors disabled:opacity-50"
                  >
                    {enviando ? "Guardando..." : "Guardar"}
                  </button>
                  <button
                    type="button"
                    onClick={cerrar}
                    className="border border-line-strong rounded-md px-4 text-sm font-medium hover:bg-concrete-dim transition-colors"
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

// ───────── Encabezado y ancho común de las páginas ─────────

/** Ancho y márgenes iguales en todas las páginas (en el celular deja sitio a la barra de abajo). */
export const CONTENEDOR = "max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8";

/**
 * Encabezado de página, igual en toda la app: sección (con el campus), título, una línea de descripción y,
 * a la derecha, las acciones de la página.
 */
export function EncabezadoPagina({
  titulo,
  descripcion,
  seccion,
  acciones,
  extra,
}: {
  titulo: ReactNode;
  descripcion?: ReactNode;
  /** Texto pequeño sobre el título (por defecto, el campus). */
  seccion?: ReactNode;
  acciones?: ReactNode;
  /** Algo junto al título (p. ej. un contador). */
  extra?: ReactNode;
}) {
  const me = useMe();
  return (
    <header className="mb-6 sm:mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-line pb-5">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber mb-1.5">
          {seccion ?? (me?.campus ? nombreCampus(me.campus) : "Operaciones")}
        </p>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="font-display font-bold text-3xl sm:text-[2.5rem] leading-none tracking-tight">{titulo}</h1>
          {extra && <span className="text-xs text-ink-soft">{extra}</span>}
        </div>
        {descripcion && <p className="mt-2 text-sm text-ink-soft max-w-3xl">{descripcion}</p>}
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
    </header>
  );
}
