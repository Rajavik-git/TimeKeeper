import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../src/frontend/api/client", () => ({ api: { POST: vi.fn() } }));
import { api } from "../../src/frontend/api/client";
import { validatePeriods, validationMessage } from "../../src/frontend/api/validatePeriods";

beforeEach(() => vi.resetAllMocks());
it("refreshes a committed validation when the next request rejects", async () => {
  vi.mocked(api.POST)
    .mockResolvedValueOnce({ data: {} } as never)
    .mockRejectedValueOnce(Error("offline"));
  const refresh = vi.fn().mockResolvedValue(undefined);
  expect(
    await validatePeriods(
      ["first", "second", "third"].map((id) => ({ id, effectiveRevision: 7 })),
      refresh,
    ),
  ).toEqual({
    successful: 1,
    refreshFailed: false,
    stale: false,
  });
  expect(refresh).toHaveBeenCalledOnce();
  expect(api.POST).toHaveBeenCalledTimes(2);
});
it("keeps committed progress when refresh fails and reports recovery", async () => {
  vi.mocked(api.POST).mockResolvedValueOnce({ data: {} } as never);
  const result = await validatePeriods(
    [{ id: "first", effectiveRevision: 7 }],
    vi.fn().mockRejectedValue(Error("offline")),
  );
  expect(result).toEqual({ successful: 1, refreshFailed: true, stale: false });
  expect(validationMessage(result.successful, 1, result.refreshFailed)).toContain(
    "1 period validated",
  );
  expect(validationMessage(result.successful, 1, result.refreshFailed)).toContain(
    "Refresh the view",
  );
});
it("does not count a rejected application write as committed", async () => {
  vi.mocked(api.POST).mockResolvedValueOnce({ error: {} } as never);
  const refresh = vi.fn();
  expect(await validatePeriods([{ id: "first", effectiveRevision: 7 }], refresh)).toEqual({
    successful: 0,
    refreshFailed: false,
    stale: false,
  });
  expect(refresh).not.toHaveBeenCalled();
});

it("stops on a stale revision and refreshes before asking for review", async () => {
  vi.mocked(api.POST).mockResolvedValue({
    error: { error: "conflict" },
    response: { status: 409 },
  } as never);
  const refresh = vi.fn().mockResolvedValue(undefined);
  const result = await validatePeriods(
    [
      { id: "first", effectiveRevision: 7 },
      { id: "second", effectiveRevision: 8 },
    ],
    refresh,
  );
  expect(api.POST).toHaveBeenCalledOnce();
  expect(api.POST).toHaveBeenCalledWith("/api/work-periods/{id}/validate-time", {
    params: { path: { id: "first" } },
    body: { expectedEffectiveRevision: 7 },
  });
  expect(result).toEqual({ successful: 0, refreshFailed: false, stale: true });
  expect(refresh).toHaveBeenCalledOnce();
  expect(validationMessage(0, 2, false, true)).toContain("Review the latest data");
});
