import type { MetadataRoute } from "next";

/**
 * Manifiesto de la app (/manifest.webmanifest): permite instalarla en la pantalla de inicio del celular
 * (Android/Chrome: menú ⋮ → "Instalar app" o "Agregar a la pantalla principal"; iPhone/Safari: Compartir →
 * "Agregar a inicio"). Se abre a pantalla completa, sin la barra del navegador, directo en Correctivos.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Correctivos · Mantenimiento",
    short_name: "Correctivos",
    description: "Correctivos, materiales y proveedores de mantenimiento",
    id: "/",
    start_url: "/correctivos",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#d0112d",
    lang: "es-PE",
    icons: [
      { src: "/logo-upc.png", sizes: "256x256", type: "image/png", purpose: "any" },
      { src: "/icon.png", sizes: "128x128", type: "image/png", purpose: "any" },
    ],
    shortcuts: [
      { name: "Correctivos", url: "/correctivos" },
      { name: "Materiales", url: "/materiales" },
      { name: "Panel", url: "/dashboard" },
    ],
  };
}
