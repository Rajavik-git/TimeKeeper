export const defaultWeights = {
  reference: 0.95,
  case_number: 0.95,
  opposing_party: 0.6,
  client_name: 0.3,
  file: 0.6,
  email: 0.45,
  domain: 0.35,
  keyword: 0.15,
} as const;
export type MarkerType = keyof typeof defaultWeights;
export type SignalPlace =
  "app" | "window_title" | "browser_url" | "ocr" | "audio" | "speaker";
export interface Signals {
  app: string;
  window_title: string;
  browser_url?: string | null;
  ocr_texts?: string[];
  audio_transcripts?: string[];
  speakers?: string[];
  previous?: {
    app: string;
    window_title: string;
    matter_id: number | null;
  } | null;
}
export interface Catalog {
  clients: Array<{ id: number; name: string; code: string }>;
  matters: Array<{ id: number; client_id: number; reference: string }>;
  markers: Array<{
    id: number;
    matter_id: number;
    type: MarkerType;
    value: string;
    weight: number;
  }>;
}
export interface FoundMarker {
  type: MarkerType;
  value: string;
  where: SignalPlace;
  weight: number;
  marker_id: number | null;
}
export interface Candidate {
  matter_id: number;
  score: number;
  found: FoundMarker[];
  continuity: boolean;
}
const normalized = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replaceAll("_", " ");
const contains = (text: string, value: string) => {
  const hay = normalized(text),
    needle = normalized(value).trim();
  if (!needle) return false;
  let at = hay.indexOf(needle);
  while (at !== -1) {
    const before = at ? hay[at - 1] : "";
    const after = hay[at + needle.length] ?? "";
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after))
      return true;
    at = hay.indexOf(needle, at + 1);
  }
  return false;
};
export function recognize(signals: Signals, catalog: Catalog): Candidate[] {
  const fields: Array<[SignalPlace, string]> = [
    ["app", signals.app],
    ["window_title", signals.window_title],
    ...(signals.browser_url
      ? [["browser_url", signals.browser_url] as [SignalPlace, string]]
      : []),
    ...(signals.ocr_texts ?? []).map((x): [SignalPlace, string] => ["ocr", x]),
    ...(signals.audio_transcripts ?? []).map((x): [SignalPlace, string] => [
      "audio",
      x,
    ]),
    ...(signals.speakers ?? []).map((x): [SignalPlace, string] => [
      "speaker",
      x,
    ]),
  ];
  return catalog.matters
    .map((matter) => {
      const client = catalog.clients.find((x) => x.id === matter.client_id);
      const cues: Array<{
        type: MarkerType;
        value: string;
        weight: number;
        marker_id: number | null;
      }> = [
        {
          type: "reference",
          value: matter.reference,
          weight: defaultWeights.reference,
          marker_id: null,
        },
        {
          type: "reference",
          value: matter.reference.slice(0, 8),
          weight: defaultWeights.reference,
          marker_id: null,
        },
        ...(client
          ? [
              {
                type: "client_name" as const,
                value: client.name,
                weight: defaultWeights.client_name,
                marker_id: null,
              },
            ]
          : []),
        ...catalog.markers
          .filter((x) => x.matter_id === matter.id)
          .map((x) => ({ ...x, marker_id: x.id })),
      ];
      const found: FoundMarker[] = [];
      const seen = new Set<string>();
      for (const cue of cues) {
        if (cue.value === "N/A" || cue.value.startsWith("CASE [")) continue;
        const hit = fields.find(([place, text]) =>
          cue.type !== "domain" || place === "browser_url"
            ? contains(text, cue.value)
            : false,
        );
        const key = `${cue.type}:${normalized(cue.value)}`;
        if (hit && !seen.has(key)) {
          seen.add(key);
          found.push({
            type: cue.type,
            value: cue.value,
            where: hit[0],
            weight: cue.weight,
            marker_id: cue.marker_id,
          });
        }
      }
      // Full and short matter references are one cue, even when both appear.
      const references = found.filter((x) => x.type === "reference");
      if (references.length > 1) found.splice(found.indexOf(references[1]), 1);
      const continuity =
        !!signals.previous &&
        signals.previous.matter_id === matter.id &&
        signals.previous.app === signals.app &&
        signals.previous.window_title === signals.window_title;
      const score = Math.min(
        0.99,
        1 -
          found.reduce((p, cue) => p * (1 - cue.weight), 1) +
          (continuity ? 0.1 : 0),
      );
      return { matter_id: matter.id, score, found, continuity };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.matter_id - b.matter_id);
}
export function decision(candidates: Candidate[], threshold: number) {
  const best = candidates[0];
  const ambiguousClient =
    !!best &&
    candidates.some(
      (x) =>
        x !== best &&
        x.score === best.score &&
        x.found.every((cue) => cue.type === "client_name") &&
        best.found.every((cue) => cue.type === "client_name"),
    );
  return !best
    ? { state: "to_check" as const, matter_id: null, confidence: 0 }
    : {
        state:
          !ambiguousClient && best.score >= Math.max(threshold, 0.5)
            ? ("assigned" as const)
            : ("to_check" as const),
        matter_id:
          !ambiguousClient && best.score >= 0.5 ? best.matter_id : null,
        confidence: best.score,
      };
}
