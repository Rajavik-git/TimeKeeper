// End-to-end pipeline with fake Screenpipe MCP and fake JEV: Screenpipe -> MCP -> JEV -> result.
import { describe, expect, test } from "vitest";
import { runCheck, type CheckOptions } from "../../../integrations/screenpipe/jev-check/check.ts";
import { parseAllowedFields } from "../../../integrations/screenpipe/jev-check/jev.ts";
import { at, CASES, choice, fakeMcp, type FakeInput, type FakeScreen } from "./fixtures.ts";

const opts = (o: Partial<CheckOptions> = {}): CheckOptions => ({
  windowMinutes: 5,
  stabilityMs: 10_000,
  maxTextChars: 600,
  model: "jev-latest",
  minConfidence: 0.7,
  allowed: parseAllowedFields(
    "previous_observation.text,previous_observation.window_title,observation.text,observation.window_title,candidates.reference,candidates.title",
  ),
  cases: CASES,
  currentCaseId: "case-A",
  dryRun: false,
  ...o,
});

function fakeJev(...responses: Record<string, unknown>[]) {
  const sent: Record<string, unknown>[] = [];
  const jev = async (body: Record<string, unknown>) => {
    sent.push(body);
    const r = responses.shift();
    return r?.error
      ? { ok: false as const, error: r.error, ms: 1 }
      : { ok: true as const, json: r, ms: 1 };
  };
  return { jev, sent };
}

const switchInputs: FakeInput[] = [
  {
    s: 100,
    type: "window_focus",
    app: "WINWORD.EXE",
    title: "DUP-2026-014 conclusions.docx - Word",
  },
  {
    s: 160,
    type: "window_focus",
    app: "WINWORD.EXE",
    title: "LEF-2026-003 inventaire.docx - Word",
  },
];
const switchScreens: FakeScreen[] = [
  {
    s: 150,
    app: "WINWORD.EXE",
    title: "DUP-2026-014 conclusions.docx - Word",
    text: "Unpaid rent, Dupont v. Martin",
    frame: 1,
  },
  {
    s: 161,
    app: "WINWORD.EXE",
    title: "LEF-2026-003 inventaire.docx - Word",
    text: "Estate inventory, Lefevre",
    frame: 2,
  },
];

describe("pipeline", () => {
  test("confirmed tab change -> case proposal displayed when still current", async () => {
    const mcp = fakeMcp(switchInputs, switchScreens);
    const { jev, sent } = fakeJev(
      choice("tab_change", { yes: 0.97, no: 0.02, uncertain: 0.01 }, 0.95),
      choice("case_selection", { candidate_0: 0.01, candidate_1: 0.98, unresolved: 0.01 }, 0.97),
    );
    const r = await runCheck({ callTool: mcp.callTool, jev, now: () => at(180) }, opts());
    expect(r.status).toBe("checked");
    expect(r.previous?.window_title).toContain("DUP-2026-014");
    expect(r.current?.window_title).toContain("LEF-2026-003");
    expect(r.tab_change?.answer).toBe("yes");
    expect(r.assignment).toMatchObject({ status: "proposal", case_id: "case-C" });
    expect(r.still_current).toBe(true);
    expect(r.display_proposal).toBe(true);
    expect(r.applied).toBe(false);
    // JEV receives two bounded contexts, not history or IDs.
    expect(sent[0].state.previous_observation.text).toBe("Unpaid rent, Dupont v. Martin");
    expect(JSON.stringify(sent)).not.toContain("case-C");
    // The new context was read again through MCP before case selection.
    expect(mcp.calls.filter((c) => c.content_type === "ocr").length).toBeGreaterThanOrEqual(3);
  });

  test("same tab, content changed -> no, no case lookup", async () => {
    const mcp = fakeMcp(
      [],
      [
        { s: 150, app: "chrome.exe", title: "Doc A - Chrome", text: "paragraph 1", frame: 1 },
        { s: 175, app: "chrome.exe", title: "Doc A - Chrome", text: "paragraph 1 and 2", frame: 2 },
      ],
    );
    const { jev, sent } = fakeJev(
      choice("tab_change", { yes: 0.02, no: 0.97, uncertain: 0.01 }, 0.96),
    );
    const r = await runCheck({ callTool: mcp.callTool, jev, now: () => at(180) }, opts());
    expect(r.tab_change?.answer).toBe("no");
    expect(r.assignment).toEqual({ status: "skipped", reason: "no_tab_change" });
    expect(r.display_proposal).toBe(false);
    expect(sent).toHaveLength(1);
  });

  test("quick switch and return -> compares tab with itself and lists the passed tab", async () => {
    const mcp = fakeMcp(
      [
        { s: 100, type: "window_focus", app: "chrome.exe", title: "A" },
        { s: 160, type: "window_focus", app: "chrome.exe", title: "B" },
        { s: 161, type: "window_focus", app: "chrome.exe", title: "A" },
      ],
      [
        { s: 150, app: "chrome.exe", title: "A", text: "same page", frame: 1 },
        { s: 160.5, app: "chrome.exe", title: "B", text: "other page", frame: 2 },
        { s: 162, app: "chrome.exe", title: "A", text: "same page", frame: 3 },
      ],
    );
    const { jev, sent } = fakeJev(
      choice("tab_change", { yes: 0.03, no: 0.95, uncertain: 0.02 }, 0.94),
    );
    const r = await runCheck({ callTool: mcp.callTool, jev, now: () => at(180) }, opts());
    expect(r.previous?.window_title).toBe("A");
    expect(r.current?.window_title).toBe("A");
    expect(r.passed_through).toEqual(["B"]);
    expect(sent[0].state.observation.text).toBe("same page");
    expect(r.tab_change?.answer).toBe("no");
  });

  test("not stable -> JEV is not called", async () => {
    const mcp = fakeMcp(switchInputs, switchScreens);
    const { jev, sent } = fakeJev();
    const r = await runCheck({ callTool: mcp.callTool, jev, now: () => at(165) }, opts());
    expect(r).toMatchObject({ status: "not_stable", wait_ms: 5000 });
    expect(sent).toHaveLength(0);
  });

  test("missing previous capture -> insufficient data, no JEV call", async () => {
    const mcp = fakeMcp(switchInputs, [switchScreens[1]]);
    const { jev, sent } = fakeJev();
    const r = await runCheck({ callTool: mcp.callTool, jev, now: () => at(180) }, opts());
    expect(r.status).toBe("insufficient_data");
    expect(sent).toHaveLength(0);
  });

  test("low confidence -> uncertain, no assignment", async () => {
    const mcp = fakeMcp(switchInputs, switchScreens);
    const { jev, sent } = fakeJev(
      choice("tab_change", { yes: 0.55, no: 0.4, uncertain: 0.05 }, 0.45),
    );
    const r = await runCheck({ callTool: mcp.callTool, jev, now: () => at(180) }, opts());
    expect(r.tab_change).toMatchObject({ answer: "uncertain", reason: "low_confidence" });
    expect(r.assignment).toEqual({ status: "skipped", reason: "uncertain_tab_change" });
    expect(sent).toHaveLength(1);
  });

  test("context changed during analysis -> proposal not displayed", async () => {
    let clock = at(180);
    const inputs = [...switchInputs];
    const mcp = fakeMcp(inputs, switchScreens);
    const { jev: inner } = fakeJev(
      choice("tab_change", { yes: 0.97, no: 0.02, uncertain: 0.01 }, 0.95),
      choice("case_selection", { candidate_0: 0.01, candidate_1: 0.98, unresolved: 0.01 }, 0.97),
    );
    const jev = async (b: unknown) => {
      // The user moves to another window while JEV is answering.
      inputs.push({ s: 185, type: "window_focus", app: "chrome.exe", title: "Something else" });
      clock = at(190);
      return inner(b);
    };
    const r = await runCheck({ callTool: mcp.callTool, jev, now: () => clock }, opts());
    expect(r.assignment).toMatchObject({ status: "proposal" });
    expect(r.still_current).toBe(false);
    expect(r.display_proposal).toBe(false);
  });

  test("JEV error is reported, nothing displayed", async () => {
    const mcp = fakeMcp(switchInputs, switchScreens);
    const { jev } = fakeJev({ error: "authentication failure" });
    const r = await runCheck({ callTool: mcp.callTool, jev, now: () => at(180) }, opts());
    expect(r).toMatchObject({
      status: "error",
      error: "JEV: authentication failure",
      display_proposal: false,
    });
  });

  test("dry run builds the request and sends nothing", async () => {
    const mcp = fakeMcp(switchInputs, switchScreens);
    const { jev, sent } = fakeJev();
    const r = await runCheck(
      { callTool: mcp.callTool, jev, now: () => at(180) },
      opts({ dryRun: true }),
    );
    expect(r.status).toBe("dry_run");
    expect(r.requests).toHaveLength(1);
    expect(sent).toHaveLength(0);
  });

  test("no cases configured -> change confirmed but no proposal", async () => {
    const mcp = fakeMcp(switchInputs, switchScreens);
    const { jev } = fakeJev(choice("tab_change", { yes: 0.97, no: 0.02, uncertain: 0.01 }, 0.95));
    const r = await runCheck(
      { callTool: mcp.callTool, jev, now: () => at(180) },
      opts({ cases: [], currentCaseId: null }),
    );
    expect(r.tab_change?.answer).toBe("yes");
    expect(r.assignment).toEqual({ status: "skipped", reason: "no_cases_configured" });
  });
});

describe("focus boundary and identity regressions", () => {
  test("old predecessor event outside five minutes still compares the capture before the new boundary", async () => {
    const mcp = fakeMcp(
      [
        { s: 0, type: "window_focus", app: "Word", title: "A" },
        { s: 400, type: "window_focus", app: "Word", title: "B" },
      ],
      [
        { s: 399, app: "Word", title: "A", text: "old", frame: 1 },
        { s: 401, app: "Word", title: "B", text: "new", frame: 2 },
        { s: 410, app: "Word", title: "B", text: "also new", frame: 3 },
      ],
    );
    const { jev, sent } = fakeJev(
      choice("tab_change", { yes: 0.97, no: 0.02, uncertain: 0.01 }, 0.95),
    );
    const r = await runCheck(
      { callTool: mcp.callTool, jev, now: () => at(420) },
      opts({ cases: [] }),
    );
    expect(r.transition_at).toBe(new Date(at(400)).toISOString());
    expect(sent[0].state.previous_observation.text).toBe("old");
    expect(sent[0].state.observation.text).toBe("also new");
  });

  test("missing predecessor never falls back to comparing B with B", async () => {
    const mcp = fakeMcp(
      [{ s: 400, type: "window_focus", app: "Word", title: "B" }],
      [
        { s: 401, app: "Word", title: "B", text: "new", frame: 2 },
        { s: 410, app: "Word", title: "B", text: "also new", frame: 3 },
      ],
    );
    const { jev, sent } = fakeJev();
    const r = await runCheck({ callTool: mcp.callTool, jev, now: () => at(420) }, opts());
    expect(r.status).toBe("insufficient_data");
    expect(r.transition_at).toBe(new Date(at(400)).toISOString());
    expect(sent).toHaveLength(0);
  });

  test("retry after five minutes preserves its original focus boundary", async () => {
    const mcp = fakeMcp(
      [],
      [
        { s: 399, app: "Word", title: "A", text: "old", frame: 1 },
        { s: 890, app: "Word", title: "B", text: "new", frame: 2 },
      ],
    );
    const { jev, sent } = fakeJev(
      choice("tab_change", { yes: 0.97, no: 0.02, uncertain: 0.01 }, 0.95),
    );
    const r = await runCheck(
      { callTool: mcp.callTool, jev, now: () => at(900) },
      opts({
        cases: [],
        focusEvent: {
          id: 1,
          timestampMs: at(400),
          timestampIso: new Date(at(400)).toISOString(),
          type: "window_focus",
          app: "Word",
          title: "B",
        },
      }),
    );
    expect(r.transition_at).toBe(new Date(at(400)).toISOString());
    expect(sent[0].state.previous_observation.text).toBe("old");
  });

  test("same title in another application during inference makes the answer stale", async () => {
    let clock = at(180);
    const inputs = [...switchInputs];
    const mcp = fakeMcp(inputs, switchScreens);
    const { jev: inner } = fakeJev(
      choice("tab_change", { yes: 0.97, no: 0.02, uncertain: 0.01 }, 0.95),
      choice("case_selection", { candidate_0: 0.01, candidate_1: 0.98, unresolved: 0.01 }, 0.97),
    );
    const jev = async (body: unknown) => {
      inputs.push({ s: 185, type: "app_switch", app: "Browser", title: switchInputs[1].title });
      clock = at(190);
      return inner(body);
    };
    const r = await runCheck({ callTool: mcp.callTool, jev, now: () => clock }, opts());
    expect(r.still_current).toBe(false);
    expect(r.display_proposal).toBe(false);
  });
});
