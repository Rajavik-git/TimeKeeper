// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

/** Screenpipe focus replies, one per poll; the last one repeats. */
function mockReads(focus: unknown[] = []) {
  const { state, core } = workspace();
  let poll = 0;
  // The pill reads the same single workspace snapshot as the application.
  const reads: Record<string, unknown> = {
    "/api/workspace": {
      catalogState: state,
      workspaceState: { ...core, sources: [], questions: [], coverageGaps: [] },
    },
  };
  vi.spyOn(api, "GET").mockImplementation((async (path: string) => ({
    data:
      path === "/api/screenpipe/focus" ? focus[Math.min(poll++, focus.length - 1)] : reads[path],
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

const focusOn = (appName: string, windowTitle: string) => ({
  status: "ok",
  focus: { appName, windowTitle, url: null, recordedAt: "2026-10-18T09:00:00Z" },
});
const recognition = {
  suggestion: {
    caseId: "case",
    client: "Test client",
    title: "Test case",
    reference: "TEST-001",
    reason: "reference: TEST-001",
  },
  alternatives: [],
  confidence: "low",
};
const focusPolls = () =>
  vi.mocked(api.GET).mock.calls.filter(([path]) => path === "/api/screenpipe/focus").length;
/** Runs the 2 s Screenpipe polls without waiting in real time. */
async function advancePolls(count: number) {
  for (let index = 0; index < count; index++) await act(() => vi.advanceTimersByTimeAsync(2000));
}

describe("Screenpipe window detection", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks about a window once Screenpipe reports it on two consecutive polls", async () => {
    mockReads([focusOn("WINWORD", "2025-031 Opposition Brief v3 - Word")]);
    const post = vi.spyOn(api, "POST").mockResolvedValue({ data: recognition } as never);
    render(<Pill />);
    await screen.findByText("Test case");
    await advancePolls(2);
    expect(await screen.findByText("Switched to 2025-031 Opposition Brief v3 - Word")).toBeTruthy();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("/api/recognize", {
      body: { windowTitle: "2025-031 Opposition Brief v3 - Word", appName: "WINWORD" },
    });
  });

  it("ignores a window seen only once and TimeKeeper's own windows", async () => {
    mockReads([
      focusOn("explorer", "Downloads"),
      focusOn("timekeeper-desktop", "TimeKeeper"),
      focusOn("msedge", "TimeKeeper pill"),
      focusOn("timekeeper-desktop", "Notes on timekeeper policy.docx"),
    ]);
    const post = vi.spyOn(api, "POST").mockResolvedValue({ data: recognition } as never);
    render(<Pill />);
    await screen.findByText("Test case");
    await advancePolls(5);
    expect(post).not.toHaveBeenCalled();
  });

  it("shows when Screenpipe cannot be read", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockReads([{ status: "unauthorized", message: "Screenpipe refused the API key." }]);
    render(<Pill />);
    await screen.findByText("Test case");
    await advancePolls(1);
    await user.click(screen.getByRole("button", { name: "TimeKeeper, toggle panel" }));
    expect(
      await screen.findByText("Screenpipe not connected · Screenpipe refused the API key."),
    ).toBeTruthy();
  });

  it("stops reading Screenpipe while paused", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockReads([focusOn("explorer", "Downloads")]);
    render(<Pill />);
    await screen.findByText("Test case");
    await user.click(screen.getByRole("button", { name: "Pause file-switch detection" }));
    const polls = focusPolls();
    await advancePolls(3);
    expect(focusPolls()).toBe(polls);
  });
  it("reports a returning window and keeps stability across empty polls", async () => {
    mockReads([
      focusOn("WINWORD", "A.docx - Word"),
      focusOn("WINWORD", "A.docx - Word"),
      focusOn("WINWORD", "B.docx - Word"),
      { status: "ok", focus: null },
      focusOn("WINWORD", "B.docx - Word"),
      focusOn("WINWORD", "A.docx - Word"),
      focusOn("WINWORD", "A.docx - Word"),
    ]);
    const post = vi.spyOn(api, "POST").mockResolvedValue({ data: recognition } as never);
    render(<Pill />);
    await screen.findByText("Test case");
    await advancePolls(7);
    const titles = post.mock.calls.map(
      ([, init]) => (init as { body: { windowTitle: string } }).body.windowTitle,
    );
    expect(titles).toEqual(["A.docx - Word", "B.docx - Word", "A.docx - Word"]);
  });

  it("reports a client document about timekeeping opened in Word", async () => {
    mockReads([focusOn("WINWORD", "Notes on timekeeper policy.docx - Word")]);
    const post = vi.spyOn(api, "POST").mockResolvedValue({ data: recognition } as never);
    render(<Pill />);
    await screen.findByText("Test case");
    await advancePolls(2);
    expect(post).toHaveBeenCalledWith("/api/recognize", {
      body: { windowTitle: "Notes on timekeeper policy.docx - Word", appName: "WINWORD" },
    });
  });

  it("clears the Screenpipe problem while paused and checks again on resume", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockReads([{ status: "unavailable", message: "Screenpipe is not running or not reachable." }]);
    render(<Pill />);
    await screen.findByText("Test case");
    await advancePolls(1);
    await user.click(screen.getByRole("button", { name: "TimeKeeper, toggle panel" }));
    const hint = /^Screenpipe not connected/;
    expect(await screen.findByText(hint)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Pause file-switch detection" }));
    expect(screen.queryByText(hint)).toBeNull();
    // Resuming reads Screenpipe again at once rather than reusing the old state.
    await user.click(screen.getByRole("button", { name: "Resume file-switch detection" }));
    expect(await screen.findByText(hint)).toBeTruthy();
  });
});
