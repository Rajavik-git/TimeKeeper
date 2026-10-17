import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { memoryDb } from "../fixtures/database.js";
import { createApp } from "../../src/backend/api/app";
import { previousBillingMetrics } from "../../src/frontend/calculations/cases";
import type { State, CoreState } from "../../src/frontend/api/client";

describe("interface API filters and source packs", () => {
  it("filters a selected day on the server and finds case names without accents", async () => {
    const db = memoryDb();
    try {
      const app = createApp(db);
      const day = (await (
        await app.request("/api/work-periods?date=2026-10-16&timeZone=UTC")
      ).json()) as CoreState["periods"];
      expect(day.length).toBeGreaterThan(0);
      expect(day.every((period) => period.startedAt.startsWith("2026-10-16"))).toBe(true);
      const periods = (await (
        await app.request("/api/work-periods?from=2026-09-01&to=2026-09-16")
      ).json()) as Array<{ startedAt: string }>;
      expect(periods).toHaveLength(12);
      const matches = (await (await app.request("/api/cases/search?query=DAWSON")).json()) as {
        clients: Array<{ name: string }>;
        cases: Array<{ title: string }>;
      };
      expect(matches.clients.some((client) => client.name === "Paul Dawson")).toBe(true);
      expect(matches.cases.some((item) => item.title === "Dawson v Martin")).toBe(true);
    } finally {
      db.close();
    }
  });
  it("downloads the exact hashed source pack and records its receipt", async () => {
    const db = memoryDb();
    try {
      const app = createApp(db);
      const response = await app.request("/api/cases/1/source-pack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "case", options: ["blur", "personal", "audit"] }),
      });
      expect(response.status).toBe(200);
      const result = (await response.json()) as {
        export: { sha256: string; time_entry_ids: string };
        payload: string;
      };
      expect(createHash("sha256").update(result.payload).digest("hex")).toBe(result.export.sha256);
      const pack = JSON.parse(result.payload) as {
        sources: Array<{ type: string }>;
        entries: Array<{ id: number }>;
      };
      expect(pack.sources.every((source) => source.type !== "audio")).toBe(true);
      expect(JSON.parse(result.export.time_entry_ids)).toEqual(
        pack.entries.map((entry) => entry.id),
      );
    } finally {
      db.close();
    }
  });
  it("compares Billing against historically validated September periods", async () => {
    const db = memoryDb();
    try {
      const app = createApp(db);
      const [state, periods, billing] = await Promise.all([
        app.request("/api/catalog").then((response) => response.json()) as Promise<State>,
        app.request("/api/work-periods").then((response) => response.json()) as Promise<
          CoreState["periods"]
        >,
        app.request("/api/billing/state").then((response) => response.json()) as Promise<
          CoreState["billing"]
        >,
      ]);
      const comparison = previousBillingMetrics(
        state,
        {
          periods,
          billing,
          sources: [],
          sessions: [],
          activeSession: null,
          questions: [],
          coverageGaps: [],
          auditEvents: [],
        },
        "2026-10-16",
      );
      expect(comparison.previousDay).toBe("2026-09-16");
      expect(comparison.toBillCents).toBeGreaterThan(0);
      expect(comparison.readyCents).toBe(comparison.toBillCents);
      expect(comparison.waitingCases).toBe(0);
    } finally {
      db.close();
    }
  });
});
