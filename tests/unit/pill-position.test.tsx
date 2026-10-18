// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  return {
    invoke: vi.fn(),
    onMoved: vi.fn().mockResolvedValue(() => {}),
    setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
import { usePillPosition } from "../../src/frontend/features/desk/hooks/usePillPosition";
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("sends integer native anchors and preserves the native above placement", async () => {
  localStorage.setItem("timekeeper:pill-position", JSON.stringify({ x: 600.5, y: 400.5 }));
  native.invoke.mockResolvedValue({
    anchorX: 601,
    anchorY: 401,
    above: true,
    width: 361,
    height: 240,
    barHeight: 38,
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const setError = vi.fn();
  const { result } = renderHook(() =>
    usePillPosition({
      alwaysOnTop: true,
      expanded: true,
      recent: null,
      notification: false,
      error: "",
      setError,
    }),
  );
  await waitFor(() =>
    expect(native.invoke).toHaveBeenCalledWith(
      "set_pill_expanded",
      expect.objectContaining({ anchorX: 601, anchorY: 401, expanded: true }),
    ),
  );
  await waitFor(() => expect(result.current.above).toBe(true));
  expect(native.setAlwaysOnTop).toHaveBeenCalledWith(true);
  expect(setError).not.toHaveBeenCalled();
});

it("ignores an older native resize reply after a newer expansion", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  type Placement = {
    anchorX: number;
    anchorY: number;
    above: boolean;
    width: number;
    height: number;
    barHeight: number;
  };
  let finishFirst!: (value: Placement) => void;
  let finishSecond!: (value: Placement) => void;
  native.invoke.mockClear();
  native.invoke
    .mockImplementationOnce(
      () =>
        new Promise<Placement>((resolve) => {
          finishFirst = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<Placement>((resolve) => {
          finishSecond = resolve;
        }),
    );
  const setError = vi.fn();
  const { result, rerender } = renderHook(
    ({ expanded }) =>
      usePillPosition({
        expanded,
        alwaysOnTop: true,
        recent: null,
        notification: false,
        error: "",
        setError,
      }),
    { initialProps: { expanded: false } },
  );
  await waitFor(() => expect(native.invoke).toHaveBeenCalledTimes(1));
  rerender({ expanded: true });
  await waitFor(() => expect(native.invoke).toHaveBeenCalledTimes(2));
  const latest = {
    anchorX: 600,
    anchorY: 400,
    above: true,
    width: 360,
    height: 240,
    barHeight: 38,
  };
  await act(async () => {
    finishSecond(latest);
  });
  expect(result.current.above).toBe(true);
  await act(async () => {
    finishFirst({ ...latest, above: false });
  });
  expect(result.current.above).toBe(true);
});
