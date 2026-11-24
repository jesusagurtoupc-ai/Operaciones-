// Junta los documentos de una carga (OC, cotizaciones, informes, certificados, guías…) por TRABAJO:
// compara N° de OC, N° de cotización, RUC del proveedor, montos, fechas, la descripción y la carpeta de
// cada archivo, contra los demás documentos de la carga y contra los tickets que ya existen.
// No toca nada: devuelve una propuesta que la persona revisa antes de aplicar. Funciona en el navegador.
import type { Correctivo, DocumentoLeido } from "@/lib/shared";
import { normNumCotizacion, numeroOc } from "@/lib/shared";

export type DocCarga = {
  id: number;
  nombre: string;
  /** Carpeta del trabajo (si se cargó una carpeta), o null. */
  carpeta: string | null;
  /** Huella del contenido (SHA-256): dos archivos iguales son el mismo documento. */
  huella: string;
  leido: DocumentoLeido | null;
  error?: string;
};

export type Destino = {
  clave: string;
  /** Ticket que ya existe (o null: se creará). */
  ticket: Correctivo | null;
  /** OC de esta carga que crea / completa el ticket. */
  oc: DocCarga | null;
  /** Cotización de esta carga que crea el ticket (cuando no hay OC). */
  cotNueva: DocCarga | null;
  ocNum: string;
  ruc: string | null;
  monto: number | null;
  fecha: string | null;
  tokens: Set<string>;
  cots: Set<string>;
  carpetas: Set<string>;
  /** N° de cotización que cita la propia OC ("conforme a cotización…"). */
  cotsOc: Set<string>;
  /** Los mismos N° de cotización tal como se escribieron (para comparar "de fondo"). */
  cotsTexto: Set<string>;
  /** Por qué no se puede aplicar (p. ej. la OC ya está en dos tickets). */
  conflicto?: string;
  /** Palabras propias del nombre del proveedor. */
  empresa: string[];
  /** Cómo se llegó al ticket existente (para mostrarlo). */
  motivoTicket?: string;
};

export type Asignacion = {
  doc: DocCarga;
  destino: string | null;
  puntos: number;
  motivo: string;
  /** false = coincidencia débil o con otra casi igual: conviene revisarla. */
  seguro: boolean;
  /** Un informe o certificado que cubre DOS trabajos (p. ej. "tablero de monóxido Y correctivo IIEE"): también va aquí. */
  tambien?: string | null;
  alternativas: { destino: string; puntos: number; motivo: string }[];
};

export type Agrupacion = {
  destinos: Destino[];
  /** Todo documento que no es la OC ni la cotización que crea el ticket. */
  asignaciones: Asignacion[];
  duplicados: { doc: DocCarga; de: DocCarga }[];
  errores: DocCarga[];
};

/* ───────── Palabras para comparar descripciones ───────── */
const VACIAS = new Set(
  (
    "de del la las el los y e o u en para por con al a su sus se un una uno que lo como mas segun sobre " +
    "upc upn san isidro salaverry miguel campus sede av atender contacto email telefono cel nicolas mayo jesus " +
    "agurto quinones pedro aroni arone giovanni giamcarlo reategui universidad peruana ciencias aplicadas cliente " +
    "correctivo correctivos co mantenimiento servicio servicios trabajo trabajos informe informes tecnico tecnica " +
    "cotizacion coti cot proforma presupuesto pdf docx doc rev rev01 revision oc per05 orden compra sac s.a.c eirl " +
    "srl peru lima atencion fecha nro num numero mc pab pabellon piso nivel suministro cambio instalacion reparacion " +
    "compra urgencia materiales material general generales varios conforme incluye total item salv jaq ago gp nm ja " +
    "hvc mhvc msg mpi refriperu documento final ver version v1 sm tcnico tcnica cnico informacion cotizacin atencin " +
    // palabras del TIPO de documento, no del trabajo
    "certificado certif acta conformidad operatividad presupuesto reporte requerimiento ficha guia remision " +
    "preventivo correctiva correctivas actividades datos objetivo antecedentes anexo fotografico"
  ).split(" ")
);
const SINONIMOS: Record<string, string> = {
  varones: "hombre", varon: "hombre", caballeros: "hombre", caballero: "hombre", hombres: "hombre",
  damas: "mujer", mujeres: "mujer", sshh: "bano", "ss.hh": "bano", ss: "bano", hh: "bano", banos: "bano", servicios_higienicos: "bano",
  aa: "aire", a_a: "aire", acondicionado: "aire", filtraciones: "filtracion", fuga: "filtracion", fugas: "filtracion",
  luminarias: "luminaria", luces: "luminaria", fluorescentes: "fluorescente", termostatos: "termostato",
  bao: "bano", baos: "bano", sot: "sotano", sotanos: "sotano", of: "oficina", ofic: "oficina",
  mamparas: "mampara", lunas: "luna", vidrios: "vidrio", iee: "iiee", corrrectivo: "correctivo",
};
const RAIZ = 6; // se comparan las primeras letras: "filtracion" = "filtraci(o)n" del nombre de archivo = "filtra"

export function palabras(t: string | null | undefined): Set<string> {
  const base = String(t ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ss\.?\s?hh\.?/g, " sshh ")
    // Ubicación: "piso 3" → piso3, "pabellón A" → paba, "aula 102" → a102 (distinguen trabajos parecidos).
    .replace(/\bpiso\s*n?[°º]?\s*0?(\d{1,2})\b/g, " piso$1 ")
    .replace(/\bpab(?:ellon)?\.?\s*["'“”]?\s*([ab])\b(?![a-z])/g, " pab$1 ")
    .replace(/\baula\s*([a-z]?)\s*-?\s*(\d{3})\s*([a-z]?)\b/g, (_m, a: string, n: string, b: string) => ` ${(a || b || "") + n} `)
    .replace(/\b([ab])\s*-\s*(\d{3})\b/g, " $1$2 ")
    .replace(/[^a-z0-9ñ]+/g, " ");
  const out = new Set<string>();
  for (let w of base.split(" ")) {
    if (!w) continue;
    w = w.replace(/ñ/g, "n");
    if (/^\d+$/.test(w)) continue; // números sueltos: no describen el trabajo (fechas, cantidades)
    w = SINONIMOS[w] ?? w;
    if (w.length < 3 && !/\d/.test(w)) continue;
    if (VACIAS.has(w)) continue;
    if (w.length > 4 && /[^aeiou]es$/.test(w)) w = w.slice(0, -2);
    else if (w.length > 4 && w.endsWith("s")) w = w.slice(0, -1);
    w = SINONIMOS[w] ?? w;
    if (VACIAS.has(w) || VACIAS.has(w.slice(0, RAIZ))) continue;
    // Los códigos (a617, hsvlaureate005) se guardan enteros; las palabras, por su raíz.
    out.add(/\d/.test(w) ? w : w.slice(0, RAIZ));
  }
  return out;
}

/**
 * Cuántos trabajos (OC y tickets) usan cada palabra: una palabra que solo aparece en UN trabajo
 * ("cortafuego", "melamine", "saf") lo identifica mucho mejor que "agua" o "puerta".
 */
let frecuencia = new Map<string, number>();
export function fijarFrecuencias(destinos: { tokens: Set<string> }[]) {
  frecuencia = new Map();
  for (const d of destinos) for (const w of d.tokens) frecuencia.set(w, (frecuencia.get(w) ?? 0) + 1);
}
const unica = (w: string) => frecuencia.get(w) === 1;

/** Parecido de dos descripciones (0 a 1): palabras en común / palabras de la más corta (mínimo 3). */
export function parecido(a: Set<string>, b: Set<string>): { valor: number; comunes: string[]; codigos: number; unicas: number } {
  if (a.size === 0 || b.size === 0) return { valor: 0, comunes: [], codigos: 0, unicas: 0 };
  const comunes = [...a].filter((w) => b.has(w));
  // Un código en común (A617, HSVLAUREATE005) vale por sí solo.
  const codigos = comunes.filter((w) => /\d/.test(w) && /[a-z]/.test(w) && w.length >= 4 && !/^(piso|pab)/.test(w)).length;
  const unicas = comunes.filter((w) => unica(w) && !/^(piso|pab)/.test(w)).length;
  if (comunes.length < 2 && codigos === 0 && unicas === 0) return { valor: 0, comunes, codigos, unicas };
  const valor = comunes.length >= 2 ? comunes.length / Math.max(3, Math.min(a.size, b.size, 8)) : 0.5;
  return { valor, comunes, codigos, unicas };
}

/** Palabras propias del nombre de un proveedor ("WILARCON SERVICIOS SAC" → wilarcon). */
const GENERICAS_EMPRESA = new Set(
  ("sac s.a.c eirl e.i.r.l srl s.r.l sa s.a peru del de la los las y e servicios servicio generales general inversiones " +
    "comercial mantenimiento proyectos constructora industriales industrial solutions soluciones corporation corporacion " +
    "grupo empresa ingenieria construccion construcciones diseno tecnica tecnico sistemas system systems power electronics " +
    "electro import export internacional international").split(" ")
);
export function clavesEmpresa(nombre: string | null | undefined): string[] {
  return String(nombre ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !GENERICAS_EMPRESA.has(w));
}

/** ¿El monto de la cotización es el de la OC? (con o sin IGV: a veces se lee el subtotal como total). */
function montosCoinciden(total: number | null, subtotal: number | null, monto: number): boolean {
  const cerca = (x: number | null) => x !== null && Math.abs(x - monto) <= 1;
  return cerca(total) || cerca(total !== null ? total * 1.18 : null) || cerca(subtotal !== null ? subtotal * 1.18 : null);
}

const diasEntre = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;
const unir = (a: Set<string>, b: Iterable<string>) => { for (const x of b) a.add(x); };

/** N° de cotización que cita un texto ("…CONFORME A COTIZACIÓN Nº 421-2026/HVC"). */
export function cotizacionesCitadas(t: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of String(t ?? "").matchAll(/cotizaci[oó]n\s*(?:n[°º.o]*|n[uú]mero|nro\.?)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/]{1,20})/gi)) {
    if (/\d/.test(m[1]) && m[1].replace(/\D/g, "").length >= 3) out.push(m[1]);
  }
  return out;
}

export function destinoDeTicket(t: Correctivo): Destino {
  const cots = new Set<string>();
  for (const c of [t.documentos?.cotizacion?.numero, t.condiciones?.numero, ...cotizacionesCitadas(t.descripcion)]) {
    const n = normNumCotizacion(c);
    if (n.length >= 3) cots.add(n);
  }
  return {
    clave: `t:${t.id}`, ticket: t, oc: null, cotNueva: null,
    ocNum: numeroOc(t.n_oc), ruc: (t.ruc_proveedor ?? "").trim() || null,
    monto: t.monto === null || t.monto === undefined ? null : Number(t.monto),
    fecha: (t.f_oc ?? t.f_coti ?? null) ? String(t.f_oc ?? t.f_coti).slice(0, 10) : null,
    tokens: palabras(t.descripcion), cots, carpetas: new Set(), empresa: clavesEmpresa(t.proveedor),
    cotsOc: new Set(cotizacionesCitadas(t.descripcion).map(normNumCotizacion).filter((c) => c.length >= 3)),
    cotsTexto: new Set([t.documentos?.cotizacion?.numero, t.condiciones?.numero, ...cotizacionesCitadas(t.descripcion)].filter((x): x is string => !!x)),
  };
}

/** El número "de fondo" de una cotización, sin año ni letras: "2026-0031-SM" → "0031", "SM-0196-25" → "0196". */
export function fondoCotizacion(c: string): string {
  return (c.match(/\d{3,}/g) ?? []).filter((x) => !/^(19|20)\d{2}$/.test(x)).sort((x, y) => y.length - x.length)[0] ?? "";
}

const ESPERAN_OC = ["cotizar", "enviado", "Ingresado a PS", ""];

const cacheNombres = new WeakMap<DocCarga, string>();
const nombreDe = (doc: DocCarga) => {
  let n = cacheNombres.get(doc);
  if (n === undefined) { n = doc.nombre.toLowerCase(); cacheNombres.set(doc, n); }
  return n;
};
const cacheRegex = new Map<string, RegExp>();
const regexDe = (clave: string, crear: () => RegExp) => {
  let r = cacheRegex.get(clave);
  if (!r) { r = crear(); cacheRegex.set(clave, r); }
  return r;
};
const cachePalabras = new WeakMap<DocCarga, Set<string>>();
const palabrasDe = (doc: DocCarga) => {
  let w = cachePalabras.get(doc);
  if (!w) { w = palabras(doc.leido?.pistas.resumen); cachePalabras.set(doc, w); }
  return w;
};

/** Puntaje de que el documento pertenezca a ese destino, y por qué. */
export function puntuar(doc: DocCarga, d: Destino): { puntos: number; motivo: string; fuerte: boolean; dudoso: boolean } {
  const l = doc.leido!;
  const p = l.pistas;
  const motivos: string[] = [];
  let puntos = 0;
  let fuerte = false;
  let dudoso = false;
  let parecidaCot = false;

  if (d.ocNum && p.ocs.includes(d.ocNum)) { puntos += 100; fuerte = true; motivos.push(`cita la OC ${d.ocNum}`); }
  else if (d.ocNum && p.numeros.includes(d.ocNum)) { puntos += 85; fuerte = true; motivos.push(`el nombre del archivo tiene la OC ${d.ocNum}`); }

  // El nombre del archivo trae el N° de ticket (p. ej. "INC0012345 informe.pdf") o "Ref 123".
  if (d.ticket) {
    const nom = nombreDe(doc);
    const cod = (d.ticket.ticket ?? "").trim().toLowerCase();
    const ref = d.ticket.refer;
    // (antes de armar la expresión regular, una búsqueda simple: casi nunca está, y así es rápido)
    if (cod.length >= 5 && nom.includes(cod) && regexDe(`t:${cod}`, () => new RegExp(`(^|[^a-z0-9])${cod.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`)).test(nom)) {
      puntos += 100; fuerte = true; motivos.push(`el nombre del archivo tiene el N° de ticket ${d.ticket.ticket}`);
    } else if (ref != null && nom.includes("ref") && nom.includes(String(ref)) &&
               regexDe(`r:${ref}`, () => new RegExp(`(?:^|[^a-z])ref(?:erencia)?[\\s._#-]*0*${ref}(?!\\d)`)).test(nom)) {
      puntos += 100; fuerte = true; motivos.push(`el nombre del archivo dice Ref ${ref}`);
    }
  }

  const propias = l.tipo === "cotizacion" && l.cotizacion?.numero ? [l.cotizacion.numero] : [];
  const citadas = [...propias, ...p.cotizaciones].map(normNumCotizacion).filter((c) => c.length >= 3);
  const cot = citadas.find((c) => d.cots.has(c));
  if (cot) { puntos += 90; fuerte = true; motivos.push(`misma cotización (${cot.toUpperCase()})`); }
  else {
    // Mismo número "de fondo" con otra forma de escribirlo ("2026-0031-SM" y "2025-0031-SMV"): vale menos.
    const crudas = [...propias, ...p.cotizaciones];
    const n = crudas.map(fondoCotizacion).find((f) => f.length >= 3 && [...d.cotsTexto].some((c) => fondoCotizacion(c) === f));
    if (n && (!p.ruc || !d.ruc || p.ruc === d.ruc)) { puntos += 55; parecidaCot = true; motivos.push(`mismo N° de cotización (${n})`); }
  }

  const misma = !!doc.carpeta && d.carpetas.has(doc.carpeta);

  // Atajo (la mayoría de los tickets no tiene NADA en común con el documento): sin evidencia fuerte, sin
  // carpeta, sin el mismo monto y sin ninguna palabra en común, el puntaje nunca llegaría a contar.
  const montoIgual = l.tipo === "cotizacion" && d.monto !== null && montosCoinciden(l.cotizacion?.total ?? null, l.cotizacion?.subtotal ?? null, d.monto);
  if (!fuerte && !parecidaCot && !misma && !montoIgual) {
    let alguna = false;
    for (const w of palabrasDe(doc)) if (d.tokens.has(w)) { alguna = true; break; }
    if (!alguna) return { puntos: 0, motivo: "", fuerte: false, dudoso: false };
  }
  const veto = (motivo: string) => ({ puntos: -1, motivo, fuerte: false, dudoso: true });

  // ── Contradicciones: con una basta para descartar (salvo que esté en la carpeta del trabajo) ──
  // Cita OTRA OC: pertenece al ticket de esa OC, no a este.
  if (p.ocs.length && !(d.ocNum && p.ocs.includes(d.ocNum)) && !misma) return veto(`cita otra OC (${p.ocs.join(", ")})`);
  // La OC del trabajo dice "conforme a cotización X" y el documento es (o cita) otra cotización.
  if (!cot && !parecidaCot && !misma && citadas.length && d.cotsOc.size) {
    return veto(`la OC cita otra cotización (${[...d.cotsOc].join(", ").toUpperCase()})`);
  }
  if (p.ruc && d.ruc) {
    if (p.ruc === d.ruc) { puntos += 20; motivos.push("mismo proveedor (RUC)"); }
    // Otro RUC: casi siempre otro trabajo. No se descarta del todo (una persona y su empresa pueden
    // tener dos RUC), pero resta mucho y nunca queda como "seguro".
    else if (!fuerte) { puntos -= 45; dudoso = true; motivos.push("¡otro RUC!"); }
  } else if (d.empresa.length && p.empresas.length) {
    // Sin RUC: el nombre o el correo de la empresa que firma.
    const texto = p.empresas.join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (d.empresa.some((k) => texto.includes(k))) { puntos += 15; motivos.push("mismo proveedor (nombre)"); }
    else if (!fuerte && !misma) puntos -= 25;
  }

  if (montoIgual) {
    puntos += p.ruc && d.ruc ? 45 : 30;
    motivos.push("mismo monto");
  }

  const sim = parecido(palabrasDe(doc), d.tokens);
  if (sim.valor >= 0.3 || sim.codigos > 0) {
    puntos += Math.min(
      85,
      Math.round(55 * Math.min(1, sim.valor)) + 4 * Math.max(0, sim.comunes.length - 2) + 25 * sim.codigos + 12 * Math.min(2, sim.unicas)
    );
    motivos.push(`descripción parecida (${sim.comunes.slice(0, 4).join(", ")})`);
  }

  // Pisos distintos ("piso 6" contra "piso 3"): probablemente otro trabajo.
  const pisos = (s: Set<string>) => [...s].filter((w) => /^piso\d/.test(w));
  const pd = pisos(palabrasDe(doc)), pt = pisos(d.tokens);
  if (!fuerte && pd.length && pt.length && !pd.some((x) => pt.includes(x))) puntos -= 20;
  // Aulas distintas (A616 contra A617) o pabellones distintos.
  const aulas = (x: Set<string>) => [...x].filter((w) => /^[ab]?\d{3}[ab]?$/.test(w));
  const ad = aulas(palabrasDe(doc)), at = aulas(d.tokens);
  if (!fuerte && ad.length && at.length && !ad.some((x) => at.includes(x))) puntos -= 25;
  const pabs = (x: Set<string>) => [...x].filter((w) => w === "paba" || w === "pabb");
  const bd = pabs(palabrasDe(doc)), bt = pabs(d.tokens);
  if (!fuerte && bd.length === 1 && bt.length === 1 && bd[0] !== bt[0]) puntos -= 20;
  // Cotización con otro monto: la OC se emite por lo cotizado, así que más de 10 % de diferencia casi
  // descarta (puede ser otra cotización del mismo proveedor); entre 3 y 10 %, resta.
  const tc = l.tipo === "cotizacion" ? l.cotizacion?.total ?? null : null;
  if (!fuerte && !misma && tc !== null && d.monto !== null && d.monto > 0 && !montosCoinciden(tc, l.cotizacion?.subtotal ?? null, d.monto)) {
    const dif = Math.abs(tc - d.monto) / d.monto;
    if (dif > 0.1) puntos -= 40;
    else if (dif > 0.03) puntos -= 15;
  }

  if (misma) { puntos += 45; motivos.push("misma carpeta"); }

  // Fechas: la cotización es anterior a la OC; el informe, posterior.
  if (p.fecha && d.fecha && !fuerte) {
    const dias = diasEntre(d.fecha, p.fecha);
    if (l.tipo === "cotizacion" && dias > 5) puntos -= 25;
    if (l.tipo === "cotizacion" && dias <= 0 && dias > -120) puntos += 5;
    if (l.tipo === "informe" && dias < -5) puntos -= 20;
    if (Math.abs(dias) > 240) puntos -= 15;
  }
  if (d.ticket && !fuerte) {
    if (l.tipo === "informe" && d.ticket.documentos?.informe?.url) puntos -= 15;
    if (l.tipo === "cotizacion" && d.ticket.estado === "Finalizado") puntos -= 20;
  }
  return { puntos, motivo: motivos.join(" · "), fuerte, dudoso };
}

const ORDEN: Record<string, number> = { oc: 0, cotizacion: 1, informe: 2, certificado: 3, guia: 4, otro: 5 };

export function agruparDocumentos(docs: DocCarga[], tickets: Correctivo[]): Agrupacion {
  const duplicados: Agrupacion["duplicados"] = [];
  const errores: DocCarga[] = [];
  const unicos: DocCarga[] = [];
  const porHuella = new Map<string, DocCarga>();
  for (const d of docs) {
    const ya = d.huella ? porHuella.get(d.huella) : undefined;
    if (ya) { duplicados.push({ doc: d, de: ya }); continue; }
    if (d.huella) porHuella.set(d.huella, d);
    if (!d.leido) { errores.push(d); continue; }
    unicos.push(d);
  }

  // Una carpeta con OC distintas mezcla trabajos: ahí la carpeta no dice nada.
  const ocsPorCarpeta = new Map<string, Set<string>>();
  for (const d of unicos) {
    if (!d.carpeta || d.leido!.tipo !== "oc") continue;
    const set = ocsPorCarpeta.get(d.carpeta) ?? new Set<string>();
    set.add(numeroOc(d.leido!.oc?.n_oc));
    ocsPorCarpeta.set(d.carpeta, set);
  }
  for (let i = 0; i < unicos.length; i++) {
    const c = unicos[i].carpeta;
    if (c && (ocsPorCarpeta.get(c)?.size ?? 0) > 1) unicos[i] = { ...unicos[i], carpeta: null };
  }

  const destinos: Destino[] = [];
  const porOc = new Map<string, Destino>();
  const deTickets = new Map<number, Destino>();
  const destinoTicket = (t: Correctivo) => {
    let d = deTickets.get(t.id);
    if (!d) { d = destinoDeTicket(t); deTickets.set(t.id, d); }
    return d;
  };
  const ticketsPorOc = new Map<string, Correctivo[]>();
  for (const t of tickets) {
    const n = numeroOc(t.n_oc);
    if (n) ticketsPorOc.set(n, [...(ticketsPorOc.get(n) ?? []), t]);
  }

  // 1) Cada OC es un trabajo (y si ya está en un ticket, ese es su ticket).
  for (const doc of unicos.filter((d) => d.leido!.tipo === "oc" && d.leido!.oc)) {
    const oc = doc.leido!.oc!;
    const n = numeroOc(oc.n_oc);
    let d = porOc.get(n);
    if (d) { duplicados.push({ doc, de: d.oc! }); continue; }
    const enTicket = ticketsPorOc.get(n) ?? [];
    const base = enTicket.length === 1 ? destinoDeTicket(enTicket[0]) : null;
    d = {
      clave: `oc:${n}`, ticket: base?.ticket ?? null, oc: doc, cotNueva: null, ocNum: n,
      ruc: oc.ruc_proveedor ?? null, monto: oc.total ?? null, fecha: oc.f_oc ?? null,
      tokens: palabras(doc.leido!.pistas.resumen),
      cots: new Set([...doc.leido!.pistas.cotizaciones, ...cotizacionesCitadas(oc.descripcion)].map(normNumCotizacion).filter((c) => c.length >= 3)),
      carpetas: new Set(doc.carpeta ? [doc.carpeta] : []),
      empresa: clavesEmpresa(oc.proveedor),
      cotsOc: new Set(cotizacionesCitadas(oc.descripcion).map(normNumCotizacion).filter((c) => c.length >= 3)),
      cotsTexto: new Set([...doc.leido!.pistas.cotizaciones, ...cotizacionesCitadas(oc.descripcion)]),
      motivoTicket: base ? "la OC ya está en este ticket" : undefined,
      conflicto: enTicket.length > 1
        ? `La OC ya está en ${enTicket.length} tickets (${enTicket.map((t) => `#${t.refer ?? t.id}`).join(", ")}): corrígelo desde esos tickets`
        : undefined,
    };
    if (base) { unir(d.cots, base.cots); unir(d.cotsTexto, base.cotsTexto); unir(d.tokens, base.tokens); deTickets.set(base.ticket!.id, d); }
    porOc.set(n, d);
    destinos.push(d);
  }

  // 2) OC nueva cuya cotización ya creó un ticket que espera la OC: se vincula a ese ticket.
  const esperan = tickets.filter((t) => !numeroOc(t.n_oc) && ESPERAN_OC.includes(t.estado ?? ""));
  for (const d of destinos) {
    if (d.ticket) continue;
    const porCot = esperan.filter((t) => [...destinoTicket(t).cots].some((c) => d.cots.has(c)) && (!t.ruc_proveedor || t.ruc_proveedor === d.ruc));
    const porMonto = esperan.filter((t) => t.ruc_proveedor && t.ruc_proveedor === d.ruc && d.monto !== null && t.monto != null && Math.abs(Number(t.monto) - d.monto) <= 1);
    const t = porCot.length === 1 ? porCot[0] : porCot.length === 0 && porMonto.length === 1 ? porMonto[0] : null;
    if (!t || [...deTickets.values()].some((x) => x !== d && x.ticket?.id === t.id && x.oc)) continue;
    const base = destinoTicket(t);
    d.ticket = t;
    d.motivoTicket = porCot.length === 1 ? "su cotización ya creó este ticket" : "ticket sin OC del mismo proveedor y monto";
    unir(d.cots, base.cots);
    unir(d.cotsTexto, base.cotsTexto);
    unir(d.tokens, base.tokens);
    deTickets.set(t.id, d);
  }

  fijarFrecuencias([...destinos, ...tickets.filter((t) => !deTickets.has(t.id)).map(destinoTicket)]);
  // 3) El resto de documentos, primero las cotizaciones (sus números ayudan a ubicar los informes).
  const asignaciones: Asignacion[] = [];
  const resto = unicos.filter((d) => !(d.leido!.tipo === "oc" && d.leido!.oc)).sort((a, b) => ORDEN[a.leido!.tipo] - ORDEN[b.leido!.tipo]);
  const asignar = (doc: DocCarga, segundaVuelta: boolean) => {
    const enLista = new Set(destinos);
    const candidatos = [...destinos, ...tickets.filter((t) => !enLista.has(deTickets.get(t.id) as Destino)).map(destinoTicket)];
    const vistos = new Set<string>();
    const puntajes = candidatos
      .filter((d) => (vistos.has(d.clave) ? false : (vistos.add(d.clave), true)))
      .map((d) => ({ d, ...puntuar(doc, d) }))
      .filter((x) => x.puntos > 0)
      .sort((a, b) => b.puntos - a.puntos);
    const [mejor, segundo] = puntajes;
    const alternativas = puntajes.slice(0, 4).map((x) => ({ destino: x.d.clave, puntos: x.puntos, motivo: x.motivo }));
    const margen = mejor ? mejor.puntos - (segundo?.puntos ?? 0) : 0;
    // Seguro: evidencia fuerte (OC o N° de cotización) o buen puntaje sin rival cercano.
    // Probable: puntaje medio pero muy por encima del segundo; se marca para revisar.
    const seguro = !!mejor && !mejor.dudoso && (mejor.fuerte || (mejor.puntos >= 60 && margen >= 15));
    const acepta = !!mejor && (seguro || (mejor.puntos >= 45 && margen >= 25));

    // ¿Un informe/certificado que cubre dos trabajos del mismo proveedor? Cada uno explica una parte
    // distinta del documento y, juntos, casi todo.
    const l0 = doc.leido!;
    if ((l0.tipo === "informe" || l0.tipo === "certificado") && mejor && segundo && !mejor.fuerte && !segundo.fuerte) {
      const dt = palabrasDe(doc);
      const c1 = parecido(dt, mejor.d.tokens).comunes, c2 = parecido(dt, segundo.d.tokens).comunes;
      const union = new Set([...c1, ...c2]);
      const propio1 = c1.filter((w) => !c2.includes(w)).length, propio2 = c2.filter((w) => !c1.includes(w)).length;
      const mismoProv = !!mejor.d.ruc && mejor.d.ruc === segundo.d.ruc;
      if (mismoProv && c1.length >= 2 && c2.length >= 2 && propio1 >= 1 && propio2 >= 1 && dt.size > 0 &&
          union.size / dt.size >= 0.66 && c1.length / dt.size < 0.8 && c2.length / dt.size < 0.8) {
        for (const d of [mejor.d, segundo.d]) if (!destinos.includes(d)) destinos.push(d);
        asignaciones.push({
          doc, destino: mejor.d.clave, tambien: segundo.d.clave, puntos: mejor.puntos, seguro: false, alternativas,
          motivo: `parece cubrir dos trabajos del mismo proveedor (${c1.slice(0, 3).join(", ")} / ${c2.slice(0, 3).join(", ")}): se guarda en los dos`,
        });
        return true;
      }
    }

    if (acepta) {
      const d = mejor.d;
      if (!destinos.includes(d)) destinos.push(d); // ticket existente que recibe documentos
      asignaciones.push({ doc, destino: d.clave, puntos: mejor.puntos, motivo: mejor.motivo, seguro, alternativas });
      const l = doc.leido!;
      if (l.tipo === "cotizacion") {
        const n = normNumCotizacion(l.cotizacion?.numero);
        if (n.length >= 3) { d.cots.add(n); d.cotsTexto.add(l.cotizacion!.numero!); }
        if (d.monto === null && l.cotizacion?.total != null) d.monto = l.cotizacion.total;
      }
      for (const c of l.pistas.cotizaciones) {
        const n = normNumCotizacion(c);
        if (n.length >= 3) { d.cots.add(n); d.cotsTexto.add(c); }
      }
      unir(d.tokens, palabras(l.pistas.resumen));
      d.ruc ??= l.pistas.ruc;
    } else if (doc.leido!.tipo === "cotizacion" && doc.leido!.cotizacion && doc.leido!.cotizacion.total !== null && (mejor?.puntos ?? 0) < 45) {
      // Cotización sin OC ni ticket: crea su propio ticket.
      const c = doc.leido!.cotizacion!;
      const d: Destino = {
        clave: `cot:${doc.id}`, ticket: null, oc: null, cotNueva: doc, ocNum: "",
        ruc: c.ruc_proveedor ?? doc.leido!.pistas.ruc, monto: c.total, fecha: c.fecha,
        tokens: palabras(doc.leido!.pistas.resumen),
        cots: new Set([normNumCotizacion(c.numero)].filter((x) => x.length >= 3)),
        carpetas: new Set(doc.carpeta ? [doc.carpeta] : []),
        empresa: clavesEmpresa(c.proveedor),
        cotsOc: new Set(),
        cotsTexto: new Set(c.numero ? [c.numero] : []),
      };
      destinos.push(d);
      asignaciones.push({ doc, destino: d.clave, puntos: 0, motivo: "no se encontró su OC ni su ticket: crea un ticket nuevo", seguro: true, alternativas });
    } else {
      if (segundaVuelta) return false;
      asignaciones.push({ doc, destino: null, puntos: mejor?.puntos ?? 0, motivo: mejor ? `coincidencia débil: ${mejor.motivo}` : "no se encontró a qué trabajo pertenece", seguro: false, alternativas });
    }
    return true;
  };
  for (const doc of resto) asignar(doc, false);
  // Segunda vuelta: lo que quedó suelto puede ir con un ticket que se creó después (p. ej. otra
  // cotización del mismo trabajo).
  for (const a of asignaciones.filter((x) => x.destino === null)) {
    const i = asignaciones.indexOf(a);
    asignaciones.splice(i, 1);
    if (!asignar(a.doc, true)) asignaciones.splice(i, 0, a);
  }
  return { destinos, asignaciones, duplicados, errores };
}

/** Tickets a los que podría ir UN documento suelto (para la carga clásica), de mejor a peor. */
export function ticketsParaDocumento(doc: DocCarga, tickets: Correctivo[]) {
  const ds = tickets.map((t) => ({ t, d: destinoDeTicket(t) }));
  fijarFrecuencias(ds.map((x) => x.d));
  return ds
    .map(({ t, d }) => ({ t, ...puntuar(doc, d) }))
    .filter((x) => x.puntos >= 60)
    .sort((a, b) => b.puntos - a.puntos);
}
