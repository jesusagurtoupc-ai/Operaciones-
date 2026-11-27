"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMe, resetMe, borrarDatosSinConexion } from "@/lib/client";
import { rutaUltimaLista, type AvisoItem } from "@/components/lista/filtrosLista";
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
  // Menú lateral: cerrado por defecto; se oculta solo al elegir una sección, al cambiar de página, con Esc
  // o con un clic fuera.
  const [menuAbierto, setMenuAbierto] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMenuAbierto(false);
  }, [pathname]);
  useEffect(() => {
    if (!menuAbierto) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuAbierto(false);
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [menuAbierto]);

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

  const actual = links.find((l) => activa(l.href));

  return (
    <>
    <header className="border-t-[3px] border-t-amber border-b border-line bg-white sm:bg-white/95 sm:backdrop-blur shadow-[0_1px_0_rgba(19,23,34,0.04),0_8px_20px_-14px_rgba(19,23,34,0.25)] sticky top-0 z-20">
      <div className="max-w-7xl mx-auto px-3 sm:px-5 flex items-center justify-between h-14 sm:h-16">
        <div className="flex items-center gap-3 sm:gap-4 h-full min-w-0">
          {/* Menú lateral: se abre con este botón y se oculta solo al elegir una sección. */}
          <button
            type="button"
            onClick={() => setMenuAbierto(true)}
            aria-label="Abrir menú"
            aria-expanded={menuAbierto}
            aria-controls="menu-lateral"
            className="hidden sm:inline-flex items-center justify-center w-10 h-10 -ml-1 rounded-md text-ink hover:bg-concrete-dim"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <LogoUPC className="w-7 h-7" />
            {/* En el celular el espacio es para el campus (con el logo basta para reconocer la app). */}
            <span className={`font-display font-bold text-xl sm:text-2xl tracking-tight leading-none ${me?.campus ? "hidden sm:inline" : ""}`}>
              CORRECTIVOS
            </span>
            {actual && (
              <span className="hidden md:inline text-sm text-ink-soft truncate">
                <span className="mx-1.5 text-line-strong">/</span>
                {actual.label}
              </span>
            )}
            <SelectorCampus />
          </div>
        </div>
        <div className="flex items-center gap-3">
          {me && (me.rol === "admin" || !me.paginas || me.paginas.includes("/correctivos")) && <CampanaMontos />}
          <button type="button"
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
              <span aria-hidden="true" className="mb-0.5"><IconoMenu href={l.href} /></span>
              <span className="truncate max-w-full px-1">{l.label}</span>
            </Link>
          );
        })}
      </nav>
    </header>
    {/* El menú va fuera del <header>: su desenfoque de fondo haría que «fixed» se ubique dentro de la barra. */}
      {/* ───── Menú lateral (computador y tablet) ───── */}
      <div
        className={`no-print hidden sm:block fixed inset-0 z-40 bg-ink/40 transition-opacity duration-200 ${
          menuAbierto ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setMenuAbierto(false)}
        aria-hidden="true"
      />
      <aside
        id="menu-lateral"
        aria-label="Menú principal"
        aria-hidden={!menuAbierto}
        inert={!menuAbierto}
        className={`no-print hidden sm:flex fixed inset-y-0 left-0 z-50 w-72 flex-col bg-white text-slate-ink border-r border-line shadow-2xl transition-[transform,visibility] duration-200 ease-out ${
          menuAbierto ? "translate-x-0 visible" : "-translate-x-full invisible"
        }`}
      >
        <div className="flex items-center justify-between h-16 px-5 border-b border-line border-t-[3px] border-t-amber">
          <span className="flex items-center gap-2">
            <LogoUPC className="w-6 h-6" />
            <span className="font-display font-bold text-lg tracking-tight text-ink">CORRECTIVOS</span>
          </span>
          <button
            type="button"
            onClick={() => setMenuAbierto(false)}
            aria-label="Cerrar menú"
            className="w-8 h-8 rounded-md inline-flex items-center justify-center text-ink-soft hover:text-ink hover:bg-concrete-dim"
          >
            ✕
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {links.map((l) => {
            const active = activa(l.href);
            const href = l.href === "/correctivos" ? hrefLista : l.href;
            return (
              <Link
                key={l.href}
                href={href}
                prefetch={false}
                {...alApuntar(href)}
                // Al elegir una sección el menú se oculta solo.
                onClick={() => setMenuAbierto(false)}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                  active ? "bg-danger-soft text-amber-hover font-semibold shadow-[inset_3px_0_0_var(--amber)]" : "text-slate-ink hover:bg-concrete-dim"
                }`}
              >
                <IconoMenu href={l.href} />
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-line px-5 py-4 text-xs space-y-2">
          {me?.campus && <p className="text-ink-soft">{nombreCampus(me.campus)}</p>}
          <button
            type="button"
            onClick={logout}
            className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-left text-ink-soft hover:bg-concrete-dim hover:text-ink"
          >
            Salir
          </button>
        </div>
      </aside>

    </>
  );
}

/** Íconos de línea del menú lateral. */
function IconoMenu({ href }: { href: string }) {
  const trazos: Record<string, ReactNode> = {
    "/dashboard": <><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>,
    "/correctivos": <><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" /></>,
    "/materiales": <><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>,
    "/inventario": <><rect x="3" y="4" width="18" height="6" rx="1" /><rect x="3" y="14" width="18" height="6" rx="1" /><path d="M7 7h.01M7 17h.01" /></>,
  };
  const t = trazos[href] ?? <><path d="M4 5h16v14H4z" /><path d="M4 9h16M9 9v10" /></>;
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 opacity-90">
      {t}
    </svg>
  );
}


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
  "w-full border border-line rounded-md px-3 py-2 bg-white text-sm focus:outline-none focus:border-line-strong focus:ring-4 focus:ring-line/70";
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
      <button type="button"
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
                  className="w-full bg-slate-ink text-white rounded-md font-medium text-sm py-2.5 hover:bg-slate-hover transition-colors"
                >
                  Cerrar
                </button>
              </>
            ) : (
              <>
                <div>
                  <label className={labelCls}>Contraseña actual</label>
                  <input aria-label="Contraseña actual"
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
                  <input aria-label="Nueva contraseña (mínimo 8)"
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
                  <input aria-label="Repetir nueva contraseña"
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
                    className="flex-1 bg-slate-ink text-white rounded-md font-medium text-sm py-2.5 hover:bg-slate-hover transition-colors disabled:opacity-50"
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

/**
 * Campana de la barra superior: tickets cuya cotización, OC e informe tienen montos distintos. Se revisa al
 * cambiar de página y cada 2 minutos (con la pestaña a la vista); clic para ver la lista e ir al ticket.
 */
function CampanaMontos() {
  const pathname = usePathname();
  const [items, setItems] = useState<AvisoItem[] | null>(null);
  const [abierta, setAbierta] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const cargar = useCallback(async () => {
    try {
      const r = await fetch("/api/correctivos/avisos", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json().catch(() => null)) as { data?: AvisoItem[] } | null;
      setItems((j?.data ?? []).filter((a) => a.clave === "montos_distintos"));
    } catch {
      // sin conexión: se deja lo último que se vio
    }
  }, []);
  useEffect(() => {
    void cargar();
    setAbierta(false); // eslint-disable-line react-hooks/set-state-in-effect
  }, [pathname, cargar]);
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void cargar();
    }, 120_000);
    return () => clearInterval(t);
  }, [cargar]);
  useEffect(() => {
    if (!abierta) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierta(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierta(false);
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, [abierta]);
  const n = items?.length ?? 0;
  return (
    <div ref={caja} className="relative">
      <button
        type="button"
        onClick={() => {
          setAbierta((v) => !v);
          if (!abierta) void cargar();
        }}
        aria-label={n ? `${n} ticket${n === 1 ? "" : "s"} con montos que no coinciden` : "Alertas de montos: ninguna"}
        aria-expanded={abierta}
        title={n ? `${n} ticket${n === 1 ? "" : "s"} con montos que no coinciden` : "Los montos de cotización, OC e informe coinciden"}
        className={`relative inline-flex items-center justify-center w-9 h-9 rounded-md hover:bg-concrete-dim ${n ? "text-danger" : "text-ink-soft"}`}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {n > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-bold leading-[18px] text-center">
            {n > 99 ? "99+" : n}
          </span>
        )}
      </button>
      {abierta && (
        <div className="absolute right-0 mt-2 w-[24rem] max-w-[calc(100vw-1.5rem)] bg-white border border-line rounded-lg shadow-xl z-50 text-left">
          <div className="px-4 py-2.5 border-b border-line">
            <p className="text-sm font-semibold">Montos que no coinciden</p>
            <p className="text-xs text-ink-soft">Cotización, OC e informe de un mismo ticket deben tener el mismo monto total.</p>
          </div>
          {items === null ? (
            <p className="px-4 py-3 text-sm text-ink-soft">Revisando…</p>
          ) : n === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-soft">Todo en orden: no hay tickets con montos distintos.</p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto divide-y divide-line">
              {items.map((a) => (
                <li key={a.id}>
                  <Link href={`/correctivos/${a.id}`} prefetch={false} onClick={() => setAbierta(false)} className="block px-4 py-2.5 hover:bg-concrete-dim">
                    <p className="text-sm font-medium truncate">
                      {a.refer ? `Ref. ${a.refer}` : `Ticket ${a.id}`}
                      {a.n_oc ? ` · OC ${a.n_oc}` : ""}
                      <span className="font-normal text-ink-soft"> · {a.descripcion}</span>
                    </p>
                    <p className="text-xs text-danger mt-0.5">{a.titulo.replace(/^Los montos no coinciden: /, "")}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
