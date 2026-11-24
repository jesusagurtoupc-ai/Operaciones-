"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import TopNav, { CONTENEDOR, EncabezadoPagina } from "@/components/layout/TopNav";
import { useMe, guardarTicketsSinConexion, marcarTicketPorCrear, ticketPorCrear } from "@/lib/client";
import {
  ESTADOS,
  DOCUMENTOS,
} from "@/lib/shared";
import type { Correctivo } from "@/lib/shared";
import { formatoSoles, formatoFecha, formatoDolares, tieneInforme } from "@/lib/shared";
import { AvanceDocs, TarjetaEstado, EstadoBadge } from "@/components/lista/Piezas";
import SelectorProveedor from "@/components/lista/SelectorProveedor";
import dynamic from "next/dynamic";

// Las cargas masivas (OC/cotizaciones/informes y "+ Documentos") son solo para administradores y son el
// código más pesado de la lista (lectores, emparejamiento): se descargan aparte, solo cuando se muestran,
// así la lista abre más rápido para todos (y los de solo lectura nunca bajan ese código).
const BotonCargando = ({ texto }: { texto: string }) => (
  <span className="border border-amber text-amber-800 rounded-md px-4 py-2 text-sm font-medium opacity-60">{texto}</span>
);
const CargaOC = dynamic(() => import("@/components/lista/CargaOC"), {
  ssr: false,
  loading: () => <BotonCargando texto="+ OC / Cotización / Informe" />,
});
import {
  DIMENSIONES,
  FILTROS_VACIOS,
  FACETAS_VACIAS,
  TITULO_GRUPO,
  ACENTO_ESTADO,
  construirParams,
  unirOrdenado,
  urlLista,
  recordarLista,
  recordarScroll,
  scrollGuardado,
  type Dimension,
  type Filtros,
  type ItemFaceta,
  type Facetas,
} from "@/components/lista/filtrosLista";

/** Primera página ya consultada por el servidor (misma forma que GET /api/correctivos). */
export type ListaInicial = {
  data: Correctivo[];
  pagination?: { page: number; pageSize: number; total: number; totalPages: number };
  resumen?: { total: number; monto: number };
  facetas?: Partial<Facetas>;
};

export default function ListaCorrectivos({
  inicial = null,
  filtrosIniciales = FILTROS_VACIOS,
  paginaInicial = 1,
}: {
  inicial?: ListaInicial | null;
  /** Filtros y página que venían en la dirección (al volver de un ticket, por ejemplo). */
  filtrosIniciales?: Filtros;
  paginaInicial?: number;
}) {
  const router = useRouter();
  const me = useMe();
  const esAdmin = me?.rol === "admin";
  const [rows, setRows] = useState<Correctivo[]>(inicial?.data ?? []);
  // "Crear ticket" desde Materiales (/correctivos?crearTicket=Ref 512): el próximo ticket que se cree
  // con una OC o cotización nace con ese N°. Se muestra una franja discreta mientras está pendiente.
  const [porCrear, setPorCrear] = useState<string | null>(null);
  useEffect(() => {
    const pedido = new URLSearchParams(window.location.search).get("crearTicket");
    if (pedido?.trim()) marcarTicketPorCrear(pedido.trim());
    setPorCrear(ticketPorCrear()); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  // Los tickets que se ven se guardan en el equipo (en segundo plano) para abrirlos luego sin internet.
  useEffect(() => {
    const t = setTimeout(() => guardarTicketsSinConexion(rows.map((r) => r.id)), 5000);
    return () => clearTimeout(t);
  }, [rows]);
  const [eliminandoId, setEliminandoId] = useState<number | null>(null);
  const [loading, setLoading] = useState(!inicial);
  const [error, setError] = useState("");
  const [page, setPage] = useState(paginaInicial);
  const [totalPages, setTotalPages] = useState(inicial?.pagination?.totalPages || 1);
  const [total, setTotal] = useState(inicial?.pagination?.total || 0);
  const [resumen, setResumen] = useState(
    inicial?.resumen ?? { total: inicial?.pagination?.total || 0, monto: 0 }
  );
  const [facetas, setFacetas] = useState<Facetas>({ ...FACETAS_VACIAS, ...(inicial?.facetas ?? {}) });
  // Todas las opciones que existen en los datos. Se acumulan para que las
  // tarjetas no aparezcan y desaparezcan al filtrar (solo se atenúan).
  const [catalogo, setCatalogo] = useState<Record<Dimension, string[]>>(() => {
    const base: Record<Dimension, string[]> = {
      estado: [...ESTADOS],
      tipo_trab: [],
      sub_tipo_trab: [],
      lugar: [],
      area: [],
      proveedor: [],
      sin: DOCUMENTOS.map((d) => d.nombre),
    };
    // Con la primera página ya traída, el catálogo se arma igual que lo haría `cargar`.
    const inicialFacetas: Facetas = { ...FACETAS_VACIAS, ...(inicial?.facetas ?? {}) };
    for (const dim of DIMENSIONES) {
      base[dim] = unirOrdenado(dim, base[dim], inicialFacetas[dim].map((i) => i.valor));
    }
    return base;
  });

  const [filtros, setFiltros] = useState<Filtros>(filtrosIniciales);
  // Siempre apunta a los filtros más recientes (para el retardo de la búsqueda).
  const filtrosActuales = useRef<Filtros>(filtrosIniciales);
  useEffect(() => {
    filtrosActuales.current = filtros;
  }, [filtros]);

  // Si se hacen varios clics seguidos, las respuestas pueden llegar en
  // desorden; solo la solicitud más reciente actualiza la pantalla.
  const solicitud = useRef(0);
  // Y la anterior se cancela: no sigue ocupando la conexión ni el ancho de banda.
  const enCurso = useRef<AbortController | null>(null);
  // Sube cuando los DATOS cambian (eliminar, restaurar, cargas masivas): solo entonces se vuelven a pedir
  // las notificaciones. Antes se pedían con cada cambio de filtro, aunque no dependen de los filtros.
  // Antes refrescaba las notificaciones (ahora están en el Panel, que se recarga al entrar).
  const [, setVersionDatos] = useState(0);
  const datosCambiaron = () => setVersionDatos((v) => v + 1);

  // `cargar` recibe los filtros explícitamente (en vez de leerlos del
  // estado del componente) para no depender de un closure que podría
  // quedar desactualizado justo después de un setFiltros().
  const cargar = useCallback(async (p: number, f: Filtros, soloPagina = false) => {
    const id = ++solicitud.current;
    enCurso.current?.abort();
    const ctl = new AbortController();
    enCurso.current = ctl;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/correctivos?${construirParams(f, p, soloPagina).toString()}`, { signal: ctl.signal });
      const data = await res.json();
      if (id !== solicitud.current) return;
      if (!res.ok) throw new Error(data?.error || "Error");

      setRows(data.data ?? []);
      setTotalPages(data.pagination?.totalPages || 1);
      setTotal(data.pagination?.total || 0);
      setPage(p);
      // La vista queda en la dirección (sin recargar la página) y se recuerda para volver desde un ticket.
      const url = urlLista(f, p);
      if (window.location.pathname === "/correctivos" && window.location.pathname + window.location.search !== url) {
        window.history.replaceState(null, "", url);
      }
      recordarLista(url);
      if (soloPagina) return; // cambio de página: tarjetas y resumen siguen igual
      setResumen(data.resumen ?? { total: data.pagination?.total || 0, monto: 0 });

      const nuevas: Facetas = { ...FACETAS_VACIAS, ...(data.facetas ?? {}) };
      setFacetas(nuevas);
      setCatalogo((prev) => {
        const sig = { ...prev };
        for (const dim of DIMENSIONES) {
          sig[dim] = unirOrdenado(dim, prev[dim], nuevas[dim].map((i) => i.valor));
        }
        return sig;
      });
    } catch {
      if (id === solicitud.current) {
        setError("No se pudieron cargar los tickets. Revisa tu conexión e intenta de nuevo.");
      }
    } finally {
      if (id === solicitud.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Si el servidor ya entregó la primera página no hace falta pedirla otra vez.
    if (!inicial) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      cargar(paginaInicial, filtrosIniciales);
    } else {
      recordarLista(urlLista(filtrosIniciales, paginaInicial));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Posición en la lista: se guarda mientras bajas y, al volver (desde un ticket o con las pestañas de
  // arriba), la lista aparece en el mismo punto, no arriba del todo.
  const pendienteRestaurar = useRef(true);
  useEffect(() => {
    if (!pendienteRestaurar.current || loading || rows.length === 0) return;
    pendienteRestaurar.current = false;
    const y = scrollGuardado(window.location.pathname + window.location.search);
    if (y && y > 0) requestAnimationFrame(() => window.scrollTo(0, y));
  }, [loading, rows]);
  useEffect(() => {
    let pendiente = 0;
    const alBajar = () => {
      if (pendiente || pendienteRestaurar.current) return;
      pendiente = requestAnimationFrame(() => {
        pendiente = 0;
        if (window.location.pathname === "/correctivos") {
          recordarScroll(window.location.pathname + window.location.search, window.scrollY);
        }
      });
    };
    window.addEventListener("scroll", alBajar, { passive: true });
    return () => {
      window.removeEventListener("scroll", alBajar);
      cancelAnimationFrame(pendiente);
    };
  }, []);

  // Cualquier cambio de filtro se aplica al instante, sin botón "Filtrar".
  function aplicarCambio(cambios: Partial<Filtros>) {
    const nuevos = { ...filtros, ...cambios };
    setFiltros(nuevos);
    cargar(1, nuevos);
  }

  // Tarjeta/opción: si estaba elegida se quita, si no se agrega (selección
  // múltiple dentro de cada categoría).
  function alternar(dim: Dimension, valor: string) {
    const actuales = filtros[dim];
    const nuevos = actuales.includes(valor)
      ? actuales.filter((v) => v !== valor)
      : [...actuales, valor];
    aplicarCambio({ [dim]: nuevos } as Partial<Filtros>);
  }

  // El texto de búsqueda se ve al instante, pero la consulta se manda un
  // instante después de que la persona deja de escribir.
  const primerRender = useRef(true);
  useEffect(() => {
    if (primerRender.current) {
      primerRender.current = false;
      return;
    }
    const t = setTimeout(() => {
      cargar(1, filtrosActuales.current);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtros.q]);

  function limpiarFiltros() {
    // El orden y la papelera no son filtros: se conservan al limpiar.
    const limpios = { ...FILTROS_VACIOS, orden: filtros.orden, papelera: filtros.papelera };
    setFiltros(limpios);
    cargar(1, limpios);
  }

  // Clic en el título "Ref" o "F. emisión": ordena por esa columna (primero de mayor a menor) y, con otro clic,
  // alterna a menor→mayor. La flecha se muestra solo en la columna que manda.
  const porFechaOc = filtros.orden === "foc_desc" || filtros.orden === "foc_asc";
  const porRef = !filtros.orden || filtros.orden === "ref_desc" || filtros.orden === "ref_asc";
  const ordenRef = filtros.orden === "ref_asc" ? "ref_asc" : "ref_desc";
  function alternarOrdenRef() {
    aplicarCambio({ orden: porRef && ordenRef === "ref_desc" ? "ref_asc" : "ref_desc" });
  }
  function alternarOrdenFechaOc() {
    aplicarCambio({ orden: filtros.orden === "foc_desc" ? "foc_asc" : "foc_desc" });
  }
  // Ordenar por otra columna: el primer toque usa el orden más útil de esa columna y el segundo lo invierte.
  function alternarOrden(primero: string, segundo: string) {
    aplicarCambio({ orden: filtros.orden === primero ? segundo : primero });
  }
  /** Título de columna que ordena al tocarlo (flecha fuerte si es la columna activa). */
  function TituloOrden({ texto, primero, segundo, ayuda, derecha }: { texto: string; primero: string; segundo: string; ayuda: string; derecha?: boolean }) {
    const activo = filtros.orden === primero || filtros.orden === segundo;
    const flecha = filtros.orden === segundo ? (primero.endsWith("_desc") ? "▲" : "▼") : primero.endsWith("_desc") ? "▼" : "▲";
    return (
      <th
        className={`${derecha ? "text-right" : "text-left"} px-3 py-3 text-xs font-semibold text-slate-ink whitespace-nowrap`}
        aria-sort={!activo ? "none" : flecha === "▲" ? "ascending" : "descending"}
      >
        <button type="button" onClick={() => alternarOrden(primero, segundo)} className="inline-flex items-center gap-1 font-medium hover:text-ink" title={ayuda}>
          {texto} <span aria-hidden="true" className={activo ? "" : "opacity-30"}>{flecha}</span>
        </button>
      </th>
    );
  }

  /* ───── Vistas guardadas (solo en este navegador, vía localStorage) ───── */
  const [vistas, setVistas] = useState<{ nombre: string; filtros: Filtros }[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("correctivos_vistas");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setVistas(JSON.parse(raw));
    } catch {
      // localStorage no disponible (modo incógnito, etc.): se ignora.
    }
  }, []);

  function persistirVistas(nuevas: { nombre: string; filtros: Filtros }[]) {
    setVistas(nuevas);
    try {
      localStorage.setItem("correctivos_vistas", JSON.stringify(nuevas));
    } catch {
      // si falla el guardado no rompemos la app, solo no persiste.
    }
  }

  function guardarVistaActual() {
    const nombre = window.prompt(
      "Nombre para esta combinación de filtros (ej. \"Pendientes pabellón A\")"
    );
    if (!nombre || !nombre.trim()) return;
    const limpio = nombre.trim();
    const sinDuplicado = vistas.filter((v) => v.nombre !== limpio);
    persistirVistas([...sinDuplicado, { nombre: limpio, filtros }]);
  }

  function aplicarVista(v: { nombre: string; filtros: Filtros }) {
    // Las vistas guardadas antes de existir un filtro no lo traen: se completan con los vacíos.
    const f = { ...FILTROS_VACIOS, ...v.filtros };
    setFiltros(f);
    cargar(1, f);
  }

  function eliminarVista(nombre: string, e: React.MouseEvent) {
    e.stopPropagation();
    persistirVistas(vistas.filter((v) => v.nombre !== nombre));
  }

  async function eliminar(r: Pick<Correctivo, "id" | "refer" | "descripcion">) {
    // Sin confirmación: va a la papelera y el aviso de abajo permite deshacerlo al instante.
    if (eliminandoId !== null) return;
    setEliminandoId(r.id);
    try {
      const res = await fetch(`/api/correctivos/${r.id}`, { method: "DELETE" });
      if (res.ok) {
        cargar(page, filtros);
        datosCambiaron();
        setEliminado({ id: r.id, refer: r.refer ?? r.id });
      } else {
        const d = await res.json().catch(() => null);
        setError(d?.error || "No se pudo eliminar el registro");
      }
    } catch {
      setError("No se pudo eliminar el registro. Revisa tu conexión e inténtalo de nuevo");
    } finally {
      setEliminandoId(null);
    }
  }

  // ───── Selección y cambio de estado desde la lista (administradores, fuera de la papelera) ─────
  const puedeSeleccionar = esAdmin && filtros.papelera !== "1";
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [estadoMasivo, setEstadoMasivo] = useState("");
  const [cambiandoId, setCambiandoId] = useState<number | null>(null);
  const [avisoEstado, setAvisoEstado] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  useEffect(() => {
    if (!avisoEstado) return;
    const t = setTimeout(() => setAvisoEstado(null), avisoEstado.tipo === "ok" ? 6000 : 12000);
    return () => clearTimeout(t);
  }, [avisoEstado]);
  // Al cambiar filtros o página, la selección se limpia (evita cambiar tickets que ya no se ven).
  useEffect(() => {
    setSeleccion(new Set());
  }, [filtros, page]);

  /** Cambia el estado de uno o varios tickets (uno tras otro, con el mismo control que la ficha). */
  async function cambiarEstado(tickets: Correctivo[], estado: string) {
    if (!estado) return;
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
    let ok = 0;
    let conFinHoy = 0;
    const fallos: string[] = [];
    for (const t of tickets) {
      if (t.estado === estado) continue;
      // Regla del informe: sin informe no se finaliza (se queda en «Por Ejecutar»).
      if (estado === "Finalizado" && !tieneInforme(t)) {
        fallos.push(`#${t.refer ?? t.id}: falta el informe`);
        continue;
      }
      setCambiandoId(t.id);
      // Para pasar a «Finalizado» se exige la fecha de fin: si falta, se pone hoy (se corrige en el ticket).
      const ponerFin = estado === "Finalizado" && !t.f_fin;
      try {
        const res = await fetch(`/api/correctivos/${t.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            estado,
            ...(ponerFin ? { f_fin: hoy } : {}),
            _original: { estado: t.estado, ...(ponerFin ? { f_fin: t.f_fin ?? null } : {}) },
          }),
        });
        if (res.ok) {
          ok++;
          if (ponerFin) conFinHoy++;
        } else {
          const d = await res.json().catch(() => null);
          fallos.push(`#${t.refer ?? t.id}: ${d?.error ?? "no se pudo guardar"}`);
        }
      } catch {
        fallos.push(`#${t.refer ?? t.id}: sin conexión`);
      }
    }
    setCambiandoId(null);
    setSeleccion(new Set());
    setEstadoMasivo("");
    cargar(page, filtrosActuales.current);
    datosCambiaron();
    if (fallos.length > 0) {
      setAvisoEstado({ tipo: "error", texto: `${ok > 0 ? `${ok} cambiado${ok === 1 ? "" : "s"} a «${estado}». ` : ""}No se pudo: ${fallos.slice(0, 3).join(" · ")}${fallos.length > 3 ? ` y ${fallos.length - 3} más` : ""}` });
    } else if (ok > 0) {
      setAvisoEstado({
        tipo: "ok",
        texto: `${ok === 1 ? "Ticket cambiado" : `${ok} tickets cambiados`} a «${estado}»${conFinHoy ? ` · F. fin = hoy en ${conFinHoy} (corrígela en el ticket si no es así)` : ""}`,
      });
    }
  }

  // Aviso «enviado a la papelera · Deshacer» (se oculta solo a los 8 segundos).
  const [eliminado, setEliminado] = useState<{ id: number; refer: number } | null>(null);
  useEffect(() => {
    if (!eliminado) return;
    const t = setTimeout(() => setEliminado(null), 8000);
    return () => clearTimeout(t);
  }, [eliminado]);
  async function deshacerEliminar() {
    if (!eliminado) return;
    const id = eliminado.id;
    setEliminado(null);
    await restaurar(id);
  }

  async function restaurar(id: number) {
    const res = await fetch(`/api/correctivos/${id}`, { method: "POST" });
    if (res.ok) {
      cargar(page, filtros);
      datosCambiaron();
    } else {
      const d = await res.json().catch(() => null);
      setError(d?.error || "No se pudo restaurar el registro");
    }
  }

  async function eliminarDefinitivo(id: number) {
    if (
      !confirm(
        "¿Eliminar DEFINITIVAMENTE este correctivo? Se borrarán también sus archivos e historial y no se podrá recuperar."
      )
    )
      return;
    const res = await fetch(`/api/correctivos/${id}?definitivo=1`, { method: "DELETE" });
    if (res.ok) {
      cargar(page, filtros);
    } else {
      const d = await res.json().catch(() => null);
      setError(d?.error || "No se pudo eliminar el registro");
    }
  }

  // Cambia entre la lista normal y la papelera (empieza sin filtros; el orden se conserva).
  function alternarPapelera() {
    const nuevos = { ...FILTROS_VACIOS, orden: filtros.orden, papelera: filtros.papelera ? "" : "1" };
    setFiltros(nuevos);
    cargar(1, nuevos);
  }

  const enPapelera = filtros.papelera === "1";

  // Filtros aplicados como etiquetas: cada una sabe cómo quitarse.
  const chipsActivos: { clave: string; grupo: string; valor: string; quitar: () => void }[] = [
    ...(filtros.q.trim() ? [{ clave: "q", grupo: "Búsqueda", valor: `«${filtros.q.trim()}»`, quitar: () => aplicarCambio({ q: "" }) }] : []),
    ...(filtros.desde || filtros.hasta
      ? [{
          clave: "fechas",
          grupo: "Registrados",
          valor: filtros.desde && filtros.hasta ? `${formatoFecha(filtros.desde)} – ${formatoFecha(filtros.hasta)}` : filtros.desde ? `desde ${formatoFecha(filtros.desde)}` : `hasta ${formatoFecha(filtros.hasta)}`,
          quitar: () => aplicarCambio({ desde: "", hasta: "" }),
        }]
      : []),
    ...DIMENSIONES.flatMap((d) =>
      filtros[d].map((v) => ({
        clave: `${d}:${v}`,
        grupo: d === "estado" ? "Estado" : TITULO_GRUPO[d],
        valor: v,
        quitar: () => aplicarCambio({ [d]: filtros[d].filter((x) => x !== v) } as Partial<Filtros>),
      }))
    ),
  ];

  const activos =
    (filtros.q.trim() ? 1 : 0) +
    (filtros.desde ? 1 : 0) +
    (filtros.hasta ? 1 : 0) +
    DIMENSIONES.reduce((n, d) => n + filtros[d].length, 0);

  // Une el catálogo (opciones que existen) con los conteos actuales.
  function itemsDe(dim: Dimension): ItemFaceta[] {
    const porValor = new Map(facetas[dim].map((i) => [i.valor, i]));
    return catalogo[dim].map((v) => porValor.get(v) ?? { valor: v, cantidad: 0, monto: 0 });
  }

  const input =
    "w-full border border-line rounded-md px-2.5 py-1.5 bg-white text-sm focus:outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-200/70";
  const label = "block text-xs font-medium text-ink-soft mb-1";

  return (
    <div className="min-h-screen bg-page">
      <TopNav />
      <main className={CONTENEDOR}>
        <EncabezadoPagina
          titulo={enPapelera ? "Papelera" : "Correctivos"}
          descripcion={enPapelera ? "Tickets eliminados: se pueden restaurar durante 30 días." : "Tickets de mantenimiento correctivo: filtra, revisa documentos y carga OC, cotizaciones e informes."}
          acciones={
          <>
            {/* Papelera, Exportar Excel y Guardar en carpeta están en la página Panel. */}
            {esAdmin && enPapelera && (
              <button
                onClick={alternarPapelera}
                className="border border-line-strong rounded-md px-4 py-2 text-sm font-medium hover:bg-concrete-dim transition-colors"
              >
                ← Volver a los tickets
              </button>
            )}
            {!enPapelera && (
              <>
              {esAdmin && <CargaOC onTerminado={() => { cargar(1, filtrosActuales.current); datosCambiaron(); setPorCrear(ticketPorCrear()); }} />}
              {esAdmin && porCrear && (
                <span className="basis-full text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-md px-3 py-1.5">
                  El próximo ticket que crees con su OC o cotización tendrá el N° <b className="font-mono-tag">{porCrear}</b> (de la
                  solicitud de materiales).{" "}
                  <button type="button" className="underline" onClick={() => { marcarTicketPorCrear(null); setPorCrear(null); }}>
                    No usar
                  </button>
                </span>
              )}

              </>
            )}
          </>
          }
        />

        {enPapelera && (
          <div className="mb-6 rounded-md border border-line bg-concrete-dim px-4 py-3 text-sm text-ink-soft">
            Aquí están los correctivos eliminados. Se conservan con sus archivos e historial: puedes
            <strong> restaurarlos</strong> o eliminarlos <strong>definitivamente</strong>. Los que lleven
            más de 30 días aquí se eliminan definitivamente de forma automática.
          </div>
        )}

        {/* ───── Panel de filtros con KPI ───── */}
        <section className="bg-white border border-line rounded-lg shadow-card mb-6">
          {/* El resumen (tickets y monto) se quitó: la cantidad se ve en «Exportar lo que veo (N)» y cada tarjeta
              de estado muestra su cantidad y monto. «Guardar vista» está junto a «Filtrando por». */}
          {vistas.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line bg-white">
              <span className="text-xs font-medium text-ink-soft mr-1">
                Vistas guardadas:
              </span>
              {vistas.map((v) => (
                <button
                  key={v.nombre}
                  type="button"
                  onClick={() => aplicarVista(v)}
                  className="group flex items-center gap-1.5 border border-line rounded-md px-2.5 py-1 text-xs hover:border-line-strong hover:bg-concrete-dim transition-colors"
                >
                  {v.nombre}
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => eliminarVista(v.nombre, e)}
                    className="text-ink-soft hover:text-ink"
                    title="Eliminar esta vista"
                  >
                    ×
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="p-4 space-y-5">
            {/* Fechas y proveedor */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="col-span-2">
                <label className={label}>Proveedor</label>
                <SelectorProveedor
                  items={itemsDe("proveedor")}
                  seleccionados={filtros.proveedor}
                  onAlternar={(v) => alternar("proveedor", v)}
                  onLimpiar={() => aplicarCambio({ proveedor: [] })}
                />
              </div>
              <div>
                <label className={label}>Desde</label>
                <input
                  type="date"
                  className={input}
                  value={filtros.desde}
                  onChange={(e) => aplicarCambio({ desde: e.target.value })}
                />
              </div>
              <div>
                <label className={label}>Hasta</label>
                <input
                  type="date"
                  className={input}
                  value={filtros.hasta}
                  onChange={(e) => aplicarCambio({ hasta: e.target.value })}
                />
              </div>
              {/* Atajos de fecha (fecha de registro del ticket) */}
              <div className="col-span-2 md:col-span-4 flex flex-wrap items-center gap-1.5 -mt-1">
                <span className="text-xs text-ink-soft mr-1">Registrados:</span>
                {ATAJOS_FECHA.map((a) => {
                  const [d, h] = a.rango();
                  const activo = filtros.desde === d && filtros.hasta === h;
                  return (
                    <button
                      key={a.texto}
                      type="button"
                      onClick={() => aplicarCambio(activo ? { desde: "", hasta: "" } : { desde: d, hasta: h })}
                      aria-pressed={activo}
                      className={`text-xs rounded-full border px-2.5 py-1 transition-colors ${
                        activo ? "bg-ink text-white border-ink" : "bg-white border-line-strong text-ink-soft hover:text-ink hover:bg-concrete-dim"
                      }`}
                    >
                      {a.texto}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Estado: tarjetas KPI */}
            <div>
              <p className={label + " !mb-2"}>
                Estado
                {filtros.estado.length > 0 && (
                  <span className="ml-2 text-ink-soft">
                    · {filtros.estado.length} elegido{filtros.estado.length === 1 ? "" : "s"}
                  </span>
                )}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                {/* Creados: todos los tickets con los demás filtros (fechas, proveedor), estén en el estado que estén.
                    Al tocarla se quitan los estados elegidos y se ven todos. */}
                <TarjetaEstado
                  etiqueta="Creados"
                  cantidad={itemsDe("estado").reduce((n, it) => n + it.cantidad, 0)}
                  monto={itemsDe("estado").reduce((n, it) => n + it.monto, 0)}
                  acento="#1e3a5f"
                  activa={filtros.estado.length === 0}
                  onClick={() => aplicarCambio({ estado: [] })}
                />
                {itemsDe("estado").map((it) => (
                  <TarjetaEstado
                    key={it.valor}
                    etiqueta={it.valor}
                    cantidad={it.cantidad}
                    monto={it.monto}
                    acento={ACENTO_ESTADO[it.valor] ?? "#8a93a3"}
                    activa={filtros.estado.includes(it.valor)}
                    onClick={() => alternar("estado", it.valor)}
                  />
                ))}
              </div>
            </div>

            {/* «Más filtros» (tipo, sub tipo, lugar, área, documento pendiente) se quitó: si una vista guardada o un
                enlace los trae, siguen funcionando y se ven como etiquetas en «Filtrando por». */}
          </div>
        </section>

        {error && (
          <p className="mb-4 text-sm text-danger bg-danger-soft border border-danger/30 px-3 py-2">
            {error}
          </p>
        )}

        {/* Las notificaciones están en la página Panel. */}

        {/* Filtros aplicados (se quitan de a uno) y exportar lo que se ve */}
        {(chipsActivos.length > 0 || !enPapelera) && (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {chipsActivos.length > 0 && <span className="text-xs text-ink-soft mr-1">Filtrando por:</span>}
            {chipsActivos.map((c) => (
              <button
                key={c.clave}
                type="button"
                onClick={c.quitar}
                className="group inline-flex items-center gap-1.5 rounded-full border border-slate-ink/25 bg-slate-soft text-slate-ink text-xs px-2.5 py-1 hover:border-slate-ink/50"
                title="Quitar este filtro"
              >
                <span className="text-ink-soft">{c.grupo}:</span> <b className="font-medium max-w-56 truncate">{c.valor}</b>
                <span aria-hidden="true" className="text-ink-soft group-hover:text-ink">×</span>
              </button>
            ))}
            {chipsActivos.length > 0 && (
              <button type="button" onClick={limpiarFiltros} className="text-xs text-ink-soft hover:text-ink underline underline-offset-2">
                Quitar todos
              </button>
            )}
            {activos > 0 && !enPapelera && (
              <button
                type="button"
                onClick={guardarVistaActual}
                className="ml-auto text-xs font-medium border border-line-strong rounded-md bg-white px-3 py-1.5 hover:bg-concrete-dim"
                title="Guarda esta combinación de filtros para volver a ella con un clic"
              >
                Guardar vista
              </button>
            )}
            {!enPapelera && (
            <a
              href={`/api/export?${construirParams(filtros).toString()}`}
              target="_blank"
              rel="noopener"
              className={`${activos > 0 ? "" : "ml-auto "}inline-flex items-center gap-1.5 text-xs font-medium border border-line-strong rounded-md bg-white px-3 py-1.5 hover:bg-concrete-dim`}
              title="Excel solo con los tickets que cumplen los filtros y la búsqueda actuales"
            >
              Exportar lo que veo ({resumen.total})
            </a>
            )}
          </div>
        )}

        {/* Barra de acciones con tickets seleccionados */}
        {puedeSeleccionar && seleccion.size > 0 && (
          <div className="sticky top-2 z-30 mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-ink text-white px-4 py-3 shadow-lg">
            <b className="text-sm">{seleccion.size} seleccionado{seleccion.size === 1 ? "" : "s"}</b>
            <label className="flex items-center gap-2 text-sm">
              Cambiar estado a
              <select
                value={estadoMasivo}
                onChange={(e) => setEstadoMasivo(e.target.value)}
                className="rounded-md border border-white/30 bg-white text-ink text-sm px-2 py-1"
              >
                <option value="">Elegir…</option>
                {ESTADOS.map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!estadoMasivo || cambiandoId !== null}
              onClick={() => cambiarEstado(rows.filter((r) => seleccion.has(r.id)), estadoMasivo)}
              className="rounded-md bg-amber hover:bg-amber-hover disabled:opacity-50 px-3 py-1.5 text-sm font-semibold"
            >
              {cambiandoId !== null ? "Guardando…" : "Aplicar"}
            </button>
            <button type="button" onClick={() => setSeleccion(new Set())} className="ml-auto text-sm text-white/70 hover:text-white underline underline-offset-2">
              Quitar selección
            </button>
          </div>
        )}
        {avisoEstado && (
          <p
            role="status"
            className={`mb-4 text-sm rounded-md border px-3 py-2 ${avisoEstado.tipo === "ok" ? "bg-teal-soft border-teal/30 text-teal" : "bg-danger-soft border-danger/30 text-danger"}`}
          >
            {avisoEstado.texto}
          </p>
        )}


        {/* ───── Tabla ───── */}
        <div
          className={`bg-white border border-line rounded-lg shadow-card overflow-x-auto transition-opacity ${
            loading && rows.length > 0 ? "opacity-50" : ""
          }`}
        >
          {/* Diseño fijo: las columnas se reparten el ancho disponible y la descripción cede espacio
              (se corta con "…"), así Estado y Docs caben en pantallas normales sin desplazarse. */}
          <table className="w-full table-fixed text-sm">
            <colgroup>
              {puedeSeleccionar && <col className="w-[40px]" />}
              <col className="w-[56px]" />
              <col className="w-[140px]" />
              <col className="w-[104px]" />
              <col />
              <col className="w-[120px]" />
              <col className="w-[112px]" />
              <col className="w-[160px]" />
              <col className="w-[88px]" />
              <col className="w-[64px] xl:w-[112px]" />
            </colgroup>
            <thead>
              <tr className="border-b border-line bg-slate-soft">
                {puedeSeleccionar && (
                  <th className="pl-3 py-3 w-[40px]">
                    <input
                      type="checkbox"
                      aria-label="Seleccionar todos los de esta página"
                      checked={rows.length > 0 && rows.every((r) => seleccion.has(r.id))}
                      ref={(el) => {
                        if (el) el.indeterminate = rows.some((r) => seleccion.has(r.id)) && !rows.every((r) => seleccion.has(r.id));
                      }}
                      onChange={(e) => {
                        const n = new Set(seleccion);
                        for (const r of rows) {
                          if (e.target.checked) n.add(r.id);
                          else n.delete(r.id);
                        }
                        setSeleccion(n);
                      }}
                    />
                  </th>
                )}
                <th className="text-left px-3 py-3 text-xs font-semibold text-slate-ink" aria-sort={!porRef ? "none" : ordenRef === "ref_asc" ? "ascending" : "descending"}>
                  <button type="button" onClick={alternarOrdenRef} className="inline-flex items-center gap-1 font-medium hover:text-ink" title="Ordenar por Ref">
                    Ref <span aria-hidden="true" className={porRef ? "" : "opacity-30"}>{porRef && ordenRef === "ref_asc" ? "▲" : "▼"}</span>
                  </button>
                </th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-slate-ink">N° OC</th>
                <th
                  className="text-left px-3 py-3 text-xs font-semibold text-slate-ink whitespace-nowrap"
                  aria-sort={filtros.orden === "foc_desc" ? "descending" : filtros.orden === "foc_asc" ? "ascending" : "none"}
                >
                  <button
                    type="button"
                    onClick={alternarOrdenFechaOc}
                    className="inline-flex items-center gap-1 font-medium hover:text-ink"
                    title="Ordenar por fecha de emisión de la OC (de la más reciente a la más antigua y al revés)"
                  >
                    F. emisión <span aria-hidden="true" className={porFechaOc ? "" : "opacity-30"}>{filtros.orden === "foc_asc" ? "▲" : "▼"}</span>
                  </button>
                </th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-slate-ink">Descripción</th>
                {TituloOrden({ texto: "Proveedor", primero: "prov_asc", segundo: "prov_desc", ayuda: "Ordenar por proveedor (A → Z y al revés)" })}
                {TituloOrden({ texto: "Monto", primero: "monto_desc", segundo: "monto_asc", ayuda: "Ordenar por monto (de mayor a menor y al revés)", derecha: true })}
                {TituloOrden({ texto: "Estado", primero: "estado_asc", segundo: "estado_desc", ayuda: "Ordenar por estado, en el orden del flujo (cotizar → Finalizado y al revés)" })}
                {TituloOrden({ texto: "Docs", primero: "docs_desc", segundo: "docs_asc", ayuda: "Ordenar por documentos pendientes (primero a los que les faltan más y al revés)" })}
                <th className="text-right px-3 py-3 text-xs font-medium text-ink-soft sticky right-0 bg-slate-soft">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={puedeSeleccionar ? 10 : 9} className="text-center py-10 text-ink-soft text-sm">
                    Cargando…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={puedeSeleccionar ? 10 : 9} className="text-center py-10 text-ink-soft text-sm">
                    {enPapelera ? "La papelera está vacía." : "No hay tickets con esta combinación de filtros."}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    onClick={() => {
                      // Un correctivo en la papelera no se abre; se restaura o se elimina.
                      if (enPapelera) return;
                      // No abrir si la persona estaba seleccionando texto.
                      if (window.getSelection()?.toString()) return;
                      router.push(`/correctivos/${r.id}`);
                    }}
                    // Al pasar el mouse se adelanta la carga del ticket: el clic abre casi al instante.
                    // Solo si el mouse se queda un momento (pasar por encima de la lista ya no precarga cada fila).
                    // En el celular, al tocar la fila se pide el ticket mientras el dedo aún está en la pantalla.
                    onTouchStart={() => {
                      if (!enPapelera) router.prefetch(`/correctivos/${r.id}`);
                    }}
                    onMouseEnter={(e) => {
                      if (enPapelera) return;
                      const fila = e.currentTarget;
                      const t = setTimeout(() => router.prefetch(`/correctivos/${r.id}`), 350);
                      fila.addEventListener("mouseleave", () => clearTimeout(t), { once: true });
                    }}
                    onKeyDown={(e) => {
                      if (!enPapelera && e.target === e.currentTarget && e.key === "Enter") {
                        router.push(`/correctivos/${r.id}`);
                      }
                    }}
                    className={`group border-b border-line last:border-b-0 hover:bg-amber/[0.04] focus:outline-none focus:bg-amber/[0.06] ${enPapelera ? "" : "cursor-pointer"}`}
                  >
                    {puedeSeleccionar && (
                      <td className="pl-3 py-3.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar el ticket ${r.refer ?? r.id}`}
                          checked={seleccion.has(r.id)}
                          onChange={() => {
                            const n = new Set(seleccion);
                            if (n.has(r.id)) n.delete(r.id);
                            else n.add(r.id);
                            setSeleccion(n);
                          }}
                        />
                      </td>
                    )}
                    <td className="px-3 py-3.5 font-mono-tag text-xs"><Resaltar texto={String(r.refer ?? r.id)} q={filtros.q} /></td>
                    <td className="px-3 py-3.5 font-mono-tag text-xs">
                      <div className="truncate" title={r.n_oc ?? undefined}>{r.n_oc ? <Resaltar texto={r.n_oc} q={filtros.q} /> : "—"}</div>
                    </td>
                    <td className="px-3 py-3.5 text-xs whitespace-nowrap tabular-nums text-ink-soft">{r.f_oc ? formatoFecha(r.f_oc) : "—"}</td>
                    <td className="px-3 py-3.5" title={r.descripcion}>
                      <div className="truncate"><Resaltar texto={r.descripcion ?? ""} q={filtros.q} /></div>
                      {enPapelera && (
                        <div className="text-xs text-ink-soft mt-0.5">
                          Eliminado por {r.eliminado_por || "—"} · {formatoFecha(r.eliminado_en ?? null)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="truncate" title={r.proveedor ?? undefined}>{r.proveedor ? <Resaltar texto={r.proveedor} q={filtros.q} /> : "—"}</div>
                    </td>
                    <td className="px-3 py-3.5 text-right font-mono-tag tabular-nums whitespace-nowrap">
                      {r.moneda === "USD" && r.monto_usd !== null && r.monto_usd !== undefined ? (
                        // En dólares: el monto de la OC y debajo su equivalente en soles (el que suman los totales).
                        <span title={r.tipo_cambio ? `Tipo de cambio ${r.tipo_cambio}` : "Sin tipo de cambio"}>
                          {formatoDolares(r.monto_usd)}
                          <span className="block text-[11px] text-ink-soft">{r.monto !== null ? formatoSoles(r.monto) : "sin T.C."}</span>
                        </span>
                      ) : (
                        formatoSoles(r.monto)
                      )}
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {puedeSeleccionar ? (
                          // Clic en la etiqueta: lista de estados para cambiarlo sin abrir el ticket.
                          <span className="relative inline-flex group/estado" onClick={(e) => e.stopPropagation()} title="Cambiar estado">
                            <EstadoBadge estado={cambiandoId === r.id ? "Guardando…" : r.estado} />
                            <span aria-hidden="true" className="ml-0.5 text-[10px] text-ink-soft opacity-0 group-hover/estado:opacity-100">▾</span>
                            <select
                              aria-label={`Estado del ticket ${r.refer ?? r.id}`}
                              value={r.estado ?? ""}
                              disabled={cambiandoId !== null}
                              onChange={(e) => cambiarEstado([r], e.target.value)}
                              className="absolute inset-0 opacity-0 cursor-pointer"
                            >
                              {!r.estado && <option value="">Sin estado</option>}
                              {ESTADOS.map((e) => (
                                <option key={e} value={e} disabled={e === "Finalizado" && r.estado !== "Finalizado" && !tieneInforme(r)}>
                                  {e}{e === "Finalizado" && r.estado !== "Finalizado" && !tieneInforme(r) ? " (falta el informe)" : ""}
                                </option>
                              ))}
                            </select>
                          </span>
                        ) : (
                          <EstadoBadge estado={r.estado} />
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3.5 whitespace-nowrap">
                      <AvanceDocs documentos={r.documentos} />
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap sticky right-0 bg-white group-hover:bg-page group-focus:bg-page">
                      {enPapelera ? (
                        <div className="flex flex-col items-end gap-1 whitespace-normal">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              restaurar(r.id);
                            }}
                            className="text-xs font-medium text-teal hover:underline"
                          >
                            Restaurar
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              eliminarDefinitivo(r.id);
                            }}
                            className="text-xs font-medium text-danger hover:underline"
                          >
                            Eliminar definitivamente
                          </button>
                        </div>
                      ) : (
                        <>
                          {esAdmin && (
                            <button
                              type="button"
                              disabled={eliminandoId !== null}
                              onClick={(e) => {
                                e.stopPropagation();
                                void eliminar(r);
                              }}
                              title="Enviar este ticket a la papelera (se puede restaurar)"
                              aria-label={`Eliminar el ticket ${r.refer ?? r.id}`}
                              className="inline-flex items-center gap-1.5 rounded-md border border-danger/40 px-2 xl:px-2.5 py-1 text-xs font-medium text-danger hover:bg-danger-soft hover:border-danger transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M3 6h18" />
                                <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                <path d="M10 11v6M14 11v6" />
                              </svg>
                              <span className="hidden xl:inline">{eliminandoId === r.id ? "Eliminando…" : "Eliminar"}</span>
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-4">
          <span className="text-xs text-ink-soft">
            {total} registro{total === 1 ? "" : "s"} · página {page} de {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => cargar(page - 1, filtros, true)}
              className="border border-line-strong rounded-md px-3 py-1 text-xs font-medium disabled:opacity-30 hover:bg-concrete-dim"
            >
              ← Anterior
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => cargar(page + 1, filtros, true)}
              className="border border-line-strong rounded-md px-3 py-1 text-xs font-medium disabled:opacity-30 hover:bg-concrete-dim"
            >
              Siguiente →
            </button>
          </div>
        </div>
        {eliminado && (
          <div
            role="status"
            className="no-print fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 bg-ink text-white text-sm rounded-lg shadow-lg px-4 py-3"
          >
            <span>Ticket #{eliminado.refer} enviado a la papelera</span>
            <button type="button" onClick={deshacerEliminar} className="font-semibold text-amber-200 hover:text-white underline underline-offset-2">
              Deshacer
            </button>
            <button type="button" onClick={() => setEliminado(null)} aria-label="Cerrar aviso" className="text-white/60 hover:text-white">
              ✕
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

/** Marca en amarillo las palabras buscadas dentro del texto (sin importar mayúsculas ni tildes). */
function Resaltar({ texto, q }: { texto: string; q: string }) {
  const palabras = q.trim().split(/\s+/).filter((p) => p.length > 0).slice(0, 6);
  if (palabras.length === 0 || !texto) return <>{texto}</>;
  // Se compara sin tildes; como quitar tildes no cambia el largo de cada letra, las posiciones coinciden.
  const plano = texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (plano.length !== texto.length) return <>{texto}</>;
  const marcas = new Array<boolean>(texto.length).fill(false);
  for (const p of palabras) {
    const buscado = p.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    for (let i = plano.indexOf(buscado); i !== -1 && buscado; i = plano.indexOf(buscado, i + buscado.length)) {
      for (let k = i; k < i + buscado.length; k++) marcas[k] = true;
    }
  }
  const partes: { t: string; m: boolean }[] = [];
  for (let i = 0; i < texto.length; i++) {
    const ult = partes[partes.length - 1];
    if (ult && ult.m === marcas[i]) ult.t += texto[i];
    else partes.push({ t: texto[i], m: marcas[i] });
  }
  return (
    <>
      {partes.map((p, i) =>
        p.m ? (
          <mark key={i} className="bg-yellow-200/80 text-inherit rounded-sm px-px">
            {p.t}
          </mark>
        ) : (
          <span key={i}>{p.t}</span>
        )
      )}
    </>
  );
}

/** Atajos de fecha de registro (en hora de Lima). */
const ATAJOS_FECHA: { texto: string; rango: () => [string, string] }[] = (() => {
  const iso = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Lima" });
  const hoyLima = () => {
    const [a, m, d] = iso(new Date()).split("-").map(Number);
    return new Date(Date.UTC(a, m - 1, d, 12));
  };
  const f = (d: Date) => d.toISOString().slice(0, 10);
  return [
    { texto: "Este mes", rango: () => { const h = hoyLima(); return [f(new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth(), 1, 12))), f(h)]; } },
    { texto: "Mes pasado", rango: () => { const h = hoyLima(); return [f(new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth() - 1, 1, 12))), f(new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth(), 0, 12)))]; } },
    { texto: "Últimos 30 días", rango: () => { const h = hoyLima(); return [f(new Date(h.getTime() - 29 * 864e5)), f(h)]; } },
    { texto: "Últimos 3 meses", rango: () => { const h = hoyLima(); return [f(new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth() - 2, 1, 12))), f(h)]; } },
    { texto: "Este año", rango: () => { const h = hoyLima(); return [`${h.getUTCFullYear()}-01-01`, f(h)]; } },
  ];
})()

