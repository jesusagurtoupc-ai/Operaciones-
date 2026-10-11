// Política de contenido (CSP) de las PÁGINAS, con un nonce distinto en cada petición.
// No se aplica a /api: allí se sirven los PDF adjuntos y una CSP estricta puede
// impedir que el visor del navegador los abra.
//
//  - script-src: solo scripts con el nonce de esta petición ('strict-dynamic' deja que
//    esos scripts carguen los suyos). Ya NO se permite 'unsafe-inline' en scripts.
//  - style-src conserva 'unsafe-inline': Next.js y los gráficos (recharts) inyectan
//    estilos propios, y el riesgo de un estilo inyectado es mucho menor que el de un script.
//  - frame-src 'self' y blob:: el visor de documentos muestra PDF del propio sitio
//    (descargados como blob) en un iframe.

export function nuevoNonce(): string {
  return btoa(crypto.randomUUID());
}

export function construirCsp(nonce: string, produccion: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${produccion ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}
