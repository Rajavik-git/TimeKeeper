import {
  expenseTypes,
  invoiceLineOrigins,
  invoiceTypes,
  rateOrigins,
  isState,
  ExpenseType,
  BillingStatus,
  CaseBillingMode,
  ClientRuleType,
  InvoiceLineOrigin,
  InvoiceType,
  RateOrigin,
  SystemTaskCode,
} from "../domain/states.js";
import { researchCapDurationMs } from "../../shared/client-rule-policy.js";
import { invoiceAmounts } from "../../shared/invoice-math.js";
import { calendarDay, isCalendarDay, isTimeZone, systemTimeZone } from "../../shared/dates.js";
import { AppError } from "./errors.js";
import type { InvoicePort, InvoiceSnapshot } from "../ports/invoice.js";

function nonnegative(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new AppError("invalid-request", `${name} must be a nonnegative integer`);
}

export function issueInvoice(
  port: InvoicePort,
  snapshot: InvoiceSnapshot,
  at: string,
): { id: number; number: string } {
  return port.transaction(() => {
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      !(
        (typeof snapshot.caseId === "number" &&
          Number.isSafeInteger(snapshot.caseId) &&
          snapshot.caseId > 0) ||
        (typeof snapshot.caseId === "string" &&
          snapshot.caseId.trim().length > 0 &&
          snapshot.caseId.length <= 200)
      ) ||
      !isState(snapshot.type, invoiceTypes) ||
      !Array.isArray(snapshot.periodIds) ||
      !Array.isArray(snapshot.lines) ||
      typeof snapshot.revisions !== "object" ||
      snapshot.revisions === null ||
      !isState(snapshot.rateOrigin, rateOrigins)
    )
      throw new AppError("invalid-request", "invalid invoice snapshot");
    const timeZone = snapshot.timeZone ?? systemTimeZone();
    if (!isTimeZone(timeZone)) throw new AppError("invalid-request", "invalid timeZone");
    const caseId = String(snapshot.caseId);
    const item = port.getCase(caseId);
    if (!item) throw new AppError("not-found", "case not found");
    if (snapshot.type === InvoiceType.Final && port.hasFinalInvoice(caseId))
      throw new AppError("conflict", "final invoice already exists");
    for (const key of [
      "billedMinutes",
      "rateCents",
      "feesCents",
      "subtotalCents",
      "expensesCents",
      "disbursementsCents",
      "vatCents",
      "totalCents",
    ] as const)
      nonnegative(snapshot[key], key);
    const rate =
      item.mode === CaseBillingMode.FlatFee
        ? 0
        : (item.caseRateCents ?? item.clientRateCents ?? item.globalRateCents);
    const origin =
      item.mode === CaseBillingMode.FlatFee
        ? RateOrigin.FlatFee
        : item.caseRateCents !== null
          ? RateOrigin.Case
          : item.clientRateCents !== null
            ? RateOrigin.Client
            : RateOrigin.Base;
    if (snapshot.rateCents !== rate || snapshot.rateOrigin !== origin)
      throw new AppError("conflict", "configured rate changed");
    const ids = new Set(snapshot.periodIds);
    if (ids.size !== snapshot.periodIds.length)
      throw new AppError("invalid-request", "duplicate period");
    let durationMs = 0;
    for (const id of ids) {
      if (typeof id !== "string" || !id) throw new AppError("invalid-request", "invalid period ID");
      nonnegative(snapshot.revisions[id], `revision for ${id}`);
      const period = port.getPeriod(id);
      if (!period || period.caseId !== caseId || !period.billable || period.excluded)
        throw new AppError("conflict", "period is not billable for this case");
      if (period.effectiveDurationMs === null)
        throw new AppError("conflict", "period duration unavailable");
      durationMs += period.effectiveDurationMs;
      if (!Number.isSafeInteger(durationMs))
        throw new AppError("invalid-request", "duration total exceeds supported range");
      if (
        period.billingStatus !== BillingStatus.Unbilled ||
        period.invoiceId !== null ||
        period.validatedEffectiveRevision !== period.effectiveRevision ||
        snapshot.revisions[id] !== period.effectiveRevision
      )
        throw new AppError("conflict", "period changed or is not time validated");
    }
    if (Object.keys(snapshot.revisions).length !== ids.size)
      throw new AppError("invalid-request", "revision list does not match periods");
    const context = port.getRuleContext(caseId, [...ids]);
    for (const rule of context.rules) {
      if (
        rule.type === ClientRuleType.NonbillableTravel &&
        context.periods.some(
          (period) => ids.has(period.id) && period.taskCode === SystemTaskCode.Travel,
        )
      )
        throw new AppError("conflict", "client travel rule excludes a selected period");
      if (rule.type === ClientRuleType.DailyResearchCap) {
        const byDate = new Map<string, number>();
        for (const period of context.periods.filter(
          (period) => period.taskCode === SystemTaskCode.Research,
        )) {
          const date = calendarDay(period.startedAt, timeZone);
          byDate.set(date, (byDate.get(date) ?? 0) + (period.effectiveDurationMs ?? 0));
        }
        if (
          [...byDate.values()].some((durationMs) => durationMs > researchCapDurationMs(rule.value))
        )
          throw new AppError("conflict", "client daily research cap exceeded");
      }
    }
    const expenseIds = new Set<number>();
    let expensesCents = 0;
    let disbursementsCents = 0;
    let workLines = 0;
    let flatFeeLines = 0;
    for (const line of snapshot.lines) {
      if (
        !line ||
        !isState(line.origin, invoiceLineOrigins) ||
        typeof line.originId !== "string" ||
        typeof line.label !== "string" ||
        typeof line.vat !== "boolean"
      )
        throw new AppError("invalid-request", "invalid invoice line");
      for (const [name, value] of [
        ["billedMinutes", line.billedMinutes],
        ["rateCents", line.rateCents],
        ["amountCents", line.amountCents],
      ] as const)
        nonnegative(value, name);
      if (line.origin === InvoiceLineOrigin.WorkPeriod) {
        workLines++;
        if (
          line.originId !== caseId ||
          line.billedMinutes !== snapshot.billedMinutes ||
          line.rateCents !== snapshot.rateCents ||
          line.amountCents !== (item.mode === CaseBillingMode.FlatFee ? 0 : snapshot.feesCents) ||
          !line.vat
        )
          throw new AppError("conflict", "work line does not match selected periods");
      } else if (line.origin === InvoiceLineOrigin.FlatFee) {
        flatFeeLines++;
        if (
          item.mode !== CaseBillingMode.FlatFee ||
          line.originId !== caseId ||
          snapshot.type !== InvoiceType.Final ||
          line.amountCents !== item.flatFeeCents ||
          line.billedMinutes !== 0 ||
          line.rateCents !== 0 ||
          !line.vat
        )
          throw new AppError("conflict", "flat fee line does not match case");
      } else {
        const id = Number(line.originId);
        if (!Number.isSafeInteger(id) || expenseIds.has(id))
          throw new AppError("invalid-request", "duplicate or invalid expense");
        expenseIds.add(id);
        const expense = port.getExpense(id);
        if (
          !expense ||
          expense.caseId !== caseId ||
          expense.invoiceId !== null ||
          expense.amountCents !== line.amountCents ||
          line.vat !== (expense.type === ExpenseType.Expense)
        )
          throw new AppError("conflict", "expense changed or already billed");
        if (line.billedMinutes !== 0 || line.rateCents !== 0)
          throw new AppError("conflict", "expense line cannot contain work duration or rate");
        if (expense.type === ExpenseType.Expense) expensesCents += expense.amountCents;
        else disbursementsCents += expense.amountCents;
      }
    }
    if (workLines !== (ids.size > 0 ? 1 : 0))
      throw new AppError("invalid-request", "one grouped work line required");
    if (flatFeeLines > 1) throw new AppError("invalid-request", "duplicate flat fee");
    if (snapshot.lines.length === 0) throw new AppError("invalid-request", "nothing to invoice");
    if (
      item.mode === CaseBillingMode.FlatFee &&
      snapshot.type === InvoiceType.Final &&
      flatFeeLines !== 1
    )
      throw new AppError("invalid-request", "final flat-fee invoice requires the agreed fee line");
    const expected = invoiceAmounts({
      durationMs,
      rateCents: rate,
      flatFeeCents:
        item.mode === CaseBillingMode.FlatFee
          ? flatFeeLines
            ? (item.flatFeeCents ?? 0)
            : 0
          : null,
      expensesCents,
      disbursementsCents,
      vatRate: item.vatRate,
      vatApplicable: item.vatApplicable,
    });
    for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
      if (!Number.isSafeInteger(expected[key]) || snapshot[key] !== expected[key])
        throw new AppError("conflict", `invoice ${key} does not match authoritative records`);
    }
    const { number, sequence } = port.nextInvoice();
    const id = port.createInvoice({ ...snapshot, timeZone }, number, at);
    for (const periodId of ids) port.markPeriodBilled(periodId, id, rate, at);
    for (const expenseId of expenseIds) port.markExpenseBilled(expenseId, id);
    port.advanceInvoiceSequence(sequence);
    return { id, number };
  });
}

export function billingState(port: InvoicePort) {
  return {
    invoices: port.listInvoices(),
    lines: port.listInvoiceLines(),
    expenses: port.listExpenses(),
  };
}

export function addExpense(
  port: InvoicePort,
  input: {
    caseId: string;
    date: string;
    label: string;
    type: ExpenseType;
    amountCents: number;
  },
) {
  return port.transaction(() => {
    if (!port.getCase(input.caseId)) throw new AppError("not-found", "case not found");
    if (!isCalendarDay(input.date) || !input.label?.trim() || !isState(input.type, expenseTypes))
      throw new AppError("invalid-request", "invalid expense");
    nonnegative(input.amountCents, "amountCents");
    return { id: port.addExpense(input) };
  });
}

export function removeExpense(port: InvoicePort, id: number) {
  return port.transaction(() => {
    const expense = port.getExpenseForRemoval(id);
    if (!expense) throw new AppError("not-found", "expense not found");
    if (expense.invoiceId !== null) throw new AppError("conflict", "expense already billed");
    port.removeExpense(id);
    return { deleted: true };
  });
}
