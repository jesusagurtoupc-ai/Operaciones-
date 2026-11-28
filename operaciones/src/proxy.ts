import { NextRequest, NextResponse } from "next/server";
import { getUserFromToken, tokenRenovado, OPCIONES_COOKIE, SESSION_COOKIE_NAME } from "@/lib/server/auth";
import { PAGINAS, puedeVerRuta } from "@/lib/shared";

// Next.js 16 renombró "middleware" a "proxy". Corre en Node.js, así que
// puede consultar la base de datos para validar rol y estado del usuario.
//
// Reglas de acceso:
//  - Sin sesión válida: a /login (páginas) o 401 (API).
//  - Rol "lectura": solo puede leer. Cualquier método que no sea
//    GET/HEAD en /api devuelve 403 (excepto cerrar sesión), y no puede
//    entrar a la administración de usuarios.
//  - Rol "admin": acceso total.
/** ¿La petición viene de esta misma app? Usa Sec-Fetch-Site y, si no está, el encabezado Origin. */
function mismoOrigen(req: NextRequest): boolean {
  const sitio = req.headers.get("sec-fetch-site");
  if (sitio === "cross-site" || sitio === "same-site") return false;
  const origen = req.headers.get("origin");
  if (!origen) return true; // navegadores antiguos o herramientas sin Origin: decide la cookie SameSite
  try {
    return new URL(origen).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host);
  } catch {
    return false;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic =
    pathname === "/login" ||
    pathname.startsWith("/api/auth/login") ||
    // Solo «despierta» la base (SELECT 1, limitado); no devuelve datos.
    (pathname === "/api/auth/despertar" && req.method === "GET") ||
    // Reporte de incidencias por QR: cualquier persona, sin sesión (la ruta limita y valida los envíos).
    pathname === "/reportar" ||
    (pathname === "/api/gestion/reportar" && req.method === "POST") ||
    // Resumen semanal programado (Vercel Cron): la ruta exige «Authorization: Bearer CRON_SECRET».
    (pathname === "/api/correctivos/avisos" &&
      req.method === "GET" &&
      req.nextUrl.searchParams.get("resumen") === "semanal" &&
      !!process.env.CRON_SECRET &&
      req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/icon.png" ||
    pathname === "/logo-upc.png" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js";

  // Protección contra peticiones falsificadas desde otro sitio (CSRF): toda escritura (POST, PUT,
  // PATCH, DELETE) debe venir de esta misma app. La cookie ya es SameSite=Lax; esto es una segunda
  // barrera, y también cubre el login (que otro sitio no pueda iniciarte sesión en otra cuenta).
  if (req.method !== "GET" && req.method !== "HEAD" && !mismoOrigen(req)) {
    return NextResponse.json({ error: "Petición rechazada: origen no permitido" }, { status: 403 });
  }

  if (isPublic) {
    return NextResponse.next();
  }

  const esApi = pathname.startsWith("/api");
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;

  let user = null;
  try {
    user = token ? await getUserFromToken(token) : null;
  } catch (err) {
    console.error(err);
    if (esApi) {
      return NextResponse.json(
        { error: "Servicio no disponible, intenta de nuevo" },
        { status: 503 }
      );
    }
    return new NextResponse("Servicio no disponible, intenta de nuevo.", {
      status: 503,
    });
  }

  if (!user) {
    if (esApi) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Usuarios y Proveedores ahora están dentro del Panel (botones junto a la fecha): las direcciones antiguas
  // llevan ahí.
  for (const v of ["usuarios", "proveedores"]) {
    if (pathname === `/${v}` || pathname.startsWith(`/${v}/`)) {
      return NextResponse.redirect(new URL(`/dashboard?vista=${v}`, req.url));
    }
  }

  // Acceso por página: el usuario solo entra a las páginas que el administrador le asignó.
  if (!puedeVerRuta(user.rol, user.paginas, pathname)) {
    if (esApi) {
      return NextResponse.json({ error: "No tienes acceso a esta sección" }, { status: 403 });
    }
    const permitida = PAGINAS.find((p) => user.paginas?.includes(p.href));
    return NextResponse.redirect(new URL(permitida?.href ?? "/login", req.url));
  }

  if (user.rol !== "admin") {
    const soloLectura = req.method === "GET" || req.method === "HEAD";
    // El borrador de materiales es personal de cada usuario: también lo guardan los de solo lectura.
    const esLogout =
      pathname.startsWith("/api/auth/logout") ||
      pathname.startsWith("/api/auth/password") ||
      pathname.startsWith("/api/auth/campus") ||
      pathname.startsWith("/api/materiales/borrador") ||
      // Registrar su propia solicitud en el historial (el cambio de estado lo valida la ruta: solo admin).
      (pathname.startsWith("/api/materiales/solicitudes") && req.method === "POST");

    if (esApi) {
      if (pathname.startsWith("/api/usuarios") || pathname.startsWith("/api/proveedores") || (!soloLectura && !esLogout)) {
        return NextResponse.json(
          { error: "Tu usuario es de solo lectura" },
          { status: 403 }
        );
      }
    }
  }

  // Proveedores es un directorio común a todos los campus (nombre oficial y RUC de cada empresa): solo lo
  // administra quien ve todos los campus.
  // (Las sugerencias de proveedor del ticket, ?sugerir=1, sí las usa cualquier administrador: son de su campus.)
  if (
    user.campusAsignado !== "*" &&
    pathname.startsWith("/api/proveedores") && req.nextUrl.searchParams.get("sugerir") !== "1"
  ) {
    if (esApi) return NextResponse.json({ error: "Solo para administradores de todos los campus" }, { status: 403 });
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  // Cualquier escritura en tickets (editar, subir un informe, crear desde una OC…) invalida la copia de las
  // notificaciones de esta instancia: al volver a la lista se ven al día, sin esperar los 20 s.
  if (req.method !== "GET" && req.method !== "HEAD" && /^\/api\/(correctivos|ordenes-compra|cotizaciones)/.test(pathname)) {
    (globalThis as typeof globalThis & { __correctivosAvisos?: unknown }).__correctivosAvisos = undefined;
  }

  const res = NextResponse.next();
  // Sesión renovable: si el token tiene más de un día se entrega uno nuevo (otros 7 días). Solo en
  // lecturas (GET): así nunca choca con las rutas que escriben su propia cookie (cambio de contraseña)
  // ni vuelve a crear la que se borra al cerrar sesión.
  if (token && req.method === "GET") {
    try {
      const nuevo = await tokenRenovado(token, user);
      if (nuevo) res.cookies.set(SESSION_COOKIE_NAME, nuevo, OPCIONES_COOKIE);
    } catch (err) {
      console.error("No se pudo renovar la sesión", err);
    }
  }
  return res;
}

export const config = {
  // Los archivos fijos y públicos (logo, ícono, manifiesto, service worker) no pasan por el proxy: así
  // no cuentan como ejecución de middleware en Vercel en cada carga de página.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|logo-upc.png|manifest.webmanifest|sw.js).*)"],
};
