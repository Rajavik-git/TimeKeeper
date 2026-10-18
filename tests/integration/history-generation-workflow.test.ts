import { describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../../src/backend/adapters/sqlite/migrate.js";
import { createApplicationServices } from "../../src/backend/bootstrap.js";
import { createHttpApp } from "../../src/backend/api/app.js";
import { generateHistoryProposals } from "../../src/mcp/history.js";
import type { SessionDeps } from "../../src/mcp/session.js";

describe("history workflow and application integration", () => {
  it("stores only drafts until explicit acceptance, then links sources without ending the active session", async () => {
    const db = new DatabaseSync(":memory:");
    migrate(db);
    try {
      const services = createApplicationServices(
        db,
        { now: () => "2026-10-18T10:00:00Z" },
        { configured: true, dispatch: async () => "started" },
      );
      services.repository.insertSession(
        { id: "session", startedAt: "2026-10-18T09:00:00Z", endedAt: null, revision: 0 },
        "2026-10-18T09:00:00Z",
      );
      services.catalog.createClient({ id: "client", name: "Client", code: "C" });
      services.catalog.createCase({
        id: "case",
        clientId: "client",
        title: "Case",
        reference: "REF",
      });
      for (const [id, recordedAt] of [
        ["s1", "2026-10-18T09:01:00Z"],
        ["s2", "2026-10-18T09:02:00Z"],
      ]) {
        services.core.importSource({
          id,
          periodId: null,
          instanceId: "local",
          contentType: "ocr",
          externalId: id,
          recordedAt,
        });
        db.prepare("UPDATE sources SET excerpt=?,app_name=?,window_name=? WHERE id=?").run(
          "Case REF",
          "Word",
          "Case REF",
          id,
        );
      }
      const app = createHttpApp(services);
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
        if (String(input).startsWith("http://timekeeper.test/api"))
          return app.request(new Request(String(input), init));
        const body = JSON.parse(String(init?.body));
        const answers = Object.fromEntries(
          Object.keys(body.questions).map((key) => [
            key,
            {
              type: "choice",
              choice: "candidate_0",
              confidence: 0.9,
              probabilities: { candidate_0: 0.95, unresolved: 0.05 },
            },
          ]),
        );
        return new Response(JSON.stringify({ model: "jev-test", answers }));
      });
      const deps: SessionDeps = {
        apiBase: "http://timekeeper.test/api",
        fetch: fetcher,
        now: () => new Date(),
        newId: () => "id",
        sleep: async () => {},
      };
      const job = await services.history.generate({
        sessionId: "session",
        startAt: "2026-10-18T09:00:00Z",
        endAt: "2026-10-18T09:05:00Z",
      });
      const result = await generateHistoryProposals(deps, {
        TYPESAFE_API_KEY: "test-only",
        JEV_ALLOWED_FIELDS: "observation.text,observation.window_title,candidates.reference",
      });
      expect(result).toMatchObject({ status: "ready", jobId: job.id, proposals: 1 });
      expect(services.repository.allPeriods()).toEqual([]);
      const proposal = services.history.state("session").proposals[0];
      const request = {
        expectedRevision: proposal.revision,
        caseId: "case",
        startedAt: proposal.startedAt,
        endedAt: proposal.endedAt,
        label: "Reviewed documents",
        durationMs: 45_000,
      };
      const accepted = services.history.accept(proposal.id, request);
      expect(accepted.period.durationOverrideMs).toBe(45_000);
      expect(accepted.period.detectedDurationMs).toBeNull();
      expect(
        services.repository
          .allSources()
          .every((source) => source.workPeriodId === accepted.period.id),
      ).toBe(true);
      expect(services.repository.activeSession()?.id).toBe("session");
      expect(services.repository.activePeriod("session")).toBeNull();
      expect(services.history.accept(proposal.id, request).period.id).toBe(accepted.period.id);
      expect(services.repository.allPeriods()).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
