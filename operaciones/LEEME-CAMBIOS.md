# correctivos-app: solo los archivos que cambiaron

Descomprime este zip DENTRO de la carpeta `correctivos-app/` de tu proyecto, aceptando reemplazar
los archivos que ya existen (las rutas coinciden con las del proyecto). Después:

1. `npm install`  (agrega pdfjs-dist y actualiza package-lock.json)
2. Vuelve a desplegar. La base de datos se actualiza sola en el primer arranque.

Archivos (nuevos = ya no existían):
- src/components/ticket/CorrectivoForm.tsx  (modificado)
- src/components/ticket/TicketImprimible.tsx  (modificado)
- src/app/api/correctivos/route.ts  (modificado)
- src/app/api/correctivos/[id]/route.ts  (modificado)
- src/app/api/correctivos/[id]/archivos/route.ts  (modificado)
- src/app/api/correctivos/[id]/archivos/[archivoId]/route.ts  (modificado)
- src/app/api/export/route.ts  (modificado)
- src/lib/shared/types.ts  (modificado)
- src/lib/server/validar.ts  (modificado)
- src/lib/server/historial.ts  (modificado)
- src/lib/server/db.ts  (modificado)
- src/lib/server/filtros.ts  (modificado)
- scripts/schema.sql  (modificado)
- package.json  (modificado)
- src/lib/shared/ordenCompra.ts  (NUEVO)
- src/lib/client/leerPdf.ts  (NUEVO)
- src/lib/shared/cotizacion.ts  (NUEVO)
