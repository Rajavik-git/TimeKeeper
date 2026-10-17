import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  server: {
    host: process.env.UI_HOST ?? "127.0.0.1",
    port: Number(process.env.UI_PORT ?? 5173),
    strictPort: true,
    // Frontend API modules share this URL prefix during development.
    proxy: {
      "^/api/(?![^/?]+\\.tsx?(?:\\?|$))": `http://127.0.0.1:${process.env.TIMEKEEPER_PORT ?? 8787}`,
    },
  },
  build: {
    outDir: resolve(root, "../../dist/frontend"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        pill: resolve(root, "pill.html"),
      },
    },
  },
});
