// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BillingStatus, PillDisplay } from "../../src/contracts/states.generated";
import { WorkPill } from "../../src/frontend/features/desk/components/WorkPill/WorkPill";
import { pillView } from "../../src/frontend/features/desk/lib/pillView";
import { frontendFixture } from "./frontend-fixture";

afterEach(cleanup);

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
  return fixture;
}

it.each([
  { display: PillDisplay.Fees, label: "Test client", value: "$60.00" },
  { display: PillDisplay.Time, label: "Test client", value: "1h 00m" },
  { display: PillDisplay.Case, label: "Test case", value: "" },
])("uses the saved $display display in both pill presentations", ({ display, label, value }) => {
  const { state, core } = activeFixture();
  state.settings.pillDisplay = display;
  const view = pillView(state, core);
  expect(view.clientLabel).toBe(label);
  expect(view.metricValue).toBe(value);
  render(
    <WorkPill
      view={view}
      expanded={false}
      onToggle={vi.fn()}
      onAssign={vi.fn()}
      onOpenDay={vi.fn()}
      onDismiss={vi.fn()}
      notice={null}
    />,
  );
  const bar = screen.getByRole("button", { name: "TimeKeeper, toggle panel" });
  expect(within(bar).getByText(label)).toBeTruthy();
  expect(bar.querySelector("svg")).toBeTruthy();
});

it("distinguishes a known zero fee from missing historical pricing", () => {
  const { state, core } = activeFixture();
  state.settings.pillDisplay = PillDisplay.Fees;
  state.settings.globalHourlyRateCents = 0;
  expect(pillView(state, core).metricValue).toBe("$0.00");
  core.periods[0].billingStatus = BillingStatus.Billed;
  expect(pillView(state, core).metricValue).toBe("—");
  expect(pillView(state, core).assignmentDisabled).toBe(true);
});

it("shows the same empty session panel without enabling recording or assignment", () => {
  const { state, core } = frontendFixture();
  render(
    <WorkPill
      view={pillView(state, core)}
      expanded
      onToggle={vi.fn()}
      onAssign={vi.fn()}
      onOpenDay={vi.fn()}
      onDismiss={vi.fn()}
      notice={null}
    />,
  );
  expect(screen.getByRole("combobox").hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "Pause" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "Close period" }).hasAttribute("disabled")).toBe(true);
});
