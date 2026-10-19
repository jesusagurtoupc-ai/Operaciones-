import { useState, useEffect, useMemo, useRef } from "react";
import * as C from "./core-common";
const {
  classifySyncError,
  SyncDot,
  FilterBar,
  ClearFiltersButton,
  PdfViewerModal,
  scrollFieldIntoViewOnFocus,
  mutateStorageJSON,
  LOGO_SHIELD,
  COLORS,
  uid,
  fmtDate,
  Kpi,
  useIsMobile,
  STORAGE_KEY_INFORMES,
  emptyInformeDraft,
  emptyInformeInfraDraft,
  informeDraftDesdeCotizacion,
  siguienteCodigoInforme,
  siguienteNumeroProyecto,
  resizeImageFile,
  subirFotoADrive,
  urlFotoDrive,
  eliminarFotoDrive,
  buildInformePdf,
  buildInformeInfraPdf,
  intentarGuardarConAprobacion,
  intentarEliminarConAprobacion,
  useSustentoGate,
  filterOwnRecords,
  downloadXlsxWorkbook,
  useCarpetaLocal,
  BotonCarpetaLocal,
  OCSelector,
  buildOcOptions,
  STORAGE_KEY_RECORDS,
  STORAGE_KEY_CONTACTOS,
  STORAGE_KEY_COTIZACIONES,
  useAutoSaveDebounced,
} = C;

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

function FotoTile({ foto, index, onQuitar, onRenombrar, onSubirEnEspacio, puedeAdjuntar = true }) {
  const nombre = foto.nombre ?? `Fotografía ${index + 1}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <input
        className="ct-input2"
        value={nombre}
        onChange={(e) => onRenombrar(e.target.value)}
        placeholder={`Fotografía ${index + 1}`}
        style={{ fontSize: 10.5, padding: "4px 6px" }}
        disabled={!puedeAdjuntar}
      />
      {foto.driveFileId || foto.dataUrl ? (
        <div style={{ position: "relative" }}>
          <img src={foto.driveFileId ? urlFotoDrive(foto.driveFileId) : foto.dataUrl} alt={nombre} style={{ width: "100%", height: 70, objectFit: "contain", background: COLORS.panel2, borderRadius: 6, border: `1px solid ${COLORS.border}`, display: "block" }} />
          {puedeAdjuntar && (
            <button type="button" onClick={onQuitar} style={{ position: "absolute", top: 2, right: 2, background: COLORS.overlayDark, color: COLORS.white, border: "none", borderRadius: 4, width: 18, height: 18, fontSize: 10, cursor: "pointer", lineHeight: 1 }}>✕</button>
          )}
        </div>
      ) : puedeAdjuntar ? (
        <label style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 70, borderRadius: 6, border: `1px dashed ${COLORS.border}`, color: COLORS.faint, fontSize: 10.5, cursor: "pointer", textAlign: "center", padding: 4 }}>
          📷 Subir foto
          <input type="file" accept="image/*" onChange={(e) => { onSubirEnEspacio(e.target.files[0]); e.target.value = ""; }} style={{ display: "none" }} />
        </label>
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 70, borderRadius: 6, border: `1px dashed ${COLORS.border}`, color: COLORS.faint, fontSize: 10.5, textAlign: "center", padding: 4 }}>
          Sin permiso para adjuntar
        </div>
      )}
    </div>
  );
}

function ListaEditable({ label, placeholder, items, onChange, addLabel }) {
  const list = items && items.length ? items : [""];
  function setAt(i, value) { const next = [...list]; next[i] = value; onChange(next); }
  function addRow() { onChange([...list, ""]); }
  function removeRow(i) { const next = list.filter((_, idx) => idx !== i); onChange(next.length ? next : [""]); }
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 6 }}>{label}</div>
      {list.map((v, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "flex-start" }}>
          <div style={{ fontSize: 11.5, color: COLORS.faint, paddingTop: 8, width: 16, flexShrink: 0 }}>{i + 1}.</div>
          <textarea className="ct-input2" rows={2} placeholder={placeholder} value={v} onChange={(e) => setAt(i, e.target.value)} style={{ resize: "vertical", flex: 1 }} />
          <button type="button" onClick={() => removeRow(i)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.faint, borderRadius: 6, padding: "6px 9px", fontSize: 11, cursor: "pointer", flexShrink: 0 }}>✕</button>
        </div>
      ))}
      <button type="button" onClick={addRow} style={{ background: "transparent", border: `1px dashed ${COLORS.border}`, color: COLORS.dim, borderRadius: 6, padding: "5px 10px", fontSize: 11.5, cursor: "pointer" }}>+ {addLabel}</button>
    </div>
  );
}

// Selector para precargar un informe nuevo con los datos ya escritos en una Cotización
// (contacto/dirección/teléfono/solicitud/ítems). Solo se muestra al crear un informe nuevo,
// no al editar uno existente, para no pisar datos ya guardados sin querer.

function InformeForm({ value, onChange, subiendoFoto, onSubirFotos, onQuitarFoto, onRenombrarFoto, onAgregarEspacioFoto, onSubirFotoEnEspacio, contactos = [], ocOptions = [], puedeAdjuntar = true, cotizaciones = [], permitirCotizacionOrigen = false }) {
  const v = value;
  function set(k, val) { onChange({ ...v, [k]: val }); }
  const isMobile = useIsMobile();
  const cotizacionOptions = useMemo(() => {
    const seen = new Set();
    const list = [];
    (cotizaciones || []).slice().sort((a, b) => String(b?.numero || "").localeCompare(String(a?.numero || ""))).forEach((c) => {
      const numero = String(c?.numero || "").trim();
      if (!numero) return;
      const k = numero.toLocaleLowerCase();
      if (seen.has(k)) return;
      seen.add(k); list.push({ value: numero, label: `${numero} — ${c.solicitud || "sin solicitud/proyecto"}` });
    });
    return list;
  }, [cotizaciones]);
  // Igual patrón que pickCliente/pickContacto (Cotización): al elegir una cotización de la
  // lista se precargan los campos compatibles del informe; si se escribe algo que no coincide
  // con ninguna, solo se guarda el número tal cual (sin tocar el resto del formulario).
  function pickCotizacion(numero) {
    const match = (cotizaciones || []).find((c) => String(c?.numero || "").trim().toLocaleUpperCase() === String(numero || "").trim().toLocaleUpperCase());
    if (match) onChange(informeDraftDesdeCotizacion(v, match));
    else set("cotizacionNumero", numero);
  }
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
  function pickCliente(nombre) {
    const nombreUpper = nombre.toUpperCase();
    // Si el nombre coincide exactamente con un contacto guardado (sea porque se
    // escribió igual o porque se eligió del desplegable), se cargan en automático
    // su dirección y teléfono. Si no coincide (cliente nuevo, no está en Contactos),
    // solo se actualiza el nombre y ubicación/teléfono quedan como estén.
    const match = contactos.find((c) => (c.contacto || "").trim().toUpperCase() === nombreUpper.trim());
    if (match) {
      onChange({ ...v, cliente: nombreUpper, ubicacion: (match.direccion || "").toUpperCase(), telefono: match.telefono || "" });
    } else {
      onChange({ ...v, cliente: nombreUpper });
    }
  }
  const inputRow = { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 10 };
  return (
    <div>
      {permitirCotizacionOrigen && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Cotización de referencia (opcional, extrae los datos)</div>
          <OCSelector value={v.cotizacionNumero} onChange={pickCotizacion} options={cotizacionOptions} placeholder="Seleccionar o buscar cotización…" />
        </div>
      )}
      <div style={inputRow}>
        <div>
          <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Código</div>
          <input className="ct-input2" value={v.codigo} onChange={(e) => set("codigo", e.target.value)} placeholder="IT-001" />
        </div>
        <div>
          <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Versión</div>
          <input className="ct-input2" value={v.version} onChange={(e) => set("version", e.target.value)} placeholder="01" />
        </div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Cliente</div>
        <OCSelector value={v.cliente} onChange={pickCliente} options={contactoOptions} placeholder="MANTENIMIENTO Y SERVICIOS GENERALES" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Ubicación</div>
          <input className="ct-input2" value={v.ubicacion} onChange={(e) => set("ubicacion", e.target.value.toUpperCase())} placeholder="SAN ISIDRO" />
        </div>
        <div>
          <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Teléfono</div>
          <input className="ct-input2" value={v.telefono} onChange={(e) => set("telefono", e.target.value)} placeholder="999 999 999" />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Fecha de Visita</div>
          <input type="date" className="ct-input2" value={v.fechaVisita} onChange={(e) => set("fechaVisita", e.target.value)} />
        </div>
        <div>
          <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Fecha de Inicio</div>
          <input type="date" className="ct-input2" value={v.fechaInicio} onChange={(e) => set("fechaInicio", e.target.value)} />
        </div>
        <div>
          <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Fecha de Fin</div>
          <input type="date" className="ct-input2" value={v.fechaFin} onChange={(e) => set("fechaFin", e.target.value)} />
        </div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Orden de Compra</div>
        <OCSelector value={v.ordenCompra} onChange={(val) => set("ordenCompra", val)} options={ocOptions} placeholder="Seleccionar OC de Control de Trabajo…" />
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Objetivo del servicio</div>
        <textarea className="ct-input2" rows={3} value={v.objetivo} onChange={(e) => set("objetivo", e.target.value)} style={{ resize: "vertical" }} placeholder="Realizar el reemplazo de..." />
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Descripción del trabajo realizado</div>
        <textarea className="ct-input2" rows={4} value={v.descripcion} onChange={(e) => set("descripcion", e.target.value)} style={{ resize: "vertical" }} placeholder="Durante la inspección se evidenció que..." />
      </div>

      <ListaEditable label="Trabajos ejecutados" placeholder="Se realizó el cierre del suministro de agua..." items={v.trabajos} onChange={(next) => set("trabajos", next)} addLabel="Agregar paso" />

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 6 }}>Evidencia fotográfica ({(v.fotos || []).length})</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(90px,1fr))", gap: 8, marginBottom: 8 }}>
          {(v.fotos || []).map((f, i) => (
            <FotoTile
              key={f.id}
              foto={f}
              index={i}
              onQuitar={() => onQuitarFoto(i)}
              onRenombrar={(nombre) => onRenombrarFoto(i, nombre)}
              onSubirEnEspacio={(file) => onSubirFotoEnEspacio(i, file)}
              puedeAdjuntar={puedeAdjuntar}
            />
          ))}
        </div>
        {puedeAdjuntar && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label className="ct-filebtn">
              {subiendoFoto ? "Subiendo…" : "📷 Agregar fotos"}
              <input type="file" accept="image/*" multiple disabled={subiendoFoto} onChange={(e) => { onSubirFotos(e.target.files); e.target.value = ""; }} style={{ display: "none" }} />
            </label>
            <label className="ct-filebtn">
              {subiendoFoto ? "Subiendo…" : "📸 Tomar foto"}
              <input type="file" accept="image/*" capture="environment" disabled={subiendoFoto} onChange={(e) => { onSubirFotos(e.target.files); e.target.value = ""; }} style={{ display: "none" }} />
            </label>
            <button type="button" onClick={onAgregarEspacioFoto} style={{ background: "transparent", border: `1px dashed ${COLORS.border}`, color: COLORS.dim, borderRadius: 6, padding: "5px 10px", fontSize: 11.5, cursor: "pointer" }}>+ Nombrar foto antes de subirla</button>
          </div>
        )}
      </div>

      <ListaEditable label="Observaciones y hallazgos" placeholder="Realizar inspecciones periódicas..." items={v.observaciones} onChange={(next) => set("observaciones", next)} addLabel="Agregar observación" />

      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Recomendaciones</div>
        <textarea className="ct-input2" rows={3} value={v.comentarios} onChange={(e) => set("comentarios", e.target.value)} style={{ resize: "vertical" }} placeholder="Se concluye que el servicio fue ejecutado satisfactoriamente..." />
      </div>
    </div>
  );
}

function FotosMiniGrid({ label, fotos, subiendo, onSubir, onQuitar, onRenombrar, onAgregarEspacio, onSubirEnEspacio, puedeAdjuntar = true }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 6 }}>{label} ({(fotos || []).length})</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(90px,1fr))", gap: 8, marginBottom: 8 }}>
        {(fotos || []).map((f, i) => (
          <FotoTile
            key={f.id}
            foto={f}
            index={i}
            onQuitar={() => onQuitar(i)}
            onRenombrar={(nombre) => onRenombrar(i, nombre)}
            onSubirEnEspacio={(file) => onSubirEnEspacio(i, file)}
            puedeAdjuntar={puedeAdjuntar}
          />
        ))}
      </div>
      {puedeAdjuntar && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label className="ct-filebtn">
            {subiendo ? "Subiendo…" : "📷 Agregar fotos"}
            <input type="file" accept="image/*" multiple disabled={subiendo} onChange={(e) => { onSubir(e.target.files); e.target.value = ""; }} style={{ display: "none" }} />
          </label>
          <label className="ct-filebtn">
            {subiendo ? "Subiendo…" : "📸 Tomar foto"}
            <input type="file" accept="image/*" capture="environment" disabled={subiendo} onChange={(e) => { onSubir(e.target.files); e.target.value = ""; }} style={{ display: "none" }} />
          </label>
          <button type="button" onClick={onAgregarEspacio} style={{ background: "transparent", border: `1px dashed ${COLORS.border}`, color: COLORS.dim, borderRadius: 6, padding: "5px 10px", fontSize: 11.5, cursor: "pointer" }}>+ Nombrar foto antes de subirla</button>
        </div>
      )}
    </div>
  );
}

function InformeInfraForm({ value, onChange, subiendoFoto, onSubirFotos, onQuitarFoto, onRenombrarFoto, onAgregarEspacioFoto, onSubirFotoEnEspacio, ocOptions = [], puedeAdjuntar = true, cotizaciones = [], permitirCotizacionOrigen = false }) {
  const v = value;
  function set(k, val) { onChange({ ...v, [k]: val }); }
  const isMobile = useIsMobile();
  const cotizacionOptions = useMemo(() => {
    const seen = new Set();
    const list = [];
    (cotizaciones || []).slice().sort((a, b) => String(b?.numero || "").localeCompare(String(a?.numero || ""))).forEach((c) => {
      const numero = String(c?.numero || "").trim();
      if (!numero) return;
      const k = numero.toLocaleLowerCase();
      if (seen.has(k)) return;
      seen.add(k); list.push({ value: numero, label: `${numero} — ${c.solicitud || "sin solicitud/proyecto"}` });
    });
    return list;
  }, [cotizaciones]);
  function pickCotizacion(numero) {
    const match = (cotizaciones || []).find((c) => String(c?.numero || "").trim().toLocaleUpperCase() === String(numero || "").trim().toLocaleUpperCase());
    if (match) onChange(informeDraftDesdeCotizacion(v, match));
    else set("cotizacionNumero", numero);
  }
  const inputRow = { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 10 };
  return (
    <div>
      {permitirCotizacionOrigen && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Cotización de referencia (opcional, extrae los datos)</div>
          <OCSelector value={v.cotizacionNumero} onChange={pickCotizacion} options={cotizacionOptions} placeholder="Seleccionar o buscar cotización…" />
        </div>
      )}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Nombre del proyecto</div>
        <input className="ct-input2" value={v.proyecto} onChange={(e) => set("proyecto", e.target.value.toUpperCase())} placeholder="REUBICACION DE TOPES DE SOTANO - UPC SAN ISIDRO" />
      </div>
      <div style={inputRow}>
        <div>
          <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Del (fecha inicio)</div>
          <input type="date" className="ct-input2" value={v.fechaInicio} onChange={(e) => set("fechaInicio", e.target.value)} />
        </div>
        <div>
          <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Al (fecha fin)</div>
          <input type="date" className="ct-input2" value={v.fechaFin} onChange={(e) => set("fechaFin", e.target.value)} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}># de Proyecto</div>
          <input className="ct-input2" value={v.numeroProyecto} onChange={(e) => set("numeroProyecto", e.target.value)} />
        </div>
        <div>
          <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Proveedor</div>
          <input className="ct-input2" value={v.proveedor} onChange={(e) => set("proveedor", e.target.value.toUpperCase())} />
        </div>
        <div>
          <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Orden de Compra</div>
          <OCSelector value={v.ordenCompra} onChange={(val) => set("ordenCompra", val)} options={ocOptions} placeholder="Seleccionar OC de Control de Trabajo…" />
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Descripción de Proyecto</div>
        <textarea className="ct-input2" rows={3} value={v.descripcionProyecto} onChange={(e) => set("descripcionProyecto", e.target.value)} style={{ resize: "vertical" }} />
      </div>

      <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.text, marginBottom: 8 }}>Inicio de Obra</div>
        <textarea className="ct-input2" rows={3} value={v.inicioObraTexto} onChange={(e) => set("inicioObraTexto", e.target.value)} style={{ resize: "vertical", marginBottom: 10 }} placeholder="Descripción del estado al inicio de la obra…" />
        <FotosMiniGrid label="Fotos — Inicio de Obra" fotos={v.inicioObraFotos} subiendo={subiendoFoto} onSubir={(files) => onSubirFotos("inicioObraFotos", files)} onQuitar={(i) => onQuitarFoto("inicioObraFotos", i)} onRenombrar={(i, nombre) => onRenombrarFoto("inicioObraFotos", i, nombre)} onAgregarEspacio={() => onAgregarEspacioFoto("inicioObraFotos")} onSubirEnEspacio={(i, file) => onSubirFotoEnEspacio("inicioObraFotos", i, file)} puedeAdjuntar={puedeAdjuntar} />
      </div>

      <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.text, marginBottom: 8 }}>Avance Final</div>
        <textarea className="ct-input2" rows={3} value={v.avanceFinalTexto} onChange={(e) => set("avanceFinalTexto", e.target.value)} style={{ resize: "vertical", marginBottom: 10 }} placeholder="Descripción del avance final…" />
        <FotosMiniGrid label="Fotos — Avance Final" fotos={v.avanceFinalFotos} subiendo={subiendoFoto} onSubir={(files) => onSubirFotos("avanceFinalFotos", files)} onQuitar={(i) => onQuitarFoto("avanceFinalFotos", i)} onRenombrar={(i, nombre) => onRenombrarFoto("avanceFinalFotos", i, nombre)} onAgregarEspacio={() => onAgregarEspacioFoto("avanceFinalFotos")} onSubirEnEspacio={(i, file) => onSubirFotoEnEspacio("avanceFinalFotos", i, file)} puedeAdjuntar={puedeAdjuntar} />
      </div>

      <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.text, marginBottom: 8 }}>Firmas (nombre de quien firma)</div>
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Proveedor</div>
          <input className="ct-input2" value={v.firmaProveedor} onChange={(e) => set("firmaProveedor", e.target.value)} />
        </div>
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Gerente de Proyectos de Infraestructura o Coordinador Remodelaciones</div>
          <input className="ct-input2" value={v.firmaGerente} onChange={(e) => set("firmaGerente", e.target.value)} />
        </div>
        <div>
          <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: 4 }}>Director de Real Estate</div>
          <input className="ct-input2" value={v.firmaDirector} onChange={(e) => set("firmaDirector", e.target.value)} />
        </div>
      </div>
    </div>
  );
}

function ControlInformes({ isAdmin = false, puedeEditar = true, puedeAgregar = true, puedeEliminar = true, puedeExportar = true, puedeAdjuntar = true, puedeAprobar = false, me = "", ownerIdentity = "", puedeVerTodos = true } = {}) {
  const sustentoGate = useSustentoGate();
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [syncState, setSyncState] = useState("pendiente");
  const [search, setSearch] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");

  const [showTipoPicker, setShowTipoPicker] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [draftAdd, setDraftAdd] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [draftEdit, setDraftEdit] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [generandoPdf, setGenerandoPdf] = useState(null);
  const [pdfViewer, setPdfViewer] = useState(null); // { url, fileName, doc } | null
  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [ocOptions, setOcOptions] = useState([]);
  const [contactos, setContactos] = useState([]);
  const [cotizaciones, setCotizaciones] = useState([]);

  useEffect(() => {
    let cancelado = false;
    async function cargarContactos() {
      try {
        const res = await window.storage.get(STORAGE_KEY_CONTACTOS, true);
        const data = JSON.parse(res.value);
        if (!cancelado) setContactos(Array.isArray(data) ? data : []);
      } catch (e) { if (!cancelado) setContactos([]); console.error("cargarContactos (informes): fallo la carga", e); }
    }
    cargarContactos();
    const onVisible = () => { if (document.visibilityState === "visible") cargarContactos(); };
    document.addEventListener("visibilitychange", onVisible);
    const intervalId = setInterval(cargarContactos, 60000);
    return () => { cancelado = true; document.removeEventListener("visibilitychange", onVisible); clearInterval(intervalId); };
  }, []);

  useEffect(() => {
    let cancelado = false;
    async function cargarOrdenesCompra() {
      try {
        const res = await window.storage.get(STORAGE_KEY_RECORDS, true);
        const raw = JSON.parse(res.value);
        const records = Array.isArray(raw) ? raw : [];
        const ordered = records.filter((r) => String(r?.oc || "").trim()).sort((a, b) => (Number(b?.n) || 0) - (Number(a?.n) || 0));
        if (!cancelado) setOcOptions(buildOcOptions(ordered));
      } catch (e) { if (!cancelado) setOcOptions([]); console.error("cargarOrdenesCompra (informes): fallo la carga", e); }
    }
    cargarOrdenesCompra();
    const onTrabajosChanged = () => cargarOrdenesCompra();
    const onVisible = () => { if (document.visibilityState === "visible") cargarOrdenesCompra(); };
    window.addEventListener("wilarcon:trabajos-changed", onTrabajosChanged);
    document.addEventListener("visibilitychange", onVisible);
    const intervalId = setInterval(cargarOrdenesCompra, 60000);
    return () => {
      cancelado = true;
      window.removeEventListener("wilarcon:trabajos-changed", onTrabajosChanged);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    let cancelado = false;
    async function cargarCotizaciones() {
      try {
        const res = await window.storage.get(STORAGE_KEY_COTIZACIONES, true);
        const data = JSON.parse(res.value);
        if (!cancelado) setCotizaciones(Array.isArray(data) ? data : []);
      } catch (e) { if (!cancelado) setCotizaciones([]); console.error("cargarCotizaciones (informes): fallo la carga", e); }
    }
    cargarCotizaciones();
    const onVisible = () => { if (document.visibilityState === "visible") cargarCotizaciones(); };
    document.addEventListener("visibilitychange", onVisible);
    const intervalId = setInterval(cargarCotizaciones, 60000);
    return () => { cancelado = true; document.removeEventListener("visibilitychange", onVisible); clearInterval(intervalId); };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    setIsMobile(mq.matches);
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener ? mq.addEventListener("change", onChange) : mq.addListener(onChange);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", onChange) : mq.removeListener(onChange); };
  }, []);

  useEffect(() => {
    let cancelado = false;
    async function loadItems() {
      try {
        const res = await window.storage.get(STORAGE_KEY_INFORMES, true);
        const data = JSON.parse(res.value);
        if (cancelado) return;
        setItems(Array.isArray(data) ? data : []);
        setSyncState("ok");
      } catch (e) {
        if (cancelado) return;
        setItems([]);
        setSyncState(classifySyncError(e));
      }
      setLoading(false);
    }
    loadItems();
    const onPropuestasChanged = () => loadItems();
    window.addEventListener("wilarcon:propuestas-changed", onPropuestasChanged);
    return () => { cancelado = true; window.removeEventListener("wilarcon:propuestas-changed", onPropuestasChanged); };
  }, []);

  async function persist(next, intent) {
    if (typeof next === "function") {
      try {
        const applied = await mutateStorageJSON(STORAGE_KEY_INFORMES, [], (current) => next(Array.isArray(current) ? current : []), 4, intent);
        setItems(applied);
        setSyncState("ok");
        return applied;
      } catch (e) {
        console.error(e);
        setSyncState(classifySyncError(e));
        alert("No se pudo guardar el cambio: otro usuario modificó estos registros al mismo tiempo y los reintentos automáticos no lograron aplicarlo. Recarga la página e inténtalo de nuevo.");
        return;
      }
    }
    setItems(next);
    try { await window.storage.set(STORAGE_KEY_INFORMES, JSON.stringify(next), { intent }); setSyncState("ok"); } catch (e) { console.error(e); setSyncState(classifySyncError(e)); }
  }

  const itemsVisibles = useMemo(() => (
    puedeVerTodos ? (items || []) : filterOwnRecords(items || [], ownerIdentity, "creadoPor")
  ), [items, puedeVerTodos, ownerIdentity]);

  const filtered = useMemo(() => {
    let list = itemsVisibles;
    if (filtroTipo) list = list.filter((i) => i.tipo === filtroTipo);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((i) => [i.codigo, i.cliente, i.ubicacion, i.descripcion, i.proyecto, i.proveedor, i.numeroProyecto].some((v) => (v || "").toLowerCase().includes(q)));
    return [...list].sort((a, b) => (b.actualizadoEn || 0) - (a.actualizadoEn || 0));
  }, [itemsVisibles, search, filtroTipo]);

  const kpis = useMemo(() => {
    const list = itemsVisibles;
    const tecnico = list.filter((i) => i.tipo !== "infraestructura").length;
    const infraestructura = list.filter((i) => i.tipo === "infraestructura").length;
    return { total: list.length, tecnico, infraestructura };
  }, [itemsVisibles]);

  function toggleFiltroTipo(tipo) {
    setFiltroTipo((prev) => (prev === tipo ? "" : tipo));
  }

  function openAdd() { if (!puedeAgregar) return; setShowTipoPicker(true); }
  function elegirTipo(tipo) {
    setShowTipoPicker(false);
    if (tipo === "infraestructura") {
      setDraftAdd({
        ...emptyInformeInfraDraft(),
        id: uid(),
        codigo: siguienteCodigoInforme(items || [], "infraestructura"),
        numeroProyecto: siguienteNumeroProyecto(items || []),
        proveedor: "WILARCON",
      });
    } else {
      setDraftAdd({ ...emptyInformeDraft(), id: uid(), codigo: siguienteCodigoInforme(items || [], "tecnico") });
    }
    setShowAdd(true);
  }
  // Guardado silencioso del informe nuevo: la primera vez que dispara el autoguardado crea el
  // registro; las siguientes veces lo actualiza directo (igual que antes con "Guardar": crear
  // un informe nuevo nunca pasa por el flujo de aprobación, solo editar uno ya existente).
  async function guardarNuevoInformeSilencioso(current) {
    const existeActual = (items || []).some((i) => i.id === current.id);
    const rec = { ...current, creadoPor: current.creadoPor || me, actualizadoEn: Date.now() };
    if (existeActual) {
      await persist((list) => list.map((i) => (i.id === rec.id ? rec : i)), "editar");
    } else {
      await persist((list) => [rec, ...list], "crear");
    }
  }
  const autoSaveNuevoInforme = useAutoSaveDebounced({
    active: showAdd && puedeAgregar,
    draft: draftAdd,
    saveFn: guardarNuevoInformeSilencioso,
  });
  async function cerrarAddInforme() { await autoSaveNuevoInforme(); setShowAdd(false); setDraftAdd(null); }
  function duplicar(i) {
    if (!puedeAgregar) return;
    const copia = JSON.parse(JSON.stringify(i));
    copia.id = uid();
    copia.codigo = siguienteCodigoInforme(items || [], i.tipo);
    setDraftAdd(copia);
    setShowAdd(true);
  }
  // Sustento en caché por sesión de edición: evita pedirlo de nuevo en cada autoguardado
  // sucesivo del mismo registro (ver misma lógica en page-visitas.jsx).
  const sustentoEditRef = useRef(null);
  function openEdit(r) { if (!puedeEditar) return; sustentoEditRef.current = null; setEditingId(r.id); setDraftEdit({ ...r }); }
  async function persistEditInforme(draftToSave) {
    const propuesto = { ...draftToSave, actualizadoEn: Date.now() };
    const original = (items || []).find((i) => i.id === editingId);
    await intentarGuardarConAprobacion({
      puedeAprobar, modulo: "informes", moduloLabel: "Informes",
      storageKey: STORAGE_KEY_INFORMES, idField: "id", recordId: editingId,
      original, propuesto, autor: me,
      labels: { codigo: "Código", cliente: "Cliente", ubicacion: "Ubicación", telefono: "Teléfono", objetivo: "Objetivo", descripcion: "Descripción", proyecto: "Proyecto", proveedor: "Proveedor", numeroProyecto: "# de Proyecto", ordenCompra: "Orden de Compra", descripcionProyecto: "Descripción de Proyecto" },
      persistDirecto: (intent) => persist((current) => current.map((i) => (i.id === editingId ? propuesto : i)), intent),
      pedirSustento: sustentoGate.solicitar,
      sustentoRef: sustentoEditRef,
    });
  }
  // Autoguardado: guarda lo editado si el usuario cambia de pestaña, oculta la
  // ventana o cierra el formulario sin apretar "Guardar".
  const autoSaveEditInforme = useAutoSaveDebounced({
    active: !!editingId && puedeEditar,
    draft: draftEdit,
    saveFn: persistEditInforme,
  });
  async function cerrarEditInforme() { await autoSaveEditInforme(); sustentoEditRef.current = null; setEditingId(null); setDraftEdit(null); }
  async function doDelete(id) {
    if (!puedeEliminar) return;
    const registro = (items || []).find((i) => i.id === id);
    await intentarEliminarConAprobacion({
      puedeAprobar, modulo: "informes", moduloLabel: "Informes",
      storageKey: STORAGE_KEY_INFORMES, idField: "id", recordId: id, autor: me,
      resumen: registro ? `${registro.codigo || ""} — ${registro.tipo === "infraestructura" ? (registro.proveedor || "") : (registro.cliente || "")}` : `registro ${id}`,
      persistDirecto: (intent) => persist((current) => current.filter((i) => i.id !== id), intent),
      pedirSustento: sustentoGate.solicitar,
    });
    setConfirmDelete(null);
  }

  async function subirFotos(fileList, draft, setDraft, campo = "fotos") {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setSubiendoFoto(true);
    try {
      const nuevas = [];
      for (const file of files) {
        try {
          const { dataUrl, width, height } = await resizeImageFile(file);
          const driveFileId = await subirFotoADrive(dataUrl, file.name);
          nuevas.push({ id: uid(), driveFileId, width, height });
        } catch (e) {
          console.error(e);
          alert("No se pudo subir una de las fotos. Revisa tu conexión e inténtalo de nuevo.");
        }
      }
      setDraft((prev) => ({ ...prev, [campo]: [...(prev[campo] || []), ...nuevas] }));
    } finally {
      setSubiendoFoto(false);
    }
  }
  function quitarFoto(idx, draft, setDraft, campo = "fotos") {
    setDraft((prev) => {
      const foto = (prev[campo] || [])[idx];
      if (foto && foto.driveFileId) eliminarFotoDrive(foto.driveFileId);
      return { ...prev, [campo]: (prev[campo] || []).filter((_, i) => i !== idx) };
    });
  }
  function agregarEspacioFoto(draft, setDraft, campo = "fotos") {
    setDraft((prev) => {
      const list = prev[campo] || [];
      return { ...prev, [campo]: [...list, { id: uid(), nombre: `Fotografía ${list.length + 1}`, dataUrl: null, width: 0, height: 0 }] };
    });
  }
  function renombrarFoto(idx, nombre, draft, setDraft, campo = "fotos") {
    setDraft((prev) => ({ ...prev, [campo]: (prev[campo] || []).map((f, i) => (i === idx ? { ...f, nombre } : f)) }));
  }
  async function subirFotoEnEspacio(idx, file, draft, setDraft, campo = "fotos") {
    if (!file) return;
    setSubiendoFoto(true);
    try {
      const { dataUrl, width, height } = await resizeImageFile(file);
      const driveFileId = await subirFotoADrive(dataUrl, file.name);
      setDraft((prev) => ({ ...prev, [campo]: (prev[campo] || []).map((f, i) => (i === idx ? { ...f, driveFileId, width, height } : f)) }));
    } catch (e) {
      console.error(e);
      alert("No se pudo subir la foto. Revisa tu conexión e inténtalo de nuevo.");
    }
    finally { setSubiendoFoto(false); }
  }

  async function verPdf(informe) {
    setGenerandoPdf(informe.id);
    try {
      const builder = informe.tipo === "infraestructura" ? buildInformeInfraPdf : buildInformePdf;
      const { doc, fileName } = await builder(informe, { download: false });
      const url = doc.output("bloburl");
      setPdfViewer((prev) => {
        if (prev) { try { URL.revokeObjectURL(prev.url); } catch (e) { console.error(e); } }
        return { url, fileName, doc };
      });
    } catch (e) {
      console.error(e);
      alert("Ocurrió un error al generar el PDF. Intenta nuevamente.");
    } finally {
      setGenerandoPdf(null);
    }
  }

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

  function sheetsInformes() {
    return [{
      name: "Informes",
      records: filtered,
      headers: ["Código", "Tipo", "Cliente/Proveedor", "Ubicación/Proyecto", "Fecha", "Detalle 1", "Detalle 2", "N° Fotos", "Creado por"],
      rowMapper: (i) => {
        const esInfra = i.tipo === "infraestructura";
        return [
          i.codigo,
          esInfra ? "Infraestructura" : "Técnico",
          esInfra ? i.proveedor : i.cliente,
          esInfra ? i.proyecto : i.ubicacion,
          esInfra ? (fmtDate(i.fechaInicio) || i.fechaInicio) : (fmtDate(i.fechaVisita) || i.fechaVisita),
          esInfra ? i.numeroProyecto : i.objetivo,
          esInfra ? i.ordenCompra : i.descripcion,
          esInfra ? ((i.inicioObraFotos || []).length + (i.avanceFinalFotos || []).length) : (i.fotos || []).length,
          i.creadoPor,
        ];
      },
    }];
  }
  async function exportXlsx() {
    setExportingXlsx(true);
    try {
      await downloadXlsxWorkbook(
        sheetsInformes(),
        "informes"
      );
    } catch (e) {
      console.error("exportXlsx error", e);
      alert("Ocurrió un error al generar la descarga. Intenta nuevamente.");
    } finally {
      setExportingXlsx(false);
    }
  }
  const carpetaLocal = useCarpetaLocal("informes");
  // Igual que en Visita Técnica: la copia en carpeta local guarda el PDF de cada informe (el
  // mismo que arma "Ver/exportar PDF", eligiendo el generador según informe.tipo) en vez de un
  // Excel resumen.
  async function pdfsInformesParaCarpetaLocal() {
    const archivos = [];
    for (const informe of filtered) {
      try {
        const builder = informe.tipo === "infraestructura" ? buildInformeInfraPdf : buildInformePdf;
        const { doc, fileName } = await builder(informe, { download: false });
        archivos.push({ nombre: fileName, arrayBuffer: doc.output("arraybuffer") });
      } catch (e) {
        console.error("[carpeta local informes] no se pudo generar el PDF de", informe.codigo, e);
      }
    }
    return archivos;
  }
  useEffect(() => {
    if (!items) return;
    carpetaLocal.programarGuardado(null, pdfsInformesParaCarpetaLocal, 1200, "pdfs");
  }, [items]);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: COLORS.dim, fontFamily: "'Inter',sans-serif" }}>Cargando…</div>;

  return (
    <div style={{ background: COLORS.bg, color: COLORS.text, fontFamily: "'Inter',sans-serif", fontSize: 13, padding: isMobile ? 10 : 16, borderRadius: 14 }}>
      <style>{`
        .ct-th { position: sticky; top: 0; background: ${COLORS.panel2}; text-align: left; padding: 9px 10px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .5px; color: ${COLORS.dim}; border-bottom: 1px solid ${COLORS.border}; white-space: nowrap; }
        .ct-td { padding: 8px 10px; border-bottom: 1px solid ${COLORS.grid}; vertical-align: middle; }
        .ct-row:hover { background: rgba(77,141,184,.07); cursor: pointer; }
        .ct-scroll::-webkit-scrollbar { height: 8px; width: 8px; }
        .ct-scroll::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 4px; }
        .ct-input2 { width: 100%; background: ${COLORS.panel2}; border: 1px solid ${COLORS.border}; color: ${COLORS.text}; font-family: 'Inter',sans-serif; font-size: 12.5px; padding: 7px 9px; border-radius: 6px; outline: none; box-sizing: border-box; }
        .ct-input2:focus { border-color: ${COLORS.amber}; }
        .ct-input2::placeholder { color: ${COLORS.faint}; opacity: 1; }
        .ct-filebtn { display: inline-flex; align-items: center; gap: 6px; background: ${COLORS.panel2}; border: 1px dashed ${COLORS.border}; color: ${COLORS.text}; padding: 8px 14px; border-radius: 7px; font-size: 12.5px; cursor: pointer; }
        .ct-filebtn:hover { border-color: ${COLORS.amber}; color: ${COLORS.amber}; }
      `}</style>

      <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "center", justifyContent: "space-between", background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "14px 18px", marginBottom: 14, flexWrap: "wrap", gap: 12, flexDirection: isMobile ? "column" : "row" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src={LOGO_SHIELD} alt="Operaciones" style={{ width: 40, height: "auto", flexShrink: 0, display: "block" }} />
          <div>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 16, fontWeight: 600 }}>INFORMES</div>
            <div style={{ fontSize: 11, color: COLORS.dim, display: "flex", alignItems: "center", gap: 4 }}>
              Base de datos compartida en vivo
              <SyncDot syncState={syncState} palette={COLORS} />
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 18 }}>
        <Kpi label="Total" value={String(kpis.total)} tone="blue" title="Total de informes registrados." />
        <Kpi label="Informe Técnico" value={String(kpis.tecnico)} tone="blue" title="Informes técnicos registrados. Clic para filtrar." onClick={() => toggleFiltroTipo("tecnico")} active={filtroTipo === "tecnico"} />
        <Kpi label="Informe de Infraestructura" value={String(kpis.infraestructura)} tone="amber" title="Informes de infraestructura registrados. Clic para filtrar." onClick={() => toggleFiltroTipo("infraestructura")} active={filtroTipo === "infraestructura"} />
      </div>

      <FilterBar>
        <input className="ct-input2" placeholder="Buscar código, cliente, ubicación…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 280 }} />
        {filtroTipo && <ClearFiltersButton onClick={() => setFiltroTipo("")} />}
        <div style={{ marginLeft: isMobile ? 0 : "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {puedeExportar && (
            <button
              onClick={exportXlsx}
              disabled={exportingXlsx}
              title="Descarga en un archivo Excel la información de esta página"
              style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.text, fontWeight: 600, padding: "8px 14px", borderRadius: 7, fontSize: 12.5, cursor: exportingXlsx ? "not-allowed" : "pointer", opacity: exportingXlsx ? 0.6 : 1 }}
            >
              {exportingXlsx ? "Generando…" : "⬇ Excel"}
            </button>
          )}
          {puedeExportar && <BotonCarpetaLocal carpeta={carpetaLocal} formato="pdf" />}
          {puedeAgregar && (
            <button onClick={openAdd} style={{ display: "flex", alignItems: "center", gap: 6, background: COLORS.amber, color: COLORS.amberText, fontWeight: 600, fontSize: 12.5, padding: "8px 14px", borderRadius: 7, border: "none", cursor: "pointer" }}>
              + Nuevo informe
            </button>
          )}
        </div>
      </FilterBar>

      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "16px 18px" }}>
        <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13.5, fontWeight: 600, marginBottom: 12 }}>Registros ({filtered.length})</h2>
        {filtered.length === 0 && <div style={{ textAlign: "center", color: COLORS.faint, padding: 30 }}>Sin resultados</div>}
        {filtered.length > 0 && (
          <div className="ct-scroll" style={{ overflowX: "auto", border: `1px solid ${COLORS.border}`, borderRadius: 9 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", background: COLORS.panel }}>
              <thead>
                <tr>
                  <th className="ct-th">Código</th>
                  <th className="ct-th">Tipo</th>
                  <th className="ct-th">Cliente / Proveedor</th>
                  <th className="ct-th">Ubicación / Proyecto</th>
                  <th className="ct-th">Fecha</th>
                  <th className="ct-th" style={{ width: 220 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => {
                  const esInfra = i.tipo === "infraestructura";
                  return (
                  <tr key={i.id} className="ct-row" onClick={() => openEdit(i)}>
                    <td className="ct-td" style={{ fontWeight: 600, color: COLORS.blue }}>{i.codigo || "—"}</td>
                    <td className="ct-td">
                      <span style={{ fontSize: 10.5, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: esInfra ? "rgba(230,150,60,.15)" : "rgba(77,141,184,.15)", color: esInfra ? COLORS.amber : COLORS.blue }}>
                        {esInfra ? "INFRAESTRUCTURA" : "TÉCNICO"}
                      </span>
                    </td>
                    <td className="ct-td">{(esInfra ? i.proveedor : i.cliente) || "—"}</td>
                    <td className="ct-td" style={{ color: COLORS.dim }}>{(esInfra ? i.proyecto : i.ubicacion) || "—"}</td>
                    <td className="ct-td" style={{ color: COLORS.dim }}>{esInfra ? (fmtDate(i.fechaInicio) || i.fechaInicio || "—") : (fmtDate(i.fecha) || i.fecha || "—")}</td>
                    <td className="ct-td" onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {puedeAgregar && <IconBtn title="Duplicar" onClick={() => duplicar(i)}>Duplicar</IconBtn>}
                      <IconBtn title="Ver / exportar PDF" disabled={generandoPdf === i.id} onClick={() => verPdf(i)}>
                        {generandoPdf === i.id ? "Generando…" : "PDF"}
                      </IconBtn>
                      {puedeEliminar && <IconBtn title="Eliminar" danger onClick={() => setConfirmDelete(i.id)}>Eliminar</IconBtn>}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showTipoPicker && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }} onClick={() => setShowTipoPicker(false)}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 18, width: 360, maxWidth: "94vw" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, marginBottom: 14 }}>¿Qué tipo de informe quieres crear?</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button onClick={() => elegirTipo("tecnico")} style={{ textAlign: "left", background: COLORS.panel2, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: 8, padding: "12px 14px", cursor: "pointer" }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>Informe Técnico</div>
                <div style={{ fontSize: 11, color: COLORS.dim, marginTop: 2 }}>Reporte de servicio con objetivo, descripción, trabajos ejecutados y evidencia fotográfica.</div>
              </button>
              <button onClick={() => elegirTipo("infraestructura")} style={{ textAlign: "left", background: COLORS.panel2, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: 8, padding: "12px 14px", cursor: "pointer" }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>Informe Infraestructura</div>
                <div style={{ fontSize: 11, color: COLORS.dim, marginTop: 2 }}>Reporte de avance de obra: datos de proyecto/proveedor/OC, inicio de obra y avance final con firmas.</div>
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button onClick={() => setShowTipoPicker(false)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, borderRadius: 7, padding: "7px 14px", fontSize: 12.5, cursor: "pointer" }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {showAdd && draftAdd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }} onClick={cerrarAddInforme}>
          <div className="ct-scroll" style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 18, width: 620, maxWidth: "94vw", maxHeight: "88vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>{draftAdd.tipo === "infraestructura" ? "Nuevo informe de infraestructura" : "Nuevo informe técnico"}</div>
              {draftAdd.cotizacionNumero && (
                <span style={{ fontSize: 10.5, fontWeight: 600, color: COLORS.dim, background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "2px 9px" }}>
                  📋 {draftAdd.cotizacionNumero}{draftAdd.cotizacionSolicitud ? ` — ${draftAdd.cotizacionSolicitud}` : ""}
                </span>
              )}
            </div>
            {draftAdd.tipo === "infraestructura" ? (
              <InformeInfraForm value={draftAdd} onChange={setDraftAdd} subiendoFoto={subiendoFoto} onSubirFotos={(campo, files) => subirFotos(files, draftAdd, setDraftAdd, campo)} onQuitarFoto={(campo, idx) => quitarFoto(idx, draftAdd, setDraftAdd, campo)} onRenombrarFoto={(campo, idx, nombre) => renombrarFoto(idx, nombre, draftAdd, setDraftAdd, campo)} onAgregarEspacioFoto={(campo) => agregarEspacioFoto(draftAdd, setDraftAdd, campo)} onSubirFotoEnEspacio={(campo, idx, file) => subirFotoEnEspacio(idx, file, draftAdd, setDraftAdd, campo)} ocOptions={ocOptions} puedeAdjuntar={puedeAdjuntar} cotizaciones={cotizaciones} permitirCotizacionOrigen />
            ) : (
              <InformeForm value={draftAdd} onChange={setDraftAdd} subiendoFoto={subiendoFoto} onSubirFotos={(files) => subirFotos(files, draftAdd, setDraftAdd)} onQuitarFoto={(idx) => quitarFoto(idx, draftAdd, setDraftAdd)} onRenombrarFoto={(idx, nombre) => renombrarFoto(idx, nombre, draftAdd, setDraftAdd)} onAgregarEspacioFoto={() => agregarEspacioFoto(draftAdd, setDraftAdd)} onSubirFotoEnEspacio={(idx, file) => subirFotoEnEspacio(idx, file, draftAdd, setDraftAdd)} contactos={contactos} ocOptions={ocOptions} puedeAdjuntar={puedeAdjuntar} cotizaciones={cotizaciones} permitirCotizacionOrigen />
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 14 }}>
              <span style={{ color: COLORS.faint, fontSize: 11.5 }}>Guardado automático</span>
              <button onClick={cerrarAddInforme} style={{ background: COLORS.amber, color: COLORS.amberText, border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {editingId && draftEdit && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }} onClick={cerrarEditInforme}>
          <div className="ct-scroll" style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 18, width: 620, maxWidth: "94vw", maxHeight: "88vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>{draftEdit.tipo === "infraestructura" ? "Editar informe de infraestructura" : "Editar informe técnico"}</div>
              {draftEdit.cotizacionNumero && (
                <span style={{ fontSize: 10.5, fontWeight: 600, color: COLORS.dim, background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "2px 9px" }}>
                  📋 {draftEdit.cotizacionNumero}{draftEdit.cotizacionSolicitud ? ` — ${draftEdit.cotizacionSolicitud}` : ""}
                </span>
              )}
            </div>
            {draftEdit.tipo === "infraestructura" ? (
              <InformeInfraForm value={draftEdit} onChange={setDraftEdit} subiendoFoto={subiendoFoto} onSubirFotos={(campo, files) => subirFotos(files, draftEdit, setDraftEdit, campo)} onQuitarFoto={(campo, idx) => quitarFoto(idx, draftEdit, setDraftEdit, campo)} onRenombrarFoto={(campo, idx, nombre) => renombrarFoto(idx, nombre, draftEdit, setDraftEdit, campo)} onAgregarEspacioFoto={(campo) => agregarEspacioFoto(draftEdit, setDraftEdit, campo)} onSubirFotoEnEspacio={(campo, idx, file) => subirFotoEnEspacio(idx, file, draftEdit, setDraftEdit, campo)} ocOptions={ocOptions} puedeAdjuntar={puedeAdjuntar} />
            ) : (
              <InformeForm value={draftEdit} onChange={setDraftEdit} subiendoFoto={subiendoFoto} onSubirFotos={(files) => subirFotos(files, draftEdit, setDraftEdit)} onQuitarFoto={(idx) => quitarFoto(idx, draftEdit, setDraftEdit)} onRenombrarFoto={(idx, nombre) => renombrarFoto(idx, nombre, draftEdit, setDraftEdit)} onAgregarEspacioFoto={() => agregarEspacioFoto(draftEdit, setDraftEdit)} onSubirFotoEnEspacio={(idx, file) => subirFotoEnEspacio(idx, file, draftEdit, setDraftEdit)} contactos={contactos} ocOptions={ocOptions} puedeAdjuntar={puedeAdjuntar} />
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 14 }}>
              <span style={{ color: COLORS.faint, fontSize: 11.5 }}>Guardado automático</span>
              <button onClick={cerrarEditInforme} style={{ background: COLORS.amber, color: COLORS.amberText, border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setConfirmDelete(null)}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 18, width: 320, maxWidth: "90vw" }} onClick={(e) => e.stopPropagation()} onFocus={scrollFieldIntoViewOnFocus}>
            <div style={{ fontSize: 13.5, color: COLORS.text, marginBottom: 14 }}>¿Eliminar este informe?</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setConfirmDelete(null)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.dim, borderRadius: 7, padding: "7px 14px", fontSize: 12.5, cursor: "pointer" }}>Cancelar</button>
              <button onClick={() => doDelete(confirmDelete)} style={{ background: COLORS.red, color: COLORS.white, border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Eliminar</button>
            </div>
          </div>
        </div>
      )}
      <PdfViewerModal pdf={pdfViewer} onClose={cerrarPdfViewer} />
      {sustentoGate.modal}
    </div>
  );
}

export { InformeForm, InformeInfraForm, ControlInformes };
