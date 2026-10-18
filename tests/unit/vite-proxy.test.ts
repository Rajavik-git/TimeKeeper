import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "../../src/frontend/vite.config";

const proxyPatterns = Object.keys(config.server!.proxy!).map((pattern) => new RegExp(pattern));
const isProxied = (url: string) => proxyPatterns.some((pattern) => pattern.test(url));

describe("development API routing", () => {
  it("serves frontend API modules through Vite, including hot updates", () => {
    const modules = readdirSync("src/frontend/api").filter((name) => /\.tsx?$/.test(name));
    expect(modules.length).toBeGreaterThan(0);

    for (const name of modules) {
      for (const query of ["", "?t=1234567890", "?import"]) {
        const url = `/api/${name}${query}`;
        expect(isProxied(url), url).toBe(false);
      }
    }
  });

  it("forwards backend requests even when IDs or query values contain TypeScript extensions", () => {
    for (const url of [
      "/api/state",
      "/api/sessions/active",
      "/api/client/1",
      "/api/work-periods/case.ts",
      "/api/sources/document.tsx?download=true",
      "/api/cases/search?query=client.ts",
    ]) {
      expect(isProxied(url), url).toBe(true);
    }
  });
});
