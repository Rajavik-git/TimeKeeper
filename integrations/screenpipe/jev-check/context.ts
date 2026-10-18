// Pure functions: parse Screenpipe MCP `search-content` output, build the focus timeline,
// select the previous and current contexts, and debounce relevant updates.

export type FocusEvent = {
  id: number | null;
  timestampMs: number;
  timestampIso: string;
  type: string;
  app: string | null;
  title: string | null;
};
export type Observation = {
  frameId: number | null;
  timestampMs: number;
  timestampIso: string;
  app: string | null;
  title: string | null;
  text: string;
};

/** Windows that only appear while switching (task switcher) and are never a work context. */
export const DEFAULT_IGNORED_TITLES = ["Changement de tâche", "Task Switching", "Program Manager"];

const RELEVANT_TYPES = new Set(["window_focus", "app_switch"]);

export function parseTimestampMs(timestampIso: string): number {
  // Screenpipe returns up to 9 fractional digits; Date.parse accepts at most 3.
  return Date.parse(timestampIso.replace(/(\.\d{3})\d+/, "$1"));
}

function hits(output: string): string[] {
  return output
    .split(/\r?\n---\r?\n/)
    .map((h) => h.replace(/^Results:.*\r?\n/, "").trim())
    .filter(Boolean);
}

export function parseInputEvents(output: string): FocusEvent[] {
  const out: FocusEvent[] = [];
  for (const h of hits(output)) {
    const m = /\[Input\]\s*(\{.*\})/.exec(h);
    if (!m) continue;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(m[1]);
    } catch {
      continue;
    }
    if (!e || typeof e !== "object" || typeof e.timestamp !== "string") continue;
    const timestampMs = parseTimestampMs(e.timestamp);
    if (!Number.isFinite(timestampMs)) continue;
    out.push({
      id: typeof e.id === "number" ? e.id : null,
      timestampMs,
      timestampIso: e.timestamp,
      type: String(e.event_type ?? ""),
      app: typeof e.app_name === "string" ? e.app_name : null,
      title: typeof e.window_title === "string" ? e.window_title : null,
    });
  }
  return out;
}

export function parseScreenHits(output: string): Observation[] {
  const out: Observation[] = [];
  for (const h of hits(output)) {
    const lines = h.split(/\r?\n/);
    const head =
      /^\[(?:Starred moment\]\s*\[)?(?:Screen[^\]]*|Accessibility)\]\s*(.*?)\s\|\s(.*)$/.exec(
        lines[0] ?? "",
      );
    if (!head) continue;
    const timestampIso = (lines[1] ?? "").trim();
    const timestampMs = parseTimestampMs(timestampIso);
    if (Number.isNaN(timestampMs)) continue;
    const src = /frame_id=(\d+)/.exec(lines[2] ?? "");
    const body = lines
      .slice(src ? 3 : 2)
      .join("\n")
      .trim();
    out.push({
      frameId: src ? Number(src[1]) : null,
      timestampMs,
      timestampIso,
      app: head[1] === "?" ? null : head[1],
      title: head[2] === "?" ? null : head[2],
      text: body,
    });
  }
  return out;
}

export function isRelevant(e: FocusEvent): boolean {
  return RELEVANT_TYPES.has(e.type);
}

/** Focus points with a usable title, sorted, deduplicated, and without task-switcher noise or repeats. */
export function focusTimeline(
  events: FocusEvent[],
  ignoredTitles = DEFAULT_IGNORED_TITLES,
): FocusEvent[] {
  const seen = new Set<string>();
  const sorted = events
    .filter((e) => isRelevant(e) && e.title && !ignoredTitles.includes(e.title))
    .sort((a, b) => a.timestampMs - b.timestampMs)
    .filter((e) => {
      const k = `${e.timestampMs}|${e.app}|${e.title}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const out: FocusEvent[] = [];
  for (const e of sorted) {
    const previous = out.at(-1);
    if (previous?.title !== e.title || previous?.app !== e.app) out.push(e);
  }
  return out;
}

export type Selection =
  | { kind: "no_focus_change" }
  | { kind: "not_stable"; waitMs: number }
  | {
      kind: "change";
      previous: FocusEvent | null;
      current: FocusEvent;
      burstStart: FocusEvent;
      passedThrough: string[];
    };

/**
 * The latest burst groups focus changes separated by less than `stabilityMs`.
 * The previous context is the focus held before that burst; the current context is the last focus.
 * A quick switch and return therefore compares a window with itself.
 */
export function selectContexts(
  events: FocusEvent[],
  nowMs: number,
  stabilityMs: number,
  ignoredTitles = DEFAULT_IGNORED_TITLES,
): Selection {
  const lastRelevant = Math.max(-Infinity, ...events.filter(isRelevant).map((e) => e.timestampMs));
  if (lastRelevant > -Infinity && nowMs - lastRelevant < stabilityMs) {
    return { kind: "not_stable", waitMs: stabilityMs - (nowMs - lastRelevant) };
  }
  const tl = focusTimeline(events, ignoredTitles);
  if (tl.length === 0) return { kind: "no_focus_change" };
  let i = tl.length - 1;
  while (i > 0 && tl[i].timestampMs - tl[i - 1].timestampMs < stabilityMs) i--;
  const current = tl[tl.length - 1];
  const passedThrough = tl
    .slice(i, -1)
    .map((e) => e.title!)
    .filter((t) => t !== current.title);
  return {
    kind: "change",
    previous: i > 0 ? tl[i - 1] : null,
    current,
    burstStart: tl[i],
    passedThrough: [...new Set(passedThrough)],
  };
}

/** Prefers the newest observation whose window title matches; falls back to the newest one. */
export function pickObservation(
  obs: Observation[],
  title: string | null,
  app?: string | null,
): Observation | null {
  const sorted = [...obs].sort((a, b) => b.timestampMs - a.timestampMs);
  if (app !== undefined) return sorted.find((o) => o.title === title && o.app === app) ?? null;
  return (title && sorted.find((o) => o.title === title)) || sorted[0] || null;
}

/** True when a relevant focus change to another window happened after `sinceMs`. */
export function hasNewerFocusChange(
  events: FocusEvent[],
  sinceMs: number,
  currentTitle: string | null,
  ignoredTitles = DEFAULT_IGNORED_TITLES,
  currentApp?: string | null,
): boolean {
  return (
    events.some(
      (e) =>
        e.type === "app_switch" &&
        e.timestampMs > sinceMs &&
        !!e.app &&
        currentApp !== undefined &&
        e.app !== currentApp,
    ) ||
    focusTimeline(events, ignoredTitles).some(
      (e) =>
        e.timestampMs > sinceMs &&
        (e.title !== currentTitle || (currentApp !== undefined && e.app !== currentApp)),
    )
  );
}

/** Debounce for watch mode: every relevant update restarts the stability delay. */
export class StabilityTimer {
  private lastObservedAtMs = -Infinity;
  private pending = false;
  constructor(public readonly stabilityMs: number) {}
  observe(eventAtMs: number) {
    if (eventAtMs > this.lastObservedAtMs) this.lastObservedAtMs = eventAtMs;
    this.pending = true;
  }
  due(nowMs: number): boolean {
    return this.pending && nowMs - this.lastObservedAtMs >= this.stabilityMs;
  }
  consume() {
    this.pending = false;
  }
  get lastEventAtMs() {
    return this.lastObservedAtMs;
  }
}
