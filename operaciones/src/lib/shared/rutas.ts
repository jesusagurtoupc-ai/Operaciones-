/**
 * Destino seguro tras iniciar sesión (parámetro `next`). Solo se aceptan rutas internas.
 * Los navegadores ELIMINAN tabuladores y saltos de línea al interpretar una URL, así que
 * "/<TAB>/evil.com" se convierte en "//evil.com" (otro sitio): por eso se rechazan los
 * caracteres de control, los espacios y las barras invertidas, y además se resuelve la
 * ruta como lo haría el navegador y se exige que siga siendo del mismo origen.
 */
export function rutaInternaSegura(pedido: string | null | undefined, porDefecto = "/dashboard"): string {
  const p = pedido ?? "";
  if (!p.startsWith("/") || /[\u0000-\u001f\u007f\\\s]/.test(p)) return porDefecto;
  try {
    const base = "http://interno.invalid";
    const u = new URL(p, base);
    if (u.origin !== base) return porDefecto;
    return u.pathname + u.search + u.hash;
  } catch {
    return porDefecto;
  }
}
