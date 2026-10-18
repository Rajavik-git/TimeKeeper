import { describe, expect, it } from "vitest";
import {
  calendarDay,
  calendarTime,
  dayBounds,
  isCalendarDay,
  isTimeZone,
  monthBounds,
  shiftCalendarDay,
  shiftCalendarMonth,
} from "../../src/shared/dates.js";

describe("calendar dates and explicit time zones", () => {
  it("clamps previous months and preserves leap days without overflow", () => {
    expect(shiftCalendarMonth("2026-03-31", -1)).toBe("2026-02-28");
    expect(shiftCalendarMonth("2024-03-31", -1)).toBe("2024-02-29");
    expect(shiftCalendarMonth("2026-01-31", 1)).toBe("2026-02-28");
    expect(monthBounds("2024-02-15")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });

  it("rejects impossible dates and invalid zones", () => {
    for (const day of ["2026-02-30", "2026-13-01", "2026-2-01", "invalid"]) {
      expect(isCalendarDay(day)).toBe(false);
      expect(() => shiftCalendarDay(day, 1)).toThrow("Invalid calendar date");
    }
    expect(isTimeZone("Europe/Paris")).toBe(true);
    expect(isTimeZone("wrong/timezone")).toBe(false);
    expect(() => calendarDay("2026-10-17T22:30:00Z", "wrong/timezone")).toThrow();
  });

  it("keeps date-only values stable while converting instants to the selected calendar", () => {
    expect(calendarDay("2026-10-17", "America/Los_Angeles")).toBe("2026-10-17");
    expect(calendarDay("2026-10-17T22:30:00Z", "Europe/Paris")).toBe("2026-10-18");
    expect(calendarDay("2026-10-18T00:30:00+02:00", "Europe/Paris")).toBe("2026-10-18");
    expect(calendarTime("2026-10-17T22:30:15Z", "Europe/Paris", true)).toBe("00:30:15");
  });

  it.each([
    ["2026-03-29", 23],
    ["2026-10-25", 25],
  ])("uses the real length of the Paris DST day %s", (day, hours) => {
    const { startAt, endAt } = dayBounds(day, "Europe/Paris");
    expect((Date.parse(endAt) - Date.parse(startAt)) / 3600000).toBe(hours);
    expect(calendarDay(startAt, "Europe/Paris")).toBe(day);
    expect(calendarDay(endAt, "Europe/Paris")).toBe(shiftCalendarDay(day, 1));
  });
});
