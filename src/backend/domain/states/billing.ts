import { stateValues, type StateValue } from "./values.js";

export const ExpenseType = {
  Expense: "expense",
  Disbursement: "disbursement",
} as const;
export type ExpenseType = StateValue<typeof ExpenseType>;
export const expenseTypes = stateValues(ExpenseType);

export const InvoiceType = {
  Deposit: "deposit",
  Final: "final",
} as const;
export type InvoiceType = StateValue<typeof InvoiceType>;
export const invoiceTypes = stateValues(InvoiceType);

export const InvoiceStatus = {
  Sent: "sent",
  Issued: "issued",
} as const;
export type InvoiceStatus = StateValue<typeof InvoiceStatus>;
export const invoiceStatuses = stateValues(InvoiceStatus);

export const InvoiceLineOrigin = {
  WorkPeriod: "work_period",
  FlatFee: "flat_fee",
  Expense: "expense",
} as const;
export type InvoiceLineOrigin = StateValue<typeof InvoiceLineOrigin>;
export const invoiceLineOrigins = stateValues(InvoiceLineOrigin);

export const RateOrigin = {
  Base: "base",
  Client: "client",
  Case: "matter",
  FlatFee: "flat_fee",
} as const;
export type RateOrigin = StateValue<typeof RateOrigin>;
export const rateOrigins = stateValues(RateOrigin);
