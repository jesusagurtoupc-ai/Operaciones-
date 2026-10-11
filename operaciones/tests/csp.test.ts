import { describe, expect, it } from "vitest";
import { construirCsp, nuevoNonce } from "@/lib/server/csp";

describe("CSP de las páginas", () => {
  it("producción: scripts solo con nonce, sin unsafe-inline ni unsafe-eval", () => {
    const n = nuevoNonce();
    const csp = construirCsp(n, true);
    const scripts = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(scripts).toContain(`'nonce-${n}'`);
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("frame-src 'self' blob:"); // visor de PDF
  });

  it("desarrollo: permite unsafe-eval (lo necesita Next.js en dev)", () => {
    expect(construirCsp("x", false)).toContain("'unsafe-eval'");
  });

  it("cada nonce es distinto", () => {
    expect(nuevoNonce()).not.toBe(nuevoNonce());
  });
});
