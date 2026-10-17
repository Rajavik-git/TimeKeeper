import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { CommandInbox, FailedInboxFile, InboxFile } from '../../ports/index.js';

/**
 * The inbox folder next to the database (docs/API.md D8): `TIMEKEEPER_INBOX`, otherwise `<database folder>/inbox`.
 * In the installed app that is %APPDATA%\com.timekeeper.desktop\inbox\; in development, data/inbox/.
 */
export function inboxDir(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  if (env.TIMEKEEPER_INBOX) return resolve(cwd, env.TIMEKEEPER_INBOX);
  return join(dirname(resolve(cwd, env.TIMEKEEPER_DB ?? 'data/timekeeper.db')), 'inbox');
}

/**
 * Command files are `<commandId>.json`. Pipes write `<name>.json.tmp` and rename it, so a half-written file is never read.
 * Applied files move to `done/`; refused or invalid files move to `failed/` beside a `<name>.error.json`.
 * Dismissed failures (docs/API.md A14) move to `dismissed/`.
 */
export function folderInbox(dir: string): CommandInbox {
  const done = join(dir, 'done'), failed = join(dir, 'failed'), dismissed = join(dir, 'dismissed');
  for (const folder of [dir, done, failed, dismissed]) mkdirSync(folder, { recursive: true });
  const moveFrom = (from: string, name: string, target: string) => {
    const destination = join(target, name);
    if (existsSync(destination)) rmSync(destination);
    renameSync(join(from, name), destination);
  };
  const move = (name: string, target: string) => moveFrom(dir, name, target);
  const errorName = (name: string) => name.replace(/\.json$/, '.error.json');
  const readError = (name: string) => {
    try { return JSON.parse(readFileSync(join(failed, errorName(name)), 'utf8')) as { error: string; message: string }; }
    catch { return null; }
  };
  return {
    list() {
      const files: InboxFile[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        try { files.push({ name: entry.name, content: readFileSync(join(dir, entry.name), 'utf8') }); }
        catch { /* Locked or removed while listing: the next run picks it up. */ }
      }
      return files;
    },
    markDone(name) { move(name, done); },
    markFailed(name, error) {
      move(name, failed);
      writeFileSync(join(failed, errorName(name)), JSON.stringify(error, null, 2));
    },
    listFailed() {
      const files: FailedInboxFile[] = [];
      for (const entry of readdirSync(failed, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.endsWith('.error.json')) continue;
        try {
          const path = join(failed, entry.name);
          files.push({ name: entry.name, content: readFileSync(path, 'utf8'), error: readError(entry.name), failedAt: statSync(path).mtime.toISOString() });
        } catch { /* Removed while listing. */ }
      }
      return files.sort((a, b) => b.failedAt.localeCompare(a.failedAt) || a.name.localeCompare(b.name));
    },
    dismissFailed(name) {
      if (existsSync(join(failed, name))) {
        moveFrom(failed, name, dismissed);
        if (existsSync(join(failed, errorName(name)))) moveFrom(failed, errorName(name), dismissed);
        return true;
      }
      return existsSync(join(dismissed, name));
    },
  };
}
