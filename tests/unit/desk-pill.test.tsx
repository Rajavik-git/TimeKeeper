// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BillingStatus, PillDisplay } from "../../src/contracts/states.generated";
import { api } from "../../src/frontend/api/client";
import { Pill } from "../../src/frontend/features/desk/pill/Pill";
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
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function activeFixture() {
  const fixture = frontendFixture();
  fixture.core.activeSession = {
    id: "session",
    startedAt: "2026-10-17T09:00:00Z",
    endedAt: null,
    revision: 1,
  };
  Object.assign(fixture.core.periods[0], {
    endedAt: null,
    detectedDurationMs: 3600000,
    durationOverrideMs: 3600000,
  });
  vi.spyOn(api, "GET").mockResolvedValue({
    data: { catalogState: fixture.state, workspaceState: fixture.core },
  } as never);
  return fixture;
}
it.each([
  { display: PillDisplay.Fees, value: "$60.00" },
  { display: PillDisplay.Time, value: "1h 00m" },
  { display: PillDisplay.Case, value: null },
])("uses saved $display display in the production presentation", async ({ display, value }) => {
  const { state } = activeFixture();
  state.settings.pillDisplay = display;
  render(<Pill />);
  const bar = await screen.findByRole("button", { name: "TimeKeeper, toggle panel" });
  await screen.findByText("Test case");
  expect(within(bar).getByText("Test case")).toBeTruthy();
  expect(bar.closest(".pill-bar")?.querySelector("svg")).toBeTruthy();
  if (value) expect(within(bar).getByText(value)).toBeTruthy();
  else expect(bar.querySelector(".pill-amount")).toBeNull();
});
it("preserves known zero and missing historical fees in the production presentation", async () => {
  const { state, core } = activeFixture();
  state.settings.pillDisplay = PillDisplay.Fees;
  state.settings.globalHourlyRateCents = 0;
  render(<Pill />);
  expect(await screen.findByText("$0.00")).toBeTruthy();
  cleanup();
  core.periods[0].billingStatus = BillingStatus.Billed;
  render(<Pill />);
  await screen.findByText("Test case");
  expect(screen.queryByText("$0.00")).toBeNull();
});
it("shows the empty production session without enabling assignment", async () => {
  const { core } = activeFixture();
  core.activeSession = null;
  render(<Pill />);
  await screen.findByText("No active session");
  await userEvent.click(screen.getByRole("button", { name: "TimeKeeper, toggle panel" }));
  expect(screen.getByRole("combobox", { name: "Change case" })).toHaveProperty("disabled", true);
  expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Close period" })).toBeNull();
});
