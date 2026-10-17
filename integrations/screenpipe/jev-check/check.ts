// Pipeline: Screenpipe memory (via MCP) -> previous/current context -> JEV tab-change check
// -> JEV case selection (only after a confirmed change) -> freshness check -> result.
// Read-only: it never changes an assignment.

import type { ToolCaller } from "./mcp-client.ts";
import {
  DEFAULT_IGNORED_TITLES, hasNewerFocusChange, parseInputEvents, parseScreenHits, pickObservation, selectContexts,
  type FocusEvent, type Observation,
} from "./context.ts";
import {
  buildCaseRequest, buildTabChangeRequest, interpretCase, interpretTabChange, permittedObservation,
  type CaseAnswer, type CaseRecord, type JevCall, type TabAnswer,
} from "./jev.ts";

export type CheckOptions = {
  windowMinutes: number;
  stabilityMs: number;
  maxTextChars: number;
  allowed: Set<string>;
  model: string;
  minConfidence: number;
  cases: CaseRecord[];
  currentCaseId: string | null;
  dryRun: boolean;
  ignoredTitles?: string[];
};

export type CheckDeps = {
  callTool: ToolCaller;
  jev: (body: unknown) => Promise<JevCall>;
  now: () => number;
};

type Ctx = { ts: string; app: string | null; window_title: string | null; frame_id: number | null };

export type CheckResult = {
  checked_at: string;
  status: "not_stable" | "insufficient_data" | "dry_run" | "error" | "checked";
  wait_ms?: number;
  error?: string;
  detection: "focus_change" | "no_focus_change" | null;
  previous: Ctx | null;
  current: Ctx | null;
  passed_through: string[];
  tab_change: TabAnswer | null;
  assignment: CaseAnswer | { status: "skipped"; reason: string } | null;
  still_current: boolean | null;
  display_proposal: boolean;
  applied: false;
  requests?: unknown[];
};

const iso = (ms: number) => new Date(ms).toISOString();
const ctx = (o: Observation | null): Ctx | null =>
  o ? { ts: o.iso, app: o.app, window_title: o.title, frame_id: o.frameId } : null;

async function readInputEvents(callTool: ToolCaller, startMs: number, endMs: number): Promise<FocusEvent[]> {
  const all: FocusEvent[] = [];
  for (let page = 0; page < 10; page++) {
    const out = await callTool("search-content", {
      content_type: "input", start_time: iso(startMs), end_time: iso(endMs), limit: 20, offset: page * 20, max_content_length: 300,
    });
    const events = parseInputEvents(out);
    all.push(...events);
    if (!/use offset=/.test(out) || events.length === 0) break;
  }
  return all;
}

async function readScreen(callTool: ToolCaller, startMs: number, endMs: number, maxText: number): Promise<Observation[]> {
  const out = await callTool("search-content", {
    content_type: "ocr", start_time: iso(startMs), end_time: iso(endMs), limit: 5, max_content_length: maxText,
  });
  return parseScreenHits(out).filter((o) => o.ts >= startMs && o.ts <= endMs);
}

export async function runCheck(deps: CheckDeps, o: CheckOptions): Promise<CheckResult> {
  const now = deps.now();
  const ignored = o.ignoredTitles ?? DEFAULT_IGNORED_TITLES;
  const base: CheckResult = {
    checked_at: iso(now), status: "checked", detection: null, previous: null, current: null, passed_through: [],
    tab_change: null, assignment: null, still_current: null, display_proposal: false, applied: false,
  };
  const windowStart = now - o.windowMinutes * 60_000;

  // 1. Screenpipe memory through MCP: focus and app-switch events.
  const events = await readInputEvents(deps.callTool, windowStart, now);
  const sel = selectContexts(events, now, o.stabilityMs, ignored);
  if (sel.kind === "not_stable") return { ...base, status: "not_stable", wait_ms: Math.ceil(sel.waitMs) };

  // 2. Previous and current observations.
  let prev: Observation | null = null;
  let cur: Observation | null = null;
  let currentFocusTs: number;
  // A focus change whose earlier window is outside the retrieval window is compared like a content-only change.
  if (sel.kind === "change" && sel.previous) {
    base.detection = "focus_change";
    base.passed_through = sel.passedThrough;
    prev = pickObservation(await readScreen(deps.callTool, windowStart, sel.burstStart.ts - 1, o.maxTextChars), sel.previous?.title ?? null);
    cur = pickObservation(await readScreen(deps.callTool, sel.current.ts, now, o.maxTextChars), sel.current.title);
    currentFocusTs = sel.current.ts;
  } else {
    base.detection = "no_focus_change";
    cur = pickObservation(await readScreen(deps.callTool, windowStart, now, o.maxTextChars), null);
    if (cur) prev = pickObservation(await readScreen(deps.callTool, windowStart, cur.ts - o.stabilityMs, o.maxTextChars), cur.title);
    currentFocusTs = cur?.ts ?? now;
  }
  base.previous = ctx(prev);
  base.current = ctx(cur);

  const pState = permittedObservation(prev, "previous_observation", o.allowed, o.maxTextChars);
  const cState = permittedObservation(cur, "observation", o.allowed, o.maxTextChars);
  if (!prev || !cur || !pState || !cState) {
    return { ...base, status: "insufficient_data", error: !prev || !cur ? "missing observation" : "no permitted field with content" };
  }

  // 3. JEV: did the user really switch tab?
  const tabReq = buildTabChangeRequest(o.model, pState, cState);
  if (o.dryRun) return { ...base, status: "dry_run", requests: [tabReq] };
  const tabCall = await deps.jev(tabReq);
  if (!tabCall.ok) return { ...base, status: "error", error: `JEV: ${tabCall.error}` };
  const tab = interpretTabChange(tabCall.json, o.minConfidence);
  if ("error" in tab) return { ...base, status: "error", error: tab.error };
  base.tab_change = tab;

  // 4. Only after a confirmed change: refresh the new context through MCP and select a case.
  if (tab.answer !== "yes") {
    base.assignment = { status: "skipped", reason: tab.answer === "no" ? "no_tab_change" : "uncertain_tab_change" };
  } else if (o.cases.length === 0) {
    base.assignment = { status: "skipped", reason: "no_cases_configured" };
  } else {
    const fresh = pickObservation(await readScreen(deps.callTool, cur.ts, deps.now(), o.maxTextChars), cur.title) ?? cur;
    const freshState = permittedObservation(fresh, "observation", o.allowed, o.maxTextChars) ?? cState;
    const { body, alias } = buildCaseRequest(o.model, freshState, o.cases, o.allowed, o.currentCaseId);
    const caseCall = await deps.jev(body);
    if (!caseCall.ok) return { ...base, status: "error", error: `JEV: ${caseCall.error}` };
    const ans = interpretCase(caseCall.json, alias, o.cases, o.minConfidence);
    if ("error" in ans) return { ...base, status: "error", error: ans.error };
    base.assignment = ans;
  }

  // 5. Display only if the analysed context is still current.
  const later = await readInputEvents(deps.callTool, currentFocusTs + 1, deps.now());
  base.still_current = !hasNewerFocusChange(later, currentFocusTs, cur.title, ignored);
  base.display_proposal = base.still_current && base.assignment?.status === "proposal";
  return base;
}
