import { expect, it } from "vitest";
import { applicationApiBaseUrl } from "../../src/frontend/api/baseUrl";
import { coverageProblems } from "../../src/frontend/calculations/coverage";
import { frontendFixture } from "./frontend-fixture";

it("configures only the desktop API origin and keeps browser requests relative", () => {
  expect(applicationApiBaseUrl(false, "http://127.0.0.1:9876")).toBe("");
  expect(applicationApiBaseUrl(true)).toBe("http://127.0.0.1:8787");
  expect(applicationApiBaseUrl(true, "http://127.0.0.1:9876/")).toBe("http://127.0.0.1:9876");
  for (const url of [
    "https://example.com",
    "http://example.com",
    "http://localhost:8787/private",
    "http://user@localhost:8787",
    "http://localhost:8787?secret=test",
  ])
    expect(() => applicationApiBaseUrl(true, url)).toThrow();
});

it("distinguishes unknown duration, absent evidence and unavailable evidence", () => {
  const { core } = frontendFixture();
  const period = core.periods[0];
  expect(coverageProblems(period, [])).toEqual([]);
  expect(
    coverageProblems({ ...period, durationOverrideMs: null, detectedDurationMs: null }, []),
  ).toEqual([
    "Duration is unknown. Review and correct the duration.",
    "No evidence is linked and no duration correction is recorded.",
  ]);
  const source = {
    id: "source",
    workPeriodId: period.id,
    instanceId: "test",
    contentType: "sample",
    externalId: "source",
    recordedAt: period.startedAt,
    ingestedAt: period.startedAt,
    validationStatus: "unvalidated" as const,
    availabilityStatus: "unknown" as const,
  };
  expect(coverageProblems(period, [source])).toEqual([
    "Availability of a linked source has not been checked.",
  ]);
  expect(coverageProblems(period, [{ ...source, availabilityStatus: "unavailable" }])).toEqual([
    "A linked source is unavailable in Screenpipe.",
  ]);
});
