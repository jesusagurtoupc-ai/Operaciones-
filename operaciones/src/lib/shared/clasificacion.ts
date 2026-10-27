// Sugerencia de "Tipo de trabajo" y "Sub tipo de trabajo" a partir de la DESCRIPCIÓN del trabajo.
//
// La OC y la cotización no traen estos datos: esto es una inferencia por palabras clave, no un dato
// del documento. Por eso el formulario solo la usa para llenar campos que estén VACÍOS y los marca
// como "sugerido" hasta que la persona los confirme o los cambie. Si ninguna regla coincide, no
// devuelve nada (mejor vacío que equivocado).
//
// Para ajustar las reglas basta con editar las listas de abajo. Los valores deben existir en
// TIPOS_TRAB / SUB_TIPOS_TRAB (src/lib/shared/opciones.ts); TypeScript lo verifica.

import { TIPOS_TRAB, SUB_TIPOS_TRAB } from "./opciones";

type TipoTrab = (typeof TIPOS_TRAB)[number];
type SubTipoTrab = (typeof SUB_TIPOS_TRAB)[number];

export type Sugerencia = {
  tipo_trab: TipoTrab | null;
  sub_tipo_trab: SubTipoTrab | null;
};

/** Minúsculas y sin tildes, para que "Señalética" y "senaletica" coincidan. */
function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // tildes (la ñ pasa a n)
    .replace(/\s+/g, " ");
}

// El orden importa: gana la primera regla que coincide. Las más específicas van primero
// (p. ej. "cable utp" es Data, y debe ganarle a "cable", que es Electrico).
const REGLAS_SUB_TIPO: [RegExp, SubTipoTrab][] = [
  [/\b(utp|cat ?[56]e?a?|patch ?cord|punto de red|switch|router|access point|wifi|fibra optica|rack)\b/, "Data"],
  [/\b(aire acondicionado|aire acond|split|climatiza\w*|refrigerant\w*|chiller|fan ?coil)\b/, "Aire Acond."],
  [/\b(proyector|parlante\w*|microfono\w*|audio|video|ecran|amplificador\w*|mezcladora)\b/, "Audio/Video"],
  [/\b(senaletica|senalizacion|letrero\w*|rotulo\w*)\b/, "Señalética"],
  [/\b(inodoro\w*|lavatorio\w*|urinario\w*|grifo\w*|cano\w*|tuberia\w*|desague\w*|sifon\w*|gasfiter\w*|sanitari\w*|fluxometro\w*|tanque de agua)\b/, "Sanitario"],
  [/\b(pintura|pintar|barniz\w*|esmalte|empaste|pintado)\b/, "Pintura"],
  [/\b(limpieza|fumigacion|desinfeccion|desratizacion)\b/, "Limpieza"],
  [/\b(silla\w*|mesa\w*|escritorio\w*|carpeta\w*|pizarra\w*|estante\w*|mueble\w*|mobiliario|locker\w*|armario\w*)\b/, "Mobiliario"],
  [/\b(cable\w*|vulcanizado\w*|tablero\w*|interruptor\w*|termomagnetic\w*|luminaria\w*|foco\w*|fluorescente\w*|led|tomacorriente\w*|enchufe\w*|breaker\w*|transformador\w*|reflector\w*|contactor\w*|variador\w*|electric\w*|conductor\w*|canaleta\w*|balastro\w*)\b/, "Electrico"],
  [/\b(cerradura\w*|chapa\w*|bisagra\w*|candado\w*|tornillo\w*|perno\w*|soldadura|ferreter\w*|manija\w*|pestillo\w*)\b/, "Ferreteria"],
  [/\b(proyecto|remodelacion|ampliacion|construccion|obra civil)\b/, "Proyecto"],
];

const REGLAS_TIPO: [RegExp, TipoTrab][] = [
  [/\b(senaletica|senalizacion|letrero\w*|rotulo\w*)\b/, "Señalética"],
  [/\b(proyecto|remodelacion|ampliacion|construccion|obra civil)\b/, "Proyecto"],
  [/\bpreventivo\b/, "Preventivo"],
  [/\bmunicipal\b/, "Municipal"],
  // Compras de bienes: "suministro de...", "adquisición de...", "compra de...", "material(es)".
  [/\b(suministro|adquisicion|compra|material|materiales)\b/, "Materiales"],
];

export function sugerirClasificacion(descripcion: string | null | undefined): Sugerencia {
  const texto = normalizar(descripcion ?? "");
  if (!texto.trim()) return { tipo_trab: null, sub_tipo_trab: null };

  const tipo_trab = REGLAS_TIPO.find(([re]) => re.test(texto))?.[1] ?? null;
  let sub_tipo_trab = REGLAS_SUB_TIPO.find(([re]) => re.test(texto))?.[1] ?? null;
  // Compra de bienes sin rubro claro: la opción genérica "Material".
  if (!sub_tipo_trab && tipo_trab === "Materiales") sub_tipo_trab = "Material";

  return { tipo_trab, sub_tipo_trab };
}
