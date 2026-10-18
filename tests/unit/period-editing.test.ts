vi.mock("../../src/frontend/api/client", () => ({ api: { POST: vi.fn() } }));
import { expect, it, vi } from "vitest";
import { parseDurationMinutes } from "../../src/frontend/features/workday/lib/periodEditing";

it.each(["", " ", "-0.0000001", "-1", "Infinity", "NaN", "9007199254740991"])(
  "rejects invalid minute input %s",
  (input) => {
    expect(() => parseDurationMinutes(input)).toThrow("Enter a non-negative duration");
  },
);
it("retains precise milliseconds with one conversion", () => {
  expect(parseDurationMinutes("1.5")).toBe(90000);
  expect(parseDurationMinutes("0.00002")).toBe(1);
  expect(parseDurationMinutes("0")).toBe(0);
});
