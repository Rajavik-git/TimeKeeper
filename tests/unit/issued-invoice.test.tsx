// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IssuedInvoiceDialog } from "../../src/frontend/features/billing-status/components/IssuedInvoiceDialog/IssuedInvoiceDialog";
import { api, type CoreState } from "../../src/frontend/api/client";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      this.removeAttribute("open");
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const invoice: CoreState["billing"]["invoices"][number] = {
  id: 42,
  caseId: "case",
  number: "F-0042",
  date: "2026-10-17",
  type: "final",
  status: "issued",
  subtotalCents: 10000,
  vatCents: 2000,
  disbursementsCents: 500,
  totalCents: 12500,
  currency: "EUR",
};
it("shows the issued snapshot in its saved currency", () => {
  render(
    <IssuedInvoiceDialog
      invoice={invoice}
      lines={[
        {
          id: 1,
          invoiceId: 42,
          origin: "work_period",
          originId: "period",
          label: "Frozen work",
          billedMinutes: 60,
          rateCents: 10000,
          amountCents: 10000,
          vat: true,
        },
      ]}
      close={vi.fn()}
    />,
  );
  expect(screen.getByRole("dialog", { name: "Issued invoice F-0042" })).toBeTruthy();
  expect(screen.getByText("Frozen work")).toBeTruthy();
  expect(screen.getByText("€125.00")).toBeTruthy();
  expect(screen.queryByText("$125.00")).toBeNull();
});
it("does not assign today's currency to an invoice with missing historical currency", () => {
  render(
    <IssuedInvoiceDialog invoice={{ ...invoice, currency: null }} lines={[]} close={vi.fn()} />,
  );
  expect(screen.getByRole("alert").textContent).toContain("No current currency");
  expect(screen.getByText("125.00 · currency unavailable")).toBeTruthy();
});
it("keeps a failed CSV download inside the issued invoice", async () => {
  vi.spyOn(api, "GET").mockResolvedValue({ error: { error: "unavailable" } } as never);
  render(<IssuedInvoiceDialog invoice={invoice} lines={[]} close={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Download issued CSV" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Could not download this issued invoice. Try again.",
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Download issued CSV" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
});
it("downloads the CSV field returned by the existing API", async () => {
  vi.spyOn(api, "GET").mockResolvedValue({ data: { csv: "number;currency\nF-0042;EUR" } } as never);
  const create = vi.fn().mockReturnValue("blob:issued");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<IssuedInvoiceDialog invoice={invoice} lines={[]} close={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Download issued CSV" }));
  await waitFor(() => expect(create).toHaveBeenCalled());
  expect(vi.mocked(api.GET)).toHaveBeenCalledWith("/api/invoices/{id}/csv", {
    params: { path: { id: 42 } },
  });
});
