import { stateValues, type StateValue } from "./values.js";

export const CommandKind = {
  Start: "start",
  End: "end",
} as const;
export type CommandKind = StateValue<typeof CommandKind>;
export const commandKinds = stateValues(CommandKind);

export const CommandStatus = {
  Pending: "pending",
  Applied: "applied",
  Rejected: "rejected",
} as const;
export type CommandStatus = StateValue<typeof CommandStatus>;
export const commandStatuses = stateValues(CommandStatus);
