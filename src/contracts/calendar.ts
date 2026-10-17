/** The fictional catalogue is dated in UTC; newly recorded desktop work follows the PC calendar. */
export function localCalendarDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function periodCalendarDay(startedAt: string, id: string, desktop: boolean): string {
  if (!desktop || /^\d+$/.test(id)) return startedAt.slice(0, 10);
  return localCalendarDay(new Date(startedAt));
}
