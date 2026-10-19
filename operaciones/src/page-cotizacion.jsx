import { useState, useEffect, useMemo, Fragment } from "react";
import * as C from "./core-common";
const {
  classifySyncError,
  SyncDot,
  FilterBar,
  ClearFiltersButton,
  PdfViewerModal,
  mutateStorageJSON,
  COLORS,
  fmtMoney,
  fmtDate,
  uid,
  todayStr,
  useIsMobile,
  scrollFieldIntoViewOnFocus,
  CONTACTOS_SEED,
  STORAGE_KEY_CONTACTOS,
  COTIZACIONES_SEED,
  STORAGE_KEY_COTIZACIONES,
  WILARCON_EMPRESA,
  COTIZACION_MEDIDAS,
  emptyCotizacionItem,
  emptyCotizacionSeccion,
  emptyCotizacionDraft,
  cotizacionDraftDesdeVisita,
  STORAGE_KEY_VISITAS,
  siguienteNumeroCotizacion,
  itemTotalCotizacion,
  seccionTotalCotizacion,
  cotizacionTotales,
  seccionNumeroLabel,
  itemNumeroLabel,
  cotMontoFijo,
  cotMontoSmart,
  OCSelector,
  DropdownSelect,
  Kpi,
  monthLabel,
  buildCotizacionPdf,
  LOGO_SHIELD,
  crearSolicitudRevisionCotizacion,
  useCarpetaLocal,
  BotonCarpetaLocal,
  useAutoSaveDebounced,
} = C;

function inputStyle() {
  return {
    width: "100%",
    background: COLORS.panel2,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 6,
    color: COLORS.text,
    padding: "7px 9px",
    fontSize: 12.5,
    outline: "none",
  };
}

function SeleccionarVisitaModal({ visitas, onSeleccionar, onOmitir, onClose }) {
  const [busqueda, setBusqueda] = useState("");
  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const list = (visitas || []).slice().sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    if (!q) return list;
    return list.filter((v) =>
      [v.codigo, v.nombreProyecto, v.contacto, v.lugar].some((f) => String(f || "").toLowerCase().includes(q))
    );
  }, [visitas, busqueda]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500, padding: 16 }} onClick={onClose}>
      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20, width: 560, maxWidth: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <b style={{ color: COLORS.text, fontSize: 15 }}>Nueva cotización</b>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: COLORS.dim, marginBottom: 12, lineHeight: 1.4 }}>
          Si esta cotización viene de una Visita Técnica, selecciónala para precargar contacto, teléfono, dirección, la Solicitud / Proyecto, y la mano de obra y los materiales anotados en campo (como ítems, precio en blanco para completar).
        </div>
        <input
          autoFocus
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por código, proyecto, contacto o lugar…"
          style={inputStyle()}
        />
        <div style={{ overflowY: "auto", marginTop: 10, marginBottom: 12, border: `1px solid ${COLORS.border}`, borderRadius: 8, minHeight: 60 }}>
          {filtradas.length === 0 && (
            <div style={{ padding: 14, fontSize: 12, color: COLORS.faint, textAlign: "center" }}>
              {(visitas || []).length === 0 ? "No hay visitas técnicas registradas." : "Sin resultados."}
            </div>
          )}
          {filtradas.map((v) => (
            <button
              key={v.id}
              onClick={() => onSeleccionar(v)}
              style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottom: `1px solid ${COLORS.border}`, padding: "10px 12px", cursor: "pointer", color: COLORS.text }}
              onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.panel2)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 12.5 }}>{v.codigo || "—"}</span>
                <span style={{ fontSize: 11, color: COLORS.dim }}>{fmtDate(v.fecha) || "—"}</span>
              </div>
              <div style={{ fontSize: 12, color: COLORS.dim, marginTop: 2 }}>{v.nombreProyecto || "—"}</div>
              <div style={{ fontSize: 11, color: COLORS.faint, marginTop: 1 }}>{v.contacto || "—"} · {v.lugar || "—"}</div>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onOmitir} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, borderRadius: 7, padding: "7px 14px", fontSize: 12, cursor: "pointer" }}>
            Sin visita técnica — cotización en blanco
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldLabel({ children }) {
  return (
    <div style={{ fontSize: 10, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>
      {children}
    </div>
  );
}

function IconBtn({ onClick, title, danger, color, disabled, children }) {
  const tone = danger ? COLORS.red : (color || COLORS.dim);
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        background: "transparent",
        border: `1px solid ${tone}`,
        color: tone,
        borderRadius: 6,
        padding: "4px 9px",
        fontSize: 11,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.65 : 1,
      }}
    >
      {children}
    </button>
  );
}

// Estados del flujo de revisión de una cotización:
//   "pendiente"   -> botón amarillo "Presentar" (estado inicial, al crearla)
//   "en_revision" -> solicitud enviada, esperando que un aprobador la revise (botón deshabilitado)
//   "aprobada"    -> el aprobador vio el PDF y aprobó -> botón azul "Enviar"
//   "finalizado"  -> el usuario volvió a presionar el botón -> botón verde "Finalizado" (estado final)
function revisionEstado(c) {
  return c.estadoRevision || "pendiente";
}
// Campos que no forman parte del "contenido" de la cotización para efectos de decidir si una
// edición debe reiniciar el flujo de revisión: metadatos de la revisión misma, el número
// (puede reasignarse automáticamente al guardar) y la marca de tiempo de actualización.
const CAMPOS_IGNORAR_CAMBIO_REVISION = [
  "estadoRevision", "revisionSolicitadaPor", "revisionSolicitadaFecha",
  "revisionAprobadaPor", "revisionAprobadaFecha", "revisionFinalizadaPor", "revisionFinalizadaFecha",
  "actualizadoEn", "numero",
];
function contenidoCotizacionCambio(original, propuesto) {
  if (!original) return true;
  const limpiar = (obj) => {
    const copia = { ...obj };
    CAMPOS_IGNORAR_CAMBIO_REVISION.forEach((k) => delete copia[k]);
    return copia;
  };
  return JSON.stringify(limpiar(original)) !== JSON.stringify(limpiar(propuesto));
}
function revisionBtnInfo(c) {
  const e = revisionEstado(c);
  if (e === "en_revision") return { label: "En revisión…", color: COLORS.pending, title: "Solicitud de revisión enviada, esperando aprobación", disabled: true };
  if (e === "aprobada") return { label: "Enviar", color: COLORS.blue, title: "Revisión aprobada — presiona para marcarla como enviada", disabled: false };
  if (e === "finalizado") return { label: "Finalizado", color: COLORS.green, title: "Cotización finalizada", disabled: true };
  return { label: "Presentar", color: COLORS.pending, title: "Enviar esta cotización a revisión", disabled: false };
}

function CotizacionEditor({ draft, onChange, contactos, puedeEditar }) {
  const totales = useMemo(() => cotizacionTotales(draft), [draft]);
  const disabled = !puedeEditar;
  // En celular, el título de sección y el detalle del ítem pasan de una fila fija de columnas
  // angostas (pensada para mouse) a un formulario apilado, con campos a todo el ancho.
  const isMobile = useIsMobile(760);
  const contactoOptions = useMemo(() => {
    const seen = new Set();
    const list = [];
    (contactos || []).forEach((c) => {
      const nombre = String(c?.contacto || "").trim();
      if (!nombre) return;
      const k = nombre.toLocaleLowerCase();
      if (seen.has(k)) return;
      seen.add(k); list.push(nombre);
    });
    return list;
  }, [contactos]);

  function setField(key, value) {
    onChange({ ...draft, [key]: value });
  }

  function pickContacto(nombre) {
    const c = contactos.find((c) => c.contacto === nombre);
    if (c) {
      onChange({ ...draft, contacto: c.contacto, direccion: c.direccion || draft.direccion, telefono: c.telefono || draft.telefono });
    } else {
      onChange({ ...draft, contacto: nombre });
    }
  }

  function updateSeccion(idx, next) {
    const secciones = draft.secciones.slice();
    secciones[idx] = next;
    onChange({ ...draft, secciones });
  }

  function addSeccion() {
    const nextNum = (draft.secciones[draft.secciones.length - 1]?.numero || 0) + 1;
    onChange({ ...draft, secciones: [...draft.secciones, emptyCotizacionSeccion(nextNum)] });
  }

  function removeSeccion(idx) {
    if (draft.secciones.length <= 1) return;
    const secciones = draft.secciones.filter((_, i) => i !== idx);
    onChange({ ...draft, secciones });
  }

  function moveSeccion(idx, dir) {
    const target = idx + dir;
    if (target < 0 || target >= draft.secciones.length) return;
    const secciones = draft.secciones.slice();
    [secciones[idx], secciones[target]] = [secciones[target], secciones[idx]];
    onChange({ ...draft, secciones });
  }

  function addTermino() {
    onChange({ ...draft, terminos: [...(draft.terminos || []), { label: "", value: "" }] });
  }

  function updateTermino(idx, key, value) {
    const terminos = draft.terminos.slice();
    terminos[idx] = { ...terminos[idx], [key]: value };
    onChange({ ...draft, terminos });
  }

  function removeTermino(idx) {
    onChange({ ...draft, terminos: draft.terminos.filter((_, i) => i !== idx) });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Encabezado */}
      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text }}>Datos de la cotización</div>
          {draft.visitaCodigo && (
            <span style={{ fontSize: 10.5, fontWeight: 600, color: COLORS.dim, background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "2px 9px" }}>
              📋 {draft.visitaCodigo}{draft.solicitud ? ` — ${draft.solicitud}` : ""}
            </span>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 10 }}>
          <div>
            <FieldLabel>N° Cotización</FieldLabel>
            <input disabled={disabled} style={inputStyle()} value={draft.numero} onChange={(e) => setField("numero", e.target.value.toUpperCase())} placeholder="WS_25 ####" />
          </div>
          <div>
            <FieldLabel>Fecha</FieldLabel>
            <input disabled={disabled} type="date" style={inputStyle()} value={draft.fecha} onChange={(e) => setField("fecha", e.target.value)} />
          </div>
          <div>
            <FieldLabel>Tipo</FieldLabel>
            <DropdownSelect disabled={disabled} value={draft.tipo} onChange={(v) => setField("tipo", v)} buttonStyle={inputStyle()} options={[
              { value: "SERVICIOS", label: "Servicios" },
              { value: "MATERIALES", label: "Materiales" },
              { value: "MIXTA", label: "Mixta" },
            ]} />
          </div>
          <div>
            <FieldLabel>Contacto</FieldLabel>
            {disabled
              ? <input disabled style={{ ...inputStyle(), opacity: 0.7, cursor: "not-allowed" }} value={draft.contacto} readOnly />
              : <OCSelector value={draft.contacto} onChange={pickContacto} options={contactoOptions} placeholder="Seleccionar o buscar contacto…" />}
          </div>
          <div>
            <FieldLabel>Dirección</FieldLabel>
            <input disabled={disabled} style={inputStyle()} value={draft.direccion} onChange={(e) => setField("direccion", e.target.value.toUpperCase())} />
          </div>
          <div>
            <FieldLabel>Teléfono</FieldLabel>
            <input disabled={disabled} style={inputStyle()} value={draft.telefono} onChange={(e) => setField("telefono", e.target.value)} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <FieldLabel>Solicitud / Proyecto</FieldLabel>
            <textarea disabled={disabled} rows={2} style={{ ...inputStyle(), resize: "vertical" }} value={draft.solicitud} onChange={(e) => setField("solicitud", e.target.value.toUpperCase())} />
          </div>
          <div>
            <FieldLabel>Moneda</FieldLabel>
            <DropdownSelect disabled={disabled} value={draft.moneda} onChange={(v) => setField("moneda", v)} buttonStyle={inputStyle()} options={[
              { value: "SOLES", label: "Soles (S/)" },
              { value: "DOLARES", label: "Dólares (US$)" },
            ]} />
          </div>
        </div>
      </div>

      {/* Secciones / items */}
      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text }}>Ítems de la cotización</div>
          {puedeEditar && (
            <button onClick={addSeccion} style={{ background: COLORS.amber, color: COLORS.amberText, fontWeight: 600, fontSize: 12, padding: "6px 12px", borderRadius: 7, border: "none", cursor: "pointer" }}>
              + Agregar sección
            </button>
          )}
        </div>

        {draft.secciones.map((s, si) => (
          <div key={s.id} style={{ border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 12, marginBottom: 12, background: COLORS.panel2 }}>
            {isMobile ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                <input
                  disabled={disabled}
                  style={{ ...inputStyle(), fontWeight: 600 }}
                  placeholder="Título de la sección (ej. TRABAJOS PRELIMINARES)"
                  value={s.titulo}
                  onChange={(e) => updateSeccion(si, { ...s, titulo: e.target.value.toUpperCase() })}
                  onFocus={scrollFieldIntoViewOnFocus}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontWeight: 700, color: COLORS.amber, fontSize: 13 }}>{s.numero}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.text, textAlign: "right", marginLeft: "auto" }}>{fmtMoney(seccionTotalCotizacion(s))}</div>
                  {puedeEditar && (
                    <>
                      <IconBtn title="Subir" onClick={() => moveSeccion(si, -1)}>↑</IconBtn>
                      <IconBtn title="Bajar" onClick={() => moveSeccion(si, 1)}>↓</IconBtn>
                      <IconBtn title="Eliminar sección" danger onClick={() => removeSeccion(si)}>✕</IconBtn>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                <div style={{ width: 34, textAlign: "center", fontWeight: 700, color: COLORS.amber, fontSize: 13 }}>{s.numero}</div>
                <input
                  disabled={disabled}
                  style={{ ...inputStyle(), flex: 1, fontWeight: 600 }}
                  placeholder="Título de la sección (ej. TRABAJOS PRELIMINARES)"
                  value={s.titulo}
                  onChange={(e) => updateSeccion(si, { ...s, titulo: e.target.value.toUpperCase() })}
                />
                <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.text, minWidth: 100, textAlign: "right" }}>{fmtMoney(seccionTotalCotizacion(s))}</div>
                {puedeEditar && (
                  <>
                    <IconBtn title="Subir" onClick={() => moveSeccion(si, -1)}>↑</IconBtn>
                    <IconBtn title="Bajar" onClick={() => moveSeccion(si, 1)}>↓</IconBtn>
                    <IconBtn title="Eliminar sección" danger onClick={() => removeSeccion(si)}>✕</IconBtn>
                  </>
                )}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {s.items.map((it, ii) => {
                const setItem = (patch) => {
                  const items = s.items.slice();
                  items[ii] = { ...it, ...patch };
                  updateSeccion(si, { ...s, items });
                };
                return isMobile ? (
                  <div key={it.id} style={{ display: "flex", flexDirection: "column", gap: 6, border: `1px solid ${COLORS.border}`, borderRadius: 7, padding: 8, background: COLORS.panel }}>
                    <FieldLabel>Detalle</FieldLabel>
                    <textarea
                      disabled={disabled}
                      rows={3}
                      style={{ ...inputStyle(), resize: "vertical" }}
                      placeholder="Detalle / descripción (puede incluir viñetas en líneas separadas)"
                      value={it.detalle}
                      onChange={(e) => setItem({ detalle: e.target.value.toUpperCase() })}
                      onFocus={scrollFieldIntoViewOnFocus}
                    />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      <div>
                        <FieldLabel>Cantidad</FieldLabel>
                        <input disabled={disabled} type="number" style={inputStyle()} placeholder="Cant." value={it.cantidad} onChange={(e) => setItem({ cantidad: e.target.value })} onFocus={scrollFieldIntoViewOnFocus} />
                      </div>
                      <div>
                        <FieldLabel>Medida</FieldLabel>
                        <input disabled={disabled} style={inputStyle()} list="cot-medidas" placeholder="Medida" value={it.medida} onChange={(e) => setItem({ medida: e.target.value })} onFocus={scrollFieldIntoViewOnFocus} />
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, alignItems: "end" }}>
                      <div>
                        <FieldLabel>Precio und.</FieldLabel>
                        <input disabled={disabled} type="number" style={inputStyle()} placeholder="Precio und." value={it.precioUnd} onChange={(e) => setItem({ precioUnd: e.target.value })} onFocus={scrollFieldIntoViewOnFocus} />
                      </div>
                      <div style={{ padding: "7px 9px", fontSize: 13, color: COLORS.text, textAlign: "right", fontWeight: 700 }}>{fmtMoney(itemTotalCotizacion(it))}</div>
                    </div>
                    {puedeEditar && s.items.length > 1 && (
                      <button
                        onClick={() => updateSeccion(si, { ...s, items: s.items.filter((_, i) => i !== ii) })}
                        style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.faint, borderRadius: 6, cursor: "pointer", height: 36, fontSize: 12.5 }}
                      >
                        ✕ Eliminar ítem
                      </button>
                    )}
                  </div>
                ) : (
                  <div key={it.id} style={{ display: "grid", gridTemplateColumns: "1fr 80px 90px 110px 110px 32px", gap: 6, alignItems: "start" }}>
                    <textarea
                      disabled={disabled}
                      rows={2}
                      style={{ ...inputStyle(), resize: "vertical" }}
                      placeholder="Detalle / descripción (puede incluir viñetas en líneas separadas)"
                      value={it.detalle}
                      onChange={(e) => setItem({ detalle: e.target.value.toUpperCase() })}
                    />
                    <input disabled={disabled} type="number" style={inputStyle()} placeholder="Cant." value={it.cantidad} onChange={(e) => setItem({ cantidad: e.target.value })} />
                    <input disabled={disabled} style={inputStyle()} list="cot-medidas" placeholder="Medida" value={it.medida} onChange={(e) => setItem({ medida: e.target.value })} />
                    <input disabled={disabled} type="number" style={inputStyle()} placeholder="Precio und." value={it.precioUnd} onChange={(e) => setItem({ precioUnd: e.target.value })} />
                    <div style={{ padding: "7px 9px", fontSize: 12.5, color: COLORS.dim, textAlign: "right" }}>{fmtMoney(itemTotalCotizacion(it))}</div>
                    {puedeEditar && s.items.length > 1 && (
                      <button
                        onClick={() => updateSeccion(si, { ...s, items: s.items.filter((_, i) => i !== ii) })}
                        title="Eliminar ítem"
                        style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.faint, borderRadius: 6, cursor: "pointer", height: 32 }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {puedeEditar && (
              <button
                onClick={() => updateSeccion(si, { ...s, items: [...s.items, emptyCotizacionItem()] })}
                style={{ marginTop: 8, background: "transparent", border: `1px dashed ${COLORS.border}`, color: COLORS.dim, borderRadius: 6, padding: "5px 10px", fontSize: 11.5, cursor: "pointer" }}
              >
                + Agregar ítem
              </button>
            )}
          </div>
        ))}
        <datalist id="cot-medidas">
          {COTIZACION_MEDIDAS.map((m) => <option key={m} value={m} />)}
        </datalist>
      </div>

      {/* Resumen */}
      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text, marginBottom: 12 }}>Resumen</div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div style={{ width: 280 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <FieldLabel>Descuento corporativo</FieldLabel>
            </div>
            <input
              disabled={disabled}
              type="number"
              style={{ ...inputStyle(), marginBottom: 10 }}
              value={draft.descuentoCorp}
              onChange={(e) => setField("descuentoCorp", e.target.value)}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: COLORS.dim, padding: "4px 0" }}>
              <span>Sub total</span><span>{fmtMoney(totales.base)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: COLORS.dim, padding: "4px 0" }}>
              <span>IGV (18%)</span><span>{fmtMoney(totales.igv)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700, color: COLORS.text, padding: "8px 0", borderTop: `1px solid ${COLORS.border}`, marginTop: 6 }}>
              <span>PRECIO TOTAL</span><span>{fmtMoney(totales.total)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Términos y condiciones */}
      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text }}>Términos y condiciones</div>
          {puedeEditar && (
            <button onClick={addTermino} style={{ background: "transparent", border: `1px dashed ${COLORS.border}`, color: COLORS.dim, borderRadius: 6, padding: "5px 10px", fontSize: 11.5, cursor: "pointer" }}>
              + Agregar término
            </button>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(draft.terminos || []).map((t, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "220px 1fr 32px", gap: 6 }}>
              <input disabled={disabled} style={inputStyle()} value={t.label} onChange={(e) => updateTermino(i, "label", e.target.value.toUpperCase())} />
              <input disabled={disabled} style={inputStyle()} value={t.value} onChange={(e) => updateTermino(i, "value", e.target.value.toUpperCase())} />
              {puedeEditar && (
                <button onClick={() => removeTermino(i)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.faint, borderRadius: 6, cursor: "pointer" }}>✕</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const COT_PDF_ROJO = "#FF0000";
const COT_PDF_AZUL = "#0070C0";
const COT_PDF_GRIS = "#DBDBDB";

function CotizacionPreview({ cot }) {
  const totales = cotizacionTotales(cot);
  return (
    <div className="cot-print" style={{ background: "#fff", color: "#141414", borderRadius: 10, overflow: "hidden", fontFamily: "'Times New Roman',Georgia,serif" }}>
      {/* Membrete: logo (izquierda) y datos de la empresa (derecha), en la misma fila. El
          nombre va en el azul de marca (igual que el logo); la direccion/RUC/telefono en
          gris oscuro, como dato secundario, para que no compitan visualmente con el nombre. */}
      <div style={{ padding: "16px 28px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img src={LOGO_SHIELD} alt="Wilarcon" style={{ width: 34, height: "auto" }} />
            <div style={{ fontWeight: 700, fontSize: 20, color: COT_PDF_AZUL, letterSpacing: 0.5, fontFamily: "'Helvetica Neue',Arial,sans-serif" }}>WILARCON</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: COT_PDF_AZUL }}>{WILARCON_EMPRESA.nombre}</div>
            <div style={{ fontSize: 10.5, color: "#6e6e6e" }}>{WILARCON_EMPRESA.direccion}</div>
            <div style={{ fontSize: 10.5, color: "#6e6e6e" }}>RUC:{WILARCON_EMPRESA.ruc}</div>
            <div style={{ fontSize: 10.5, color: "#6e6e6e" }}>{WILARCON_EMPRESA.telefono}</div>
          </div>
        </div>
      </div>

      {/* Franja roja: separador debajo del membrete */}
      <div style={{ height: 16, background: COT_PDF_ROJO, marginTop: 14 }} />

      <div style={{ padding: "14px 28px 0" }}>
        {/* Datos del cliente / N° cotización */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11 }}><b>CONTACTO:</b> {cot.contacto || "—"}</div>
            <div style={{ fontSize: 11 }}><b>DIRECCION:</b> {cot.direccion || "—"}</div>
            <div style={{ fontSize: 11 }}><b>TELEFONO:</b> {cot.telefono || "—"}</div>
            <div style={{ fontSize: 11 }}><b>FECHA:</b> {fmtDate(cot.fecha)}</div>
            <div style={{ fontSize: 11 }}><b>SOLICITUD:</b> {cot.solicitud || "—"}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: COT_PDF_AZUL }}>COTIZACION N°</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: COT_PDF_AZUL }}>{cot.numero || "—"}</div>
          </div>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ background: COT_PDF_GRIS }}>
              <th style={{ border: `1px solid #000`, padding: 6, width: 32 }}>N°</th>
              <th style={{ border: `1px solid #000`, padding: 6 }}>DESCRIPCION</th>
              <th style={{ border: `1px solid #000`, padding: 6, width: 62 }}>CANTIDAD</th>
              <th style={{ border: `1px solid #000`, padding: 6, width: 54 }}>MEDIDA</th>
              <th style={{ border: `1px solid #000`, padding: 6, width: 90 }} colSpan={2}>PRECIO UND</th>
              <th style={{ border: `1px solid #000`, padding: 6, width: 95 }} colSpan={2}>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {(cot.secciones || []).map((s) => (
              <Fragment key={s.id}>
                <tr style={{ fontWeight: 700 }}>
                  <td style={{ border: `1px solid #000`, padding: 6, textAlign: "center", verticalAlign: "middle" }}>{seccionNumeroLabel(s)}</td>
                  <td style={{ border: `1px solid #000`, padding: 6, textAlign: "center", verticalAlign: "middle" }}>{s.titulo}</td>
                  <td style={{ border: `1px solid #000`, padding: 6, verticalAlign: "middle" }}></td>
                  <td style={{ border: `1px solid #000`, padding: 6, verticalAlign: "middle" }}></td>
                  <td style={{ border: `1px solid #000`, padding: 6, verticalAlign: "middle" }} colSpan={2}></td>
                  <td style={{ border: `1px solid #000`, padding: 6, verticalAlign: "middle" }}>S/</td>
                  <td style={{ border: `1px solid #000`, padding: 6, textAlign: "right", verticalAlign: "middle" }}>{cotMontoFijo(seccionTotalCotizacion(s))}</td>
                </tr>
                {s.items.map((it, ii) => (
                  <tr key={it.id}>
                    <td style={{ border: `1px solid #000`, padding: 6, textAlign: "center", verticalAlign: "middle" }}>{itemNumeroLabel(s, ii)}</td>
                    <td style={{ border: `1px solid #000`, padding: 6, fontStyle: "italic", verticalAlign: "top" }}>
                      {String(it.detalle || "").split("\n").map((linea, li) => (
                        <div key={li}>• {linea}</div>
                      ))}
                    </td>
                    <td style={{ border: `1px solid #000`, padding: 6, textAlign: "center", verticalAlign: "middle" }}>{it.cantidad}</td>
                    <td style={{ border: `1px solid #000`, padding: 6, textAlign: "center", verticalAlign: "middle" }}>{it.medida}</td>
                    <td style={{ border: `1px solid #000`, padding: 6, verticalAlign: "middle" }}>{it.precioUnd === "" ? "" : "S/"}</td>
                    <td style={{ border: `1px solid #000`, padding: 6, textAlign: "right", verticalAlign: "middle" }}>{it.precioUnd === "" ? "-" : cotMontoFijo(it.precioUnd)}</td>
                    <td style={{ border: `1px solid #000`, padding: 6, verticalAlign: "middle" }}>S/</td>
                    <td style={{ border: `1px solid #000`, padding: 6, textAlign: "right", verticalAlign: "middle" }}>{cotMontoFijo(itemTotalCotizacion(it))}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 0 }}>
          <table style={{ width: 280, fontSize: 11, borderCollapse: "collapse", marginTop: -1 }}>
            <tbody>
              <tr><td style={{ border: `1px solid #000`, padding: "4px 8px" }}>DESC.CORP</td><td style={{ border: `1px solid #000`, padding: "4px 8px" }}>S/</td><td style={{ border: `1px solid #000`, padding: "4px 8px", textAlign: "right" }}>{cotMontoSmart(totales.descuento)}</td></tr>
              <tr><td style={{ border: `1px solid #000`, padding: "4px 8px" }}>SUB TOTAL</td><td style={{ border: `1px solid #000`, padding: "4px 8px" }}>S/</td><td style={{ border: `1px solid #000`, padding: "4px 8px", textAlign: "right" }}>{cotMontoSmart(totales.base)}</td></tr>
              <tr><td style={{ border: `1px solid #000`, padding: "4px 8px" }}>IGV</td><td style={{ border: `1px solid #000`, padding: "4px 8px" }}>S/</td><td style={{ border: `1px solid #000`, padding: "4px 8px", textAlign: "right" }}>{cotMontoSmart(totales.igv)}</td></tr>
              <tr><td style={{ border: `1px solid #000`, padding: "4px 8px", fontWeight: 700 }}>PRECIO TOTAL</td><td style={{ border: `1px solid #000`, padding: "4px 8px", fontWeight: 700 }}>S/</td><td style={{ border: `1px solid #000`, padding: "4px 8px", textAlign: "right", fontWeight: 700 }}>{cotMontoSmart(totales.total)}</td></tr>
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 11.5, marginBottom: 6 }}>TERMINOS Y CONDICIONES</div>
          {(cot.terminos || []).map((t, i) => (
            <div key={i} style={{ fontSize: 10.5 }}>{t.label}: {t.value}</div>
          ))}
        </div>
        <div style={{ height: 24 }} />
      </div>

      {/* Franja azul inferior */}
      <div style={{ background: COT_PDF_AZUL, color: "#fff", textAlign: "center", padding: "8px 10px", fontSize: 11 }}>
        <div style={{ fontWeight: 700 }}>{WILARCON_EMPRESA.nombre}</div>
        <div>{WILARCON_EMPRESA.telefonoFooter}</div>
        <div>{WILARCON_EMPRESA.emailFooter}</div>
      </div>
    </div>
  );
}

function ControlCotizaciones({ me = "", isAdmin = false, puedeEditar = true, puedeAgregar = true, puedeEliminar = true, puedeExportar = true } = {}) {
  const [cotizaciones, setCotizaciones] = useState(null);
  const [contactos, setContactos] = useState([]);
  const [visitasTecnicas, setVisitasTecnicas] = useState([]);
  const [showSeleccionarVisita, setShowSeleccionarVisita] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncState, setSyncState] = useState("pendiente");
  const [search, setSearch] = useState("");
  const [fAnio, setFAnio] = useState("");
  const [fMes, setFMes] = useState("");
  const [fContacto, setFContacto] = useState("");
  const [kpiSel, setKpiSel] = useState([]); // ["mes","contacto"] — KPIs activados (multi-select, se unen con OR entre sí)
  const [mode, setMode] = useState("lista"); // lista | editor
  const [draft, setDraft] = useState(null);
  const [isEditingExisting, setIsEditingExisting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfViewer, setPdfViewer] = useState(null); // { url, fileName, doc } | null
  // Ids de cotización cuyo botón de revisión (Presentar/Enviar) está siendo procesado. Evita que
  // varios clics rápidos sobre el mismo botón (mientras la operación async todavía no actualiza
  // el estado a "en_revision"/"finalizado") disparen la solicitud o el correo más de una vez.
  const [procesandoRevisionIds, setProcesandoRevisionIds] = useState(() => new Set());

  function cerrarPdfViewer() {
    setPdfViewer((prev) => {
      if (prev) { try { URL.revokeObjectURL(prev.url); } catch (e) { console.error(e); } }
      return null;
    });
  }

  // Se libera el blob URL del visor si el componente se desmonta con el visor abierto.
  useEffect(() => {
    return () => {
      setPdfViewer((prev) => {
        if (prev) { try { URL.revokeObjectURL(prev.url); } catch (e) { console.error(e); } }
        return prev;
      });
    };
  }, []);

  // Visitas Técnicas, para ofrecer elegirlas al crear una cotización nueva y precargar sus
  // datos compatibles. Es una fuente independiente y de solo lectura desde esta página (no se
  // crean ni editan visitas aquí), por eso no lleva seed ni bloquea la carga de cotizaciones.
  useEffect(() => {
    let cancelado = false;
    async function cargarVisitas() {
      try {
        const res = await window.storage.get(STORAGE_KEY_VISITAS, true);
        const data = JSON.parse(res.value);
        if (!cancelado) setVisitasTecnicas(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelado) setVisitasTecnicas([]);
        console.error("cargarVisitas (cotizacion): fallo la carga", e);
      }
    }
    cargarVisitas();
    const onVisible = () => { if (document.visibilityState === "visible") cargarVisitas(); };
    document.addEventListener("visibilitychange", onVisible);
    const intervalId = setInterval(cargarVisitas, 60000);
    return () => { cancelado = true; document.removeEventListener("visibilitychange", onVisible); clearInterval(intervalId); };
  }, []);

  useEffect(() => {
    let cancelado = false;
    async function loadCotizaciones() {
      let data = [];
      let contactosRaw = [];

      // Cotizaciones y contactos son fuentes independientes. Un fallo de permisos
      // en contactos no debe ocultar las cotizaciones del usuario.
      try {
        const res = await window.storage.get(STORAGE_KEY_COTIZACIONES, true);
        const parsed = JSON.parse(res.value);
        data = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        console.error("carga de cotizaciones: fallo", e);
        data = [];
      }

      try {
        const resContactos = await window.storage.get(STORAGE_KEY_CONTACTOS, true);
        const parsed = JSON.parse(resContactos.value);
        contactosRaw = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        console.error("carga de contactos (para cotizacion): fallo", e);
        contactosRaw = [];
      }

      if (cancelado) return;

      if (contactosRaw.length) {
        setContactos(contactosRaw);
      } else if (isAdmin) {
        setContactos(CONTACTOS_SEED);
        try { await window.storage.set(STORAGE_KEY_CONTACTOS, JSON.stringify(CONTACTOS_SEED), true); } catch (_) { console.error(_); }
      } else {
        setContactos([]);
      }

      const hasData = data.length > 0;
      if (hasData) {
        setCotizaciones(data);
      } else if (isAdmin) {
        setCotizaciones(COTIZACIONES_SEED);
        try { await window.storage.set(STORAGE_KEY_COTIZACIONES, JSON.stringify(COTIZACIONES_SEED), true); } catch (_) { console.error(_); }
      } else {
        setCotizaciones([]);
      }
      setSyncState("ok");
      setLoading(false);
    }
    loadCotizaciones();
    // Cuando el administrador aprueba/rechaza una solicitud de revisión desde el panel
    // (AppShell), la cotización cambia de estado en el servidor pero esta página, si ya
    // estaba montada, no se enteraba hasta recargar. Se escucha el mismo evento que dispara
    // resolverRevisionCotizacion() para refrescar la lista y que el botón/KPI se actualicen solos.
    const onRevisionCambiada = () => loadCotizaciones();
    window.addEventListener("wilarcon:revisiones-cotizacion-changed", onRevisionCambiada);
    return () => { cancelado = true; window.removeEventListener("wilarcon:revisiones-cotizacion-changed", onRevisionCambiada); };
  }, [isAdmin]);
  async function persist(next, intent) {
    if (typeof next === "function") {
      try {
        const applied = await mutateStorageJSON(STORAGE_KEY_COTIZACIONES, [], (current) => next(Array.isArray(current) ? current : []), 4, intent);
        setCotizaciones(applied);
        setSyncState("ok");
      } catch (e) {
        console.error(e);
        setSyncState(classifySyncError(e));
        alert("No se pudo guardar el cambio: otro usuario modificó estos registros al mismo tiempo. Recarga la página e inténtalo de nuevo.");
      }
      return;
    }
    setCotizaciones(next);
    try { await window.storage.set(STORAGE_KEY_COTIZACIONES, JSON.stringify(next), { intent }); setSyncState("ok"); } catch (e) { console.error(e); setSyncState(classifySyncError(e)); }
  }

  // Migración retroactiva a mayúsculas (v3.5.31): normaliza lo que ya estaba
  // guardado en minúscula o mixtas. "Medida" queda excluida a propósito: se
  // guarda en minúscula (und, glb, m2...) por ser una abreviatura técnica estándar.
  useEffect(() => {
    if (!isAdmin) return;
    persist((current) => {
      const list = Array.isArray(current) ? current : [];
      const up = (v) => (typeof v === "string" ? v.toUpperCase() : v);
      const normalized = list.map((c) => {
        const next = {
          ...c,
          numero: up(c.numero),
          direccion: up(c.direccion),
          solicitud: up(c.solicitud),
          secciones: (c.secciones || []).map((s) => ({
            ...s,
            titulo: up(s.titulo),
            items: (s.items || []).map((it) => ({ ...it, detalle: up(it.detalle), medida: typeof it.medida === "string" ? it.medida.toLowerCase() : it.medida })),
          })),
          terminos: (c.terminos || []).map((t) => ({ ...t, label: up(t.label), value: up(t.value) })),
        };
        return next;
      });
      return JSON.stringify(normalized) !== JSON.stringify(list) ? normalized : undefined;
    }, "migracion-mayusculas-cotizaciones");
  }, [isAdmin]);

  const searched = useMemo(() => {
    let list = cotizaciones || [];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((c) =>
        String(c.numero || "").toLowerCase().includes(q) ||
        String(c.contacto || "").toLowerCase().includes(q) ||
        String(c.solicitud || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [cotizaciones, search]);

  // Opciones de los filtros de Año / Mes / Contacto: se calculan sobre TODAS las cotizaciones
  // (no sobre `searched`/`baseFiltrado`) para que la lista de opciones no se vaya achicando a
  // medida que se aplican otros filtros.
  const mesesDisponiblesCot = useMemo(() => Array.from(new Set((cotizaciones || []).map((c) => String(c.fecha || "").slice(0, 7)).filter(Boolean))).sort().reverse(), [cotizaciones]);
  const aniosDisponiblesCot = useMemo(() => Array.from(new Set(mesesDisponiblesCot.map((m) => m.slice(0, 4)))).sort().reverse(), [mesesDisponiblesCot]);
  const mesesDelAnioCot = useMemo(() => (fAnio ? mesesDisponiblesCot.filter((m) => m.slice(0, 4) === fAnio) : []), [mesesDisponiblesCot, fAnio]);
  const contactosDisponiblesCot = useMemo(() => Array.from(new Set((cotizaciones || []).map((c) => String(c.contacto || "").trim()).filter(Boolean))).sort(), [cotizaciones]);

  // Base sobre la que se calculan los KPI: búsqueda + filtros de Año/Mes/Contacto (para que esos
  // filtros SÍ impacten los valores de los KPI), pero sin aplicar todavía los propios KPI (que se
  // seleccionan aparte, más abajo).
  const baseFiltrado = useMemo(() => {
    let list = searched;
    if (fAnio) list = list.filter((c) => String(c.fecha || "").slice(0, 4) === fAnio);
    if (fMes) list = list.filter((c) => String(c.fecha || "").slice(0, 7) === fMes);
    if (fContacto) list = list.filter((c) => String(c.contacto || "").trim() === fContacto);
    return list;
  }, [searched, fAnio, fMes, fContacto]);

  const totalCotizaciones = baseFiltrado.length;
  // KPIs por estado del flujo de revisión (ver revisionEstado más arriba):
  //   ENVIAR     -> cotizaciones "aprobada" (listas para presionar el botón "Enviar")
  //   REVISAR    -> cotizaciones "pendiente" (aún no se envían a revisión)
  //   FINALIZADO -> cotizaciones "finalizado" (flujo cerrado)
  // "en_revision" (esperando aprobación del admin) no se cuenta en ningún KPI a propósito.
  const esEnviar = (c) => revisionEstado(c) === "aprobada";
  const esRevisar = (c) => revisionEstado(c) === "pendiente";
  const esFinalizado = (c) => revisionEstado(c) === "finalizado";
  const cantEnviar = useMemo(() => baseFiltrado.filter(esEnviar).length, [baseFiltrado]);
  const cantRevisar = useMemo(() => baseFiltrado.filter(esRevisar).length, [baseFiltrado]);
  const cantFinalizado = useMemo(() => baseFiltrado.filter(esFinalizado).length, [baseFiltrado]);

  function toggleKpi(id) {
    setKpiSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  // Si hay 1 o más KPI seleccionados, la lista (y sus totales) se arma con la UNION de esos
  // criterios (OR), no con la intersección: seleccionar "Enviar" + "Finalizado" SUMA ambos
  // grupos en vez de reducir el resultado a la intersección de los dos.
  const filtered = useMemo(() => {
    let list = baseFiltrado;
    if (kpiSel.length) {
      list = list.filter((c) => (kpiSel.includes("enviar") && esEnviar(c)) || (kpiSel.includes("revisar") && esRevisar(c)) || (kpiSel.includes("finalizado") && esFinalizado(c)));
    }
    return list.slice().sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
  }, [baseFiltrado, kpiSel]);

  function openNueva() {
    setShowSeleccionarVisita(true);
  }

  // Crea el draft de la nueva cotización, opcionalmente precargado con los datos de una
  // Visita Técnica (visita = null equivale al flujo de siempre, en blanco).
  function crearNuevaCotizacion(visita) {
    const base = visita ? cotizacionDraftDesdeVisita(visita) : emptyCotizacionDraft();
    base.numero = siguienteNumeroCotizacion(cotizaciones || []);
    base.creadoPor = me;
    setDraft(base);
    setIsEditingExisting(false);
    setMode("editor");
    setShowPreview(false);
    setShowSeleccionarVisita(false);
  }

  function openEditar(cot) {
    setDraft(JSON.parse(JSON.stringify(cot)));
    setIsEditingExisting(true);
    setMode("editor");
    setShowPreview(false);
  }

  function duplicar(cot) {
    const copia = JSON.parse(JSON.stringify(cot));
    copia.id = uid();
    copia.numero = siguienteNumeroCotizacion(cotizaciones || []);
    copia.fecha = todayStr();
    copia.creadoPor = me;
    setDraft(copia);
    setIsEditingExisting(false);
    setMode("editor");
    setShowPreview(false);
  }

  async function persistEditCotizacion(draftToSave) {
    await persist((list) => {
      // Si el N° de cotización quedó duplicado con otro registro (p.ej. lo editaron
      // a mano), se reasigna al siguiente correlativo disponible sobre la lista
      // actual del servidor antes de guardar.
      const numeroRepetido = list.some(
        (c) => c.id !== draftToSave.id && String(c.numero || "").trim() === String(draftToSave.numero || "").trim()
      );
      const numero = numeroRepetido ? siguienteNumeroCotizacion(list) : draftToSave.numero;
      const actual = list.find((c) => c.id === draftToSave.id);
      // Si el contenido real cambió, el flujo de revisión vuelve al inicio ("Presentar"),
      // porque una aprobación previa ya no corresponde a lo que se está guardando ahora.
      // Si se guarda sin cambios (p.ej. abrieron y cerraron el editor), el estado se mantiene.
      const huboCambios = contenidoCotizacionCambio(actual, { ...draftToSave, numero });
      const next = {
        ...draftToSave,
        numero,
        actualizadoEn: Date.now(),
        ...(huboCambios
          ? {
              estadoRevision: "pendiente",
              revisionSolicitadaPor: undefined,
              revisionSolicitadaFecha: undefined,
              revisionAprobadaPor: undefined,
              revisionAprobadaFecha: undefined,
              revisionFinalizadaPor: undefined,
              revisionFinalizadaFecha: undefined,
            }
          : {}),
      };
      return list.map((c) => (c.id === next.id ? next : c));
    }, "editar_cotizacion");
  }
  // Autoguardado: solo aplica cuando se está editando una cotización YA EXISTENTE
  // (no cuando se está creando una nueva o duplicando, que todavía no tiene registro
  // propio). Guarda si el usuario cambia de pestaña, oculta la ventana o vuelve a la
  // lista sin apretar "Guardar".
  // Guardado silencioso: si el registro todavía no existe lo crea, si ya existe lo actualiza.
  // Es el único punto de guardado de la página (ya no hay botón "Guardar"): lo dispara el
  // autoguardado con debounce y también "Volver a la lista" para no perder el último cambio.
  async function guardarDraftSilencioso(current) {
    const existeActual = (cotizaciones || []).some((c) => c.id === current.id);
    if (existeActual) {
      await persistEditCotizacion(current);
      return;
    }
    let numeroFinal = current.numero;
    await persist((list) => {
      const numeroRepetido = list.some((c) => String(c.numero || "").trim() === String(current.numero || "").trim());
      numeroFinal = numeroRepetido ? siguienteNumeroCotizacion(list) : current.numero;
      const next = { ...current, numero: numeroFinal, actualizadoEn: Date.now() };
      return [next, ...list];
    }, "agregar_cotizacion");
    setIsEditingExisting(true);
    if (numeroFinal !== current.numero) {
      setDraft((d) => (d && d.id === current.id ? { ...d, numero: numeroFinal } : d));
    }
  }
  // Autoguardado: activo mientras se está en el editor (tanto para una cotización nueva como
  // para una ya existente). Guarda solo unos segundos después de que el usuario deja de escribir,
  // y de inmediato si cambia de pestaña/oculta la ventana o se llama a flush() manualmente.
  const autoSaveEditCotizacion = useAutoSaveDebounced({
    active: mode === "editor" && puedeEditar,
    draft,
    saveFn: guardarDraftSilencioso,
  });

  async function doDelete(id) {
    await persist((list) => list.filter((c) => c.id !== id), "eliminar_cotizacion");
    setConfirmDelete(null);
  }

  async function enviarARevision(cot) {
    await persist(
      (list) => list.map((c) => (c.id === cot.id ? { ...c, estadoRevision: "en_revision", revisionSolicitadaPor: me, revisionSolicitadaFecha: Date.now() } : c)),
      "enviar_revision_cotizacion"
    );
    try {
      await crearSolicitudRevisionCotizacion({ cotizacionId: cot.id, numero: cot.numero, contacto: cot.contacto, solicitud: cot.solicitud, autor: me });
    } catch (e) {
      console.error(e);
      alert("No se pudo enviar la solicitud de revisión.");
    }
  }

  // Efecto secundario "best-effort" al presionar "Enviar": arma el PDF (igual que en
  // "Ver PDF"/"Exportar") y lo manda en base64 junto a los datos básicos al endpoint
  // /api/webhook-cotizacion, que a su vez lo reenvía al webhook externo configurado en
  // Vercel (WEBHOOK_COTIZACION_URL). Si algo falla aquí no debe afectar el flujo: el estado
  // "finalizado" ya quedó guardado antes de llamar a esta función.
  async function enviarWebhookCotizacion(cot) {
    try {
      const totales = cotizacionTotales(cot);
      const { doc, fileName } = await buildCotizacionPdf(cot, { download: false });
      const pdfBase64 = String(doc.output("datauristring")).split(",").pop();
      await fetch("/api/webhook-cotizacion", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numero: cot.numero,
          contacto: cot.contacto,
          solicitud: cot.solicitud,
          moneda: cot.moneda,
          total: totales.total,
          pdfBase64,
          pdfFileName: fileName,
        }),
      });
    } catch (e) {
      console.error("no se pudo enviar el webhook de cotización", e);
    }
  }

  async function finalizarCotizacion(cot) {
    await persist(
      (list) => list.map((c) => (c.id === cot.id ? { ...c, estadoRevision: "finalizado", revisionFinalizadaPor: me, revisionFinalizadaFecha: Date.now() } : c)),
      "finalizar_cotizacion"
    );
    await enviarWebhookCotizacion(cot);
  }

  async function handleRevisionClick(cot) {
    // Guard contra doble/triple clic: mientras la operación async para este id está en curso,
    // se ignoran clics adicionales sobre el mismo botón (ver estado procesandoRevisionIds).
    if (procesandoRevisionIds.has(cot.id)) return;
    const e = revisionEstado(cot);
    if (e !== "pendiente" && e !== "aprobada") return;
    setProcesandoRevisionIds((prev) => new Set(prev).add(cot.id));
    try {
      if (e === "pendiente") await enviarARevision(cot);
      else await finalizarCotizacion(cot);
    } finally {
      setProcesandoRevisionIds((prev) => {
        const next = new Set(prev);
        next.delete(cot.id);
        return next;
      });
    }
  }

  async function exportarPdf(cot) {
    setExportingPdf(true);
    try {
      const { doc, fileName } = await buildCotizacionPdf(cot, { download: false });
      const url = doc.output("bloburl");
      setPdfViewer((prev) => {
        if (prev) { try { URL.revokeObjectURL(prev.url); } catch (e) { console.error(e); } }
        return { url, fileName, doc };
      });
    } catch (e) {
      console.error(e);
      alert("No se pudo generar el PDF de la cotización.");
    }
    setExportingPdf(false);
  }

  // Copia de respaldo en carpeta local: un PDF por cada cotización (el mismo que genera
  // "Ver / exportar PDF"), no un Excel resumen. Se arma sobre `cotizaciones` completo (no sobre
  // `filtered`) para que el respaldo no dependa de los filtros de búsqueda/período/contacto que
  // esté usando la pantalla en ese momento.
  async function pdfsCotizacionesParaCarpetaLocal() {
    const archivos = [];
    for (const cot of cotizaciones || []) {
      try {
        const { doc, fileName } = await buildCotizacionPdf(cot, { download: false });
        archivos.push({ nombre: fileName, arrayBuffer: doc.output("arraybuffer") });
      } catch (e) {
        console.error("[carpeta local cotizacion] no se pudo generar el PDF de", cot.numero, e);
      }
    }
    return archivos;
  }
  const carpetaLocal = useCarpetaLocal("cotizacion");
  useEffect(() => {
    if (!cotizaciones) return;
    carpetaLocal.programarGuardado(null, pdfsCotizacionesParaCarpetaLocal, 1200, "pdfs");
  }, [cotizaciones]);


  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: COLORS.dim }}>Cargando cotizaciones…</div>;
  }

  return (
    <div style={{ background: COLORS.bg, color: COLORS.text, fontFamily: "'Inter',sans-serif", fontSize: 13, padding: "18px 22px 40px", maxWidth: 1180, margin: "0 auto" }}>
      <style>{`
        .ct-th { position: sticky; top: 0; background: ${COLORS.panel2}; text-align: left; padding: 9px 10px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .5px; color: ${COLORS.dim}; border-bottom: 1px solid ${COLORS.border}; white-space: nowrap; }
        .ct-td { padding: 8px 10px; border-bottom: 1px solid ${COLORS.grid}; vertical-align: middle; }
        .ct-row:hover { background: rgba(77,141,184,.07); cursor: pointer; }
        .ct-scroll::-webkit-scrollbar { height: 8px; width: 8px; }
        .ct-scroll::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 4px; }
        .ct-input2 { width: 100%; background: ${COLORS.panel2}; border: 1px solid ${COLORS.border}; color: ${COLORS.text}; font-family: 'Inter',sans-serif; font-size: 12.5px; padding: 7px 9px; border-radius: 6px; outline: none; box-sizing: border-box; }
        .ct-input2:focus { border-color: ${COLORS.amber}; }
        .ct-input2::placeholder { color: ${COLORS.faint}; opacity: 1; }
        @media print {
          body * { visibility: hidden; }
          .cot-print, .cot-print * { visibility: visible; }
          .cot-print { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 18, fontWeight: 700, color: COLORS.text, margin: 0 }}>COTIZACIÓN</h1>
          <div style={{ fontSize: 12, color: COLORS.dim, marginTop: 2 }}>Crea y gestiona cotizaciones de servicios y materiales</div>
        </div>
        <SyncDot syncState={syncState} palette={COLORS} />
      </div>

      {mode === "lista" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10, marginBottom: 12 }}>
            <Kpi
              label="Total cotizaciones"
              value={String(totalCotizaciones)}
              icon="▤"
              active={kpiSel.length === 0}
              onClick={() => setKpiSel([])}
              title="Ver todas las cotizaciones (según los filtros de arriba)"
            />
            <Kpi
              label="Enviar"
              value={String(cantEnviar)}
              icon="📤"
              tone={kpiSel.includes("enviar") ? "amber" : undefined}
              active={kpiSel.includes("enviar")}
              onClick={() => toggleKpi("enviar")}
              title="Sumar al resultado las cotizaciones aprobadas, listas para enviar"
            />
            <Kpi
              label="Presentar"
              value={String(cantRevisar)}
              icon="🕓"
              tone={kpiSel.includes("revisar") ? "amber" : undefined}
              active={kpiSel.includes("revisar")}
              onClick={() => toggleKpi("revisar")}
              title="Sumar al resultado las cotizaciones pendientes de enviar a revisión"
            />
            <Kpi
              label="Finalizado"
              value={String(cantFinalizado)}
              icon="✅"
              tone={kpiSel.includes("finalizado") ? "amber" : undefined}
              active={kpiSel.includes("finalizado")}
              onClick={() => toggleKpi("finalizado")}
              title="Sumar al resultado las cotizaciones finalizadas"
            />
          </div>
          {kpiSel.length > 1 && (
            <div style={{ fontSize: 11.5, color: COLORS.dim, marginTop: -6, marginBottom: 10 }}>
              Mostrando la suma de los {kpiSel.length} KPI seleccionados: {filtered.length} cotización{filtered.length === 1 ? "" : "es"} en total.
            </div>
          )}

          <FilterBar marginBottom={12}>
            <input
              className="ct-input2"
              placeholder="Buscar por N°, contacto o solicitud…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ maxWidth: 260 }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 9 }} title="Elige el año y luego el mes para filtrar las cotizaciones por período">
              <span style={{ fontSize: 11, color: COLORS.dim, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
                📅 Periodo
              </span>
              <DropdownSelect
                value={fAnio}
                onChange={(v) => { setFAnio(v); setFMes(""); }}
                options={aniosDisponiblesCot}
                placeholder="Todos los años"
                buttonStyle={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 20, color: COLORS.text, fontFamily: "'Inter',sans-serif", fontSize: 12.5, fontWeight: 600, padding: "5px 12px" }}
              />
              <DropdownSelect
                value={fMes}
                onChange={setFMes}
                options={mesesDelAnioCot.map((m) => ({ value: m, label: monthLabel(m) }))}
                placeholder="Todos los meses"
                disabled={!fAnio}
                buttonStyle={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 20, color: COLORS.text, fontFamily: "'Inter',sans-serif", fontSize: 12.5, fontWeight: 600, padding: "5px 12px", opacity: fAnio ? 1 : 0.5 }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ fontSize: 11, color: COLORS.dim, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, whiteSpace: "nowrap" }}>
                👤 Contacto
              </span>
              <DropdownSelect
                value={fContacto}
                onChange={setFContacto}
                options={contactosDisponiblesCot}
                placeholder="Todos"
                buttonStyle={{ background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 20, color: COLORS.text, fontFamily: "'Inter',sans-serif", fontSize: 12.5, fontWeight: 600, padding: "5px 12px" }}
              />
            </div>
            {(search || fAnio || fMes || fContacto || kpiSel.length > 0) && (
              <ClearFiltersButton onClick={() => { setSearch(""); setFAnio(""); setFMes(""); setFContacto(""); setKpiSel([]); }} />
            )}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
              {puedeExportar && <BotonCarpetaLocal carpeta={carpetaLocal} formato="pdf" />}
              {puedeAgregar && (
                <button onClick={openNueva} style={{ background: COLORS.amber, color: COLORS.amberText, fontWeight: 600, fontSize: 12.5, padding: "8px 14px", borderRadius: 7, border: "none", cursor: "pointer" }}>
                  + Nueva cotización
                </button>
              )}
            </div>
          </FilterBar>

          <div className="ct-scroll" style={{ overflowX: "auto", border: `1px solid ${COLORS.border}`, borderRadius: 9 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", background: COLORS.panel }}>
              <thead>
                <tr>
                  <th className="ct-th">N° Cotización</th>
                  <th className="ct-th">Fecha</th>
                  <th className="ct-th">Contacto</th>
                  <th className="ct-th">Solicitud</th>
                  <th className="ct-th">Tipo</th>
                  <th className="ct-th">Total</th>
                  <th className="ct-th" style={{ width: 160 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td className="ct-td" colSpan={7} style={{ textAlign: "center", color: COLORS.faint, padding: 20 }}>Sin cotizaciones</td></tr>
                )}
                {filtered.map((c) => {
                  const t = cotizacionTotales(c);
                  return (
                    <tr key={c.id} className="ct-row" onClick={() => openEditar(c)}>
                      <td className="ct-td">
                        <div style={{ fontWeight: 600 }}>{c.solicitud || c.numero || "—"}</div>
                        <div style={{ fontSize: 11, color: COLORS.dim, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.numero || "—"}</div>
                      </td>
                      <td className="ct-td" style={{ color: COLORS.dim }}>{fmtDate(c.fecha) || "—"}</td>
                      <td className="ct-td">{c.contacto || "—"}</td>
                      <td className="ct-td" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.solicitud || "—"}</td>
                      <td className="ct-td" style={{ color: COLORS.dim }}>{c.tipo || "—"}</td>
                      <td className="ct-td" style={{ fontWeight: 600 }}>{fmtMoney(t.total)}</td>
                      <td className="ct-td" onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {puedeAgregar && <IconBtn title="Duplicar" onClick={() => duplicar(c)}>Duplicar</IconBtn>}
                        {puedeExportar && <IconBtn title="Ver / exportar PDF" onClick={() => exportarPdf(c)}>PDF</IconBtn>}
                        {puedeEditar && (() => {
                          const procesando = procesandoRevisionIds.has(c.id);
                          const rb = revisionBtnInfo(c);
                          return (
                            <IconBtn
                              title={procesando ? "Procesando…" : rb.title}
                              color={rb.color}
                              disabled={rb.disabled || procesando}
                              onClick={() => handleRevisionClick(c)}
                            >
                              {procesando ? "Enviando…" : rb.label}
                            </IconBtn>
                          );
                        })()}
                        {puedeEliminar && <IconBtn title="Eliminar" danger onClick={() => setConfirmDelete(c.id)}>Eliminar</IconBtn>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {mode === "editor" && draft && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
            <button onClick={async () => { await autoSaveEditCotizacion(); setMode("lista"); setDraft(null); setIsEditingExisting(false); }} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, borderRadius: 7, padding: "7px 14px", fontSize: 12.5, cursor: "pointer" }}>
              ← Volver a la lista
            </button>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => setShowPreview((v) => !v)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: 7, padding: "7px 14px", fontSize: 12.5, cursor: "pointer" }}>
                {showPreview ? "Ocultar vista previa" : "Vista previa"}
              </button>
              {showPreview && (
                <button onClick={() => window.print()} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: 7, padding: "7px 14px", fontSize: 12.5, cursor: "pointer" }}>
                  Imprimir / PDF
                </button>
              )}
              {puedeExportar && (
                <button disabled={exportingPdf} onClick={() => exportarPdf(draft)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: 7, padding: "7px 14px", fontSize: 12.5, cursor: exportingPdf ? "default" : "pointer", opacity: exportingPdf ? 0.6 : 1 }}>
                  {exportingPdf ? "Generando…" : "Ver PDF"}
                </button>
              )}
              {puedeEditar && (
                <span style={{ display: "flex", alignItems: "center", gap: 6, color: COLORS.faint, fontSize: 11.5 }}>
                  Guardado automático
                </span>
              )}
            </div>
          </div>

          {showPreview ? (
            <CotizacionPreview cot={draft} />
          ) : (
            <CotizacionEditor draft={draft} onChange={setDraft} contactos={contactos} puedeEditar={puedeEditar} />
          )}
        </div>
      )}

      {confirmDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setConfirmDelete(null)}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 18, width: 320, maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 13.5, color: COLORS.text, marginBottom: 14 }}>¿Eliminar esta cotización?</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setConfirmDelete(null)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, borderRadius: 7, padding: "7px 14px", fontSize: 12.5, cursor: "pointer" }}>Cancelar</button>
              <button onClick={() => doDelete(confirmDelete)} style={{ background: COLORS.red, color: COLORS.white, border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Eliminar</button>
            </div>
          </div>
        </div>
      )}


      {showSeleccionarVisita && (
        <SeleccionarVisitaModal
          visitas={visitasTecnicas}
          onSeleccionar={crearNuevaCotizacion}
          onOmitir={() => crearNuevaCotizacion(null)}
          onClose={() => setShowSeleccionarVisita(false)}
        />
      )}
      <PdfViewerModal pdf={pdfViewer} onClose={cerrarPdfViewer} />
    </div>
  );
}

export { ControlCotizaciones, CotizacionEditor, CotizacionPreview };
