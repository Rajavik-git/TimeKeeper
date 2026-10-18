import {
  ExpenseType,
  InvoiceStatus,
  InvoiceType,
  RateOrigin,
} from "../../../contracts/states.generated";

export const rateOriginLabels = {
  [RateOrigin.Base]: "Base rate",
  [RateOrigin.Client]: "Client rate",
  [RateOrigin.Case]: "Case rate",
  [RateOrigin.FlatFee]: "Flat fee",
} as const satisfies Record<RateOrigin, string>;

export const expenseTypeLabels = {
  [ExpenseType.Expense]: "Expense",
  [ExpenseType.Disbursement]: "Disbursement",
} as const satisfies Record<ExpenseType, string>;

export const invoiceTypeLabels = {
  [InvoiceType.Deposit]: "Deposit invoice",
  [InvoiceType.Final]: "Final invoice",
} as const satisfies Record<InvoiceType, string>;

export const invoiceStatusLabels = {
  [InvoiceStatus.Issued]: "Issued",
  [InvoiceStatus.Sent]: "Sent",
} as const satisfies Record<InvoiceStatus, string>;
