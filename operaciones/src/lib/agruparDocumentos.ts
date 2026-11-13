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
    "hvc mhvc msg mpi refriperu documento final ver version v1 sm tcnico tcnica cnico informacion cotizacin atencin"
  ).split(" ")
);
const SINONIMOS: Record<string, string> = {
  varones: "hombre", varon: "hombre", caballeros: "hombre", caballero: "hombre", hombres: "hombre",
  damas: "mujer", mujeres: "mujer", sshh: "bano", "ss.hh": "bano", ss: "bano", hh: "bano", banos: "bano", servicios_higienicos: "bano",
  aa: "aire", a_a: "aire", acondicionado: "aire", filtraciones: "filtracion", fuga: "filtracion", fugas: "filtracion",
  luminarias: "luminaria", luces: "luminaria", fluorescentes: "fluorescente", termostatos: "termostato",
  bao: "bano", baos: "bano",
};
const RAIZ = 6; // se comparan las primeras letras: "filtracion" = "filtraci(o)n" del nombre de archivo = "filtra"

export function palabras(t: string | null | undefined): Set<string> {
  const base = String(t ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ss\.?\s?hh\.?/g, " sshh ")
    // Ubicación: "piso 3" → piso3, "pabellón A" → paba, "aula 102" → a102 (distinguen trabajos parecidos).
    .replace(/\bpiso\s*n?[°º]?\s*0?(\d{1,2})\b/g, " piso$1 ")
    .replace(/\bpab(?:ellon)?\.?\s*["'“”]?\s*([ab])\b(?![a-z])/g, " pab$1 ")
    .replace(/\baula\s*([a-z]?)\s*-?\s*(\d{3})\s*([a-z]?)\b/g, (_m, a: string, n: string, b: string) => ` ${(a || b || "") + n} `)
    .replace(/[^a-z0-9ñ]+/g, " ");
  const out = new Set<string>();
  for (let w of base.split(" ")) {
    if (!w) continue;
    w = w.replace(/ñ/g, "n");
    if (/^\d+$/.test(w)) continue; // números sueltos: no describen el trabajo (fechas, cantidades)
    if (w.length < 3 && !/\d/.test(w)) continue;
    w = SINONIMOS[w] ?? w;
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

/** Parecido de dos descripciones (0 a 1): palabras en común / palabras de la más corta. */
export function parecido(a: Set<string>, b: Set<string>): { valor: number; comunes: string[]; codigos: number } {
  if (a.size === 0 || b.size === 0) return { valor: 0, comunes: [], codigos: 0 };
  const comunes = [...a].filter((w) => b.has(w));
  // Un código en común (A617, HSVLAUREATE005) vale por sí solo.
  const codigos = comunes.filter((w) => /\d/.test(w) && /[a-z]/.test(w) && w.length >= 4 && !/^(piso|pab)/.test(w)).length;
  if (comunes.length < 2 && codigos === 0) return { valor: 0, comunes, codigos };
  return { valor: comunes.length / Math.max(3, Math.min(a.size, b.size, 8)), comunes, codigos };
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
    tokens: palabras(t.descripcion), cots, carpetas: new Set(),
  };
}

const ESPERAN_OC = ["cotizar", "enviado", "Ingresado a PS", ""];

const cachePalabras = new WeakMap<DocCarga, Set<string>>();
const palabrasDe = (doc: DocCarga) => {
  let w = cachePalabras.get(doc);
  if (!w) { w = palabras(doc.leido?.pistas.resumen); cachePalabras.set(doc, w); }
  return w;
};

/** Puntaje de que el documento pertenezca a ese destino, y por qué. */
export function puntuar(doc: DocCarga, d: Destino): { puntos: number; motivo: string; fuerte: boolean } {
  const l = doc.leido!;
  const p = l.pistas;
  const motivos: string[] = [];
  let puntos = 0;
  let fuerte = false;

  if (d.ocNum && p.ocs.includes(d.ocNum)) { puntos += 100; fuerte = true; motivos.push(`cita la OC ${d.ocNum}`); }
  else if (d.ocNum && p.numeros.includes(d.ocNum)) { puntos += 85; fuerte = true; motivos.push(`el nombre del archivo tiene la OC ${d.ocNum}`); }

  const propias = l.tipo === "cotizacion" && l.cotizacion?.numero ? [l.cotizacion.numero] : [];
  const citadas = [...propias, ...p.cotizaciones].map(normNumCotizacion).filter((c) => c.length >= 3);
  const cot = citadas.find((c) => d.cots.has(c));
  if (cot) { puntos += 90; fuerte = true; motivos.push(`misma cotización (${cot.toUpperCase()})`); }

  if (p.ruc && d.ruc) {
    if (p.ruc === d.ruc) { puntos += 20; motivos.push("mismo proveedor (RUC)"); }
    else if (!fuerte) return { puntos: -1, motivo: "otro proveedor", fuerte: false };
  }

  if (l.tipo === "cotizacion" && l.cotizacion?.total != null && d.monto !== null && Math.abs(l.cotizacion.total - d.monto) <= 1) {
    puntos += p.ruc && d.ruc ? 45 : 30;
    motivos.push("mismo monto");
  }

  const sim = parecido(palabrasDe(doc), d.tokens);
  if (sim.valor >= 0.3 || sim.codigos > 0) {
    puntos += Math.min(80, Math.round(55 * Math.min(1, sim.valor)) + 4 * Math.max(0, sim.comunes.length - 2) + 25 * sim.codigos);
    motivos.push(`descripción parecida (${sim.comunes.slice(0, 4).join(", ")})`);
  }

  // Pisos distintos ("piso 6" contra "piso 3"): probablemente otro trabajo.
  const pisos = (s: Set<string>) => [...s].filter((w) => /^piso\d/.test(w));
  const pd = pisos(palabrasDe(doc)), pt = pisos(d.tokens);
  if (!fuerte && pd.length && pt.length && !pd.some((x) => pt.includes(x))) puntos -= 20;

  if (doc.carpeta && d.carpetas.has(doc.carpeta)) { puntos += 45; motivos.push("misma carpeta"); }

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
  return { puntos, motivo: motivos.join(" · "), fuerte };
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
  for (const doc of unicos.filter((d) => d.leido!.tipo === "oc")) {
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
      motivoTicket: base ? "la OC ya está en este ticket" : undefined,
    };
    if (base) { unir(d.cots, base.cots); unir(d.tokens, base.tokens); deTickets.set(base.ticket!.id, d); }
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
    unir(d.tokens, base.tokens);
    deTickets.set(t.id, d);
  }

  // 3) El resto de documentos, primero las cotizaciones (sus números ayudan a ubicar los informes).
  const asignaciones: Asignacion[] = [];
  const resto = unicos.filter((d) => d.leido!.tipo !== "oc").sort((a, b) => ORDEN[a.leido!.tipo] - ORDEN[b.leido!.tipo]);
  const asignar = (doc: DocCarga, segundaVuelta: boolean) => {
    const candidatos = [...destinos, ...tickets.filter((t) => !deTickets.has(t.id) || !destinos.includes(deTickets.get(t.id)!)).map(destinoTicket)];
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
    const seguro = !!mejor && (mejor.fuerte || (mejor.puntos >= 60 && margen >= 15));
    const acepta = !!mejor && (seguro || (mejor.puntos >= 45 && margen >= 25));

    if (acepta) {
      const d = mejor.d;
      if (!destinos.includes(d)) destinos.push(d); // ticket existente que recibe documentos
      asignaciones.push({ doc, destino: d.clave, puntos: mejor.puntos, motivo: mejor.motivo, seguro, alternativas });
      const l = doc.leido!;
      if (l.tipo === "cotizacion") {
        const n = normNumCotizacion(l.cotizacion?.numero);
        if (n.length >= 3) d.cots.add(n);
        if (d.monto === null && l.cotizacion?.total != null) d.monto = l.cotizacion.total;
      }
      for (const c of l.pistas.cotizaciones) d.cots.add(normNumCotizacion(c));
      unir(d.tokens, palabras(l.pistas.resumen));
      if (doc.carpeta) d.carpetas.add(doc.carpeta);
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
  return tickets
    .map((t) => ({ t, ...puntuar(doc, destinoDeTicket(t)) }))
    .filter((x) => x.puntos >= 60)
    .sort((a, b) => b.puntos - a.puntos);
}
