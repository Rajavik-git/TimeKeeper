// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ScreenProps } from "../../src/frontend/api/client";
vi.mock("../../src/frontend/features/workday/MyDay", () => ({
  initialMyDayView: () => ({ selectedDate: "2026-10-17", month: "2026-10" }),
  MyDay: ({ openPeriodReview }: ScreenProps) => (
    <button onClick={() => openPeriodReview?.("period")}>Open first review</button>
  ),
}));
vi.mock("../../src/frontend/features/workday/PeriodActivity", () => ({
  PeriodActivity: ({ openPeriodReview }: ScreenProps) => (
    <button onClick={() => openPeriodReview?.("second")}>Review second period</button>
  ),
}));
import { App } from "../../src/frontend/App";
import { api } from "../../src/frontend/api/client";
import { frontendFixture } from "./frontend-fixture";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("requires a discard or resume decision before another period can replace a hidden draft", async () => {
  const { state, core } = frontendFixture();
  core.periods.push({ ...core.periods[0], id: "second", label: "Second work" });
  vi.spyOn(api, "GET").mockImplementation((async (path: string) => {
    if (path === "/api/workspace") return { data: { catalogState: state, workspaceState: core } };
    if (path === "/api/sessions/active") return { data: null };
    return { data: [] };
  }) as never);
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Open first review" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "Corrected minutes" }), {
    target: { value: "12" },
  });
  await user.click(screen.getByRole("button", { name: "Review sources" }));
  await user.click(screen.getByRole("button", { name: "Review second period" }));
  expect(screen.getByRole("dialog", { name: "Unsaved period corrections" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Resume previous review" }));
  expect(screen.getByRole("spinbutton", { name: "Corrected minutes" })).toHaveProperty(
    "value",
    "12",
  );
  await user.click(screen.getByRole("button", { name: "Review sources" }));
  await user.click(screen.getByRole("button", { name: "Review second period" }));
  await user.click(screen.getByRole("button", { name: "Discard and review selected period" }));
  expect(screen.getByText("Second work")).toBeTruthy();
  expect(screen.getByRole("spinbutton", { name: "Corrected minutes" })).not.toHaveProperty(
    "value",
    "12",
  );
});

it("keeps the day review draft mounted while full activity history is still loading", async () => {
  const { state, core } = frontendFixture();
  let resolveHistory!: (value: unknown) => void;
  const history = new Promise((resolve) => {
    resolveHistory = resolve;
  });
  vi.spyOn(api, "GET").mockImplementation((async (
    path: string,
    options?: { params?: { query?: { date?: string; from?: string } } },
  ) => {
    if (path === "/api/catalog") return { data: state };
    if (path === "/api/workspace") {
      if (options?.params?.query?.date || options?.params?.query?.from)
        return { data: { catalogState: state, workspaceState: core } };
      return history;
    }
    if (path === "/api/sessions/active") return { data: null };
    return { data: [] };
  }) as never);
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Open first review" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "Corrected minutes" }), {
    target: { value: "12" },
  });
  await user.click(screen.getByRole("button", { name: "Review sources" }));
  expect(screen.getByText("Loading local data…")).toBeTruthy();
  await act(async () => {
    resolveHistory({ data: { catalogState: state, workspaceState: core } });
  });
  await user.click(screen.getByRole("button", { name: "My day", exact: true }));
  expect(screen.getByRole("spinbutton", { name: "Corrected minutes" })).toHaveProperty(
    "value",
    "12",
  );
});
