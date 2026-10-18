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
  {
    files: ["src/backend/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "node:*",
                "drizzle-orm*",
                "hono*",
                "react*",
                "@tauri-apps/*",
                "**/adapters/**",
                "**/api/**",
                "**/frontend/**",
                "**/contracts/**",
                "**/ports/**",
              ],
              message:
                "Domain rules must stay independent of storage, transport, and interface modules.",
            },
          ],
        },
      ],
      "no-restricted-globals": ["error", "fetch", "WebSocket", "XMLHttpRequest"],
    },
  },
  {
    files: ["src/backend/application/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/adapters/**", "**/frontend/**", "drizzle-orm*", "hono*", "react*"],
              message:
                "Application services use ports; bootstrap constructs adapters and transports.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/frontend/**/*.{ts,tsx}"],
    ignores: ["src/frontend/vite.config.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/backend/**", "node:*", "drizzle-orm*"],
              message:
                "The frontend uses the application API and generated contracts, not backend or database modules.",
            },
          ],
        },
      ],
    },
  },
]);
