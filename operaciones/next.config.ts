import type { NextConfig } from "next";

// La política de contenido (CSP) de las páginas se genera en src/proxy.ts con un
// nonce distinto en cada petición (ver src/lib/server/csp.ts). Aquí van las
// cabeceras fijas.

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Todas las respuestas (páginas y API).
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // SAMEORIGIN (no DENY): el visor muestra archivos propios en un iframe.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // HTTPS obligatorio durante 1 año (el navegador ignora esta cabecera sobre http).
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          // Aísla la ventana de otras pestañas/sitios y evita que otros sitios incrusten
          // o lean nuestros recursos.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
      // Datos de sesión, usuarios y tickets: que no se guarden en cachés del navegador ni de proxies.
      ...["auth", "usuarios", "correctivos"].map((ruta) => ({
        source: `/api/${ruta}/:path*`,
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      })),
    ];
  },
};

export default nextConfig;
