// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../../src/frontend/App";
import { api } from "../../src/frontend/api/client";
import { frontendFixture } from "./frontend-fixture";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("loads Settings independently when the workspace snapshot is unavailable", async () => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  const { state } = frontendFixture();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(api, "GET").mockImplementation((async (path: string) => {
    if (path === "/api/catalog") return { data: state };
    if (path === "/api/sessions/active") return { data: null };
    return { error: { error: "unavailable" } };
  }) as never);
  render(<App />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Settings", exact: true }));
  expect(await screen.findByRole("heading", { name: "Settings", exact: true })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Add client", exact: true })).toBeTruthy();
  expect(screen.queryByText("Could not load local data.")).toBeNull();
  expect(vi.mocked(api.GET).mock.calls.some(([path]) => path === "/api/audit-events")).toBe(false);
  expect(
    vi.mocked(api.GET).mock.calls.some(([path]) => path === "/api/reconstruction-conflicts"),
  ).toBe(false);
});

it("loads My day from scoped snapshots without requesting full history", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const { state, core } = frontendFixture();
  const fullHistory = vi.fn();
  vi.spyOn(api, "GET").mockImplementation((async (
    path: string,
    options?: { params?: { query?: { date?: string; from?: string } } },
  ) => {
    if (path === "/api/catalog") return { data: state };
    if (path === "/api/sessions/active") return { data: null };
    if (path === "/api/workspace" && (options?.params?.query?.date || options?.params?.query?.from))
      return { data: { catalogState: state, workspaceState: core } };
    if (path === "/api/workspace") fullHistory();
    return { error: { error: "unavailable" } };
  }) as never);
  render(<App />);
  expect(await screen.findByText(core.periods[0].label)).toBeTruthy();
  expect(fullHistory).not.toHaveBeenCalled();
  expect(screen.queryByText("Could not load local data.")).toBeNull();
});

it("retries the scoped initial My day reads after both fail", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const { state, core } = frontendFixture();
  let available = false;
  const fullHistory = vi.fn();
  vi.spyOn(api, "GET").mockImplementation((async (
    path: string,
    options?: { params?: { query?: { date?: string; from?: string } } },
  ) => {
    if (!available) return { error: { error: "unavailable" } };
    if (path === "/api/catalog") return { data: state };
    if (path === "/api/sessions/active") return { data: null };
    if (path === "/api/workspace" && (options?.params?.query?.date || options?.params?.query?.from))
      return { data: { catalogState: state, workspaceState: core } };
    if (path === "/api/workspace") fullHistory();
    return { error: { error: "unavailable" } };
  }) as never);
  render(<App />);
  expect((await screen.findByRole("alert")).textContent).toContain("Could not load local data.");
  available = true;
  await userEvent.setup().click(screen.getByRole("button", { name: "Retry", exact: true }));
  expect(await screen.findByText(core.periods[0].label)).toBeTruthy();
  expect(fullHistory).not.toHaveBeenCalled();
});
