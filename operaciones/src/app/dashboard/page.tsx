import Panel from "@/components/dashboard/Panel";
import type { DashboardData } from "@/components/dashboard/Panel";
import { getCurrentUser } from "@/lib/server/auth";
import { calcularPanel } from "@/lib/server/lista";

// Siempre con datos frescos: depende de la sesión y de la base de datos.
export const dynamic = "force-dynamic";

/**
 * El panel se calcula aquí, en el servidor, y llega ya dentro del HTML (antes el navegador cargaba la
 * página, después el código y recién entonces pedía los datos). Si algo falla, el panel los pide como antes.
 */
export default async function DashboardPage() {
  let inicial: DashboardData | null = null;
  try {
    const user = await getCurrentUser();
    if (user) inicial = JSON.parse(JSON.stringify(await calcularPanel(user.rol === "admin"))) as DashboardData;
  } catch (e) {
    console.error("No se pudo preparar el panel", e);
  }
  return <Panel inicial={inicial} />;
}
