// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../../src/frontend/api/client";
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
      workspaceState: { ...core, sources: [], questions: [], coverageGaps: [] },
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

it("shows the active case and offers the browser file-switch simulator", async () => {
  mockReads();
  render(<Pill />);
  expect(await screen.findByText("Test case")).toBeTruthy();
  expect(screen.getByRole("button", { name: "TimeKeeper, toggle panel" })).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Simulate file switch" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Program Manager (non-document)" })).toBeTruthy();
});

it("recognizes a simulated switch, confirms it in one click and offers Undo", async () => {
  const user = userEvent.setup();
  mockReads();
  const post = vi.spyOn(api, "POST").mockImplementation((async (path: string) => {
    if (path === "/api/recognize")
      return {
        data: {
          suggestion: {
            caseId: "case",
            client: "Test client",
            title: "Test case",
            reference: "TEST-001",
            reason: "reference: TEST-001",
          },
          alternatives: [],
          confidence: "high",
        },
      };
    if (path === "/api/pill/decision")
      return { data: { period: { id: "next" }, undoToken: "token-1" } };
    if (path === "/api/pill/undo") return { data: { status: "undone" } };
    throw Error(`Unexpected ${path}`);
  }) as never);
  render(<Pill />);
  await screen.findByText("Test case");
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Simulate file switch" }),
    "2025-031 Opposition Brief v3.docx",
  );
  expect(await screen.findByText("Switched to 2025-031 Opposition Brief v3.docx")).toBeTruthy();
  expect(post).toHaveBeenCalledWith("/api/recognize", {
    body: { windowTitle: "2025-031 Opposition Brief v3.docx", appName: "Demo documents" },
  });
  await user.click(screen.getByRole("button", { name: /^Confirm/ }));
  const decision = post.mock.calls.find(([path]) => path === "/api/pill/decision");
  expect(decision?.[1]).toMatchObject({
    body: { kind: "switch", caseId: "case", windowTitle: "2025-031 Opposition Brief v3.docx" },
  });
  // The switch instant comes from the PC clock, not from a fixed demo day.
  const at = (decision?.[1] as { body: { at: string } }).body.at;
  expect(Math.abs(Date.parse(at) - Date.now())).toBeLessThan(60000);
  await user.click(await screen.findByRole("button", { name: "Undo last choice" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/pill/undo", { body: { undoToken: "token-1" } }),
  );
});

it("pauses file-switch detection locally without writing to the server", async () => {
  const user = userEvent.setup();
  mockReads();
  const post = vi.spyOn(api, "POST");
  render(<Pill />);
  await screen.findByText("Test case");
  await user.click(screen.getByRole("button", { name: "Pause file-switch detection" }));
  expect(screen.getByText("Paused")).toBeTruthy();
  expect(
    (screen.getByRole("combobox", { name: "Simulate file switch" }) as HTMLSelectElement).disabled,
  ).toBe(true);
  expect(localStorage.getItem("timekeeper:pill-paused:session")).not.toBeNull();
  expect(post).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Resume file-switch detection" }));
  expect(screen.queryByText("Paused")).toBeNull();
});

it("dismisses a switch notice with Escape", async () => {
  const user = userEvent.setup();
  mockReads();
  vi.spyOn(api, "POST").mockResolvedValue({
    data: { suggestion: null, alternatives: [], confidence: "low" },
  } as never);
  render(<Pill />);
  await screen.findByText("Test case");
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Simulate file switch" }),
    "Meeting request - new matter.eml",
  );
  expect(await screen.findByText("Which case is this?")).toBeTruthy();
  await user.keyboard("{Escape}");
  expect(screen.queryByText("Which case is this?")).toBeNull();
});
