// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../src/frontend/api/client";
import { PreInvoices } from "../../src/frontend/features/billing-status/PreInvoices";
import { frontendFixture } from "./frontend-fixture";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("keeps a pending cost form open and blocks invoice creation until its write completes", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const { state, core } = frontendFixture();
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const post = vi.spyOn(api, "POST").mockImplementation((() => pending) as never);
  const user = userEvent.setup();
  render(
    <PreInvoices
      catalogState={state}
      workspaceState={core}
      selectedCase="case"
      action={async (request) => (await request).data}
      navigate={vi.fn()}
      openPeriodActivity={vi.fn()}
      refresh={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Add a cost" }));
  await user.type(screen.getByRole("textbox", { name: "Cost description" }), "Court fee");
  await user.type(screen.getByRole("spinbutton", { name: "Amount in USD" }), "12");
  await user.click(screen.getByRole("button", { name: "Add", exact: true }));
  expect(screen.getByRole("button", { name: "Add a cost" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: /Create invoice INV-/ })).toHaveProperty(
    "disabled",
    true,
  );
  await user.click(screen.getByRole("button", { name: "Add a cost" }));
  expect(screen.getByRole("textbox", { name: "Cost description" })).toHaveProperty(
    "value",
    "Court fee",
  );
  expect(post).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish({ data: { id: 1 } });
  });
  expect(screen.queryByRole("textbox", { name: "Cost description" })).toBeNull();
  expect(post).toHaveBeenCalledTimes(1);
});
