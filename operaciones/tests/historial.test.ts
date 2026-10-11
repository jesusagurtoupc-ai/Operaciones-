import { describe, expect, it } from "vitest";
import { diferencias } from "@/lib/server/historial";

describe("diferencias", () => {
  it("lista solo los campos que cambiaron", () => {
    const out = diferencias(
      { estado: "cotizar", proveedor: "ACME", monto: "100.00" },
      { estado: "enviado", proveedor: "ACME", monto: 100 }
    );
    expect(out).toEqual(["Estado: cotizar → enviado"]);
  });

  it("trata null, undefined y vacío como 'vacío'", () => {
    expect(diferencias({ ticket: null }, { ticket: "" })).toEqual([]);
    expect(diferencias({ ticket: null }, { ticket: "T-1" })).toEqual(["Ticket: vacío → T-1"]);
  });

  it("compara montos como números ('100.00' = 100) y detecta cambios reales", () => {
    expect(diferencias({ monto: "100.00" }, { monto: 100 })).toEqual([]);
    expect(diferencias({ monto: "100.00" }, { monto: 150 })).toEqual(["Monto: 100.00 → 150"]);
    expect(diferencias({ monto: null }, { monto: 0 })).toEqual(["Monto: vacío → 0"]);
  });

  it("muestra las fechas solo con el día", () => {
    expect(
      diferencias({ f_oc: "2026-08-18T00:00:00.000Z" }, { f_oc: "2026-08-18" })
    ).toEqual([]);
    expect(
      diferencias({ f_oc: new Date("2026-08-18T00:00:00Z") }, { f_oc: "2026-09-01" })
    ).toEqual(["F. OC: 2026-08-18 → 2026-09-01"]);
  });

  it("ignora campos que no vienen en los datos nuevos", () => {
    expect(diferencias({ estado: "cotizar" }, {})).toEqual([]);
  });
});
