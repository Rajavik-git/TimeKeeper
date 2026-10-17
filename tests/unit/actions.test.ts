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
      Promise.resolve({ error: { error: "Assignment revision changed" } }),
      refresh,
      notify,
    ),
  ).toBeUndefined();
  expect(refresh).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith(expect.stringContaining("Assignment revision changed"));
});
