// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../../src/frontend/api/client";
import { PeriodReviewDialog } from "../../src/frontend/features/workday/PeriodReviewDialog";
import { frontendFixture } from "./frontend-fixture";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function props() {
  const { state, core } = frontendFixture();
  state.cases.push({
    ...state.cases[0],
    id: "other-case",
    title: "Other case",
    reference: "TEST-002",
  });
  return {
    period: core.periods[0],
    catalogState: state,
    workspaceState: core,
    action: async <T,>(request: Promise<{ data?: T; error?: unknown }>) => (await request).data,
    close: vi.fn(),
    openPeriodActivity: vi.fn(),
  };
}

it("corrects a historical case and duration using the displayed revisions", async () => {
  const user = userEvent.setup();
  const input = props();
  const assigned = {
    ...input.period,
    caseId: "other-case",
    revision: 2,
    assignmentRevision: 2,
    effectiveRevision: 2,
    timeValidated: false,
  };
  const corrected = { ...assigned, revision: 3, effectiveRevision: 3, durationOverrideMs: 90000 };
  const post = vi
    .spyOn(api, "POST")
    .mockResolvedValueOnce({ data: assigned } as never)
    .mockResolvedValueOnce({ data: corrected } as never);
  render(<PeriodReviewDialog {...input} />);
  await user.selectOptions(screen.getByRole("combobox", { name: "Assigned case" }), "other-case");
  await user.click(screen.getByRole("button", { name: "Save case" }));
  expect(post).toHaveBeenNthCalledWith(1, "/api/work-periods/{id}/assignment", {
    params: { path: { id: "period" } },
    body: { caseId: "other-case", expectedAssignmentRevision: 1, origin: "lawyer" },
  });
  const minutes = screen.getByRole("spinbutton", { name: "Corrected minutes" });
  await user.clear(minutes);
  await user.type(minutes, "1.5");
  await user.click(screen.getByRole("button", { name: "Save duration" }));
  expect(post).toHaveBeenNthCalledWith(2, "/api/work-periods/{id}/duration-override", {
    params: { path: { id: "period" } },
    body: { durationMs: 90000, expectedRevision: 2 },
  });
  expect(screen.getByText(/Not validated for this effective case/)).toBeTruthy();
});

it("marks billed and unbilled independently without creating an invoice", async () => {
  const user = userEvent.setup();
  const input = props();
  const post = vi
    .spyOn(api, "POST")
    .mockResolvedValueOnce({
      data: { ...input.period, billingStatus: "billed", revision: 2 },
    } as never)
    .mockResolvedValueOnce({ data: { ...input.period, revision: 3 } } as never);
  render(<PeriodReviewDialog {...input} />);
  await user.click(screen.getByRole("button", { name: "Mark billed" }));
  expect(screen.getByRole("button", { name: "Save case" })).toHaveProperty("disabled", true);
  await user.click(screen.getByRole("button", { name: "Mark unbilled" }));
  expect(post).toHaveBeenNthCalledWith(1, "/api/work-periods/{id}/billing-status", {
    params: { path: { id: "period" } },
    body: { status: "billed", expectedRevision: 1 },
  });
  expect(post).toHaveBeenNthCalledWith(2, "/api/work-periods/{id}/billing-status", {
    params: { path: { id: "period" } },
    body: { status: "unbilled", expectedRevision: 2 },
  });
  expect(post.mock.calls.every(([path]) => path !== "/api/invoices")).toBe(true);
});

it("blocks changes and unbilling for an issued invoice", () => {
  const input = props();
  input.period = { ...input.period, billingStatus: "billed", invoiceId: 42 };
  render(<PeriodReviewDialog {...input} />);
  expect(screen.getByText(/Included in issued invoice #42/)).toBeTruthy();
  for (const label of ["Save case", "Save duration", "Validate time", "Mark unbilled"])
    expect(screen.getByRole("button", { name: label })).toHaveProperty("disabled", true);
});

it("keeps the active period's assignment under Screenpipe ownership", () => {
  const input = props();
  input.period = { ...input.period, endedAt: null };
  render(<PeriodReviewDialog {...input} />);
  expect(screen.getByRole("combobox", { name: "Assigned case" })).toHaveProperty("disabled", true);
  expect(screen.getByText(/Current period assignment is managed by Screenpipe/)).toBeTruthy();
});

it.each([true, false])(
  "updates the duration field only when removing its correction succeeds (%s)",
  async (success) => {
    const user = userEvent.setup();
    const input = props();
    input.period = { ...input.period, durationOverrideMs: 60000 };
    const detected = { ...input.period, durationOverrideMs: null, revision: 2 };
    vi.spyOn(api, "POST").mockResolvedValue(
      (success ? { data: detected } : { error: { error: "conflict" } }) as never,
    );
    render(<PeriodReviewDialog {...input} />);
    const minutes = screen.getByRole("spinbutton", { name: "Corrected minutes" });
    fireEvent.change(minutes, { target: { value: "2" } });
    await user.click(screen.getByRole("button", { name: "Use detected duration" }));
    expect(minutes).toHaveProperty("value", success ? String(20000 / 60000) : "2");
  },
);

it("preserves a draft and stops writes after an external update until explicit reload", async () => {
  const user = userEvent.setup();
  const input = props();
  const post = vi.spyOn(api, "POST");
  const { rerender } = render(<PeriodReviewDialog {...input} />);
  const minutes = screen.getByRole("spinbutton", { name: "Corrected minutes" });
  await user.clear(minutes);
  await user.type(minutes, "5");
  rerender(
    <PeriodReviewDialog
      {...input}
      period={{ ...input.period, revision: 2, effectiveRevision: 2, durationOverrideMs: 120000 }}
    />,
  );
  expect(minutes).toHaveProperty("value", "5");
  expect(screen.getByRole("button", { name: "Save duration" })).toHaveProperty("disabled", true);
  await user.click(screen.getByRole("button", { name: "Reload latest period" }));
  expect(minutes).toHaveProperty("value", "2");
  expect(post).not.toHaveBeenCalled();
});

it("preserves the duration draft on failure and validates only the reviewed effective revision", async () => {
  const user = userEvent.setup();
  const input = props();
  input.period = { ...input.period, timeValidated: false, effectiveRevision: 8 };
  const post = vi.spyOn(api, "POST").mockResolvedValue({ error: { error: "conflict" } } as never);
  render(<PeriodReviewDialog {...input} />);
  fireEvent.change(screen.getByRole("spinbutton", { name: "Corrected minutes" }), {
    target: { value: "10" },
  });
  await user.click(screen.getByRole("button", { name: "Save duration" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("entries are preserved"),
  );
  expect(screen.getByRole("spinbutton", { name: "Corrected minutes" })).toHaveProperty(
    "value",
    "10",
  );
  await user.click(screen.getByRole("button", { name: "Validate time" }));
  expect(post).toHaveBeenLastCalledWith("/api/work-periods/{id}/validate-time", {
    params: { path: { id: "period" } },
    body: { expectedEffectiveRevision: 8 },
  });
});

it("explains evidence blockers and displays protected reconstruction proposals without applying them", async () => {
  const user = userEvent.setup();
  const input = props();
  input.period = { ...input.period, detectedDurationMs: null, durationOverrideMs: null };
  input.workspaceState.reconstructionConflicts = [
    {
      id: "proposal",
      periodId: "period",
      sessionId: "session",
      expectedRevision: 1,
      proposedStartedAt: "2026-10-17T09:00:00Z",
      proposedEndedAt: "2026-10-17T09:30:00Z",
      sourceReferences: ["reference"],
      status: "pending",
    },
  ];
  render(<PeriodReviewDialog {...input} />);
  expect(screen.getByText(/Duration is unknown/)).toBeTruthy();
  expect(screen.getByText(/No evidence is linked and no duration correction/)).toBeTruthy();
  expect(
    screen.getByRole("region", { name: "Pending reconstruction proposals" }).textContent,
  ).toContain("add no time");
  expect(screen.getByRole("button", { name: "Validate time" })).toHaveProperty("disabled", true);
  await user.click(screen.getByRole("button", { name: "Review sources" }));
  expect(input.close).toHaveBeenCalledOnce();
  expect(input.openPeriodActivity).toHaveBeenCalledWith("period");
});
