import type { Metadata } from "next";
import { Inter, Barlow_Condensed, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { getCurrentUser } from "@/lib/server/auth";
import { ProveedorMe, type Me } from "@/lib/client";

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
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Quién está en sesión (ya validado y en caché por el proxy): el menú sale completo desde el servidor.
  let me: Me | null = null;
  try {
    const u = await getCurrentUser();
    if (u) me = { username: u.username, rol: u.rol, paginas: u.paginas };
  } catch {
    /* sin sesión o base no disponible: el menú se completa desde el navegador como antes */
  }
  return (
    <html lang="es">
      <body
        className={`${inter.variable} ${barlowCondensed.variable} ${plexMono.variable} antialiased`}
      >
        <ProveedorMe me={me}>{children}</ProveedorMe>
      </body>
    </html>
  );
}
