"use client";

// Páginas de Gestión: Garantías, Agenda y contratistas, Presupuesto, Preventivos contratados, Reportes por QR e
// Informe mensual (la página que las muestra es app/gestion/[modulo]/page.tsx). Todo se guarda solo, al escribir:
// sin botón "Guardar" ni mensajes emergentes; al lado de cada bloque se ve "Guardando…" / "Guardado".
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatoFecha, formatoSoles, hoyLima, sumarDias, sumarMeses, diasEntre, nombreCampus } from "@/lib/shared";
import { useMe } from "@/lib/client";
import { qrSvg } from "@/lib/qr";
import { descargarExcelInventario } from "@/lib/importarExcel";
import FotosMaterial from "@/components/materiales/FotosMaterial";
import {
  type AjusteGarantia, type Contratista, type Garantia, type GastoCuenta, type InformeMes, type LineaPresupuesto, type Permiso,
  type Preventivo, type Registro, type Reporte, type Semaforo, type TicketGestion,
  ALERTA_PRESUPUESTO, CATEGORIAS_PREVENTIVO, CATEGORIAS_REPORTE, DOCUMENTOS_CONTRATISTA, ESTADOS_PERMISO, ESTADOS_RECLAMO,
  ESTADOS_REPORTE, RIESGOS, SEMAFORO_COLOR, SEMAFORO_TEXTO, SERVICIOS_SUGERIDOS,
  alertasContratista, claveTexto, proximoPreventivo, rangoTrabajo, riesgosSugeridos, semaforo,
  type ArchivoPlano, type Plano, DISCIPLINAS_PLANO, ESTADOS_PLANO, MAX_PLANO, claseArchivoPlano, datosDesdeNombre,
} from "@/lib/gestion";

// ───────── piezas comunes ─────────

export const BOTON =
  "border border-line-strong rounded-md px-3 py-1.5 text-sm font-medium bg-white hover:bg-concrete-dim disabled:opacity-50";
const BOTON_P = "rounded-md px-3 py-1.5 text-sm font-medium bg-ink text-white hover:bg-black disabled:opacity-50";
export const TARJETA = "bg-white border border-line rounded-lg";
const INPUT_B = "border border-line-strong rounded-md px-2 py-1.5 text-sm bg-white min-w-0";
const INPUT = `${INPUT_B} w-full`;
const TH = "text-left font-medium text-[11px] uppercase tracking-wider text-ink-soft px-3 py-2 whitespace-nowrap";
const TD = "px-3 py-2 align-top";

/** Pide datos a /api/gestion/<modulo> y los vuelve a pedir con `recargar`. */
function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!url) return;
    let vivo = true;
    fetch(url)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) setError(d?.error || "No se pudieron leer los datos");
        else {
          setError("");
          setData(d.data as T);
        }
      })
      .catch(() => vivo && setError("Sin conexión: no se pudieron leer los datos"));
    return () => {
      vivo = false;
    };
  }, [url, n]);
  return { data, setData, error, recargar: useCallback(() => setN((x) => x + 1), []) };
}

async function enviar<T = unknown>(modulo: string, body: unknown, accion?: string): Promise<T> {
  const r = await fetch(`/api/gestion/${modulo}${accion ? `?accion=${accion}` : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || "No se pudo guardar");
  return d.data as T;
}
async function borrar(modulo: string, id: number) {
  const r = await fetch(`/api/gestion/${modulo}?id=${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "No se pudo borrar");
}

type EstadoGuardado = "" | "guardando" | "guardado" | { error: string };
/**
 * Guarda solo: espera a que se deje de escribir (1,2 s) y envía. Devuelve el estado para mostrarlo al lado.
 * `guardar` recibe el valor y devuelve una promesa; si falla queda el mensaje y se reintenta al volver a escribir.
 */
function useAutoGuardar<T>(valor: T, guardar: (v: T) => Promise<unknown>, activo = true, ms = 1200): EstadoGuardado {
  const [estado, setEstado] = useState<EstadoGuardado>("");
  const ultimo = useRef(JSON.stringify(valor));
  const fn = useRef(guardar);
  useEffect(() => {
    fn.current = guardar;
  });
  useEffect(() => {
    const json = JSON.stringify(valor);
    if (!activo || json === ultimo.current) return;
    const t = setTimeout(async () => {
      setEstado("guardando");
      try {
        await fn.current(valor);
        ultimo.current = json;
        setEstado("guardado");
      } catch (e) {
        setEstado({ error: e instanceof Error ? e.message : "No se pudo guardar" });
      }
    }, ms);
    return () => clearTimeout(t);
  }, [valor, activo, ms]);
  return estado;
}
function Guardado({ estado }: { estado: EstadoGuardado }) {
  if (!estado) return null;
  if (typeof estado === "object") return <span className="text-xs text-danger">{estado.error}</span>;
  return <span className="text-xs text-ink-soft">{estado === "guardando" ? "Guardando…" : "Guardado ✓"}</span>;
}

function Kpi({ titulo, valor, detalle, tono = "", activo, onClick }: {
  titulo: string; valor: ReactNode; detalle?: ReactNode; tono?: string; activo?: boolean; onClick?: () => void;
}) {
  const cuerpo = (
    <>
      <span className="block text-[11px] uppercase tracking-wider text-ink-soft">{titulo}</span>
      <span className={`block font-display font-bold text-3xl tabular-nums leading-tight ${tono}`}>{valor}</span>
      {detalle && <span className="block text-xs text-ink-soft">{detalle}</span>}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick}
      className={`${TARJETA} text-left px-4 py-3 ${activo ? "ring-1 ring-ink border-ink" : "hover:bg-page"}`}>
      {cuerpo}
    </button>
  ) : (
    <div className={`${TARJETA} px-4 py-3`}>{cuerpo}</div>
  );
}
function Chip({ s, texto }: { s: Semaforo; texto?: string }) {
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${SEMAFORO_COLOR[s]}`}>{texto ?? SEMAFORO_TEXTO[s]}</span>;
}
function Seccion({ titulo, extra, children, className = "" }: { titulo: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`${TARJETA} ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-line">
        <h2 className="font-display font-bold text-xl tracking-tight">{titulo}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}
function Aviso({ children, tono = "info" }: { children: ReactNode; tono?: "info" | "error" }) {
  return (
    <p className={`text-sm border p-3 rounded-md ${tono === "error" ? "text-danger bg-[var(--danger-soft)] border-danger/30" : "text-ink-soft bg-white border-line"}`}>
      {children}
    </p>
  );
}
const Cargando = () => <div className="h-40 bg-white border border-line rounded-lg animate-pulse" aria-busy="true" />;
function RefTicket({ t }: { t: Pick<TicketGestion, "id" | "refer" | "ticket"> }) {
  return (
    <Link href={`/correctivos/${t.id}`} className="font-mono text-xs underline decoration-line-strong hover:decoration-ink whitespace-nowrap">
      #{t.refer ?? t.id}
      {t.ticket ? ` · ${t.ticket}` : ""}
    </Link>
  );
}
/** Borrar en dos toques (sin ventana de confirmación). */
function BotonBorrar({ onBorrar, texto = "Borrar" }: { onBorrar: () => void; texto?: string }) {
  const [seguro, setSeguro] = useState(false);
  useEffect(() => {
    if (!seguro) return;
    const t = setTimeout(() => setSeguro(false), 4000);
    return () => clearTimeout(t);
  }, [seguro]);
  return (
    <button type="button" onClick={() => (seguro ? onBorrar() : setSeguro(true))}
      className={`text-xs px-2 py-1 rounded border ${seguro ? "bg-danger text-white border-danger" : "border-line-strong text-ink-soft hover:text-danger"}`}>
      {seguro ? "Toca otra vez para borrar" : texto}
    </button>
  );
}
const soles = (n: number | null | undefined) => formatoSoles(n ?? 0, 0);
const corta = (s: string | null | undefined, n = 90) => {
  const t = String(s ?? "");
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];
const nombreMes = (mes: string) => {
  const [y, m] = mes.split("-").map(Number);
  return `${["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"][m - 1]} ${y}`;
};

// ───────── Garantías ─────────

type DatosGarantias = {
  hoy: string;
  garantias: Garantia[];
  sinGarantia: { id: number; refer: number | null; ticket: string | null; descripcion: string; proveedor: string | null; f_fin: string | null; monto: number | null }[];
  idAjuste: Record<string, number>;
};
type FiltroG = "todas" | "vigente" | "por_vencer" | "reclamo" | "vencida";

export function Garantias() {
  const me = useMe();
  const esAdmin = me?.rol === "admin";
  const campus = me?.campus;
  const { data, error, recargar } = useApi<DatosGarantias>("/api/gestion/garantias");
  const [filtro, setFiltro] = useState<FiltroG>("vigente");
  const [q, setQ] = useState("");
  const [prov, setProv] = useState("");
  const [abierta, setAbierta] = useState<number | null>(null);
  const [verSin, setVerSin] = useState(false);

  const lista = data?.garantias ?? [];
  const kpi = useMemo(() => ({
    vigente: lista.filter((g) => g.dias >= 0).length,
    por_vencer: lista.filter((g) => g.estado === "por_vencer").length,
    reclamo: lista.filter((g) => g.dias >= 0 && g.posibles.length > 0).length,
    vencida: lista.filter((g) => g.dias < 0).length,
    monto: lista.filter((g) => g.dias >= 0).reduce((s, g) => s + (g.t.monto ?? 0), 0),
  }), [lista]);
  const proveedores = useMemo(() => [...new Set(lista.map((g) => g.t.proveedor).filter(Boolean) as string[])].sort(), [lista]);
  const visibles = lista.filter((g) => {
    if (filtro === "vigente" && g.dias < 0) return false;
    if (filtro === "por_vencer" && g.estado !== "por_vencer") return false;
    if (filtro === "reclamo" && !(g.dias >= 0 && g.posibles.length > 0)) return false;
    if (filtro === "vencida" && g.dias >= 0) return false;
    if (prov && g.t.proveedor !== prov) return false;
    if (q && !claveTexto(`${g.t.descripcion} ${g.t.refer} ${g.t.ticket} ${g.t.proveedor} ${g.t.lugar}`).includes(claveTexto(q))) return false;
    return true;
  });

  function exportar() {
    descargarExcelInventario(
      [
        { titulo: "N° Ref.", ancho: 9 }, { titulo: "Ticket", ancho: 12 }, { titulo: "Trabajo", ancho: 60 }, { titulo: "Proveedor", ancho: 30 },
        { titulo: "Monto", ancho: 12 }, { titulo: "Terminó", ancho: 11 }, { titulo: "Meses", ancho: 7 }, { titulo: "Vence", ancho: 11 },
        { titulo: "Estado", ancho: 11 }, { titulo: "Origen", ancho: 12 }, { titulo: "Posibles reclamos (N° Ref.)", ancho: 24 }, { titulo: "Reclamo", ancho: 22 },
      ],
      visibles.map((g) => [
        g.t.refer, g.t.ticket, g.t.descripcion, g.t.proveedor, g.t.monto, g.desde, g.meses, g.hasta, SEMAFORO_TEXTO[g.estado],
        g.fuente === "manual" ? "Manual" : "Cotización", g.posibles.map((p) => p.refer ?? p.id).join(", "), g.ajuste?.reclamo?.estado ?? "",
      ]),
      { titulo: `Garantías de trabajos · ${nombreCampus(campus)}`, detalle: `Al ${formatoFecha(data?.hoy ?? hoyLima())} · ${visibles.length} garantía(s)` },
      "garantias",
      "Garantías"
    );
  }

  if (error) return <Aviso tono="error">{error}</Aviso>;
  if (!data) return <Cargando />;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <Kpi titulo="Vigentes" valor={kpi.vigente} detalle={`${soles(kpi.monto)} en trabajos cubiertos`} activo={filtro === "vigente"} onClick={() => setFiltro("vigente")} />
        <Kpi titulo="Vencen en 30 días" valor={kpi.por_vencer} tono={kpi.por_vencer ? "text-aviso" : ""} detalle="revisa antes de que venzan" activo={filtro === "por_vencer"} onClick={() => setFiltro("por_vencer")} />
        <Kpi titulo="Posible reclamo" valor={kpi.reclamo} tono={kpi.reclamo ? "text-danger" : ""} detalle="falla repetida dentro de la garantía" activo={filtro === "reclamo"} onClick={() => setFiltro("reclamo")} />
        <Kpi titulo="Vencidas (último año)" valor={kpi.vencida} activo={filtro === "vencida"} onClick={() => setFiltro("vencida")} />
        <Kpi titulo="Todas" valor={lista.length} detalle="del último año y vigentes" activo={filtro === "todas"} onClick={() => setFiltro("todas")} />
      </div>

      <Seccion
        titulo={`Garantías (${visibles.length})`}
        extra={
          <div className="flex flex-wrap gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar trabajo, N°, ambiente…" className={`${INPUT_B} w-56`} />
            <select value={prov} onChange={(e) => setProv(e.target.value)} className={`${INPUT_B} w-48`}>
              <option value="">Todos los proveedores</option>
              {proveedores.map((p) => <option key={p}>{p}</option>)}
            </select>
            <button type="button" onClick={exportar} disabled={!visibles.length} className={BOTON}>Descargar Excel</button>
          </div>
        }
      >
        {visibles.length === 0 ? (
          <p className="p-4 text-sm text-ink-soft">
            No hay garantías en este grupo. La garantía se toma de la cotización del ticket (se lee sola al cargarla) o se
            agrega a mano en “Trabajos sin garantía registrada”.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-page border-b border-line">
                <tr><th className={TH}>Ticket</th><th className={TH}>Trabajo</th><th className={TH}>Proveedor</th><th className={TH}>Terminó</th>
                  <th className={TH}>Garantía</th><th className={TH}>Vence</th><th className={TH}>Posible reclamo</th><th className={TH}></th></tr>
              </thead>
              <tbody>
                {visibles.map((g) => (
                  <FilaGarantia key={g.t.id} g={g} abierta={abierta === g.t.id} onAbrir={() => setAbierta(abierta === g.t.id ? null : g.t.id)}
                    esAdmin={esAdmin} idAjuste={data.idAjuste[g.t.id]} onCambio={recargar} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>

      <Seccion
        titulo={`Trabajos sin garantía registrada (${data.sinGarantia.length})`}
        extra={<button type="button" className={BOTON} onClick={() => setVerSin(!verSin)}>{verSin ? "Ocultar" : "Ver"}</button>}
      >
        {verSin && <SinGarantia filas={data.sinGarantia} esAdmin={esAdmin} onCambio={recargar} />}
        {!verSin && <p className="px-4 py-3 text-sm text-ink-soft">Finalizados en el último año cuya cotización no indicaba garantía. Puedes agregarles los meses a mano.</p>}
      </Seccion>
    </div>
  );
}

function FilaGarantia({ g, abierta, onAbrir, esAdmin, idAjuste, onCambio }: {
  g: Garantia; abierta: boolean; onAbrir: () => void; esAdmin: boolean; idAjuste?: number; onCambio: () => void;
}) {
  const [aj, setAj] = useState<AjusteGarantia>(g.ajuste ?? { correctivo_id: g.t.id, meses: null, nota: "", reclamo: null });
  const estado = useAutoGuardar(aj, (v) => enviar("garantias", { tipo: "garantia", datos: v }), esAdmin && abierta);
  const reclamo = g.ajuste?.reclamo?.estado;
  return (
    <>
      <tr className={`border-b border-line ${g.posibles.length && g.dias >= 0 ? "bg-danger-soft/40" : ""}`}>
        <td className={TD}><RefTicket t={g.t} /></td>
        <td className={`${TD} max-w-md`}>{corta(g.t.descripcion, 120)}</td>
        <td className={TD}>{g.t.proveedor ?? "—"}</td>
        <td className={`${TD} whitespace-nowrap`}>{formatoFecha(g.desde)}</td>
        <td className={`${TD} whitespace-nowrap`}>{g.meses} {g.meses === 1 ? "mes" : "meses"}{g.fuente === "manual" && <span className="text-ink-soft"> · manual</span>}</td>
        <td className={`${TD} whitespace-nowrap`}>
          {formatoFecha(g.hasta)} <Chip s={g.estado} texto={g.dias >= 0 ? `${g.dias} d` : "Vencida"} />
        </td>
        <td className={TD}>
          {g.posibles.length === 0 ? <span className="text-ink-soft">—</span> : (
            <div className="flex flex-wrap gap-1">{g.posibles.map((p) => <RefTicket key={p.id} t={p} />)}</div>
          )}
          {reclamo && <span className="block text-xs mt-0.5">Reclamo: <b>{reclamo}</b></span>}
        </td>
        <td className={TD}><button type="button" onClick={onAbrir} className={BOTON}>{abierta ? "Cerrar" : esAdmin ? "Gestionar" : "Ver"}</button></td>
      </tr>
      {abierta && (
        <tr className="border-b border-line bg-page/60">
          <td colSpan={8} className="px-3 py-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2 text-sm">
                <p><b>Garantía de la cotización:</b> {g.t.garantia_texto || (g.t.garantia_meses ? `${g.t.garantia_meses} meses` : "no indicada")}</p>
                {g.posibles.length > 0 && (
                  <div>
                    <p className="font-medium">Tickets abiertos durante la garantía, en el mismo equipo o ambiente:</p>
                    <ul className="list-disc pl-5">
                      {g.posibles.map((p) => <li key={p.id}><RefTicket t={p} /> {formatoFecha(p.f_reg)} · {corta(p.descripcion, 100)} {p.proveedor ? `· ${p.proveedor}` : ""}</li>)}
                    </ul>
                  </div>
                )}
              </div>
              {esAdmin ? (
                <div className="grid gap-2 sm:grid-cols-2 text-sm">
                  <label>Meses de garantía (si la cotización no los traía o son otros)
                    <input type="number" min={1} max={240} value={aj.meses ?? ""} className={INPUT}
                      onChange={(e) => setAj({ ...aj, meses: e.target.value ? Number(e.target.value) : null })} />
                  </label>
                  <label>Reclamo al proveedor
                    <select className={INPUT} value={aj.reclamo?.estado ?? ""}
                      onChange={(e) => setAj({ ...aj, reclamo: e.target.value ? { estado: e.target.value as (typeof ESTADOS_RECLAMO)[number], fecha: aj.reclamo?.fecha ?? hoyLima(), nota: aj.reclamo?.nota ?? "" } : null })}>
                      <option value="">Sin reclamo</option>
                      {ESTADOS_RECLAMO.map((x) => <option key={x}>{x}</option>)}
                    </select>
                  </label>
                  {aj.reclamo && (
                    <label>Fecha del reclamo
                      <input type="date" className={INPUT} value={aj.reclamo.fecha} onChange={(e) => setAj({ ...aj, reclamo: { ...aj.reclamo!, fecha: e.target.value } })} />
                    </label>
                  )}
                  <label className={aj.reclamo ? "" : "sm:col-span-2"}>Nota
                    <input className={INPUT} value={aj.nota ?? ""} maxLength={500} onChange={(e) => setAj({ ...aj, nota: e.target.value })} placeholder="Ej.: proveedor confirmó visita el lunes" />
                  </label>
                  <div className="sm:col-span-2 flex items-center justify-between gap-2">
                    <Guardado estado={estado} />
                    {idAjuste && (
                      <BotonBorrar texto="Quitar ajuste manual" onBorrar={() => borrar("garantias", idAjuste).then(onCambio).catch(() => {})} />
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm">{g.ajuste?.nota || ""}</p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function SinGarantia({ filas, esAdmin, onCambio }: { filas: DatosGarantias["sinGarantia"]; esAdmin: boolean; onCambio: () => void }) {
  const [q, setQ] = useState("");
  const [meses, setMeses] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const vis = filas.filter((f) => !q || claveTexto(`${f.descripcion} ${f.refer} ${f.proveedor}`).includes(claveTexto(q))).slice(-200).reverse();
  async function agregar(id: number) {
    try {
      setError("");
      await enviar("garantias", { tipo: "garantia", datos: { correctivo_id: id, meses: Number(meses[id]) } });
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    }
  }
  return (
    <div className="p-3 space-y-2">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" className={`${INPUT_B} max-w-xs`} />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="overflow-x-auto max-h-[28rem]">
        <table className="w-full text-sm">
          <tbody>
            {vis.map((f) => (
              <tr key={f.id} className="border-b border-line">
                <td className={TD}><RefTicket t={f} /></td>
                <td className={TD}>{corta(f.descripcion, 110)}</td>
                <td className={TD}>{f.proveedor ?? "—"}</td>
                <td className={`${TD} whitespace-nowrap`}>{formatoFecha(f.f_fin)}</td>
                {esAdmin && (
                  <td className={`${TD} whitespace-nowrap`}>
                    <input type="number" min={1} max={240} placeholder="meses" value={meses[f.id] ?? ""} className={`${INPUT_B} w-20 inline-block`}
                      onChange={(e) => setMeses({ ...meses, [f.id]: e.target.value })} />{" "}
                    <button type="button" className={BOTON} disabled={!Number(meses[f.id])} onClick={() => agregar(f.id)}>Agregar</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───────── Agenda y contratistas ─────────

type DatosAgenda = {
  hoy: string; desde: string; hasta: string;
  enObra: TicketGestion[];
  porProgramar: TicketGestion[];
  contratistas: Registro<Contratista>[];
  permisos: Registro<Permiso>[];
  proveedores: { proveedor: string; n: number; ultimo: string | null }[];
};
const ICONO_RIESGO: Record<string, string> = {
  "Trabajo en altura": "🪜", "Trabajo en caliente": "🔥", "Riesgo eléctrico": "⚡", "Espacio confinado": "🕳",
};
const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
function lunesDe(f: string) {
  const [y, m, d] = f.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return sumarDias(f, -dow, false);
}

export function Agenda() {
  const esAdmin = useMe()?.rol === "admin";
  const [vista, setVista] = useState<"semana" | "contratistas">("semana");
  const [lunes, setLunes] = useState(() => lunesDe(hoyLima()));
  const domingo = sumarDias(lunes, 6, false);
  const { data, error, recargar } = useApi<DatosAgenda>(`/api/gestion/agenda?desde=${lunes}&hasta=${domingo}`);
  const docs = useMemo(() => new Map((data?.contratistas ?? []).map((c) => [claveTexto(c.datos.proveedor), c])), [data]);
  const permisos = useMemo(() => new Map((data?.permisos ?? []).map((p) => [p.datos.correctivo_id, p.datos])), [data]);

  const hoy = data?.hoy ?? hoyLima();
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i, false));
  const enObra = data?.enObra ?? [];
  const alertasDe = (prov: string | null) => (prov ? alertasContratista(docs.get(claveTexto(prov))?.datos, hoy) : []);
  const riesgosDe = (t: TicketGestion) => permisos.get(t.id)?.riesgos ?? riesgosSugeridos(t.descripcion);
  const provSemana = [...new Set(enObra.map((t) => t.proveedor).filter(Boolean) as string[])];
  const provConAlerta = provSemana.filter((p) => alertasDe(p).some((a) => a.grave));
  const sinPermiso = enObra.filter((t) => riesgosDe(t).length > 0 && (permisos.get(t.id)?.estado ?? "Pendiente") === "Pendiente");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-line-strong overflow-hidden">
          {(["semana", "contratistas"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setVista(v)}
              className={`px-3 py-1.5 text-sm font-medium ${vista === v ? "bg-ink text-white" : "bg-white hover:bg-concrete-dim"}`}>
              {v === "semana" ? "Agenda de la semana" : "Contratistas y documentos"}
            </button>
          ))}
        </div>
        {vista === "semana" && (
          <div className="flex items-center gap-1 ml-auto">
            <button type="button" className={BOTON} onClick={() => setLunes(sumarDias(lunes, -7, false))} aria-label="Semana anterior">◀</button>
            <button type="button" className={BOTON} onClick={() => setLunes(lunesDe(hoyLima()))}>Esta semana</button>
            <button type="button" className={BOTON} onClick={() => setLunes(sumarDias(lunes, 7, false))} aria-label="Semana siguiente">▶</button>
            <span className="text-sm text-ink-soft ml-2">{formatoFecha(lunes)} al {formatoFecha(domingo)}</span>
          </div>
        )}
      </div>
      {error && <Aviso tono="error">{error}</Aviso>}
      {!data && !error && <Cargando />}
      {data && vista === "semana" && (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
            <Kpi titulo="Trabajos en obra" valor={enObra.length} detalle="esta semana" />
            <Kpi titulo="Contratistas" valor={provSemana.length} detalle="distintos en el campus" />
            <Kpi titulo="Con documentos faltantes" valor={provConAlerta.length} tono={provConAlerta.length ? "text-danger" : ""} detalle="SCTR vencido o sin registrar" />
            <Kpi titulo="Riesgo sin permiso" valor={sinPermiso.length} tono={sinPermiso.length ? "text-danger" : ""} detalle="altura, caliente, eléctrico, confinado" />
            <Kpi titulo="Por programar" valor={data.porProgramar.length} detalle="con OC y sin fecha de inicio" />
          </div>

          <Seccion titulo="Calendario">
            <div className="grid grid-cols-1 md:grid-cols-7 divide-y md:divide-y-0 md:divide-x divide-line">
              {dias.map((d, i) => {
                const del = enObra.filter((t) => {
                  const r = rangoTrabajo(t);
                  return r && r.desde <= d && r.hasta >= d;
                });
                return (
                  <div key={d} className={`min-h-28 p-2 ${d === hoy ? "bg-aviso-soft/60" : ""}`}>
                    <p className={`text-xs font-medium mb-1 ${d === hoy ? "text-amber-hover" : "text-ink-soft"}`}>
                      {DIAS[i]} {d.slice(8)}/{d.slice(5, 7)} {del.length ? `· ${del.length}` : ""}
                    </p>
                    <ul className="space-y-1">
                      {del.map((t) => {
                        const grave = alertasDe(t.proveedor).some((a) => a.grave);
                        return (
                          <li key={t.id} className={`text-xs rounded border px-1.5 py-1 ${grave ? "border-danger/40 bg-[var(--danger-soft)]" : "border-line bg-white"}`}>
                            <Link href={`/correctivos/${t.id}`} className="font-mono">#{t.refer ?? t.id}</Link>{" "}
                            {riesgosDe(t).map((r) => <span key={r} title={r}>{ICONO_RIESGO[r]}</span>)}
                            <span className="block font-medium truncate" title={t.proveedor ?? ""}>{t.proveedor ?? "Sin proveedor"}</span>
                            <span className="block text-ink-soft truncate" title={t.descripcion}>{t.descripcion}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </Seccion>

          <Seccion titulo={`Trabajos de la semana y permisos de trabajo (${enObra.length})`}>
            {enObra.length === 0 ? (
              <p className="p-4 text-sm text-ink-soft">No hay trabajos con fechas en esta semana. Las fechas salen de cada ticket (inicio, fin o entrega de la OC).</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-page border-b border-line">
                    <tr><th className={TH}>Ticket</th><th className={TH}>Contratista</th><th className={TH}>Trabajo</th><th className={TH}>Fechas</th>
                      <th className={TH}>Riesgos</th><th className={TH}>Permiso de trabajo</th></tr>
                  </thead>
                  <tbody>
                    {enObra.map((t) => (
                      <FilaPermiso key={t.id} t={t} permiso={permisos.get(t.id)} alertas={alertasDe(t.proveedor)} esAdmin={esAdmin} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Seccion>

          {data.porProgramar.length > 0 && (
            <Seccion titulo={`Por programar (${data.porProgramar.length})`}>
              <ul className="divide-y divide-line text-sm">
                {data.porProgramar.map((t) => (
                  <li key={t.id} className="px-4 py-2 flex flex-wrap gap-x-3">
                    <RefTicket t={t} /> <span className="font-medium">{t.proveedor ?? "Sin proveedor"}</span>
                    {riesgosSugeridos(t.descripcion).map((r) => <span key={r} title={`${r}: tramita el permiso antes de empezar`}>{ICONO_RIESGO[r]}</span>)}
                    <span className="text-ink-soft">{t.estado}</span> <span className="flex-1 min-w-0">{corta(t.descripcion, 120)}</span>
                  </li>
                ))}
              </ul>
            </Seccion>
          )}
        </>
      )}
      {data && vista === "contratistas" && <Contratistas data={data} esAdmin={esAdmin} onCambio={recargar} />}
    </div>
  );
}

function FilaPermiso({ t, permiso, alertas, esAdmin }: {
  t: TicketGestion; permiso?: Permiso; alertas: { texto: string; grave: boolean }[]; esAdmin: boolean;
}) {
  const sugeridos = riesgosSugeridos(t.descripcion);
  const [p, setP] = useState<Permiso>(permiso ?? { correctivo_id: t.id, riesgos: sugeridos, estado: "Pendiente", numero: "", nota: "" });
  const estado = useAutoGuardar(p, (v) => enviar("agenda", { tipo: "permiso", datos: v }), esAdmin);
  const r = rangoTrabajo(t);
  return (
    <tr className="border-b border-line">
      <td className={TD}><RefTicket t={t} /></td>
      <td className={TD}>
        <span className="font-medium">{t.proveedor ?? "—"}</span>
        {alertas.map((a) => (
          <span key={a.texto} className={`block text-[11px] ${a.grave ? "text-danger" : "text-aviso"}`}>⚠ {a.texto}</span>
        ))}
      </td>
      <td className={`${TD} max-w-sm`}>{corta(t.descripcion, 110)}</td>
      <td className={`${TD} whitespace-nowrap text-xs`}>{r ? `${formatoFecha(r.desde)} → ${formatoFecha(r.hasta)}` : "—"}</td>
      <td className={TD}>
        <div className="flex flex-wrap gap-1">
          {RIESGOS.map((x) => {
            const on = p.riesgos.includes(x);
            return (
              <button key={x} type="button" disabled={!esAdmin} title={sugeridos.includes(x) ? `${x} (sugerido por la descripción)` : x}
                onClick={() => setP({ ...p, riesgos: on ? p.riesgos.filter((y) => y !== x) : [...p.riesgos, x] })}
                className={`text-[11px] rounded-full border px-2 py-0.5 ${on ? "bg-ink text-white border-ink" : "border-line-strong text-ink-soft"}`}>
                {ICONO_RIESGO[x]} {x.replace("Trabajo en ", "").replace("Riesgo ", "").replace("Espacio ", "")}
              </button>
            );
          })}
        </div>
      </td>
      <td className={`${TD} min-w-48`}>
        {p.riesgos.length === 0 ? <span className="text-xs text-ink-soft">No requiere</span> : (
          <div className="flex flex-col gap-1">
            <select className={`${INPUT} ${p.estado === "Pendiente" ? "border-danger text-danger" : ""}`} disabled={!esAdmin} value={p.estado}
              onChange={(e) => setP({ ...p, estado: e.target.value as Permiso["estado"] })}>
              {ESTADOS_PERMISO.map((x) => <option key={x}>{x}</option>)}
            </select>
            <input className={INPUT} disabled={!esAdmin} placeholder="N° de permiso" value={p.numero ?? ""} maxLength={60}
              onChange={(e) => setP({ ...p, numero: e.target.value })} />
          </div>
        )}
        <Guardado estado={estado} />
      </td>
    </tr>
  );
}

function Contratistas({ data, esAdmin, onCambio }: { data: DatosAgenda; esAdmin: boolean; onCambio: () => void }) {
  const [q, setQ] = useState("");
  const [soloAlertas, setSoloAlertas] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState("");
  const hoy = data.hoy;
  const filas = useMemo(() => {
    const m = new Map<string, { proveedor: string; n: number; reg?: Registro<Contratista> }>();
    for (const p of data.proveedores) m.set(claveTexto(p.proveedor), { proveedor: p.proveedor, n: p.n });
    for (const c of data.contratistas) {
      const k = claveTexto(c.datos.proveedor);
      m.set(k, { proveedor: m.get(k)?.proveedor ?? c.datos.proveedor, n: m.get(k)?.n ?? 0, reg: c });
    }
    return [...m.values()];
  }, [data]);
  const enSemana = new Set(data.enObra.map((t) => claveTexto(t.proveedor)));
  const vis = filas
    .map((f) => ({ ...f, alertas: alertasContratista(f.reg?.datos, hoy), semana: enSemana.has(claveTexto(f.proveedor)) }))
    .filter((f) => (!q || claveTexto(f.proveedor).includes(claveTexto(q))) && (!soloAlertas || f.alertas.some((a) => a.grave)))
    .sort((a, b) => Number(b.semana) - Number(a.semana) || b.n - a.n);
  return (
    <Seccion
      titulo={`Contratistas (${vis.length})`}
      extra={
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar contratista…" className={`${INPUT_B} w-56`} />
          <label className="text-sm flex items-center gap-1"><input type="checkbox" checked={soloAlertas} onChange={(e) => setSoloAlertas(e.target.checked)} /> Solo con faltantes</label>
          {esAdmin && (
            <>
              <input value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Otro contratista…" className={`${INPUT_B} w-48`} />
              <button type="button" className={BOTON} disabled={nuevo.trim().length < 2}
                onClick={() => enviar("agenda", { tipo: "contratista", datos: { proveedor: nuevo.trim(), documentos: [], personal: [] } }).then(() => { setNuevo(""); onCambio(); }).catch(() => {})}>
                Agregar
              </button>
            </>
          )}
        </div>
      }
    >
      <p className="px-4 pt-3 text-xs text-ink-soft">
        Obligatorios para entrar a trabajar: SCTR salud y SCTR pensión vigentes. Se avisa {30} días antes de que venzan. Los que trabajan esta semana van primero.
      </p>
      <ul className="divide-y divide-line">
        {vis.map((f) => {
          const k = claveTexto(f.proveedor);
          return (
            <li key={k} className="px-4 py-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{f.proveedor}</span>
                {f.semana && <span className="text-[11px] rounded bg-concrete-dim px-1.5">trabaja esta semana</span>}
                <span className="text-xs text-ink-soft">{f.n} ticket(s) en 2 años · {f.reg?.datos.personal.length ?? 0} persona(s) autorizada(s)</span>
                <span className="flex flex-wrap gap-1 flex-1">
                  {f.alertas.length === 0 ? <Chip s="al_dia" texto="Documentos al día" /> :
                    f.alertas.map((a) => <Chip key={a.texto} s={a.grave ? "vencido" : "por_vencer"} texto={a.texto} />)}
                </span>
                <button type="button" className={BOTON} onClick={() => setAbierto(abierto === k ? null : k)}>{abierto === k ? "Cerrar" : esAdmin ? "Editar" : "Ver"}</button>
              </div>
              {abierto === k && <EditorContratista inicial={f.reg?.datos ?? { proveedor: f.proveedor, documentos: [], personal: [] }} esAdmin={esAdmin} hoy={hoy} />}
            </li>
          );
        })}
      </ul>
    </Seccion>
  );
}

function EditorContratista({ inicial, esAdmin, hoy }: { inicial: Contratista; esAdmin: boolean; hoy: string }) {
  const [c, setC] = useState<Contratista>(inicial);
  const estado = useAutoGuardar(c, (v) => enviar("agenda", { tipo: "contratista", datos: v }), esAdmin);
  const docsFaltan = DOCUMENTOS_CONTRATISTA.filter((t) => t !== "Otro" && !c.documentos.some((d) => d.tipo === t));
  return (
    <div className="mt-2 grid gap-4 lg:grid-cols-2 text-sm bg-page/60 border border-line rounded-md p-3">
      <div>
        <p className="font-medium mb-1">Documentos</p>
        <table className="w-full">
          <tbody>
            {c.documentos.map((d, i) => (
              <tr key={i}>
                <td className="pr-1 py-0.5">
                  <select className={INPUT} disabled={!esAdmin} value={d.tipo}
                    onChange={(e) => setC({ ...c, documentos: c.documentos.map((x, j) => (j === i ? { ...x, tipo: e.target.value } : x)) })}>
                    {[...new Set([...DOCUMENTOS_CONTRATISTA, d.tipo])].map((x) => <option key={x}>{x}</option>)}
                  </select>
                </td>
                <td className="pr-1 py-0.5 w-36">
                  <input type="date" className={INPUT} disabled={!esAdmin} value={d.vence ?? ""}
                    onChange={(e) => setC({ ...c, documentos: c.documentos.map((x, j) => (j === i ? { ...x, vence: e.target.value || null } : x)) })} />
                </td>
                <td className="pr-1 py-0.5"><Chip s={semaforo(d.vence, hoy)} /></td>
                <td className="pr-1 py-0.5">
                  {esAdmin ? (
                    <input className={INPUT} placeholder="Enlace (SharePoint…)" value={d.enlace ?? ""}
                      onChange={(e) => setC({ ...c, documentos: c.documentos.map((x, j) => (j === i ? { ...x, enlace: e.target.value } : x)) })} />
                  ) : d.enlace ? <a href={d.enlace} target="_blank" rel="noreferrer" className="underline">Abrir</a> : null}
                </td>
                {esAdmin && <td><button type="button" className="text-ink-soft hover:text-danger px-1" aria-label="Quitar" onClick={() => setC({ ...c, documentos: c.documentos.filter((_, j) => j !== i) })}>✕</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
        {esAdmin && (
          <div className="flex flex-wrap gap-1 mt-1">
            {docsFaltan.map((t) => (
              <button key={t} type="button" className="text-xs border border-dashed border-line-strong rounded px-2 py-0.5 hover:bg-white"
                onClick={() => setC({ ...c, documentos: [...c.documentos, { tipo: t, vence: null, enlace: "" }] })}>+ {t}</button>
            ))}
            <button type="button" className="text-xs border border-dashed border-line-strong rounded px-2 py-0.5 hover:bg-white"
              onClick={() => setC({ ...c, documentos: [...c.documentos, { tipo: "Otro", vence: null, enlace: "" }] })}>+ Otro</button>
          </div>
        )}
      </div>
      <div>
        <p className="font-medium mb-1">Personal autorizado ({c.personal.length})</p>
        <ul className="space-y-1">
          {c.personal.map((x, i) => (
            <li key={i} className="flex gap-1">
              <input className={INPUT} disabled={!esAdmin} placeholder="Nombre" value={x.nombre}
                onChange={(e) => setC({ ...c, personal: c.personal.map((y, j) => (j === i ? { ...y, nombre: e.target.value } : y)) })} />
              <input className={`${INPUT_B} w-40`} disabled={!esAdmin} placeholder="Cargo" value={x.cargo ?? ""}
                onChange={(e) => setC({ ...c, personal: c.personal.map((y, j) => (j === i ? { ...y, cargo: e.target.value } : y)) })} />
              {esAdmin && <button type="button" className="text-ink-soft hover:text-danger px-1" aria-label="Quitar" onClick={() => setC({ ...c, personal: c.personal.filter((_, j) => j !== i) })}>✕</button>}
            </li>
          ))}
        </ul>
        {esAdmin && (
          <button type="button" className="text-xs border border-dashed border-line-strong rounded px-2 py-0.5 mt-1 hover:bg-white"
            onClick={() => setC({ ...c, personal: [...c.personal, { nombre: "", cargo: "" }] })}>+ Persona</button>
        )}
        <div className="grid gap-2 sm:grid-cols-2 mt-3">
          <label>Contacto<input className={INPUT} disabled={!esAdmin} value={c.contacto ?? ""} onChange={(e) => setC({ ...c, contacto: e.target.value })} placeholder="Supervisor, teléfono" /></label>
          <label>Notas<input className={INPUT} disabled={!esAdmin} value={c.notas ?? ""} onChange={(e) => setC({ ...c, notas: e.target.value })} /></label>
        </div>
        <div className="mt-2"><Guardado estado={estado} /></div>
      </div>
    </div>
  );
}

// ───────── Presupuesto ─────────

type DatosPresupuesto = {
  hoy: string; anio: number;
  lineas: Registro<LineaPresupuesto>[];
  gasto: GastoCuenta[];
  materiales: { mes: number; n: number; total: number }[];
  anios: number[];
};

export function Presupuesto() {
  const esAdmin = useMe()?.rol === "admin";
  const [anio, setAnio] = useState(() => Number(hoyLima().slice(0, 4)));
  const { data, error, recargar } = useApi<DatosPresupuesto>(`/api/gestion/presupuesto?anio=${anio}`);
  const [nueva, setNueva] = useState("");
  const [extra, setExtra] = useState<string[]>([]);

  const filas = useMemo(() => {
    if (!data) return [];
    const m = new Map<string, { cuenta: string; asignado: number | null; comprometido: number; ejecutado: number; n: number; porMes: number[] }>();
    const fila = (cuenta: string) => {
      const k = claveTexto(cuenta);
      if (!m.has(k)) m.set(k, { cuenta, asignado: null, comprometido: 0, ejecutado: 0, n: 0, porMes: Array(12).fill(0) });
      return m.get(k)!;
    };
    for (const l of data.lineas) fila(l.datos.cuenta).asignado = l.datos.monto;
    for (const g of data.gasto) {
      const f = fila(g.cuenta);
      f.comprometido += g.comprometido;
      f.ejecutado += g.ejecutado;
      f.n += g.n;
      f.porMes[g.mes - 1] += g.comprometido + g.ejecutado;
    }
    for (const c of extra) fila(c);
    return [...m.values()].sort((a, b) => (b.asignado ?? 0) - (a.asignado ?? 0) || b.comprometido + b.ejecutado - (a.comprometido + a.ejecutado));
  }, [data, extra]);

  if (error) return <Aviso tono="error">{error}</Aviso>;
  if (!data) return <Cargando />;

  const asignado = filas.reduce((s, f) => s + (f.asignado ?? 0), 0);
  const gastado = filas.reduce((s, f) => s + f.comprometido + f.ejecutado, 0);
  const ejecutado = filas.reduce((s, f) => s + f.ejecutado, 0);
  const mat = data.materiales.reduce((s, x) => s + x.total, 0);
  const anioActual = Number(data.hoy.slice(0, 4));
  const mesesTranscurridos = anio < anioActual ? 12 : anio > anioActual ? 0 : Number(data.hoy.slice(5, 7));
  const proyeccion = mesesTranscurridos > 0 ? (gastado / mesesTranscurridos) * 12 : 0;
  const porMes = Array.from({ length: 12 }, (_, i) => filas.reduce((s, f) => s + f.porMes[i], 0));
  const maxMes = Math.max(1, ...porMes, asignado / 12);
  const pct = asignado ? gastado / asignado : 0;
  const alertas = filas.filter((f) => f.asignado && (f.comprometido + f.ejecutado) / f.asignado >= ALERTA_PRESUPUESTO);
  const anios = [...new Set([anioActual + 1, anioActual, ...data.anios])].sort((a, b) => b - a);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">Año{" "}
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className={`${INPUT_B} w-28 inline-block`}>
            {anios.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <p className="text-xs text-ink-soft">
          Gasto = monto de los tickets del año (por fecha de OC; si no tiene, por fecha de registro). Comprometido: con monto y aún sin finalizar. Ejecutado: finalizado.
        </p>
      </div>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <Kpi titulo="Presupuesto" valor={soles(asignado)} detalle={asignado ? `${filas.filter((f) => f.asignado).length} cuenta(s)` : "aún sin cargar"} />
        <Kpi titulo="Gastado" valor={soles(gastado)} detalle={asignado ? `${Math.round(pct * 100)} % del presupuesto` : `${filas.reduce((s, f) => s + f.n, 0)} ticket(s)`}
          tono={pct >= 1 ? "text-danger" : pct >= ALERTA_PRESUPUESTO ? "text-aviso" : ""} />
        <Kpi titulo="Disponible" valor={soles(Math.max(0, asignado - gastado))} detalle={`ejecutado ${soles(ejecutado)}`} />
        <Kpi titulo="Al ritmo actual" valor={soles(proyeccion)} detalle={asignado ? `cerrarías el año en ${Math.round((proyeccion / asignado) * 100)} %` : "proyección del año"}
          tono={asignado && proyeccion > asignado ? "text-danger" : ""} />
        <Kpi titulo="Materiales pedidos" valor={soles(mat)} detalle={`${data.materiales.reduce((s, x) => s + x.n, 0)} solicitud(es), sin IGV`} />
      </div>
      {alertas.length > 0 && (
        <Aviso tono="error">
          {alertas.map((f) => `${f.cuenta}: ${Math.round(((f.comprometido + f.ejecutado) / f.asignado!) * 100)} % usado`).join(" · ")}
          {" "}— a partir del {Math.round(ALERTA_PRESUPUESTO * 100)} % conviene revisar antes de aprobar más gastos.
        </Aviso>
      )}

      <Seccion titulo="Gasto por mes">
        <div className="px-4 py-3">
          <div className="flex items-end gap-1 sm:gap-2 h-44">
            {porMes.map((v, i) => (
              <div key={i} className="flex-1 flex flex-col items-center justify-end h-full" title={`${MESES[i]}: ${soles(v)}`}>
                <span className="text-[10px] text-ink-soft tabular-nums mb-0.5">{v ? Math.round(v / 1000) + "k" : ""}</span>
                <div className="w-full relative" style={{ height: `${(v / maxMes) * 100}%` }}>
                  <div className={`absolute inset-0 rounded-t ${asignado && v > asignado / 12 ? "bg-amber" : "bg-slate-ink"}`} />
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-1 sm:gap-2 border-t border-line mt-1 pt-1">
            {MESES.map((m) => <span key={m} className="flex-1 text-center text-[11px] text-ink-soft">{m}</span>)}
          </div>
          {asignado > 0 && <p className="text-xs text-ink-soft mt-2">En rojo, los meses que superan la doceava parte del presupuesto ({soles(asignado / 12)}).</p>}
        </div>
      </Seccion>

      <Seccion
        titulo="Por cuenta"
        extra={esAdmin ? (
          <div className="flex gap-2">
            <input value={nueva} onChange={(e) => setNueva(e.target.value)} placeholder="Agregar cuenta…" className={`${INPUT_B} w-52`} />
            <button type="button" className={BOTON} disabled={nueva.trim().length < 2} onClick={() => { setExtra([...extra, nueva.trim()]); setNueva(""); }}>Agregar</button>
          </div>
        ) : undefined}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-page border-b border-line">
              <tr><th className={TH}>Cuenta</th><th className={TH}>Presupuesto {anio}</th><th className={TH}>Comprometido</th><th className={TH}>Ejecutado</th>
                <th className={TH}>Usado</th><th className={TH}>Disponible</th></tr>
            </thead>
            <tbody>
              {filas.map((f) => <FilaPresupuesto key={claveTexto(f.cuenta) + anio} anio={anio} f={f} esAdmin={esAdmin} onCambio={recargar} />)}
              {filas.length === 0 && <tr><td colSpan={6} className="p-4 text-ink-soft">Sin gastos ni presupuesto en {anio}.</td></tr>}
            </tbody>
          </table>
        </div>
      </Seccion>
    </div>
  );
}

function FilaPresupuesto({ anio, f, esAdmin, onCambio }: {
  anio: number; f: { cuenta: string; asignado: number | null; comprometido: number; ejecutado: number; n: number }; esAdmin: boolean; onCambio: () => void;
}) {
  const [valor, setValor] = useState(f.asignado === null ? "" : String(f.asignado));
  const estado = useAutoGuardar(valor, async (v) => {
    if (v === "" || Number.isNaN(Number(v))) return;
    await enviar("presupuesto", { tipo: "presupuesto", datos: { anio, cuenta: f.cuenta, monto: Number(v) } });
    onCambio();
  }, esAdmin, 1500);
  const usado = f.comprometido + f.ejecutado;
  const asig = Number(valor) || 0;
  const p = asig ? usado / asig : 0;
  return (
    <tr className="border-b border-line">
      <td className={TD}><span className="font-medium">{f.cuenta}</span><span className="block text-xs text-ink-soft">{f.n} ticket(s)</span></td>
      <td className={`${TD} w-44`}>
        {esAdmin ? (
          <input type="number" min={0} step="0.01" className={INPUT} value={valor} placeholder="S/ asignado" onChange={(e) => setValor(e.target.value)} />
        ) : soles(f.asignado)}
        <Guardado estado={estado} />
      </td>
      <td className={`${TD} tabular-nums`}>{soles(f.comprometido)}</td>
      <td className={`${TD} tabular-nums`}>{soles(f.ejecutado)}</td>
      <td className={`${TD} min-w-40`}>
        {asig ? (
          <>
            <div className="h-2 bg-concrete-dim rounded overflow-hidden">
              <div className={`h-full ${p >= 1 ? "bg-danger" : p >= ALERTA_PRESUPUESTO ? "bg-aviso" : "bg-teal"}`} style={{ width: `${Math.min(100, p * 100)}%` }} />
            </div>
            <span className={`text-xs tabular-nums ${p >= ALERTA_PRESUPUESTO ? "text-danger font-medium" : "text-ink-soft"}`}>{Math.round(p * 100)} %</span>
          </>
        ) : <span className="text-xs text-ink-soft">sin presupuesto</span>}
      </td>
      <td className={`${TD} tabular-nums ${asig && usado > asig ? "text-danger" : ""}`}>{asig ? soles(asig - usado) : "—"}</td>
    </tr>
  );
}

// ───────── Preventivos contratados ─────────

type FiltroP = "todos" | "vencido" | "por_vencer" | "itse";
const PREVENTIVO_VACIO: Preventivo = {
  servicio: "", categoria: "Otro", proveedor: "", frecuencia_meses: 6, ultimo: null, ubicacion: "", itse: false,
  contrato: "", monto: null, enlace: "", notas: "", activo: true, historial: [],
};

export function Preventivos() {
  const me = useMe();
  const esAdmin = me?.rol === "admin";
  const campus = me?.campus;
  const { data, error, recargar } = useApi<{ hoy: string; preventivos: Registro<Preventivo>[] }>("/api/gestion/preventivos");
  const [filtro, setFiltro] = useState<FiltroP>("todos");
  const [cat, setCat] = useState("");
  const [abierto, setAbierto] = useState<number | null>(null);
  const [agregar, setAgregar] = useState<"" | "uno" | "sugeridos">("");
  const hoy = data?.hoy ?? hoyLima();
  const activos = (data?.preventivos ?? []).filter((p) => p.datos.activo !== false);
  const estadoDe = (p: Preventivo): Semaforo => (p.ultimo ? semaforo(proximoPreventivo(p), hoy) : "sin_dato");
  const kpi = {
    vencido: activos.filter((p) => estadoDe(p.datos) === "vencido" || estadoDe(p.datos) === "sin_dato").length,
    por_vencer: activos.filter((p) => estadoDe(p.datos) === "por_vencer").length,
    al_dia: activos.filter((p) => estadoDe(p.datos) === "al_dia").length,
    itse: activos.filter((p) => p.datos.itse && estadoDe(p.datos) !== "al_dia").length,
  };
  const lista = (data?.preventivos ?? [])
    .filter((p) => {
      const e = estadoDe(p.datos);
      if (filtro === "vencido" && e !== "vencido" && e !== "sin_dato") return false;
      if (filtro === "por_vencer" && e !== "por_vencer") return false;
      if (filtro === "itse" && !(p.datos.itse && e !== "al_dia")) return false;
      if (filtro !== "todos" && p.datos.activo === false) return false;
      return !cat || p.datos.categoria === cat;
    })
    .sort((a, b) => Number(b.datos.activo !== false) - Number(a.datos.activo !== false) || (proximoPreventivo(a.datos) ?? "0").localeCompare(proximoPreventivo(b.datos) ?? "0"));
  const meses = Array.from({ length: 12 }, (_, i) => sumarMeses(`${hoy.slice(0, 7)}-01`, i).slice(0, 7));

  function exportar() {
    descargarExcelInventario(
      [
        { titulo: "Servicio", ancho: 44 }, { titulo: "Categoría", ancho: 24 }, { titulo: "Proveedor", ancho: 28 }, { titulo: "Frecuencia (meses)", ancho: 10 },
        { titulo: "Último", ancho: 11 }, { titulo: "Próximo", ancho: 11 }, { titulo: "Estado", ancho: 11 }, { titulo: "ITSE", ancho: 6 },
        { titulo: "Ubicación", ancho: 24 }, { titulo: "Contrato", ancho: 14 }, { titulo: "Monto", ancho: 12 }, { titulo: "Informe / certificado", ancho: 40 },
      ],
      lista.map(({ datos: p }) => [
        p.servicio, p.categoria, p.proveedor ?? "", p.frecuencia_meses, p.ultimo, proximoPreventivo(p), p.activo === false ? "Inactivo" : SEMAFORO_TEXTO[estadoDe(p)],
        p.itse ? "Sí" : "", p.ubicacion ?? "", p.contrato ?? "", p.monto ?? null, p.enlace ?? "",
      ]),
      { titulo: `Mantenimientos preventivos contratados · ${nombreCampus(campus)}`, detalle: `Al ${formatoFecha(hoy)} · ${lista.length} servicio(s)` },
      "preventivos-contratados",
      "Preventivos"
    );
  }

  if (error) return <Aviso tono="error">{error}</Aviso>;
  if (!data) return <Cargando />;
  const ya = new Set<string>(data.preventivos.map((p) => claveTexto(p.datos.servicio)));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <Kpi titulo="Servicios activos" valor={activos.length} activo={filtro === "todos"} onClick={() => setFiltro("todos")} />
        <Kpi titulo="Vencidos o sin registro" valor={kpi.vencido} tono={kpi.vencido ? "text-danger" : ""} activo={filtro === "vencido"} onClick={() => setFiltro("vencido")} />
        <Kpi titulo="Vencen en 30 días" valor={kpi.por_vencer} tono={kpi.por_vencer ? "text-aviso" : ""} activo={filtro === "por_vencer"} onClick={() => setFiltro("por_vencer")} />
        <Kpi titulo="Al día" valor={kpi.al_dia} tono="text-teal" />
        <Kpi titulo="ITSE pendientes" valor={kpi.itse} detalle="lo que revisa Defensa Civil" tono={kpi.itse ? "text-danger" : ""} activo={filtro === "itse"} onClick={() => setFiltro("itse")} />
      </div>

      <Seccion
        titulo={`Servicios (${lista.length})`}
        extra={
          <div className="flex flex-wrap gap-2">
            <select value={cat} onChange={(e) => setCat(e.target.value)} className={`${INPUT_B} w-52`}>
              <option value="">Todas las categorías</option>
              {CATEGORIAS_PREVENTIVO.map((c) => <option key={c}>{c}</option>)}
            </select>
            <button type="button" className={BOTON} onClick={exportar} disabled={!lista.length}>Descargar Excel</button>
            {esAdmin && <button type="button" className={BOTON} onClick={() => setAgregar(agregar === "uno" ? "" : "uno")}>+ Servicio</button>}
            {esAdmin && <button type="button" className={BOTON} onClick={() => setAgregar(agregar === "sugeridos" ? "" : "sugeridos")}>+ Servicios sugeridos</button>}
          </div>
        }
      >
        {agregar === "uno" && <NuevoPreventivo onListo={() => { setAgregar(""); recargar(); }} />}
        {agregar === "sugeridos" && <Sugeridos ya={ya} onListo={() => { setAgregar(""); recargar(); }} />}
        {data.preventivos.length === 0 && agregar === "" && (
          <p className="p-4 text-sm text-ink-soft">
            Aún no hay servicios. Usa “+ Servicios sugeridos” para cargar los más comunes (puertas cortafuego, ascensores, pozos a tierra,
            cisternas, extintores…) y luego indica la fecha del último servicio de cada uno.
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            {lista.length > 0 && (
              <thead className="bg-page border-b border-line">
                <tr><th className={TH}>Servicio</th><th className={TH}>Proveedor</th><th className={TH}>Cada</th><th className={TH}>Último</th>
                  <th className={TH}>Próximo</th><th className={TH}>Informe</th><th className={TH}></th></tr>
              </thead>
            )}
            <tbody>
              {lista.map((r) => (
                <FilaPreventivo key={r.id} r={r} hoy={hoy} esAdmin={esAdmin} abierto={abierto === r.id}
                  onAbrir={() => setAbierto(abierto === r.id ? null : r.id)} onCambio={recargar} />
              ))}
            </tbody>
          </table>
        </div>
      </Seccion>

      {activos.length > 0 && (
        <Seccion titulo="Calendario de los próximos 12 meses">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line">
                  <th className={TH}>Servicio</th>
                  {meses.map((m) => <th key={m} className="px-1 py-2 text-center font-medium text-ink-soft">{MESES[Number(m.slice(5)) - 1]}<br />{m.slice(2, 4)}</th>)}
                </tr>
              </thead>
              <tbody>
                {activos.map(({ id, datos: p }) => {
                  const toca = new Set<string>();
                  const prox = proximoPreventivo(p);
                  if (prox) for (let f = prox, i = 0; i < 24 && f.slice(0, 7) <= meses[11]; f = sumarMeses(f, p.frecuencia_meses), i++) toca.add(f.slice(0, 7));
                  const atrasado = !p.ultimo || (prox && prox < hoy);
                  return (
                    <tr key={id} className="border-b border-line">
                      <td className="px-3 py-1.5 whitespace-nowrap">{corta(p.servicio, 46)} {p.itse && <span className="text-[10px] text-danger font-medium">ITSE</span>}</td>
                      {meses.map((m, i) => (
                        <td key={m} className="text-center px-1">
                          {i === 0 && atrasado ? <span title="Atrasado" className="inline-block w-3 h-3 rounded-full bg-danger" /> :
                            toca.has(m) ? <span title={`Toca en ${m}`} className="inline-block w-3 h-3 rounded-full bg-slate-ink" /> : null}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-xs text-ink-soft">● toca ese mes · <span className="text-danger">●</span> atrasado o sin fecha del último servicio.</p>
        </Seccion>
      )}
    </div>
  );
}

function FilaPreventivo({ r, hoy, esAdmin, abierto, onAbrir, onCambio }: {
  r: Registro<Preventivo>; hoy: string; esAdmin: boolean; abierto: boolean; onAbrir: () => void; onCambio: () => void;
}) {
  const p = r.datos;
  const prox = proximoPreventivo(p);
  const s: Semaforo = p.ultimo ? semaforo(prox, hoy) : "sin_dato";
  const inactivo = p.activo === false;
  return (
    <>
      <tr className={`border-b border-line ${inactivo ? "opacity-50" : ""}`}>
        <td className={TD}>
          <span className="font-medium">{p.servicio}</span> {p.itse && <span className="text-[10px] rounded bg-danger-soft text-danger px-1 font-medium">ITSE</span>}
          <span className="block text-xs text-ink-soft">{p.categoria}{p.ubicacion ? ` · ${p.ubicacion}` : ""}</span>
        </td>
        <td className={TD}>{p.proveedor || "—"}</td>
        <td className={`${TD} whitespace-nowrap`}>{p.frecuencia_meses} {p.frecuencia_meses === 1 ? "mes" : "meses"}</td>
        <td className={`${TD} whitespace-nowrap`}>{formatoFecha(p.ultimo)}</td>
        <td className={`${TD} whitespace-nowrap`}>
          {prox ? formatoFecha(prox) : "—"}{" "}
          {!inactivo && <Chip s={s} texto={s === "sin_dato" ? "Sin registro" : s === "vencido" ? `Vencido ${-diasEntre(hoy, prox!)} d` : s === "por_vencer" ? `En ${diasEntre(hoy, prox!)} d` : "Al día"} />}
        </td>
        <td className={TD}>{p.enlace ? <a href={p.enlace} target="_blank" rel="noreferrer" className="underline">Abrir</a> : "—"}</td>
        <td className={TD}><button type="button" className={BOTON} onClick={onAbrir}>{abierto ? "Cerrar" : esAdmin ? "Gestionar" : "Ver"}</button></td>
      </tr>
      {abierto && (
        <tr className="border-b border-line bg-page/60">
          <td colSpan={7} className="px-3 py-3">
            <DetallePreventivo r={r} esAdmin={esAdmin} onCambio={onCambio} />
          </td>
        </tr>
      )}
    </>
  );
}

function CamposPreventivo({ p, set, esAdmin }: { p: Preventivo; set: (p: Preventivo) => void; esAdmin: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
      <label className="lg:col-span-2">Servicio<input className={INPUT} disabled={!esAdmin} value={p.servicio} maxLength={200} onChange={(e) => set({ ...p, servicio: e.target.value })} /></label>
      <label>Categoría
        <select className={INPUT} disabled={!esAdmin} value={p.categoria} onChange={(e) => set({ ...p, categoria: e.target.value })}>
          {[...new Set([...CATEGORIAS_PREVENTIVO, p.categoria])].map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <label>Frecuencia (meses)<input type="number" min={1} max={120} className={INPUT} disabled={!esAdmin} value={p.frecuencia_meses || ""} onChange={(e) => set({ ...p, frecuencia_meses: Number(e.target.value) })} /></label>
      <label>Proveedor<input className={INPUT} disabled={!esAdmin} value={p.proveedor ?? ""} onChange={(e) => set({ ...p, proveedor: e.target.value })} /></label>
      <label>Último servicio<input type="date" className={INPUT} disabled={!esAdmin} value={p.ultimo ?? ""} max={hoyLima()} onChange={(e) => set({ ...p, ultimo: e.target.value || null })} /></label>
      <label>Ubicación<input className={INPUT} disabled={!esAdmin} value={p.ubicacion ?? ""} onChange={(e) => set({ ...p, ubicacion: e.target.value })} placeholder="Ej.: Pabellón A, sótano" /></label>
      <label>N° de contrato / OC<input className={INPUT} disabled={!esAdmin} value={p.contrato ?? ""} onChange={(e) => set({ ...p, contrato: e.target.value })} /></label>
      <label>Monto por servicio (S/)<input type="number" min={0} step="0.01" className={INPUT} disabled={!esAdmin} value={p.monto ?? ""} onChange={(e) => set({ ...p, monto: e.target.value === "" ? null : Number(e.target.value) })} /></label>
      <label className="lg:col-span-2">Enlace al último informe o certificado<input className={INPUT} disabled={!esAdmin} value={p.enlace ?? ""} onChange={(e) => set({ ...p, enlace: e.target.value })} placeholder="https://…sharepoint.com/…" /></label>
      <label className="flex items-center gap-2 mt-5"><input type="checkbox" disabled={!esAdmin} checked={p.itse} onChange={(e) => set({ ...p, itse: e.target.checked })} /> Lo revisa la ITSE</label>
      <label className="flex items-center gap-2 mt-5"><input type="checkbox" disabled={!esAdmin} checked={p.activo !== false} onChange={(e) => set({ ...p, activo: e.target.checked })} /> Activo</label>
      <label className="sm:col-span-2 lg:col-span-4">Notas<input className={INPUT} disabled={!esAdmin} value={p.notas ?? ""} onChange={(e) => set({ ...p, notas: e.target.value })} /></label>
    </div>
  );
}

function DetallePreventivo({ r, esAdmin, onCambio }: { r: Registro<Preventivo>; esAdmin: boolean; onCambio: () => void }) {
  const [p, setP] = useState<Preventivo>(r.datos);
  const valido = p.servicio.trim().length > 0 && p.frecuencia_meses >= 1;
  const estado = useAutoGuardar(p, (v) => enviar("preventivos", { tipo: "preventivo", id: r.id, datos: v }).then(onCambio), esAdmin && valido);
  const [hecho, setHecho] = useState({ fecha: hoyLima(), nota: "", enlace: "" });
  const [msg, setMsg] = useState("");
  async function registrar() {
    try {
      setMsg("");
      const d = await enviar<Registro<Preventivo>>("preventivos", { id: r.id, ...hecho }, "realizado");
      setP({ ...p, ultimo: d.datos.ultimo, historial: d.datos.historial });
      setHecho({ fecha: hoyLima(), nota: "", enlace: "" });
      setMsg("Registrado ✓");
      onCambio();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo registrar");
    }
  }
  return (
    <div className="space-y-3">
      <CamposPreventivo p={p} set={setP} esAdmin={esAdmin} />
      <div className="flex items-center justify-between gap-2">
        <Guardado estado={estado} />
        {esAdmin && <BotonBorrar texto="Borrar servicio" onBorrar={() => borrar("preventivos", r.id).then(onCambio).catch(() => {})} />}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {esAdmin && (
          <div className="border border-line rounded-md bg-white p-3 text-sm space-y-2">
            <p className="font-medium">Registrar servicio realizado</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <label>Fecha<input type="date" className={INPUT} max={hoyLima()} value={hecho.fecha} onChange={(e) => setHecho({ ...hecho, fecha: e.target.value })} /></label>
              <label className="sm:col-span-2">Enlace al informe<input className={INPUT} value={hecho.enlace} onChange={(e) => setHecho({ ...hecho, enlace: e.target.value })} placeholder="https://…" /></label>
              <label className="sm:col-span-3">Nota<input className={INPUT} value={hecho.nota} onChange={(e) => setHecho({ ...hecho, nota: e.target.value })} placeholder="Observaciones del proveedor" /></label>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className={BOTON_P} disabled={!hecho.fecha} onClick={registrar}>Registrar</button>
              {msg && <span className="text-xs text-ink-soft">{msg}</span>}
            </div>
          </div>
        )}
        <div className="text-sm">
          <p className="font-medium mb-1">Historial ({p.historial.length})</p>
          {p.historial.length === 0 ? <p className="text-ink-soft">Sin servicios registrados todavía.</p> : (
            <ul className="space-y-1">
              {[...p.historial].sort((a, b) => b.fecha.localeCompare(a.fecha)).map((h, i) => (
                <li key={i}>
                  <b>{formatoFecha(h.fecha)}</b> {h.nota ? `· ${h.nota}` : ""} {h.enlace && <a href={h.enlace} target="_blank" rel="noreferrer" className="underline">informe</a>}
                  {h.usuario && <span className="text-xs text-ink-soft"> · {h.usuario}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function NuevoPreventivo({ onListo }: { onListo: () => void }) {
  const [p, setP] = useState<Preventivo>(PREVENTIVO_VACIO);
  const [msg, setMsg] = useState("");
  return (
    <div className="p-3 border-b border-line bg-page/60 space-y-2">
      <CamposPreventivo p={p} set={setP} esAdmin />
      <div className="flex items-center gap-2">
        <button type="button" className={BOTON_P} disabled={!p.servicio.trim() || !p.frecuencia_meses}
          onClick={() => enviar("preventivos", { tipo: "preventivo", datos: p }).then(onListo).catch((e) => setMsg(e.message))}>Agregar servicio</button>
        {msg && <span className="text-xs text-danger">{msg}</span>}
      </div>
    </div>
  );
}

function Sugeridos({ ya, onListo }: { ya: Set<string>; onListo: () => void }) {
  const libres = SERVICIOS_SUGERIDOS.filter((s) => !ya.has(claveTexto(s.servicio)));
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set(libres.map((s) => s.servicio)));
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState("");
  async function agregar() {
    setOcupado(true);
    try {
      for (const s of libres.filter((x) => marcados.has(x.servicio))) {
        await enviar("preventivos", { tipo: "preventivo", datos: { ...PREVENTIVO_VACIO, ...s } });
      }
      onListo();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo agregar");
    } finally {
      setOcupado(false);
    }
  }
  if (libres.length === 0) return <p className="p-3 text-sm text-ink-soft border-b border-line">Ya están todos los servicios sugeridos.</p>;
  return (
    <div className="p-3 border-b border-line bg-page/60 text-sm space-y-2">
      <p className="text-ink-soft">Frecuencias de referencia: ajústalas a tu contrato y a la norma vigente después de agregarlos.</p>
      <div className="grid gap-1 sm:grid-cols-2">
        {libres.map((s) => (
          <label key={s.servicio} className="flex items-center gap-2">
            <input type="checkbox" checked={marcados.has(s.servicio)}
              onChange={(e) => { const n = new Set(marcados); if (e.target.checked) n.add(s.servicio); else n.delete(s.servicio); setMarcados(n); }} />
            {s.servicio} <span className="text-xs text-ink-soft">cada {s.frecuencia_meses} m{s.itse ? " · ITSE" : ""}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className={BOTON_P} disabled={ocupado || marcados.size === 0} onClick={agregar}>{ocupado ? "Agregando…" : `Agregar ${marcados.size}`}</button>
        {msg && <span className="text-xs text-danger">{msg}</span>}
      </div>
    </div>
  );
}

// ───────── Reportes por QR ─────────

type FilaRep = Registro<Reporte> & { creado_en: string; foto_id: number | null };
type FiltroR = "pendientes" | (typeof ESTADOS_REPORTE)[number] | "todos";

export function Reportes() {
  const esAdmin = useMe()?.rol === "admin";
  const { data, error, recargar } = useApi<{ hoy: string; reportes: FilaRep[] }>("/api/gestion/reportes");
  const [filtro, setFiltro] = useState<FiltroR>("pendientes");
  const [cat, setCat] = useState("");
  const [verQr, setVerQr] = useState(false);
  const reps = data?.reportes ?? [];
  const cuenta = (e: string) => reps.filter((r) => r.datos.estado === e).length;
  const hace30 = sumarDias(data?.hoy ?? hoyLima(), -30, false);
  const vis = reps.filter((r) => {
    if (filtro === "pendientes" && r.datos.estado !== "Nuevo" && r.datos.estado !== "En atención") return false;
    if (filtro !== "pendientes" && filtro !== "todos" && r.datos.estado !== filtro) return false;
    return !cat || r.datos.categoria === cat;
  });
  const porCat = CATEGORIAS_REPORTE.map((c) => ({ c, n: reps.filter((r) => r.datos.categoria === c && r.creado_en.slice(0, 10) >= hace30).length })).filter((x) => x.n);

  if (error) return <Aviso tono="error">{error}</Aviso>;
  if (!data) return <Cargando />;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <Kpi titulo="Pendientes" valor={cuenta("Nuevo") + cuenta("En atención")} activo={filtro === "pendientes"} onClick={() => setFiltro("pendientes")} />
        <Kpi titulo="Nuevos" valor={cuenta("Nuevo")} tono={cuenta("Nuevo") ? "text-danger" : ""} detalle="sin revisar" activo={filtro === "Nuevo"} onClick={() => setFiltro("Nuevo")} />
        <Kpi titulo="En atención" valor={cuenta("En atención")} activo={filtro === "En atención"} onClick={() => setFiltro("En atención")} />
        <Kpi titulo="Resueltos" valor={cuenta("Resuelto")} activo={filtro === "Resuelto"} onClick={() => setFiltro("Resuelto")} />
        <Kpi titulo="Todos" valor={reps.length} detalle={`${reps.filter((r) => r.creado_en.slice(0, 10) >= hace30).length} en 30 días`} activo={filtro === "todos"} onClick={() => setFiltro("todos")} />
      </div>
      {porCat.length > 0 && (
        <div className="flex flex-wrap gap-1 text-xs">
          <span className="text-ink-soft mr-1">Últimos 30 días:</span>
          {porCat.map((x) => (
            <button key={x.c} type="button" onClick={() => setCat(cat === x.c ? "" : x.c)}
              className={`rounded-full border px-2 py-0.5 ${cat === x.c ? "bg-ink text-white border-ink" : "border-line-strong bg-white"}`}>{x.c} · {x.n}</button>
          ))}
        </div>
      )}

      <Seccion
        titulo={`Bandeja (${vis.length})`}
        extra={esAdmin ? <button type="button" className={BOTON} onClick={() => setVerQr(!verQr)}>{verQr ? "Cerrar" : "Imprimir QR de ambientes"}</button> : undefined}
      >
        {verQr && <GeneradorQr />}
        {vis.length === 0 ? (
          <p className="p-4 text-sm text-ink-soft">
            No hay reportes en este grupo. Cualquier persona puede reportar una falla escaneando el QR pegado en el ambiente
            (o entrando a <span className="font-mono">/reportar</span>), sin iniciar sesión.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {vis.map((r) => <FilaReporte key={r.id} r={r} esAdmin={esAdmin} onCambio={recargar} />)}
          </ul>
        )}
      </Seccion>
    </div>
  );
}

function FilaReporte({ r, esAdmin, onCambio }: { r: FilaRep; esAdmin: boolean; onCambio: () => void }) {
  const [v, setV] = useState({ estado: r.datos.estado, ticket_texto: r.datos.ticket_texto ?? "", nota: r.datos.nota ?? "" });
  const estado = useAutoGuardar(v, (x) => enviar("reportes", { tipo: "reporte", id: r.id, datos: x }), esAdmin);
  const [copiado, setCopiado] = useState(false);
  const d = r.datos;
  const texto = `Reporte N° ${r.id} (${formatoFecha(r.creado_en)}) · ${d.lugar} · ${d.categoria}\n${d.descripcion}${d.contacto ? `\nContacto: ${d.contacto}` : ""}`;
  return (
    <li className={`px-4 py-3 grid gap-3 md:grid-cols-[1fr_20rem] ${d.estado === "Nuevo" ? "bg-aviso-soft/40" : ""}`}>
      <div className="text-sm min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs">N° {r.id}</span>
          <span className="text-xs text-ink-soft">{new Date(r.creado_en).toLocaleString("es-PE", { timeZone: "America/Lima", dateStyle: "short", timeStyle: "short" })}</span>
          <span className="font-medium">{d.lugar}</span>
          <span className="text-[11px] rounded bg-concrete-dim px-1.5">{d.categoria}</span>
          {d.qr ? <span className="text-[11px] text-teal">✓ desde QR</span> : <span className="text-[11px] text-aviso" title="No vino de un QR impreso por la app: revisa que el lugar sea real">sin QR válido</span>}
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words">{d.descripcion}</p>
        {d.contacto && <p className="text-xs text-ink-soft mt-0.5">Contacto: {d.contacto}</p>}
        {d.foto && <div className="mt-2"><FotosMaterial clave={`reporte:${r.id}`} descripcion={d.descripcion} editable={false} /></div>}
        {d.ticket_id && <p className="text-xs mt-1">Ticket: <Link className="underline" href={`/correctivos/${d.ticket_id}`}>abrir</Link></p>}
      </div>
      <div className="space-y-1.5 text-sm">
        <select className={INPUT} disabled={!esAdmin} value={v.estado} onChange={(e) => setV({ ...v, estado: e.target.value as Reporte["estado"] })}>
          {ESTADOS_REPORTE.map((x) => <option key={x}>{x}</option>)}
        </select>
        <input className={INPUT} disabled={!esAdmin} placeholder="N° Ref. o ticket que lo atiende" value={v.ticket_texto} maxLength={50}
          onChange={(e) => setV({ ...v, ticket_texto: e.target.value.trim() })} />
        <input className={INPUT} disabled={!esAdmin} placeholder="Nota interna" value={v.nota} maxLength={1000} onChange={(e) => setV({ ...v, nota: e.target.value })} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BOTON} onClick={() => navigator.clipboard?.writeText(texto).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 2000); })}>
            {copiado ? "Copiado ✓" : "Copiar para el proveedor"}
          </button>
          {esAdmin && <BotonBorrar onBorrar={() => borrar("reportes", r.id).then(onCambio).catch(() => {})} />}
        </div>
        {esAdmin && !d.ticket_id && (
          // Del reporte al ticket: se pide la cotización con los datos ya escritos; al cargarla se crea el ticket
          // y basta con escribir su N° Ref. arriba (si el reporte es de un equipo, el ticket queda enlazado a él).
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <a className="underline font-medium"
              href={`mailto:?subject=${encodeURIComponent(`Solicitud de cotización · ${d.lugar}`.slice(0, 150))}&body=${encodeURIComponent(
                `Estimados:\n\nAgradeceremos enviarnos su cotización para atender la siguiente falla:\n\nLugar / equipo: ${d.lugar}\nCategoría: ${d.categoria}\nDescripción: ${d.descripcion}\n\nReporte N° ${r.id} del ${formatoFecha(r.creado_en)}.\n\nSaludos.`
              )}`}>
              Pedir cotización por correo
            </a>
            <Link className="underline" href="/correctivos">Cargar la cotización →</Link>
            <span className="text-ink-soft">luego escribe su N° Ref. arriba</span>
          </div>
        )}
        <Guardado estado={estado} />
      </div>
    </li>
  );
}

function GeneradorQr() {
  const campus = useMe()?.campus;
  const [lugares, setLugares] = useState("");
  const [msg, setMsg] = useState("");
  async function delInventario() {
    setMsg("");
    try {
      let lista: { ubicacion?: string; pabellon?: string; piso?: string }[] = [];
      const r = await fetch("/api/inventario?equipos=1");
      if (r.ok) lista = await r.json();
      else if (!campus || campus === "principal") {
        const f = await fetch("/inventario-equipos.json");
        lista = f.ok ? ((await f.json()).equipos ?? []) : [];
      }
      const nombres = [...new Set(lista.map((e) => [e.pabellon, e.piso, e.ubicacion].filter(Boolean).join(" · ").trim()).filter((x) => x.length >= 2))].sort();
      const actuales = lugares.split("\n").map((x) => x.trim()).filter(Boolean);
      setLugares([...new Set([...actuales, ...nombres])].join("\n"));
      setMsg(`${nombres.length} ambiente(s) del inventario`);
    } catch {
      setMsg("No se pudo leer el inventario");
    }
  }
  async function imprimir() {
    const lista = lugares.split("\n").map((x) => x.trim()).filter((x) => x.length >= 2);
    if (!lista.length) return;
    const w = window.open("", "_blank");
    if (!w) return;
    try {
      const firmados = await enviar<{ lugar: string; s: string; c: string }[]>("reportes", { lugares: lista }, "qr");
      const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
      const base = `${window.location.origin}/reportar`;
      const et = firmados.map((f) => {
        // El campus va en el QR: el reporte llega a la bandeja de ese campus (el principal no lo necesita).
        const url = `${base}?l=${encodeURIComponent(f.lugar)}&s=${f.s}${f.c && f.c !== "principal" ? `&c=${f.c}` : ""}`;
        return `<div class="et"><p class="t">¿Algo no funciona aquí?</p>${qrSvg(url, 150)}<p class="s">Escanea con la cámara y repórtalo.<br>No necesitas usuario.</p><p class="l">${esc(f.lugar)}</p></div>`;
      }).join("");
      w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>QR de reporte · ambientes</title>
<style>body{font-family:Arial,sans-serif;margin:12px}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.et{border:1px dashed #999;padding:10px;text-align:center;break-inside:avoid}.et svg{display:block;margin:4px auto}
.t{font-weight:bold;font-size:15px;margin:0;color:#d0112d}.s{font-size:11px;margin:4px 0;color:#333}.l{font-size:12px;font-weight:bold;margin:4px 0 0}
button{margin:0 0 10px;padding:6px 12px}@media print{button{display:none}body{margin:6mm}}</style></head><body>
<button onclick="print()">Imprimir</button><div class="g">${et}</div></body></html>`);
      w.document.close();
    } catch (e) {
      w.close();
      setMsg(e instanceof Error ? e.message : "No se pudieron preparar los QR");
    }
  }
  return (
    <div className="p-3 border-b border-line bg-page/60 text-sm space-y-2">
      <p className="text-ink-soft">
        Un ambiente por línea (ej.: “Pabellón A · Piso 3 · Baño de damas”). Cada QR lleva una firma: así la bandeja distingue los reportes que
        vienen de un QR real de los que alguien escribió a mano.
      </p>
      <textarea rows={6} className={INPUT} value={lugares} onChange={(e) => setLugares(e.target.value)} placeholder={"Pabellón A · Piso 1 · Baño de varones\nPabellón B · Piso 4 · Aula B401"} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BOTON} onClick={delInventario}>Agregar ambientes del inventario</button>
        <button type="button" className={BOTON_P} disabled={!lugares.trim()} onClick={imprimir}>Preparar QR ({lugares.split("\n").filter((x) => x.trim().length >= 2).length})</button>
        {msg && <span className="text-xs text-ink-soft">{msg}</span>}
      </div>
    </div>
  );
}

// ───────── Informe mensual ─────────

export function Informe() {
  const me = useMe();
  const esAdmin = me?.rol === "admin";
  const campus = me?.campus;
  const hoy = hoyLima();
  const meses = Array.from({ length: 18 }, (_, i) => sumarMeses(`${hoy.slice(0, 7)}-01`, -i).slice(0, 7));
  // Por defecto, el mes que acaba de cerrar (en los primeros días del mes) o el actual.
  const [mes, setMes] = useState(() => (Number(hoy.slice(8)) <= 10 ? meses[1] : meses[0]));
  const { data, error } = useApi<InformeMes>(`/api/gestion/informe?mes=${mes}`);
  const nota = useRef<Record<string, string>>({});
  const [pdf, setPdf] = useState("");

  async function descargar() {
    if (!data) return;
    setPdf("Preparando…");
    try {
      const { crearPdfInforme } = await import("@/lib/solicitudPdf");
      const bytes = await crearPdfInforme({ ...data, nota: nota.current[data.mes] ?? data.nota }, nombreMes(data.mes), nombreCampus(campus));
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `informe-mensual-${campus && campus !== "principal" ? `${campus}-` : ""}${data.mes}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setPdf("");
    } catch (e) {
      setPdf(e instanceof Error ? e.message : "No se pudo crear el PDF");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">Mes{" "}
          <select value={mes} onChange={(e) => setMes(e.target.value)} className={`${INPUT_B} w-44 inline-block capitalize`}>
            {meses.map((m) => <option key={m} value={m}>{nombreMes(m)}</option>)}
          </select>
        </label>
        <button type="button" className={BOTON_P} disabled={!data} onClick={descargar}>Descargar PDF</button>
        {pdf && <span className="text-xs text-ink-soft">{pdf}</span>}
      </div>
      {error && <Aviso tono="error">{error}</Aviso>}
      {!data && !error && <Cargando />}
      {data && data.mes === mes && <VistaInforme d={data} />}
      {data && data.mes === mes && (
        <NotaInforme key={data.mes} mes={data.mes} inicial={data.nota} esAdmin={esAdmin} onCambio={(t) => (nota.current[data.mes] = t)} />
      )}
    </div>
  );
}

function NotaInforme({ mes, inicial, esAdmin, onCambio }: { mes: string; inicial: string; esAdmin: boolean; onCambio: (t: string) => void }) {
  const [texto, setTexto] = useState(inicial);
  const estado = useAutoGuardar(texto, (v) => enviar("informe", { tipo: "informe_nota", datos: { mes, nota: v } }), esAdmin, 1500);
  return (
    <Seccion titulo="Comentarios para gerencia" extra={<Guardado estado={estado} />}>
      <div className="p-3">
        <textarea rows={4} className={INPUT} disabled={!esAdmin} maxLength={4000} value={texto}
          onChange={(e) => { setTexto(e.target.value); onCambio(e.target.value); }}
          placeholder="Logros, riesgos y lo que necesitas de gerencia este mes. Va al final del PDF." />
      </div>
    </Seccion>
  );
}

function VistaInforme({ d }: { d: InformeMes }) {
  const t = d.tickets;
  const pct = d.gasto.presupuestoAnio ? Math.round((d.gasto.anio / d.gasto.presupuestoAnio) * 100) : null;
  const inv = d.inventario;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-7">
        <Kpi titulo="Tickets nuevos" valor={t.creados} detalle={`en ${nombreMes(d.mes)}`} />
        <Kpi titulo="Finalizados" valor={t.finalizados} detalle="en el mes" tono="text-teal" />
        <Kpi titulo="Abiertos hoy" valor={t.abiertos} detalle={`${t.atrasados} atrasado(s)`} tono={t.atrasados ? "text-danger" : ""} />
        <Kpi titulo="Gasto del mes" valor={soles(d.gasto.mes)} />
        <Kpi titulo="Gasto del año" valor={soles(d.gasto.anio)} detalle={pct !== null ? `${pct} % del presupuesto` : "sin presupuesto cargado"} tono={pct !== null && pct >= 80 ? "text-danger" : ""} />
        <Kpi titulo="Reportes por QR" valor={d.reportes.recibidos} detalle={`${d.reportes.pendientes} pendiente(s)`} />
        <Kpi titulo="SLA cotización → OC" valor={d.sla.promedio === null ? "—" : `${d.sla.promedio} d`}
          tono={d.sla.promedio !== null && d.sla.promedio > d.sla.meta ? "text-danger" : d.sla.promedio !== null ? "text-teal" : ""}
          detalle={d.sla.n ? `${d.sla.enMeta}/${d.sla.n} OC en meta (${d.sla.meta} d háb.)` : `meta ${d.sla.meta} días hábiles`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion titulo="Tickets abiertos por estado">
          <ul className="p-3 text-sm space-y-1">
            {t.porEstado.map((x) => <li key={x.estado} className="flex justify-between"><span>{x.estado || "Sin estado"}</span><b className="tabular-nums">{x.n}</b></li>)}
          </ul>
          <p className="px-3 pb-1 text-xs font-medium text-ink-soft uppercase tracking-wider">Los más antiguos</p>
          <ul className="px-3 pb-3 text-sm space-y-1">
            {t.antiguos.map((x) => <li key={x.id}><RefTicket t={{ ...x, ticket: null }} /> {x.dias} días · {x.estado} · {corta(x.descripcion, 70)}</li>)}
          </ul>
        </Seccion>
        <Seccion titulo="Gasto del mes">
          <div className="p-3 grid gap-3 sm:grid-cols-2 text-sm">
            <div>
              <p className="text-xs font-medium text-ink-soft uppercase tracking-wider mb-1">Por cuenta</p>
              {d.gasto.porCuenta.length === 0 ? <p className="text-ink-soft">Sin gasto.</p> :
                d.gasto.porCuenta.map((x) => <p key={x.cuenta} className="flex justify-between gap-2"><span className="truncate">{x.cuenta}</span><b className="tabular-nums">{soles(x.monto)}</b></p>)}
            </div>
            <div>
              <p className="text-xs font-medium text-ink-soft uppercase tracking-wider mb-1">Principales proveedores</p>
              {d.gasto.proveedores.map((x) => <p key={x.proveedor} className="flex justify-between gap-2"><span className="truncate">{x.proveedor}</span><b className="tabular-nums">{soles(x.monto)}</b></p>)}
              <p className="mt-2 text-ink-soft">Materiales: {d.gasto.materiales.n} solicitud(es) · {soles(d.gasto.materiales.total)} sin IGV</p>
            </div>
          </div>
        </Seccion>
        <Seccion titulo="Preventivos contratados">
          <div className="p-3 text-sm space-y-2">
            <p>{d.preventivos.total} servicio(s) activos · {d.preventivos.realizados.length} realizado(s) en el mes · <span className={d.preventivos.vencidos.length ? "text-danger font-medium" : ""}>{d.preventivos.vencidos.length} vencido(s) o sin registro</span></p>
            {d.preventivos.realizados.length > 0 && <p><b>Realizados:</b> {d.preventivos.realizados.map((x) => `${x.servicio} (${formatoFecha(x.fecha)})`).join("; ")}</p>}
            {d.preventivos.vencidos.length > 0 && <p className="text-danger"><b>Vencidos:</b> {d.preventivos.vencidos.map((x) => x.servicio).join("; ")}</p>}
            {d.preventivos.proximos.length > 0 && <p><b>Próximos 30 días:</b> {d.preventivos.proximos.map((x) => `${x.servicio} (${formatoFecha(x.proximo)})`).join("; ")}</p>}
          </div>
        </Seccion>
        <Seccion titulo="Garantías y contratistas">
          <div className="p-3 text-sm space-y-2">
            <p>{d.garantias.vigentes} garantía(s) vigente(s) · <span className={d.garantias.posiblesReclamos ? "text-danger font-medium" : ""}>{d.garantias.posiblesReclamos} con posible reclamo</span></p>
            {d.garantias.porVencer.length > 0 && <p><b>Vencen en 30 días:</b> {d.garantias.porVencer.map((g) => `#${g.refer ?? "—"} ${g.proveedor ?? ""} (${formatoFecha(g.hasta)})`).join("; ")}</p>}
            {d.contratistas.conAlertas.length === 0 ? <p>Contratistas del mes con documentación completa.</p> : (
              <p className="text-danger"><b>Contratistas con faltantes:</b> {d.contratistas.conAlertas.map((c) => `${c.proveedor} (${c.alertas.join(", ")})`).join("; ")}</p>
            )}
          </div>
        </Seccion>
        <Seccion titulo="Reportes por QR">
          <div className="p-3 text-sm">
            {d.reportes.porCategoria.length === 0 ? <p className="text-ink-soft">Sin reportes en el mes.</p> :
              d.reportes.porCategoria.map((x) => <p key={x.categoria} className="flex justify-between"><span>{x.categoria}</span><b>{x.n}</b></p>)}
          </div>
        </Seccion>
        <Seccion titulo="Inventario de equipos">
          <div className="p-3 text-sm">
            {!inv ? <p className="text-ink-soft">Sin foto del inventario para este mes.</p> : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <span>Equipos</span><b className="tabular-nums">{inv.total ?? 0}</b>
                <span>Operativos</span><b className="tabular-nums">{inv.operativos ?? 0}</b>
                <span>Con observación</span><b className="tabular-nums">{inv.observacion ?? 0}</b>
                <span>Inoperativos</span><b className="tabular-nums text-danger">{inv.inoperativos ?? 0}</b>
                <span>Para reemplazo</span><b className="tabular-nums">{inv.reemplazo ?? 0}</b>
                <span>Vida útil superada</span><b className="tabular-nums">{inv.vida_superada ?? 0}</b>
              </div>
            )}
          </div>
        </Seccion>
      </div>
    </div>
  );
}

// ───────── Planos ─────────

type DatosPlanos = { hoy: string; planos: Registro<Plano>[]; archivos: ArchivoPlano[] };
const URL_ARCHIVO = (id: number, descargar = false) => `/api/gestion/planos?archivo=${id}${descargar ? "&descargar=1" : ""}`;
const pesoTexto = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const sinExt = (n: string) => n.replace(/\.[a-z0-9]+$/i, "");
const COLOR_DISCIPLINA: Record<string, string> = {
  Arquitectura: "#1e3a5f", "Seguridad / ITSE": "#d0112d", "Instalaciones eléctricas": "#d49a1e", "Instalaciones sanitarias": "#1f7ab8",
  "Instalaciones mecánicas (HVAC)": "#127a56", Estructuras: "#6b4f9e", "Comunicaciones / Data": "#2f8f9d", "Agua contra incendio": "#b5452c",
  Gas: "#8a6d1f", Otro: "#7a8190",
};
const COLOR_ESTADO_PLANO: Record<string, string> = {
  Vigente: "bg-teal-soft text-teal", "En revisión": "bg-aviso-soft text-aviso", Reemplazado: "bg-concrete-dim text-ink-soft",
};

/**
 * Miniatura que AutoCAD guarda dentro del DWG (una imagen PNG pequeña de la última vista): se extrae en el
 * navegador para mostrar el plano en la cuadrícula aunque no se haya subido su PDF.
 */
async function miniaturaDeDwg(f: File): Promise<Blob | null> {
  try {
    const b = new Uint8Array(await f.slice(0, 2 * 1024 * 1024).arrayBuffer());
    const firma = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    let i = -1;
    for (let k = 0; k < b.length - 8 && i < 0; k++) if (firma.every((x, j) => b[k + j] === x)) i = k;
    if (i < 0) return null;
    for (let k = i + 8; k < b.length - 8; k++) {
      if (b[k] === 0x49 && b[k + 1] === 0x45 && b[k + 2] === 0x4e && b[k + 3] === 0x44) return new Blob([b.slice(i, k + 8)], { type: "image/png" });
    }
  } catch {}
  return null;
}

/** Sube un archivo en partes de 3 MB (Vercel no acepta más de 4,5 MB por envío). Devuelve el archivo creado. */
async function subirArchivoPlano(planoId: number, archivo: Blob, nombre: string, alAvanzar: (p: number) => void, miniatura = false): Promise<ArchivoPlano> {
  const ini = await enviar<{ id: number; parte: number; partes: number }>("planos", { plano_id: planoId, nombre, tamano: archivo.size, miniatura }, "iniciar");
  for (let n = 0; n < ini.partes; n++) {
    const trozo = archivo.slice(n * ini.parte, Math.min(archivo.size, (n + 1) * ini.parte));
    let r: Response | null = null;
    for (let intento = 0; intento < 3; intento++) {
      r = await fetch(`/api/gestion/planos?accion=parte&id=${ini.id}&n=${n}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: trozo }).catch(() => null);
      if (r?.ok || (r && r.status < 500)) break;
    }
    if (!r?.ok) throw new Error((await r?.json().catch(() => ({})))?.error || "Se cortó la conexión al subir el archivo");
    alAvanzar((n + 1) / ini.partes);
  }
  return enviar<ArchivoPlano>("planos", { id: ini.id }, "terminar");
}

type Subida = { nombre: string; avance: number; error?: string; listo?: boolean };

function BibliotecaPlanos() {
  const esAdmin = useMe()?.rol === "admin";
  const { data, setData, error, recargar } = useApi<DatosPlanos>("/api/gestion/planos");
  const [q, setQ] = useState("");
  const [disc, setDisc] = useState("");
  const [estado, setEstado] = useState("");
  const [falta, setFalta] = useState<"" | "pdf" | "dwg">("");
  const [vista, setVista] = useState<"cuadricula" | "lista">("cuadricula");
  const [abierto, setAbierto] = useState<number | null>(null);
  const [subidas, setSubidas] = useState<Subida[]>([]);
  const [arrastrando, setArrastrando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem("planos:vista");
      if (v === "lista" || v === "cuadricula") setVista(v); // eslint-disable-line react-hooks/set-state-in-effect
    } catch {}
  }, []);
  const cambiarVista = (v: "cuadricula" | "lista") => {
    setVista(v);
    try {
      localStorage.setItem("planos:vista", v);
    } catch {}
  };

  const planos = useMemo(() => data?.planos ?? [], [data]);
  const archivosDe = useMemo(() => {
    const m = new Map<number, ArchivoPlano[]>();
    for (const a of data?.archivos ?? []) m.set(a.plano_id, [...(m.get(a.plano_id) ?? []), a]);
    return m;
  }, [data]);
  const tiene = (id: number, clase: string) => (archivosDe.get(id) ?? []).some((a) => a.clase === clase || (clase === "pdf" && a.clase === "imagen"));
  const vis = planos
    .filter((p) => {
      const d = p.datos;
      if (disc && d.disciplina !== disc) return false;
      if (estado && d.estado !== estado) return false;
      if (falta === "pdf" && tiene(p.id, "pdf")) return false;
      if (falta === "dwg" && tiene(p.id, "dwg")) return false;
      if (!q) return true;
      const t = claveTexto([d.codigo, d.titulo, d.disciplina, d.ubicacion, d.revision, d.autor, d.notas, ...(d.etiquetas ?? []), ...(archivosDe.get(p.id) ?? []).map((a) => a.nombre)].join(" "));
      return claveTexto(q).split(/\s+/).every((w) => !w || t.includes(w)) || t.includes(claveTexto(q));
    })
    .sort((a, b) => (a.datos.disciplina + a.datos.codigo + a.datos.titulo).localeCompare(b.datos.disciplina + b.datos.codigo + b.datos.titulo, "es", { numeric: true }));
  const porDisc = DISCIPLINAS_PLANO.map((d) => ({ d, n: planos.filter((p) => p.datos.disciplina === d).length })).filter((x) => x.n);
  const actual = planos.find((p) => p.id === abierto) ?? null;

  /** Registra los archivos elegidos: los que tienen el mismo nombre (sin extensión) van al mismo plano. */
  const ocupado = useRef(false);
  async function subirVarios(lista: FileList | File[]) {
    if (ocupado.current) return; // un doble evento no debe registrar los planos dos veces
    ocupado.current = true;
    try {
      await subirTodos(Array.from(lista));
    } finally {
      ocupado.current = false;
    }
  }
  async function subirTodos(files: File[]) {
    const malos = files.filter((f) => !claseArchivoPlano(f.name) || f.size > MAX_PLANO);
    const buenos = files.filter((f) => !malos.includes(f));
    setSubidas([
      ...malos.map((f) => ({ nombre: f.name, avance: 0, error: f.size > MAX_PLANO ? `Pesa más de ${MAX_PLANO / 1024 / 1024} MB` : "Formato no admitido" })),
      ...buenos.map((f) => ({ nombre: f.name, avance: 0 })),
    ]);
    const marcar = (nombre: string, cambio: Partial<Subida>) => setSubidas((s) => s.map((x) => (x.nombre === nombre ? { ...x, ...cambio } : x)));
    const grupos = new Map<string, File[]>();
    for (const f of buenos) grupos.set(claveTexto(sinExt(f.name)), [...(grupos.get(claveTexto(sinExt(f.name))) ?? []), f]);
    for (const [clave, grupo] of grupos) {
      // ¿Ya hay un plano con un archivo del mismo nombre? Se le agrega (p. ej. el PDF de un DWG ya subido).
      const existente = (data?.archivos ?? []).find((a) => a.clase !== "miniatura" && claveTexto(sinExt(a.nombre)) === clave);
      let planoId = existente?.plano_id ?? null;
      try {
        if (!planoId) {
          const base = grupo.find((f) => claseArchivoPlano(f.name) === "dwg") ?? grupo[0];
          const dd = datosDesdeNombre(base.name);
          const nuevo = await enviar<Registro<Plano>>("planos", {
            tipo: "plano",
            datos: { ...dd, revision: "", estado: "Vigente", autor: "", notas: "", etiquetas: [] },
          });
          planoId = nuevo.id;
        }
        for (const f of grupo) {
          await subirArchivoPlano(planoId, f, f.name, (p) => marcar(f.name, { avance: p }));
          if (claseArchivoPlano(f.name) === "dwg" && !tiene(planoId, "miniatura")) {
            const mini = await miniaturaDeDwg(f);
            if (mini) await subirArchivoPlano(planoId, mini, `${sinExt(f.name)}.png`, () => {}, true).catch(() => null);
          }
          marcar(f.name, { listo: true, avance: 1 });
        }
      } catch (e) {
        for (const f of grupo) marcar(f.name, { error: e instanceof Error ? e.message : "No se pudo subir" });
      }
      recargar();
    }
    if (entrada.current) entrada.current.value = "";
  }

  async function nuevoManual() {
    try {
      const nuevo = await enviar<Registro<Plano>>("planos", {
        tipo: "plano",
        datos: { codigo: "", titulo: "Plano nuevo", disciplina: "Otro", ubicacion: "", revision: "", fecha: null, estado: "Vigente", autor: "", notas: "", etiquetas: [] },
      });
      setData((d) => (d ? { ...d, planos: [...d.planos, nuevo] } : d));
      setAbierto(nuevo.id);
    } catch {}
  }

  if (error) return <Aviso tono="error">{error}</Aviso>;
  if (!data) return <Cargando />;
  const sinPdf = planos.filter((p) => !tiene(p.id, "pdf")).length;
  const sinDwg = planos.filter((p) => !tiene(p.id, "dwg")).length;
  const pendientes = subidas.filter((s) => !s.listo && !s.error).length;

  return (
    <div
      className="space-y-4"
      onDragOver={(e) => {
        if (!esAdmin) return;
        e.preventDefault();
        setArrastrando(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setArrastrando(false);
      }}
      onDrop={(e) => {
        if (!esAdmin) return;
        e.preventDefault();
        setArrastrando(false);
        if (e.dataTransfer.files.length) void subirVarios(e.dataTransfer.files);
      }}
    >
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <Kpi titulo="Planos" valor={planos.length} detalle={`${(data.archivos ?? []).filter((a) => a.clase !== "miniatura").length} archivos`} activo={!estado && !falta && !disc} onClick={() => { setEstado(""); setFalta(""); setDisc(""); }} />
        <Kpi titulo="Vigentes" valor={planos.filter((p) => p.datos.estado === "Vigente").length} activo={estado === "Vigente"} onClick={() => setEstado(estado === "Vigente" ? "" : "Vigente")} />
        <Kpi titulo="En revisión" valor={planos.filter((p) => p.datos.estado === "En revisión").length} tono={planos.some((p) => p.datos.estado === "En revisión") ? "text-aviso" : ""} activo={estado === "En revisión"} onClick={() => setEstado(estado === "En revisión" ? "" : "En revisión")} />
        <Kpi titulo="Sin PDF" valor={sinPdf} detalle="no se pueden ver en la app" tono={sinPdf ? "text-danger" : ""} activo={falta === "pdf"} onClick={() => setFalta(falta === "pdf" ? "" : "pdf")} />
        <Kpi titulo="Sin DWG" valor={sinDwg} detalle="falta el archivo editable" activo={falta === "dwg"} onClick={() => setFalta(falta === "dwg" ? "" : "dwg")} />
      </div>

      <div className={`${TARJETA} p-3 flex flex-wrap items-center gap-2`}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por código, título, ubicación, etiqueta o archivo…" aria-label="Buscar planos" className={`${INPUT_B} flex-1 min-w-[14rem]`} />
        <select value={disc} onChange={(e) => setDisc(e.target.value)} aria-label="Disciplina" className={INPUT_B}>
          <option value="">Todas las disciplinas</option>
          {DISCIPLINAS_PLANO.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <span className="inline-flex rounded-md border border-line-strong overflow-hidden text-xs" role="group" aria-label="Vista">
          {(["cuadricula", "lista"] as const).map((v) => (
            <button key={v} type="button" onClick={() => cambiarVista(v)} aria-pressed={vista === v}
              className={`px-3 py-1.5 ${v === "lista" ? "border-l border-line-strong" : ""} ${vista === v ? "bg-ink text-white" : "bg-white text-ink-soft hover:bg-concrete-dim"}`}>
              {v === "cuadricula" ? "Cuadrícula" : "Lista"}
            </button>
          ))}
        </span>
        {esAdmin && (
          <>
            <label className={`${BOTON_P} cursor-pointer ${pendientes ? "opacity-50 pointer-events-none" : ""}`}>
              <input ref={entrada} type="file" multiple accept=".dwg,.dxf,.pdf,.png,.jpg,.jpeg,.webp" className="sr-only" onChange={(e) => e.target.files && void subirVarios(e.target.files)} />
              {pendientes ? `Subiendo ${pendientes}…` : "Subir planos"}
            </label>
            <button type="button" className={BOTON} onClick={() => void nuevoManual()}>Nuevo sin archivo</button>
          </>
        )}
      </div>

      {porDisc.length > 1 && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {porDisc.map((x) => (
            <button key={x.d} type="button" onClick={() => setDisc(disc === x.d ? "" : x.d)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${disc === x.d ? "bg-ink text-white border-ink" : "border-line-strong bg-white"}`}>
              <span className="w-2 h-2 rounded-full" style={{ background: COLOR_DISCIPLINA[x.d] }} aria-hidden="true" />
              {x.d} · {x.n}
            </button>
          ))}
        </div>
      )}

      {esAdmin && (arrastrando || planos.length === 0) && (
        <div
          onClick={() => entrada.current?.click()}
          className={`rounded-lg border-2 border-dashed p-8 text-center text-sm cursor-pointer ${arrastrando ? "border-amber bg-aviso-soft/40" : "border-line-strong bg-white text-ink-soft"}`}
        >
          <p className="font-medium text-ink">Arrastra aquí los planos (DWG, PDF o imágenes) o toca para elegirlos</p>
          <p className="mt-1 text-xs">
            Se crea un plano por archivo y se completan código, título y disciplina desde el nombre. El DWG y su PDF con el mismo nombre quedan juntos.
            Hasta {MAX_PLANO / 1024 / 1024} MB por archivo.
          </p>
        </div>
      )}

      {subidas.length > 0 && (
        <div className={`${TARJETA} p-3 text-sm`}>
          <div className="flex items-center justify-between mb-2">
            <p className="font-medium">Subida de planos</p>
            {!pendientes && <button type="button" onClick={() => setSubidas([])} className="text-xs underline text-ink-soft">Ocultar</button>}
          </div>
          <ul className="space-y-1.5">
            {subidas.map((s) => (
              <li key={s.nombre} className="grid grid-cols-[1fr_10rem] gap-3 items-center text-xs">
                <span className="truncate" title={s.nombre}>{s.nombre}</span>
                {s.error ? <span className="text-danger">{s.error}</span> : s.listo ? <span className="text-teal font-medium">Listo</span> : (
                  <span className="h-1.5 rounded-full bg-concrete-dim overflow-hidden"><span className="block h-full bg-ink transition-all" style={{ width: `${Math.round(s.avance * 100)}%` }} /></span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {vis.length === 0 ? (
        planos.length > 0 && <p className="text-sm text-ink-soft bg-white border border-line rounded-lg p-4">Ningún plano coincide con la búsqueda.</p>
      ) : vista === "cuadricula" ? (
        <ul className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {vis.map((p) => {
            const arch = archivosDe.get(p.id) ?? [];
            const mini = arch.find((a) => a.clase === "miniatura") ?? arch.find((a) => a.clase === "imagen");
            return (
              <li key={p.id}>
                <button type="button" onClick={() => setAbierto(p.id)} className={`${TARJETA} w-full text-left overflow-hidden hover:shadow-card transition-shadow`}>
                  <span className="block aspect-[16/9] bg-page border-b border-line relative">
                    {mini ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={URL_ARCHIVO(mini.id)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-contain p-2" style={{ imageRendering: "auto" }} />
                    ) : (
                      <span className="absolute inset-0 flex items-center justify-center text-ink-soft">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M3 9h18M9 9v11M14 14h4" /></svg>
                      </span>
                    )}
                    <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: COLOR_DISCIPLINA[p.datos.disciplina] ?? "#7a8190" }} aria-hidden="true" />
                  </span>
                  <span className="block p-3">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-ink-soft truncate">{p.datos.codigo || "Sin código"}{p.datos.revision ? ` · Rev. ${p.datos.revision}` : ""}</span>
                      <span className={`text-[10px] rounded-full px-2 py-0.5 shrink-0 ${COLOR_ESTADO_PLANO[p.datos.estado] ?? ""}`}>{p.datos.estado}</span>
                    </span>
                    <span className="block font-medium text-sm mt-0.5 line-clamp-2">{p.datos.titulo}</span>
                    <span className="block text-xs text-ink-soft mt-0.5 truncate">{[p.datos.disciplina, p.datos.ubicacion].filter(Boolean).join(" · ")}</span>
                    <span className="flex gap-1 mt-2">
                      {(["dwg", "pdf"] as const).map((c) => (
                        <span key={c} className={`text-[10px] font-semibold rounded px-1.5 py-0.5 border ${tiene(p.id, c) ? "border-ink/30 text-ink" : "border-dashed border-line-strong text-ink-soft/60 line-through"}`}>
                          {c.toUpperCase()}
                        </span>
                      ))}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className={`${TARJETA} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead className="border-b border-line">
              <tr><th className={TH}>Código</th><th className={TH}>Título</th><th className={TH}>Disciplina</th><th className={TH}>Ubicación</th><th className={TH}>Rev.</th><th className={TH}>Fecha</th><th className={TH}>Estado</th><th className={TH}>Archivos</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {vis.map((p) => (
                <tr key={p.id} onClick={() => setAbierto(p.id)} className="cursor-pointer hover:bg-page">
                  <td className={`${TD} font-mono text-xs whitespace-nowrap`}>{p.datos.codigo || "—"}</td>
                  <td className={`${TD} font-medium`}>{p.datos.titulo}</td>
                  <td className={TD}><span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: COLOR_DISCIPLINA[p.datos.disciplina] }} />{p.datos.disciplina}</span></td>
                  <td className={TD}>{p.datos.ubicacion || "—"}</td>
                  <td className={TD}>{p.datos.revision || "—"}</td>
                  <td className={`${TD} whitespace-nowrap`}>{formatoFecha(p.datos.fecha) || "—"}</td>
                  <td className={TD}><span className={`text-[11px] rounded-full px-2 py-0.5 ${COLOR_ESTADO_PLANO[p.datos.estado] ?? ""}`}>{p.datos.estado}</span></td>
                  <td className={`${TD} text-xs whitespace-nowrap`}>{(["dwg", "pdf"] as const).filter((c) => tiene(p.id, c)).map((c) => c.toUpperCase()).join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {actual && (
        <DetallePlano
          r={actual}
          archivos={archivosDe.get(actual.id) ?? []}
          esAdmin={esAdmin}
          onCerrar={() => setAbierto(null)}
          onCambio={recargar}
          onDatos={(datos) => setData((d) => (d ? { ...d, planos: d.planos.map((p) => (p.id === actual.id ? { ...p, datos } : p)) } : d))}
          onBorrado={() => {
            setAbierto(null);
            recargar();
          }}
        />
      )}
    </div>
  );
}

/** Ficha del plano: visor (PDF o imagen; del DWG se muestra su miniatura), datos editables y archivos. */
function DetallePlano({ r, archivos, esAdmin, onCerrar, onCambio, onDatos, onBorrado }: {
  r: Registro<Plano>; archivos: ArchivoPlano[]; esAdmin: boolean; onCerrar: () => void; onCambio: () => void;
  onDatos: (d: Plano) => void; onBorrado: () => void;
}) {
  const [v, setV] = useState<Plano>({ ...r.datos, etiquetas: r.datos.etiquetas ?? [] });
  const [etiquetas, setEtiquetas] = useState((r.datos.etiquetas ?? []).join(", "));
  const estado = useAutoGuardar(v, async (x) => {
    await enviar("planos", { tipo: "plano", id: r.id, datos: x });
    onDatos(x);
  }, esAdmin);
  const visibles = archivos.filter((a) => a.clase !== "miniatura");
  const [verId, setVerId] = useState<number | null>(() => (visibles.find((a) => a.clase === "pdf") ?? visibles.find((a) => a.clase === "imagen"))?.id ?? null);
  const viendo = archivos.find((a) => a.id === verId) ?? null;
  const mini = archivos.find((a) => a.clase === "miniatura");
  const [avance, setAvance] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const entrada = useRef<HTMLInputElement>(null);
  const cerrar = useRef(onCerrar);
  useEffect(() => {
    cerrar.current = onCerrar;
  });
  useEffect(() => {
    const t = (e: KeyboardEvent) => e.key === "Escape" && cerrar.current();
    window.addEventListener("keydown", t);
    return () => window.removeEventListener("keydown", t);
  }, []);

  async function agregar(lista: FileList | null) {
    if (!lista?.length) return;
    setMsg("");
    for (const f of Array.from(lista)) {
      if (!claseArchivoPlano(f.name)) {
        setMsg(`«${f.name}»: formato no admitido`);
        continue;
      }
      try {
        setAvance(0);
        const a = await subirArchivoPlano(r.id, f, f.name, setAvance);
        if (a.clase === "pdf" || a.clase === "imagen") setVerId(a.id);
        if (a.clase === "dwg" && !mini) {
          const m = await miniaturaDeDwg(f);
          if (m) await subirArchivoPlano(r.id, m, `${sinExt(f.name)}.png`, () => {}, true).catch(() => null);
        }
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "No se pudo subir");
      }
    }
    setAvance(null);
    if (entrada.current) entrada.current.value = "";
    onCambio();
  }
  async function quitar(id: number) {
    const x = await fetch(`/api/gestion/planos?archivo=${id}`, { method: "DELETE" });
    if (!x.ok) setMsg((await x.json().catch(() => ({})))?.error || "No se pudo borrar");
    if (verId === id) setVerId(null);
    onCambio();
  }
  const campo = (k: keyof Plano, label: string, extra?: ReactNode) => (
    <label className="block text-xs">
      <span className="text-ink-soft">{label}</span>
      {extra ?? <input value={String(v[k] ?? "")} disabled={!esAdmin} onChange={(e) => setV({ ...v, [k]: e.target.value })} className={INPUT} />}
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-stretch justify-center p-0 sm:p-4" onClick={onCerrar}>
      <div role="dialog" aria-modal="true" aria-label={v.titulo} onClick={(e) => e.stopPropagation()}
        className="bg-white sm:rounded-lg shadow-xl w-full max-w-[1400px] flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-line">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLOR_DISCIPLINA[v.disciplina] }} aria-hidden="true" />
          <p className="font-semibold text-sm truncate">{v.codigo ? `${v.codigo} · ` : ""}{v.titulo}</p>
          <span className="ml-auto flex items-center gap-3 shrink-0">
            <Guardado estado={estado} />
            {viendo && <a href={URL_ARCHIVO(viendo.id)} target="_blank" rel="noopener" className="text-xs font-medium hover:underline">Abrir en otra pestaña</a>}
            <button type="button" onClick={onCerrar} className="border border-line-strong rounded-md px-3 py-1 text-xs font-medium hover:bg-concrete-dim">Cerrar</button>
          </span>
        </div>
        <div className="flex-1 min-h-0 grid lg:grid-cols-[1fr_22rem]">
          <div className="bg-concrete-dim min-h-[50vh] flex items-center justify-center relative">
            {viendo?.clase === "pdf" ? (
              <iframe key={viendo.id} src={URL_ARCHIVO(viendo.id)} title={viendo.nombre} className="absolute inset-0 w-full h-full" />
            ) : viendo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={URL_ARCHIVO(viendo.id)} alt={viendo.nombre} className="max-w-full max-h-full object-contain" />
            ) : (
              <div className="text-center px-6 py-8 max-w-md">
                {mini && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={URL_ARCHIVO(mini.id)} alt="Vista previa guardada en el DWG" className="mx-auto mb-4 w-full max-w-md bg-white border border-line rounded" />
                )}
                <p className="text-sm font-medium">{archivos.some((a) => a.clase === "dwg") ? "El navegador no puede abrir un DWG" : "Este plano aún no tiene archivos"}</p>
                <p className="text-xs text-ink-soft mt-1">
                  Para verlo completo aquí, sube su versión en PDF (en AutoCAD: Trazar o Publicar → PDF, con el mismo nombre del DWG).
                  {mini ? " Arriba se ve la miniatura que AutoCAD guardó dentro del DWG." : ""}
                </p>
              </div>
            )}
          </div>
          <div className="border-l border-line overflow-y-auto p-4 space-y-4">
            <section>
              <p className="text-[11px] uppercase tracking-wider text-ink-soft mb-1.5">Archivos</p>
              {visibles.length === 0 ? <p className="text-xs text-ink-soft">Sin archivos.</p> : (
                <ul className="divide-y divide-line border border-line rounded-md text-xs">
                  {visibles.map((a) => (
                    <li key={a.id} className={`px-2.5 py-2 ${verId === a.id ? "bg-page" : ""}`}>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[10px] border border-ink/30 rounded px-1">{a.clase === "imagen" ? "IMG" : a.clase.toUpperCase()}</span>
                        <span className="truncate font-medium" title={a.nombre}>{a.nombre}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-ink-soft">
                        <span>{pesoTexto(a.tamano)} · {formatoFecha(a.creado_en)}</span>
                        <span className="ml-auto flex gap-2.5">
                          {a.clase !== "dwg" && <button type="button" onClick={() => setVerId(a.id)} className="underline text-ink font-medium">Ver</button>}
                          <a href={URL_ARCHIVO(a.id, true)} className="underline">Descargar</a>
                          {esAdmin && <BotonBorrar texto="Quitar" onBorrar={() => void quitar(a.id)} />}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {esAdmin && (
                <label className={`mt-2 inline-flex ${BOTON} cursor-pointer text-xs ${avance !== null ? "opacity-50 pointer-events-none" : ""}`}>
                  <input ref={entrada} type="file" multiple accept=".dwg,.dxf,.pdf,.png,.jpg,.jpeg,.webp" className="sr-only" onChange={(e) => void agregar(e.target.files)} />
                  {avance !== null ? `Subiendo… ${Math.round(avance * 100)} %` : "+ Agregar DWG, PDF o imagen"}
                </label>
              )}
              {msg && <p className="text-xs text-danger mt-1">{msg}</p>}
            </section>
            <section className="space-y-2">
              <p className="text-[11px] uppercase tracking-wider text-ink-soft">Datos del plano</p>
              {campo("titulo", "Título")}
              <div className="grid grid-cols-2 gap-2">
                {campo("codigo", "Código / lámina")}
                {campo("revision", "Revisión")}
              </div>
              {campo("disciplina", "Disciplina", (
                <select value={v.disciplina} disabled={!esAdmin} onChange={(e) => setV({ ...v, disciplina: e.target.value })} className={INPUT}>
                  {DISCIPLINAS_PLANO.map((d) => <option key={d}>{d}</option>)}
                </select>
              ))}
              {campo("ubicacion", "Sede, pabellón o nivel")}
              <div className="grid grid-cols-2 gap-2">
                {campo("fecha", "Fecha", <input type="date" value={v.fecha ?? ""} disabled={!esAdmin} onChange={(e) => setV({ ...v, fecha: e.target.value || null })} className={INPUT} />)}
                {campo("estado", "Estado", (
                  <select value={v.estado} disabled={!esAdmin} onChange={(e) => setV({ ...v, estado: e.target.value as Plano["estado"] })} className={INPUT}>
                    {ESTADOS_PLANO.map((x) => <option key={x}>{x}</option>)}
                  </select>
                ))}
              </div>
              {campo("autor", "Elaborado por (proyectista o contratista)")}
              {campo("etiquetas", "Etiquetas (separadas por coma)", (
                <input value={etiquetas} disabled={!esAdmin} placeholder="ITSE 2026, tablero general, sótano"
                  onChange={(e) => {
                    setEtiquetas(e.target.value);
                    setV({ ...v, etiquetas: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) });
                  }} className={INPUT} />
              ))}
              {campo("notas", "Notas", (
                <textarea rows={4} value={v.notas} disabled={!esAdmin} onChange={(e) => setV({ ...v, notas: e.target.value })} className={INPUT}
                  placeholder="Observaciones, cambios de la revisión, dónde está el original…" />
              ))}
              <p className="text-[11px] text-ink-soft">Actualizado por {r.usuario ?? "—"} el {formatoFecha(r.actualizado_en)}. Los cambios se guardan solos.</p>
            </section>
            {esAdmin && (
              <div className="pt-2 border-t border-line">
                <BotonBorrar texto="Borrar plano y sus archivos" onBorrar={() => void borrar("planos", r.id).then(onBorrado).catch((e) => setMsg(e.message))} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Gestión → Planos: biblioteca de planos del campus. */
export function Planos() {
  return <BibliotecaPlanos />;
}

/**
 * Gestión → Tableros eléctricos: la página de tableros y circuitos (public/tableros-circuitos.html), dentro de
 * la app y detrás del inicio de sesión. Ocupa el alto de la ventana; los PDF se descargan directo.
 */
export function TablerosElectricos() {
  return (
    <iframe
      src="/tableros-circuitos.html"
      title="Tableros eléctricos y circuitos de la sede"
      className={`${TARJETA} w-full block`}
      style={{ height: "calc(100vh - 15rem)", minHeight: "36rem" }}
    />
  );
}
