import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { SqliteRepository } from '../../src/backend/adapters/sqlite/core-repository.js';
import { TimeKeeperService } from '../../src/backend/application/service.js';

// docs/API.md D9: only finished periods of past days, in the lawyer's local time, can be validated.
// Times are built from local calendar values so the tests hold in any time zone.
const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();

const repos: SqliteRepository[] = [];
afterEach(() => { for (const repo of repos.splice(0)) repo.close(); });

function fixture(nowIso: string) {
  const repo = new SqliteRepository(new DatabaseSync(':memory:')); repos.push(repo);
  let now = nowIso;
  repo.db.prepare('INSERT INTO clients(id,name,created_at,updated_at) VALUES (?,?,?,?)').run('client', 'Fictional Client', now, now);
  repo.db.prepare('INSERT INTO cases(id,client_id,reference,title,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('A', 'client', 'A', 'Fictional A', now, now);
  const service = new TimeKeeperService(repo, { now: () => now });
  return { service, setNow: (value: string) => { now = value; } };
}

/** One session with a corrected period on case A, from `start` to `end`. */
function period(service: TimeKeeperService, start: string, end: string | null) {
  service.start({ producerId: 'test', commandId: 'start', sessionId: 's', occurredAt: start });
  service.openPeriod({ id: 'p', sessionId: 's', caseId: 'A', startedAt: start, origin: 'lawyer', mode: 'current' });
  service.setDurationOverride('p', 30 * 60000);
  if (end) service.end({ producerId: 'test', commandId: 'end', sessionId: 's', occurredAt: end });
}

describe('validation is limited to finished periods of past days (docs/API.md D9)', () => {
  it('refuses a period of today', () => {
    const { service } = fixture(local(17, 18));
    period(service, local(17, 9), local(17, 10));
    expect(() => service.validatePeriod('p')).toThrowError(/only past days/);
    expect(service.getPeriod('p').timeValidated).toBe(false);
  });

  it('accepts the same period the next day', () => {
    const { service, setNow } = fixture(local(17, 18));
    period(service, local(17, 9), local(17, 10));
    setNow(local(18, 8));
    expect(service.validatePeriod('p').timeValidated).toBe(true);
  });

  it('uses the local start day for a period that crosses midnight', () => {
    const { service, setNow } = fixture(local(17, 23, 30));
    period(service, local(17, 23, 30), local(18, 0, 30));
    setNow(local(18, 9));
    expect(service.validatePeriod('p').timeValidated).toBe(true);
  });

  it('refuses a running period even from a past day', () => {
    const { service, setNow } = fixture(local(17, 9));
    period(service, local(17, 9), null);
    setNow(local(19, 9));
    expect(() => service.validatePeriod('p')).toThrowError(/running period/);
  });

  it('applies to bulk validation, which then changes nothing', () => {
    const { service } = fixture(local(17, 18));
    period(service, local(17, 9), local(17, 10));
    expect(() => service.validatePeriods([{ id: 'p' }])).toThrowError(/only past days/);
    expect(service.getPeriod('p').timeValidated).toBe(false);
  });

  it('still lets the lawyer undo a validation', () => {
    const { service, setNow } = fixture(local(17, 18));
    period(service, local(17, 9), local(17, 10));
    setNow(local(18, 8));
    service.validatePeriod('p');
    expect(service.unvalidatePeriod('p').timeValidated).toBe(false);
  });
});
