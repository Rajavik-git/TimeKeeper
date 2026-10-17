import { calendarDay } from "../../../shared/dates.js";
import { eq } from "drizzle-orm";
import { orm } from "./orm.js";
import {
  demo_period_entries,
  demo_block_periods,
  block as blocksTable,
  work_periods,
} from "./tables.js";
import type { DatabaseSync } from "node:sqlite";
import { SqliteRepository } from "./core-repository.js";
import { displayId } from "./identifiers.js";
import { validateTime } from "../../domain/rules.js";

type Row = Record<string, unknown>;
function nextEntryId(db: DatabaseSync): number {
  const occupied = new Set(
    orm(db)
      .select({ entry_id: demo_period_entries.entry_id })
      .from(demo_period_entries)
      .all()
      .map((row) => Number(row.entry_id)),
  );
  for (const row of orm(db).select({ id: work_periods.id }).from(work_periods).all()) {
    const id = displayId(String(row.id));
    if (typeof id === "number") occupied.add(id);
  }
  let next = 1;
  while (occupied.has(next)) next++;
  return next;
}
export function ensureCompatibilityEntryId(db: DatabaseSync, periodId: string): number {
  const existing = orm(db)
    .select()
    .from(demo_period_entries)
    .where(eq(demo_period_entries.period_id, periodId))
    .get();
  if (existing) return Number(existing.entry_id);
  const projected = displayId(periodId);
  const numeric = typeof projected === "number" ? projected : null;
  const occupied =
    numeric === null ||
    orm(db)
      .select()
      .from(demo_period_entries)
      .where(eq(demo_period_entries.entry_id, numeric))
      .get();
  const next = occupied ? nextEntryId(db) : numeric;
  orm(db).insert(demo_period_entries).values({ period_id: periodId, entry_id: next }).run();
  return next;
}
export function entries(db: DatabaseSync, includeExcluded = false): Row[] {
  return new SqliteRepository(db)
    .allPeriods()
    .filter((p) => includeExcluded || !p.excluded)
    .map((p) => ({
      id: ensureCompatibilityEntryId(db, p.id),
      work_period_id: p.id,
      block_id:
        db.prepare("SELECT block_id FROM demo_block_periods WHERE period_id=?").get(p.id)
          ?.block_id ?? null,
      matter_id: p.caseId === null ? null : displayId(p.caseId),
      task_id: p.taskTypeId ?? null,
      date: calendarDay(p.startedAt),
      tenths_of_hour:
        (p.durationOverrideMs ?? p.detectedDurationMs) === null
          ? null
          : (p.durationOverrideMs ?? p.detectedDurationMs)! / 360000,
      label: p.label ?? "",
      amount_cents: 0,
      rate_origin: "base",
      billable: p.billable ?? true,
      reason: p.nonbillableReason ?? null,
      review_status:
        p.validatedEffectiveRevision === p.effectiveRevision && p.timeValidatedAt
          ? "approved"
          : "to_review",
      billing_status:
        p.billingStatus === "billed" ? "billed" : p.billable === false ? "not_billable" : "to_bill",
      invoice_id: p.invoiceId ?? null,
    }));
}
export function updateEntry(db: DatabaseSync, id: number, data: Row): Row {
  const link = orm(db)
    .select()
    .from(demo_period_entries)
    .where(eq(demo_period_entries.entry_id, id))
    .get();
  const repo = new SqliteRepository(db);
  const prior = repo.period(String(link?.period_id ?? id));
  if (!prior) throw Error("Not found");
  if (data.matter_id !== undefined && String(data.matter_id) !== prior.caseId)
    throw Error("Assignment must use application service");
  let next = { ...prior, revision: prior.revision + 1 };
  if (data.label !== undefined) next.label = String(data.label);
  if (data.task_id !== undefined)
    next.taskTypeId = data.task_id === null ? null : Number(data.task_id);
  if (data.billable !== undefined) next.billable = Boolean(data.billable);
  if (data.reason !== undefined)
    next.nonbillableReason = data.reason === null ? null : String(data.reason);
  if (data.review_status === "to_review")
    next = { ...next, validatedEffectiveRevision: null, timeValidatedAt: null };
  if (data.review_status === "approved") {
    if (next.caseId === null || (next.durationOverrideMs ?? next.detectedDurationMs) === null)
      throw Error("Case and duration required for approval");
    next = validateTime(next, new Date().toISOString());
  }
  repo.savePeriod(next, new Date().toISOString());
  return entries(db, true).find((item) => item.id === id)!;
}
export function insertEntry(db: DatabaseSync, data: Row): Row {
  if (data.block_id !== null) {
    const link = orm(db)
      .select()
      .from(demo_block_periods)
      .where(eq(demo_block_periods.block_id, Number(data.block_id)))
      .get();
    if (link) return { ...data, id: ensureCompatibilityEntryId(db, String(link.period_id)) };
  }
  const next = nextEntryId(db);
  orm(db)
    .insert(demo_period_entries)
    .values({ period_id: String(next), entry_id: next })
    .run();
  return { ...data, id: next };
}

export function blocks(db: DatabaseSync): Row[] {
  const repo = new SqliteRepository(db);
  return orm(db)
    .select()
    .from(blocksTable)
    .all()
    .map((block) => {
      const link = orm(db)
        .select()
        .from(demo_block_periods)
        .where(eq(demo_block_periods.block_id, Number(block.id)))
        .get();
      const period = link ? repo.period(String(link.period_id)) : null;
      if (!period) return block;
      const originalCase = block.matter_id === null ? null : String(block.matter_id);
      const state = period.excluded
        ? "discarded"
        : block.state === "discarded" || originalCase !== period.caseId
          ? period.caseId
            ? "assigned"
            : "to_check"
          : block.state;
      return {
        ...block,
        state,
        matter_id: period.caseId === null ? null : displayId(period.caseId),
        task_id: period.taskTypeId ?? block.task_id,
      };
    });
}
