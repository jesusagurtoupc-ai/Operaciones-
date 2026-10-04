"use client";

import { useCallback, useEffect, useState } from "react";
import TopNav from "@/components/TopNav";
import { useMe } from "@/lib/useMe";

type Usuario = {
  id: number;
  username: string;
  rol: "admin" | "lectura";
  activo: boolean;
  created_at: string;
};

const inputCls =
  "w-full border border-line px-3 py-2 bg-white text-sm focus:outline-none focus:border-ink";
const labelCls = "block text-[10px] font-mono-tag uppercase tracking-widest text-ink-soft mb-1";
const accionCls = "text-xs font-mono-tag uppercase hover:underline";

export default function UsuariosPage() {
  const me = useMe();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [nuevo, setNuevo] = useState({ username: "", password: "", rol: "lectura" });
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(async () => {
    const res = await fetch("/api/usuarios");
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.error || "No se pudo cargar la lista de usuarios");
      return;
    }
    setUsuarios(d.data);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar();
  }, [cargar]);

  async function llamar(url: string, init: RequestInit, ok: string) {
    setError("");
    setAviso("");
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json" },
    });
    const d = await res.json().catch(() => ({}));
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

  function nuevaContrasena(u: Usuario) {
    const password = prompt(`Nueva contraseña para "${u.username}" (mínimo 6 caracteres):`);
    if (!password) return;
    llamar(
      `/api/usuarios/${u.id}`,
      { method: "PATCH", body: JSON.stringify({ password }) },
      `Contraseña de "${u.username}" actualizada`
    );
  }

  function eliminar(u: Usuario) {
    if (!confirm(`¿Eliminar al usuario "${u.username}"? Esta acción no se puede deshacer.`)) return;
    llamar(`/api/usuarios/${u.id}`, { method: "DELETE" }, `Usuario "${u.username}" eliminado`);
  }

  return (
    <div className="min-h-screen bg-concrete">
      <TopNav />
      <main className="max-w-4xl mx-auto px-5 py-8">
        <h1 className="font-display font-700 text-4xl tracking-tight mb-6">Usuarios</h1>

        {error && (
          <p className="text-sm text-danger bg-[var(--danger-soft)] border border-danger/30 px-3 py-2 mb-4">
            {error}
          </p>
        )}
        {aviso && (
          <p className="text-sm bg-teal-soft border border-teal/30 px-3 py-2 mb-4">{aviso}</p>
        )}

        <form onSubmit={crear} className="bg-white border-2 border-ink p-6 mb-6">
          <h3 className="font-mono-tag text-xs uppercase tracking-widest text-ink-soft mb-3 border-b border-line pb-2">
            Nuevo usuario
          </h3>
          <div className="grid md:grid-cols-4 gap-4 items-end">
            <div>
              <label className={labelCls}>Usuario</label>
              <input
                required
                className={inputCls}
                value={nuevo.username}
                onChange={(e) => setNuevo({ ...nuevo, username: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls}>Contraseña</label>
              <input
                required
                type="password"
                minLength={6}
                className={inputCls}
                value={nuevo.password}
                onChange={(e) => setNuevo({ ...nuevo, password: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls}>Rol</label>
              <select
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
              className="bg-amber text-white border-2 border-ink px-4 py-2 text-sm font-mono-tag uppercase tracking-wide hover:bg-ink transition-colors disabled:opacity-50"
            >
              {creando ? "Creando..." : "Crear"}
            </button>
          </div>
          <p className="text-xs text-ink-soft mt-3">
            <b>Administrador</b>: crea, edita y elimina tickets y archivos, y gestiona usuarios.{" "}
            <b>Solo lectura</b>: ve y filtra tickets, abre archivos y exporta a Excel, sin modificar nada.
          </p>
        </form>

        <div className="bg-white border-2 border-ink overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-ink text-left">
                <th className="px-3 py-2 font-mono-tag text-[10px] uppercase tracking-widest">Usuario</th>
                <th className="px-3 py-2 font-mono-tag text-[10px] uppercase tracking-widest">Rol</th>
                <th className="px-3 py-2 font-mono-tag text-[10px] uppercase tracking-widest">Estado</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => {
                const esMismo = u.username === me?.username;
                return (
                  <tr key={u.id} className="border-b border-line">
                    <td className="px-3 py-2 font-mono-tag">
                      {u.username}
                      {esMismo && <span className="text-ink-soft"> (tú)</span>}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className="border border-line px-2 py-1 bg-white text-sm disabled:opacity-60"
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
      </main>
    </div>
  );
}
