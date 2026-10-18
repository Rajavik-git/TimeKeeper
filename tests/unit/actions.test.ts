import { expect, it, vi } from "vitest";
import { performAction } from "../../src/frontend/api/actions";

it("preserves a successful write result when its refresh fails", async () => {
  const notify = vi.fn();
  const result = await performAction(
    Promise.resolve({ data: { id: "saved" } }),
    async () => {
      throw Error("offline");
    },
    notify,
  );
  expect(result).toEqual({ id: "saved" });
  expect(notify).toHaveBeenCalledWith(expect.stringContaining("Saved."));
});
it("reports a rejected write without running its refresh", async () => {
  const refresh = vi.fn();
  const notify = vi.fn();
  expect(
    await performAction(
      Promise.resolve({
        error: { error: "invalid-request", message: "choose a case before saving" },
      }),
      refresh,
      notify,
    ),
  ).toBeUndefined();
  expect(refresh).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith("Choose a case before saving.");
});

it("does not expose arbitrary server or transport errors", async () => {
  for (const request of [
    () => Promise.resolve({ error: { error: "internal", message: "private database details" } }),
    () => Promise.reject(Error("private transport details")),
  ]) {
    const refresh = vi.fn();
    const notify = vi.fn();
    expect(await performAction(request(), refresh, notify)).toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      "Could not complete this action. Check that TimeKeeper is available, then try again.",
    );
  }
});

it("rejects a deferred application error envelope without claiming a successful save", async () => {
  const refresh = vi.fn();
  const notify = vi.fn();
  const result = await performAction(
    Promise.resolve({
      data: { error: "pending", message: "global hourly rate is not configured" },
      response: { status: 202 } as Response,
    }),
    refresh,
    notify,
  );
  expect(result).toBeUndefined();
  expect(refresh).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith("Global hourly rate is not configured.");
});

it("refreshes a stale record and requires review without replaying the write", async () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  const notify = vi.fn();
  const result = await performAction(
    Promise.resolve({ error: { error: "stale revision" }, response: { status: 409 } as Response }),
    refresh,
    notify,
  );
  expect(result).toBeUndefined();
  expect(refresh).toHaveBeenCalledOnce();
  expect(notify).toHaveBeenCalledWith(
    "This record changed. Review the latest data before saving again.",
  );
});
