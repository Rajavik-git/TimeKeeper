// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../src/frontend/api/client";
import { ActivityPeek } from "../../src/frontend/features/workday/components/ActivityPeek/ActivityPeek";
import { useScreenpipeFrames } from "../../src/frontend/features/workday/hooks/useScreenpipeFrames";
import {
  frameImageUrl,
  nearestFrame,
  type ScreenpipeFrame,
} from "../../src/frontend/features/workday/lib/screenpipeFrames";
import { frontendFixture } from "./frontend-fixture";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const frame = (frameId: string, recordedAt: string): ScreenpipeFrame => ({
  frameId,
  recordedAt,
  appName: "WINWORD.EXE",
  windowTitle: `Document ${frameId}`,
});
const frames = [
  frame("1", "2026-10-16T10:00:00.000Z"),
  frame("2", "2026-10-16T10:05:00.000Z"),
  frame("3", "2026-10-16T10:10:00.000Z"),
];
const at = (iso: string) => Date.parse(iso);

describe("nearestFrame", () => {
  it("returns null without frames", () => {
    expect(nearestFrame([], at("2026-10-16T10:00:00Z"))).toBeNull();
  });
  it("finds an exact capture and the closest one before or after", () => {
    expect(nearestFrame(frames, at("2026-10-16T10:05:00Z"))?.frameId).toBe("2");
    expect(nearestFrame(frames, at("2026-10-16T10:06:00Z"))?.frameId).toBe("2");
    expect(nearestFrame(frames, at("2026-10-16T10:09:00Z"))?.frameId).toBe("3");
    expect(nearestFrame(frames, at("2026-10-16T09:59:00Z"))?.frameId).toBe("1");
    expect(nearestFrame(frames, at("2026-10-16T10:11:00Z"))?.frameId).toBe("3");
  });
  it("ignores captures beyond the tolerance", () => {
    expect(nearestFrame(frames, at("2026-10-16T10:13:00Z"))).toBeNull();
    expect(nearestFrame(frames, at("2026-10-16T09:57:30Z"), 60_000)).toBeNull();
  });
});

it("builds image URLs on the TimeKeeper API, never on Screenpipe", () => {
  expect(frameImageUrl("42")).toBe("/api/screenpipe/frames/42/image");
});

describe("useScreenpipeFrames", () => {
  const period = {
    id: "p1",
    startedAt: "2026-10-16T10:00:00.000Z",
    endedAt: "2026-10-16T11:00:00.000Z",
  };

  it("loads a period once and serves it from the cache afterwards", async () => {
    const get = vi.spyOn(api, "GET").mockResolvedValue({ data: { status: "ok", frames } } as never);
    const { result, rerender } = renderHook(({ value }) => useScreenpipeFrames(value), {
      initialProps: { value: period as typeof period | undefined },
    });
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(get).toHaveBeenCalledWith(
      "/api/screenpipe/frames",
      expect.objectContaining({
        params: { query: { start: period.startedAt, end: period.endedAt, limit: 200 } },
      }),
    );
    rerender({ value: undefined });
    expect(result.current.status).toBe("idle");
    rerender({ value: { ...period } });
    expect(result.current).toEqual({ status: "ok", frames });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("aborts a pending read when the preview moves to another period", async () => {
    const signals: AbortSignal[] = [];
    vi.spyOn(api, "GET").mockImplementation(((_path: string, init: { signal: AbortSignal }) => {
      signals.push(init.signal);
      return new Promise(() => undefined);
    }) as never);
    const { rerender } = renderHook(({ value }) => useScreenpipeFrames(value), {
      initialProps: { value: period },
    });
    rerender({ value: { ...period, id: "p2" } });
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it("retries a failed read on the next preview", async () => {
    const get = vi
      .spyOn(api, "GET")
      .mockResolvedValue({ data: { status: "unavailable", message: "down" } } as never);
    const { result, rerender } = renderHook(({ value }) => useScreenpipeFrames(value), {
      initialProps: { value: period as typeof period | undefined },
    });
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    rerender({ value: undefined });
    rerender({ value: period });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
});

describe("ActivityPeek", () => {
  const { core } = frontendFixture();
  const period = {
    ...core.periods[0],
    startedAt: "2026-10-16T10:00:00.000Z",
    endedAt: "2026-10-16T10:10:00.000Z",
  };
  const peek = (props: Partial<Parameters<typeof ActivityPeek>[0]>) => (
    <ActivityPeek
      period={period}
      sources={[]}
      frames={{ status: "ok", frames }}
      fraction={0.5}
      x={0}
      y={0}
      {...props}
    />
  );

  it("shows the capture nearest the hovered instant", () => {
    render(peek({}));
    const image = screen.getByRole("img", { hidden: true }) as HTMLImageElement;
    expect(image.getAttribute("src")).toBe("/api/screenpipe/frames/2/image");
    expect(image.getAttribute("width")).toBe("318");
    expect(screen.getByText(/Document 2/)).toBeTruthy();
  });

  it("waits for the pointer to rest before switching captures", () => {
    vi.useFakeTimers();
    const { rerender } = render(peek({ fraction: 0 }));
    rerender(peek({ fraction: 1 }));
    expect(screen.getByRole("img", { hidden: true }).getAttribute("src")).toContain("/1/");
    act(() => vi.advanceTimersByTime(150));
    expect(screen.getByRole("img", { hidden: true }).getAttribute("src")).toContain("/3/");
  });

  it("keeps the stored evidence and says so when no capture is near", () => {
    render(peek({ frames: { status: "ok", frames: [] } }));
    expect(screen.queryByRole("img", { hidden: true })).toBeNull();
    expect(screen.getByText("No Screenpipe capture at this time")).toBeTruthy();
    expect(screen.getByText("No evidence is linked to this period.")).toBeTruthy();
  });

  it("reports an unreachable Screenpipe without hiding the evidence", () => {
    render(peek({ frames: { status: "unauthorized", message: "Set SCREENPIPE_API_KEY." } }));
    expect(screen.getByText("Screenpipe not connected · Set SCREENPIPE_API_KEY.")).toBeTruthy();
    expect(screen.getByText("No evidence is linked to this period.")).toBeTruthy();
  });

  it("falls back to the stored evidence when the image cannot load", () => {
    render(peek({}));
    act(() => {
      screen.getByRole("img", { hidden: true }).dispatchEvent(new Event("error"));
    });
    expect(screen.queryByRole("img", { hidden: true })).toBeNull();
    expect(screen.getByText("No evidence is linked to this period.")).toBeTruthy();
  });
});
