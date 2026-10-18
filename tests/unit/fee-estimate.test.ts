import { expect, it } from "vitest";
import { dayFees } from "../../src/frontend/calculations/billing";
import { frontendFixture } from "./frontend-fixture";

it("does not replace missing billed pricing with today's rate", () => {
  const { state, core } = frontendFixture();
  core.periods[0] = { ...core.periods[0], billingStatus: "billed", appliedCurrency: "USD" };
  expect(dayFees(state, core, core.periods)).toEqual({
    cents: null,
    knownCents: 0,
    currency: "USD",
    complete: false,
  });
});
it("retains a compatible known subtotal when historical currencies differ", () => {
  const { state, core } = frontendFixture();
  core.periods.push({
    ...core.periods[0],
    id: "foreign",
    billingStatus: "billed",
    appliedHourlyRateCents: 12000,
    appliedCurrency: "EUR",
  });
  expect(dayFees(state, core, core.periods)).toEqual({
    cents: null,
    knownCents: 100,
    currency: "USD",
    complete: false,
  });
});
it("keeps an explicit historical zero and requires the historical currency", () => {
  const { state, core } = frontendFixture();
  core.periods[0] = {
    ...core.periods[0],
    billingStatus: "billed",
    appliedHourlyRateCents: 0,
    appliedCurrency: "USD",
  };
  expect(dayFees(state, core, core.periods).cents).toBe(0);
  core.periods[0].appliedCurrency = null;
  expect(dayFees(state, core, core.periods).cents).toBeNull();
});
it("preserves billed hourly pricing after a case changes to flat fee", () => {
  const { state, core } = frontendFixture();
  state.cases[0].mode = "flat_fee";
  core.periods[0] = {
    ...core.periods[0],
    billingStatus: "billed",
    appliedHourlyRateCents: 12000,
    appliedCurrency: "USD",
  };
  expect(dayFees(state, core, core.periods).cents).toBe(200);
});
it("rounds the precise pricing group once and separates evidence from monetary completeness", () => {
  const { state, core } = frontendFixture();
  core.periods.push({ ...core.periods[0], id: "second" });
  expect(dayFees(state, core, core.periods)).toMatchObject({ cents: 100, complete: true });
  core.periods[1].durationOverrideMs = null;
  core.periods[1].detectedDurationMs = null;
  expect(dayFees(state, core, core.periods)).toMatchObject({
    cents: null,
    knownCents: 100,
    complete: false,
  });
});
it("does not estimate hourly fees for current flat-fee, nonbillable or excluded work", () => {
  const { state, core } = frontendFixture();
  state.cases[0].mode = "flat_fee";
  expect(dayFees(state, core, core.periods).cents).toBe(0);
  state.cases[0].mode = "hourly";
  core.periods[0].billable = false;
  expect(dayFees(state, core, core.periods).cents).toBe(0);
  core.periods[0].billable = true;
  core.periods[0].excluded = true;
  expect(dayFees(state, core, core.periods).cents).toBe(0);
});
