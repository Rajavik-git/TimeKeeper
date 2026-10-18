import { systemTimeZone } from "../../src/shared/dates";
import { expect, it } from "vitest";
import { activityPeriods, selectActivityPeriod } from "../../src/frontend/calculations/activity";
import { clientMetrics } from "../../src/frontend/calculations/cases";
import { sourcePackRequest } from "../../src/frontend/api/source-pack";
import { frontendFixture } from "./frontend-fixture";

it("selects the first available period without favoring a fixture ID", () => {
  const entries = [{ id: "opaque-first" }, { id: "14" }, { id: "picked" }];
  expect(selectActivityPeriod(entries, "")).toBe(entries[0]);
  expect(selectActivityPeriod(entries, "14")).toBe(entries[1]);
  expect(selectActivityPeriod(entries, "14", "picked")).toBe(entries[2]);
  expect(selectActivityPeriod(entries, "missing")).toBeUndefined();
  expect(selectActivityPeriod([], "")).toBeUndefined();
});

it("uses canonical period identity for activity without a numeric entry alias", () => {
  const { state, core } = frontendFixture();
  expect(activityPeriods(state, core)[0]).toMatchObject({
    id: core.periods[0].id,
    caseId: core.periods[0].caseId,
  });
});

it("sends canonical source-pack scopes and freezes the desktop timezone", () => {
  expect(
    sourcePackRequest({ options: [], scope: "dateRange", from: "2026-10-01", to: "2026-10-17" }),
  ).toEqual({
    scope: "dateRange",
    timeZone: systemTimeZone(),
    options: [],
    from: "2026-10-01",
    to: "2026-10-17",
  });
  expect(
    sourcePackRequest({ options: [], scope: "selectedPeriods", periodIds: ["opaque-period"] }),
  ).toEqual({
    scope: "selectedPeriods",
    timeZone: systemTimeZone(),
    options: [],
    periodIds: ["opaque-period"],
  });
  expect(sourcePackRequest({ options: [], scope: "invoice", invoiceId: 2 })).toEqual({
    scope: "invoice",
    timeZone: systemTimeZone(),
    options: [],
    invoiceId: 2,
  });
});

it("reports the latest client activity chronologically across mixed timestamp precision", () => {
  const { state, core } = frontendFixture();
  const template = core.periods[0];
  core.periods = [
    { ...template, id: "whole-second", startedAt: "2026-10-17T09:00:00Z" },
    { ...template, id: "fractional-second", startedAt: "2026-10-17T09:00:00.100Z" },
  ];
  expect(clientMetrics(state, core, "client").latest).toBe("2026-10-17T09:00:00.100Z");
  core.periods.reverse();
  expect(clientMetrics(state, core, "client").latest).toBe("2026-10-17T09:00:00.100Z");
});
