// Sugerencias automáticas para un ticket nuevo a partir de lo que trae la OC.
// Solo se proponen valores cuando hay una coincidencia clara; la persona los puede cambiar en el ticket.
import { LUGARES, SUB_TIPOS_TRAB } from "@/lib/shared";

const sinTildes = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * "pabellon A" / "pabellon B" / "pabellon A y B" según el texto (lugar de entrega o descripción de la OC).
 * La letra debe venir en mayúscula ("PABELLÓN "A""): así no se confunde con la preposición "a".
 */
export function sugerirLugar(texto: string | null): (typeof LUGARES)[number] | null {
  if (!texto) return null;
  const t = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const re = /pabell\w*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const resto = t.slice(m.index + m[0].length);
    const par = /^\s*["'“”]?([AB])["'“”]?\s*(?:y|e|\/|-|,)\s*["'“”]?([AB])(?![A-Za-z])/.exec(resto);
    if (par) return par[1] !== par[2] ? "pabellon A y B" : par[1] === "A" ? "pabellon A" : "pabellon B";
    const uno = /^\s*["'“”]?([AB])(?![A-Za-z])/.exec(resto);
    if (uno) return uno[1] === "A" ? "pabellon A" : "pabellon B";
  }
  return null;
}

/** "Preventivo" si la descripción habla de mantenimiento preventivo. */
export function sugerirTipo(descripcion: string | null): string | null {
  if (!descripcion) return null;
  return /preventiv/.test(sinTildes(descripcion)) ? "Preventivo" : null;
}

const REGLAS: { sub: (typeof SUB_TIPOS_TRAB)[number]; re: RegExp }[] = [
  { sub: "Aire Acond.", re: /aire acondicionado|split\b|climatiz|\bchiller|ventilacion/ },
  { sub: "Audio/Video", re: /\baudio\b|\bvideo\b|proyector|parlante|microfono|pantalla led/ },
  { sub: "Data", re: /cableado estructurado|\bdata\b|\bred de datos|switch|punto de red|fibra optica/ },
  { sub: "Electrico", re: /electric|luminaria|tablero|iluminacion|\bluces\b|tomacorriente|cableado electrico|fluorescente/ },
  { sub: "Sanitario", re: /sanitari|gasfit|desague|inodoro|lavatorio|urinario|griferia|tuberia|\\bss\\.?\\s?hh|servicios higienicos|valvula|filtracion de agua|fuga de agua/ },
  { sub: "Pintura", re: /pintura|pintado|\bpintar\b/ },
  { sub: "Mobiliario", re: /mobiliario|carpeta|escritorio|\bsilla|estante|\bmesa\b|pizarra/ },
  { sub: "Limpieza", re: /limpieza|desinfecc|fumigac/ },
  { sub: "Señalética", re: /senaletica|senalizacion|letrero/ },
  { sub: "Ferreteria", re: /ferreteria|herramienta|pernos|tornillo/ },
];

/** Sub tipo de trabajo según la descripción. Solo si UNA categoría coincide (si hay duda, null). */
export function sugerirSubTipo(descripcion: string | null): string | null {
  if (!descripcion) return null;
  const t = sinTildes(descripcion);
  const hit = REGLAS.filter((r) => r.re.test(t));
  return hit.length === 1 ? hit[0].sub : null;
}
