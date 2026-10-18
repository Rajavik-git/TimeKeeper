import { afterEach, expect, it, vi } from "vitest";
import { activityPeriods, activityTimeline } from "../../src/frontend/calculations/activity";
import { monthlyRecordedTime } from "../../src/frontend/calculations/comparison";
import { draftInvoice } from "../../src/frontend/calculations/billing";
import {
  invoiceRows,
  invoiceRowsCsv,
} from "../../src/frontend/features/billing-status/lib/invoiceRows";
import { auditDate, shortDate } from "../../src/frontend/shared/format";
import { frontendFixture } from "./frontend-fixture";

// Use an explicit desktop timezone so these checks do not depend on the test runner's host.
vi.mock("../../src/shared/dates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/shared/dates")>();
  return {
    ...actual,
    calendarDay: (instant: string | Date) => actual.calendarDay(instant, "Europe/Paris"),
    calendarTime: (instant: string | Date) => actual.calendarTime(instant, "Europe/Paris"),
    systemTimeZone: () => "Europe/Paris",
  };
});

afterEach(() => vi.restoreAllMocks());

it.each([
  ["2026-03-31", "2026-02-28"],
  ["2024-03-31", "2024-02-29"],
  ["2026-01-31", "2025-12-31"],
])("compares %s with the last available day in the previous month", (today, previousDay) => {
  const { state, core } = frontendFixture();
  expect(monthlyRecordedTime(state, core, today).previousDay).toBe(previousDay);
});

it("groups a whole period by its local start day and preserves its precise duration", () => {
  const { state, core } = frontendFixture();
  core.periods[0] = {
    ...core.periods[0],
    startedAt: "2026-02-28T23:30:00Z",
    endedAt: "2026-03-01T23:30:00Z",
    detectedDurationMs: 86400000,
    durationOverrideMs: 86400000,
  };
  expect(activityPeriods(state, core)[0].date).toBe("2026-03-01");
  const draft = draftInvoice(state, core, "case", "final");
  expect(invoiceRows(state.cases[0], core.periods, [], draft, "2026-03-02")[0]).toMatchObject({
    date: "2026-03-01",
    durationMs: 86400000,
  });
});

it("excludes local March work from the February comparison even when its UTC date is February", () => {
  const { state, core } = frontendFixture();
  state.cases[0].openedOn = "2026-01-01";
  core.periods[0].startedAt = "2026-02-28T23:30:00Z";
  const previous = monthlyRecordedTime(state, core, "2026-03-31");
  expect(previous.previous.roundedMinutes).toBe(0);
});

it("uses the same local day and clock for audit timestamps without shifting date-only labels", () => {
  expect(auditDate("2026-02-28T23:30:00Z")).toBe("1 Mar, 00:30");
  expect(shortDate("2026-02-28")).toBe("28 Feb");
});

it("exports draft currency explicitly and retains fractional minutes for each period", () => {
  const csv = invoiceRowsCsv(
    [
      {
        id: "a",
        date: "2026-03-01",
        label: 'Quote "A"; review',
        durationMs: 15000,
        amountCents: 25,
        kind: "period",
        pending: false,
      },
      {
        id: "b",
        date: "2026-03-01",
        label: "Second",
        durationMs: 15000,
        amountCents: 25,
        kind: "period",
        pending: false,
      },
    ],
    "EUR",
  );
  expect(csv).toBe(
    'date;work;minutes;amount;currency\n"2026-03-01";"Quote ""A""; review";"0.25";"0.25";"EUR"\n"2026-03-01";"Second";"0.25";"0.25";"EUR"',
  );
});

it("exports known hourly zero amounts while keeping unknown and flat-fee amounts distinct", () => {
  const { state, core } = frontendFixture();
  core.periods[0] = { ...core.periods[0], detectedDurationMs: 0, durationOverrideMs: 0 };
  const draft = draftInvoice(state, core, "case", "final");
  const [zero] = invoiceRows(state.cases[0], core.periods, [], draft, "2026-10-17");
  expect(zero).toMatchObject({ durationMs: 0, amountCents: 0 });
  expect(invoiceRowsCsv([zero], "EUR")).toContain(';"0";"0.00";"EUR"');

  const unknown = { ...core.periods[0], detectedDurationMs: null, durationOverrideMs: null };
  expect(invoiceRows(state.cases[0], [unknown], [], draft, "2026-10-17")[0]).toMatchObject({
    durationMs: null,
    amountCents: null,
  });
  expect(
    invoiceRows({ ...state.cases[0], mode: "flat_fee" }, core.periods, [], draft, "2026-10-17")[0],
  ).toMatchObject({ durationMs: 0, amountCents: null });
});

it.each([
  ["2026-03-29T00:30:00Z", "2026-03-29T01:30:00Z"],
  ["2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z"],
])("keeps an hour-wide timeline span through a clock change at %s", (startedAt, endedAt) => {
  const { core } = frontendFixture();
  const period = { ...core.periods[0], startedAt, endedAt };
  const timeline = activityTimeline([period], "Europe/Paris");
  const position = timeline.positions.get(period.id)!;
  expect(position.endMs - position.startMs).toBe(3600000);
});

it("keeps an overnight timeline period whole and does not invent an open boundary", () => {
  const { core } = frontendFixture();
  const period = {
    ...core.periods[0],
    startedAt: "2026-03-01T22:30:00Z",
    endedAt: "2026-03-02T00:30:00Z",
  };
  const timeline = activityTimeline([period], "Europe/Paris");
  expect(timeline.positions.size).toBe(1);
  expect(timeline.positions.get(period.id)).toMatchObject({
    day: "2026-03-01",
    startMs: 23.5 * 3600000,
    endMs: 25.5 * 3600000,
  });
  expect(timeline.spanMs).toBe(26 * 3600000);
  const open = activityTimeline([{ ...period, endedAt: null }], "Europe/Paris").positions.get(
    period.id,
  )!;
  expect(open.endMs).toBe(open.startMs);
});
