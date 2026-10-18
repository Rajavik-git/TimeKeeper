// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useToday } from "../../src/frontend/shared/hooks/useToday";
import { useResource } from "../../src/frontend/api/queries";
import { api, type ScreenProps } from "../../src/frontend/api/client";
import { Settings } from "../../src/frontend/features/settings/Settings";
import { Cases } from "../../src/frontend/features/cases/Cases";
import { DayCalendar } from "../../src/frontend/features/workday/components/DayCalendar/DayCalendar";
import { PreInvoices } from "../../src/frontend/features/billing-status/PreInvoices";
import { frontendFixture } from "./frontend-fixture";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
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

it("updates the local day at midnight and immediately on focus after sleep", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 17, 23, 59, 59));
  const { result } = renderHook(useToday);
  expect(result.current).toBe("2026-10-17");
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current).toBe("2026-10-18");
  act(() => {
    vi.setSystemTime(new Date(2026, 9, 19, 9));
    window.dispatchEvent(new Event("focus"));
  });
  expect(result.current).toBe("2026-10-19");
});

it("enables the new calendar day after midnight without changing the selected day", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 17, 23, 59, 59));
  render(
    <DayCalendar
      selected="2026-10-17"
      recorded={new Set()}
      pending={new Set()}
      onSelect={vi.fn()}
      onMonthChange={vi.fn()}
    />,
  );
  expect((screen.getByRole("button", { name: "Next day" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  act(() => vi.advanceTimersByTime(1000));
  expect((screen.getByRole("button", { name: "Next day" }) as HTMLButtonElement).disabled).toBe(
    false,
  );
});

it("polls mounted resources and ignores focus while a slow request is active", async () => {
  vi.useFakeTimers();
  let resolve!: (value: string) => void;
  const load = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue("external edit");
  const { result, unmount } = renderHook(() => useResource("test-external", load));
  expect(load).toHaveBeenCalledOnce();
  act(() => {
    window.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(5000);
  });
  expect(load).toHaveBeenCalledOnce();
  expect((load.mock.calls[0][0] as AbortSignal).aborted).toBe(false);
  await act(async () => resolve("initial"));
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(result.current.data).toBe("external edit");
  expect(load).toHaveBeenCalledTimes(2);
  unmount();
  act(() => vi.advanceTimersByTime(5000));
  expect(load).toHaveBeenCalledTimes(2);
});

it("clears case rate and budget overrides, preserves zero, and rejects a blank required base rate", async () => {
  const user = userEvent.setup();
  const input = props();
  input.catalogState.clients[0].hourlyRateCents = 5000;
  input.catalogState.cases[0].hourlyRateCents = 2500;
  input.catalogState.cases[0].budgetCents = 10000;
  const patch = vi.spyOn(api, "PATCH").mockResolvedValue({ data: {} } as never);
  render(<Settings {...input} />);
  await user.click(screen.getByRole("button", { name: "Edit Test client" }));
  await user.clear(screen.getByRole("textbox", { name: "Rate USD/h" }));
  await user.tab();
  expect(patch).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save client" }));
  expect(patch).toHaveBeenCalledWith(
    "/api/catalog/clients/{id}",
    expect.objectContaining({ body: expect.objectContaining({ hourlyRateCents: null }) }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Rates", exact: true }));
  const rate = screen.getByRole("textbox", { name: "Test case own rate USD/h" });
  await user.clear(rate);
  await user.tab();
  await waitFor(() =>
    expect(patch).toHaveBeenCalledWith(
      "/api/catalog/cases/{id}",
      expect.objectContaining({ body: { hourlyRateCents: null } }),
    ),
  );
  const budget = screen.getByRole("textbox", { name: "Test case budget USD" });
  await user.clear(budget);
  await user.tab();
  expect(patch).toHaveBeenCalledWith(
    "/api/catalog/cases/{id}",
    expect.objectContaining({ body: { budgetCents: null } }),
  );
  await user.type(rate, "0");
  await user.tab();
  expect(patch).toHaveBeenCalledWith(
    "/api/catalog/cases/{id}",
    expect.objectContaining({ body: { hourlyRateCents: 0 } }),
  );
  patch.mockClear();
  await user.clear(screen.getByRole("textbox", { name: "Hourly rate" }));
  await user.tab();
  expect(patch).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("Enter a non-negative amount");
});

it("does not reopen an externally selected case when polling updates the case array", async () => {
  const user = userEvent.setup();
  const input = props();
  input.selectedCase = "case";
  const { rerender } = render(<Cases {...input} />);
  await user.click(screen.getByRole("button", { name: "Cases", exact: true }));
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Cases");
  rerender(
    <Cases
      {...input}
      catalogState={{
        ...input.catalogState,
        cases: input.catalogState.cases.map((item) => ({ ...item })),
      }}
    />,
  );
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Cases");
});

it("uses the current local day for a cost submitted after the app resumes", async () => {
  const user = userEvent.setup();
  const input = props();
  input.selectedCase = "case";
  const post = vi.spyOn(api, "POST").mockResolvedValue({ data: {} } as never);
  render(<PreInvoices {...input} />);
  await user.click(screen.getByRole("button", { name: "Add a cost" }));
  await user.type(screen.getByRole("textbox", { name: "Cost description" }), "Court cost");
  await user.type(screen.getByRole("spinbutton", { name: "Amount in USD" }), "12");
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 19, 10));
  act(() => window.dispatchEvent(new Event("focus")));
  fireEvent.submit(screen.getByRole("textbox", { name: "Cost description" }).closest("form")!);
  await act(async () => {});
  expect(post).toHaveBeenCalledWith(
    "/api/billing/expenses",
    expect.objectContaining({
      body: expect.objectContaining({ date: "2026-10-19", amountCents: 1200 }),
    }),
  );
});

it("refreshes committed progress in Cases after a later validation request rejects", async () => {
  const user = userEvent.setup();
  const input = props();
  input.selectedCase = "case";
  input.workspaceState.periods = ["first", "second"].map((id) => ({
    ...input.workspaceState.periods[0],
    id,
    timeValidated: false,
  }));
  const post = vi
    .spyOn(api, "POST")
    .mockResolvedValueOnce({ data: {} } as never)
    .mockRejectedValueOnce(Error("offline"));
  render(<Cases {...input} />);
  await user.click(screen.getByRole("button", { name: "Validate all (2)" }));
  await waitFor(() => expect(input.refresh).toHaveBeenCalledOnce());
  expect(post).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("status").textContent).toContain("Time validated for 1 of 2 periods");
});

it("renders a core-created case whose opening date is unknown", () => {
  const input = props();
  input.selectedCase = "case";
  input.catalogState.cases[0].openedOn = null;
  render(<Cases {...input} />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Test case");
  expect(screen.getByText("Unknown")).toBeTruthy();
});

it("labels independently billed work accurately and opens its period review", async () => {
  const user = userEvent.setup();
  const input = props();
  input.selectedCase = "case";
  input.workspaceState.periods[0].billingStatus = "billed";
  input.openPeriodReview = vi.fn();
  render(<Cases {...input} />);
  expect(screen.queryByText("Included in issued invoice")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Review", exact: true }));
  expect(input.openPeriodReview).toHaveBeenCalledWith("period");
});

it("explains an invoice coverage blocker and links directly to the target period review", async () => {
  const user = userEvent.setup();
  const input = props();
  input.selectedCase = "case";
  input.workspaceState.periods[0].durationOverrideMs = null;
  input.openPeriodReview = vi.fn();
  render(<PreInvoices {...input} />);
  expect(screen.getByText(/No evidence is linked and no duration correction/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Coverage review required" })).toHaveProperty(
    "disabled",
    true,
  );
  await user.click(screen.getByRole("button", { name: "Review period", exact: true }));
  expect(input.openPeriodReview).toHaveBeenCalledWith("period");
});

it("counts only the markers visible in the case marker table, including the client name", async () => {
  const user = userEvent.setup();
  const input = props();
  input.selectedCase = "case";
  render(<Cases {...input} />);
  await user.click(screen.getByRole("tab", { name: "Markers (2)" }));
  expect(screen.getByText("Client name")).toBeTruthy();
  expect(screen.getAllByRole("row")).toHaveLength(3);
});

it("shows human marker choices while sending the canonical marker value", async () => {
  const user = userEvent.setup();
  const input = props();
  input.selectedCase = "case";
  const post = vi.spyOn(api, "POST").mockResolvedValue({ data: { id: "marker" } } as never);
  render(<Cases {...input} />);
  await user.click(screen.getByRole("tab", { name: "Markers (2)" }));
  await user.click(screen.getAllByRole("button", { name: "Add marker", exact: true }).at(-1)!);
  expect(screen.getByRole("option", { name: "Opposing party" })).toHaveProperty(
    "value",
    "opposing_party",
  );
  expect(screen.queryByRole("option", { name: "opposing_party" })).toBeNull();
  await user.selectOptions(screen.getByRole("combobox", { name: "Marker type" }), "opposing_party");
  await user.type(screen.getByRole("textbox", { name: "New marker" }), "Example opponent");
  await user.click(screen.getAllByRole("button", { name: "Add marker", exact: true }).at(-1)!);
  expect(post).toHaveBeenCalledWith("/api/catalog/markers", {
    body: { caseId: "case", type: "opposing_party", value: "Example opponent" },
  });
});

it("distinguishes no-charge work from unbilled work in case time", () => {
  const input = props();
  input.selectedCase = "case";
  input.workspaceState.periods.push({
    ...input.workspaceState.periods[0],
    id: "no-charge",
    label: "Courtesy review",
    billable: false,
    nonbillableReason: "offered",
  });
  render(<Cases {...input} />);
  expect(screen.getByText("No charge")).toBeTruthy();
  expect(screen.getByText("Unbilled")).toBeTruthy();
  expect(screen.queryByText("Offered")).toBeNull();
  expect(screen.getAllByText("Time validated")).toHaveLength(2);
});
