/**
 * IP del cliente. Las cabeceras de reenvío (`x-real-ip`, `x-forwarded-for`) las puede
 * escribir cualquier cliente si no hay un proxy de confianza delante, y entonces rotarlas
 * permitiría esquivar el límite de intentos. Por eso solo se leen:
 *  - en Vercel (VERCEL=1: la plataforma pone `x-vercel-forwarded-for` y el cliente no puede falsearla), o
 *  - si defines TRUST_PROXY=1 porque SABES que tu proxy las sobrescribe.
 * En otro caso todas las peticiones comparten la IP "desconocida" (los límites por usuario siguen valiendo).
 */
export function ipCliente(req: Request): string {
  // Esa cabecera solo es de fiar si la app corre en Vercel (la plataforma la sobrescribe).
  // Fuera de Vercel cualquier cliente podría inventarla y rotarla para esquivar los límites.
  if (process.env.VERCEL === "1") {
    const vercel = req.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim();
    if (vercel) return vercel;
  }
  if (process.env.TRUST_PROXY === "1") {
    return (
      req.headers.get("x-real-ip")?.trim() ||
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      "desconocida"
    );
  }
  if (process.env.NODE_ENV === "production" && !avisado) {
    avisado = true;
    console.warn("ipCliente: sin cabecera de Vercel ni TRUST_PROXY=1; los intentos de login comparten una sola IP.");
  }
  return "desconocida";
}

let avisado = false;
