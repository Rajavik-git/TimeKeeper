import { AppError } from "../application/errors.js";
import { assertId, assertTime } from "../application/assertions.js";
import type { CommandInbox, InboxCommand, InboxFile } from "../ports/command-inbox.js";
import type { CommandOutcome, EndCommand, StartCommand } from "../../contracts/index.js";

export interface CommandService {
  start(command: StartCommand): CommandOutcome;
  end(command: EndCommand): CommandOutcome;
}
export interface InboxSyncResult {
  applied: string[];
  pending: string[];
  failed: string[];
  retry: string[];
}
type Entry = { file: InboxFile; command: InboxCommand };

function parse(file: InboxFile): InboxCommand {
  let value: unknown;
  try {
    value = JSON.parse(file.content);
  } catch {
    throw new AppError("invalid-request", "command file is not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("invalid-request", "command file must hold a JSON object");
  const body = value as Record<string, unknown>;
  if (body.kind !== "start" && body.kind !== "end")
    throw new AppError("invalid-request", "kind must be start or end");
  for (const field of ["producerId", "commandId", "sessionId", "occurredAt"] as const)
    if (typeof body[field] !== "string" || !body[field])
      throw new AppError("invalid-request", `${field} required`);
  for (const field of ["producerId", "commandId", "sessionId"] as const)
    assertId(body[field] as string);
  assertTime(body.occurredAt as string);
  if (body.prerequisiteCommandId !== undefined) {
    if (typeof body.prerequisiteCommandId !== "string")
      throw new AppError("invalid-request", "prerequisiteCommandId must be a string");
    assertId(body.prerequisiteCommandId);
  }
  return {
    kind: body.kind,
    producerId: body.producerId as string,
    commandId: body.commandId as string,
    sessionId: body.sessionId as string,
    occurredAt: body.occurredAt as string,
    ...(body.prerequisiteCommandId === undefined
      ? {}
      : { prerequisiteCommandId: body.prerequisiteCommandId as string }),
  };
}
const identity = (producer: string, command: string) => JSON.stringify([producer, command]);

/** Apply known prerequisites first. Stable timestamps order commands with no known dependency. */
export function syncInbox(inbox: CommandInbox, service: CommandService): InboxSyncResult {
  const result: InboxSyncResult = { applied: [], pending: [], failed: [], retry: [] };
  const commands: Entry[] = [];
  const reject = (file: InboxFile, error: AppError) => {
    try {
      inbox.markFailed(file.name, { error: error.code, message: error.message });
      result.failed.push(file.name);
    } catch {
      result.retry.push(file.name);
    }
  };
  for (const file of inbox.list()) {
    try {
      commands.push({ file, command: parse(file) });
    } catch (error) {
      if (error instanceof AppError) reject(file, error);
      else result.retry.push(file.name);
    }
  }
  commands.sort(
    (a, b) =>
      Date.parse(a.command.occurredAt) - Date.parse(b.command.occurredAt) ||
      a.command.commandId.localeCompare(b.command.commandId) ||
      a.file.name.localeCompare(b.file.name),
  );
  const ordered: Entry[] = [];
  let remaining = commands;
  while (remaining.length) {
    const known = new Set(
      remaining.map(({ command }) => identity(command.producerId, command.commandId)),
    );
    const ready = remaining.filter(
      ({ command }) =>
        !command.prerequisiteCommandId ||
        !known.has(identity(command.producerId, command.prerequisiteCommandId)),
    );
    if (!ready.length) {
      for (const { file } of remaining)
        reject(file, new AppError("conflict", "cyclic command prerequisites"));
      break;
    }
    ordered.push(...ready);
    const selected = new Set(ready);
    remaining = remaining.filter((entry) => !selected.has(entry));
  }
  const apply = ({ file, command }: Entry): keyof InboxSyncResult => {
    try {
      const { kind, ...payload } = command;
      const outcome = kind === "start" ? service.start(payload) : service.end(payload);
      if (outcome.status === "pending") return "pending";
      inbox.markDone(file.name);
      return "applied";
    } catch (error) {
      if (error instanceof AppError) {
        try {
          inbox.markFailed(file.name, { error: error.code, message: error.message });
          return "failed";
        } catch {
          return "retry";
        }
      }
      // Keep raw driver errors and command contents out of logs. The next run retries the unchanged file.
      return "retry";
    }
  };
  const waiting: Entry[] = [];
  for (const entry of ordered) {
    const status = apply(entry);
    if (status === "pending") waiting.push(entry);
    else result[status].push(entry.file.name);
  }
  for (const entry of waiting) result[apply(entry)].push(entry.file.name);
  return result;
}
