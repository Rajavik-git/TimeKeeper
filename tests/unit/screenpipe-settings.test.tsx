// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../src/frontend/api/client";
import { refreshApplication } from "../../src/frontend/api/queries";
import { ScreenpipeSection } from "../../src/frontend/features/settings/components/ScreenpipeSection/ScreenpipeSection";
import type { ScreenpipeStatus } from "../../src/frontend/features/settings/hooks/useScreenpipeIntegration";

vi.mock("../../src/frontend/api/queries", () => ({ refreshApplication: vi.fn() }));

const time = "2026-10-18T12:00:00Z";
function status(overrides: Partial<ScreenpipeStatus> = {}): ScreenpipeStatus {
  return {
    configured: true,
    configurationIssue: null,
    automaticSync: true,
    intervalSeconds: 300,
    syncing: false,
    testing: false,
    connection: { status: "not-tested", checkedAt: null, message: null },
    lastRun: null,
    lastSuccessfulSyncAt: null,
    ...overrides,
  };
}
function result(data: ScreenpipeStatus) {
  return { data } as never;
}
async function ready(snapshot = status()) {
  vi.spyOn(api, "GET").mockResolvedValue(result(snapshot));
  const view = render(<ScreenpipeSection active />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Refresh status" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  return view;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();
});

it("explains missing backend credentials and never tests or imports on load", async () => {
  const post = vi.spyOn(api, "POST");
  await ready(
    status({ configured: false, configurationIssue: "missing-api-key", automaticSync: false }),
  );
  expect(screen.getByText(/Set SCREENPIPE_API_KEY/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Test connection" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "Sync now" })).toHaveProperty("disabled", true);
  expect(post).not.toHaveBeenCalled();
});

it("offers an explicit retry when configured automatic synchronization is paused", async () => {
  await ready(status({ automaticSync: false }));
  expect(screen.getByText(/Automatic sync is paused/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Test connection" })).toHaveProperty("disabled", false);
  expect(screen.getByRole("button", { name: "Sync now" })).toHaveProperty("disabled", false);
});

it.each(["connected", "authentication-failed"] as const)(
  "shows the %s business result from an HTTP 200 connection test",
  async (connectionStatus) => {
    const post = vi
      .spyOn(api, "POST")
      .mockResolvedValue(
        result(
          status({ connection: { status: connectionStatus, checkedAt: time, message: null } }),
        ),
      );
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await screen.findByText(
      connectionStatus === "connected" ? /Authenticated access confirmed/ : /Authentication failed/,
    );
    expect(post).toHaveBeenCalledExactlyOnceWith("/api/integrations/screenpipe/test", { body: {} });
    expect(refreshApplication).not.toHaveBeenCalled();
  },
);

it.each(["succeeded", "partial", "no-sessions", "failed"] as const)(
  "reports %s sync results without treating HTTP success as complete import",
  async (outcome) => {
    const run = {
      outcome,
      startedAt: time,
      finishedAt: time,
      windows: 1,
      imported: 0,
      unchanged: 0,
      preserved: 0,
      error: null,
    };
    const post = vi.spyOn(api, "POST").mockResolvedValue(result(status({ lastRun: run })));
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    const message = {
      succeeded: /Sync completed for this batch/,
      partial: /Sync partially completed/,
      "no-sessions": /No TimeKeeper sessions are available/,
      failed: /Sync failed/,
    }[outcome];
    await screen.findByText(message);
    expect(post).toHaveBeenCalledExactlyOnceWith("/api/integrations/screenpipe/sync", { body: {} });
    expect(screen.getByText("References imported").nextElementSibling?.textContent).toBe("0");
    expect(screen.getByText("References updated").nextElementSibling?.textContent).toBe("0");
    await waitFor(() => expect(refreshApplication).toHaveBeenCalledOnce());
  },
);

it("describes a successful batch with no eligible provider windows without claiming imported data", async () => {
  await ready(
    status({
      lastRun: {
        outcome: "succeeded",
        startedAt: time,
        finishedAt: time,
        windows: 0,
        imported: 0,
        unchanged: 0,
        preserved: 0,
        error: null,
      },
    }),
  );
  expect(screen.getByText("No recording windows are currently eligible for import.")).toBeTruthy();
  expect(screen.queryByText(/Sync completed for this batch/)).toBeNull();
  expect(screen.getByText("Connection not tested")).toBeTruthy();
  expect(screen.getByText("Last successful batch").nextElementSibling?.textContent).toBe("Not yet");
});

it("prevents repeated actions while a manual request is pending", async () => {
  let finish!: (value: never) => void;
  const post = vi.spyOn(api, "POST").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await ready();
  const sync = screen.getByRole("button", { name: "Sync now" });
  fireEvent.click(sync);
  fireEvent.click(sync);
  expect(post).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Test connection" })).toHaveProperty("disabled", true);
  await act(async () => finish(result(status())));
});

it.each(["syncing", "testing"] as const)(
  "blocks manual actions when the backend reports %s",
  async (operation) => {
    const post = vi.spyOn(api, "POST");
    await ready(status({ [operation]: true }));
    expect(screen.getByRole("button", { name: "Test connection" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Sync now" })).toHaveProperty("disabled", true);
    expect(post).not.toHaveBeenCalled();
  },
);

it("does not start a poll that could overwrite a pending manual result", async () => {
  vi.useFakeTimers();
  const get = vi.spyOn(api, "GET").mockResolvedValue(result(status()));
  let finish!: (value: never) => void;
  vi.spyOn(api, "POST").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<ScreenpipeSection active />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(get).toHaveBeenCalledOnce();
  await act(async () =>
    finish(result(status({ connection: { status: "connected", checkedAt: time, message: null } }))),
  );
  expect(screen.getByText(/Authenticated access confirmed/)).toBeTruthy();
});

it("retains a previous result after an API failure and permits a status retry", async () => {
  await ready(status({ connection: { status: "connected", checkedAt: time, message: null } }));
  vi.mocked(api.GET).mockRejectedValueOnce(new Error("private server details"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  await screen.findByRole("alert");
  expect(screen.getByText(/Authenticated access confirmed/)).toBeTruthy();
  expect(screen.getByRole("alert").textContent).not.toContain("private server details");
  expect(screen.getByRole("button", { name: "Sync now" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "Retry status" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

it("keeps a committed result separate from a failed application refresh", async () => {
  vi.mocked(refreshApplication).mockRejectedValueOnce(new Error("refresh failed"));
  vi.spyOn(api, "POST").mockResolvedValue(
    result(
      status({
        lastRun: {
          outcome: "succeeded",
          startedAt: time,
          finishedAt: time,
          windows: 1,
          imported: 2,
          unchanged: 0,
          preserved: 0,
          error: null,
        },
      }),
    ),
  );
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
  await screen.findByText(/The sync result is saved/);
  expect(screen.getByText(/Sync completed for this batch/)).toBeTruthy();
  expect(screen.queryByText(/TimeKeeper could not confirm/)).toBeNull();
});

it("does not fetch or poll while its Settings section is hidden", async () => {
  vi.useFakeTimers();
  const get = vi.spyOn(api, "GET").mockResolvedValue(result(status()));
  const post = vi.spyOn(api, "POST");
  const view = render(<ScreenpipeSection active={false} />);
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(get).not.toHaveBeenCalled();
  view.rerender(<ScreenpipeSection active />);
  await act(async () => {});
  expect(get).toHaveBeenCalledOnce();
  view.rerender(<ScreenpipeSection active={false} />);
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(get).toHaveBeenCalledOnce();
  expect(post).not.toHaveBeenCalled();
});

it("reports updated references separately from newly imported references", async () => {
  await ready(
    status({
      lastRun: {
        outcome: "succeeded",
        startedAt: time,
        finishedAt: time,
        windows: 1,
        imported: 2,
        updated: 5,
        unchanged: 3,
        preserved: 0,
        error: null,
      },
    }),
  );
  expect(screen.getByText("References updated").nextElementSibling?.textContent).toBe("5");
  expect(screen.getByText("References imported").nextElementSibling?.textContent).toBe("2");
  expect(screen.getByText(/source excerpts of up to 1,000 characters/)).toBeTruthy();
});
