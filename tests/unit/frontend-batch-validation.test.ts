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
  expect(await validatePeriods(["first", "second", "third"], refresh)).toEqual({
    successful: 1,
    refreshFailed: false,
  });
  expect(refresh).toHaveBeenCalledOnce();
  expect(api.POST).toHaveBeenCalledTimes(2);
});
it("keeps committed progress when refresh fails and reports recovery", async () => {
  vi.mocked(api.POST).mockResolvedValueOnce({ data: {} } as never);
  const result = await validatePeriods(["first"], vi.fn().mockRejectedValue(Error("offline")));
  expect(result).toEqual({ successful: 1, refreshFailed: true });
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
  expect(await validatePeriods(["first"], refresh)).toEqual({
    successful: 0,
    refreshFailed: false,
  });
  expect(refresh).not.toHaveBeenCalled();
});
