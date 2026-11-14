import ListaCorrectivos, { type ListaInicial } from "@/components/lista/ListaCorrectivos";
import { getCurrentUser } from "@/lib/server/auth";
import { consultarLista } from "@/lib/server/lista";
import { construirParams, leerFiltros } from "@/components/lista/filtrosLista";

// Siempre con datos frescos: depende de la sesión y de la base de datos.
export const dynamic = "force-dynamic";

/**
 * La primera página de la lista se consulta aquí, en el servidor, y llega ya dentro del HTML:
 * el navegador no tiene que cargar primero la página y después pedir los datos. Si algo falla,
 * la lista se pide desde el navegador como antes.
 *
 * Los filtros y la página vienen en la dirección (/correctivos?estado=…&page=2): al volver de un
 * ticket la lista se arma ya filtrada, tal como se dejó.
 */
export default async function CorrectivosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const crudo = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(crudo)) {
    for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) sp.append(k, x);
  }
  const { filtros, pagina } = leerFiltros(sp);

  let inicial: ListaInicial | null = null;
  // La papelera (solo administradores) la pide el navegador: la ruta de la API decide quién puede verla.
  if (!filtros.papelera) {
    try {
      if (await getCurrentUser()) {
        const params = new URLSearchParams(construirParams(filtros, pagina, false).toString());
        const datos = await consultarLista(params, { papelera: false });
        // Pasa por JSON para que tenga EXACTAMENTE la forma de la respuesta de la API.
        inicial = JSON.parse(JSON.stringify(datos)) as ListaInicial;
      }
    } catch (e) {
      console.error("No se pudo preparar la primera página de la lista", e);
    }
  }
  return <ListaCorrectivos inicial={inicial} filtrosIniciales={filtros} paginaInicial={pagina} />;
}
