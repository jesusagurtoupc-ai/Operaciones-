import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @vitejs/plugin-react ya estaba en package.json (devDependencies) pero
// nunca se conectaba porque no existia este archivo. Sin el plugin, Vite/
// esbuild transformaban el JSX con el pragma clasico (React.createElement),
// y como casi ningun archivo de src/ importa React explicitamente (se
// asumia el runtime automatico), el bundle de produccion terminaba
// referenciando "React" en modulos donde no estaba definido, causando
// "ReferenceError: React is not defined" en runtime.
export default defineConfig({
  plugins: [react()],
});
