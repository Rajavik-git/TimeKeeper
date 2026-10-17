import { localCalendarDay } from '../../contracts/calendar.js';

export const demoBaseDate = '2026-10-16';

export function effectiveToday(now = new Date(), desktop = process.env.TIMEKEEPER_DESKTOP === '1'): string {
  if (!desktop) return demoBaseDate;
  return localCalendarDay(now);
}
