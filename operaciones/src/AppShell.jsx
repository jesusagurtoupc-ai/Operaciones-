import { lazy, Suspense, useState, useEffect, useMemo, useRef } from "react";
import * as Core from "./core-common";

const ControlTrabajos = lazy(() => import("./page-trabajos.jsx").then(m => ({ default: m.ControlTrabajos })));
const ControlAsistencia = lazy(() => import("./page-asistencia.jsx").then(m => ({ default: m.ControlAsistencia })));
const TorreControl = lazy(() => import("./page-torre.jsx").then(m => ({ default: m.TorreControl })));
const ContactosCuentas = lazy(() => import("./page-contactos.jsx").then(m => ({ default: m.ContactosCuentas })));
const ControlViaticos = lazy(() => import("./page-viaticos.jsx").then(m => ({ default: m.ControlViaticos })));
const ControlGastos = lazy(() => import("./page-gastos.jsx").then(m => ({ default: m.ControlGastos })));
const ControlCajaChica = lazy(() => import("./page-caja-chica.jsx").then(m => ({ default: m.ControlCajaChica })));
const ControlResponsabilidades = lazy(() => import("./page-responsabilidades.jsx").then(m => ({ default: m.ControlResponsabilidades })));
const ControlCotizaciones = lazy(() => import("./page-cotizacion.jsx").then(m => ({ default: m.ControlCotizaciones })));
const ControlInformes = lazy(() => import("./page-informes.jsx").then(m => ({ default: m.ControlInformes })));
const ControlVisitas = lazy(() => import("./page-visitas.jsx").then(m => ({ default: m.ControlVisitas })));
const Dashboard = lazy(() => import("./page-dashboard.jsx").then(m => ({ default: m.Dashboard })));

const {
  LOGO_SHIELD,
  COLORS,
  reorderWithinFull,
  useRowDrag,
  useIsMobile,
  DragHandle,
  normalizePermissionMatrix,
  hasModulePermission,
  NAV_ITEMS_DEFAULT,
  NAV_ORDER_STORAGE_KEY,
  SESSION_STORAGE_KEY,
  usePropuestasPendientes,
  usePropuestasUsuario,
  marcarPropuestasVistasPorAutor,
  PropuestasPanel,
  MisPropuestasPanel,
  MensajeModal,
  aprobarPropuesta,
  rechazarPropuesta,
  useRevisionesCotizacionPendientes,
  useRevisionesCotizacionUsuario,
  marcarRevisionesCotizacionVistas,
  MisRevisionesCotizacionPanel,
  AprobarRevisionCotizacionModal,
  resolverRevisionCotizacion,
  buildCotizacionPdf,
  STORAGE_KEY_COTIZACIONES,
  fmtFechaHora
} = Core;


export default function App() {
  const [me, setMe] = useState(null);
  const [meTrabajador, setMeTrabajador] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [showPropuestas, setShowPropuestas] = useState(false);
  const [showMisPropuestas, setShowMisPropuestas] = useState(false);
  const [showRevisionesCotizacion, setShowRevisionesCotizacion] = useState(false);
  const [showMisRevisionesCotizacion, setShowMisRevisionesCotizacion] = useState(false);
  const [revisionCotizacionAAprobar, setRevisionCotizacionAAprobar] = useState(null);
  const [openCreateUserOnTorre, setOpenCreateUserOnTorre] = useState(false);
  const [torreBackgroundReady, setTorreBackgroundReady] = useState(false);
  const [mensajeAdmin, setMensajeAdmin] = useState(null);
  const propuestasPendientes = usePropuestasPendientes(isAdmin);
  const misRespuestasPendientes = usePropuestasUsuario(me, !isAdmin && !!me);
  function handleAbrirMisPropuestas() { setShowMisPropuestas(true); }
  function handleCerrarMisPropuestas() {
    setShowMisPropuestas(false);
    marcarPropuestasVistasPorAutor(me);
  }
  async function handleAprobarPropuesta(p) {
    const resultado = await aprobarPropuesta(p.id, me);
    if (!resultado?.ok) {
      if (resultado?.reason === "conflicto") setMensajeAdmin({ tipo: "error", titulo: "No se pudo aprobar", mensaje: "La solicitud no pudo aplicarse porque el registro original ya no existe o cambió de forma incompatible. La solicitud quedó marcada como conflicto." });
      else if (resultado?.reason === "no_pendiente") setMensajeAdmin({ tipo: "error", titulo: "No se pudo aprobar", mensaje: "La solicitud ya fue procesada por otro administrador." });
      else setMensajeAdmin({ tipo: "error", titulo: "No se pudo aprobar", mensaje: "No se pudo aprobar la solicitud. El cambio no fue aplicado." });
    }
  }
  async function handleRechazarPropuesta(p) {
    const motivo = window.prompt("Motivo del rechazo (opcional):", "") || "";
    const resultado = await rechazarPropuesta(p.id, me, motivo);
    if (!resultado?.ok) setMensajeAdmin({ tipo: "error", titulo: "No se pudo rechazar", mensaje: "La solicitud ya fue procesada o no pudo actualizarse." });
  }
  const [restrictedToAsistencia, setRestrictedToAsistencia] = useState(false);
  const [asistenciaReadOnly, setAsistenciaReadOnly] = useState(false);
  const [asistenciaCanDelete, setAsistenciaCanDelete] = useState(true);
  const [allowedPages, setAllowedPages] = useState(null);
  const [permisos, setPermisos] = useState(null);
  const [permisosPorPagina, setPermisosPorPagina] = useState(null);
  const [nameInput, setNameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [loginError, setLoginError] = useState("");
  const [checkingLogin, setCheckingLogin] = useState(false);

  // "Olvidé mi contraseña": modal desde la pantalla de login para pedir el enlace de
  // restablecimiento por correo (POST /api/forgot-password, ver ese archivo).
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotNameInput, setForgotNameInput] = useState("");
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  // Pantalla de "nueva contraseña" cuando se llega desde el enlace del correo
  // (?reset=<token>&u=<usuario>). Se detecta una sola vez al montar; no depende de sesión,
  // el enlace debe funcionar tanto logueado como deslogueado.
  const [resetParams] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const token = params.get("reset");
      const nombre = params.get("u");
      if (token && nombre) return { token, nombre };
    } catch (e) { console.error("reset-password: no se pudo leer la URL", e); }
    return null;
  });
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetNewPassword2, setResetNewPassword2] = useState("");
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetOk, setResetOk] = useState(false);

  const [page, setPage] = useState("inicio");
  const [navOrder, setNavOrder] = useState(NAV_ITEMS_DEFAULT.map((n) => n.key));
  const [sessionChecked, setSessionChecked] = useState(false);

  // Modal "Mi contraseña": cualquier usuario logueado puede cambiar solo su propia contraseña.
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPasswordInput, setCurrentPasswordInput] = useState("");
  const [newPasswordInput, setNewPasswordInput] = useState("");
  const [newPasswordInput2, setNewPasswordInput2] = useState("");
  const [changePasswordError, setChangePasswordError] = useState("");
  const [changePasswordOk, setChangePasswordOk] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // Navegación en celular: menú hamburguesa desplegable en vez de la tira de botones angosta.
  const isMobile = useIsMobile(760);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileNavRef = useRef(null);
  const hamburgerBtnRef = useRef(null);

  useEffect(() => { setMobileMenuOpen(false); }, [page]);
  useEffect(() => { if (!isMobile) setMobileMenuOpen(false); }, [isMobile]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    function handleClickOutside(e) {
      if (
        mobileNavRef.current && !mobileNavRef.current.contains(e.target) &&
        hamburgerBtnRef.current && !hamburgerBtnRef.current.contains(e.target)
      ) {
        setMobileMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    let cancelled = false;
    async function refreshFromServer(isInitial) {
      try {
        const authRes = await fetch("/api/auth", { credentials: "include" });
        if (cancelled) return;
        if (!authRes.ok) {
          if (isInitial) { try { window.localStorage.removeItem(SESSION_STORAGE_KEY); } catch (_) { console.error(_); } }
          else { setMe(null); }
          if (isInitial) setSessionChecked(true);
          return;
        }
        const auth = await authRes.json();
        const serverUser = auth?.user;
        if (!serverUser?.name) {
          if (!isInitial) setMe(null);
          if (isInitial) setSessionChecked(true);
          return;
        }
        const esViewer = serverUser.role === "asistencia_viewer";
        const esEditor = serverUser.role === "asistencia_editor";
        const esSoloAsistencia = esViewer || esEditor;
        const esAdmin = serverUser.role === "admin";
        const paginas = !esAdmin && !esSoloAsistencia && Array.isArray(serverUser.paginas) && serverUser.paginas.length ? serverUser.paginas : null;
        setMe(serverUser.name);
        setMeTrabajador(serverUser.trabajador || "");
        setIsAdmin(esAdmin);
        setRestrictedToAsistencia(esSoloAsistencia);
        setAsistenciaReadOnly(esViewer);
        setAsistenciaCanDelete(!esViewer && !esEditor);
        setAllowedPages(paginas);
        setPermisosPorPagina(normalizePermissionMatrix(serverUser));
        setPermisos(serverUser.permisosPorPagina || null);
        if (isInitial) {
          try {
            const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
            const saved = raw ? JSON.parse(raw) : null;
            setPage(saved?.page || (esSoloAsistencia ? "asistencia" : "inicio"));
          } catch (e) {
            console.warn("no se pudo leer la pagina guardada en localStorage", e);
            setPage(esSoloAsistencia ? "asistencia" : "inicio");
          }
        }
      } catch (e) {
        console.error("refreshFromServer: fallo al validar la sesion", e);
        if (isInitial) { try { window.localStorage.removeItem(SESSION_STORAGE_KEY); } catch (_) { console.error(_); } }
      } finally {
        if (isInitial) setSessionChecked(true);
      }
    }
    refreshFromServer(true);
    const intervalId = setInterval(() => refreshFromServer(false), 2 * 60 * 1000);
    return () => { cancelled = true; clearInterval(intervalId); };
  }, []);
  useEffect(() => {
    if (!sessionChecked) return;
    try {
      if (me) {
        window.localStorage.setItem(
          SESSION_STORAGE_KEY,
          JSON.stringify({ me, isAdmin, restrictedToAsistencia, asistenciaReadOnly, asistenciaCanDelete, allowedPages, permisos, permisosPorPagina, page })
        );
      } else {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch (_) { console.error(_); }
  }, [sessionChecked, me, isAdmin, restrictedToAsistencia, asistenciaReadOnly, asistenciaCanDelete, allowedPages, permisos, permisosPorPagina, page]);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(NAV_ORDER_STORAGE_KEY, true);
        const saved = JSON.parse(res.value);
        if (Array.isArray(saved) && saved.length) {
          const known = NAV_ITEMS_DEFAULT.map((n) => n.key);
          const cleaned = saved.filter((k) => known.includes(k));
          const missing = known.filter((k) => !cleaned.includes(k));
          setNavOrder([...cleaned, ...missing]);
        }
      } catch (_) { console.error(_); }
    })();
  }, []);

  async function persistNavOrder(next) {
    setNavOrder(next);
    try { await window.storage.set(NAV_ORDER_STORAGE_KEY, JSON.stringify(next), true); } catch (e) { console.error("persist nav order error", e); }
  }

  const navItems = useMemo(() => {
    const byKey = Object.fromEntries(NAV_ITEMS_DEFAULT.map((n) => [n.key, n]));
    return navOrder.map((k) => byKey[k]).filter(Boolean);
  }, [navOrder]);

  const visibleNavItems = useMemo(
    () =>
      navItems.filter(
        (n) =>
          !(restrictedToAsistencia && n.restrictedHidden) &&
          (isAdmin || restrictedToAsistencia || ((allowedPages ? allowedPages.includes(n.key) : true) && (!permisosPorPagina || hasModulePermission({ role:"member", permisosPorPagina }, n.key, "ver"))))
      ),
    [navItems, restrictedToAsistencia, allowedPages, isAdmin, permisosPorPagina]
  );

  function canAccessPage(key) {
    if (isAdmin) return true;
    if (restrictedToAsistencia) return key === "asistencia";
    if (allowedPages && !allowedPages.includes(key)) return false;
    return !permisosPorPagina || hasModulePermission({ role: "member", permisosPorPagina }, key, "ver");
  }

  const canAction = (module, action) => isAdmin || (permisosPorPagina
    ? Core.hasModulePermission({ role: "member", permisosPorPagina }, module, action)
    : (!permisos || permisos[action] !== false));
  const ownerIdentity = meTrabajador || me || "";

  const puedeAprobarCotizacion = canAction("cotizacion", "aprobar");
  const revisionesCotizacionPendientes = useRevisionesCotizacionPendientes(isAdmin || puedeAprobarCotizacion);
  const misRevisionesCotizacionPendientes = useRevisionesCotizacionUsuario(me, !isAdmin && !!me);
  function handleAbrirMisRevisionesCotizacion() { setShowMisRevisionesCotizacion(true); }
  function handleCerrarMisRevisionesCotizacion() {
    setShowMisRevisionesCotizacion(false);
    marcarRevisionesCotizacionVistas(me);
  }

  async function handleVerPdfRevisionCotizacion(r) {
    try {
      const res = await window.storage.get(STORAGE_KEY_COTIZACIONES);
      const lista = JSON.parse(res.value);
      const cot = (Array.isArray(lista) ? lista : []).find((c) => c.id === r.cotizacionId);
      if (!cot) {
        setMensajeAdmin({ tipo: "error", titulo: "No se pudo abrir el PDF", mensaje: "Esa cotización ya no existe." });
        return;
      }
      const { doc } = await buildCotizacionPdf(cot, { download: false });
      const url = doc.output("bloburl");
      window.open(url, "_blank");
    } catch (e) {
      console.error(e);
      setMensajeAdmin({ tipo: "error", titulo: "No se pudo abrir el PDF", mensaje: "No se pudo generar el PDF de la cotización." });
    }
  }

  // Al presionar "Aprobar" se abre un modal para poder dejar un comentario opcional antes de
  // confirmar; la aprobación en sí se resuelve en handleConfirmarAprobarRevisionCotizacion.
  function handleAprobarRevisionCotizacion(r) {
    setRevisionCotizacionAAprobar(r);
  }
  async function handleConfirmarAprobarRevisionCotizacion(comentario) {
    const r = revisionCotizacionAAprobar;
    if (!r) return;
    setRevisionCotizacionAAprobar(null);
    const res = await resolverRevisionCotizacion(r.id, me, true, comentario);
    if (!res?.ok) {
      setMensajeAdmin({ tipo: "error", titulo: "No se pudo aprobar", mensaje: "La solicitud ya fue procesada por otro usuario." });
    }
  }

  useEffect(() => {
    if (!me) return;
    if (!canAccessPage(page)) {
      const fallback = visibleNavItems[0]?.key || "inicio";
      if (fallback !== page) setPage(fallback);
    }
    // canAccessPage no se incluye porque es una función local redefinida en cada render; su
    // resultado depende únicamente de los valores ya listados abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, page, isAdmin, restrictedToAsistencia, allowedPages, permisosPorPagina, visibleNavItems]);

  const navDrag = useRowDrag({
    enabled: isAdmin,
    idKey: "key",
    onReorder: (fromIdx, toIdx) => {
      const next = reorderWithinFull(navItems, visibleNavItems, fromIdx, toIdx, "key").map((n) => n.key);
      persistNavOrder(next);
    },
  });

  async function handleLoginSubmit() {
    const v = nameInput.trim();
    if (!v || !passwordInput) { setLoginError("Ingresa tu usuario y contraseña"); return; }
    setCheckingLogin(true);
    let esSoloAsistencia = false;
    let paginasUsuario = null;
    try {
      const authRes = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: v, password: passwordInput }),
      });
      if (!authRes.ok) {
        setCheckingLogin(false);
        setLoginError(authRes.status === 403 ? "Usuario desactivado. Contacta al administrador." : "Usuario o contraseña incorrectos");
        setPasswordInput("");
        return;
      }
      const auth = await authRes.json();
      const user = auth.user;
      const esViewer = user.role === "asistencia_viewer";
      const esEditor = user.role === "asistencia_editor";
      esSoloAsistencia = esViewer || esEditor;
      const esAdmin = user.role === "admin";
      paginasUsuario = !esAdmin && !esSoloAsistencia && Array.isArray(user.paginas) && user.paginas.length ? user.paginas : null;
      const permisosUsuario = !esAdmin && !esSoloAsistencia && user.permisosPorPagina && typeof user.permisosPorPagina === "object" ? user.permisosPorPagina : null;
      setMe(user.name);
      setMeTrabajador(user.trabajador || "");
      setIsAdmin(esAdmin);
      setRestrictedToAsistencia(esSoloAsistencia);
      setAsistenciaReadOnly(esViewer);
      setAsistenciaCanDelete(!esViewer && !esEditor);
      setAllowedPages(paginasUsuario);
      setPermisos(permisosUsuario);
      setPermisosPorPagina(normalizePermissionMatrix(user));
    } catch (e) {
      console.error("login: fallo al conectar con el servidor de autenticacion", e);
      setCheckingLogin(false);
      setLoginError("No se pudo conectar con el servidor de autenticación");
      return;
    }
    setCheckingLogin(false);
    let landing = "trabajos";
    if (esSoloAsistencia) {
      landing = "asistencia";
    } else if (paginasUsuario && !paginasUsuario.includes("trabajos")) {
      const enOrden = navOrder.filter((k) => paginasUsuario.includes(k));
      landing = enOrden[0] || paginasUsuario[0] || "trabajos";
    }
    setPage(landing);
  }

  function openForgotPassword() {
    setForgotNameInput(nameInput.trim());
    setForgotSubmitting(false);
    setForgotSent(false);
    setShowForgotPassword(true);
  }
  function closeForgotPassword() {
    setShowForgotPassword(false);
    setForgotNameInput("");
    setForgotSubmitting(false);
    setForgotSent(false);
  }
  async function submitForgotPassword() {
    const v = forgotNameInput.trim();
    if (!v) return;
    setForgotSubmitting(true);
    try {
      await fetch("/api/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: v }),
      });
    } catch (e) {
      console.error("olvidé mi contraseña: fallo al conectar", e);
    } finally {
      // Siempre se muestra el mismo mensaje de éxito, exista o no el usuario / tenga o no
      // correo configurado: evita que alguien use este formulario para adivinar usuarios
      // válidos del sistema.
      setForgotSubmitting(false);
      setForgotSent(true);
    }
  }

  async function submitResetPassword() {
    if (!resetNewPassword) { setResetError("Ingresa la nueva contraseña"); return; }
    if (resetNewPassword.length < 4) { setResetError("La nueva contraseña debe tener al menos 4 caracteres"); return; }
    if (resetNewPassword !== resetNewPassword2) { setResetError("Las dos contraseñas no coinciden"); return; }
    setResetSubmitting(true);
    setResetError("");
    try {
      const res = await fetch("/api/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: resetParams.nombre, token: resetParams.token, newPassword: resetNewPassword }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const mensajes = {
          token_expirado: "Este enlace venció. Pide uno nuevo desde la pantalla de inicio de sesión.",
          token_invalido: "Este enlace ya no es válido. Pide uno nuevo desde la pantalla de inicio de sesión.",
          contrasena_muy_corta: "La nueva contraseña debe tener al menos 4 caracteres.",
        };
        setResetError(mensajes[data.error] || "No se pudo restablecer la contraseña. Intenta de nuevo.");
        setResetSubmitting(false);
        return;
      }
      setResetOk(true);
    } catch (e) {
      console.error("reset-password: fallo al conectar", e);
      setResetError("No se pudo conectar con el servidor");
    } finally {
      setResetSubmitting(false);
    }
  }

  function openChangePassword() {
    setCurrentPasswordInput(""); setNewPasswordInput(""); setNewPasswordInput2("");
    setChangePasswordError(""); setChangePasswordOk(false);
    setShowChangePassword(true);
  }
  function closeChangePassword() {
    setShowChangePassword(false);
    setCurrentPasswordInput(""); setNewPasswordInput(""); setNewPasswordInput2("");
    setChangePasswordError(""); setChangePasswordOk(false);
  }
  async function submitChangePassword() {
    if (!currentPasswordInput || !newPasswordInput) { setChangePasswordError("Completa ambos campos de contraseña"); return; }
    if (newPasswordInput.length < 4) { setChangePasswordError("La nueva contraseña debe tener al menos 4 caracteres"); return; }
    if (newPasswordInput !== newPasswordInput2) { setChangePasswordError("Las dos contraseñas nuevas no coinciden"); return; }
    setChangingPassword(true);
    setChangePasswordError("");
    try {
      const res = await fetch("/api/change-my-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword: currentPasswordInput, newPassword: newPasswordInput }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setChangePasswordError(data.error === "contrasena_actual_incorrecta" ? "La contraseña actual no es correcta" : "No se pudo cambiar la contraseña. Intenta de nuevo.");
        setChangingPassword(false);
        return;
      }
      setChangePasswordOk(true);
      setCurrentPasswordInput(""); setNewPasswordInput(""); setNewPasswordInput2("");
    } catch (e) {
      console.error("cambiar mi contraseña: fallo al conectar", e);
      setChangePasswordError("No se pudo conectar con el servidor");
    } finally {
      setChangingPassword(false);
    }
  }

  function handleLogout() {
    setMe(null);
    setIsAdmin(false);
    setRestrictedToAsistencia(false);
    setAsistenciaReadOnly(false);
    setAsistenciaCanDelete(true);
    setAllowedPages(null);
    setPermisos(null);
    setPermisosPorPagina(null);
    setNameInput("");
    setPasswordInput("");
    setLoginError("");
    setPage("trabajos");
    try { window.localStorage.removeItem(SESSION_STORAGE_KEY); } catch (_) { console.error(_); }
    fetch("/api/auth", { method: "DELETE", credentials: "include" }).catch(() => {});
  }

  if (resetParams) {
    return (
      <div style={{ minHeight: 400, display: "flex", alignItems: "center", justifyContent: "center", background: `radial-gradient(circle at 50% 0%, ${COLORS.panel2} 0%, ${COLORS.bg} 60%)`, borderRadius: 12, padding: 40, fontFamily: "'Inter',sans-serif" }}>
        <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 34, width: 320, maxWidth: "100%", textAlign: "center", boxSizing: "border-box", boxShadow: "0 20px 50px rgba(0,0,0,0.45)" }}>
          <img src={LOGO_SHIELD} alt="Operaciones" style={{ width: 52, height: "auto", margin: "0 auto 14px", display: "block", filter: `drop-shadow(0 0 14px ${COLORS.amberDim})` }} />
          {resetOk ? (
            <>
              <div style={{ color: COLORS.text, fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Contraseña actualizada</div>
              <div style={{ color: COLORS.dim, fontSize: 12.5, marginBottom: 18 }}>Ya puedes ingresar con tu nueva contraseña.</div>
              <button
                onClick={() => { window.location.href = window.location.pathname; }}
                style={{ width: "100%", background: `linear-gradient(180deg, ${COLORS.amber}, ${COLORS.amberDeep})`, color: COLORS.amberText, border: "none", borderRadius: 9, padding: "11px 0", fontWeight: 700, fontSize: 13, cursor: "pointer", boxShadow: `0 6px 18px ${COLORS.amberDim}` }}
              >
                Ir a iniciar sesión
              </button>
            </>
          ) : (
            <>
              <div style={{ color: COLORS.text, fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Nueva contraseña</div>
              <div style={{ color: COLORS.dim, fontSize: 12, marginBottom: 18 }}>Para {resetParams.nombre}</div>
              <input
                autoFocus
                type="password"
                value={resetNewPassword}
                onChange={(e) => { setResetNewPassword(e.target.value); setResetError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") submitResetPassword(); }}
                placeholder="Nueva contraseña"
                style={{ width: "100%", background: COLORS.panel2, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: 9, padding: "10px 13px", fontSize: 13, outline: "none", marginBottom: 10, boxSizing: "border-box" }}
              />
              <input
                type="password"
                value={resetNewPassword2}
                onChange={(e) => { setResetNewPassword2(e.target.value); setResetError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") submitResetPassword(); }}
                placeholder="Repite la nueva contraseña"
                style={{ width: "100%", background: COLORS.panel2, border: `1px solid ${resetError ? COLORS.red : COLORS.border}`, color: COLORS.text, borderRadius: 9, padding: "10px 13px", fontSize: 13, outline: "none", marginBottom: 8, boxSizing: "border-box" }}
              />
              {resetError && <div style={{ color: COLORS.red, fontSize: 11.5, marginBottom: 8, textAlign: "left" }}>{resetError}</div>}
              <button
                onClick={submitResetPassword}
                disabled={resetSubmitting}
                style={{ width: "100%", background: `linear-gradient(180deg, ${COLORS.amber}, ${COLORS.amberDeep})`, color: COLORS.amberText, border: "none", borderRadius: 9, padding: "11px 0", fontWeight: 700, fontSize: 13, cursor: resetSubmitting ? "default" : "pointer", opacity: resetSubmitting ? 0.7 : 1, boxShadow: `0 6px 18px ${COLORS.amberDim}` }}
              >
                {resetSubmitting ? "Guardando…" : "Guardar contraseña"}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!me) {
    if (!sessionChecked) return null;
    return (
      <div style={{ minHeight: 400, display: "flex", alignItems: "center", justifyContent: "center", background: `radial-gradient(circle at 50% 0%, ${COLORS.panel2} 0%, ${COLORS.bg} 60%)`, borderRadius: 12, padding: 40, fontFamily: "'Inter',sans-serif" }}>
        <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 34, width: 320, maxWidth: "100%", textAlign: "center", boxSizing: "border-box", boxShadow: "0 20px 50px rgba(0,0,0,0.45)" }}>
          <img src={LOGO_SHIELD} alt="Operaciones" style={{ width: 52, height: "auto", margin: "0 auto 14px", display: "block", filter: `drop-shadow(0 0 14px ${COLORS.amberDim})` }} />
          <div style={{ color: COLORS.text, fontWeight: 700, fontSize: 17, marginBottom: 20, fontFamily: "'Space Grotesk',sans-serif", letterSpacing: 0.2 }}>Operaciones</div>
          <input
            autoFocus
            value={nameInput}
            onChange={(e) => { setNameInput(e.target.value); setLoginError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleLoginSubmit(); }}
            placeholder="Usuario"
            style={{ width: "100%", background: COLORS.panel2, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: 9, padding: "10px 13px", fontSize: 13, outline: "none", marginBottom: 10, boxSizing: "border-box", transition: "border-color .15s" }}
          />
          <input
            type="password"
            value={passwordInput}
            onChange={(e) => { setPasswordInput(e.target.value); setLoginError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleLoginSubmit(); }}
            placeholder="Contraseña"
            style={{ width: "100%", background: COLORS.panel2, border: `1px solid ${loginError ? COLORS.red : COLORS.border}`, color: COLORS.text, borderRadius: 9, padding: "10px 13px", fontSize: 13, outline: "none", marginBottom: 8, boxSizing: "border-box", transition: "border-color .15s" }}
          />
          {loginError && <div style={{ color: COLORS.red, fontSize: 11.5, marginBottom: 8, textAlign: "left" }}>{loginError}</div>}
          <button
            onClick={handleLoginSubmit}
            disabled={checkingLogin}
            style={{ width: "100%", background: `linear-gradient(180deg, ${COLORS.amber}, ${COLORS.amberDeep})`, color: COLORS.amberText, border: "none", borderRadius: 9, padding: "11px 0", fontWeight: 700, fontSize: 13, cursor: checkingLogin ? "default" : "pointer", opacity: checkingLogin ? 0.7 : 1, boxShadow: `0 6px 18px ${COLORS.amberDim}` }}
          >
            {checkingLogin ? "Verificando…" : "Entrar"}
          </button>
          <div
            onClick={openForgotPassword}
            style={{ marginTop: 14, color: COLORS.dim, fontSize: 11.5, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}
          >
            ¿Olvidaste tu contraseña?
          </div>
        </div>

        {showForgotPassword && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20, boxSizing: "border-box" }} onClick={closeForgotPassword}>
            <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 28, width: 320, maxWidth: "100%", boxSizing: "border-box", boxShadow: "0 20px 50px rgba(0,0,0,0.45)" }} onClick={(e) => e.stopPropagation()}>
              {forgotSent ? (
                <>
                  <div style={{ color: COLORS.text, fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Revisa tu correo</div>
                  <div style={{ color: COLORS.dim, fontSize: 12.5, lineHeight: 1.5, marginBottom: 18 }}>
                    Si el usuario existe y tiene un correo configurado, te enviamos un enlace para restablecer tu contraseña. Vence en 30 minutos.
                  </div>
                  <button
                    onClick={closeForgotPassword}
                    style={{ width: "100%", background: `linear-gradient(180deg, ${COLORS.amber}, ${COLORS.amberDeep})`, color: COLORS.amberText, border: "none", borderRadius: 9, padding: "10px 0", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                  >
                    Entendido
                  </button>
                </>
              ) : (
                <>
                  <div style={{ color: COLORS.text, fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Restablecer contraseña</div>
                  <div style={{ color: COLORS.dim, fontSize: 12, marginBottom: 16 }}>Ingresa tu usuario y te mandamos un enlace por correo.</div>
                  <input
                    autoFocus
                    value={forgotNameInput}
                    onChange={(e) => setForgotNameInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submitForgotPassword(); }}
                    placeholder="Usuario"
                    style={{ width: "100%", background: COLORS.panel2, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: 9, padding: "10px 13px", fontSize: 13, outline: "none", marginBottom: 14, boxSizing: "border-box" }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={closeForgotPassword}
                      style={{ flex: 1, background: COLORS.panel2, color: COLORS.text, border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: "10px 0", fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={submitForgotPassword}
                      disabled={forgotSubmitting || !forgotNameInput.trim()}
                      style={{ flex: 1, background: `linear-gradient(180deg, ${COLORS.amber}, ${COLORS.amberDeep})`, color: COLORS.amberText, border: "none", borderRadius: 9, padding: "10px 0", fontWeight: 700, fontSize: 12.5, cursor: forgotSubmitting ? "default" : "pointer", opacity: forgotSubmitting || !forgotNameInput.trim() ? 0.7 : 1 }}
                    >
                      {forgotSubmitting ? "Enviando…" : "Enviar enlace"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ background: COLORS.bg, minHeight: "100%", fontFamily: "'Inter',sans-serif" }}>
      <style>{`
        *{box-sizing:border-box} body{margin:0;background:${COLORS.bg};color:${COLORS.text}}
        button,input,select,textarea{font-family:inherit}
        button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid ${COLORS.blue};outline-offset:1px}
        select{color-scheme:dark}
        select option{background:${COLORS.panel2};color:${COLORS.text}}
        .ct-input2{width:100%;background:${COLORS.panel2};border:1px solid ${COLORS.border};color:${COLORS.text};font-family:'Inter',sans-serif;font-size:12.5px;padding:7px 9px;border-radius:6px;outline:none;box-sizing:border-box}
        .ct-input2:focus{border-color:${COLORS.amber}}
        .ct-input2::placeholder{color:${COLORS.faint};opacity:1}
        input:-webkit-autofill,input:-webkit-autofill:hover,input:-webkit-autofill:focus,input:-webkit-autofill:active,
        textarea:-webkit-autofill,textarea:-webkit-autofill:hover,textarea:-webkit-autofill:focus{
          -webkit-box-shadow:0 0 0px 1000px ${COLORS.panel2} inset !important;
          box-shadow:0 0 0px 1000px ${COLORS.panel2} inset !important;
          -webkit-text-fill-color:${COLORS.text} !important;
          caret-color:${COLORS.text} !important;
          transition:background-color 9999s ease-in-out 0s;
        }
        .wc-nav-scroll{scrollbar-width:thin}
        ::-webkit-scrollbar{width:10px;height:10px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:${COLORS.border};border-radius:20px}
        ::-webkit-scrollbar-thumb:hover{background:${COLORS.dim}}
        .wc-nav-btn{transition:background .15s,color .15s}
        .wc-nav-btn:hover:not([data-active="true"]){background:rgba(255,255,255,0.04);color:${COLORS.text}}
        .wc-dd-opt{background:transparent;color:${COLORS.text};transition:background .1s ease,color .1s ease}
        .wc-dd-opt:hover{background:${COLORS.blue};color:${COLORS.amberText}}
        .wc-dd-opt.is-selected{background:${COLORS.blue};color:${COLORS.amberText}}
        @media(max-width:760px){.wc-nav-scroll{order:3;width:100%}}
        .wc-mobile-nav{animation:wc-mobile-nav-in .15s ease}
        .wc-mobile-nav button:active:not([data-active="true"]){background:rgba(255,255,255,0.06)}
        @keyframes wc-mobile-nav-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
      `}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px", borderBottom: `1px solid ${COLORS.border}`, flexWrap: "wrap", background: `linear-gradient(180deg, ${COLORS.panel} 0%, ${COLORS.bg} 100%)`, boxShadow: "0 4px 16px rgba(0,0,0,0.25)" }}>
        <img src={LOGO_SHIELD} alt="" style={{ width: 27, height: 27, borderRadius: 7, flexShrink: 0, boxShadow: `0 0 0 1px ${COLORS.border}` }} />
        <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 14.5, color: COLORS.text, marginRight: 8, letterSpacing: 0.2 }}>
          Wilarcon
        </div>
        {!isMobile && (
        <div className="wc-nav-scroll" style={{ display: "flex", background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 9, overflow: "hidden", padding: 3, gap: 2 }}>
          {visibleNavItems.map((item, idx) => {
            const dh = navDrag.getHandlers(idx, item);
            const isOver = navDrag.dragOverId === item.key;
            const isActive = page === item.key;
            return (
              <button
                key={item.key}
                className="wc-nav-btn"
                data-active={isActive}
                onClick={() => setPage(item.key)}
                {...dh}
                style={{
                  padding: "7px 12px 7px 8px",
                  fontSize: 12.5,
                  border: "none",
                  borderRadius: 6,
                  cursor: isAdmin ? "grab" : "pointer",
                  background: isActive ? `linear-gradient(180deg, ${COLORS.amber}, ${COLORS.amberDeep})` : "transparent",
                  color: isActive ? COLORS.amberText : COLORS.dim,
                  fontWeight: isActive ? 700 : 500,
                  display: "flex",
                  alignItems: "center",
                  boxShadow: isOver ? `inset 0 0 0 2px ${COLORS.amber}` : isActive ? `0 3px 10px ${COLORS.amberDim}` : "none",
                }}
              >
                <DragHandle show={isAdmin} color={isActive ? COLORS.amberText : COLORS.faint} dragProps={navDrag.getHandleProps(idx)} dragging={navDrag.armedIndex === idx} />
                {item.label}
              </button>
            );
          })}
        </div>
        )}
        {isMobile && (
          <button
            ref={hamburgerBtnRef}
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="Abrir menú de navegación"
            aria-expanded={mobileMenuOpen}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: COLORS.panel2,
              border: `1px solid ${mobileMenuOpen ? COLORS.amber : COLORS.border}`,
              color: COLORS.text,
              borderRadius: 9,
              padding: "9px 14px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              maxWidth: 220,
            }}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>☰</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {visibleNavItems.find((n) => n.key === page)?.label || "Menú"}
            </span>
          </button>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {(isAdmin || puedeAprobarCotizacion) && (
            <button
              onClick={() => setShowRevisionesCotizacion(true)}
              title="Solicitudes de revisión de cotización"
              style={{ position: "relative", display: "flex", alignItems: "center", gap: 6, background: revisionesCotizacionPendientes.length ? COLORS.redDim : COLORS.panel2, border: `1px solid ${revisionesCotizacionPendientes.length ? COLORS.red : COLORS.border}`, color: revisionesCotizacionPendientes.length ? COLORS.red : COLORS.faint, borderRadius: 20, padding: "6px 13px", fontSize: 11.5, cursor: "pointer", fontWeight: revisionesCotizacionPendientes.length ? 700 : 400 }}
            >
              📄🔔{revisionesCotizacionPendientes.length ? ` ${revisionesCotizacionPendientes.length}` : ""}
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setShowPropuestas(true)}
              title="Ediciones pendientes de aprobación"
              style={{ position: "relative", display: "flex", alignItems: "center", gap: 6, background: propuestasPendientes.length ? COLORS.redDim : COLORS.panel2, border: `1px solid ${propuestasPendientes.length ? COLORS.red : COLORS.border}`, color: propuestasPendientes.length ? COLORS.red : COLORS.faint, borderRadius: 20, padding: "6px 13px", fontSize: 11.5, cursor: "pointer", fontWeight: propuestasPendientes.length ? 700 : 400 }}
            >
              🔔{propuestasPendientes.length ? ` ${propuestasPendientes.length}` : ""}
            </button>
          )}
          {!isAdmin && (
            <button
              onClick={handleAbrirMisRevisionesCotizacion}
              title="Respuestas a tus solicitudes de cotización"
              style={{ position: "relative", display: "flex", alignItems: "center", gap: 6, background: misRevisionesCotizacionPendientes.length ? COLORS.redDim : COLORS.panel2, border: `1px solid ${misRevisionesCotizacionPendientes.length ? COLORS.red : COLORS.border}`, color: misRevisionesCotizacionPendientes.length ? COLORS.red : COLORS.faint, borderRadius: 20, padding: "6px 13px", fontSize: 11.5, cursor: "pointer", fontWeight: misRevisionesCotizacionPendientes.length ? 700 : 400 }}
            >
              📄✔{misRevisionesCotizacionPendientes.length ? ` ${misRevisionesCotizacionPendientes.length}` : ""}
            </button>
          )}
          {!isAdmin && (
            <button
              onClick={handleAbrirMisPropuestas}
              title="Respuestas a tus solicitudes"
              style={{ position: "relative", display: "flex", alignItems: "center", gap: 6, background: misRespuestasPendientes.length ? COLORS.redDim : COLORS.panel2, border: `1px solid ${misRespuestasPendientes.length ? COLORS.red : COLORS.border}`, color: misRespuestasPendientes.length ? COLORS.red : COLORS.faint, borderRadius: 20, padding: "6px 13px", fontSize: 11.5, cursor: "pointer", fontWeight: misRespuestasPendientes.length ? 700 : 400 }}
            >
              🔔{misRespuestasPendientes.length ? ` ${misRespuestasPendientes.length}` : ""}
            </button>
          )}
          <button
            onClick={openChangePassword}
            title="Cambiar mi contraseña"
            style={{ display: "flex", alignItems: "center", gap: 6, background: isAdmin ? COLORS.amberDim : COLORS.panel2, border: `1px solid ${isAdmin ? COLORS.amber : COLORS.border}`, borderRadius: 20, padding: "6px 13px", fontSize: 11.5, color: isAdmin ? COLORS.amber : COLORS.text, fontWeight: isAdmin ? 600 : 400, cursor: "pointer" }}
          >
            {isAdmin ? `★ ${me}` : me}
          </button>
          <button onClick={handleLogout} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.faint, borderRadius: 20, padding: "6px 13px", fontSize: 11.5, cursor: "pointer", transition: "border-color .15s,color .15s" }}>
            Salir
          </button>
        </div>
      </div>

      {showChangePassword && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }} onClick={closeChangePassword}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 22, width: 360, maxWidth: "100%", boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600, fontSize: 14 }}>Mi contraseña</div>
              <button onClick={closeChangePassword} style={{ background: "transparent", border: "none", color: COLORS.faint, cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            {changePasswordOk ? (
              <div>
                <div style={{ color: COLORS.green, fontSize: 12.5, marginBottom: 14 }}>Tu contraseña se cambió correctamente.</div>
                <button onClick={closeChangePassword} style={{ background: COLORS.amber, color: COLORS.amberText, border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", width: "100%" }}>Cerrar</button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {changePasswordError && <div style={{ color: COLORS.red, fontSize: 11.5 }}>{changePasswordError}</div>}
                <div>
                  <div style={{ fontSize: 10.5, color: COLORS.faint, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.4 }}>Contraseña actual</div>
                  <input type="password" value={currentPasswordInput} onChange={(e) => setCurrentPasswordInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitChangePassword(); }} style={{ width: "100%", background: COLORS.panel2, border: `1px solid ${COLORS.border}`, color: COLORS.text, fontSize: 12.5, padding: "7px 9px", borderRadius: 6, outline: "none", boxSizing: "border-box" }} />
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: COLORS.faint, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.4 }}>Nueva contraseña</div>
                  <input type="password" value={newPasswordInput} onChange={(e) => setNewPasswordInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitChangePassword(); }} style={{ width: "100%", background: COLORS.panel2, border: `1px solid ${COLORS.border}`, color: COLORS.text, fontSize: 12.5, padding: "7px 9px", borderRadius: 6, outline: "none", boxSizing: "border-box" }} />
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: COLORS.faint, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.4 }}>Repetir nueva contraseña</div>
                  <input type="password" value={newPasswordInput2} onChange={(e) => setNewPasswordInput2(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitChangePassword(); }} style={{ width: "100%", background: COLORS.panel2, border: `1px solid ${COLORS.border}`, color: COLORS.text, fontSize: 12.5, padding: "7px 9px", borderRadius: 6, outline: "none", boxSizing: "border-box" }} />
                </div>
                <button onClick={submitChangePassword} disabled={changingPassword} style={{ background: COLORS.amber, color: COLORS.amberText, border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 12.5, fontWeight: 600, cursor: changingPassword ? "default" : "pointer", opacity: changingPassword ? 0.6 : 1, marginTop: 4 }}>{changingPassword ? "Guardando..." : "Guardar contraseña"}</button>
              </div>
            )}
          </div>
        </div>
      )}

      {isMobile && mobileMenuOpen && (
        <div
          ref={mobileNavRef}
          className="wc-mobile-nav"
          style={{
            background: COLORS.panel,
            borderBottom: `1px solid ${COLORS.border}`,
            boxShadow: "0 10px 24px rgba(0,0,0,0.35)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {visibleNavItems.map((item, idx) => {
            const isActive = page === item.key;
            return (
              <div
                key={item.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  width: "100%",
                  borderTop: `1px solid ${COLORS.border}`,
                  background: isActive ? `linear-gradient(180deg, ${COLORS.amber}, ${COLORS.amberDeep})` : "transparent",
                }}
              >
                <button
                  onClick={() => setPage(item.key)}
                  data-active={isActive}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    flex: 1,
                    textAlign: "left",
                    padding: "15px 18px",
                    fontSize: 14.5,
                    minHeight: 48,
                    border: "none",
                    background: "transparent",
                    color: isActive ? COLORS.amberText : COLORS.text,
                    fontWeight: isActive ? 700 : 500,
                    cursor: "pointer",
                  }}
                >
                  {item.label}
                </button>
                <DragHandle
                  show={isAdmin}
                  isMobile
                  color={isActive ? COLORS.amberText : COLORS.faint}
                  canMoveUp={idx > 0}
                  canMoveDown={idx < visibleNavItems.length - 1}
                  onMoveUp={() => navDrag.moveBy(idx, -1, visibleNavItems.length)}
                  onMoveDown={() => navDrag.moveBy(idx, 1, visibleNavItems.length)}
                />
              </div>
            );
          })}
        </div>
      )}

      {showPropuestas && (
        <PropuestasPanel
          propuestas={propuestasPendientes}
          onAprobar={handleAprobarPropuesta}
          onRechazar={handleRechazarPropuesta}
          onClose={() => setShowPropuestas(false)}
        />
      )}

      {showMisPropuestas && (
        <MisPropuestasPanel
          propuestas={misRespuestasPendientes}
          onClose={handleCerrarMisPropuestas}
        />
      )}

      {showMisRevisionesCotizacion && (
        <MisRevisionesCotizacionPanel
          revisiones={misRevisionesCotizacionPendientes}
          onClose={handleCerrarMisRevisionesCotizacion}
        />
      )}

      {revisionCotizacionAAprobar && (
        <AprobarRevisionCotizacionModal
          revision={revisionCotizacionAAprobar}
          onConfirmar={handleConfirmarAprobarRevisionCotizacion}
          onCancelar={() => setRevisionCotizacionAAprobar(null)}
        />
      )}

      {showRevisionesCotizacion && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: 16 }} onClick={() => setShowRevisionesCotizacion(false)}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 18, width: 480, maxWidth: "92vw", maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <b style={{ color: COLORS.text, fontSize: 15 }}>
                Solicitudes de revisión de cotización {revisionesCotizacionPendientes.length ? `(${revisionesCotizacionPendientes.length})` : ""}
              </b>
              <button onClick={() => setShowRevisionesCotizacion(false)} style={{ background: "transparent", border: "none", color: COLORS.dim, fontSize: 16, cursor: "pointer" }}>✕</button>
            </div>
            {revisionesCotizacionPendientes.length === 0 && (
              <div style={{ padding: 28, textAlign: "center", color: COLORS.green, fontSize: 12.5 }}>✓ No hay solicitudes pendientes de revisión.</div>
            )}
            {revisionesCotizacionPendientes.map((r) => (
              <div key={r.id} style={{ border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 12, marginBottom: 10 }}>
                <div style={{ fontWeight: 600, color: COLORS.text, fontSize: 12.5 }}>
                  {r.numero || "—"}{r.solicitud ? ` — ${r.solicitud}` : ""}
                </div>
                <div style={{ fontSize: 11.5, color: COLORS.dim, marginTop: 2 }}>
                  {r.contacto ? `${r.contacto} · ` : ""}Solicitado por {r.autor} · {fmtFechaHora(r.fecha)}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button onClick={() => handleVerPdfRevisionCotizacion(r)} style={{ background: "transparent", border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: 7, padding: "6px 12px", fontSize: 11.5, cursor: "pointer" }}>
                    Ver PDF
                  </button>
                  <button onClick={() => handleAprobarRevisionCotizacion(r)} style={{ background: COLORS.green, color: COLORS.greenTextDark, border: "none", borderRadius: 7, padding: "6px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
                    Aprobar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {mensajeAdmin && (
        <MensajeModal
          tipo={mensajeAdmin.tipo}
          titulo={mensajeAdmin.titulo}
          mensaje={mensajeAdmin.mensaje}
          onClose={() => setMensajeAdmin(null)}
        />
      )}

      <Suspense fallback={<div style={{ padding: 24, color: COLORS.dim, textAlign: "center" }}>Cargando módulo…</div>}>
      {canAccessPage("inicio") && page === "inicio" && (
          <Dashboard me={me} isAdmin={isAdmin} onNavigate={setPage} propuestasPendientesCount={propuestasPendientes.length} onOpenPropuestas={() => setShowPropuestas(true)} onOpenCreateUser={() => { setTorreBackgroundReady(true); setOpenCreateUserOnTorre(true); }} asistenciaReadOnly={asistenciaReadOnly || !canAction("asistencia","editar") && !canAction("asistencia","agregar")} asistenciaCanDelete={asistenciaCanDelete && canAction("asistencia","eliminar")} canAction={canAction} ownerIdentity={ownerIdentity} />
      )}
      {canAccessPage("trabajos") && page === "trabajos" && (
          <ControlTrabajos me={me} ownerIdentity={ownerIdentity} isAdmin={isAdmin} puedeEditar={canAction("trabajos","editar")} puedeAgregar={canAction("trabajos","agregar")} puedeEliminar={canAction("trabajos","eliminar")} puedeExportar={canAction("trabajos","exportar")} puedeAdjuntar={canAction("trabajos","adjuntar")} puedeAprobar={canAction("trabajos","aprobar")} puedeVerTodos={canAction("trabajos","todos")} />
      )}
      {canAccessPage("torre") && (page === "torre" || torreBackgroundReady) && (
          <div style={page === "torre" ? undefined : { position: "fixed", top: 0, left: 0, width: 0, height: 0, overflow: "hidden", visibility: "hidden" }}>
          <TorreControl initialMe={me} initialIsAdmin={isAdmin} onGlobalLogout={handleLogout} initialOpenCreateUser={openCreateUserOnTorre} onCreateUserOpened={() => setOpenCreateUserOnTorre(false)} puedeEliminar={canAction("torre","eliminar")} puedeAgregar={canAction("torre","agregar")} puedeEditar={canAction("torre","editar")} puedeExportar={canAction("torre","exportar")} puedeAdjuntar={canAction("torre","adjuntar")} puedeAprobar={canAction("torre","aprobar")} puedeVerTodos={canAction("torre","todos")} ownerIdentity={ownerIdentity} />
          </div>
      )}
      {canAccessPage("asistencia") && page === "asistencia" && (
          <ControlAsistencia
            me={me}
            ownerIdentity={ownerIdentity}
            readOnly={asistenciaReadOnly || !canAction("asistencia","editar") && !canAction("asistencia","agregar")}
            canDelete={asistenciaCanDelete && canAction("asistencia","eliminar")}
            puedeExportar={canAction("asistencia","exportar")}
            puedeAprobar={canAction("asistencia","aprobar")}
            puedeVerTodos={canAction("asistencia","todos")}
            isAdmin={isAdmin}
          />
      )}
      {canAccessPage("contactos") && page === "contactos" && (
          <ContactosCuentas me={me} isAdmin={isAdmin} puedeEditar={canAction("contactos","editar")} puedeAgregar={canAction("contactos","agregar")} puedeEliminar={canAction("contactos","eliminar")} puedeExportar={canAction("contactos","exportar")} puedeAprobar={canAction("contactos","aprobar")} />
      )}
      {canAccessPage("viaticos") && page === "viaticos" && (
          <ControlViaticos me={me} ownerIdentity={ownerIdentity} isAdmin={isAdmin} puedeEditar={canAction("viaticos","editar")} puedeAgregar={canAction("viaticos","agregar")} puedeEliminar={canAction("viaticos","eliminar")} puedeExportar={canAction("viaticos","exportar")} puedeAprobar={canAction("viaticos","aprobar")} puedeVerTodos={canAction("viaticos","todos")} />
      )}
      {canAccessPage("gastos") && page === "gastos" && (
          <ControlGastos me={me} isAdmin={isAdmin} puedeEditar={canAction("gastos","editar")} puedeAgregar={canAction("gastos","agregar")} puedeEliminar={canAction("gastos","eliminar")} puedeExportar={canAction("gastos","exportar")} puedeAdjuntar={canAction("gastos","adjuntar")} puedeAprobar={canAction("gastos","aprobar")} />
      )}
      {canAccessPage("caja_chica") && page === "caja_chica" && (
          <ControlCajaChica me={me} isAdmin={isAdmin} puedeEditar={canAction("caja_chica","editar")} puedeAgregar={canAction("caja_chica","agregar")} puedeEliminar={canAction("caja_chica","eliminar")} puedeExportar={canAction("caja_chica","exportar")} puedeAdjuntar={canAction("caja_chica","adjuntar")} puedeAprobar={canAction("caja_chica","aprobar")} />
      )}
      {canAccessPage("responsabilidades") && page === "responsabilidades" && (
          <ControlResponsabilidades me={me} ownerIdentity={ownerIdentity} isAdmin={isAdmin} puedeEditar={canAction("responsabilidades","editar")} puedeAgregar={canAction("responsabilidades","agregar")} puedeEliminar={canAction("responsabilidades","eliminar")} puedeExportar={canAction("responsabilidades","exportar")} puedeAprobar={canAction("responsabilidades","aprobar")} puedeVerTodos={canAction("responsabilidades","todos")} />
      )}
      {canAccessPage("cotizacion") && page === "cotizacion" && (
          <ControlCotizaciones me={me} isAdmin={isAdmin} puedeEditar={canAction("cotizacion","editar")} puedeAgregar={canAction("cotizacion","agregar")} puedeEliminar={canAction("cotizacion","eliminar")} puedeExportar={canAction("cotizacion","exportar")} />
      )}
      {canAccessPage("informes") && page === "informes" && (
          <ControlInformes me={me} ownerIdentity={ownerIdentity} isAdmin={isAdmin} puedeEditar={canAction("informes","editar")} puedeAgregar={canAction("informes","agregar")} puedeEliminar={canAction("informes","eliminar")} puedeExportar={canAction("informes","exportar")} puedeAdjuntar={canAction("informes","adjuntar")} puedeAprobar={canAction("informes","aprobar")} puedeVerTodos={canAction("informes","todos")} />
      )}
      {canAccessPage("visitas") && page === "visitas" && (
          <ControlVisitas me={me} ownerIdentity={ownerIdentity} isAdmin={isAdmin} puedeEditar={canAction("visitas","editar")} puedeAgregar={canAction("visitas","agregar")} puedeEliminar={canAction("visitas","eliminar")} puedeExportar={canAction("visitas","exportar")} puedeAdjuntar={canAction("visitas","adjuntar")} puedeAprobar={canAction("visitas","aprobar")} puedeVerTodos={canAction("visitas","todos")} />
      )}
      </Suspense>
</div>
  );
}
