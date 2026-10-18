// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HistoryProposals } from "../../src/frontend/features/workday/components/HistoryProposals/HistoryProposals";
import { api } from "../../src/frontend/api/client";
import { historyApi } from "../../src/frontend/api/history";
import type { HistoryProposal, HistoryState } from "../../src/contracts/history";
import { frontendFixture } from "./frontend-fixture";
const { state, core } = frontendFixture();
const session = {
  id: "history-session",
  startedAt: "2026-10-18T09:00:00.000Z",
  endedAt: "2026-10-18T10:00:00.000Z",
  revision: 1,
};
const proposal: HistoryProposal = {
  id: "proposal-1",
  jobId: "job-1",
  sessionId: session.id,
  revision: 3,
  status: "draft",
  acceptedPeriodId: null,
  caseId: null,
  startedAt: session.startedAt,
  endedAt: session.endedAt,
  label: "Review recorded context",
  confidence: 0.7,
  sourceIds: ["source-1"],
  hasGaps: true,
};
function history(proposals: HistoryProposal[] = [proposal]): HistoryState {
  return { configured: true, jobs: [], proposals };
}
function view(refresh = vi.fn().mockResolvedValue(undefined)) {
  return (
    <HistoryProposals
      catalogState={state}
      workspaceState={{
        ...core,
        activeSession: null,
        sessions: [session],
        sources: [
          {
            id: "source-1",
            workPeriodId: null,
            instanceId: "local",
            externalId: "1",
            contentType: "ocr",
            recordedAt: session.startedAt,
            ingestedAt: session.startedAt,
            validationStatus: "unvalidated",
            availabilityStatus: "unknown",
            excerpt: "<script>private source</script>",
          },
        ],
      }}
      refresh={refresh}
    />
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("loads without generating, keeps duration blank, and escapes source text", async () => {
  vi.spyOn(historyApi, "load").mockResolvedValue(history());
  const generate = vi.spyOn(historyApi, "generate");
  const accept = vi.spyOn(historyApi, "accept");
  const { container } = render(view());
  const duration = await screen.findByLabelText("Confirmed worked duration, minutes");
  expect(duration).toHaveProperty("value", "");
  expect(generate).not.toHaveBeenCalled();
  fireEvent.submit(screen.getByRole("button", { name: "Accept work period" }).closest("form")!);
  expect(accept).not.toHaveBeenCalled();
  expect(screen.getByText("<script>private source</script>")).toBeTruthy();
  expect(container.querySelector("script")).toBeNull();
});
it("accepts an unresolved case with explicit duration and refreshes workspace", async () => {
  vi.spyOn(historyApi, "load").mockResolvedValue(history());
  const accept = vi
    .spyOn(historyApi, "accept")
    .mockResolvedValue({} as Awaited<ReturnType<typeof historyApi.accept>>);
  const refresh = vi.fn().mockRejectedValue(new Error("offline"));
  render(view(refresh));
  fireEvent.change(await screen.findByLabelText("Confirmed worked duration, minutes"), {
    target: { value: "12.5" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Accept work period" }));
  await waitFor(() =>
    expect(accept).toHaveBeenCalledWith("proposal-1", {
      expectedRevision: 3,
      caseId: null,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      label: proposal.label,
      durationMs: 750000,
    }),
  );
  await screen.findByText(/Work period saved. The workspace could not refresh/);
  expect(refresh).toHaveBeenCalledOnce();
});
it("retains edited fields after conflict and poll updates", async () => {
  const load = vi.spyOn(historyApi, "load").mockResolvedValue(history());
  vi.spyOn(historyApi, "accept").mockRejectedValue(
    new Error("This proposal changed. Your edits are kept."),
  );
  render(view());
  const label = await screen.findByLabelText("Description");
  fireEvent.change(label, { target: { value: "My edited description" } });
  fireEvent.change(screen.getByLabelText("Confirmed worked duration, minutes"), {
    target: { value: "8" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Accept work period" }));
  await screen.findByText("This proposal changed. Your edits are kept.");
  load.mockResolvedValue(history([{ ...proposal, revision: 4, label: "Updated server text" }]));
  fireEvent.click(screen.getByRole("button", { name: "Refresh proposals" }));
  await screen.findByRole("button", { name: "Use latest proposal" });
  expect(label).toHaveProperty("value", "My edited description");
  expect(screen.getByLabelText("Confirmed worked duration, minutes")).toHaveProperty("value", "8");
  expect(screen.getByRole("button", { name: "Accept work period" })).toHaveProperty(
    "disabled",
    true,
  );
});
it("generates only on request and reports delivery unconfirmed without success claims", async () => {
  const load = vi.spyOn(historyApi, "load").mockResolvedValue(history([]));
  const generate = vi
    .spyOn(historyApi, "generate")
    .mockResolvedValue({} as Awaited<ReturnType<typeof historyApi.generate>>);
  render(view());
  await screen.findByText(
    "No proposals yet. Import sources, choose a range, then generate proposals.",
  );
  load.mockResolvedValue({
    ...history([]),
    jobs: [
      {
        id: "j",
        sessionId: session.id,
        startAt: session.startedAt,
        endAt: session.endedAt!,
        status: "dispatch-unconfirmed",
        createdAt: session.startedAt,
        finishedAt: null,
        error: null,
        sourceCount: 3,
        proposalCount: 0,
      },
    ],
  });
  fireEvent.click(screen.getByRole("button", { name: "Generate work periods from history" }));
  await waitFor(() =>
    expect(generate).toHaveBeenCalledWith({
      sessionId: session.id,
      startAt: "2026-10-18T09:50:00.000Z",
      endAt: session.endedAt,
    }),
  );
  await screen.findByText(/Delivery could not be confirmed/);
  expect(screen.getByRole("button", { name: "Generate work periods from history" })).toHaveProperty(
    "disabled",
    true,
  );
});
it("ignores a late read after the view is closed", async () => {
  let resolve!: (value: HistoryState) => void;
  vi.spyOn(historyApi, "load").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { unmount } = render(view());
  unmount();
  await act(async () => resolve(history()));
  expect(screen.queryByText("Proposed work period")).toBeNull();
});
it("shows setup guidance and blocks generation when workflow is unavailable", async () => {
  vi.spyOn(historyApi, "load").mockResolvedValue({ ...history([]), configured: false });
  render(view());
  await screen.findByText(/History generation is not configured/);
  expect(screen.getByRole("button", { name: "Generate work periods from history" })).toHaveProperty(
    "disabled",
    true,
  );
});
it("does not overlap polling reads and aborts the pending read on close", async () => {
  vi.useFakeTimers();
  let resolve!: (value: HistoryState) => void;
  const load = vi.spyOn(historyApi, "load").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { unmount } = render(view());
  await act(async () => {
    vi.advanceTimersByTime(10000);
  });
  expect(load).toHaveBeenCalledOnce();
  await act(async () => resolve(history([])));
  await act(async () => {
    vi.advanceTimersByTime(5000);
  });
  expect(load).toHaveBeenCalledTimes(2);
  const signal = load.mock.calls[1]![1];
  unmount();
  expect(signal.aborted).toBe(true);
});
it("prevents an older manual refresh from replacing a newer response", async () => {
  let finishOlder!: (value: HistoryState) => void;
  const load = vi.spyOn(historyApi, "load").mockResolvedValue(history([]));
  render(view());
  await screen.findByText(
    "No proposals yet. Import sources, choose a range, then generate proposals.",
  );
  load.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finishOlder = done;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Refresh proposals" }));
  load.mockResolvedValue(history());
  fireEvent.click(screen.getByRole("button", { name: "Refresh proposals" }));
  await screen.findByText("Proposed work period");
  await act(async () => finishOlder(history([])));
  expect(screen.getByText("Proposed work period")).toBeTruthy();
});

it.each([
  "No imported evidence exists in this range. Sync sources first.",
  "History range has pending or failed imports. Sync this range before generating or accepting proposals.",
  "A history workflow is already pending or running.",
])("shows the generation prerequisite: %s", async (message) => {
  vi.spyOn(historyApi, "load").mockResolvedValue(history([]));
  vi.spyOn(api, "POST").mockResolvedValue({
    error: { error: "conflict", message },
    response: new Response(null, { status: 409 }),
  } as Awaited<ReturnType<typeof api.POST>>);
  render(view());
  await screen.findByText(
    "No proposals yet. Import sources, choose a range, then generate proposals.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Generate work periods from history" }));
  await screen.findByText(message);
  expect(screen.queryByText(/This proposal changed or overlaps/)).toBeNull();
});
it.each([
  ["not-configured", /JEV settings are missing/],
  ["history-too-large", /Select a shorter range/],
] as const)("explains workflow failure %s", async (error, message) => {
  vi.spyOn(historyApi, "load").mockResolvedValue({
    ...history([]),
    jobs: [
      {
        id: "failed-job",
        sessionId: session.id,
        startAt: session.startedAt,
        endAt: session.endedAt!,
        createdAt: session.startedAt,
        finishedAt: session.endedAt!,
        status: "failed",
        error,
        sourceCount: 10,
        proposalCount: 0,
      },
    ],
  });
  render(view());
  await screen.findByText(message);
});
it("keeps acceptance conflict messaging specific to the proposal", async () => {
  vi.spyOn(api, "POST").mockResolvedValue({
    error: { error: "conflict", message: "History proposal revision changed." },
    response: new Response(null, { status: 409 }),
  } as Awaited<ReturnType<typeof api.POST>>);
  await expect(
    historyApi.accept(proposal.id, {
      expectedRevision: 3,
      caseId: null,
      startedAt: proposal.startedAt,
      endedAt: proposal.endedAt,
      label: proposal.label,
      durationMs: 1000,
    }),
  ).rejects.toThrow("This proposal changed or overlaps an existing period. Your edits are kept.");
});
