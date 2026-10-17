import { describe, expect, it } from "vitest";
import {
  buildDayView,
  type DayFilter,
  type MainSortKey,
} from "../../src/frontend/features/workday/dayView";
import type { CoreState } from "../../src/frontend/api/client";
import { frontendFixture } from "./frontend-fixture";

type Period = CoreState["periods"][number];
const template = frontendFixture().core.periods[0]!;
const period = (id: string, overrides: Partial<Period> = {}): Period => ({
  ...template,
  id,
  ...overrides,
});
const gap: CoreState["coverageGaps"][number] = {
  id: "gap",
  sessionId: "session",
  startedAt: "2026-10-17T09:30:00Z",
  endedAt: "2026-10-17T09:40:00Z",
  status: "pending",
};
const defaults = {
  coverageGaps: [gap],
  filter: "all" as DayFilter,
  clientFilter: "",
  caseFilter: "",
  mainSort: null,
  leftSort: null,
  caseDetails: (caseId: string | null) => ({
    title: caseId === "case-2" ? "Second case" : "First case",
    clientName: caseId === "case-2" ? "Second client" : "First client",
    clientId: caseId === null ? null : caseId === "case-2" ? 2 : "client-1",
  }),
};
const ids = (periods: readonly Period[]) => periods.map((item) => item.id);

it("groups review and validation without counting excluded work or hiding unresolved assignments", () => {
  const periods = [
    period("validated"),
    period("recognized", { timeValidated: false, demoApp: "Editor" }),
    period("unresolved", { caseId: null, timeValidated: true, demoApp: "Editor" }),
    period("excluded", { excluded: true, timeValidated: false }),
  ];
  const view = buildDayView({ ...defaults, periods, filter: "review", caseFilter: "case" });
  expect(ids(view.included)).toEqual(["validated", "recognized", "unresolved"]);
  expect(ids(view.excluded)).toEqual(["excluded"]);
  expect(ids(view.review)).toEqual(["recognized", "unresolved"]);
  expect(ids(view.validated)).toEqual(["validated"]);
  expect(ids(view.unresolved)).toEqual(["unresolved"]);
  expect(ids(view.recognized)).toEqual(["recognized"]);
  expect(ids(view.shown)).toEqual(["recognized"]);
});

it("combines client and case filters and accepts numeric client identifiers", () => {
  const periods = [
    period("first"),
    period("second", { caseId: "case-2" }),
    period("unknown", { caseId: null }),
  ];
  expect(ids(buildDayView({ ...defaults, periods, clientFilter: "2" }).shown)).toEqual(["second"]);
  expect(
    buildDayView({ ...defaults, periods, clientFilter: "2", caseFilter: "case" }).shown,
  ).toEqual([]);
  expect(ids(buildDayView({ ...defaults, periods, caseFilter: "case-2" }).shown)).toEqual([
    "second",
  ]);
});

it.each(["ascending", "descending"] as const)(
  "inserts gaps chronologically in %s order and omits them from exports",
  (direction) => {
    const periods = [
      period("later", { startedAt: "2026-10-17T10:00:00Z" }),
      period("earlier", { startedAt: "2026-10-17T09:00:00Z" }),
    ];
    const view = buildDayView({ ...defaults, periods, mainSort: { key: "period", direction } });
    const expected =
      direction === "ascending" ? ["earlier", "gap", "later"] : ["later", "gap", "earlier"];
    expect(view.mainRows.map((row) => (row.kind === "gap" ? row.gap.id : row.period.id))).toEqual(
      expected,
    );
    expect(ids(view.exportedPeriods)).toEqual(expected.filter((id) => id !== "gap"));
    expect(ids(periods)).toEqual(["later", "earlier"]);
  },
);

it("shows gaps by default, but omits them from filtered or nonchronological views", () => {
  const periods = [period("included"), period("excluded", { excluded: true })];
  expect(buildDayView({ ...defaults, periods }).mainRows.some((row) => row.kind === "gap")).toBe(
    true,
  );
  const options = [
    ...(["review", "validated", "left"] as const).map((filter) => ({ filter })),
    { clientFilter: "client-1" },
    { caseFilter: "case" },
    ...(["case", "work", "duration", "status"] as MainSortKey[]).map((key) => ({
      mainSort: { key, direction: "ascending" as const },
    })),
  ];
  for (const option of options) {
    expect(
      buildDayView({ ...defaults, periods, ...option }).mainRows.every(
        (row) => row.kind === "period",
      ),
    ).toBe(true);
  }
});

describe.each(["ascending", "descending"] as const)("%s duration order", (direction) => {
  it("uses effective duration and keeps unknown durations last in both tables and exports", () => {
    const periods = [
      period("unknown", { detectedDurationMs: null, durationOverrideMs: null }),
      period("short", { detectedDurationMs: 90000, durationOverrideMs: 1000 }),
      period("long", { detectedDurationMs: 3000, durationOverrideMs: null }),
    ];
    const expected =
      direction === "ascending" ? ["short", "long", "unknown"] : ["long", "short", "unknown"];
    const view = buildDayView({ ...defaults, periods, mainSort: { key: "duration", direction } });
    expect(ids(view.exportedPeriods)).toEqual(expected);
    const left = buildDayView({
      ...defaults,
      periods: periods.map((item) => ({ ...item, excluded: true })),
      filter: "left",
      leftSort: { key: "duration", direction },
    });
    expect(ids(left.leftRows)).toEqual(expected);
    expect(ids(left.exportedPeriods)).toEqual(expected);
  });
});

it("exports left-out periods in their own display order", () => {
  const periods = [
    period("included"),
    period("left-z", { excluded: true, label: "Zebra" }),
    period("left-a", { excluded: true, label: "Alpha" }),
  ];
  const view = buildDayView({
    ...defaults,
    periods,
    filter: "left",
    mainSort: { key: "work", direction: "descending" },
    leftSort: { key: "work", direction: "ascending" },
  });
  expect(ids(view.exportedPeriods)).toEqual(["left-a", "left-z"]);
});

it("orders same-second periods and coverage gaps chronologically with mixed precision", () => {
  const periods = [
    period("later", { startedAt: "2026-10-17T09:00:00.100Z" }),
    period("first", { startedAt: "2026-10-17T09:00:00Z" }),
  ];
  const coverageGaps = [{ ...gap, startedAt: "2026-10-17T09:00:00.050Z" }];
  const view = buildDayView({ ...defaults, periods, coverageGaps });
  expect(ids(view.leftRows)).toEqual(["first", "later"]);
  expect(view.mainRows.map((row) => (row.kind === "gap" ? row.gap.id : row.period.id))).toEqual([
    "first",
    "gap",
    "later",
  ]);
  const descending = buildDayView({
    ...defaults,
    periods,
    coverageGaps,
    mainSort: { key: "period", direction: "descending" },
  });
  expect(
    descending.mainRows.map((row) => (row.kind === "gap" ? row.gap.id : row.period.id)),
  ).toEqual(["later", "gap", "first"]);
});
