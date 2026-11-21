import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["node_modules/**", "dist/**", "android/**", "artifacts/**", ".vercel/**", ".venv/**", ".metatune-venv/**", ".pytest_cache/**", "**/__pycache__/**", ".signing/**", "playwright-report/**", "test-results/**", "metatune/static/**"] },
  {
    files: ["**/*.mjs"],
    ...js.configs.recommended,
    languageOptions: { globals: { process: "readonly", console: "readonly", Buffer: "readonly", URL: "readonly", fetch: "readonly", WebSocket: "readonly", setTimeout: "readonly", clearTimeout: "readonly" } }
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-explicit-any": "error",
      "no-control-regex": "off"
    }
  },
  {
    files: ["src/client/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "error" }
  }
];
