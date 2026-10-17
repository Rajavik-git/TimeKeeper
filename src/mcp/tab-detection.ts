// Starts the JEV tab-change detection (integrations/screenpipe/jev-check) alongside a TimeKeeper session.
// The watcher is read-only, single-instance, and stops by itself when the session ends.
import { spawn } from 'node:child_process';
import { existsSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JEV_CHECK_DIR, runningWatcher, WATCH_LOG } from '../../integrations/screenpipe/jev-check/session-bound.js';

export type TabDetectionResult =
  | { status: 'started'; pid: number; log: string }
  | { status: 'already_running'; pid: number }
  | { status: 'disabled' }
  | { status: 'not_configured'; message: string }
  | { status: 'failed'; message: string };

export interface TabDetectionOptions {
  enabled: boolean;
  bun: string;
  apiBase: string;
  dir?: string;
}

function envFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=(.*)$/.exec(line);
    if (m) env[m[1]!] = m[2]!.trim();
  }
  return env;
}

/** Prefers the running Bun, then Screenpipe's bundled Bun, then `bun` on PATH. */
export function findBun(env: NodeJS.ProcessEnv = process.env): string {
  if (env.TIMEKEEPER_BUN) return env.TIMEKEEPER_BUN;
  if (process.versions.bun) return process.execPath;
  const bundled = process.platform === 'win32' && env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'screenpipe', 'bun.exe') : '';
  return bundled && existsSync(bundled) ? bundled : 'bun';
}

export async function startTabDetection(o: TabDetectionOptions): Promise<TabDetectionResult> {
  if (!o.enabled) return { status: 'disabled' };
  const dir = o.dir ?? JEV_CHECK_DIR;
  const running = runningWatcher(join(dir, '.watch.pid'));
  if (running !== null) return { status: 'already_running', pid: running };
  const settings = { ...envFile(join(dir, '.env')), ...process.env };
  if (!settings.TYPESAFE_API_KEY?.trim() || !settings.JEV_ALLOWED_FIELDS?.trim()) {
    return { status: 'not_configured',
      message: `Tab detection needs TYPESAFE_API_KEY and JEV_ALLOWED_FIELDS in ${join(dir, '.env')} (see .env.example).` };
  }
  try {
    const log = o.dir ? join(dir, 'watch.log') : WATCH_LOG;
    const out = openSync(log, 'a');
    const child = spawn(o.bun, ['jev-check.ts', '--session-bound'], {
      cwd: dir,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', out, out],
      env: { ...process.env, TIMEKEEPER_API_URL: o.apiBase },
    });
    const pid = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('spawn', () => resolve(child.pid!));
    });
    child.unref();
    return { status: 'started', pid, log };
  } catch (error) {
    return { status: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}
