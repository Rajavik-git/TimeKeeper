import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { CommandInbox, InboxFile } from '../../ports/index.js';

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
 */
export function folderInbox(dir: string): CommandInbox {
  const done = join(dir, 'done'), failed = join(dir, 'failed');
  for (const folder of [dir, done, failed]) mkdirSync(folder, { recursive: true });
  const move = (name: string, target: string) => {
    const destination = join(target, name);
    if (existsSync(destination)) rmSync(destination);
    renameSync(join(dir, name), destination);
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
      writeFileSync(join(failed, name.replace(/\.json$/, '.error.json')), JSON.stringify(error, null, 2));
    },
  };
}
