import { describe, expect, it } from "vitest";
import { buildWhere } from "@/lib/server/filtros";

const params = (q: string) => new URLSearchParams(q);

describe("buildWhere", () => {
  it("siempre excluye los tickets eliminados", () => {
    const { where, values } = buildWhere(params(""));
    expect(where).toBe("WHERE eliminado_en IS NULL");
    expect(values).toEqual([]);
  });

  it("combina con O dentro de una dimensión y con Y entre dimensiones", () => {
    const { where, values } = buildWhere(
      params("estado=cotizar&estado=enviado&area=Seguridad")
    );
    expect(where).toContain("estado IN ($1, $2)");
    expect(where).toContain("area IN ($3)");
    expect(values).toEqual(["cotizar", "enviado", "Seguridad"]);
  });

  it("ignora valores vacíos", () => {
    const { where, values } = buildWhere(params("estado=&area="));
    expect(where).toBe("WHERE eliminado_en IS NULL");
    expect(values).toEqual([]);
  });

  it("deja fuera la dimensión excluida (para los conteos)", () => {
    const { where, values } = buildWhere(params("estado=cotizar&area=PTC"), "estado");
    expect(where).not.toContain("estado IN");
    expect(where).toContain("area IN ($1)");
    expect(values).toEqual(["PTC"]);
  });

  it("escapa los comodines de la búsqueda y la parametriza", () => {
    const { where, values } = buildWhere(params("q=100%_x"));
    expect(values).toEqual(["%100\\%\\_x%"]);
    expect(where).toContain("descripcion ILIKE $1");
    expect(where).not.toContain("100%");
  });

  it("filtra por rango de fechas con parámetros", () => {
    const { where, values } = buildWhere(params("desde=2026-01-01&hasta=2026-12-31"));
    expect(where).toContain("f_reg >= $1");
    expect(where).toContain("f_reg <= $2");
    expect(values).toEqual(["2026-01-01", "2026-12-31"]);
  });

  it("nunca mete texto del usuario dentro del SQL", () => {
    const { where } = buildWhere(params("estado='; DROP TABLE correctivos;--&q=' OR 1=1"));
    expect(where).not.toContain("DROP");
    expect(where).not.toContain("OR 1=1");
  });

  it("solo acepta documentos conocidos en 'sin'", () => {
    const valido = buildWhere(params("sin=Cotización"));
    expect(valido.where).toContain("documentos->'cotizacion'");
    const invalido = buildWhere(params("sin=inventado"));
    expect(invalido.where).toBe("WHERE eliminado_en IS NULL");
  });
});
