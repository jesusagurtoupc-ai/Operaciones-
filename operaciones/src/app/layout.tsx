import type { Metadata, Viewport } from "next";
import { Inter, Barlow_Condensed, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { getCurrentUser } from "@/lib/server/auth";
import { ProveedorMe, type Me } from "@/lib/client";
import { nombreCampus } from "@/lib/shared";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Los títulos usan font-display + font-bold (peso 700): es el único peso de Barlow que se necesita.
const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  weight: ["700"],
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Correctivos · Orden de Trabajo",
  description: "Sistema de gestión de correctivos de mantenimiento",
  applicationName: "Correctivos",
  // Instalable en el celular (el manifiesto lo genera app/manifest.ts): en iPhone, "Compartir → Agregar a inicio".
  appleWebApp: { capable: true, title: "Correctivos", statusBarStyle: "default" },
  icons: { icon: "/logo-upc.png", apple: "/logo-upc.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#d0112d",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Quién está en sesión (ya validado y en caché por el proxy): el menú sale completo desde el servidor.
  let me: Me | null = null;
  try {
    const u = await getCurrentUser();
    if (u) me = { username: u.username, rol: u.rol, paginas: u.paginas, campus: u.campus, campusPermitidos: u.campusPermitidos, campusAsignado: u.campusAsignado };
  } catch {
    /* sin sesión o base no disponible: el menú se completa desde el navegador como antes */
  }
  return (
    <html lang="es">
      <body
        className={`${inter.variable} ${barlowCondensed.variable} ${plexMono.variable} antialiased`}
      >
        <ProveedorMe me={me}>{children}</ProveedorMe>
        {me && (
          // Pie común a las páginas con sesión: identifica el sistema y el campus que se está viendo.
          <footer className="no-print border-t border-line mt-10">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 pb-20 sm:pb-4 flex flex-wrap justify-between gap-2 text-[11px] text-ink-soft">
              <span>Sistema de Correctivos · Operaciones e Infraestructura · Laureate Perú</span>
              <span>{nombreCampus(me.campus)}</span>
            </div>
          </footer>
        )}
      </body>
    </html>
  );
}
