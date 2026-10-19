// Configuración de ESLint (antes ESLint estaba instalado pero SIN configuración, así que
// nunca se ejecutaba y ningún error se detectaba antes de publicar).
//
// Criterio: que sea una red de seguridad útil desde el primer día sin obligar a reescribir
// 19 000 líneas. Los errores que casi siempre son bugs reales (hooks usados en lugares
// prohibidos, variables sin definir, código inalcanzable...) cortan con error; el resto
// avisa. Se puede ir endureciendo de a poco.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      // Entorno mezclado (navegador en src/, Node en api/): se declaran los globales que
      // usa el proyecto en vez de depender de un paquete extra.
      globals: {
        window: "readonly", document: "readonly", navigator: "readonly", localStorage: "readonly",
        sessionStorage: "readonly", fetch: "readonly", console: "readonly", URL: "readonly",
        URLSearchParams: "readonly", Image: "readonly", FileReader: "readonly", Blob: "readonly",
        File: "readonly", FormData: "readonly", AbortController: "readonly", Promise: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly",
        clearInterval: "readonly", requestAnimationFrame: "readonly", cancelAnimationFrame: "readonly",
        alert: "readonly", confirm: "readonly", prompt: "readonly", atob: "readonly", btoa: "readonly",
        structuredClone: "readonly", queueMicrotask: "readonly", Buffer: "readonly",
        process: "readonly", IntersectionObserver: "readonly", ResizeObserver: "readonly",
        MutationObserver: "readonly", Intl: "readonly", crypto: "readonly", TextEncoder: "readonly",
        TextDecoder: "readonly", Event: "readonly", CustomEvent: "readonly", location: "readonly",
        history: "readonly", matchMedia: "readonly", getComputedStyle: "readonly", indexedDB: "readonly",
        XMLHttpRequest: "readonly", performance: "readonly", Headers: "readonly", Request: "readonly",
        Response: "readonly", HTMLElement: "readonly", Node: "readonly", self: "readonly",
        globalThis: "readonly", requestIdleCallback: "readonly", screen: "readonly", Notification: "readonly",
        BroadcastChannel: "readonly", __dirname: "readonly",
      },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Bugs reales:
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-undef": "error",
      "no-unreachable": "error",
      "no-dupe-keys": "error",
      "no-redeclare": "error",
      // Orden y limpieza (avisos):
      "no-unused-vars": ["warn", { args: "none", ignoreRestSiblings: true, caughtErrors: "none", varsIgnorePattern: "^_" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-useless-escape": "warn",
      "no-prototype-builtins": "warn",
      "no-case-declarations": "warn",
      "no-inner-declarations": "off",
    },
  },
];
