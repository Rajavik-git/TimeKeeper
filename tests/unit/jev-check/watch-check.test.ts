import { describe, expect, test, vi } from "vitest";
import { WatchCheck } from "../../../integrations/screenpipe/jev-check/watch-check.ts";
import { runCheck, type CheckResult } from "../../../integrations/screenpipe/jev-check/check.ts";
import { at, CASES, choice, fakeMcp, type FakeScreen } from "./fixtures.ts";
import { callJev, parseAllowedFields } from "../../../integrations/screenpipe/jev-check/jev.ts";
import { sessionState } from "../../../integrations/screenpipe/jev-check/session-bound.ts";

const result = (changes: Partial<CheckResult> = {}): CheckResult => ({
  checked_at: "2026-10-17T10:00:20Z",
  status: "checked",
  detection: "focus_change",
  previous: null,
  current: null,
  transition_at: "2026-10-17T10:00:00Z",
  passed_through: [],
  tab_change: { answer: "yes", confidence: 0.99 },
  assignment: { status: "proposal", case_id: "B", client_id: "client", confidence: 0.99 },
  still_current: true,
  display_proposal: true,
  applied: false,
  ...changes,
});

function setup() {
  let clock = 10_000;
  const context = vi.fn(async () => ({
    sessionId: "session",
    period: { id: "old", assignmentRevision: 4, caseId: "A" },
  }));
  const check = vi.fn(async () => result());
  const deliver = vi.fn(async () => ({ status: "applied" }));
  const report = vi.fn();
  const runner = new WatchCheck(
    { now: () => clock, context, check, deliver, report },
    1000,
    0.7,
    true,
  );
  runner.observe(0);
  return {
    runner,
    context,
    check,
    deliver,
    report,
    advance(ms: number) {
      clock += ms;
    },
  };
}

describe("watch check orchestration", () => {
  test.each(["error", "insufficient_data", "not_stable"] as const)(
    "retries %s without another focus event",
    async (status) => {
      const s = setup();
      s.check.mockResolvedValueOnce(result({ status })).mockResolvedValueOnce(result());
      await s.runner.tick();
      await s.runner.tick();
      expect(s.check).toHaveBeenCalledTimes(1);
      expect(s.deliver).not.toHaveBeenCalled();
      s.advance(1000);
      await s.runner.tick();
      expect(s.deliver).toHaveBeenCalledTimes(1);
      s.advance(60_000);
      await s.runner.tick();
      expect(s.check).toHaveBeenCalledTimes(2);
    },
  );

  test("status outage does not discard pending work or invoke inference", async () => {
    const s = setup();
    s.context.mockRejectedValueOnce(new Error("offline"));
    await s.runner.tick();
    expect(s.check).not.toHaveBeenCalled();
    s.advance(1000);
    await s.runner.tick();
    expect(s.deliver).toHaveBeenCalledTimes(1);
  });

  test("uncertain delivery retries identical payload without refreshing guards or inference", async () => {
    const s = setup();
    s.deliver
      .mockResolvedValueOnce({ status: "unconfirmed" })
      .mockRejectedValueOnce(new Error("offline"));
    await s.runner.tick();
    s.advance(1000);
    await s.runner.tick();
    s.advance(2000);
    await s.runner.tick();
    expect(s.check).toHaveBeenCalledTimes(1);
    expect(s.context).toHaveBeenCalledTimes(1);
    expect(s.deliver).toHaveBeenCalledTimes(3);
    expect(s.deliver.mock.calls[0]).toEqual(s.deliver.mock.calls[1]);
    expect(s.deliver.mock.calls[1]).toEqual(s.deliver.mock.calls[2]);
    expect(s.deliver.mock.calls[0][0]).toEqual({
      sessionId: "session",
      transitionAt: "2026-10-17T10:00:00Z",
      caseId: "B",
      expectedActivePeriodId: "old",
      expectedAssignmentRevision: 4,
    });
  });

  test("new focus discards the old uncertain delivery and waits for stability", async () => {
    const s = setup();
    s.deliver.mockResolvedValueOnce({ status: "unconfirmed" });
    await s.runner.tick();
    s.runner.observe(10_500);
    s.advance(1000);
    await s.runner.tick();
    expect(s.deliver).toHaveBeenCalledTimes(1);
    s.check.mockResolvedValueOnce(result({ still_current: false }));
    s.advance(1000);
    await s.runner.tick();
    expect(s.check).toHaveBeenCalledTimes(2);
    expect(s.deliver).toHaveBeenCalledTimes(1);
  });

  test("focus observed during inference prevents delivery of the older result", async () => {
    const s = setup();
    let finish!: (r: CheckResult) => void;
    s.check.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = s.runner.tick();
    await Promise.resolve();
    s.runner.observe(11_000);
    finish(result());
    await pending;
    expect(s.deliver).not.toHaveBeenCalled();
  });

  test.each(["stale", "pending", "error", "no_change"])("%s is terminal", async (status) => {
    const s = setup();
    s.deliver.mockResolvedValue({ status });
    await s.runner.tick();
    s.advance(60_000);
    await s.runner.tick();
    expect(s.deliver).toHaveBeenCalledTimes(1);
  });

  test.each([
    { tab_change: { answer: "no", confidence: 0.99 } },
    { tab_change: { answer: "uncertain", confidence: 0.2 } },
    { still_current: false },
  ] as Partial<CheckResult>[])("confirmed non-action is terminal: %j", async (changes) => {
    const s = setup();
    s.check.mockResolvedValue(result(changes));
    await s.runner.tick();
    s.advance(60_000);
    await s.runner.tick();
    expect(s.check).toHaveBeenCalledTimes(1);
    expect(s.deliver).not.toHaveBeenCalled();
  });

  test("persistent errors back off up to thirty seconds", async () => {
    const s = setup();
    s.check.mockRejectedValue(new Error("provider"));
    await s.runner.tick();
    for (let i = 0; i < 999; i++) await s.runner.tick();
    expect(s.check).toHaveBeenCalledTimes(1);
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000]) {
      s.advance(delay);
      await s.runner.tick();
    }
    expect(s.check).toHaveBeenCalledTimes(7);
    s.advance(29999);
    await s.runner.tick();
    expect(s.check).toHaveBeenCalledTimes(7);
    s.advance(1);
    await s.runner.tick();
    expect(s.check).toHaveBeenCalledTimes(8);
  });
});

test.each([
  {},
  { error: "internal" },
  [],
  { id: "s" },
  { id: "s", endedAt: "2026-10-17T10:00:00Z" },
])("invalid active-session response stays unreachable: %j", async (body) => {
  const fetcher = vi.fn(async () => Response.json(body)) as unknown as typeof fetch;
  expect(await sessionState("http://local/api", fetcher)).toEqual({ state: "unreachable" });
});

test("watch pipeline recovers from OCR lag and JEV outage, then retries only delivery", async () => {
  let clock = at(180);
  const screens: FakeScreen[] = [{ s: 150, app: "Word", title: "A", text: "old case", frame: 1 }];
  const mcp = fakeMcp(
    [
      { s: 100, type: "window_focus", app: "Word", title: "A" },
      { s: 160, type: "window_focus", app: "Word", title: "B" },
    ],
    screens,
  );
  const jev = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, error: "temporary outage", ms: 1 })
    .mockResolvedValueOnce({
      ok: true,
      json: choice("tab_change", { yes: 0.98, no: 0.01, uncertain: 0.01 }, 0.99),
      ms: 1,
    })
    .mockResolvedValueOnce({
      ok: true,
      json: choice(
        "case_selection",
        { candidate_0: 0.01, candidate_1: 0.98, unresolved: 0.01 },
        0.99,
      ),
      ms: 1,
    });
  const context = vi.fn(async () => ({
    sessionId: "session",
    period: { id: "old", assignmentRevision: 3, caseId: "case-A" },
  }));
  const deliver = vi
    .fn()
    .mockResolvedValueOnce({ status: "unconfirmed" })
    .mockResolvedValueOnce({ status: "applied" });
  const check = vi.fn(() =>
    runCheck(
      { callTool: mcp.callTool, jev, now: () => clock },
      {
        windowMinutes: 5,
        stabilityMs: 10000,
        maxTextChars: 600,
        model: "jev-latest",
        minConfidence: 0.7,
        allowed: parseAllowedFields(
          "previous_observation.text,observation.text,candidates.reference",
        ),
        cases: CASES,
        currentCaseId: "case-A",
        dryRun: false,
      },
    ),
  );
  const runner = new WatchCheck(
    { now: () => clock, context, check, deliver, report: vi.fn() },
    10000,
    0.7,
    true,
  );
  runner.observe(at(160));
  await runner.tick(); // OCR is not indexed yet.
  expect(jev).not.toHaveBeenCalled();
  screens.push({ s: 161, app: "Word", title: "B", text: "new case", frame: 2 });
  clock += 1000;
  await runner.tick(); // Evidence arrived, hosted check temporarily fails.
  expect(jev).toHaveBeenCalledTimes(1);
  clock += 2000;
  await runner.tick(); // Inference succeeds; delivery acknowledgement is lost.
  expect(deliver).toHaveBeenCalledTimes(1);
  expect(jev).toHaveBeenCalledTimes(3);
  clock += 4000;
  await runner.tick(); // Same command is delivered again; no additional inference.
  expect(deliver).toHaveBeenCalledTimes(2);
  expect(deliver.mock.calls[0]).toEqual(deliver.mock.calls[1]);
  expect(jev).toHaveBeenCalledTimes(3);
  expect(context).toHaveBeenCalledTimes(3);
  expect(check).toHaveBeenCalledTimes(3);
});

test.each([
  "authentication",
  "request validation",
  "invalid JSON",
  "invalid tab answer",
  "invalid case answer",
])("watch pipeline stops hosted calls after %s", async (failure) => {
  let clock = at(180);
  const mcp = fakeMcp(
    [
      { s: 100, type: "window_focus", app: "Word", title: "A" },
      { s: 160, type: "window_focus", app: "Word", title: "B" },
    ],
    [
      { s: 150, app: "Word", title: "A", text: "old case", frame: 1 },
      { s: 161, app: "Word", title: "B", text: "new case", frame: 2 },
    ],
  );
  const fetcher = vi.fn(async () => {
    if (failure === "authentication") return Response.json({}, { status: 401 });
    if (failure === "request validation") return Response.json({}, { status: 422 });
    if (failure === "invalid JSON") return new Response("{bad", { status: 200 });
    if (failure === "invalid case answer" && fetcher.mock.calls.length === 1)
      return Response.json(choice("tab_change", { yes: 0.98, no: 0.01, uncertain: 0.01 }, 0.99));
    return Response.json({ model: "unsupported-model", answers: {} });
  });
  const deliver = vi.fn(async () => ({ status: "applied" }));
  const report = vi.fn();
  const runner = new WatchCheck(
    {
      now: () => clock,
      context: async () => ({
        sessionId: "session",
        period: { id: "old", assignmentRevision: 1, caseId: "case-A" },
      }),
      check: () =>
        runCheck(
          {
            callTool: mcp.callTool,
            jev: (body) => callJev(body, "fake-key", fetcher as typeof fetch),
            now: () => clock,
          },
          {
            windowMinutes: 5,
            stabilityMs: 10000,
            maxTextChars: 600,
            model: "jev-latest",
            minConfidence: 0.7,
            allowed: parseAllowedFields(
              "previous_observation.text,observation.text,candidates.reference",
            ),
            cases: CASES,
            currentCaseId: "case-A",
            dryRun: false,
          },
        ),
      deliver,
      report,
    },
    10000,
    0.7,
    true,
  );
  runner.observe(at(160));
  await runner.tick();
  expect(report.mock.calls[0][0]).toMatchObject({ status: "error", retryable: false });
  const expectedCalls = failure === "invalid case answer" ? 2 : 1;
  expect(fetcher).toHaveBeenCalledTimes(expectedCalls);
  clock += 120000;
  await runner.tick();
  expect(fetcher).toHaveBeenCalledTimes(expectedCalls);
  expect(deliver).not.toHaveBeenCalled();
});
