// Starts the JEV tab-change detection (integrations/screenpipe/jev-check) alongside a TimeKeeper session.
// The watcher is read-only, single-instance, and stops by itself when the session ends.
import { spawn } from 'node:child_process';
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
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
  /** 'wmi' (Windows) starts the watcher outside the caller's process tree; default 'spawn'. */
  launch?: 'spawn' | 'wmi';
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

/** One JEV check as the watcher logged it (see integrations/screenpipe/jev-check/jev-check.ts print). */
export interface TabCheck {
  checkedAt: string; status: string; previous?: string; current?: string;
  tabChange?: string; proposal?: string; assignment?: string; timekeeper?: string;
}
export interface TabDetectionStatus { running: boolean; pid: number | null; log: string; lastEvent: string | null; recentChecks: TabCheck[] }

const CHECK_FIELDS: Record<string, keyof TabCheck> = {
  previous: 'previous', current: 'current', 'tab change': 'tabChange', proposal: 'proposal', assignment: 'assignment', timekeeper: 'timekeeper',
};

/** Parses the end of watch.log into the latest checks, newest last. Window titles in it are untrusted screen content. */
export function parseWatchLog(text: string, limit = 5): { lastEvent: string | null; checks: TabCheck[] } {
  const checks: TabCheck[] = [];
  let lastEvent: string | null = null;
  let current: TabCheck | null = null;
  for (const line of text.split(/\r?\n/)) {
    const head = /^\[([^\]]+)\] (.*)$/.exec(line);
    if (head) {
      const check = /^status=(\S+)(.*)$/.exec(head[2]!);
      if (check) { current = { checkedAt: head[1]!, status: check[1]! + check[2]!.trimEnd() }; checks.push(current); }
      else { current = null; if (!/^stable for /.test(head[2]!)) lastEvent = `${head[1]} ${head[2]}`; }
      continue;
    }
    const field = /^ {2}([a-z ]+?):\s+(.*)$/.exec(line);
    const key = field && CHECK_FIELDS[field[1]!];
    if (current && key) (current as any)[key] = field![2]!.trim();
  }
  return { lastEvent, checks: checks.slice(-Math.max(1, Math.min(limit, 20))) };
}

export function tabDetectionStatus(o: { dir?: string; limit?: number } = {}): TabDetectionStatus {
  const dir = o.dir ?? JEV_CHECK_DIR;
  const log = o.dir ? join(dir, 'watch.log') : WATCH_LOG;
  const pid = runningWatcher(join(dir, '.watch.pid'));
  let text = '';
  if (existsSync(log)) {
    // Only the end of the file: the log grows with every check.
    const fd = openSync(log, 'r');
    try {
      const size = fstatSync(fd).size;
      const length = Math.min(size, 200_000);
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, size - length);
      text = buffer.toString('utf8');
    } finally { closeSync(fd); }
  }
  const { lastEvent, checks } = parseWatchLog(text, o.limit ?? 5);
  return { running: pid !== null, pid, log, lastEvent, recentChecks: checks };
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
    const pid = o.launch === 'wmi' ? await launchViaWmi(o.bun, dir, o.apiBase, log) : await launchChild(o.bun, dir, o.apiBase, log);
    return { status: 'started', pid, log };
  } catch (error) {
    return { status: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}

async function launchChild(bun: string, dir: string, apiBase: string, log: string): Promise<number> {
  const out = openSync(log, 'a');
  const child = spawn(bun, ['jev-check.ts', '--session-bound', '--api', apiBase], {
    cwd: dir,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, TIMEKEEPER_API_URL: apiBase },
  });
  const pid = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', () => resolve(child.pid!));
  });
  child.unref();
  return pid;
}

/**
 * Windows: a Screenpipe pipe run kills its whole process tree when it finishes, including detached children.
 * Win32_Process.Create starts the watcher outside that tree, hidden. It does not inherit this environment,
 * so the API address is passed as an argument. Returns the PID of the hidden cmd.exe that runs the watcher.
 */
async function launchViaWmi(bun: string, dir: string, apiBase: string, log: string): Promise<number> {
  for (const value of [bun, dir, apiBase, log]) if (/["\r\n]/.test(value)) throw new Error('unsupported character in launch path');
  const commandLine = `cmd.exe /d /c ""${bun}" jev-check.ts --session-bound --api "${apiBase}" >> "${log}" 2>&1"`;
  const q = (s: string) => s.replace(/'/g, "''");
  const script =
    `$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }; ` +
    `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${q(commandLine)}'; ` +
    `CurrentDirectory = '${q(dir)}'; ProcessStartupInformation = $si }; ` +
    `if ($r.ReturnValue -ne 0) { [Console]::Error.WriteLine('Win32_Process.Create returned ' + $r.ReturnValue); exit 1 }; $r.ProcessId`;
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  ps.stdout!.on('data', d => { stdout += d; });
  ps.stderr!.on('data', d => { stderr += d; });
  const code = await new Promise<number | null>((resolve, reject) => { ps.once('error', reject); ps.once('close', resolve); });
  const pid = Number(stdout.trim().split(/\s+/).pop());
  if (code !== 0 || !Number.isInteger(pid) || pid <= 0) throw new Error(`WMI launch failed: ${stderr.trim() || `exit ${code}`}`);
  return pid;
}
