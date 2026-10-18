import { describe, expect, it, vi } from "vitest";
import { createHistoryRunner } from "../../src/backend/history-runner.js";
import { generateHistoryProposals } from "../../src/mcp/history.js";
import { proposeHistory } from "../../integrations/screenpipe/jev-check/history.js";
import type { HistoryClaim } from "../../src/contracts/history.js";
import type { SessionDeps } from "../../src/mcp/session.js";

const env = {
  TYPESAFE_API_KEY: "private-test-token",
  JEV_ALLOWED_FIELDS:
    "observation.text,observation.app_name,observation.window_title,candidates.reference",
  MAX_TEXT_CHARS: "600",
};
function source(id: string, at: string, app = "Word"): HistoryClaim["sources"][number] {
  return {
    id,
    workPeriodId: null,
    instanceId: "local",
    contentType: "ocr",
    externalId: id,
    recordedAt: at,
    ingestedAt: at,
    excerpt: `Source ${id}`,
    appName: app,
    windowName: `Context ${id}`,
    validationStatus: "unvalidated",
    availabilityStatus: "unknown",
  };
}
function claim(): HistoryClaim {
  return {
    job: {
      id: "j",
      sessionId: "s",
      startAt: "2026-10-18T09:00:00Z",
      endAt: "2026-10-18T09:05:00Z",
      createdAt: "2026-10-18T09:05:00Z",
      finishedAt: null,
      status: "running",
      error: null,
      sourceCount: 4,
      proposalCount: 0,
    },
    claimId: "claim",
    session: { id: "s", startedAt: "2026-10-18T09:00:00Z", endedAt: null, revision: 0 },
    cases: [{ id: "a", clientId: "c", reference: "A", title: "Case A", clientName: "Client" }],
    sources: [
      source("1", "2026-10-18T09:00:00Z"),
      source("2", "2026-10-18T09:00:30Z"),
      source("3", "2026-10-18T09:01:00Z", "Browser"),
      source("4", "2026-10-18T09:01:30Z", "Browser"),
    ],
  };
}
const jev = (choice = "candidate_0", confidence = 0.95) =>
  new Response(
    JSON.stringify({
      model: "jev-test",
      answers: Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => [
          `context_${i}`,
          {
            type: "choice",
            choice,
            confidence,
            probabilities: {
              candidate_0: choice === "candidate_0" ? 0.95 : 0.05,
              unresolved: choice === "unresolved" ? 0.95 : 0.05,
            },
          },
        ]),
      ),
    }),
  );
const deps = (fetcher: typeof fetch): SessionDeps => ({
  apiBase: "http://localhost:8787/api",
  fetch: fetcher,
  now: () => new Date(),
  newId: () => "id",
  sleep: async () => {},
});

describe("Screenpipe history workflow", () => {
  it("classifies all contexts across a batch boundary", async () => {
    const input = claim();
    input.sources = Array.from({ length: 33 }, (_, i) =>
      source(String(i), new Date(Date.parse(input.job.startAt) + i * 1000).toISOString()),
    );
    const send = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const answer = {
        type: "choice",
        choice: "candidate_0",
        confidence: 0.95,
        probabilities: { candidate_0: 0.95, unresolved: 0.05 },
      };
      return new Response(
        JSON.stringify({
          model: "jev-test",
          answers: Object.fromEntries(Object.keys(request.questions).map((key) => [key, answer])),
        }),
      );
    });
    const proposals = await proposeHistory(input, env, send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].sourceIds).toHaveLength(33);
  });
  it("merges known same-case observations across applications without computing work duration", async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(async () => jev());
    const proposals = await proposeHistory(claim(), env, send);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      caseId: "a",
      sourceIds: ["1", "2", "3", "4"],
      endedAt: "2026-10-18T09:01:30.001Z",
    });
    expect(proposals[0]).not.toHaveProperty("durationMs");
    expect(send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(send.mock.calls[0][1]?.body));
    expect(sent.state.candidates[0]).toEqual({
      alias: "candidate_0",
      client: "client_0",
      reference: "A",
    });
    expect(JSON.stringify(sent)).not.toContain("Client");
  });
  it("keeps low-confidence and no-match cases unresolved", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => jev("candidate_0", 0.1))
      .mockImplementationOnce(async () => jev("unresolved"));
    const proposals = await proposeHistory(claim(), env, send);
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.every((p) => p.caseId === null)).toBe(true);
  });
  it("does not call hosted inference without an explicit permitted-field configuration", async () => {
    const send = vi.fn<typeof fetch>();
    await expect(proposeHistory(claim(), { TYPESAFE_API_KEY: "private" }, send)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
  it("preserves an A to B to A change within one minute", async () => {
    const input = claim();
    input.cases.push({
      id: "b",
      clientId: "c",
      reference: "B",
      title: "Case B",
      clientName: "Client",
    });
    input.sources = [
      source("a-first", "2026-10-18T09:00:00Z"),
      source("b", "2026-10-18T09:00:15Z"),
      source("a-last", "2026-10-18T09:00:30Z"),
    ];
    input.sources[2].windowName = input.sources[0].windowName;
    input.sources[2].excerpt = input.sources[0].excerpt;
    const send = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            model: "jev-test",
            answers: {
              context_0: {
                type: "choice",
                choice: "candidate_0",
                confidence: 0.9,
                probabilities: { candidate_0: 0.9, candidate_1: 0.05, unresolved: 0.05 },
              },
              context_1: {
                type: "choice",
                choice: "candidate_1",
                confidence: 0.9,
                probabilities: { candidate_0: 0.05, candidate_1: 0.9, unresolved: 0.05 },
              },
            },
          }),
        ),
    );
    expect((await proposeHistory(input, env, send)).map((p) => p.caseId)).toEqual(["a", "b", "a"]);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("keeps contradictory same-time observations unresolved and ignores an endpoint-only observation", async () => {
    const input = claim();
    input.sources = [
      source("first", "2026-10-18T09:00:00Z"),
      source("second", "2026-10-18T09:00:00Z"),
      source("endpoint", input.job.endAt),
    ];
    const send = vi.fn<typeof fetch>().mockImplementation(async () => {
      const response = await jev().json();
      response.answers.context_1 = {
        type: "choice",
        choice: "unresolved",
        confidence: 0.9,
        probabilities: { candidate_0: 0.1, unresolved: 0.9 },
      };
      return new Response(JSON.stringify(response));
    });
    const proposals = await proposeHistory(input, env, send);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ caseId: null, sourceIds: ["first", "second"] });
    expect(Date.parse(proposals[0].endedAt)).toBeGreaterThan(Date.parse(proposals[0].startedAt));
  });
  it("bounds sampled text even when the configured limit is smaller than sample count", async () => {
    const input = claim();
    input.sources = [...input.sources.slice(0, 2), source("middle", "2026-10-18T09:00:40Z")];
    const send = vi.fn<typeof fetch>().mockImplementation(async () => jev());
    await proposeHistory(input, { ...env, MAX_TEXT_CHARS: "1" }, send);
    const sent = JSON.parse(String(send.mock.calls[0][1]?.body));
    expect(
      Object.values(sent.state.observations).every(
        (value) => ((value as { text?: string }).text?.length ?? 0) <= 1,
      ),
    ).toBe(true);
  });
  it("claims no job without issuing a model request", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("null"));
    expect(await generateHistoryProposals(deps(send), env)).toEqual({ status: "no-pending-job" });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("submits drafts through the application API and returns only safe status", async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/history/claim")) return new Response(JSON.stringify(claim()));
      if (url.endsWith("/complete"))
        return new Response(JSON.stringify({ ...claim().job, status: "ready", proposalCount: 1 }));
      return jev();
    });
    expect(await generateHistoryProposals(deps(send), env)).toEqual({
      status: "ready",
      jobId: "j",
      proposals: 1,
    });
    expect(send.mock.calls.some(([url]) => String(url).includes("/work-periods"))).toBe(false);
  });
  it("records failed inference without persisting partial proposals or exposing provider content", async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      if (String(input).endsWith("/claim")) return new Response(JSON.stringify(claim()));
      if (String(input).endsWith("/fail")) return new Response("{}");
      return new Response("private provider detail", { status: 401 });
    });
    const result = await generateHistoryProposals(deps(send), env);
    expect(result).toEqual({ status: "generation-failed", jobId: "j" });
    expect(send.mock.calls.some(([url]) => String(url).endsWith("/complete"))).toBe(false);
    expect(String(send.mock.calls.at(-1)?.[1]?.body)).not.toContain("private");
  });
});

describe("history pipe dispatch", () => {
  it("fails before dispatch when the MCP history tool is missing", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"result":{"tools":[]}}'));
    const runner = createHistoryRunner({ SCREENPIPE_API_KEY: "private" }, send);
    await expect(runner.dispatch()).rejects.toThrow("runner-unavailable");
    expect(send).toHaveBeenCalledTimes(1);
    expect(String(send.mock.calls[0][0])).toContain("/mcp");
  });
  it("aborts a pending capability probe on shutdown without dispatching", async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("stopped")), {
            once: true,
          });
        }),
    );
    const runner = createHistoryRunner({ SCREENPIPE_API_KEY: "private" }, send);
    const outcome = runner.dispatch().catch((error: Error) => error.message);
    await runner.stop();
    expect(await outcome).toBe("runner-unavailable");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("allows configured loopback origins and requires an explicit successful dispatch acknowledgement", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) =>
        String(input).endsWith("/mcp")
          ? new Response(
              JSON.stringify({ result: { tools: [{ name: "generate_history_proposals" }] } }),
            )
          : new Response('{"success":true}'),
      );
    const runner = createHistoryRunner(
      { SCREENPIPE_API_KEY: "private", SCREENPIPE_URL: "http://127.0.0.1:3030" },
      send,
    );
    expect(await runner.dispatch()).toBe("started");
    expect(send.mock.calls[1][0]).toBe("http://127.0.0.1:3030/pipes/generate-work-periods/run");
    expect(send.mock.calls[0][1]?.redirect).toBe("error");
    await runner.stop();
  });
  it("blocks external origins and refused dispatch responses", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) =>
        String(input).endsWith("/mcp")
          ? new Response(
              JSON.stringify({ result: { tools: [{ name: "generate_history_proposals" }] } }),
            )
          : new Response('{"success":false}'),
      );
    const blocked = createHistoryRunner(
      { SCREENPIPE_API_KEY: "private", SCREENPIPE_URL: "http://example.com" },
      send,
    );
    expect(blocked.configured).toBe(false);
    await expect(blocked.dispatch()).rejects.toThrow("not-configured");
    expect(send).not.toHaveBeenCalled();
    const local = createHistoryRunner({ SCREENPIPE_API_KEY: "private" }, send);
    await expect(local.dispatch()).rejects.toThrow("runner-unavailable");
  });
  it("reports an uncertain delivery without automatically retrying", async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      if (String(input).endsWith("/mcp"))
        return new Response(
          JSON.stringify({ result: { tools: [{ name: "generate_history_proposals" }] } }),
        );
      throw new Error("network");
    });
    const runner = createHistoryRunner({ SCREENPIPE_API_KEY: "private" }, send);
    expect(await runner.dispatch()).toBe("unconfirmed");
    expect(send).toHaveBeenCalledTimes(2);
  });
});
