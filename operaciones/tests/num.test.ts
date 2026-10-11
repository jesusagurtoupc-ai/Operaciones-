import { describe, expect, it } from "vitest";
import { numOrNull } from "@/lib/shared/num";

describe("numOrNull", () => {
  it("devuelve null para vacío", () => {
    expect(numOrNull("")).toBeNull();
    expect(numOrNull(null)).toBeNull();
    expect(numOrNull(undefined)).toBeNull();
  });

  it("conserva el 0 (no lo convierte en null)", () => {
    expect(numOrNull(0)).toBe(0);
    expect(numOrNull("0")).toBe(0);
  });

  it("convierte textos numéricos", () => {
    expect(numOrNull("12.5")).toBe(12.5);
    expect(numOrNull(7)).toBe(7);
  });

  it("devuelve undefined si no es un número válido", () => {
    expect(numOrNull("abc")).toBeUndefined();
    expect(numOrNull(NaN)).toBeUndefined();
    expect(numOrNull(Infinity)).toBeUndefined();
  });
});
