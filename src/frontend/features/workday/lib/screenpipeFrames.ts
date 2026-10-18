import type { components } from "../../../../contracts/generated";
import { applicationApiBaseUrl } from "../../../api/baseUrl";

export type ScreenpipeFrame = components["schemas"]["ScreenpipeFrame"];
export type ScreenpipeFrames = components["schemas"]["ScreenpipeFrames"];

/** How far from the hovered instant a capture still illustrates it. */
export const frameToleranceMs = 2 * 60_000;

/**
 * The capture closest to `at` within `toleranceMs`, from frames sorted by capture time.
 * Binary search keeps scrubbing cheap on long periods.
 */
export function nearestFrame(
  frames: readonly ScreenpipeFrame[],
  at: number,
  toleranceMs = frameToleranceMs,
): ScreenpipeFrame | null {
  let low = 0;
  let high = frames.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (Date.parse(frames[middle].recordedAt) < at) low = middle + 1;
    else high = middle;
  }
  let best: ScreenpipeFrame | null = null;
  for (const candidate of [frames[low - 1], frames[low]]) {
    if (!candidate) continue;
    const distance = Math.abs(Date.parse(candidate.recordedAt) - at);
    if (distance <= toleranceMs && (!best || distance < Math.abs(Date.parse(best.recordedAt) - at)))
      best = candidate;
  }
  return best;
}

/** Image URL served by the TimeKeeper API, which holds the Screenpipe key server-side. */
export function frameImageUrl(frameId: string): string {
  const base = applicationApiBaseUrl(
    "__TAURI_INTERNALS__" in window,
    import.meta.env.VITE_TIMEKEEPER_API_URL,
  );
  return `${base}/api/screenpipe/frames/${encodeURIComponent(frameId)}/image`;
}
