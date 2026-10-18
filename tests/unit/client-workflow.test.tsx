// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type ScreenProps } from "../../src/frontend/api/client";
import { ClientEditorDialog } from "../../src/frontend/features/clients/components/ClientEditorDialog/ClientEditorDialog";
import { NewCaseDialog } from "../../src/frontend/features/cases/components/NewCaseDialog/NewCaseDialog";
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
const action: ScreenProps["action"] = async (promise, notify) => {
  const result = await promise;
  if (result.error) notify?.("Client already exists. Change its name and retry.");
  return result.data;
};

it("creates a company with an address and inherited rate without requiring a code", async () => {
  const user = userEvent.setup();
  const { state } = frontendFixture();
  const post = vi.spyOn(api, "POST").mockResolvedValue({ data: state.clients[0] } as never);
  render(<ClientEditorDialog catalogState={state} action={action} close={vi.fn()} />);
  await user.type(screen.getByRole("textbox", { name: "Client name" }), "Company client");
  await user.selectOptions(screen.getByRole("combobox", { name: "Client type" }), "company");
  await user.type(screen.getByRole("textbox", { name: "Billing address" }), "12 Main Street");
  await user.click(screen.getByRole("button", { name: "Add client" }));
  expect(post).toHaveBeenCalledWith(
    "/api/catalog/clients",
    expect.objectContaining({
      body: expect.objectContaining({
        name: "Company client",
        type: "company",
        billingAddress: "12 Main Street",
        hourlyRateCents: null,
        code: null,
      }),
    }),
  );
});

it.each([
  ["", null],
  ["0", 0],
] as const)("saves client rate %s as %s", async (input, expected) => {
  const user = userEvent.setup();
  const { state } = frontendFixture();
  const client = { ...state.clients[0], hourlyRateCents: 12000 };
  const patch = vi.spyOn(api, "PATCH").mockResolvedValue({ data: client } as never);
  render(
    <ClientEditorDialog catalogState={state} client={client} action={action} close={vi.fn()} />,
  );
  const rate = screen.getByRole("textbox", { name: "Rate USD/h" });
  await user.clear(rate);
  if (input) await user.type(rate, input);
  await user.click(screen.getByRole("button", { name: "Save client" }));
  expect(patch).toHaveBeenCalledWith(
    "/api/catalog/clients/{id}",
    expect.objectContaining({ body: expect.objectContaining({ hourlyRateCents: expected }) }),
  );
});

it("blocks repeated submission and cancellation while pending, then keeps a failed draft and local error", async () => {
  const user = userEvent.setup();
  const { state } = frontendFixture();
  let resolve!: (value: unknown) => void;
  const post = vi.spyOn(api, "POST").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }) as never,
  );
  const close = vi.fn();
  render(<ClientEditorDialog catalogState={state} action={action} close={close} />);
  const name = screen.getByRole("textbox", { name: "Client name" });
  await user.type(name, "Preserved company");
  fireEvent.submit(name.closest("form")!);
  fireEvent.submit(name.closest("form")!);
  expect(post).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", true);
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: true, cancelable: true }));
  expect(close).not.toHaveBeenCalled();
  resolve({ error: { message: "Conflict" } });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("already exists"));
  expect(name).toHaveProperty("value", "Preserved company");
  expect(screen.getByRole("button", { name: "Add client" })).toHaveProperty("disabled", false);
});

it("uses the initiating client, requires explicit overview selection, and does not retain previous context", () => {
  const { state } = frontendFixture();
  state.clients.push({ ...state.clients[0], id: "second", name: "Second client" });
  const props = {
    catalogState: state,
    action,
    close: vi.fn(),
    onCreated: vi.fn(),
    showNotice: vi.fn(),
  };
  const first = render(<NewCaseDialog {...props} initialClientId="second" />);
  expect(screen.getByRole("combobox", { name: "Client" })).toHaveProperty("value", "second");
  first.unmount();
  render(<NewCaseDialog {...props} />);
  expect(screen.getByRole("combobox", { name: "Client" })).toHaveProperty("value", "");
  expect(screen.getByRole("button", { name: "Create" })).toHaveProperty("disabled", true);
});

it("provides first-client creation from the empty case dialog", async () => {
  const user = userEvent.setup();
  const { state } = frontendFixture();
  state.clients = [];
  render(
    <NewCaseDialog
      catalogState={state}
      action={action}
      close={vi.fn()}
      onCreated={vi.fn()}
      showNotice={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Add client" }));
  expect(screen.getByRole("dialog", { name: "Add client" })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Client name" })).toBeTruthy();
});

it("keeps a rejected case title and the actionable error inside its dialog", async () => {
  const user = userEvent.setup();
  const { state } = frontendFixture();
  vi.spyOn(api, "POST").mockResolvedValue({ error: { message: "Conflict" } } as never);
  const notice = vi.fn();
  render(
    <NewCaseDialog
      catalogState={state}
      action={action}
      initialClientId="client"
      close={vi.fn()}
      onCreated={vi.fn()}
      showNotice={notice}
    />,
  );
  await user.type(screen.getByRole("textbox", { name: "Title" }), "Keep case title");
  await user.click(screen.getByRole("button", { name: "Create" }));
  expect(screen.getByRole("alert").closest("dialog")).toBe(screen.getByRole("dialog"));
  expect(screen.getByRole("textbox", { name: "Title" })).toHaveProperty("value", "Keep case title");
  expect(notice).not.toHaveBeenCalled();
});
