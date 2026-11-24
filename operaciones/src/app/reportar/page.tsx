"use client";

import { useEffect, useRef, useState } from "react";
import { LogoUPC } from "@/components/layout/TopNav";
import { CATEGORIAS_REPORTE, LIMITES_REPORTE } from "@/lib/gestion";
import { CAMPUS_PRINCIPAL, esCampus, nombreCampus } from "@/lib/shared";

/**
 * Reporte de incidencias, PÚBLICO (sin iniciar sesión): lo abre el QR pegado en el ambiente
 * (/reportar?l=<lugar>&s=<firma>). Llega a Gestión → Reportes por QR. La foto se reduce en el celular
 * antes de enviarla (más rápido con datos móviles).
 */

const ICONOS: Record<string, string> = {
  "Eléctrico / iluminación": "💡",
  "Agua / baños": "🚰",
  "Aire acondicionado / ventilación": "❄️",
  "Mobiliario / puertas / ventanas": "🚪",
  Limpieza: "🧹",
  "Seguridad / riesgo": "⚠️",
  Otro: "📝",
};

async function reducir(f: File): Promise<Blob> {
  try {
    const img = await createImageBitmap(f);
    const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * escala);
    c.height = Math.round(img.height * escala);
    c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
    const b = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.8));
    return b ?? f;
  } catch {
    return f;
  }
}

export default function ReportarPage() {
  const [lugar, setLugar] = useState("");
  const [firma, setFirma] = useState("");
  const [campus, setCampus] = useState("");
  const [deQr, setDeQr] = useState(false);
  const [categoria, setCategoria] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [contacto, setContacto] = useState("");
  const [foto, setFoto] = useState<File | null>(null);
  const [vista, setVista] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [numero, setNumero] = useState<number | null>(null);
  const inicio = useRef(0);
  const trampa = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inicio.current = Date.now();
    const sp = new URLSearchParams(window.location.search);
    const l = (sp.get("l") ?? "").slice(0, LIMITES_REPORTE.lugar);
    /* eslint-disable react-hooks/set-state-in-effect */
    if (l) {
      setLugar(l);
      setDeQr(true);
    }
    setFirma(sp.get("s") ?? "");
    setCampus(esCampus(sp.get("c")) ? sp.get("c")! : "");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  useEffect(() => {
    if (!foto) return;
    const u = URL.createObjectURL(foto);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVista(u);
    return () => URL.revokeObjectURL(u);
  }, [foto]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (lugar.trim().length < 2) return setError("Indica dónde está el problema.");
    if (!categoria) return setError("Elige qué tipo de problema es.");
    if (descripcion.trim().length < 5) return setError("Describe brevemente el problema.");
    setEnviando(true);
    try {
      const fd = new FormData();
      fd.set("lugar", lugar.trim());
      fd.set("s", firma);
      fd.set("c", campus);
      fd.set("categoria", categoria);
      fd.set("descripcion", descripcion.trim());
      fd.set("contacto", contacto.trim());
      fd.set("web", trampa.current?.value ?? "");
      fd.set("t", String(inicio.current));
      if (foto) fd.set("foto", await reducir(foto), "foto.jpg");
      const r = await fetch("/api/gestion/reportar", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "No se pudo enviar el reporte");
      setNumero(d.numero ?? 0);
    } catch (err) {
      setError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "Sin conexión. Revisa tu internet e intenta de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  function otro() {
    setNumero(null);
    setCategoria("");
    setDescripcion("");
    setFoto(null);
    setVista("");
    inicio.current = Date.now();
  }

  return (
    <div className="min-h-screen bg-page">
      <header className="border-t-[3px] border-t-amber bg-white border-b border-line">
        <div className="max-w-xl mx-auto px-4 h-14 flex items-center gap-2">
          <LogoUPC className="w-7 h-7" />
          <span className="font-display font-bold text-xl tracking-tight">REPORTAR UNA FALLA</span>
          <span className="ml-auto text-xs text-ink-soft">{nombreCampus(campus || CAMPUS_PRINCIPAL)}</span>
        </div>
      </header>
      <main className="max-w-xl mx-auto px-4 py-6">
        {numero !== null ? (
          <div className="bg-white border border-line rounded-lg p-6 text-center space-y-3">
            <p className="text-4xl" aria-hidden="true">✅</p>
            <h1 className="font-display font-bold text-2xl">¡Gracias! Recibimos tu reporte</h1>
            {numero > 0 && <p className="text-sm text-ink-soft">Reporte N° <b className="text-ink">{numero}</b> · {lugar}</p>}
            <p className="text-sm text-ink-soft">El equipo de mantenimiento lo revisará lo antes posible.</p>
            <button type="button" onClick={otro} className="border border-line-strong rounded-md px-4 py-2 text-sm font-medium bg-white hover:bg-concrete-dim">
              Reportar otra falla
            </button>
          </div>
        ) : (
          <form onSubmit={enviar} className="space-y-5" noValidate>
            <p className="text-sm text-ink-soft">Cuéntanos qué no funciona. No necesitas usuario ni contraseña.</p>
            <div>
              <label htmlFor="lugar" className="block text-sm font-medium mb-1">¿Dónde?</label>
              {deQr ? (
                <div className="flex items-center justify-between gap-2 bg-white border border-line rounded-md px-3 py-2.5">
                  <span className="font-medium">📍 {lugar}</span>
                  <button type="button" className="text-xs underline text-ink-soft" onClick={() => setDeQr(false)}>Cambiar</button>
                </div>
              ) : (
                <input id="lugar" value={lugar} onChange={(e) => setLugar(e.target.value)} maxLength={LIMITES_REPORTE.lugar} autoComplete="off"
                  placeholder="Ej.: Pabellón A, piso 3, baño de damas" className="w-full border border-line-strong rounded-md px-3 py-2.5 bg-white" />
              )}
            </div>
            <fieldset>
              <legend className="block text-sm font-medium mb-1">¿Qué tipo de problema?</legend>
              <div className="grid grid-cols-2 gap-2">
                {CATEGORIAS_REPORTE.map((c) => (
                  <button key={c} type="button" onClick={() => { setCategoria(c); setError(""); }} aria-pressed={categoria === c}
                    className={`text-left text-sm rounded-md border px-3 py-2.5 ${categoria === c ? "bg-ink text-white border-ink" : "bg-white border-line-strong"}`}>
                    <span aria-hidden="true">{ICONOS[c]}</span> {c}
                  </button>
                ))}
              </div>
            </fieldset>
            <div>
              <label htmlFor="desc" className="block text-sm font-medium mb-1">Describe el problema</label>
              <textarea id="desc" rows={4} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={LIMITES_REPORTE.descripcion}
                placeholder="Ej.: el caño del segundo lavadero gotea y hay agua en el piso" className="w-full border border-line-strong rounded-md px-3 py-2.5 bg-white" />
            </div>
            <div>
              <span className="block text-sm font-medium mb-1">Foto (opcional)</span>
              <label className="flex items-center justify-center gap-2 border border-dashed border-line-strong rounded-md px-3 py-3 bg-white cursor-pointer text-sm">
                📷 {foto ? "Cambiar foto" : "Tomar o elegir una foto"}
                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} />
              </label>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {vista && <img src={vista} alt="Foto del problema" className="mt-2 max-h-48 rounded-md border border-line" />}
            </div>
            <div>
              <label htmlFor="contacto" className="block text-sm font-medium mb-1">Tu nombre o correo (opcional)</label>
              <input id="contacto" value={contacto} onChange={(e) => setContacto(e.target.value)} maxLength={LIMITES_REPORTE.contacto} autoComplete="name"
                placeholder="Por si necesitamos más detalles" className="w-full border border-line-strong rounded-md px-3 py-2.5 bg-white" />
            </div>
            {/* Campo trampa: invisible para las personas; los robots lo llenan y su envío se descarta. */}
            <input ref={trampa} name="web" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] w-px h-px opacity-0" />
            {error && <p className="text-sm text-danger bg-[var(--danger-soft)] border border-danger/30 rounded-md p-3" role="alert">{error}</p>}
            <button type="submit" disabled={enviando} className="w-full rounded-md bg-amber hover:bg-amber-hover text-white font-medium py-3 disabled:opacity-60">
              {enviando ? "Enviando…" : "Enviar reporte"}
            </button>
            <p className="text-xs text-ink-soft text-center">Solo para fallas de infraestructura. En una emergencia, avisa de inmediato al personal de seguridad.</p>
          </form>
        )}
      </main>
    </div>
  );
}
