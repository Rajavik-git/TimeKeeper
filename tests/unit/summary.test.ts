import { expect, it } from "vitest";
import { summarize, type SummaryPeriod } from "../../src/frontend/calculations/summary.js";
const p = (
  id: string,
  caseId: string,
  clientId: string,
  duration: number | null,
  coverage: "complete" | "incomplete" = "complete",
): SummaryPeriod => ({
  id,
  caseId,
  clientId,
  startedAt: "2026-10-17T09:00:00Z",
  endedAt: "2026-10-17T09:01:00Z",
  detectedDurationMs: duration,
  durationOverrideMs: null,
  coverage,
});
it("rounds each selected group from underlying precise durations and flags incomplete inputs", () => {
  const periods = [
    p("a", "A", "C", 20000),
    p("b", "A", "C", 20000),
    p("c", "B", "C", 20000),
    p("d", "B", "C", null, "incomplete"),
    { ...p("candidate", "A", "C", 900000), reconstructionCandidate: true },
  ];
  expect(summarize(periods, { caseId: "A" })).toMatchObject({
    preciseDurationMs: 40000,
    roundedMinutes: 1,
    complete: true,
  });
  expect(summarize(periods, { clientId: "C" })).toMatchObject({
    preciseDurationMs: 60000,
    roundedMinutes: 1,
    complete: false,
    incompletePeriodIds: ["d"],
  });
  expect(summarize([p("x", "A", "C", 0)])).toMatchObject({ roundedMinutes: 0, complete: true });
});
it.skip("clips a period at date-range boundaries once the selection rule is agreed in docs/REQUIREMENTS.md", () => {});
it.skip("selects validation states for monetary and time totals once agreed in docs/REQUIREMENTS.md", () => {});
