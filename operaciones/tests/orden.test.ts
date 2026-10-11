import { describe, expect, it } from "vitest";
import { buildOrderBy, ORDEN_POR_DEFECTO } from "@/lib/server/orden";

describe("buildOrderBy", () => {
  it("usa el orden por defecto si no se pide ninguno", () => {
    expect(buildOrderBy(null)).toBe(buildOrderBy(ORDEN_POR_DEFECTO));
    expect(buildOrderBy("")).toBe(buildOrderBy(ORDEN_POR_DEFECTO));
  });

  it("acepta solo las opciones de la lista blanca", () => {
    expect(buildOrderBy("fecha")).toBe("f_reg DESC NULLS LAST, id DESC");
    expect(buildOrderBy("ref_asc")).toMatch(/^refer ASC NULLS LAST/);
  });

  it("ignora cualquier valor que no esté en la lista", () => {
    const sql = buildOrderBy("id; DROP TABLE correctivos");
    expect(sql).toBe(buildOrderBy(ORDEN_POR_DEFECTO));
    expect(sql).not.toContain("DROP");
  });
});
