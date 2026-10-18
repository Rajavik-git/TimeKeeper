import { AppError } from "./errors.js";
import type { CommandInbox } from "../ports/command-inbox.js";

/** One inbox command that could not be applied, as returned by GET /api/inbox/failed (docs/API.md A14). */
export interface FailedCommand {
  file: string;
  kind: "start" | "end" | null;
  sessionId: string | null;
  occurredAt: string | null;
  error: string;
  message: string;
}

const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

/** Failed inbox commands, newest first. A file that is not valid JSON is still listed, with null command fields. */
export function listFailedCommands(inbox: CommandInbox): FailedCommand[] {
  return inbox.listFailed().map((f) => {
    let command: Record<string, unknown> = {};
    try {
      const value = JSON.parse(f.content) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value))
        command = value as Record<string, unknown>;
    } catch {
      /* Listed with null fields. */
    }
    return {
      file: f.name,
      kind: command.kind === "start" || command.kind === "end" ? command.kind : null,
      sessionId: text(command.sessionId),
      occurredAt: text(command.occurredAt),
      error: f.error?.error ?? "internal",
      message: f.error?.message ?? "error details are missing",
    };
  });
}

/** A failed file name is a single `<name>.json`: no folders, no `..`, and never the error file beside it. */
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.json$/;

/** Hides a failed command once the lawyer has dealt with it. Idempotent; unknown files are not found. */
export function dismissFailedCommand(
  inbox: CommandInbox,
  file: string,
): { status: "dismissed"; file: string } {
  if (!FILE.test(file) || file.includes("..") || file.endsWith(".error.json"))
    throw new AppError("invalid-request", "invalid inbox file name");
  if (!inbox.dismissFailed(file)) throw new AppError("not-found", "failed inbox command not found");
  return { status: "dismissed", file };
}
