import { CommandKind, CommandStatus } from "../domain/states.js";
import { createHash } from "node:crypto";
import type { CommandOutcome, StartCommand, EndCommand } from "../../contracts/index.js";
import { endSession } from "../domain/rules.js";
import type { Repository, CommandRecord } from "../ports/repository.js";
import type { Clock } from "../ports/index.js";
import { AppError } from "./errors.js";
import { assertId, assertTime } from "./assertions.js";
type SessionCommandRepository = Pick<
  Repository,
  | "transaction"
  | "command"
  | "saveCommand"
  | "pendingDependents"
  | "activeSession"
  | "session"
  | "insertSession"
  | "activePeriod"
  | "savePeriod"
  | "endSession"
>;
const fingerprint = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Owns command identity, causal ordering, and atomic session lifecycle changes. */
export class SessionCommandService {
  constructor(
    private readonly repo: SessionCommandRepository,
    private readonly clock: Clock,
  ) {}
  private existing(command: StartCommand | EndCommand, kind: CommandKind): CommandOutcome | null {
    const found = this.repo.command(command.producerId, command.commandId);
    if (!found) return null;
    if (found.kind !== kind || found.payloadFingerprint !== fingerprint(command))
      throw new AppError("conflict", "command ID reused with different payload");
    if (found.status === CommandStatus.Pending)
      return { status: CommandStatus.Pending, commandId: command.commandId };
    if (found.status === CommandStatus.Rejected) {
      const rejected = JSON.parse(found.resultJson ?? "{}") as {
        error?: AppError["code"];
        message?: string;
      };
      throw new AppError(rejected.error ?? "conflict", rejected.message ?? "command was rejected");
    }
    return JSON.parse(found.resultJson!) as CommandOutcome;
  }
  private save(
    command: StartCommand | EndCommand,
    kind: CommandKind,
    status: CommandRecord["status"],
    result: CommandOutcome | null,
  ): void {
    this.repo.saveCommand(
      {
        producerId: command.producerId,
        commandId: command.commandId,
        kind,
        payloadFingerprint: fingerprint(command),
        sessionId: command.sessionId,
        status,
        prerequisiteId: command.prerequisiteCommandId ?? null,
        payloadJson: JSON.stringify(command),
        resultJson: result ? JSON.stringify(result) : null,
      },
      this.clock.now(),
    );
  }
  private prerequisiteReady(command: StartCommand | EndCommand): boolean {
    if (!command.prerequisiteCommandId) return true;
    const prior = this.repo.command(command.producerId, command.prerequisiteCommandId);
    return prior?.status === CommandStatus.Applied;
  }
  private drain(producerId: string, commandId: string): void {
    for (const pending of this.repo.pendingDependents(producerId, commandId)) {
      const payload = JSON.parse(pending.payloadJson) as StartCommand | EndCommand;
      try {
        if (pending.kind === CommandKind.Start) this.start(payload as StartCommand);
        else this.end(payload as EndCommand);
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        this.repo.transaction(() =>
          this.repo.saveCommand(
            {
              ...pending,
              status: CommandStatus.Rejected,
              resultJson: JSON.stringify({ error: error.code, message: error.message }),
            },
            this.clock.now(),
          ),
        );
      }
    }
  }
  start(command: StartCommand): CommandOutcome {
    const outcome: CommandOutcome = this.repo.transaction((): CommandOutcome => {
      for (const id of [command.producerId, command.commandId, command.sessionId]) assertId(id);
      assertTime(command.occurredAt);
      if (command.prerequisiteCommandId === command.commandId)
        throw new AppError("conflict", "self prerequisite");
      const result = this.existing(command, CommandKind.Start);
      if (result?.status === CommandStatus.Applied) return result;
      if (!this.prerequisiteReady(command)) {
        this.save(command, CommandKind.Start, CommandStatus.Pending, null);
        return { status: CommandStatus.Pending, commandId: command.commandId };
      }
      const applied = this.applyStart(command);
      return applied;
    });
    if (outcome.status === CommandStatus.Applied) this.drain(command.producerId, command.commandId);
    return outcome;
  }
  private applyStart(command: StartCommand): CommandOutcome {
    const current = this.repo.activeSession();
    const existing = this.repo.session(command.sessionId);
    if (existing && existing.endedAt !== null)
      throw new AppError("conflict", "session ID already ended");
    const active = current ?? existing;
    if (!active)
      this.repo.insertSession(
        { id: command.sessionId, startedAt: command.occurredAt, endedAt: null, revision: 0 },
        this.clock.now(),
      );
    const s = active ?? this.repo.session(command.sessionId)!;
    const result: CommandOutcome = {
      status: CommandStatus.Applied,
      sessionId: s.id,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
    };
    this.save(command, CommandKind.Start, CommandStatus.Applied, result);
    return result;
  }
  end(command: EndCommand): CommandOutcome {
    if (!command.sessionId) throw new AppError("no-active-session", "target session required");
    const outcome: CommandOutcome = this.repo.transaction((): CommandOutcome => {
      for (const id of [command.producerId, command.commandId, command.sessionId]) assertId(id);
      assertTime(command.occurredAt);
      if (command.prerequisiteCommandId === command.commandId)
        throw new AppError("conflict", "self prerequisite");
      const result = this.existing(command, CommandKind.End);
      if (result?.status === CommandStatus.Applied) return result;
      if (!this.prerequisiteReady(command)) {
        if (!command.prerequisiteCommandId)
          throw new AppError("no-active-session", "target session is not known");
        this.save(command, CommandKind.End, CommandStatus.Pending, null);
        return { status: CommandStatus.Pending, commandId: command.commandId };
      }
      const applied = this.applyEnd(command);
      return applied;
    });
    if (outcome.status === CommandStatus.Applied) this.drain(command.producerId, command.commandId);
    return outcome;
  }
  private applyEnd(command: EndCommand): CommandOutcome {
    const s = this.repo.session(command.sessionId);
    if (!s) throw new AppError("not-found", "target session not found");
    let boundary: string;
    try {
      boundary = endSession(s.startedAt, s.endedAt, command.occurredAt);
    } catch {
      throw new AppError("conflict", "end before start");
    }
    if (s.endedAt === null) {
      const active = this.repo.activePeriod(s.id);
      if (active) {
        if (Date.parse(boundary) < Date.parse(active.startedAt))
          throw new AppError("conflict", "end before active period");
        this.repo.savePeriod(
          { ...active, endedAt: boundary, revision: active.revision + 1 },
          this.clock.now(),
        );
      }
      this.repo.endSession(s.id, boundary, this.clock.now());
    }
    const result: CommandOutcome = {
      status: CommandStatus.Applied,
      sessionId: s.id,
      startedAt: s.startedAt,
      endedAt: boundary,
    };
    this.save(command, CommandKind.End, CommandStatus.Applied, result);
    return result;
  }
}
