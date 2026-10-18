import type { EndCommand, StartCommand } from "../../contracts/index.js";

export interface InboxFile {
  name: string;
  content: string;
}
export interface FailedInboxFile extends InboxFile {
  error: { error: string; message: string } | null;
  failedAt: string;
}
/** Consumes files already delivered to the inbox. It cannot deliver commands to a stopped process. */
export interface CommandInbox {
  list(): InboxFile[];
  markDone(name: string): void;
  markFailed(name: string, error: { error: string; message: string }): void;
  listFailed(): FailedInboxFile[];
  dismissFailed(name: string): boolean;
}
export type InboxCommand = (StartCommand & { kind: "start" }) | (EndCommand & { kind: "end" });

/** Application factories and isolated tests do not touch the filesystem unless an inbox is supplied. */
export const emptyCommandInbox: CommandInbox = {
  list: () => [],
  markDone: () => {},
  markFailed: () => {},
  listFailed: () => [],
  dismissFailed: () => false,
};
