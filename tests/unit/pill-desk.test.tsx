// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../../src/frontend/api/client";
import { refreshApplication } from "../../src/frontend/api/queries";
import { Pill } from "../../src/frontend/features/desk/pill/Pill";
import { frontendFixture } from "./frontend-fixture";

vi.mock("../../src/frontend/shared/hooks/useToday", () => ({ useToday: () => "2026-10-18" }));

function workspace() {
  const { state, core } = frontendFixture();
  core.activeSession = {
    id: "session",
    startedAt: "2026-10-18T08:00:00Z",
    endedAt: null,
    revision: 0,
  };
  core.periods = [
    {
      ...core.periods[0],
      id: "open",
      startedAt: "2026-10-18T08:00:00Z",
      endedAt: null,
      detectedDurationMs: null,
      durationOverrideMs: null,
      timeValidated: false,
      validatedEffectiveRevision: null,
      timeValidatedAt: null,
    },
  ];
  return { state, core };
}

function mockReads() {
  const { state, core } = workspace();
  // The pill reads the same single workspace snapshot as the application.
  const reads: Record<string, unknown> = {
    "/api/workspace": {
      catalogState: state,
      workspaceState: core,
    },
  };
  vi.spyOn(api, "GET").mockImplementation((async (path: string) => ({
    data: reads[path],
  })) as never);
  return { state, core };
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("shows accepted API periods without native recognition, fictional simulation or local pause", async () => {
  mockReads();
  const post = vi.spyOn(api, "POST");
  render(<Pill />);
  expect(await screen.findByText("Test case")).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: "Simulate file switch" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Pause/ })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "TimeKeeper, toggle panel" }));
  expect(screen.getByRole("button", { name: "Validate" })).toHaveProperty("disabled", true);
  expect(post).not.toHaveBeenCalled();
});

it("reflects a JEV-created period on refresh without producing another transition", async () => {
  const { core } = mockReads();
  const post = vi.spyOn(api, "POST");
  render(<Pill />);
  await screen.findByText("Test case");
  core.periods = [
    { ...core.periods[0], endedAt: "2026-10-18T09:00:00Z" },
    { ...core.periods[0], id: "jev-period", startedAt: "2026-10-18T09:00:00Z" },
  ];
  await act(async () => {
    await refreshApplication();
  });
  expect(await screen.findByRole("status", { name: "New work period" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Validate" })).toHaveProperty("disabled", true);
  expect(post).not.toHaveBeenCalled();
});

it("assigns an unresolved API period with its revision and preserves Undo", async () => {
  const { core, state } = mockReads();
  state.settings.notifications = true;
  core.periods[0].caseId = null;
  core.questions = [
    {
      questionId: "question",
      sessionId: "session",
      periodId: "open",
      status: "pending",
      expectedAssignmentRevision: 1,
    } as (typeof core.questions)[number],
  ];
  const post = vi.spyOn(api, "POST").mockImplementation((async (path: string) => {
    if (path === "/api/pill/decision")
      return {
        data: {
          period: core.periods[0],
          undoToken: "token-1",
          undoExpiresAt: new Date(Date.now() + 5000).toISOString(),
        },
      };
    if (path === "/api/pill/undo") return { data: { status: "undone" } };
    throw Error(`Unexpected ${path}`);
  }) as never);
  render(<Pill />);
  await userEvent.selectOptions(
    await screen.findByRole("combobox", { name: "Choose a case for this period" }),
    "case",
  );
  expect(post).toHaveBeenCalledWith("/api/pill/decision", {
    body: { kind: "assign", periodId: "open", caseId: "case", expectedAssignmentRevision: 1 },
  });
  await userEvent.click(await screen.findByRole("button", { name: "Undo last choice" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/pill/undo", { body: { undoToken: "token-1" } }),
  );
});

it("keeps a failed manual answer visible and allows retry", async () => {
  const { core, state } = mockReads();
  state.settings.notifications = true;
  core.periods[0].caseId = null;
  core.questions = [
    {
      questionId: "question",
      sessionId: "session",
      periodId: "open",
      status: "pending",
      expectedAssignmentRevision: 1,
    } as (typeof core.questions)[number],
  ];
  vi.spyOn(api, "POST").mockResolvedValue({
    error: { message: "This period changed. Review it again." },
  } as never);
  render(<Pill />);
  await userEvent.selectOptions(
    await screen.findByRole("combobox", { name: "Choose a case for this period" }),
    "case",
  );
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "This period changed. Review it again.",
  );
  expect(screen.getByRole("combobox", { name: "Choose a case for this period" })).toHaveProperty(
    "disabled",
    false,
  );
  await userEvent.click(screen.getByRole("button", { name: "Retry assignment" }));
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("status", { name: "Which case" })).toBeNull();
});

it("validates a finished past-day period from an ended session while today's period stays unready", async () => {
  const { core } = mockReads();
  const past = {
    ...core.periods[0],
    id: "past",
    sessionId: "ended-session",
    startedAt: "2026-10-17T08:00:00Z",
    endedAt: "2026-10-17T09:00:00Z",
    durationOverrideMs: 3600000,
  };
  core.periods.push(past);
  const post = vi.spyOn(api, "POST").mockResolvedValue({
    data: {
      period: past,
      undoToken: "validation",
      undoExpiresAt: new Date(Date.now() + 5000).toISOString(),
    },
  } as never);
  render(<Pill />);
  await screen.findByText("Test case");
  await userEvent.click(screen.getByRole("button", { name: "TimeKeeper, toggle panel" }));
  await userEvent.click(screen.getByRole("button", { name: "Validate all 1" }));
  expect(post).toHaveBeenCalledWith("/api/pill/decision", {
    body: {
      kind: "validate",
      periodIds: ["past"],
      expectedEffectiveRevisions: { past: past.effectiveRevision },
    },
  });
});

it("does not turn elapsed session time into fees when duration is unknown", async () => {
  const { state } = mockReads();
  state.settings.pillDisplay = "fees";
  render(<Pill />);
  await screen.findByText("Test case");
  await userEvent.click(screen.getByRole("button", { name: "TimeKeeper, toggle panel" }));
  const kpis = document.querySelector(".pill-kpis")!;
  expect(kpis.textContent).toContain("This periodUnknown");
  expect(kpis.textContent).toContain("Amount—");
  expect(kpis.textContent).toContain("Today—");
});

it("expires undo at the server deadline after a delayed decision response", async () => {
  const { core } = mockReads();
  const past = {
    ...core.periods[0],
    id: "past",
    startedAt: "2026-10-17T08:00:00Z",
    endedAt: "2026-10-17T09:00:00Z",
    durationOverrideMs: 3600000,
  };
  core.periods.push(past);
  vi.spyOn(api, "POST").mockResolvedValue({
    data: {
      period: past,
      undoToken: "short",
      undoExpiresAt: new Date(Date.now() + 600).toISOString(),
    },
  } as never);
  render(<Pill />);
  await screen.findByText("Test case");
  await userEvent.click(screen.getByRole("button", { name: "TimeKeeper, toggle panel" }));
  await userEvent.click(screen.getByRole("button", { name: "Validate all 1" }));
  expect(await screen.findByRole("button", { name: "Undo last choice" })).toBeTruthy();
  await waitFor(
    () => expect(screen.queryByRole("button", { name: "Undo last choice" })).toBeNull(),
    { timeout: 1200 },
  );
});
