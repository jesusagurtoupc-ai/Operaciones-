// Prueba la lectura de una o varias órdenes de compra en PDF SIN guardar nada.
//   npx tsx scripts/probar-oc.ts ruta/a/0000168413_PER05.PDF [otra.pdf ...]
// Muestra qué datos se leen y los avisos, para saber por qué una OC no se lee bien.
import fs from "node:fs";
import path from "node:path";
import { leerPdfDeOC } from "../src/lib/server/leerOC";

const archivos = process.argv.slice(2);
if (archivos.length === 0) {
  console.log("Uso: npx tsx scripts/probar-oc.ts archivo.pdf [más.pdf ...]");
  process.exit(1);
}
for (const ruta of archivos) {
  console.log(`\n=== ${path.basename(ruta)}`);
  const r = leerPdfDeOC(fs.readFileSync(ruta), path.basename(ruta));
  if (!r.ok) {
    console.log("NO SE PUDO LEER:", r.error);
    continue;
  }
  const d = r.datos;
  console.log("N° OC:", d.n_oc, "| fecha:", d.f_oc, "| entrega:", d.f_entrega);
  console.log("Proveedor:", d.proveedor, "| RUC:", d.ruc_proveedor, "| contrato:", d.contrato);
  console.log("Moneda:", d.moneda, "| subtotal:", d.subtotal, "| IGV:", d.igv, "| total:", d.total);
  console.log("Líneas:", d.lineas.length, "| fecha ambigua:", d.fecha_ambigua);
  console.log("Descripción:", d.descripcion);
  console.log("Avisos:", d.avisos.length ? d.avisos : "ninguno");
}
