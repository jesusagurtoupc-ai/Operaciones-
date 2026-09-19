import { NextRequest, NextResponse } from "next/server";
import { verifyToken, SESSION_COOKIE_NAME } from "@/lib/auth";

// Next.js 16 renombró "middleware" a "proxy" (misma función: intercepta
// la petición antes de renderizar la ruta). Ver:
// https://nextjs.org/docs/messages/middleware-to-proxy
//
// El runtime de "proxy" es siempre Node.js (a diferencia del antiguo
// middleware, que corría en edge con APIs limitadas), así que aquí sí
// se puede reutilizar la verificación de sesión de lib/auth.ts en vez
// de duplicar la lógica de jwtVerify.
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic =
    pathname === "/login" ||
    pathname.startsWith("/api/auth/login") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon");

  if (isPublic) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;

  if (!session) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
