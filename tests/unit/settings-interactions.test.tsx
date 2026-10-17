// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { api, type ScreenProps } from "../../src/frontend/api/client";
import { Settings } from "../../src/frontend/features/settings/Settings";
import { frontendFixture } from "./frontend-fixture";

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

it("closes forms on section changes and isolates client and task drafts", async () => {
  const user = userEvent.setup();
  render(<Settings {...props()} />);
  await user.click(screen.getByRole("button", { name: "Add client", exact: true }));
  await user.type(screen.getByRole("textbox", { name: "Client name" }), "Unsaved client");
  await user.type(screen.getByRole("textbox", { name: "Client code" }), "CLIENT");
  await user.click(screen.getByRole("button", { name: "Tasks", exact: true }));
  expect(screen.queryByRole("textbox", { name: "Task label" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Add task", exact: true }));
  expect(screen.getByRole("textbox", { name: "Task label" })).toHaveProperty("value", "");
  expect(screen.getByRole("textbox", { name: "Task code" })).toHaveProperty("value", "");
  await user.type(screen.getByRole("textbox", { name: "Task label" }), "Unsaved task");
  await user.type(screen.getByRole("textbox", { name: "Task code" }), "TASK");
  await user.click(screen.getByRole("button", { name: "Clients", exact: true }));
  expect(screen.queryByRole("textbox", { name: "Client name" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Add client", exact: true }));
  expect(screen.getByRole("textbox", { name: "Client name" })).toHaveProperty("value", "");
  expect(screen.getByRole("textbox", { name: "Client code" })).toHaveProperty("value", "");
});

it("does not carry client amount errors into another section or a new form", async () => {
  const user = userEvent.setup();
  const post = vi.spyOn(api, "POST");
  render(<Settings {...props()} />);
  await user.click(screen.getByRole("button", { name: "Add client", exact: true }));
  const name = screen.getByRole("textbox", { name: "Client name" });
  fireEvent.submit(name.closest("form")!);
  expect(screen.getByRole("alert").textContent).toContain("Enter a non-negative amount");
  expect(post).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Tasks", exact: true }));
  await user.click(screen.getByRole("button", { name: "Add task", exact: true }));
  expect(screen.queryByRole("alert")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Clients", exact: true }));
  await user.click(screen.getByRole("button", { name: "Add client", exact: true }));
  expect(screen.queryByRole("alert")).toBeNull();
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
    name: kind === "client" ? "Client code" : "Task code",
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
  expect(screen.getByRole("textbox", { name: "Sales tax on fees" })).toHaveProperty(
    "value",
    "None",
  );
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
