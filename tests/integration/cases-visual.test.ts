import { expect, it } from 'vitest';
import { memoryDb } from '../../src/backend/adapters/sqlite/repository';
import { createApp } from '../../src/backend/api/app';
import { caseMetrics, clientMetrics, previousMonthMetrics } from '../../src/frontend/calculations/cases';
import type { CoreState, State } from '../../src/frontend/api/client';

it('excludes flat fees from Cases to-bill totals while retaining their pricing mode', async () => {
  const db = memoryDb();
  try {
    const app = createApp(db);
    const [state, periods, sources, billing] = await Promise.all([
      app.request('/api/state').then(response => response.json()) as Promise<State>,
      app.request('/api/work-periods').then(response => response.json()) as Promise<CoreState['periods']>,
      app.request('/api/sources').then(response => response.json()) as Promise<CoreState['sources']>,
      app.request('/api/billing/state').then(response => response.json()) as Promise<CoreState['billing']>,
    ]);
    const core: CoreState = { periods, sources, billing, sessions: [], activeSession: null, questions: [], coverageGaps: [] };
    const flatFee = state.matter.find(item => item.client_id === state.client.find(client => client.name === 'Telavrone Studio Inc.')?.id)!;
    expect(flatFee.mode).toBe('flat_fee');
    expect(caseMetrics(state, core, flatFee).toBill).toBe(0);
    const telavrone = clientMetrics(state, core, flatFee.client_id);
    expect(telavrone.toBill).toBe(0);
    expect(telavrone.hourlyTime).toBe(0);
    const sarah = state.client.find(client => client.name === 'Sarah Bennett')!;
    expect(clientMetrics(state, core, sarah.id).toBill).toBe(163750);
    const total = state.client.reduce((sum, client) => sum + clientMetrics(state, core, client.id).toBill, 0);
    expect(total).toBe(969950);
    const previous = previousMonthMetrics(state, core, '2026-10-16');
    expect(Math.round((total - previous.previousToBill) * 100 / previous.previousToBill)).toBe(72);
    expect(previous.previousMinutes).toBe(1200);
  } finally {
    db.close();
  }
});
