"use client";

import { useCallback, useEffect, useState } from "react";
import TopNav from "@/components/layout/TopNav";
import { useDialogos } from "@/components/ui/Dialogos";
import { useMe } from "@/lib/client/useMe";
import { MIN_PASSWORD } from "@/lib/shared/passwords";

type Usuario = {
  id: number;
  username: string;
  rol: "admin" | "lectura";
  activo: boolean;
  created_at: string;
  mfa_activo?: boolean;
};

type Actividad = {
  id: number;
  actor: string;
  accion: string;
  objetivo: string | null;
  detalle: string | null;
  created_at: string;
};

type Acceso = {
  id: number;
  usuario: string | null;
  evento: string;
  ip: string | null;
  user_agent: string | null;
  detalle: string | null;
  created_at: string;
};

const EVENTOS: Record<string, string> = {
  login_ok: "Ingresó",
  login_fallo: "Intento fallido",
  logout: "Salió",
  logout_todas: "Cerró todas sus sesiones",
  export: "Exportó a Excel",
};

const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-PE", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const inputCls =
  "w-full border border-line rounded-md px-3 py-2 bg-white text-sm focus:outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-200/70";
const labelCls = "block text-xs font-medium text-ink-soft mb-1";
const accionCls = "text-xs font-medium hover:underline";

export default function UsuariosPage() {
  const me = useMe();
  const { confirmar, pedirTexto, pedirContrasena, dialogos } = useDialogos();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [nuevo, setNuevo] = useState({ username: "", password: "", rol: "lectura" });
  const [creando, setCreando] = useState(false);
  const [actividad, setActividad] = useState<Actividad[]>([]);
  const [accesos, setAccesos] = useState<Acceso[]>([]);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/usuarios");
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.error || "No se pudo cargar la lista de usuarios");
      return;
    }
    setUsuarios(d.data);
    // La actividad es secundaria: si falla, no impide ver ni gestionar usuarios.
    const act = await fetch("/api/usuarios/actividad");
    if (act.ok) setActividad((await act.json()).data);
    const acc = await fetch("/api/usuarios/accesos");
    if (acc.ok) setAccesos((await acc.json()).data);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar();
  }, [cargar]);

  /** Pide la contraseña (y el código del 2FA) y la confirma en el servidor. true = ya se puede reintentar. */
  async function confirmarIdentidad(pideCodigo: boolean) {
    const password = await pedirTexto({
      titulo: "Confirma tu identidad",
      mensaje: "Por seguridad, escribe tu contraseña para continuar con esta acción de administrador.",
      etiqueta: "Tu contraseña",
      secreto: true,
      boton: "Continuar",
    });
    if (!password) return false;
    let codigo = "";
    if (pideCodigo) {
      const c = await pedirTexto({
        titulo: "Código de verificación",
        mensaje: "Escribe el código de 6 dígitos de tu app. Si lo acabas de usar para entrar, espera al siguiente.",
        etiqueta: "Código",
        secreto: false,
        boton: "Confirmar",
        minimo: 6,
      });
      if (!c) return false;
      codigo = c;
    }
    const res = await fetch("/api/auth/reautenticar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, codigo }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.error || "No se pudo confirmar tu identidad");
      return false;
    }
    return true;
  }

  async function llamar(url: string, init: RequestInit, ok: string) {
    setError("");
    setAviso("");
    const pedir = () => fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
    let res = await pedir();
    let d = await res.json().catch(() => ({}));
    if (res.status === 403 && d.codigo === "REAUTH") {
      if (!(await confirmarIdentidad(d.pideCodigo === true))) return false;
      res = await pedir();
      d = await res.json().catch(() => ({}));
    }
    if (!res.ok) {
      setError(d.error || "No se pudo completar la acción");
      return false;
    }
    setAviso(ok);
    await cargar();
    return true;
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setCreando(true);
    const ok = await llamar(
      "/api/usuarios",
      { method: "POST", body: JSON.stringify(nuevo) },
      `Usuario "${nuevo.username.trim().toLowerCase()}" creado`
    );
    if (ok) setNuevo({ username: "", password: "", rol: "lectura" });
    setCreando(false);
  }

  function cambiarRol(u: Usuario, rol: string) {
    return llamar(
      `/api/usuarios/${u.id}`,
      { method: "PATCH", body: JSON.stringify({ rol }) },
      `Rol de "${u.username}" actualizado`
    );
  }

  function alternarActivo(u: Usuario) {
    return llamar(
      `/api/usuarios/${u.id}`,
      { method: "PATCH", body: JSON.stringify({ activo: !u.activo }) },
      u.activo ? `"${u.username}" desactivado` : `"${u.username}" activado`
    );
  }

  async function nuevaContrasena(u: Usuario) {
    const password = await pedirContrasena({
      titulo: `Nueva contraseña para "${u.username}"`,
      mensaje: `Mínimo ${MIN_PASSWORD} caracteres. Se cerrarán las sesiones abiertas de este usuario.`,
      boton: "Cambiar contraseña",
      minimo: MIN_PASSWORD,
    });
    if (!password) return;
    await llamar(
      `/api/usuarios/${u.id}`,
      { method: "PATCH", body: JSON.stringify({ password }) },
      `Contraseña de "${u.username}" actualizada`
    );
  }

  async function quitarMfa(u: Usuario) {
    if (!window.confirm(`¿Quitar la verificación en dos pasos de "${u.username}"? Podrá volver a activarla.`)) return;
    await llamar(
      `/api/usuarios/${u.id}`,
      { method: "PATCH", body: JSON.stringify({ mfa: false }) },
      `Verificación en dos pasos de "${u.username}" restablecida`
    );
  }

  async function eliminar(u: Usuario) {
    const ok = await confirmar({
      titulo: `¿Eliminar al usuario "${u.username}"?`,
      mensaje: "Esta acción no se puede deshacer.",
      boton: "Eliminar",
      peligro: true,
    });
    if (!ok) return;
    await llamar(`/api/usuarios/${u.id}`, { method: "DELETE" }, `Usuario "${u.username}" eliminado`);
  }

  return (
    <div className="min-h-screen bg-page">
      <TopNav />
      <main className="max-w-4xl mx-auto px-5 py-8">
        <h1 className="font-display font-700 text-4xl tracking-tight mb-6">Usuarios</h1>

        {error && (
          <p role="alert" className="text-sm text-danger bg-[var(--danger-soft)] border border-danger/30 px-3 py-2 mb-4">
            {error}
          </p>
        )}
        {aviso && (
          <p role="status" className="text-sm bg-teal-soft border border-teal/30 px-3 py-2 mb-4">{aviso}</p>
        )}

        <form onSubmit={crear} className="bg-white border border-line rounded-lg shadow-card p-6 mb-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-soft mb-3 border-b border-line pb-2">
            Nuevo usuario
          </h3>
          <div className="grid md:grid-cols-4 gap-4 items-end">
            <div>
              <label className={labelCls} htmlFor="usr-1">Usuario</label>
              <input id="usr-1"
                required
                className={inputCls}
                value={nuevo.username}
                onChange={(e) => setNuevo({ ...nuevo, username: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="usr-2">Contraseña</label>
              <input id="usr-2"
                required
                type="password"
                minLength={MIN_PASSWORD}
                className={inputCls}
                value={nuevo.password}
                onChange={(e) => setNuevo({ ...nuevo, password: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="usr-3">Rol</label>
              <select id="usr-3"
                className={inputCls}
                value={nuevo.rol}
                onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })}
              >
                <option value="lectura">Solo lectura</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={creando}
              className="bg-amber text-white border border-amber rounded-md px-4 py-2 text-sm font-medium hover:bg-amber-hover hover:border-amber-hover transition-colors disabled:opacity-50"
            >
              {creando ? "Creando..." : "Crear"}
            </button>
          </div>
          <p className="text-xs text-ink-soft mt-3">
            <b>Administrador</b>: crea, edita y elimina tickets y archivos, y gestiona usuarios.{" "}
            <b>Solo lectura</b>: ve y filtra tickets, abre archivos y exporta a Excel, sin modificar nada.
          </p>
        </form>

        <div className="bg-white border border-line rounded-lg shadow-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th scope="col" className="px-3 py-2 text-xs font-semibold">Usuario</th>
                <th scope="col" className="px-3 py-2 text-xs font-semibold">Rol</th>
                <th scope="col" className="px-3 py-2 text-xs font-semibold">Estado</th>
                <th scope="col" className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => {
                const esMismo = u.username === me?.username;
                return (
                  <tr key={u.id} className="border-b border-line">
                    <td className="px-3 py-2">
                      {u.username}
                      {esMismo && <span className="text-ink-soft"> (tú)</span>}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        aria-label={`Rol de ${u.username}`}
                        className="border border-line rounded-md px-2 py-1 bg-white text-sm disabled:opacity-60"
                        value={u.rol}
                        disabled={esMismo}
                        onChange={(e) => cambiarRol(u, e.target.value)}
                      >
                        <option value="admin">Administrador</option>
                        <option value="lectura">Solo lectura</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {u.activo ? "Activo" : <span className="text-danger">Desactivado</span>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => nuevaContrasena(u)}
                        className={`${accionCls} text-teal mr-3`}
                      >
                        Contraseña
                      </button>
                      {u.mfa_activo && !esMismo && (
                        <button onClick={() => quitarMfa(u)} className={`${accionCls} text-ink-soft mr-3`}>
                          Quitar 2FA
                        </button>
                      )}
                      {!esMismo && (
                        <>
                          <button
                            onClick={() => alternarActivo(u)}
                            className={`${accionCls} text-ink-soft mr-3`}
                          >
                            {u.activo ? "Desactivar" : "Activar"}
                          </button>
                          <button onClick={() => eliminar(u)} className={`${accionCls} text-danger`}>
                            Eliminar
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <details className="mt-6 bg-white border border-line rounded-lg shadow-card">
          <summary className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ink-soft">
            Actividad reciente ({actividad.length})
          </summary>
          {actividad.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-ink-soft">Todavía no hay acciones registradas.</p>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {actividad.map((a) => (
                <li key={a.id} className="px-4 py-2 text-sm flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="text-xs text-ink-soft whitespace-nowrap">{fechaHora(a.created_at)}</span>
                  <span>
                    <b>{a.actor}</b>: {a.accion}
                    {a.objetivo && a.objetivo !== a.actor && <> — {a.objetivo}</>}
                    {a.detalle && <span className="text-ink-soft"> ({a.detalle})</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </details>
        <details className="mt-4 bg-white border border-line rounded-lg shadow-card">
          <summary className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ink-soft">
            Accesos recientes ({accesos.length})
          </summary>
          {accesos.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-ink-soft">Todavía no hay accesos registrados.</p>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {accesos.map((a) => (
                <li key={a.id} className="px-4 py-2 text-sm flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="text-xs text-ink-soft whitespace-nowrap">{fechaHora(a.created_at)}</span>
                  <span className={a.evento === "login_fallo" ? "text-danger" : undefined}>
                    <b>{a.usuario ?? "—"}</b>: {EVENTOS[a.evento] ?? a.evento}
                    {a.ip && <span className="text-ink-soft"> · IP {a.ip}</span>}
                    {a.detalle && <span className="text-ink-soft"> ({a.detalle})</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </details>
      </main>
      {dialogos}
    </div>
  );
}
