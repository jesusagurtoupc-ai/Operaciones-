import { NextRequest, NextResponse } from "next/server";
import { getUserFromToken, tokenRenovado, SESSION_COOKIE_NAME } from "@/lib/server/auth";
import { construirCsp, nuevoNonce } from "@/lib/server/csp";
import { origenValido } from "@/lib/server/origen";
import { adminSinMfa } from "@/lib/server/reauth";

// Next.js 16 renombró "middleware" a "proxy". Corre en Node.js, así que
// puede consultar la base de datos para validar rol y estado del usuario.
//
// Reglas de acceso:
//  - Sin sesión válida: a /login (páginas) o 401 (API).
//  - Rol "lectura": solo puede leer. Cualquier método que no sea
//    GET/HEAD en /api devuelve 403 (excepto cerrar sesión), y no puede
//    entrar a /correctivos/nuevo ni a la administración de usuarios.
//  - Rol "admin": acceso total.
//  - Usuario con clave temporal (debeCambiarClave): solo puede cambiarla o salir.
//  - La sesión se renueva sola mientras se usa (ver tokenRenovado).
export async function proxy(req: NextRequest) {
  const decision = await decidir(req);
  let respuesta: NextResponse;
  if (decision) {
    respuesta = decision; // redirección o error: no lleva CSP
  } else if (req.nextUrl.pathname.startsWith("/api")) {
    respuesta = NextResponse.next();
  } else {
    // Páginas: CSP con nonce propio de esta petición. Next.js lee el nonce de la
    // cabecera de la PETICIÓN y se lo pone a sus scripts; el navegador recibe la
    // misma política en la RESPUESTA.
    const csp = construirCsp(nuevoNonce(), process.env.NODE_ENV === "production");
    const cabeceras = new Headers(req.headers);
    cabeceras.set("Content-Security-Policy", csp);
    respuesta = NextResponse.next({ request: { headers: cabeceras } });
    respuesta.headers.set("Content-Security-Policy", csp);
  }
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  // Solo se renueva si la petición fue aceptada (no redirección ni error).
  if (token && respuesta.status === 200 && !respuesta.headers.has("x-middleware-rewrite")) {
    try {
      const nuevo = await tokenRenovado(token);
      if (nuevo) respuesta.cookies.set(SESSION_COOKIE_NAME, nuevo.token, nuevo.opciones);
    } catch (err) {
      console.error(err); // renovar es opcional: no debe romper la petición
    }
  }
  return respuesta;
}

/** Devuelve la respuesta final (redirección/error), o null si la petición puede continuar. */
async function decidir(req: NextRequest): Promise<NextResponse | null> {
  const { pathname } = req.nextUrl;

  // Antes de todo (también en /api/auth/login): una escritura que venga de otro sitio se rechaza.
  if (!origenValido(req)) {
    return pathname.startsWith("/api")
      ? NextResponse.json({ error: "Origen no permitido" }, { status: 403 })
      : new NextResponse("Origen no permitido.", { status: 403 });
  }

  const isPublic =
    pathname === "/login" ||
    pathname.startsWith("/api/auth/login") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/icon.png" ||
    pathname === "/logo-upc.png";

  if (isPublic) {
    return null;
  }

  const esApi = pathname.startsWith("/api");
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;

  let user = null;
  try {
    // En escrituras (POST/PUT/PATCH/DELETE) se consulta SIEMPRE la base: un cambio de rol o una
    // desactivación aplica al instante en cualquier instancia, sin esperar a la caché de lectura.
    const escritura = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    user = token ? await getUserFromToken(token, escritura) : null;
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

  if (user.debeCambiarClave) {
    const permitida =
      pathname.startsWith("/api/auth/password") ||
      pathname.startsWith("/api/auth/logout") ||
      pathname.startsWith("/api/auth/me");
    if (esApi) {
      if (!permitida) {
        return NextResponse.json(
          { error: "Debes cambiar tu contraseña temporal antes de continuar", codigo: "CAMBIAR_CLAVE" },
          { status: 403 }
        );
      }
    } else if (pathname !== "/cambiar-clave") {
      return NextResponse.redirect(new URL("/cambiar-clave", req.url));
    }
  } else if (pathname === "/cambiar-clave") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  // REQUIRE_ADMIN_MFA=1: un administrador sin verificación en dos pasos solo puede activarla
  // (o cambiar su clave y salir). Las páginas cargan para mostrar el aviso, pero la API no responde.
  if (esApi && adminSinMfa(user)) {
    const permitida =
      pathname.startsWith("/api/auth/mfa") ||
      pathname.startsWith("/api/auth/me") ||
      pathname.startsWith("/api/auth/password") ||
      pathname.startsWith("/api/auth/logout");
    if (!permitida) {
      return NextResponse.json(
        { error: "Activa la verificación en dos pasos (botón 2FA) para continuar", codigo: "MFA_REQUERIDO" },
        { status: 403 }
      );
    }
  }

  if (user.rol !== "admin") {
    const soloLectura = req.method === "GET" || req.method === "HEAD";
    const esLogout =
      pathname.startsWith("/api/auth/logout") ||
      pathname.startsWith("/api/auth/password") ||
      pathname.startsWith("/api/auth/mfa"); // cualquier usuario puede proteger SU cuenta

    if (esApi) {
      if (pathname.startsWith("/api/usuarios") || (!soloLectura && !esLogout)) {
        return NextResponse.json(
          { error: "Tu usuario es de solo lectura" },
          { status: 403 }
        );
      }
    } else if (pathname.startsWith("/usuarios")) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    } else if (
      pathname.startsWith("/correctivos/nuevo") ||
      pathname.startsWith("/correctivos/eliminados")
    ) {
      return NextResponse.redirect(new URL("/correctivos", req.url));
    }
  }

  return null;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
