// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PeriodActivity } from "../../src/frontend/features/workday/PeriodActivity";
import { frontendFixture } from "./frontend-fixture";

afterEach(cleanup);
function input() {
  const { state, core } = frontendFixture();
  return {
    catalogState: state,
    workspaceState: core,
    selected: "",
    refresh: vi.fn().mockResolvedValue(undefined),
    action: async <T,>(promise: Promise<{ data?: T }>) => (await promise).data,
    navigate: vi.fn(),
    openPeriodActivity: vi.fn(),
  };
}
it("includes nonbillable unvalidated work but not excluded work in pending validation", () => {
  const props = input();
  props.workspaceState.periods[0] = {
    ...props.workspaceState.periods[0],
    billable: false,
    timeValidated: false,
  };
  props.workspaceState.periods.push({
    ...props.workspaceState.periods[0],
    id: "excluded",
    excluded: true,
  });
  render(<PeriodActivity {...props} />);
  expect(screen.getByText(/1 awaiting time validation/)).toBeTruthy();
});
it("selects short periods through full-identity list controls", () => {
  const props = input();
  props.workspaceState.periods.push({
    ...props.workspaceState.periods[0],
    id: "second",
    label: "Second short work",
    startedAt: "2026-10-17T10:00:00Z",
    endedAt: "2026-10-17T10:00:20Z",
  });
  render(<PeriodActivity {...props} />);
  const list = screen.getByRole("region", { name: "Work periods" });
  const button = within(list).getByRole("button", {
    name: /Test client · TEST-001 · Test case · Second short work/,
  });
  fireEvent.click(button);
  expect(button.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("heading", { name: "Second short work" })).toBeTruthy();
});
it("gives a focused empty state without empty source and audit panels", () => {
  const props = input();
  props.workspaceState.periods = [];
  render(<PeriodActivity {...props} />);
  expect(screen.getByText("No work periods recorded yet.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Audit trail" })).toBeNull();
});
