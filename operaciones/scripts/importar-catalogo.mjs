// Convierte el Excel del catálogo de materiales en public/catalogo-materiales.json, que usa la
// página "Materiales" (búsqueda local en el navegador, sin consultar la base de datos).
//
//   node scripts/importar-catalogo.mjs ruta/al/catalogo.xlsx [nombre-de-la-hoja]
//
// Lee la hoja "catalogo" (o la que indiques; si no existe, la primera). Busca solo el renglón de
// encabezados (puede haber títulos encima) y toma las columnas por su nombre, así que no importa el
// orden. Columnas esperadas: Id Articulo, Descripción, Categoria, Nombre Categoria, Id Proveedor,
// Nombre Proveedor, MONEDA, Precio (sin igv), Fecha de vencimiento, Cantidad minima, Tiempo de entrega.
// Los datos que se repiten (proveedor, categoría, moneda, vencimiento) se guardan una sola vez.
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

const origen = process.argv[2];
if (!origen) {
  console.error("Uso: node scripts/importar-catalogo.mjs ruta/al/catalogo.xlsx [hoja]");
  process.exit(1);
}
const libro = XLSX.read(fs.readFileSync(origen), { type: "buffer", cellDates: true });
const nombreHoja = process.argv[3] || (libro.SheetNames.includes("catalogo") ? "catalogo" : libro.SheetNames[0]);
const hoja = libro.Sheets[nombreHoja];
if (!hoja) {
  console.error(`No existe la hoja "${nombreHoja}". Hojas: ${libro.SheetNames.join(", ")}`);
  process.exit(1);
}
const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: null });

const norm = (t) =>
  String(t ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

// Renglón de encabezados: el primero (entre los 30 primeros) que tenga "id articulo" y "precio".
const iCab = filas.slice(0, 30).findIndex((f) => {
  const t = f.map(norm);
  return t.some((x) => x.startsWith("id art")) && t.some((x) => x.startsWith("precio"));
});
if (iCab < 0) {
  console.error('No encontré el renglón de encabezados (debe tener "Id Articulo" y "Precio").');
  process.exit(1);
}
const cab = filas[iCab].map(norm);
const col = (...pistas) => cab.findIndex((x) => pistas.some((p) => x.startsWith(p)));
const C = {
  articulo: col("id art"),
  descripcion: col("descrip"),
  categoria: col("nombre cat"),
  categoriaCodigo: col("categ"), // la columna "Categoria" (código, p. ej. S030604)
  provId: col("id prov"),
  provNombre: col("nombre prov"),
  moneda: col("moneda"),
  precio: col("precio"),
  vence: col("fecha de venc", "vencim"),
  minimo: col("cantidad min"),
  entrega: col("tiempo de entrega"),
};
for (const [k, v] of Object.entries(C)) {
  if (v < 0 && k !== "categoriaCodigo") { // el código de categoría es opcional
    console.error(`Falta la columna "${k}" en el encabezado: ${filas[iCab].join(" | ")}`);
    process.exit(1);
  }
}
// Título del catálogo: texto suelto en los renglones de arriba del encabezado.
const titulo =
  filas
    .slice(0, iCab)
    .flat()
    .find((x) => typeof x === "string" && x.trim().length > 8)
    ?.trim() ?? nombreHoja;

const limpiar = (t) => String(t ?? "").replace(/[\u00a0\s]+/g, " ").trim();
const dic = { prov: new Map(), cat: new Map(), mon: new Map(), venc: new Map() };
const indice = (mapa, clave, valor) => {
  if (!mapa.has(clave)) mapa.set(clave, { i: mapa.size, valor });
  return mapa.get(clave).i;
};
const fecha = (v) => (v instanceof Date && !isNaN(v) ? v.toISOString().slice(0, 10) : "");

const items = [];
const vistos = new Set();
let descartadas = 0;
for (const f of filas.slice(iCab + 1)) {
  const articulo = limpiar(f[C.articulo]);
  const descripcion = limpiar(f[C.descripcion]);
  const precio = typeof f[C.precio] === "number" ? f[C.precio] : Number(String(f[C.precio] ?? "").replace(",", "."));
  if (!articulo || !descripcion || !Number.isFinite(precio) || precio < 0 || vistos.has(articulo)) {
    if (articulo || descripcion) descartadas++;
    continue;
  }
  vistos.add(articulo);
  const prov = {
    id: limpiar(f[C.provId]),
    nombre: limpiar(f[C.provNombre]),
    minimo: limpiar(f[C.minimo]),
    entrega: limpiar(f[C.entrega]),
  };
  items.push([
    articulo,
    descripcion,
    Math.round(precio * 10000) / 10000,
    indice(dic.prov, JSON.stringify(prov), prov),
    indice(dic.cat, limpiar(f[C.categoria]), { nombre: limpiar(f[C.categoria]), codigo: limpiar(f[C.categoriaCodigo]) }),
    indice(dic.mon, limpiar(f[C.moneda]) || "PEN", limpiar(f[C.moneda]) || "PEN"),
    indice(dic.venc, fecha(f[C.vence]), fecha(f[C.vence])),
  ]);
}
const lista = (m) => [...m.values()].sort((a, b) => a.i - b.i).map((x) => x.valor);
const salida = {
  version: 1,
  titulo,
  generado: new Date().toISOString().slice(0, 10),
  proveedores: lista(dic.prov),
  categorias: lista(dic.cat).map((c) => c.nombre),
  categoriasCodigo: lista(dic.cat).map((c) => c.codigo),
  monedas: lista(dic.mon),
  vencimientos: lista(dic.venc),
  items,
};
const destino = path.join(process.cwd(), "public", "catalogo-materiales.json");
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, JSON.stringify(salida));
const kb = Math.round(fs.statSync(destino).size / 1024);
console.log(`Catálogo: "${titulo}"`);
console.log(`${items.length} artículos · ${salida.proveedores.length} proveedor(es) · ${salida.monedas.join("/")} · vencimientos: ${salida.vencimientos.join(", ")}`);
console.log(`Descartadas por datos incompletos o repetidas: ${descartadas}`);
console.log(`Escrito ${destino} (${kb} KB)`);
