import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";

vi.mock("@/lib/server/db", () => ({ sql: () => Promise.resolve([]), ensureSchema: () => Promise.resolve() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => {}, delete: () => {}, get: () => undefined }) }));

const SECRETO = "a3f9c2e81b7d4c6a9e0f5b2d8c1a7e43";
const clave = new TextEncoder().encode(SECRETO);
const ahora = () => Math.floor(Date.now() / 1000);

async function token(opts: { iat: number; ini?: number; exp?: number; alg?: "HS256" | "HS512" }) {
  const jwt = new SignJWT({ username: "ana", rol: "lectura", sv: 0, ...(opts.ini ? { ini: opts.ini } : {}) })
    .setProtectedHeader({ alg: opts.alg ?? "HS256" })
    .setIssuedAt(opts.iat)
    .setExpirationTime(opts.exp ?? opts.iat + 12 * 3600);
  return jwt.sign(clave);
}

beforeEach(() => {
  process.env.SESSION_SECRET = SECRETO;
});

describe("sesión", () => {
  it("un token recién emitido no se renueva; uno de más de 30 min sí", async () => {
    const { tokenRenovado } = await import("@/lib/server/auth");
    expect(await tokenRenovado(await token({ iat: ahora() - 60, exp: ahora() + 3600 }))).toBeNull();
    const nuevo = await tokenRenovado(await token({ iat: ahora() - 3600, exp: ahora() + 3600 }));
    expect(nuevo).not.toBeNull();
    expect(nuevo!.opciones.httpOnly).toBe(true);
    expect(nuevo!.opciones.maxAge).toBe(12 * 3600);
  });

  it("la renovación respeta el tope absoluto de 7 días desde el inicio de sesión", async () => {
    const { tokenRenovado, verifyToken } = await import("@/lib/server/auth");
    const ini = ahora() - 7 * 86400 + 2 * 3600; // faltan 2 h para el tope
    const nuevo = await tokenRenovado(await token({ iat: ahora() - 3600, ini, exp: ahora() + 3600 }));
    expect(nuevo!.opciones.maxAge).toBeLessThanOrEqual(2 * 3600);
    expect(nuevo!.opciones.maxAge).toBeGreaterThan(0);
    expect((await verifyToken(nuevo!.token))?.ini).toBe(ini);
  });

  it("pasado el tope de 7 días, el token ya no vale aunque no haya vencido", async () => {
    const { verifyToken, tokenRenovado } = await import("@/lib/server/auth");
    const viejo = await token({ iat: ahora() - 600, ini: ahora() - 8 * 86400, exp: ahora() + 3600 });
    expect(await verifyToken(viejo)).toBeNull();
    expect(await tokenRenovado(viejo)).toBeNull();
  });

  it("se rechaza un token firmado con otro algoritmo", async () => {
    const { verifyToken } = await import("@/lib/server/auth");
    expect(await verifyToken(await token({ iat: ahora(), alg: "HS512" }))).toBeNull();
    expect(await verifyToken(await token({ iat: ahora() }))).not.toBeNull();
  });

  it("en producción, un SESSION_SECRET corto o de ejemplo hace fallar (no se trata como token inválido)", async () => {
    const { verifyToken } = await import("@/lib/server/auth");
    vi.stubEnv("NODE_ENV", "production");
    process.env.SESSION_SECRET = "corto";
    await expect(verifyToken("x")).rejects.toThrow(/32/);
    vi.unstubAllEnvs();
  });
});
