import { expect, it } from "vitest";
import { timeValidationUnavailable } from "../../src/frontend/shared/lib/timeValidation";
import { frontendFixture } from "./frontend-fixture";

it("requires a closed period even when a manual duration is available", () => {
  const { core } = frontendFixture();
  const period = { ...core.periods[0], endedAt: null, durationOverrideMs: 1000 };
  expect(timeValidationUnavailable(period, "2026-10-18")).toContain("Finish this period");
});

it("uses the local start day for overnight periods rather than the end day", () => {
  const { core } = frontendFixture();
  const period = {
    ...core.periods[0],
    startedAt: "2026-10-17T23:00:00",
    endedAt: "2026-10-18T02:00:00",
  };
  expect(timeValidationUnavailable(period, "2026-10-18")).toBeNull();
});

it("blocks today's periods until the next local calendar day", () => {
  const { core } = frontendFixture();
  const period = {
    ...core.periods[0],
    startedAt: "2026-10-18T09:00:00",
    endedAt: "2026-10-18T10:00:00",
  };
  expect(timeValidationUnavailable(period, "2026-10-18")).toContain("next local calendar day");
  expect(timeValidationUnavailable(period, "2026-10-19")).toBeNull();
});
