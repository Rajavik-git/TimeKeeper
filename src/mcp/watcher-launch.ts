import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import { join } from "node:path";

export interface WatcherLaunch {
  node: string;
  directory: string;
  apiBase: string;
  log: string;
  environment: NodeJS.ProcessEnv;
}

export interface WatcherProcess {
  pid: number;
  stop: () => void;
}

type SpawnProcess = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export function watcherArgs(directory: string, apiBase: string): string[] {
  const built = existsSync(join(directory, "jev-check.js"));
  return [
    ...(built ? [] : ["--import", "tsx"]),
    built ? "jev-check.js" : "jev-check.ts",
    "--session-bound",
    "--api",
    apiBase,
  ];
}

function stopProcessTree(pid: number): void {
  if (process.platform === "win32") {
    const command = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    command.on("error", () => {});
    command.unref();
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // The detached process or its group may have already exited.
  }
}

export async function launchWatcherChild(request: WatcherLaunch): Promise<WatcherProcess> {
  const output = openSync(request.log, "a");
  const child = spawn(request.node, watcherArgs(request.directory, request.apiBase), {
    cwd: request.directory,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", output, output],
    env: request.environment,
  });
  try {
    const pid = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("spawn", () => resolve(child.pid!));
    });
    child.unref();
    return { pid, stop: () => stopProcessTree(pid) };
  } finally {
    closeSync(output);
  }
}

// Configuration is passed over stdin. It must never appear in command arguments
// or in PowerShell errors returned to MCP callers.
const WMI_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
try {
  $reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
  $payload = ConvertFrom-Json -InputObject $reader.ReadToEnd()
  $variables = [string[]]@($payload.environment.PSObject.Properties | ForEach-Object { $_.Name + '=' + [string]$_.Value })
  $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0; CreateFlags = [uint32]1024; EnvironmentVariables = $variables }
  $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = [string]$payload.commandLine; CurrentDirectory = [string]$payload.directory; ProcessStartupInformation = $startup }
  if ($result.ReturnValue -ne 0) { throw 'Process creation failed' }
  [Console]::Out.WriteLine($result.ProcessId)
} catch {
  [Console]::Error.WriteLine('Watcher process creation failed')
  exit 1
}`;

/** WMI starts outside Screenpipe's process tree with the exact validated environment. */
export async function launchWatcherWmi(
  request: WatcherLaunch,
  spawnProcess: SpawnProcess = spawn,
): Promise<WatcherProcess> {
  for (const value of [request.node, request.directory, request.apiBase, request.log]) {
    if (/["%\r\n]/.test(value)) throw new Error("Unsupported character in launch path.");
  }
  const environment = Object.fromEntries(
    Object.entries(request.environment).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  for (const [key, value] of Object.entries(environment)) {
    if (/[=\0]/.test(key) || value.includes("\0")) {
      throw new Error("Invalid watcher environment.");
    }
  }
  const commandLine = `cmd.exe /d /v:off /c ""${request.node}" ${watcherArgs(
    request.directory,
    request.apiBase,
  )
    .map((value) => `"${value}"`)
    .join(" ")} >> "${request.log}" 2>&1"`;
  const powershell = spawnProcess(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", WMI_SCRIPT],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  let output = "";
  powershell.stdout!.on("data", (chunk) => {
    if (output.length < 256) output += String(chunk);
  });
  powershell.stderr!.resume();
  powershell.stdin!.on("error", () => {});
  const timer = setTimeout(() => powershell.kill(), 10_000);
  try {
    const completion = new Promise<number | null>((resolve, reject) => {
      powershell.once("error", () => reject(new Error("Watcher process creation failed.")));
      powershell.once("close", resolve);
    });
    powershell.stdin!.end(
      JSON.stringify({
        directory: request.directory,
        commandLine,
        environment,
      }),
    );
    const code = await completion;
    const pid = Number(output.trim());
    if (code !== 0 || !Number.isInteger(pid) || pid <= 0) {
      throw new Error("Watcher process creation failed.");
    }
    return { pid, stop: () => stopProcessTree(pid) };
  } finally {
    clearTimeout(timer);
  }
}
