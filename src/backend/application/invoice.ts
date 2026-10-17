import { calendarDay, isCalendarDay, isTimeZone, systemTimeZone } from "../../shared/dates.js";
import { AppError } from "./service.js";
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
      (snapshot.type !== "deposit" && snapshot.type !== "final") ||
      !Array.isArray(snapshot.periodIds) ||
      !Array.isArray(snapshot.lines) ||
      typeof snapshot.revisions !== "object" ||
      snapshot.revisions === null ||
      !["matter", "client", "base", "flat_fee"].includes(snapshot.rateOrigin)
    )
      throw new AppError("invalid-request", "invalid invoice snapshot");
    const timeZone = snapshot.timeZone ?? systemTimeZone();
    if (!isTimeZone(timeZone)) throw new AppError("invalid-request", "invalid timeZone");
    const caseId = String(snapshot.caseId);
    const item = port.getCase(caseId);
    if (!item) throw new AppError("not-found", "case not found");
    if (snapshot.type === "final" && port.hasFinalInvoice(caseId))
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
      item.mode === "flat_fee"
        ? 0
        : (item.caseRateCents ?? item.clientRateCents ?? item.globalRateCents);
    const origin =
      item.mode === "flat_fee"
        ? "flat_fee"
        : item.caseRateCents !== null
          ? "matter"
          : item.clientRateCents !== null
            ? "client"
            : "base";
    if (snapshot.rateCents !== rate || snapshot.rateOrigin !== origin)
      throw new AppError("conflict", "configured rate changed");
    const ids = new Set(snapshot.periodIds);
    if (ids.size !== snapshot.periodIds.length)
      throw new AppError("invalid-request", "duplicate period");
    for (const id of ids) {
      if (typeof id !== "string" || !id) throw new AppError("invalid-request", "invalid period ID");
      nonnegative(snapshot.revisions[id], `revision for ${id}`);
      const period = port.getPeriod(id);
      if (!period || period.caseId !== caseId || !period.billable || period.excluded)
        throw new AppError("conflict", "period is not billable for this case");
      if (
        period.billingStatus !== "unbilled" ||
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
        rule.type === "nonbillable_travel" &&
        context.periods.some((period) => ids.has(period.id) && period.taskCode === "DEPL")
      )
        throw new AppError("conflict", "client travel rule excludes a selected period");
      if (rule.type === "daily_research_cap") {
        const byDate = new Map<string, number>();
        for (const period of context.periods.filter((period) => period.taskCode === "RECH")) {
          const date = calendarDay(period.startedAt, timeZone);
          byDate.set(date, (byDate.get(date) ?? 0) + (period.effectiveDurationMs ?? 0));
        }
        if ([...byDate.values()].some((durationMs) => durationMs > rule.value * 360000))
          throw new AppError("conflict", "client daily research cap exceeded");
      }
    }
    const expenseIds = new Set<number>();
    let workLines = 0;
    let flatFeeLines = 0;
    for (const line of snapshot.lines) {
      if (
        !line ||
        !["work_period", "expense", "flat_fee"].includes(line.origin) ||
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
      if (line.origin === "work_period") {
        workLines++;
        if (
          line.originId !== caseId ||
          line.billedMinutes !== snapshot.billedMinutes ||
          line.rateCents !== snapshot.rateCents
        )
          throw new AppError("conflict", "work line does not match selected periods");
      } else if (line.origin === "flat_fee") {
        flatFeeLines++;
        if (
          item.mode !== "flat_fee" ||
          line.originId !== caseId ||
          snapshot.type !== "final" ||
          line.amountCents !== item.flatFeeCents
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
          line.vat !== (expense.type === "expense")
        )
          throw new AppError("conflict", "expense changed or already billed");
      }
    }
    if (ids.size > 0 !== (workLines === 1))
      throw new AppError("invalid-request", "one grouped work line required");
    if (flatFeeLines > 1) throw new AppError("invalid-request", "duplicate flat fee");
    if (snapshot.lines.length === 0) throw new AppError("invalid-request", "nothing to invoice");
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
    type: "expense" | "disbursement";
    amountCents: number;
  },
) {
  return port.transaction(() => {
    if (!port.getCase(input.caseId)) throw new AppError("not-found", "case not found");
    if (
      !isCalendarDay(input.date) ||
      !input.label?.trim() ||
      !["expense", "disbursement"].includes(input.type)
    )
      throw new AppError("invalid-request", "invalid expense");
    nonnegative(input.amountCents, "amountCents");
    return { id: port.addExpense(input) };
  });
}

export function removeExpense(port: InvoicePort, id: number) {
  return port.transaction(() => {
    const expense = port.getExpense(id);
    if (!expense) throw new AppError("not-found", "expense not found");
    if (expense.invoiceId !== null) throw new AppError("conflict", "expense already billed");
    port.removeExpense(id);
    return { deleted: true };
  });
}
