import { describe, expect, it } from "vitest";
import {
  duration,
  longDate,
  minutes,
  money,
  percent,
  rate,
  shortDate,
  tenthsOfHour,
} from "../../src/frontend/shared/format";

describe("English display formats", () => {
  it("uses two decimal places for money and hourly rates", () => {
    expect(money(139000)).toBe("$1,390.00");
    expect(rate(30000)).toBe("$300.00/h");
    expect(percent(91)).toBe("91%");
  });
  it("shows durations as hours and minutes without decimal hours", () => {
    expect(minutes(108)).toBe("1h 48m");
    expect(minutes(12)).toBe("12m");
    expect(minutes(0)).toBe("0m");
    expect(duration(108000)).toBe("2m");
    expect(tenthsOfHour(18)).toBe("1h 48m");
  });
  it("shows dates in English without a weekday comma", () => {
    expect(shortDate("2026-10-16")).toBe("16 Oct");
    expect(longDate("2026-10-16")).toBe("Friday 16 October 2026");
  });
});

it("formats configured currencies without retaining the USD symbol", () => {
  expect(money(30000, "EUR")).toBe("€300.00");
  expect(rate(30000, "EUR")).toBe("€300.00/h");
});
