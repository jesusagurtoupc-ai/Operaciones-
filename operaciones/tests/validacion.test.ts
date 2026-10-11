import { describe, expect, it } from "vitest";
import {
  validarCorrectivo,
  fechaIsoValida,
  errorFiltrosFecha,
} from "@/lib/server/validacion";

const base = { descripcion: "Cambiar luminarias", estado: "cotizar" };

describe("fechaIsoValida", () => {
  it("acepta fechas reales", () => {
    expect(fechaIsoValida("2026-02-28")).toBe(true);
    expect(fechaIsoValida("2024-02-29")).toBe(true);
  });

  it("rechaza fechas imposibles, mal formadas o fuera de rango", () => {
    expect(fechaIsoValida("2026-02-30")).toBe(false);
    expect(fechaIsoValida("2026-13-01")).toBe(false);
    expect(fechaIsoValida("2026-8-1")).toBe(false);
    expect(fechaIsoValida("1800-01-01")).toBe(false);
    expect(fechaIsoValida("hoy")).toBe(false);
  });
});

describe("errorFiltrosFecha", () => {
  it("no da error sin filtros o con fechas válidas", () => {
    expect(errorFiltrosFecha(new URLSearchParams(""))).toBeNull();
    expect(errorFiltrosFecha(new URLSearchParams("desde=2026-01-01&hasta=2026-02-01"))).toBeNull();
  });

  it("da error con fechas inválidas", () => {
    expect(errorFiltrosFecha(new URLSearchParams("desde=ayer"))).toMatch(/desde/);
    expect(errorFiltrosFecha(new URLSearchParams("hasta=2026-99-99"))).toMatch(/hasta/);
  });
});

describe("validarCorrectivo", () => {
  it("acepta un ticket mínimo y limpia los textos", () => {
    const r = validarCorrectivo({ ...base, descripcion: "  Pintar pared  ", ticket: " " });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.datos.descripcion).toBe("Pintar pared");
      expect(r.datos.ticket).toBeNull();
      expect(r.datos.refer).toBeNull();
    }
  });

  it("usa 'cotizar' si no viene el estado", () => {
    const r = validarCorrectivo({ descripcion: "x" });
    expect(r.ok && r.datos.estado).toBe("cotizar");
  });

  it("exige descripción", () => {
    expect(validarCorrectivo({ estado: "cotizar" }).ok).toBe(false);
    expect(validarCorrectivo({ descripcion: "   " }).ok).toBe(false);
  });

  it("rechaza cuerpos que no son objetos", () => {
    expect(validarCorrectivo(null).ok).toBe(false);
    expect(validarCorrectivo([]).ok).toBe(false);
    expect(validarCorrectivo("texto").ok).toBe(false);
  });

  it("limita el largo de los textos", () => {
    expect(validarCorrectivo({ ...base, descripcion: "a".repeat(2001) }).ok).toBe(false);
    expect(validarCorrectivo({ ...base, descripcion: "a".repeat(2000) }).ok).toBe(true);
    expect(validarCorrectivo({ ...base, proveedor: "p".repeat(201) }).ok).toBe(false);
  });

  it("solo acepta valores de las listas desplegables", () => {
    expect(validarCorrectivo({ ...base, estado: "inventado" }).ok).toBe(false);
    expect(validarCorrectivo({ ...base, area: "Cocina" }).ok).toBe(false);
    expect(validarCorrectivo({ ...base, tipo_trab: "X" }).ok).toBe(false);
    expect(validarCorrectivo({ ...base, lugar: "pabellon Z" }).ok).toBe(false);
    expect(validarCorrectivo({ ...base, area: "Seguridad", lugar: "pabellon A" }).ok).toBe(true);
  });

  it("sigue aceptando un valor antiguo que el ticket ya tenía", () => {
    const previo = { area: "Area vieja del Excel" };
    expect(validarCorrectivo({ ...base, area: "Area vieja del Excel" }, previo).ok).toBe(true);
    expect(validarCorrectivo({ ...base, area: "Otra distinta" }, previo).ok).toBe(false);
  });

  it("valida las fechas (acepta ISO completo, rechaza imposibles)", () => {
    expect(validarCorrectivo({ ...base, f_reg: "2026-08-18T00:00:00.000Z" }).ok).toBe(true);
    expect(validarCorrectivo({ ...base, f_reg: "2026-02-30" }).ok).toBe(false);
    expect(validarCorrectivo({ ...base, f_oc: 20260818 }).ok).toBe(false);
  });

  it("valida N° Refer. y monto", () => {
    expect(validarCorrectivo({ ...base, refer: "12" }).ok).toBe(true);
    expect(validarCorrectivo({ ...base, refer: 1.5 }).ok).toBe(false);
    expect(validarCorrectivo({ ...base, refer: -1 }).ok).toBe(false);
    expect(validarCorrectivo({ ...base, refer: 3_000_000_000 }).ok).toBe(false);
    expect(validarCorrectivo({ ...base, monto: "abc" }).ok).toBe(false);
    expect(validarCorrectivo({ ...base, monto: 1e12 }).ok).toBe(false);
    expect(validarCorrectivo({ ...base, monto: 0 }).ok).toBe(true);
  });
});
