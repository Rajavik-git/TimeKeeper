import { AppError } from '../ports/errors.js';
import type { CommandInbox, InboxCommand, InboxFile } from '../ports/index.js';
import type { CommandOutcome, EndCommand, StartCommand } from '../../contracts/index.js';

/** The command service operations the synchronization needs (TimeKeeperService implements them). */
export interface CommandService {
  start(command: StartCommand): CommandOutcome;
  end(command: EndCommand): CommandOutcome;
}
export interface InboxSyncResult { applied: string[]; pending: string[]; failed: string[]; retry: string[] }

function parse(file: InboxFile): InboxCommand {
  let value: unknown;
  try { value = JSON.parse(file.content); } catch { throw new AppError('invalid-request','command file is not valid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('invalid-request','command file must hold a JSON object');
  const b = value as Record<string, unknown>;
  if (b.kind !== 'start' && b.kind !== 'end') throw new AppError('invalid-request','kind must be start or end');
  for (const field of ['producerId','commandId','sessionId','occurredAt'] as const)
    if (typeof b[field] !== 'string' || !b[field]) throw new AppError('invalid-request',`${field} required`);
  if (b.prerequisiteCommandId !== undefined && (typeof b.prerequisiteCommandId !== 'string' || !b.prerequisiteCommandId))
    throw new AppError('invalid-request','prerequisiteCommandId must be a non-empty string');
  return {
    kind: b.kind, producerId: b.producerId as string, commandId: b.commandId as string, sessionId: b.sessionId as string,
    occurredAt: b.occurredAt as string, ...(b.prerequisiteCommandId ? { prerequisiteCommandId: b.prerequisiteCommandId as string } : {}),
  };
}

/**
 * Applies commands left in the inbox while TimeKeeper was closed (docs/API.md D8), in order of their original time,
 * through the same command service as POST /api/commands/start and /end. Applied files move to done/, refused or
 * invalid files to failed/ with their error, and commands waiting for a prerequisite stay for the next run.
 * Unexpected failures leave the file in place so the next run retries it.
 */
export function syncInbox(inbox: CommandInbox, service: CommandService): InboxSyncResult {
  const result: InboxSyncResult = { applied: [], pending: [], failed: [], retry: [] };
  const commands: { file: InboxFile; command: InboxCommand }[] = [];
  for (const file of inbox.list()) {
    try { commands.push({ file, command: parse(file) }); }
    catch (error) {
      const e = error as AppError;
      inbox.markFailed(file.name, { error: e.code, message: e.message }); result.failed.push(file.name);
    }
  }
  commands.sort((a, b) => Date.parse(a.command.occurredAt) - Date.parse(b.command.occurredAt) ||
    (a.command.commandId < b.command.commandId ? -1 : a.command.commandId > b.command.commandId ? 1 : 0));

  const apply = ({ file, command }: { file: InboxFile; command: InboxCommand }): 'applied' | 'pending' | 'failed' | 'retry' => {
    const { kind, ...payload } = command;
    try {
      const outcome = kind === 'start' ? service.start(payload) : service.end(payload);
      if (outcome.status === 'pending') return 'pending';
      inbox.markDone(file.name); return 'applied';
    } catch (error) {
      if (error instanceof AppError) { inbox.markFailed(file.name, { error: error.code, message: error.message }); return 'failed'; }
      console.error('[inbox] will retry', file.name, error instanceof Error ? `${error.name}: ${error.message}` : typeof error);
      return 'retry';
    }
  };
  const waiting: typeof commands = [];
  for (const entry of commands) {
    const status = apply(entry);
    if (status === 'pending') waiting.push(entry); else result[status].push(entry.file.name);
  }
  // A later file may have applied a prerequisite; the service then applied the waiting command, so re-read its outcome.
  for (const entry of waiting) result[apply(entry)].push(entry.file.name);
  return result;
}
