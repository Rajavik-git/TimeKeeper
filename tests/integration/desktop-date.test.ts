import { expect, it } from 'vitest';
import { memoryDb, reset } from '../../src/backend/adapters/sqlite/repository';
import { createApp } from '../../src/backend/api/app';
import { effectiveToday } from '../../src/backend/domain/demo-date';
import { periodCalendarDay } from '../../src/contracts/calendar';

it('uses the local calendar day only in desktop mode', () => {
  const instant = new Date(2026, 10, 3, 23, 45);
  expect(effectiveToday(instant, true)).toBe('2026-11-03');
  expect(effectiveToday(instant, false)).toBe('2026-10-16');
  const currentInstant = instant.toISOString();
  expect(periodCalendarDay(currentInstant, 'live-period', true)).toBe('2026-11-03');
  expect(periodCalendarDay(currentInstant, '13', true)).toBe(currentInstant.slice(0, 10));
  expect(periodCalendarDay(currentInstant, 'live-period', false)).toBe(currentInstant.slice(0, 10));
});

it('preserves the fixed demo history on creation and reset', () => {
  const db = memoryDb();
  try {
    const busyDay = () => (db.prepare('SELECT date FROM block WHERE id=13').get() as { date: string }).date;
    const periodDay = () => (db.prepare('SELECT started_at FROM work_periods ORDER BY started_at DESC LIMIT 1').get() as { started_at: string }).started_at.slice(0, 10);
    expect(busyDay()).toBe('2026-10-16');
    expect(periodDay()).toBe('2026-10-16');
    reset(db);
    expect(busyDay()).toBe('2026-10-16');
    expect(periodDay()).toBe('2026-10-16');
  } finally {
    db.close();
  }
});

it('exposes the fixed day through the API outside desktop mode', async () => {
  const db = memoryDb();
  try {
    const response = await createApp(db).request('/api/meta');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ today: '2026-10-16' });
  } finally {
    db.close();
  }
});
