"use client";

import { useState } from "react";

const inputCls =
  "w-full border border-line rounded-md px-3 py-2 bg-white text-sm focus:outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-200/70";
const labelCls = "block text-xs font-medium text-ink-soft mb-1";
const btnCls =
  "flex-1 bg-amber text-white rounded-md font-medium text-sm py-2.5 hover:bg-amber-hover transition-colors disabled:opacity-50";

type Fase = "estado" | "contrasena" | "codigo" | "desactivar" | "respaldos" | "listo";

/** Botón "2FA" de la barra superior: activa o desactiva la verificación en dos pasos (TOTP). */
export default function VerificacionDosPasos() {
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(false);
  const [fase, setFase] = useState<Fase>("estado");
  const [password, setPassword] = useState("");
  const [codigo, setCodigo] = useState("");
  const [secreto, setSecreto] = useState("");
  const [uri, setUri] = useState("");
  const [respaldo, setRespaldo] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function abrir() {
    setAbierto(true);
    setError("");
    setFase("estado");
    try {
      const res = await fetch("/api/auth/mfa");
      const d = await res.json().catch(() => ({}));
      setActivo(d.activo === true);
    } catch {
      setError("Error de conexión");
    }
  }

  function cerrar() {
    setAbierto(false);
    setPassword("");
    setCodigo("");
    setSecreto("");
    setUri("");
    setRespaldo([]);
    setError("");
  }

  async function enviar(accion: "iniciar" | "confirmar" | "desactivar" | "respaldos") {
    setError("");
    setEnviando(true);
    try {
      const res = await fetch("/api/auth/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion, password, codigo }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error || "No se pudo completar la operación");
      } else if (accion === "iniciar") {
        setSecreto(d.secreto);
        setUri(d.uri);
        setPassword("");
        setCodigo("");
        setFase("codigo");
      } else {
        setRespaldo(Array.isArray(d.respaldo) ? d.respaldo : []);
        setActivo(accion === "confirmar" || accion === "respaldos");
        setPassword("");
        setCodigo("");
        setSecreto("");
        setUri("");
        setFase("listo");
      }
    } catch {
      setError("Error de conexión");
    }
    setEnviando(false);
  }

  return (
    <>
      <button
        onClick={abrir}
        title="Verificación en dos pasos"
        className="text-xs font-medium text-ink-soft hover:text-ink border border-line-strong rounded-md hover:bg-concrete-dim px-3 py-1.5 transition-colors"
      >
        2FA
      </button>

      {abierto && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4" onClick={cerrar}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (fase === "contrasena") void enviar("iniciar");
              else if (fase === "codigo") void enviar("confirmar");
              else if (fase === "desactivar") void enviar("desactivar");
              else if (fase === "respaldos") void enviar("respaldos");
            }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-line rounded-lg shadow-xl p-6 w-full max-w-sm space-y-4"
          >
            <h2 className="font-display font-700 text-2xl tracking-tight">Verificación en dos pasos</h2>

            {fase === "estado" && (
              <>
                <p className="text-sm text-ink-soft">
                  {activo
                    ? "Está ACTIVA: al ingresar se pedirá, además de la contraseña, un código de tu app de autenticación."
                    : "Está desactivada. Actívala para que una contraseña robada no baste para entrar."}
                </p>
                {activo && (
                  <button type="button" onClick={() => setFase("respaldos")} className="text-xs text-teal hover:underline">
                    Generar nuevos códigos de respaldo
                  </button>
                )}
                <div className="flex gap-3">
                  <button type="button" className={btnCls} onClick={() => setFase(activo ? "desactivar" : "contrasena")}>
                    {activo ? "Desactivar" : "Activar"}
                  </button>
                  <button type="button" onClick={cerrar} className="border border-line-strong rounded-md px-4 text-sm font-medium hover:bg-concrete-dim">
                    Cerrar
                  </button>
                </div>
              </>
            )}

            {(fase === "contrasena" || fase === "desactivar" || fase === "respaldos") && (
              <div>
                <label className={labelCls} htmlFor="mfa-pw">Tu contraseña actual</label>
                <input id="mfa-pw" autoFocus required type="password" autoComplete="current-password"
                  className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            )}

            {fase === "codigo" && (
              <>
                <p className="text-sm text-ink-soft">
                  En tu app de autenticación elige <b>agregar cuenta</b> → <b>ingresar clave</b> (tipo: basada en tiempo)
                  y escribe esta clave:
                </p>
                <p className="font-mono text-sm break-all bg-concrete-dim border border-line rounded-md px-3 py-2 select-all">
                  {secreto}
                </p>
                <a href={uri} className="text-xs text-teal hover:underline">Abrir en la app de este dispositivo</a>
              </>
            )}

            {(fase === "codigo" || fase === "desactivar" || fase === "respaldos") && (
              <div>
                <label className={labelCls} htmlFor="mfa-cod">
                  {fase === "codigo" ? "Código de 6 dígitos para confirmar" : "Código actual de tu app"}
                </label>
                <input id="mfa-cod" required inputMode="numeric"
                  autoComplete="one-time-code" maxLength={7}
                  className={`${inputCls} tracking-widest`} value={codigo} onChange={(e) => setCodigo(e.target.value)} />
              </div>
            )}

            {fase === "listo" && (
              <>
                <p className="text-sm bg-teal-soft border border-teal/30 px-3 py-2">
                  {activo ? "Verificación en dos pasos activada. Desde el próximo ingreso se pedirá el código." : "Verificación en dos pasos desactivada."}
                </p>
                {respaldo.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm text-ink-soft">
                      <b>Guarda estos códigos de respaldo</b> en un lugar seguro (gestor de contraseñas o papel). Cada uno
                      sirve <b>una sola vez</b> si pierdes el teléfono. No se volverán a mostrar.
                    </p>
                    <ul className="font-mono text-sm grid grid-cols-2 gap-1 bg-concrete-dim border border-line rounded-md px-3 py-2 select-all">
                      {respaldo.map((c) => <li key={c}>{c}</li>)}
                    </ul>
                  </div>
                )}
                <button type="button" onClick={cerrar} className={`w-full ${btnCls}`}>Cerrar</button>
              </>
            )}

            {error && (
              <p role="alert" className="text-sm text-danger bg-[var(--danger-soft)] border border-danger/30 px-3 py-2">
                {error}
              </p>
            )}

            {(fase === "contrasena" || fase === "codigo" || fase === "desactivar" || fase === "respaldos") && (
              <div className="flex gap-3">
                <button type="submit" disabled={enviando} className={btnCls}>
                  {enviando ? "Verificando..." : fase === "contrasena" ? "Continuar" : fase === "codigo" ? "Activar" : fase === "respaldos" ? "Generar" : "Desactivar"}
                </button>
                <button type="button" onClick={cerrar} className="border border-line-strong rounded-md px-4 text-sm font-medium hover:bg-concrete-dim">
                  Cancelar
                </button>
              </div>
            )}
          </form>
        </div>
      )}
    </>
  );
}
