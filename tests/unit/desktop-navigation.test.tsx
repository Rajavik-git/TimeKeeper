// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ listen: native.listen }),
}));
import { useDesktopNavigation } from "../../src/frontend/shared/hooks/useDesktopNavigation";
function Harness({ open }: { open: () => void }) {
  useDesktopNavigation(open);
  return null;
}
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  native.listen.mockReset();
});
it("receives targeted navigation with the current callback and removes the listener", async () => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  let receive!: () => void;
  const unlisten = vi.fn();
  native.listen.mockImplementation(async (_event: string, callback: () => void) => {
    receive = callback;
    return unlisten;
  });
  const previous = vi.fn(),
    current = vi.fn();
  const view = render(<Harness open={previous} />);
  await waitFor(() => expect(native.listen).toHaveBeenCalled());
  view.rerender(<Harness open={current} />);
  receive();
  expect(current).toHaveBeenCalledOnce();
  expect(previous).not.toHaveBeenCalled();
  expect(native.listen.mock.calls[0][0]).toBe("timekeeper:open-my-day");
  view.unmount();
  await waitFor(() => expect(unlisten).toHaveBeenCalledOnce());
});
it("does not register native listeners in the browser", () => {
  render(<Harness open={vi.fn()} />);
  expect(native.listen).not.toHaveBeenCalled();
});
