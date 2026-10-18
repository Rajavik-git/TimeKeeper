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
it("shows imported sources before periods, including references without a work period", () => {
  const props = input();
  props.workspaceState.periods = [];
  props.workspaceState.sources = [
    {
      id: "imported-reference",
      workPeriodId: null,
      instanceId: "local",
      contentType: "ocr",
      externalId: "frame-123",
      recordedAt: "2026-10-18T11:00:00Z",
      ingestedAt: "2026-10-18T11:05:00Z",
      validationStatus: "unvalidated",
      availabilityStatus: "unknown",
    },
  ];
  render(<PeriodActivity {...props} />);
  expect(
    screen.getByRole("button", { name: /^Imported sources/ }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.getByRole("heading", { name: "Imported sources", exact: true })).toBeTruthy();
  expect(screen.getByText("frame-123", { exact: false })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Timeline" })).toBeNull();
});

it("opens an explicitly selected period in the existing period review view", () => {
  const props = input();
  props.selected = props.workspaceState.periods[0].id;
  render(<PeriodActivity {...props} />);
  expect(
    screen.getByRole("button", { name: "Work periods", exact: true }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.getByRole("heading", { name: "Timeline", exact: true })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^Imported sources/ }));
  expect(screen.getByRole("heading", { name: "Imported sources", exact: true })).toBeTruthy();
});

it("switches to a newly requested work period after browsing imported sources", () => {
  const props = input();
  const view = render(<PeriodActivity {...props} />);
  view.rerender(<PeriodActivity {...props} selected={props.workspaceState.periods[0].id} />);
  expect(
    screen.getByRole("button", { name: "Work periods", exact: true }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.getByRole("heading", { name: "Timeline", exact: true })).toBeTruthy();
});

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
  fireEvent.click(screen.getByRole("button", { name: "Work periods", exact: true }));
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
  fireEvent.click(screen.getByRole("button", { name: "Work periods", exact: true }));
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
  fireEvent.click(screen.getByRole("button", { name: "Work periods", exact: true }));
  expect(screen.getByText("No work periods recorded yet.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Audit trail" })).toBeNull();
});
it("rounds a combined twenty-second total upward to one minute", () => {
  const props = input();
  props.workspaceState.periods[0].durationOverrideMs = 10000;
  props.workspaceState.periods.push({
    ...props.workspaceState.periods[0],
    id: "another-ten-seconds",
  });
  render(<PeriodActivity {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Work periods", exact: true }));
  expect(screen.getByText(/1m in work periods/)).toBeTruthy();
  expect(screen.queryByText(/0m in work periods/)).toBeNull();
});

it("shows literal source context and excerpts in linked period review", () => {
  const props = input();
  props.selected = props.workspaceState.periods[0].id;
  props.workspaceState.sources = [
    {
      instanceId: "local",
      contentType: "accessibility",
      externalId: "observed-1",
      recordedAt: "2026-10-17T09:00:00Z",
      ingestedAt: "2026-10-18T09:00:00Z",
      validationStatus: "unvalidated",
      availabilityStatus: "unknown",
      id: "observed-context",
      workPeriodId: props.selected,
      appName: "Observed editor",
      windowName: '<img src=x onerror="private()">',
      excerpt: "Literal source excerpt",
      detectedMarker: null,
    },
  ];
  const rendered = render(<PeriodActivity {...props} />);
  expect(screen.getByText("App: Observed editor")).toBeTruthy();
  expect(screen.getByText('Window: <img src=x onerror="private()">')).toBeTruthy();
  expect(screen.getByText("Source excerpt")).toBeTruthy();
  expect(screen.getByText("Literal source excerpt")).toBeTruthy();
  expect(rendered.container.querySelector("img")).toBeNull();
});
