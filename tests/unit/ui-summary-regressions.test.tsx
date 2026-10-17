// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ScreenProps } from "../../src/frontend/api/client";
import { Cases } from "../../src/frontend/features/cases/Cases";
import { BillingOverview } from "../../src/frontend/features/billing-status/BillingOverview";
import { PreInvoices } from "../../src/frontend/features/billing-status/PreInvoices";
import { frontendFixture } from "./frontend-fixture";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 17, 12));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

function props(): ScreenProps {
  const { state, core } = frontendFixture();
  return {
    catalogState: state,
    workspaceState: core,
    refresh: vi.fn().mockResolvedValue(undefined),
    action: async (promise) => (await promise).data,
    navigate: vi.fn(),
    openPeriodActivity: vi.fn(),
  };
}

it("keeps Cases comparisons visible when the previous period has no data", () => {
  render(<Cases {...props()} />);
  expect(screen.getAllByText("No previous-period data")).toHaveLength(3);
  expect(screen.queryByText(/(?:Infinity|NaN)%/)).toBeNull();
});

it("keeps signed percentage comparisons and their previous-period date", () => {
  const input = props();
  input.catalogState.cases[0].openedOn = "2026-09-17";
  input.workspaceState.periods[0].endedAt = "2026-10-17T09:01:00Z";
  input.workspaceState.periods[0].durationOverrideMs = 60000;
  input.workspaceState.periods[0].detectedDurationMs = 60000;
  input.workspaceState.periods.push({
    ...input.workspaceState.periods[0],
    id: "previous-period",
    startedAt: "2026-09-17T09:00:00Z",
    endedAt: "2026-09-17T09:01:00Z",
    timeValidatedAt: "2026-09-17T09:01:00Z",
  });
  render(<Cases {...input} />);
  const toBill = screen.getByRole("button", { name: /^To bill/ });
  const change = within(toBill).getByText("+100%");
  expect(change.classList.contains("down")).toBe(true);
  expect(change.title).toBe("vs Sep 17");
});

it("uses the current calendar month for the Cases time summary", () => {
  vi.setSystemTime(new Date(2026, 10, 1, 12));
  render(<Cases {...props()} />);
  expect(screen.getByText("Time in November")).toBeTruthy();
  expect(screen.queryByText("Time in October")).toBeNull();
});

it("keeps Billing comparisons visible when the previous period has no data", () => {
  render(<BillingOverview {...props()} onSelect={vi.fn()} />);
  expect(screen.getAllByText("No previous-period data")).toHaveLength(3);
  expect(screen.queryByText(/(?:Infinity|NaN)%/)).toBeNull();
});

it.each([
  { coverage: true, validated: true, flatFee: false, label: "Ready to invoice", kind: "ok" },
  {
    coverage: false,
    validated: true,
    flatFee: false,
    label: "Review incomplete coverage",
    kind: "warn",
  },
  { coverage: true, validated: false, flatFee: false, label: "1 to validate", kind: "warn" },
  { coverage: true, validated: true, flatFee: true, label: "Flat fee", kind: "out" },
  {
    coverage: false,
    validated: false,
    flatFee: false,
    label: "Review incomplete coverage",
    kind: "warn",
  },
])("shows $label for coverage=$coverage, validated=$validated, flatFee=$flatFee", (testCase) => {
  const input = props();
  if (!testCase.coverage) input.workspaceState.periods[0].durationOverrideMs = null;
  input.workspaceState.periods[0].timeValidated = testCase.validated;
  if (testCase.flatFee) {
    input.catalogState.cases[0].mode = "flat_fee";
    input.catalogState.cases[0].flatFeeCents = 50000;
  }
  const onSelect = vi.fn();
  const { container } = render(<BillingOverview {...input} onSelect={onSelect} />);
  const card = container.querySelector<HTMLButtonElement>(".billing-card")!;
  const status = within(card).getByText(testCase.label);
  expect(status.classList.contains(`p-${testCase.kind}`)).toBe(true);
  if (testCase.label !== "Ready to invoice")
    expect(within(card).queryByText("Ready to invoice")).toBeNull();
  if (!testCase.coverage) {
    const summary = container.querySelector<HTMLElement>(".billing-summary")!;
    expect(within(summary).getByText("0 hourly cases, all validated")).toBeTruthy();
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith(input.catalogState.cases[0]);
  }
});

it("keeps invoice creation blocked while incomplete coverage links to the affected period", () => {
  const input = props();
  input.selectedCase = "case";
  input.openPeriodReview = vi.fn();
  input.workspaceState.periods[0].durationOverrideMs = null;
  render(<PreInvoices {...input} />);
  expect(screen.getByRole("button", { name: "Coverage review required" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(screen.getByText(/No evidence is linked and no duration correction/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Review period", exact: true }));
  expect(input.openPeriodReview).toHaveBeenCalledWith("period");
});
