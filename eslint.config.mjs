// PORQUÊ: o repositório mistura runtime Node e guardrails executáveis no navegador.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "panel/**",
      "coverage/**",
      "guardrails.js",
      ".tools/**",
      ".runtime/**",
      "artifacts/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
  },
  {
    files: ["scripts/**/*.js"],
    languageOptions: {
      globals: {
        Blob: "readonly",
        URL: "readonly",
        console: "readonly",
        document: "readonly",
        globalThis: "readonly",
        module: "readonly",
        window: "readonly",
      },
    },
    rules: { "no-control-regex": "off" },
  },
);
