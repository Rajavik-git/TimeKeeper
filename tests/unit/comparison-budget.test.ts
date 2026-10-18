import { expect, it } from "vitest";
import { caseBudget } from "../../src/frontend/calculations/case-budget";
import {
  historicalComparison,
  monthlyRecordedTime,
} from "../../src/frontend/calculations/comparison";
import type { CoreState } from "../../src/frontend/api/client";
import { budgetPercent } from "../../src/frontend/shared/presentation/budget";
import { frontendFixture } from "./frontend-fixture";

function budgetFixture(amountCents = 90000) {
  const { state, core } = frontendFixture();
  state.cases[0].budgetCents = 100000;
  state.settings.globalHourlyRateCents = amountCents;
  core.periods[0].durationOverrideMs = 3600000;
  core.periods[0].detectedDurationMs = 3600000;
  return { state, core, item: state.cases[0] };
}

it("keeps manually billed work in budget consumption using its applied rate", () => {
  const { state, core, item } = budgetFixture();
  expect(caseBudget(state, core, item).percent).toBe(90);
  Object.assign(core.periods[0], {
    billingStatus: "billed",
    appliedHourlyRateCents: 90000,
    appliedCurrency: "USD",
  });
  state.settings.globalHourlyRateCents = 1000;
  expect(caseBudget(state, core, item)).toMatchObject({
    spentCents: 90000,
    percent: 90,
    complete: true,
  });
});

it("combines frozen invoice fees and uninvoiced work once, excluding expenses and tax", () => {
  const { state, core, item } = budgetFixture(10000);
  core.billing.invoices = [
    { id: 7, caseId: "case", currency: "USD" } as CoreState["billing"]["invoices"][number],
  ];
  core.billing.lines = [
    { invoiceId: 7, origin: "work_period", amountCents: 80000 },
    { invoiceId: 7, origin: "expense", amountCents: 30000 },
  ] as CoreState["billing"]["lines"];
  core.periods.push({
    ...core.periods[0],
    id: "already-invoiced",
    invoiceId: 7,
    billingStatus: "billed",
  });
  expect(caseBudget(state, core, item)).toMatchObject({ spentCents: 90000, percent: 90 });
});

it("checks the warning threshold before display rounding", () => {
  const { state, core, item } = budgetFixture(84500);
  const budget = caseBudget(state, core, item);
  expect(budget.percent).toBe(84.5);
  expect(budget.percent! >= 85).toBe(false);
  expect(budgetPercent(budget.percent!)).toBe("84.5%");
  expect(budgetPercent(84.999)).toBe("84.9%");
});

it.each([
  { appliedHourlyRateCents: null, appliedCurrency: "USD" },
  { appliedHourlyRateCents: 90000, appliedCurrency: null },
  { appliedHourlyRateCents: 90000, appliedCurrency: "EUR" },
])("does not replace missing or incompatible billed values with current rates: %j", (applied) => {
  const { state, core, item } = budgetFixture();
  Object.assign(core.periods[0], { billingStatus: "billed", ...applied });
  expect(caseBudget(state, core, item)).toMatchObject({
    spentCents: null,
    percent: null,
    complete: false,
  });
});

it("keeps explicit zero rates distinct from unknown durations", () => {
  const { state, core, item } = budgetFixture(0);
  expect(caseBudget(state, core, item)).toMatchObject({
    spentCents: 0,
    percent: 0,
    complete: true,
  });
  core.periods[0].durationOverrideMs = null;
  core.periods[0].detectedDurationMs = null;
  expect(caseBudget(state, core, item)).toMatchObject({
    spentCents: null,
    percent: null,
    complete: false,
  });
});

it("estimates flat-fee work value at the client or base rate independently of invoices", () => {
  const { state, core, item } = budgetFixture(10000);
  item.mode = "flat_fee";
  item.flatFeeCents = 20000;
  state.clients[0].hourlyRateCents = 15000;
  expect(caseBudget(state, core, item)).toMatchObject({ spentCents: 15000, percent: 75 });
});

it("sums precise time before one minute ceiling and does not invent historical stock values", () => {
  const { state, core } = frontendFixture();
  state.cases[0].openedOn = null;
  core.periods = [core.periods[0], { ...core.periods[0], id: "second" }];
  const result = monthlyRecordedTime(state, core, "2026-10-17");
  expect(result.current).toMatchObject({
    preciseDurationMs: 40000,
    roundedMinutes: 1,
    complete: true,
  });
  expect(result.comparison).toMatchObject({ status: "available", current: 40000, previous: 0 });
  expect(historicalComparison.status).toBe("unavailable");
  core.periods[1].durationOverrideMs = null;
  core.periods[1].detectedDurationMs = null;
  expect(monthlyRecordedTime(state, core, "2026-10-17").comparison.status).toBe("unavailable");
});

it("does not mix invoice currencies or treat broken invoice links as known zero", () => {
  const { state, core, item } = budgetFixture(10000);
  core.billing.invoices = [
    { id: 7, caseId: "case", currency: "EUR" } as CoreState["billing"]["invoices"][number],
  ];
  core.billing.lines = [
    { invoiceId: 7, origin: "work_period", amountCents: 80000 },
  ] as CoreState["billing"]["lines"];
  expect(caseBudget(state, core, item)).toMatchObject({
    knownCents: 10000,
    spentCents: null,
    percent: null,
  });
  core.billing.invoices = [];
  core.periods[0].invoiceId = 7;
  expect(caseBudget(state, core, item)).toMatchObject({
    spentCents: null,
    percent: null,
    complete: false,
  });
});

it("uses an explicit applied zero rate without falling back to the current rate", () => {
  const { state, core, item } = budgetFixture(10000);
  Object.assign(core.periods[0], {
    billingStatus: "billed",
    appliedCurrency: "USD",
    appliedHourlyRateCents: 0,
  });
  expect(caseBudget(state, core, item)).toMatchObject({
    spentCents: 0,
    percent: 0,
    complete: true,
  });
});

it("keeps a known corrected work-value warning when linked evidence is unavailable", () => {
  const { state, core, item } = budgetFixture(75000);
  item.budgetCents = 60000;
  core.sources = [
    {
      workPeriodId: core.periods[0].id,
      availabilityStatus: "unavailable",
    },
  ] as CoreState["sources"];
  expect(caseBudget(state, core, item)).toMatchObject({
    spentCents: 75000,
    percent: 125,
    complete: true,
  });
  expect(monthlyRecordedTime(state, core, "2026-10-17").comparison.status).toBe("unavailable");
  core.periods[0].durationOverrideMs = null;
  core.periods[0].detectedDurationMs = null;
  expect(caseBudget(state, core, item)).toMatchObject({
    spentCents: null,
    percent: null,
    complete: false,
  });
});
