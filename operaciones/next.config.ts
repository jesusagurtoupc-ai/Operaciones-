import type { NextConfig } from "next";

const esDev = process.env.NODE_ENV !== "production";

// Política de contenido (CSP) para las PÁGINAS de la app.
//  - 'unsafe-inline' en script/style: Next.js inyecta scripts de arranque en línea y recharts usa
//    estilos en línea. Una CSP estricta con nonce obligaría a renderizar todo de forma dinámica.
//  - 'unsafe-eval' solo en desarrollo (React lo usa para las herramientas de depuración).
//  - blob: en img-src y frame-src: el visor de documentos (Documentos.tsx) abre PDFs e imágenes
//    mediante URL.createObjectURL.
//  - No se define object-src a propósito: en Chrome puede impedir que se vea un PDF dentro del iframe.
//  - Las fuentes de next/font se descargan al compilar y se sirven desde el propio dominio.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${esDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

// Cabeceras para TODAS las rutas (páginas y API).
// X-Frame-Options en SAMEORIGIN (no DENY) porque el visor de documentos incrusta un iframe propio.
const cabecerasGenerales = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Cámara solo para la propia app: escanear el QR de un equipo desde el ticket.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // "/" abre el Panel (antes lo hacía src/app/page.tsx).
  async redirects() {
    return [
      { source: "/", destination: "/dashboard", permanent: false },
      { source: "/gestion", destination: "/gestion/garantias", permanent: false },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: cabecerasGenerales },
      // Catálogos de materiales (public/): cambian rara vez, así que el navegador los reutiliza 1 hora
      // y, pasado ese tiempo, los muestra al instante mientras revisa en segundo plano si hay versión nueva.
      // "private" porque van detrás del inicio de sesión: ninguna caché compartida debe guardarlos.
      {
        source: "/:archivo(catalogo-materiales|materiales-fuera-catalogo).json",
        headers: [{ key: "Cache-Control", value: "private, max-age=3600, stale-while-revalidate=86400" }],
      },
      // El service worker (uso sin internet) siempre se revisa contra el servidor: así una versión nueva
      // llega en la siguiente visita.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      // Logo: el navegador lo reutiliza 7 días sin volver a preguntar (antes lo revalidaba en cada página).
      { source: "/logo-upc.png", headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }] },
      // La CSP solo va en las páginas: las respuestas de /api (JSON, PDFs, Excel) no la necesitan,
      // y aplicarla a un PDF servido puede estorbar al visor del navegador.
      {
        source: "/((?!api/).*)",
        headers: [{ key: "Content-Security-Policy", value: csp }],
      },
    ];
  },
};

export default nextConfig;
