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
import { DayCalendar } from "../../src/frontend/features/workday/DayCalendar";
import { PreInvoices } from "../../src/frontend/features/billing-status/PreInvoices";
import { frontendFixture } from "./frontend-fixture";

beforeEach(() => {
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
  expect(patch).toHaveBeenCalledWith(
    "/api/catalog/clients/{id}",
    expect.objectContaining({ body: { hourlyRateCents: null } }),
  );
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
  expect(screen.getByRole("status").textContent).toContain("1 of 2 periods validated");
});

it("renders a core-created case whose opening date is unknown", () => {
  const input = props();
  input.selectedCase = "case";
  input.catalogState.cases[0].openedOn = null;
  render(<Cases {...input} />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Test case");
  expect(screen.getByText("Unknown")).toBeTruthy();
});
