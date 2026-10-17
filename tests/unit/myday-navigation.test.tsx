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
    if (path === "/api/work-periods") {
      const date = (options as { params?: { query?: { date?: string } } })?.params?.query?.date;
      return { data: !date || date === "2026-10-17" ? core.periods : [] } as never;
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
  await user.click(screen.getByRole("button", { name: /^Validated/ }));
  await user.click(screen.getByRole("button", { name: "Filter", exact: true }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Client", exact: true }), "client");
  await user.selectOptions(screen.getByRole("combobox", { name: "Case", exact: true }), "case");
  await user.click(screen.getByRole("button", { name: /^Filter.*Filters active$/ }));
  await user.click(screen.getByRole("button", { name: "Work performed" }));
  await user.click(screen.getByRole("button", { name: "Sources" }));
  await user.click(screen.getByRole("button", { name: "Back to My day" }));
  const sources = await screen.findByRole("button", { name: "Sources" });
  await waitFor(() => expect(document.activeElement).toBe(sources));
  expect(screen.getByRole("button", { name: /^Validated/ }).getAttribute("aria-pressed")).toBe(
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
