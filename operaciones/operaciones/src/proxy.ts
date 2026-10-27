import { NextRequest, NextResponse } from "next/server";
import { getUserFromToken, SESSION_COOKIE_NAME } from "@/lib/server/auth";

// Next.js 16 renombró "middleware" a "proxy". Corre en Node.js, así que
// puede consultar la base de datos para validar rol y estado del usuario.
//
// Reglas de acceso:
//  - Sin sesión válida: a /login (páginas) o 401 (API).
//  - Rol "lectura": solo puede leer. Cualquier método que no sea
//    GET/HEAD en /api devuelve 403 (excepto cerrar sesión), y no puede
//    entrar a /correctivos/nuevo ni a la administración de usuarios.
//  - Rol "admin": acceso total.
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic =
    pathname === "/login" ||
    pathname.startsWith("/api/auth/login") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/icon.png" ||
    pathname === "/logo-upc.png";

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

  if (user.rol !== "admin") {
    const soloLectura = req.method === "GET" || req.method === "HEAD";
    const esLogout =
      pathname.startsWith("/api/auth/logout") ||
      pathname.startsWith("/api/auth/password");

    if (esApi) {
      if (pathname.startsWith("/api/usuarios") || (!soloLectura && !esLogout)) {
        return NextResponse.json(
          { error: "Tu usuario es de solo lectura" },
          { status: 403 }
        );
      }
    } else if (pathname.startsWith("/usuarios")) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    } else if (pathname.startsWith("/correctivos/nuevo")) {
      return NextResponse.redirect(new URL("/correctivos", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
