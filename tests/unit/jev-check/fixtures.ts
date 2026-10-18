// Fake Screenpipe MCP output in the format returned by screenpipe-mcp 0.20.3 `search-content`,
// and fake JEV responses. All content is fictional.

export const T0 = Date.parse("2026-10-17T10:00:00.000Z");
export const at = (s: number) => T0 + s * 1000;
const iso = (ms: number) => new Date(ms).toISOString().replace("Z", "000000+00:00");

export type FakeInput = { s: number; type: string; app: string | null; title: string | null };
export type FakeScreen = { s: number; app: string; title: string; text: string; frame: number };

export function inputOutput(events: FakeInput[]): string {
  const hits = [...events]
    .sort((a, b) => b.s - a.s)
    .map(
      (e, i) =>
        `[Input] ${JSON.stringify({ id: 1000 + i, timestamp: iso(at(e.s)), event_type: e.type, app_name: e.app, window_title: e.title, browser_url: null })}`,
    );
  return `Results: ${hits.length}/${hits.length}\n\n${hits.join("\n---\n")}`;
}

export function screenOutput(obs: FakeScreen[]): string {
  const hits = [...obs]
    .sort((a, b) => b.s - a.s)
    .map(
      (o) =>
        `[Screen·a11y] ${o.app} | ${o.title}\n${iso(at(o.s))}\nSource: frame_id=${o.frame}; screenpipe://frame/${o.frame}\n${o.text}`,
    );
  return `Results: ${hits.length}/${hits.length}\n\n${hits.join("\n---\n")}`;
}

/** A fake MCP tool caller backed by fixture arrays, honouring start_time/end_time. */
export function fakeMcp(inputs: FakeInput[], screens: FakeScreen[]) {
  const calls: Record<string, unknown>[] = [];
  const callTool = async (name: string, args: Record<string, Record<string, unknown>>) => {
    calls.push({ name, ...args });
    if (name !== "search-content") throw new Error(`unexpected tool ${name}`);
    const start = Date.parse(args.start_time),
      end = Date.parse(args.end_time);
    const inRange = (s: number) => at(s) >= start && at(s) <= end;
    if (args.content_type === "input") return inputOutput(inputs.filter((e) => inRange(e.s)));
    return screenOutput(
      screens
        .filter((o) => inRange(o.s))
        .sort((a, b) => b.s - a.s)
        .slice(0, args.limit ?? 5),
    );
  };
  return { callTool, calls };
}

export function choice(
  question: string,
  probs: Record<string, number>,
  confidence: number,
  model = "jev-1.13.0",
) {
  const top = Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0];
  return {
    model,
    answers: { [question]: { type: "choice", choice: top, probabilities: probs, confidence } },
  };
}

export const CASES = [
  {
    id: "case-A",
    client_id: "client-1",
    reference: "DUP-2026-014",
    title: "Dupont v. Martin - commercial lease dispute",
    client_name: "Dupont SARL",
  },
  {
    id: "case-C",
    client_id: "client-2",
    reference: "LEF-2026-003",
    title: "Lefevre estate - succession and inventory",
    client_name: "Famille Lefevre",
  },
];
