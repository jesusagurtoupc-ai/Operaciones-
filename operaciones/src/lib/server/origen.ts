// Verificación de Origin en peticiones que modifican datos (defensa en profundidad
// contra CSRF; sameSite=lax ya cubre la mayoría de casos).

const METODOS_SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * true si la petición puede continuar. Un POST/PUT/PATCH/DELETE cuya cabecera Origin
 * existe y NO coincide con el host del sitio se rechaza. Sin cabecera Origin se acepta
 * (clientes que no son navegadores); los navegadores siempre la envían en estos métodos.
 */
export function origenValido(req: Request): boolean {
  if (METODOS_SEGUROS.has(req.method.toUpperCase())) return true;
  const origen = req.headers.get("origin");
  if (origen === null) return true;
  let host: string;
  try {
    host = new URL(origen).host;
  } catch {
    return false; // incluye el literal "null" (iframes aislados, redirecciones entre sitios)
  }
  const propios = [req.headers.get("x-forwarded-host"), req.headers.get("host"), new URL(req.url).host]
    .filter((h): h is string => !!h)
    .map((h) => h.split(",")[0].trim().toLowerCase());
  return propios.includes(host.toLowerCase());
}
