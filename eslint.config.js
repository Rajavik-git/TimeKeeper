import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "dist/**",
    "build/**",
    ".cache/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "data/**",
    "recordings/**",
    "src-tauri/target/**",
    "src-tauri/gen/**",
    "src/contracts/generated.ts",
    "graphify-out/**",
    ".archify/**",
  ]),
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: [
      "src/backend/**/*.ts",
      "scripts/**/*.ts",
      "tests/**/*.ts",
      "src/frontend/vite.config.ts",
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["src/frontend/**/*.{ts,tsx}"],
    ignores: ["src/frontend/vite.config.ts"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/exhaustive-deps": "error",
    },
  },
]);
