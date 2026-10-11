import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // db.ts exige DATABASE_URL al importarse; con esta URL falsa no se conecta a nada.
    env: { DATABASE_URL: "postgres://test:test@localhost/test" },
  },
});
