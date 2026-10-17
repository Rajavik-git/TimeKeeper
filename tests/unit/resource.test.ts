import { expect, it, vi } from "vitest";
import { Resource } from "../../src/frontend/api/resource";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("aborts an earlier request and ignores its late response", async () => {
  const first = deferred<string>(),
    second = deferred<string>();
  const signals: AbortSignal[] = [];
  const publish = vi.fn();
  const resource = new Resource((signal) => {
    signals.push(signal);
    return signals.length === 1 ? first.promise : second.promise;
  }, publish);
  const oldRequest = resource.refresh();
  const newRequest = resource.refresh();
  expect(signals[0].aborted).toBe(true);
  second.resolve("new");
  await newRequest;
  first.resolve("old");
  await oldRequest;
  expect(resource.state.data).toBe("new");
  expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ data: "old" }));
});
it("preserves the last displayed data after a refresh fails without retrying", async () => {
  const load = vi.fn().mockResolvedValueOnce("saved").mockRejectedValueOnce(Error("offline"));
  const resource = new Resource(load, () => {});
  await resource.refresh();
  await expect(resource.refresh()).rejects.toThrow("offline");
  expect(resource.state).toMatchObject({ data: "saved", isLoading: false });
  expect(resource.state.error?.message).toBe("offline");
  expect(load).toHaveBeenCalledTimes(2);
});
it("prevents requests from publishing after their view is disposed", async () => {
  const pending = deferred<string>();
  const publish = vi.fn();
  const resource = new Resource(() => pending.promise, publish);
  const request = resource.refresh();
  publish.mockClear();
  resource.dispose();
  pending.resolve("too late");
  await request;
  expect(publish).not.toHaveBeenCalled();
});

it("allows a slow request to complete across polling ticks and resumes polling afterward", async () => {
  vi.useFakeTimers();
  const pending = deferred<string>();
  const signals: AbortSignal[] = [];
  const load = vi.fn((signal: AbortSignal) => {
    signals.push(signal);
    return signals.length === 1 ? pending.promise : Promise.resolve("next poll");
  });
  const resource = new Resource(load, () => {});
  const first = resource.refresh();
  const timer = setInterval(() => void resource.poll(), 5000);
  try {
    await vi.advanceTimersByTimeAsync(15000);
    expect(load).toHaveBeenCalledTimes(1);
    expect(signals[0].aborted).toBe(false);
    pending.resolve("slow response");
    await first;
    expect(resource.state.data).toBe("slow response");
    await vi.advanceTimersByTimeAsync(5000);
    expect(load).toHaveBeenCalledTimes(2);
    expect(resource.state.data).toBe("next poll");
  } finally {
    clearInterval(timer);
    resource.dispose();
    vi.useRealTimers();
  }
});
