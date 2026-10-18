// Coordination-only state for the watcher. This file never opens the TimeKeeper business database.
// SQLite's short transaction releases its filesystem lock on process death; stale PID owners can then be replaced.
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export const JEV_CHECK_DIR = dirname(fileURLToPath(import.meta.url));
export const WATCH_LOCK = join(JEV_CHECK_DIR, ".watch.pid");
export const WATCH_LOG = join(JEV_CHECK_DIR, "watch.log");

type LockOwner = { pid: number; token?: string };
const ownedLocks = new Map<string, string>();
const databasePath = (lockPath: string) => `${lockPath}.sqlite`;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function readDiagnosticOwner(lockPath: string): LockOwner | null {
  let text: string;
  try {
    text = readFileSync(lockPath, "utf8").trim();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  try {
    const value = JSON.parse(text) as number | LockOwner;
    const owner = typeof value === "number" ? { pid: value } : value;
    return owner && Number.isInteger(owner.pid) && owner.pid > 0 ? owner : null;
  } catch {
    return null;
  }
}

function readOwner(db: DatabaseSync): LockOwner | null {
  return (
    (db.prepare("SELECT pid, token FROM watcher_owner WHERE id = 1").get() as
      LockOwner | undefined) ?? null
  );
}

function ownerTransaction<T>(lockPath: string, work: (db: DatabaseSync) => T): T {
  const path = databasePath(lockPath);
  const db = new DatabaseSync(path);
  try {
    chmodSync(path, 0o600);
    db.exec("PRAGMA busy_timeout = 1000");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(
        "CREATE TABLE IF NOT EXISTS watcher_owner (id INTEGER PRIMARY KEY CHECK (id = 1), pid INTEGER NOT NULL, token TEXT NOT NULL)",
      );
      const result = work(db);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

/** API-compatible diagnostics also recognize a live owner from an earlier PID-only lock. */
export function runningWatcher(lockPath = WATCH_LOCK): number | null {
  if (existsSync(databasePath(lockPath))) {
    // Opening the operational file writable lets SQLite recover a journal left by a crashed owner.
    const db = new DatabaseSync(databasePath(lockPath));
    try {
      db.exec("PRAGMA busy_timeout = 1000");
      const initialized = db
        .prepare("SELECT 1 FROM sqlite_master WHERE name = 'watcher_owner'")
        .get();
      if (initialized) {
        const owner = readOwner(db);
        if (owner) return alive(owner.pid) ? owner.pid : null;
        const legacyOwner = readDiagnosticOwner(lockPath);
        return legacyOwner && !legacyOwner.token && alive(legacyOwner.pid) ? legacyOwner.pid : null;
      }
    } finally {
      db.close();
    }
  }
  const legacyOwner = readDiagnosticOwner(lockPath);
  return legacyOwner && alive(legacyOwner.pid) ? legacyOwner.pid : null;
}

function writeDiagnosticOwner(lockPath: string, owner: LockOwner): void {
  const temporary = `${lockPath}.${owner.token}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(owner), { flag: "wx", mode: 0o600 });
    renameSync(temporary, lockPath);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

/** One transaction checks owner liveness and replaces a stale owner without a separate recovery guard. */
export function acquireWatchLock(
  lockPath = WATCH_LOCK,
  pid = process.pid,
): { ok: true } | { ok: false; pid: number } {
  if (!Number.isInteger(pid) || pid <= 0)
    throw new Error("Watcher PID must be a positive integer.");
  return ownerTransaction(lockPath, (db) => {
    const legacyOwner = readDiagnosticOwner(lockPath);
    const owner = readOwner(db) ?? (legacyOwner?.token ? null : legacyOwner);
    if (owner && alive(owner.pid)) return { ok: false, pid: owner.pid };
    const token = randomUUID();
    db.prepare(
      "INSERT INTO watcher_owner (id, pid, token) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET pid = excluded.pid, token = excluded.token",
    ).run(pid, token);
    // Publish diagnostics while the transaction serializes all acquire/release operations.
    writeDiagnosticOwner(lockPath, { pid, token });
    ownedLocks.set(lockPath, token);
    return { ok: true };
  });
}

export function releaseWatchLock(lockPath = WATCH_LOCK, pid = process.pid): void {
  const token = ownedLocks.get(lockPath);
  if (!token) return;
  try {
    ownerTransaction(lockPath, (db) => {
      const owner = readOwner(db);
      if (owner?.pid !== pid || owner.token !== token) return;
      const diagnosticOwner = readDiagnosticOwner(lockPath);
      if (diagnosticOwner?.pid === pid && diagnosticOwner.token === token) unlinkSync(lockPath);
      db.prepare("DELETE FROM watcher_owner WHERE id = 1 AND pid = ? AND token = ?").run(
        pid,
        token,
      );
      ownedLocks.delete(lockPath);
    });
  } catch {
    // The next acquisition can replace this owner after the process exits.
  }
}
