"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useMe } from "@/lib/client";
import AgregarMateriales from "./AgregarMateriales";
import FotosMaterial, { fotosParaPdf } from "./FotosMaterial";

const CLAVE_NUMERO = "solicitud-materiales:numero";
import {
  type Cabecera,
  type Catalogo,
  type ArchivoCatalogo,
  type ArchivoFuera,
  type CatalogoFuera,
  type ItemFuera,
  type Linea,
  CABECERA_VACIA,
  CLAVE_BORRADOR,
  CLAVE_FAVORITOS,
  CLAVE_FAVORITOS_SEMILLA,
  URL_FUERA_CATALOGO,
  type Favorito,
  IGV,
  LIMITES,
  MAX_LINEAS,
  buscarCatalogo,
  buscarFuera,
  claveFavorito,
  fusionarLineas,
  calcularTotales,
  fechaCorta,
  hoyLimaISO,
  leerBorrador,
  leerFavoritos,
  registrarFavoritos,
  lineaDeCatalogo,
  lineaDeFuera,
  nuevoUid,
  numero2,
  precioUnitario,
  prepararCatalogo,
  prepararFuera,
  sembrarFavoritos,
  preciosVencidos,
  simbolo,
  subtotalLinea,
  validarSolicitud,
} from "@/lib/materiales";

const URL_CATALOGO = "/catalogo-materiales.json";

// El catálogo (15 mil artículos) se descarga una sola vez por sesión del navegador.
/** Huella de las líneas (sin su id interno) para saber si cambiaron. Vacío = sin materiales. */
function firmaLineas(ls: Linea[]): string {
  if (ls.length === 0) return "";
  return JSON.stringify(ls.map(({ uid, cantidad, ...r }) => (void uid, { ...r, cantidad: Number.isFinite(cantidad) ? cantidad : 0 })));
}

let catalogoCargado: Promise<Catalogo> | null = null;
function cargarCatalogo(): Promise<Catalogo> {
  if (!catalogoCargado) {
    catalogoCargado = fetch(URL_CATALOGO)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ArchivoCatalogo>;
      })
      .then(prepararCatalogo)
      .catch((e) => {
        catalogoCargado = null; // permite reintentar
        throw e;
      });
  }
  return catalogoCargado;
}

// La lista de materiales fuera del catálogo es corta (unas decenas): también se descarga una sola vez.
let fueraCargado: Promise<CatalogoFuera> | null = null;
function cargarFuera(): Promise<CatalogoFuera> {
  if (!fueraCargado) {
    fueraCargado = fetch(URL_FUERA_CATALOGO)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ArchivoFuera>;
      })
      .then(prepararFuera)
      .catch((e) => {
        fueraCargado = null; // permite reintentar
        throw e;
      });
  }
  return fueraCargado;
}

const inputCls =
  "w-full border border-line rounded-md px-3 py-2 bg-white text-sm focus:outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-200/70";
const labelCls = "block text-xs font-medium text-ink-soft mb-1";
const tarjeta = "bg-white border border-line rounded-lg shadow-card p-5";
const botonPrimario =
  "bg-amber border border-amber text-white rounded-md px-5 py-2.5 text-sm font-medium hover:bg-amber-hover hover:border-amber-hover transition-colors disabled:opacity-50";
const botonSecundario =
  "border border-line-strong rounded-md px-4 py-2 text-sm font-medium hover:bg-concrete-dim transition-colors disabled:opacity-50";

/** Cantidad editable: deja escribir "2." o "0,5" sin que el valor se "corrija" mientras se teclea. */
function CantidadInput({ valor, onChange, etiqueta }: { valor: number; onChange: (n: number) => void; etiqueta: string }) {
  const [texto, setTexto] = useState<string | null>(null); // null = mostrar el valor guardado
  const invalida = !Number.isFinite(valor) || valor <= 0;
  return (
    <input
      inputMode="decimal"
      aria-label={etiqueta}
      aria-invalid={invalida}
      className={`w-20 border rounded-md px-2 py-1.5 text-sm text-right font-mono-tag focus:outline-none focus:ring-4 focus:ring-slate-200/70 ${
        invalida ? "border-danger bg-[var(--danger-soft)]" : "border-line bg-white"
      }`}
      value={texto ?? (Number.isFinite(valor) ? String(valor) : "")}
      onChange={(e) => {
        setTexto(e.target.value);
        const n = parseFloat(e.target.value.replace(",", "."));
        onChange(Number.isFinite(n) ? n : NaN);
      }}
      onBlur={() => setTexto(null)}
    />
  );
}

export default function SolicitudMateriales() {
  const me = useMe();
  // Fotos de los materiales fuera del catálogo: todos las ven; los administradores las agregan y borran.
  const editaFotos = me?.rol === "admin";
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [errorCatalogo, setErrorCatalogo] = useState("");
  const [intento, setIntento] = useState(0);

  const [consulta, setConsulta] = useState("");
  const consultaDiferida = useDeferredValue(consulta);
  // Ya no hay formulario de datos de la solicitud: el solicitante y la fecha se toman al exportar.
  const cabecera: Cabecera = CABECERA_VACIA;
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [libre, setLibre] = useState({ descripcion: "", cantidad: "1", unidad: "", precio: "" });
  const [errorLibre, setErrorLibre] = useState("");
  const [errores, setErrores] = useState<string[]>([]);
  const [aviso, setAviso] = useState("");
  const [exportando, setExportando] = useState(false);
  const [borradorListo, setBorradorListo] = useState(false);
  const [favoritos, setFavoritos] = useState<Favorito[]>([]);
  const [favoritosListos, setFavoritosListos] = useState(false);
  const [fuera, setFuera] = useState<CatalogoFuera | null>(null);
  const [abrirAgregar, setAbrirAgregar] = useState(false);
  const refTabla = useRef<HTMLDivElement>(null);

  const hoy = hoyLimaISO();

  // 1) Catálogo
  useEffect(() => {
    let vivo = true;
    cargarCatalogo()
      .then((c) => {
        if (vivo) {
          setCatalogo(c);
          setErrorCatalogo("");
        }
      })
      .catch(() => vivo && setErrorCatalogo("No se pudo cargar el catálogo de materiales."));
    return () => {
      vivo = false;
    };
  }, [intento]);

  // 1b) Materiales fuera del catálogo (salen de órdenes de compra anteriores)
  useEffect(() => {
    let vivo = true;
    cargarFuera()
      .then((c) => vivo && setFuera(c))
      .catch((e) => console.error("No se pudo cargar los materiales fuera del catálogo", e));
    return () => {
      vivo = false;
    };
  }, [intento]);

  // 2) Borrador de la solicitud: se guarda en este navegador Y en el servidor (por usuario), así los
  //    materiales elegidos no se pierden al cambiar de navegador o de equipo. `t` = momento de la última
  //    edición: manda la copia más reciente.
  const lineasRef = useRef(lineas);
  useEffect(() => {
    lineasRef.current = lineas;
  });
  const tBorrador = useRef(0);
  const firmaLocal = useRef("");
  const firmaServidor = useRef("");
  const [servidorListo, setServidorListo] = useState(false);

  useEffect(() => {
    let vivo = true;
    let crudo: string | null = null;
    try {
      crudo = localStorage.getItem(CLAVE_BORRADOR);
    } catch {
      /* sin almacenamiento: se empieza en blanco */
    }
    const b = leerBorrador(crudo);
    try {
      tBorrador.current = Number(JSON.parse(crudo ?? "null")?.t) || 0;
    } catch {
      tBorrador.current = 0;
    }
    const restauradas = b?.lineas ?? [];
    firmaLocal.current = firmaLineas(restauradas);
    if (b) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLineas(restauradas);
    }
    setBorradorListo(true);

    // Copia del servidor: si es más reciente que la de este navegador, se usa esa.
    const ctl = new AbortController();
    const espera = setTimeout(() => ctl.abort(), 8000);
    (async () => {
      try {
        const r = await fetch("/api/materiales/borrador", { cache: "no-store", signal: ctl.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = (await r.json()) as { data: { lineas: unknown; t: number } | null };
        if (!vivo) return;
        const srv = d.data;
        const delServidor = srv ? (leerBorrador(JSON.stringify({ lineas: srv.lineas }))?.lineas ?? []) : [];
        firmaServidor.current = firmaLineas(delServidor);
        // Solo se reemplaza si la persona no tocó nada mientras llegaba la respuesta.
        if (srv && srv.t > tBorrador.current && firmaLineas(lineasRef.current) === firmaLocal.current) {
          tBorrador.current = srv.t;
          firmaLocal.current = firmaLineas(delServidor);
          setLineas(delServidor);
        }
        setServidorListo(true);
      } catch {
        /* sin servidor: queda el guardado de este navegador */
      } finally {
        clearTimeout(espera);
      }
    })();
    return () => {
      vivo = false;
      clearTimeout(espera);
      ctl.abort();
    };
  }, []);

  // Guardado en este navegador (al instante)
  useEffect(() => {
    if (!borradorListo) return;
    const f = firmaLineas(lineas);
    if (f !== firmaLocal.current) {
      firmaLocal.current = f;
      tBorrador.current = Date.now();
    }
    try {
      // una cantidad inválida (NaN) se guarda como 0 para no perder la línea
      const seguras = lineas.map((l) => ({ ...l, cantidad: Number.isFinite(l.cantidad) ? l.cantidad : 0 }));
      localStorage.setItem(CLAVE_BORRADOR, JSON.stringify({ cabecera, lineas: seguras, t: tBorrador.current }));
    } catch {
      /* sin almacenamiento: no pasa nada */
    }
  }, [cabecera, lineas, borradorListo]);

  // Guardado en el servidor (con una pequeña espera para no enviar en cada tecla)
  async function enviarBorrador(ls: Linea[], keepalive = false) {
    const f = firmaLineas(ls);
    if (f === firmaServidor.current) return;
    try {
      const r = await fetch("/api/materiales/borrador", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineas: ls.map((l) => ({ ...l, cantidad: Number.isFinite(l.cantidad) ? l.cantidad : 0 })),
          t: tBorrador.current,
        }),
        keepalive,
      });
      if (r.ok) firmaServidor.current = f;
    } catch {
      /* se reintenta en el próximo cambio */
    }
  }
  useEffect(() => {
    if (!servidorListo) return;
    const id = setTimeout(() => void enviarBorrador(lineas), 700);
    return () => clearTimeout(id);
  }, [lineas, servidorListo]);
  // Al salir de la página o cambiar de pestaña se envía lo pendiente
  useEffect(() => {
    if (!servidorListo) return;
    const alSalir = () => {
      if (document.visibilityState === "hidden") void enviarBorrador(lineasRef.current, true);
    };
    document.addEventListener("visibilitychange", alSalir);
    window.addEventListener("pagehide", alSalir);
    return () => {
      document.removeEventListener("visibilitychange", alSalir);
      window.removeEventListener("pagehide", alSalir);
    };
  }, [servidorListo]);

  // 3) Materiales favoritos (todo lo que alguna vez se solicitó), guardados en este navegador
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFavoritos(leerFavoritos(localStorage.getItem(CLAVE_FAVORITOS)));
    } catch {
      /* sin almacenamiento: la lista empieza vacía */
    }
    setFavoritosListos(true);
  }, []);
  function guardarFavoritos(nuevos: Favorito[]) {
    setFavoritos(nuevos);
    try {
      localStorage.setItem(CLAVE_FAVORITOS, JSON.stringify(nuevos));
    } catch {
      /* sin almacenamiento: no pasa nada */
    }
  }
  // Una sola vez por versión de la lista: suma a los favoritos los materiales fuera del catálogo que falten.
  // Si después se borra uno, no vuelve a aparecer (la versión ya quedó anotada en este navegador).
  useEffect(() => {
    if (!favoritosListos || !fuera) return;
    try {
      if (localStorage.getItem(CLAVE_FAVORITOS_SEMILLA) === String(fuera.version)) return;
      const actuales = leerFavoritos(localStorage.getItem(CLAVE_FAVORITOS));
      const nuevos = sembrarFavoritos(actuales, fuera);
      localStorage.setItem(CLAVE_FAVORITOS, JSON.stringify(nuevos));
      localStorage.setItem(CLAVE_FAVORITOS_SEMILLA, String(fuera.version));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFavoritos(nuevos);
    } catch {
      /* sin almacenamiento: no se puede sembrar, la lista fuera de catálogo sigue disponible arriba */
    }
  }, [favoritosListos, fuera]);
  const borrarFavorito = (clave: string) => guardarFavoritos(favoritos.filter((f) => f.clave !== clave));

  const resultados = useMemo(
    () => (catalogo ? buscarCatalogo(catalogo, consultaDiferida) : { items: [], total: 0 }),
    [catalogo, consultaDiferida]
  );
  const resultadosFuera = useMemo(
    // oculta hasta que se escribe una búsqueda, igual que el catálogo
    () => (fuera && consultaDiferida.trim() !== "" ? buscarFuera(fuera, consultaDiferida) : { items: [] as ItemFuera[], total: 0 }),
    [fuera, consultaDiferida]
  );
  const totales = useMemo(() => calcularTotales(lineas), [lineas]);
  const vencidos = useMemo(() => preciosVencidos(lineas, hoy), [lineas, hoy]);
  const enSolicitud = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lineas) if (l.codigo) m.set(l.codigo, l.cantidad);
    return m;
  }, [lineas]);
  // materiales sin código (fuera del catálogo) ya en la solicitud, por la misma clave que usan los favoritos
  const libresEnSolicitud = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lineas) if (!l.codigo) m.set(claveFavorito(l), l.cantidad);
    return m;
  }, [lineas]);


  function agregarDelCatalogo(it: Parameters<typeof lineaDeCatalogo>[0]) {
    setErrores([]);
    setAviso("");
    if (!enSolicitud.has(it.articulo) && lineas.length >= MAX_LINEAS) {
      setErrores([`Una solicitud admite hasta ${MAX_LINEAS} materiales.`]);
      return;
    }
    setLineas((ls) => {
      const i = ls.findIndex((l) => l.codigo === it.articulo);
      if (i >= 0) return ls.map((l, k) => (k === i ? { ...l, cantidad: (Number.isFinite(l.cantidad) ? l.cantidad : 0) + 1 } : l));
      return [...ls, lineaDeCatalogo(it)];
    });
  }

  function agregarDeFuera(it: ItemFuera) {
    setErrores([]);
    setAviso("");
    if (!libresEnSolicitud.has(it.clave) && lineas.length >= MAX_LINEAS) {
      setErrores([`Una solicitud admite hasta ${MAX_LINEAS} materiales.`]);
      return;
    }
    setLineas((ls) => {
      const i = ls.findIndex((l) => !l.codigo && claveFavorito(l) === it.clave);
      if (i >= 0) return ls.map((l, k) => (k === i ? { ...l, cantidad: (Number.isFinite(l.cantidad) ? l.cantidad : 0) + 1 } : l));
      return [...ls, lineaDeFuera(it)];
    });
  }

  /** Vuelve a pedir un favorito: del catálogo, de la lista fuera de catálogo o, si no está en ninguna, como material libre sin precio. */
  function agregarFavorito(f: Favorito) {
    setErrores([]);
    setAviso("");
    if (f.codigo) {
      if (!catalogo) return setErrores(["El catálogo todavía se está cargando. Inténtalo en unos segundos."]);
      const it = catalogo.items.find((x) => x.articulo === f.codigo);
      if (!it) return setErrores([`El artículo ${f.codigo} ya no está en el catálogo actual.`]);
      return agregarDelCatalogo(it);
    }
    const it = fuera?.items.find((x) => x.clave === f.clave);
    if (it) return agregarDeFuera(it);
    if (!libresEnSolicitud.has(f.clave) && lineas.length >= MAX_LINEAS) {
      return setErrores([`Una solicitud admite hasta ${MAX_LINEAS} materiales.`]);
    }
    setLineas((ls) => {
      const i = ls.findIndex((l) => !l.codigo && claveFavorito(l) === f.clave);
      if (i >= 0) return ls.map((l, k) => (k === i ? { ...l, cantidad: (Number.isFinite(l.cantidad) ? l.cantidad : 0) + 1 } : l));
      return [
        ...ls,
        { uid: nuevoUid(), codigo: null, descripcion: f.descripcion, cantidad: 1, unidad: f.unidad, precio: null, moneda: "PEN", vence: null, proveedor: null, minimo: null, entrega: null },
      ];
    });
  }

  /** Desde el botón superior: suma varias líneas (manual o Excel) uniendo las repetidas. */
  function agregarVarias(nuevas: Linea[]) {
    setErrores([]);
    setAviso("");
    const { lineas: res, omitidas } = fusionarLineas(lineas, nuevas);
    setLineas(res);
    if (omitidas > 0) setErrores([`Una solicitud admite hasta ${MAX_LINEAS} materiales: ${omitidas} no se agregaron.`]);
  }

  function agregarLibre() {
    const descripcion = libre.descripcion.trim();
    const cantidad = parseFloat(libre.cantidad.replace(",", "."));
    const precioTxt = libre.precio.trim();
    const precio = precioTxt === "" ? null : parseFloat(precioTxt.replace(",", "."));
    if (!descripcion) return setErrorLibre("Escribe la descripción del material.");
    if (!Number.isFinite(cantidad) || cantidad <= 0) return setErrorLibre("La cantidad debe ser mayor que cero.");
    if (precio !== null && (!Number.isFinite(precio) || precio < 0)) return setErrorLibre("El precio no es válido.");
    if (lineas.length >= MAX_LINEAS) return setErrorLibre(`Una solicitud admite hasta ${MAX_LINEAS} materiales.`);
    setErrorLibre("");
    setErrores([]);
    setAviso("");
    setLineas((ls) => [
      ...ls,
      {
        uid: nuevoUid(),
        codigo: null,
        descripcion: descripcion.slice(0, LIMITES.descripcion),
        cantidad,
        unidad: libre.unidad.trim().slice(0, LIMITES.unidad),
        precio,
        moneda: "PEN",
        vence: null,
        proveedor: null,
        minimo: null,
        entrega: null,
      },
    ]);
    setLibre({ descripcion: "", cantidad: "1", unidad: "", precio: "" });
  }

  const cambiarCantidad = (uid: string, n: number) => setLineas((ls) => ls.map((l) => (l.uid === uid ? { ...l, cantidad: n } : l)));
  const cambiarTicket = (uid: string, t: string) =>
    setLineas((ls) => ls.map((l) => (l.uid === uid ? { ...l, ticket: t.slice(0, LIMITES.ticket) } : l)));
  const ticketATodas = (t: string) => setLineas((ls) => ls.map((l) => ({ ...l, ticket: t })));
  // Un material recién agregado toma el N° de ticket de la línea anterior (se puede cambiar).
  useEffect(() => {
    if (!lineas.some((l) => l.ticket === undefined)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLineas((ls) => {
      let previo = "";
      return ls.map((l) => {
        const t = l.ticket === undefined ? previo : l.ticket;
        previo = t;
        return l.ticket === undefined ? { ...l, ticket: t } : l;
      });
    });
  }, [lineas]);
  const quitar = (uid: string) => setLineas((ls) => ls.filter((l) => l.uid !== uid));

  // ── N° de solicitud: SI-<año>-<n>, correlativo para todos (lo da el servidor) ──
  // Se pide la primera vez que se genera el PDF, la vista previa o el Excel, y se mantiene para esta
  // solicitud (también al recargar la página) hasta que se vacía para empezar otra.
  const [numeroSol, setNumeroSol] = useState<string>("");
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNumeroSol(localStorage.getItem(CLAVE_NUMERO) ?? "");
    } catch {
      /* sin almacenamiento */
    }
  }, []);
  async function numeroDeSolicitud(): Promise<string> {
    if (numeroSol) return numeroSol;
    const res = await fetch("/api/materiales/borrador", { method: "POST" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.data?.numero) throw new Error(d.error || "No se pudo asignar el N° de solicitud");
    const n = String(d.data.numero);
    setNumeroSol(n);
    try {
      localStorage.setItem(CLAVE_NUMERO, n);
    } catch {
      /* sin almacenamiento: dura mientras la página está abierta */
    }
    return n;
  }

  function vaciar() {
    if (lineas.length > 0 && !confirm("¿Vaciar la solicitud? Se quitarán todos los materiales.")) return;
    // Solicitud nueva: la próxima exportación recibe el siguiente número.
    setNumeroSol("");
    try {
      localStorage.removeItem(CLAVE_NUMERO);
    } catch {
      /* sin almacenamiento */
    }
    setLineas([]);
    setErrores([]);
    setAviso("");
  }

  /** Arma el PDF de la solicitud (no lo descarga). null si faltan datos o falló. */
  async function generarPdf(): Promise<{ url: string; nombre: string } | null> {
    setAviso("");
    const solicitante = cabecera.solicitante.trim() || me?.username || "";
    const cab = { ...cabecera, solicitante, fecha: cabecera.fecha || hoy };
    const errs = validarSolicitud(cab, lineas);
    setErrores(errs);
    if (errs.length > 0) return null;
    setExportando(true);
    try {
      const ahora = new Date();
      const partes = new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/Lima",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(ahora); // "15:30"
      const numero = await numeroDeSolicitud();
      // pdf-lib se descarga solo ahora, no al abrir la página
      // pdf-lib y las fotos de los materiales fuera del catálogo se piden a la vez.
      const [{ crearPdfSolicitud }, fotos] = await Promise.all([
        import("@/lib/solicitudPdf"),
        fotosParaPdf(lineas.filter((l) => l.codigo === null).map((l) => ({ uid: l.uid, clave: claveFavorito(l) }))),
      ]);
      const bytes = await crearPdfSolicitud({
        fotos,
        numero,
        cabecera: cab,
        lineas,
        catalogoTitulo: catalogo?.titulo,
        hoy: hoyLimaISO(ahora),
        generado: `${fechaCorta(hoyLimaISO(ahora))} ${partes}`,
      });
      const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }));
      return { url, nombre: `solicitud-materiales-${numero}.pdf` };
    } catch (e) {
      console.error(e);
      setErrores(["No se pudo generar el PDF. Inténtalo de nuevo."]);
      return null;
    } finally {
      setExportando(false);
    }
  }

  // ── Excel con los materiales DEL CATÁLOGO: toda su información, cantidad, costo, subtotal, IGV y total ──
  const lineasCatalogo = lineas.filter((l) => l.codigo).length;
  const [generandoExcel, setGenerandoExcel] = useState(false);
  async function exportarExcelCatalogo() {
    setAviso("");
    setGenerandoExcel(true);
    try {
      const ahora = new Date();
      const numero = await numeroDeSolicitud();
      const { descargarExcelCatalogo } = await import("@/lib/importarExcel");
      const n = await descargarExcelCatalogo(lineas, catalogo, { numero, fecha: fechaCorta(hoyLimaISO(ahora)), igv: IGV });
      setAviso(n > 0 ? `Excel generado con ${n} material${n === 1 ? "" : "es"} del catálogo.` : "La solicitud no tiene materiales del catálogo.");
    } catch (e) {
      console.error(e);
      setErrores(["No se pudo generar el Excel. Inténtalo de nuevo."]);
    } finally {
      setGenerandoExcel(false);
    }
  }

  /** Descarga el PDF y lo cuenta como solicitud hecha (suma a favoritos). */
  function descargarPdf(pdf: { url: string; nombre: string }) {
    const a = document.createElement("a");
    a.href = pdf.url;
    a.download = pdf.nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    guardarFavoritos(registrarFavoritos(favoritos, lineas, hoyLimaISO()));
    setAviso(`PDF generado: ${pdf.nombre}`);
  }

  async function exportar() {
    const pdf = await generarPdf();
    if (!pdf) return;
    descargarPdf(pdf);
    setTimeout(() => URL.revokeObjectURL(pdf.url), 15000);
  }

  // ── Vista previa: el mismo PDF, dentro de la página, antes de descargarlo ──
  const [vistaPdf, setVistaPdf] = useState<{ url: string; nombre: string } | null>(null);
  async function verPdf() {
    const pdf = await generarPdf();
    if (pdf) setVistaPdf(pdf);
  }
  function cerrarVista() {
    setVistaPdf((v) => {
      if (v) URL.revokeObjectURL(v.url);
      return null;
    });
  }
  useEffect(() => {
    if (!vistaPdf) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrarVista();
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [vistaPdf]);

  const haySinPrecio = totales.sinPrecio > 0;

  return (
    <div className="space-y-5">
      {/* ── Botón superior: agregar materiales (catálogo o fuera de catálogo; manual o desde Excel) ── */}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setAbrirAgregar(true)} className={botonPrimario}>+ MATERIALES</button>
      </div>
      <AgregarMateriales
        abierto={abrirAgregar}
        lineas={lineas}
        onQuitar={quitar}
        catalogo={catalogo}
        fuera={fuera}
        onAgregar={agregarVarias}
        onCerrar={() => setAbrirAgregar(false)}
      />

      {/* ── Buscar en el catálogo ── */}
      <section className={tarjeta} aria-labelledby="t-buscar">
        <h2 id="t-buscar" className="text-sm font-medium mb-3">
          Agregar materiales del catálogo
        </h2>
        <input
          className={inputCls}
          aria-label="Buscar material por código o descripción"
          placeholder="Escribe el código o parte del nombre (ej. arco de sierra, ARC0012, balde 20lts)"
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          disabled={!catalogo}
        />
        <p className="text-xs text-ink-soft mt-2" aria-live="polite">
          {errorCatalogo ? (
            <>
              <span className="text-danger">{errorCatalogo}</span>{" "}
              <button type="button" className="underline" onClick={() => setIntento((n) => n + 1)}>Reintentar</button>
            </>
          ) : !catalogo ? (
            "Cargando el catálogo de materiales…"
          ) : consultaDiferida.trim() === "" ? (
            `${catalogo.items.length.toLocaleString("en-US")} artículos · ${catalogo.titulo}`
          ) : resultados.total === 0 ? (
            "Sin resultados: prueba con menos palabras o agrega el material como «fuera del catálogo»."
          ) : (
            `${resultados.total.toLocaleString("en-US")} coincidencia(s)${resultados.total > resultados.items.length ? ` · se muestran las primeras ${resultados.items.length}: afina la búsqueda` : ""}`
          )}
        </p>
        {resultados.items.length > 0 && (
          <ul className="mt-3 border border-line rounded-md divide-y divide-line max-h-80 overflow-y-auto" aria-label="Resultados de la búsqueda">
            {resultados.items.map((it) => {
              const yaEsta = enSolicitud.get(it.articulo);
              const vencido = it.vence && it.vence < hoy;
              return (
                <li key={it.articulo} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="break-words">{it.descripcion}</p>
                    <p className="text-[11px] text-ink-soft font-mono-tag mt-0.5">
                      {it.articulo}
                      {vencido && <span className="text-danger ml-2">precio vencido {fechaCorta(it.vence)}</span>}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono-tag text-sm">
                      {simbolo(it.moneda)} {precioUnitario(it.precio)}
                    </p>
                    <p className="text-[11px] text-ink-soft">sin IGV</p>
                  </div>
                  <button type="button" onClick={() => agregarDelCatalogo(it)} className={`${botonSecundario} shrink-0 !px-3 !py-1.5`}>
                    {yaEsta !== undefined ? "Agregado · +1" : "Agregar"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <details className="mt-4 border-t border-line pt-3">
          <summary className="text-sm font-medium cursor-pointer">Agregar un material fuera del catálogo</summary>
          <div className="grid md:grid-cols-12 gap-3 mt-3">
            <div className="md:col-span-5">
              <label className={labelCls} htmlFor="l-desc">Descripción</label>
              <input id="l-desc" className={inputCls} maxLength={LIMITES.descripcion} value={libre.descripcion} onChange={(e) => setLibre({ ...libre, descripcion: e.target.value })} onKeyDown={(e) => e.key === "Enter" && agregarLibre()} />
            </div>
            <div className="md:col-span-2">
              <label className={labelCls} htmlFor="l-cant">Cantidad</label>
              <input id="l-cant" inputMode="decimal" className={inputCls} value={libre.cantidad} onChange={(e) => setLibre({ ...libre, cantidad: e.target.value })} onKeyDown={(e) => e.key === "Enter" && agregarLibre()} />
            </div>
            <div className="md:col-span-2">
              <label className={labelCls} htmlFor="l-uni">Unidad (opc.)</label>
              <input id="l-uni" className={inputCls} maxLength={LIMITES.unidad} placeholder="UND, m, kg…" value={libre.unidad} onChange={(e) => setLibre({ ...libre, unidad: e.target.value })} onKeyDown={(e) => e.key === "Enter" && agregarLibre()} />
            </div>
            <div className="md:col-span-3">
              <label className={labelCls} htmlFor="l-precio">Precio ref. sin IGV (opc.)</label>
              <input id="l-precio" inputMode="decimal" className={inputCls} value={libre.precio} onChange={(e) => setLibre({ ...libre, precio: e.target.value })} onKeyDown={(e) => e.key === "Enter" && agregarLibre()} />
            </div>
          </div>
          {errorLibre && <p className="text-xs text-danger mt-2" role="alert">{errorLibre}</p>}
          <button type="button" onClick={agregarLibre} className={`${botonSecundario} mt-3`}>Agregar a la solicitud</button>
        </details>
      </section>

      {/* ── Materiales fuera del catálogo: solo aparece cuando la búsqueda tiene coincidencias ── */}
      {fuera && resultadosFuera.items.length > 0 && (
        <section className={tarjeta} aria-labelledby="t-fuera">
          <h2 id="t-fuera" className="text-sm font-medium mb-3">
            Materiales fuera del catálogo ({resultadosFuera.total})
          </h2>
          <ul className="border border-line rounded-md divide-y divide-line max-h-80 overflow-y-auto" aria-label="Materiales fuera del catálogo">
            {resultadosFuera.items.map((it) => {
              const yaEsta = libresEnSolicitud.get(it.clave);
              return (
                <li key={it.clave} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                  <FotosMaterial clave={it.clave} descripcion={it.descripcion} editable={editaFotos} />
                  <div className="flex-1 min-w-0">
                    <p className="break-words">{it.descripcion}</p>
                    <p className="text-[11px] text-ink-soft font-mono-tag mt-0.5">
                      Fuera del catálogo · OC {it.oc} · {fechaCorta(it.fecha)} · {it.unidad}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono-tag text-sm">
                      {simbolo(it.moneda)} {precioUnitario(it.precio)}
                    </p>
                    <p className="text-[11px] text-ink-soft">sin IGV · última OC</p>
                  </div>
                  <button type="button" onClick={() => agregarDeFuera(it)} className={`${botonSecundario} shrink-0 !px-3 !py-1.5`}>
                    {yaEsta !== undefined ? "Agregado · +1" : "Agregar"}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── La solicitud ── */}
      <section className={tarjeta} aria-labelledby="t-solicitud" ref={refTabla}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 id="t-solicitud" className="text-sm font-medium">
            Materiales solicitados ({lineas.length})
          </h2>
          {lineas.length > 0 && (
            <button type="button" onClick={vaciar} className="text-xs text-ink-soft hover:text-danger hover:underline">Vaciar solicitud</button>
          )}
        </div>

        {vencidos.length > 0 && (
          <p className="text-sm border border-danger/40 bg-[var(--danger-soft)] text-danger px-3 py-2 rounded-md mb-3" role="status">
            Los precios del catálogo vencieron el {vencidos.map(fechaCorta).join(", ")}. Confirma su vigencia con el proveedor: el PDF también lo advierte.
          </p>
        )}

        {lineas.length === 0 ? (
          <p className="text-sm text-ink-soft py-6 text-center">Todavía no agregaste materiales. Búscalos arriba en el catálogo.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-sm min-w-[800px]">
              <colgroup>
                <col className="w-[36px]" />
                <col className="w-[120px]" />
                <col />
                <col className="w-[100px]" />
                <col className="w-[110px]" />
                <col className="w-[110px]" />
                <col className="w-[40px]" />
              </colgroup>
              <thead>
                <tr className="border-b border-line text-xs text-ink-soft">
                  <th className="text-left py-2 pr-2 font-medium">N°</th>
                  <th className="text-left py-2 pr-2 font-medium">
                    N° Ticket
                    {lineas.length > 1 && (lineas[0].ticket ?? "").trim() !== "" && (
                      <button
                        type="button"
                        onClick={() => ticketATodas(lineas[0].ticket ?? "")}
                        className="ml-1 text-[10px] font-normal text-teal hover:underline"
                        title={`Poner «${lineas[0].ticket}» en todas las líneas`}
                      >
                        a todas
                      </button>
                    )}
                  </th>
                  <th className="text-left py-2 pr-2 font-medium">Material</th>
                  <th className="text-right py-2 px-2 font-medium">Cantidad</th>
                  <th className="text-right py-2 px-2 font-medium">P. unit. (s/IGV)</th>
                  <th className="text-right py-2 px-2 font-medium">Subtotal</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lineas.map((l, i) => {
                  const sub = subtotalLinea(l);
                  return (
                    <tr key={l.uid} className="border-b border-line last:border-b-0 align-top">
                      <td className="py-2.5 pr-2 text-ink-soft font-mono-tag text-xs">{i + 1}</td>
                      <td className="py-2 pr-2">
                        <input
                          value={l.ticket ?? ""}
                          onChange={(e) => cambiarTicket(l.uid, e.target.value)}
                          maxLength={LIMITES.ticket}
                          placeholder="Ej.: Ref 512"
                          aria-label={`N° de ticket de ${l.descripcion}`}
                          className="w-full border border-line rounded-md px-2 py-1.5 text-xs font-mono-tag focus:outline-none focus:ring-4 focus:ring-slate-200/70"
                        />
                      </td>
                      <td className="py-2.5 pr-2">
                        <div className="flex items-start gap-2">
                          {l.codigo === null && (
                            <FotosMaterial clave={claveFavorito(l)} descripcion={l.descripcion} editable={editaFotos} />
                          )}
                          <div className="min-w-0">
                            <p className="break-words">{l.descripcion}</p>
                            <p className="text-[11px] text-ink-soft font-mono-tag mt-0.5">{l.codigo ?? "fuera del catálogo"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-right">
                        <CantidadInput valor={l.cantidad} etiqueta={`Cantidad de ${l.descripcion}`} onChange={(n) => cambiarCantidad(l.uid, n)} />
                        {l.unidad && <p className="text-[11px] text-ink-soft mt-0.5">{l.unidad}</p>}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono-tag text-xs whitespace-nowrap">
                        {l.precio === null ? "—" : `${simbolo(l.moneda)} ${precioUnitario(l.precio)}`}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono-tag text-xs font-semibold whitespace-nowrap">
                        {sub === null ? "—" : `${simbolo(l.moneda)} ${numero2(sub)}`}
                      </td>
                      <td className="py-2 text-right">
                        <button type="button" onClick={() => quitar(l.uid)} aria-label={`Quitar ${l.descripcion}`} title="Quitar de la solicitud" className="text-ink-soft hover:text-danger px-1.5 py-1 text-lg leading-none">×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {lineas.length > 0 && (
          <div className="mt-4 flex flex-col items-end gap-1 text-sm">
            {totales.porMoneda.map((t) => (
              <div key={t.moneda} className="w-full max-w-xs space-y-1">
                {totales.porMoneda.length > 1 && <p className="text-xs font-medium text-ink-soft">Moneda: {t.moneda}</p>}
                <p className="flex justify-between"><span className="text-ink-soft">Subtotal (sin IGV)</span><span className="font-mono-tag">{simbolo(t.moneda)} {numero2(t.subtotal)}</span></p>
                <p className="flex justify-between"><span className="text-ink-soft">IGV ({Math.round(IGV * 100)} %)</span><span className="font-mono-tag">{simbolo(t.moneda)} {numero2(t.igv)}</span></p>
                <p className="flex justify-between border-t border-line pt-1.5 font-semibold"><span>Total (con IGV)</span><span className="font-mono-tag">{simbolo(t.moneda)} {numero2(t.total)}</span></p>
              </div>
            ))}
            {haySinPrecio && (
              <p className="text-xs text-ink-soft max-w-xs text-right">
                {totales.sinPrecio} material(es) sin precio no entran en los totales.
              </p>
            )}
          </div>
        )}

        {errores.length > 0 && (
          <ul className="mt-4 text-sm text-danger bg-[var(--danger-soft)] border border-danger/30 px-3 py-2 rounded-md list-disc list-inside" role="alert">
            {errores.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}
        {aviso && <p className="mt-4 text-sm border border-line-strong bg-white px-3 py-2 rounded-md" role="status">{aviso}</p>}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void verPdf()} disabled={exportando || lineas.length === 0} className={botonSecundario}>
            👁 Vista previa
          </button>
          <button
            type="button"
            onClick={() => void exportarExcelCatalogo()}
            disabled={generandoExcel || lineasCatalogo === 0}
            className={botonSecundario}
            title="Excel con los materiales del catálogo: toda su información, cantidad, costo total, subtotal, IGV y total"
          >
            {generandoExcel ? "Generando Excel…" : `📊 Excel del catálogo${lineasCatalogo ? ` (${lineasCatalogo})` : ""}`}
          </button>
          <button type="button" onClick={() => void exportar()} disabled={exportando || lineas.length === 0} className={botonPrimario}>
            {exportando ? "Generando PDF…" : "Exportar PDF"}
          </button>
          <p className="text-xs text-ink-soft">
            {numeroSol ? (
              <>
                N° de solicitud: <b className="font-mono-tag text-ink">{numeroSol}</b> · «Vaciar solicitud» empieza una nueva.
              </>
            ) : (
              "El N° de solicitud (SI-año-número) se asigna al generar el PDF o el Excel."
            )}
          </p>
        </div>
      </section>

      <section className={tarjeta} aria-labelledby="t-favoritos">
        <h2 id="t-favoritos" className="text-sm font-medium mb-1">
          Materiales favoritos ({favoritos.length})
        </h2>
        <p className="text-xs text-ink-soft mb-3">
          Aquí aparecen los materiales que ya solicitaste (se agregan al exportar el PDF). Se guardan en este navegador.
        </p>
        {favoritos.length === 0 ? (
          <p className="text-sm text-ink-soft py-6 text-center">Todavía no hay materiales solicitados. Se llenará al exportar tu primera solicitud.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-sm min-w-[680px]">
              <colgroup>
                <col />
                <col className="w-[80px]" />
                <col className="w-[90px]" />
                <col className="w-[120px]" />
                <col className="w-[110px]" />
                <col className="w-[170px]" />
              </colgroup>
              <thead>
                <tr className="border-b border-line text-xs text-ink-soft">
                  <th className="text-left py-2 pr-2 font-medium">Material</th>
                  <th className="text-left py-2 px-2 font-medium">Unidad</th>
                  <th className="text-right py-2 px-2 font-medium">Veces</th>
                  <th className="text-right py-2 px-2 font-medium">Última solicitud</th>
                  <th className="text-right py-2 px-2 font-medium">Última cantidad</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {favoritos.map((f) => (
                  <tr key={f.clave} className="border-b border-line last:border-0 align-top">
                    <td className="py-2 pr-2">
                      <div className="flex items-start gap-2">
                        {!f.codigo && <FotosMaterial clave={f.clave} descripcion={f.descripcion} editable={editaFotos} />}
                        <div className="min-w-0">
                          <p className="break-words">{f.descripcion}</p>
                          <p className="text-xs text-ink-soft font-mono-tag">{f.codigo ?? "Fuera del catálogo"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-2 px-2">{f.unidad || "—"}</td>
                    <td className="py-2 px-2 text-right font-mono-tag">{f.veces}</td>
                    <td className="py-2 px-2 text-right">{f.ultima ? fechaCorta(f.ultima) : "—"}</td>
                    <td className="py-2 px-2 text-right font-mono-tag">{f.ultimaCantidad}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <button type="button" onClick={() => agregarFavorito(f)} aria-label={`Agregar ${f.descripcion} a la solicitud`} className={`${botonSecundario} !px-3 !py-1.5 mr-1`}>
                        {(f.codigo ? enSolicitud.get(f.codigo) : libresEnSolicitud.get(f.clave)) !== undefined ? "Agregado · +1" : "Agregar"}
                      </button>
                      <button type="button" onClick={() => borrarFavorito(f.clave)} aria-label={`Borrar ${f.descripcion} de favoritos`} title="Borrar de favoritos" className="text-xs text-ink-soft hover:text-danger hover:underline px-1.5 py-1">Borrar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Visor del PDF generado: igual que el de los documentos del ticket. */}
      {vistaPdf && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={cerrarVista}
          role="dialog"
          aria-modal="true"
          aria-label="Vista previa de la solicitud"
        >
          <div
            className="bg-white border border-line rounded-lg shadow-xl w-full max-w-5xl h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-line">
              <p className="text-xs font-medium truncate">
                Vista previa · {vistaPdf.nombre}
              </p>
              <div className="flex items-center gap-3 shrink-0">
                <a href={vistaPdf.url} target="_blank" rel="noopener" className="text-xs text-ink-soft hover:underline">
                  Abrir en otra pestaña
                </a>
                <button
                  type="button"
                  onClick={() => {
                    descargarPdf(vistaPdf);
                    // La URL se libera después: si se libera ya, la descarga puede quedar a medias.
                    const url = vistaPdf.url;
                    setVistaPdf(null);
                    setTimeout(() => URL.revokeObjectURL(url), 15000);
                  }}
                  className={`${botonPrimario} !px-3 !py-1 !text-xs`}
                >
                  Descargar PDF
                </button>
                <button
                  type="button"
                  onClick={cerrarVista}
                  className="border border-line-strong rounded-md px-3 py-0.5 text-xs font-medium hover:bg-concrete-dim transition-colors"
                >
                  Cerrar
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 bg-concrete-dim">
              <iframe src={vistaPdf.url} title="Vista previa de la solicitud" className="w-full h-full" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
