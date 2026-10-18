// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type ScreenProps } from "../../src/frontend/api/client";
import { MyDay, initialMyDayView } from "../../src/frontend/features/workday/MyDay";
import { frontendFixture } from "./frontend-fixture";

vi.mock("../../src/frontend/shared/hooks/useToday", () => ({ useToday: () => "2026-10-18" }));
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("CSS", { escape: (value: string) => value });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("preserves the selected day, filters, sorting and source-button focus across the Activity roundtrip", async () => {
  const user = userEvent.setup();
  const { state, core } = frontendFixture();
  core.sources = [
    {
      id: "source",
      workPeriodId: "period",
      instanceId: "test",
      contentType: "sample",
      externalId: "source",
      recordedAt: core.periods[0].startedAt,
      ingestedAt: core.periods[0].startedAt,
      validationStatus: "unvalidated",
      availabilityStatus: "available",
    },
  ];
  vi.spyOn(api, "GET").mockImplementation(async (path, options) => {
    if (path === "/api/catalog") return { data: state } as never;
    if (path === "/api/workspace") {
      const date = (options as { params?: { query?: { date?: string } } })?.params?.query?.date;
      return {
        data: {
          catalogState: state,
          workspaceState: { ...core, periods: !date || date === "2026-10-17" ? core.periods : [] },
        },
      } as never;
    }
    return { data: [] } as never;
  });
  function Harness() {
    const [viewState, setViewState] = useState(() => initialMyDayView("2026-10-18"));
    const [activity, setActivity] = useState<string | null>(null);
    const [returnFocusId, setReturnFocusId] = useState<string | null>(null);
    const props: ScreenProps = {
      catalogState: state,
      workspaceState: core,
      action: async (request) => (await request).data,
      refresh: vi.fn(),
      navigate: vi.fn(),
      openPeriodActivity: (id) => setActivity(id),
    };
    return activity ? (
      <button
        onClick={() => {
          setReturnFocusId(activity);
          setActivity(null);
        }}
      >
        Back to My day
      </button>
    ) : (
      <MyDay
        {...props}
        viewState={viewState}
        setViewState={setViewState}
        returnFocusId={returnFocusId}
        onFocusReturned={() => setReturnFocusId(null)}
      />
    );
  }
  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "Previous day" }));
  await screen.findByRole("button", { name: "Sources" });
  await user.click(screen.getByRole("button", { name: /^Time validated/ }));
  await user.click(screen.getByRole("button", { name: "Filter", exact: true }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Client", exact: true }), "client");
  await user.selectOptions(screen.getByRole("combobox", { name: "Case", exact: true }), "case");
  await user.click(screen.getByRole("button", { name: /^Filter.*Filters active$/ }));
  await user.click(screen.getByRole("button", { name: "Work performed" }));
  await user.click(screen.getByRole("button", { name: "Sources" }));
  await user.click(screen.getByRole("button", { name: "Back to My day" }));
  const sources = await screen.findByRole("button", { name: "Sources" });
  await waitFor(() => expect(document.activeElement).toBe(sources));
  expect(screen.getByRole("button", { name: /^Time validated/ }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(
    screen.getByRole("columnheader", { name: "Work performed" }).getAttribute("aria-sort"),
  ).toBe("ascending");
  expect(screen.getByRole("button", { name: /Sat, 17 Oct 2026/ })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /^Filter.*Filters active$/ }));
  const filters = within(screen.getByRole("group", { name: "Filter work periods" }));
  expect(filters.getByRole("combobox", { name: "Client" })).toHaveProperty("value", "client");
  expect(filters.getByRole("combobox", { name: "Case" })).toHaveProperty("value", "case");
});

function renderDay(overrides: Partial<ScreenProps> = {}) {
  const { state, core } = frontendFixture();
  function Harness() {
    const [viewState, setViewState] = useState(() => initialMyDayView("2026-10-17"));
    return (
      <MyDay
        catalogState={state}
        workspaceState={core}
        action={async (request) => (await request).data}
        refresh={vi.fn()}
        navigate={vi.fn()}
        openPeriodActivity={vi.fn()}
        {...overrides}
        viewState={viewState}
        setViewState={setViewState}
      />
    );
  }
  return render(<Harness />);
}

it("does not claim empty work before the first day read succeeds, and retries a failed day", async () => {
  const user = userEvent.setup();
  const { state, core } = frontendFixture();
  let resolveDay!: (value: never) => void;
  let attempts = 0;
  vi.spyOn(api, "GET").mockImplementation((_path, options) => {
    const date = (options as { params?: { query?: { date?: string } } })?.params?.query?.date;
    if (!date)
      return Promise.resolve({ data: { catalogState: state, workspaceState: core } }) as never;
    attempts++;
    if (attempts === 1)
      return new Promise((resolve) => {
        resolveDay = resolve;
      }) as never;
    return Promise.resolve({
      data: { catalogState: state, workspaceState: { ...core, periods: [], coverageGaps: [] } },
    }) as never;
  });
  renderDay();
  expect(screen.getByRole("heading", { name: "Loading day…" })).toBeTruthy();
  expect(screen.queryByText("No work periods")).toBeNull();
  resolveDay({ error: { message: "unavailable" } } as never);
  await screen.findByRole("heading", { name: "Day unavailable" });
  expect(screen.queryByText("No work periods")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Retry day" }));
  await screen.findByText("No work periods");
  expect(screen.getByText("Recorded time")).toBeTruthy();
  expect(screen.getByText("Estimated fees")).toBeTruthy();
  expect(screen.queryByText("Time today")).toBeNull();
});

it("keeps a successful day visible when only calendar indicators fail", async () => {
  const user = userEvent.setup();
  const { state, core } = frontendFixture();
  vi.spyOn(api, "GET").mockImplementation(async (_path, options) => {
    const date = (options as { params?: { query?: { date?: string } } })?.params?.query?.date;
    return date
      ? ({ data: { catalogState: state, workspaceState: core } } as never)
      : ({ error: {} } as never);
  });
  renderDay();
  await screen.findByRole("button", { name: "Sources" });
  expect(screen.getByRole("button", { name: "Retry calendar" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Retry day" })).toBeNull();
  expect(screen.queryByText("Work periods unavailable")).toBeNull();
  await user.click(screen.getByRole("button", { name: /Sat, 17 Oct 2026/ }));
  expect(screen.getByText("Work-day indicators unavailable")).toBeTruthy();
  expect(
    document.querySelector('[data-calendar-day="2026-10-17"]')?.getAttribute("aria-label"),
  ).toContain("work periods not loaded");
  expect(screen.queryByRole("button", { name: /no work periods/ })).toBeNull();
});

it("displays no charge independently from unbilled and validates assigned time without application metadata", async () => {
  const user = userEvent.setup();
  const { state, core } = frontendFixture();
  core.periods[0] = {
    ...core.periods[0],
    billable: false,
    nonbillableReason: "offered",
    billingStatus: "unbilled",
    timeValidated: false,
    observedAppName: undefined,
  };
  vi.spyOn(api, "GET").mockResolvedValue({
    data: { catalogState: state, workspaceState: core },
  } as never);
  const post = vi.spyOn(api, "POST").mockResolvedValue({ data: {} } as never);
  renderDay();
  await screen.findByText("No charge · Unbilled · Time to validate");
  await user.click(screen.getByRole("button", { name: "Validate assigned time" }));
  expect(post).toHaveBeenCalledWith("/api/work-periods/{id}/validate-time", {
    params: { path: { id: "period" } },
    body: { expectedEffectiveRevision: core.periods[0].effectiveRevision },
  });
});

it.each([true, false])("shows a known zero fee estimate with billable=%s", async (billable) => {
  const { state, core } = frontendFixture();
  state.cases[0].hourlyRateCents = billable ? 0 : 20000;
  core.periods[0] = { ...core.periods[0], billable, nonbillableReason: "offered" };
  vi.spyOn(api, "GET").mockResolvedValue({
    data: { catalogState: state, workspaceState: core },
  } as never);
  renderDay();
  await screen.findByRole("button", { name: "Sources" });
  const estimate = screen.getByText("Estimated fees").closest(".kpi")!;
  expect(within(estimate as HTMLElement).getByText("$0.00")).toBeTruthy();
  expect(
    screen.getByText(`${billable ? "Billable" : "No charge"} · Unbilled · Time validated`),
  ).toBeTruthy();
  if (billable) expect(screen.queryByText(/No charge/)).toBeNull();
});

it("retains work periods and warns when a later day refresh fails", async () => {
  const { state, core } = frontendFixture();
  let failDay = false;
  vi.spyOn(api, "GET").mockImplementation(async (_path, options) => {
    const date = (options as { params?: { query?: { date?: string } } })?.params?.query?.date;
    return date && failDay
      ? ({ error: {} } as never)
      : ({ data: { catalogState: state, workspaceState: core } } as never);
  });
  renderDay();
  await screen.findByRole("button", { name: "Sources" });
  failDay = true;
  const { act } = await import("@testing-library/react");
  const { refreshApplication } = await import("../../src/frontend/api/queries");
  await act(async () => {
    await refreshApplication().catch(() => undefined);
  });
  expect(screen.getByText(/Displayed data may be out of date/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Sources" })).toBeTruthy();
  expect(screen.queryByText("Work periods unavailable")).toBeNull();
});

it("opens the same period review from duration and Review without leaving an inline editor after filtering", async () => {
  const user = userEvent.setup();
  const { state, core } = frontendFixture();
  vi.spyOn(api, "GET").mockResolvedValue({
    data: { catalogState: state, workspaceState: core },
  } as never);
  const review = vi.fn();
  renderDay({ openPeriodReview: review });
  await user.click(await screen.findByRole("button", { name: "Correct duration for Test work" }));
  expect(review).toHaveBeenLastCalledWith("period");
  expect(screen.queryByRole("spinbutton")).toBeNull();
  await user.click(screen.getByRole("button", { name: /^Time to validate/ }));
  expect(screen.queryByRole("button", { name: "Correct duration for Test work" })).toBeNull();
  await user.click(screen.getByRole("button", { name: /^All/ }));
  await user.click(screen.getByRole("button", { name: "Review", exact: true }));
  expect(review).toHaveBeenCalledTimes(2);
  expect(review).toHaveBeenLastCalledWith("period");
  expect(screen.queryByRole("spinbutton")).toBeNull();
});

it("clears a tentative case selection when the next unresolved period replaces its question", async () => {
  const user = userEvent.setup();
  const { state, core } = frontendFixture();
  core.periods[0] = { ...core.periods[0], caseId: null, timeValidated: false };
  core.periods.push({
    ...core.periods[0],
    id: "second",
    label: "Second unresolved work",
    startedAt: "2026-10-17T10:00:00Z",
    endedAt: "2026-10-17T10:01:00Z",
  });
  let nextQuestion = false;
  vi.spyOn(api, "GET").mockImplementation(
    async () =>
      ({
        data: {
          catalogState: state,
          workspaceState: {
            ...core,
            periods: core.periods.map((period, index) =>
              nextQuestion && index === 0 ? { ...period, caseId: "case" } : period,
            ),
          },
        },
      }) as never,
  );
  renderDay();
  const choose = await screen.findByRole("combobox", { name: "Case" });
  await user.selectOptions(choose, "case");
  expect(choose).toHaveProperty("value", "case");
  const { act } = await import("@testing-library/react");
  const { refreshApplication } = await import("../../src/frontend/api/queries");
  // A refresh of the same target must keep the tentative answer.
  await act(async () => refreshApplication());
  expect(screen.getByRole("combobox", { name: "Case" })).toHaveProperty("value", "case");
  nextQuestion = true;
  await act(async () => refreshApplication());
  expect(screen.getByRole("combobox", { name: "Case" })).toHaveProperty("value", "");
  expect(
    screen.getByRole("button", { name: "Answer", exact: true }).getAttribute("aria-disabled"),
  ).toBe("true");
});

it("keeps unavailable historical fees distinct from a known current subtotal and labels saved row pricing", async () => {
  const { state, core } = frontendFixture();
  core.periods[0] = {
    ...core.periods[0],
    detectedDurationMs: 3600000,
    durationOverrideMs: null,
    billingStatus: "billed",
    appliedHourlyRateCents: 12500,
    appliedCurrency: "EUR",
  };
  core.periods.push({ ...core.periods[0], id: "current", billingStatus: "unbilled" });
  vi.spyOn(api, "GET").mockResolvedValue({
    data: { catalogState: state, workspaceState: core },
  } as never);
  renderDay();
  await screen.findByText("Work period · Applied €125.00/h");
  const estimate = screen.getByText("Estimated fees").closest(".kpi")!;
  expect(within(estimate as HTMLElement).getByText("—")).toBeTruthy();
  expect(
    within(estimate as HTMLElement).getByText(/Incomplete estimate · \$60.00 known/),
  ).toBeTruthy();
  expect(within(estimate as HTMLElement).queryByText("$185.00")).toBeNull();
});

it.each([
  { caseId: null, cents: 12500, currency: "USD", label: "Base rate $125.00/h" },
  { caseId: null, cents: 12550, currency: "USD", label: "Base rate $125.50/h" },
  { caseId: "case", cents: 12500, currency: "USD", label: "Case rate $125.00/h" },
  { caseId: "case", cents: 12550, currency: "USD", label: "Case rate $125.50/h" },
  { caseId: null, cents: 12550, currency: "EUR", label: "Base rate €125.50/h" },
  { caseId: "case", cents: 12550, currency: "EUR", label: "Case rate €125.50/h" },
])(
  "shows exact whole and fractional row rates: $label",
  async ({ caseId, cents, currency, label }) => {
    const { state, core } = frontendFixture();
    state.settings.currency = currency;
    state.settings.globalHourlyRateCents = cents;
    state.cases[0].hourlyRateCents = cents;
    core.periods[0].caseId = caseId;
    vi.spyOn(api, "GET").mockResolvedValue({
      data: { catalogState: state, workspaceState: core },
    } as never);
    renderDay({ catalogState: state, workspaceState: core });
    await screen.findByText(`Work period · ${label}`);
  },
);
