import ListaCorrectivos, { type ListaInicial } from "@/components/lista/ListaCorrectivos";
import { getCurrentUser } from "@/lib/server/auth";
import { consultarLista } from "@/lib/server/lista";
import { FILTROS_VACIOS, construirParams } from "@/components/lista/filtrosLista";

// Siempre con datos frescos: depende de la sesión y de la base de datos.
export const dynamic = "force-dynamic";

/**
 * La primera página de la lista se consulta aquí, en el servidor, y llega ya dentro del HTML:
 * el navegador no tiene que cargar primero la página y después pedir los datos. Si algo falla,
 * la lista se pide desde el navegador como antes.
 */
export default async function CorrectivosPage() {
  let inicial: ListaInicial | null = null;
  try {
    if (await getCurrentUser()) {
      const params = new URLSearchParams(construirParams(FILTROS_VACIOS, 1, false).toString());
      const datos = await consultarLista(params, { papelera: false });
      // Pasa por JSON para que tenga EXACTAMENTE la forma de la respuesta de la API.
      inicial = JSON.parse(JSON.stringify(datos)) as ListaInicial;
    }
  } catch (e) {
    console.error("No se pudo preparar la primera página de la lista", e);
  }
  return <ListaCorrectivos inicial={inicial} />;
}
