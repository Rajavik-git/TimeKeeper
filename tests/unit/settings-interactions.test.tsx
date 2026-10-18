// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type ScreenProps } from "../../src/frontend/api/client";
import { Settings } from "../../src/frontend/features/settings/Settings";
import { frontendFixture } from "./frontend-fixture";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function props(): ScreenProps {
  const { state, core } = frontendFixture();
  return {
    catalogState: state,
    workspaceState: core,
    action: async (request) => (await request).data,
    refresh: vi.fn(),
    navigate: vi.fn(),
    openPeriodActivity: vi.fn(),
  };
}

it("requires an explicit discard decision before closing a client draft", async () => {
  const user = userEvent.setup();
  render(<Settings {...props()} />);
  await user.click(screen.getByRole("button", { name: "Add client", exact: true }));
  await user.type(screen.getByRole("textbox", { name: "Client name" }), "Unsaved client");
  await user.click(screen.getByRole("button", { name: "Cancel", exact: true }));
  expect(screen.getByText("Discard unsaved changes?")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByRole("textbox", { name: "Client name" })).toHaveProperty(
    "value",
    "Unsaved client",
  );
  await user.click(screen.getByRole("button", { name: "Cancel", exact: true }));
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  await user.click(screen.getByRole("button", { name: "Tasks", exact: true }));
  await user.click(screen.getByRole("button", { name: "Add task", exact: true }));
  expect(screen.getByRole("textbox", { name: "Task label" })).toHaveProperty("value", "");
});

it("retains invalid rate edits and their errors when changing sections", async () => {
  const user = userEvent.setup();
  render(<Settings {...props()} />);
  await user.click(screen.getByRole("button", { name: "Rates", exact: true }));
  const rate = screen.getByRole("textbox", { name: "Hourly rate" });
  await user.clear(rate);
  await user.type(rate, "invalid");
  fireEvent.blur(rate);
  expect(screen.getByRole("alert").textContent).toContain("non-negative");
  await user.click(screen.getByRole("button", { name: "Tasks", exact: true }));
  await user.click(screen.getByRole("button", { name: "Rates", exact: true }));
  expect(screen.getByRole("textbox", { name: "Hourly rate" })).toHaveProperty("value", "invalid");
  expect(screen.getByRole("alert").textContent).toContain("non-negative");
});

it.each(["client", "task"] as const)("preserves the %s draft when saving fails", async (kind) => {
  const user = userEvent.setup();
  const post = vi.spyOn(api, "POST").mockResolvedValue({ error: { message: "Rejected" } } as never);
  render(<Settings {...props()} />);
  if (kind === "task") await user.click(screen.getByRole("button", { name: "Tasks", exact: true }));
  await user.click(
    screen.getByRole("button", {
      name: kind === "client" ? "Add client" : "Add task",
      exact: true,
    }),
  );
  const name = screen.getByRole("textbox", {
    name: kind === "client" ? "Client name" : "Task label",
  });
  const code = screen.getByRole("textbox", {
    name: kind === "client" ? /Client code/ : "Task code",
  });
  await user.type(name, "Keep this draft");
  await user.type(code, "KEEP");
  if (kind === "client") await user.type(screen.getByRole("textbox", { name: "Rate USD/h" }), "0");
  fireEvent.submit(name.closest("form")!);
  await waitFor(() => expect(post).toHaveBeenCalledOnce());
  expect(name).toHaveProperty("value", "Keep this draft");
  expect(code).toHaveProperty("value", "KEEP");
  expect(screen.queryByRole("status")).toBeNull();
});

it("remembers each table sort when its section is reopened", async () => {
  const user = userEvent.setup();
  render(<Settings {...props()} />);
  await user.click(screen.getByRole("button", { name: /^Name/ }));
  const sort = screen.getByRole("columnheader", { name: /^Name/ }).getAttribute("aria-sort");
  await user.click(screen.getByRole("button", { name: "Tasks", exact: true }));
  await user.click(screen.getByRole("button", { name: /^Task$/ }));
  await user.click(screen.getByRole("button", { name: "Clients", exact: true }));
  expect(screen.getByRole("columnheader", { name: /^Name/ }).getAttribute("aria-sort")).toBe(sort);
});

it("keeps unsupported capture controls inactive and uses distinct keys for equal field values", async () => {
  const user = userEvent.setup();
  const input = props();
  input.catalogState.settings.globalHourlyRateCents = 0;
  input.catalogState.settings.vatRate = 0;
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const patch = vi.spyOn(api, "PATCH");
  render(<Settings {...input} />);
  await user.click(screen.getByRole("button", { name: "Capture and invoices" }));
  expect(screen.getByText(/TimeKeeper cannot enforce/)).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Never capture" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("textbox", { name: "Keep captures for" })).toHaveProperty(
    "disabled",
    true,
  );
  await user.click(screen.getByRole("button", { name: "Rates", exact: true }));
  expect(screen.getByRole("textbox", { name: "Hourly rate" })).toHaveProperty("value", "0.00");
  expect(screen.getByRole("textbox", { name: "VAT on fees (%)" })).toHaveProperty("value", "None");
  expect(errors.mock.calls.flat().join(" ")).not.toContain("same key");
  expect(patch).not.toHaveBeenCalled();
});

it("creates a research cap using the entered limit instead of the fixed default", async () => {
  const user = userEvent.setup();
  const post = vi.spyOn(api, "POST").mockResolvedValue({ data: {} } as never);
  render(<Settings {...props()} />);
  await user.click(screen.getByRole("button", { name: "Client rules", exact: true }));
  await user.click(screen.getByRole("button", { name: "Add rule", exact: true }));
  const limit = screen.getByRole("spinbutton", { name: "Research minutes per day" });
  await user.clear(limit);
  await user.type(limit, "60");
  await user.click(screen.getAllByRole("button", { name: "Add rule", exact: true }).at(-1)!);
  expect(post).toHaveBeenCalledWith(
    "/api/catalog/client-rules",
    expect.objectContaining({
      body: { clientId: "client", type: "daily_research_cap", value: 10 },
    }),
  );
});

it("keeps client categories and billing labels distinct from stored values", async () => {
  const user = userEvent.setup();
  const input = props();
  input.catalogState.clients.push({
    ...input.catalogState.clients[0],
    id: "company",
    name: "Example company",
    type: "company",
    mode: "subscription",
  });
  render(<Settings {...input} />);
  expect(screen.getByText("Individual")).toBeTruthy();
  expect(screen.getByText("Company")).toBeTruthy();
  expect(screen.getByText("Subscription")).toBeTruthy();
  expect(screen.getByRole("cell", { name: "Hourly" })).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "VAT" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Edit Example company" }));
  expect(screen.getByRole("option", { name: "Subscription" })).toHaveProperty(
    "value",
    "subscription",
  );
});

it("keeps a failed configured rate and a local retry message across sections", async () => {
  const user = userEvent.setup();
  vi.spyOn(api, "PATCH").mockResolvedValue({ error: { message: "Unavailable" } } as never);
  render(<Settings {...props()} />);
  await user.click(screen.getByRole("button", { name: "Rates", exact: true }));
  const rate = screen.getByRole("textbox", { name: "Hourly rate" });
  await user.clear(rate);
  await user.type(rate, "90");
  fireEvent.blur(rate);
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Press Enter to retry"),
  );
  await user.click(screen.getByRole("button", { name: "Tasks", exact: true }));
  await user.click(screen.getByRole("button", { name: "Rates", exact: true }));
  expect(screen.getByRole("textbox", { name: "Hourly rate" })).toHaveProperty("value", "90");
  expect(screen.getByRole("alert").textContent).toContain("Press Enter to retry");
});
