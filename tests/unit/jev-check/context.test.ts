import { describe, expect, test } from "vitest";
import {
  focusTimeline, hasNewerFocusChange, parseInputEvents, parseScreenHits, parseTs, pickObservation, selectContexts, StabilityTimer,
} from "../../../integrations/screenpipe/jev-check/context.ts";
import { at, inputOutput, screenOutput } from "./fixtures.ts";

const STAB = 10_000;

describe("parsing MCP search-content output", () => {
  test("parses nanosecond timestamps", () => {
    expect(parseTs("2026-10-17T19:47:13.510457200+02:00")).toBe(Date.parse("2026-10-17T17:47:13.510Z"));
  });

  test("parses input events", () => {
    const ev = parseInputEvents(inputOutput([{ s: 1, type: "window_focus", app: "chrome.exe", title: "Tab A - Google Chrome" }]));
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: "window_focus", app: "chrome.exe", title: "Tab A - Google Chrome", ts: at(1) });
  });

  test("parses screen hits with multi-line text and unknown app", () => {
    const out = screenOutput([{ s: 2, app: "?", title: "Doc - Word", text: "line 1\nline 2", frame: 42 }]);
    const [o] = parseScreenHits(out);
    expect(o).toMatchObject({ frameId: 42, app: null, title: "Doc - Word", text: "line 1\nline 2", ts: at(2) });
  });

  test("parses a real screenpipe-mcp hit header", () => {
    const real = "Results: 1/139 (use offset=1 for more)\n\n[Screen·a11y] Code.exe | Vérification JEV via Scr… - TimeKeeper - Visual Studio Code\n2026-10-17T19:47:55.030837+02:00\nSource: frame_id=4326; screenpipe://frame/4326\nMinimize\nClose";
    const [o] = parseScreenHits(real);
    expect(o).toMatchObject({ frameId: 4326, app: "Code.exe", title: "Vérification JEV via Scr… - TimeKeeper - Visual Studio Code", text: "Minimize\nClose" });
  });
});

describe("focus timeline", () => {
  test("drops task-switcher noise, untitled app_switch events, and repeats", () => {
    const ev = parseInputEvents(inputOutput([
      { s: 0, type: "window_focus", app: "chrome.exe", title: "A" },
      { s: 1, type: "app_switch", app: "explorer.exe", title: null },
      { s: 1, type: "window_focus", app: "explorer.exe", title: "Changement de tâche" },
      { s: 2, type: "window_focus", app: "chrome.exe", title: "A" },
      { s: 3, type: "window_focus", app: "chrome.exe", title: "B" },
    ]));
    expect(focusTimeline(ev).map((e) => e.title)).toEqual(["A", "B"]);
  });
});

describe("selecting previous and current contexts", () => {
  test("tab switch: previous is the tab before the change", () => {
    const ev = parseInputEvents(inputOutput([
      { s: 0, type: "window_focus", app: "chrome.exe", title: "A" },
      { s: 30, type: "window_focus", app: "chrome.exe", title: "B" },
    ]));
    const sel = selectContexts(ev, at(45), STAB);
    expect(sel.kind).toBe("change");
    if (sel.kind !== "change") return;
    expect(sel.previous?.title).toBe("A");
    expect(sel.current.title).toBe("B");
    expect(sel.passedThrough).toEqual([]);
  });

  test("quick switch and return compares the tab with itself", () => {
    const ev = parseInputEvents(inputOutput([
      { s: 0, type: "window_focus", app: "chrome.exe", title: "A" },
      { s: 30, type: "window_focus", app: "chrome.exe", title: "B" },
      { s: 31.5, type: "window_focus", app: "chrome.exe", title: "A" },
    ]));
    const sel = selectContexts(ev, at(45), STAB);
    if (sel.kind !== "change") throw new Error(sel.kind);
    expect(sel.previous?.title).toBe("A");
    expect(sel.current.title).toBe("A");
    expect(sel.passedThrough).toEqual(["B"]);
  });

  test("not stable while a relevant update is younger than the delay", () => {
    const ev = parseInputEvents(inputOutput([{ s: 40, type: "window_focus", app: "chrome.exe", title: "B" }]));
    const sel = selectContexts(ev, at(45), STAB);
    expect(sel).toEqual({ kind: "not_stable", waitMs: 5000 });
  });

  test("app_switch without a title also blocks stability", () => {
    const ev = parseInputEvents(inputOutput([{ s: 44, type: "app_switch", app: "explorer.exe", title: null }]));
    expect(selectContexts(ev, at(45), STAB).kind).toBe("not_stable");
  });

  test("no focus events means no focus change", () => {
    expect(selectContexts([], at(45), STAB)).toEqual({ kind: "no_focus_change" });
  });

  test("pickObservation prefers the matching title", () => {
    const obs = parseScreenHits(screenOutput([
      { s: 10, app: "chrome.exe", title: "A", text: "a", frame: 1 },
      { s: 11, app: "chrome.exe", title: "B", text: "b", frame: 2 },
    ]));
    expect(pickObservation(obs, "A")?.frameId).toBe(1);
    expect(pickObservation(obs, "Z")?.frameId).toBe(2);
    expect(pickObservation([], "A")).toBeNull();
  });

  test("hasNewerFocusChange ignores the same window and noise", () => {
    const ev = parseInputEvents(inputOutput([
      { s: 50, type: "window_focus", app: "chrome.exe", title: "B" },
      { s: 51, type: "window_focus", app: "explorer.exe", title: "Task Switching" },
    ]));
    expect(hasNewerFocusChange(ev, at(40), "B")).toBe(false);
    expect(hasNewerFocusChange(ev, at(40), "A")).toBe(true);
  });
});

describe("stability timer (10 s, reset by every relevant update)", () => {
  test("fires only after 10 s without updates", () => {
    const t = new StabilityTimer(STAB);
    expect(t.due(at(100))).toBe(false);
    t.observe(at(0));
    expect(t.due(at(9.9))).toBe(false);
    t.observe(at(5)); // reset
    expect(t.due(at(10))).toBe(false);
    expect(t.due(at(15))).toBe(true);
    t.consume();
    expect(t.due(at(30))).toBe(false);
  });

  test("an older event does not move the deadline back", () => {
    const t = new StabilityTimer(STAB);
    t.observe(at(20));
    t.observe(at(5));
    expect(t.due(at(25))).toBe(false);
    expect(t.due(at(30))).toBe(true);
  });
});
