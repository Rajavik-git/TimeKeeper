import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdtemp, open, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";

const pendingMessage =
  "[pending] Screenpipe API key is missing. Open Screenpipe and rerun npm run setup:auth. If needed, set SCREENPIPE_CLI to its installed executable. Existing configuration is preserved.";

async function snapshot(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Unsafe configuration path");
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const current = await handle.stat();
    if (info.ino !== current.ino || info.dev !== current.dev) throw new Error("Changed file");
    return { text: await handle.readFile("utf8"), info: current };
  } finally {
    await handle.close();
  }
}

function validToken(value) {
  return typeof value === "string" && /^sp-[A-Za-z0-9_-]+$/.test(value);
}

function withToken(text, token) {
  // Appending preserves quoted multiline values and every original line.
  // Node dotenv parsing uses the last definition of a duplicate key.
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const updated = `${text}${text && !text.endsWith("\n") ? newline : ""}SCREENPIPE_API_KEY=${token}${newline}`;
  const original = parseEnv(text);
  const parsed = parseEnv(updated);
  const unrelatedKeys = Object.keys(original).filter((key) => key !== "SCREENPIPE_API_KEY");
  if (
    parsed.SCREENPIPE_API_KEY !== token ||
    unrelatedKeys.some((key) => parsed[key] !== original[key]) ||
    Object.keys(parsed).some((key) => key !== "SCREENPIPE_API_KEY" && !(key in original))
  ) {
    throw new Error("Configuration could not preserve existing values");
  }
  return updated;
}

async function discoverToken(env, run, platform) {
  const cwd = await mkdtemp(join(tmpdir(), "timekeeper-screenpipe-auth-"));
  try {
    const explicit = env.SCREENPIPE_CLI?.trim();
    const commands = explicit
      ? [[explicit, ["auth", "token"]]]
      : [
          ["screenpipe", ["auth", "token"]],
          // cmd.exe is needed for Windows npm's npx.cmd launcher. Its command
          // is static: no executable override, token, or config is interpolated.
          platform === "win32"
            ? ["cmd.exe", ["/d", "/s", "/c", "npx --no-install screenpipe auth token"]]
            : ["npx", ["--no-install", "screenpipe", "auth", "token"]],
        ];
    for (const [command, args] of commands) {
      let result;
      try {
        result = run(command, args, {
          cwd,
          env: { ...env, npm_config_offline: "true", npm_config_yes: "false" },
          timeout: 10000,
          maxBuffer: 16384,
          stdio: ["ignore", "pipe", "pipe"],
          encoding: "utf8",
          shell: false,
          windowsHide: true,
        });
      } catch {
        continue;
      }
      const value = result?.stdout?.trim();
      if (!result?.error && result?.status === 0 && validToken(value)) return value;
    }
    return null;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

/** Configure a missing local API key without returning or logging credentials. */
export async function prepareScreenpipeAuth({
  rootDir,
  check = false,
  env = process.env,
  run = spawnSync,
  platform = process.platform,
  log = console.log,
}) {
  let lock;
  let temporaryPath;
  const configPath = join(rootDir, ".env");
  const lockPath = join(rootDir, ".env.screenpipe-auth.lock");
  try {
    const before = await snapshot(configPath);
    const config = parseEnv(before.text);
    if (config.SCREENPIPE_API_KEY?.trim()) {
      log("[ok] Screenpipe API key is configured. Existing value is preserved.");
      return { configured: true, status: "configured" };
    }
    if (check) {
      log(pendingMessage);
      return { configured: false, status: "pending" };
    }
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      log(
        "[pending] Another auth setup holds .env.screenpipe-auth.lock. If setup was interrupted, confirm it has stopped before removing that lock and rerunning npm run setup:auth.",
      );
      return { configured: false, status: "pending" };
    }
    const exported = env.SCREENPIPE_API_KEY?.trim() || env.SCREENPIPE_LOCAL_API_KEY?.trim();
    const token = exported
      ? validToken(exported)
        ? exported
        : null
      : await discoverToken(
          { ...env, SCREENPIPE_CLI: env.SCREENPIPE_CLI ?? config.SCREENPIPE_CLI },
          run,
          platform,
        );
    if (!token) {
      log(pendingMessage);
      return { configured: false, status: "pending" };
    }
    temporaryPath = join(rootDir, `.env.screenpipe-auth-${process.pid}-${crypto.randomUUID()}.tmp`);
    const temporary = await open(temporaryPath, "wx", 0o600);
    try {
      await temporary.writeFile(withToken(before.text, token));
      await temporary.sync();
    } finally {
      await temporary.close();
    }
    const current = await snapshot(configPath);
    if (
      current.text !== before.text ||
      current.info.ino !== before.info.ino ||
      current.info.dev !== before.info.dev ||
      current.info.mtimeMs !== before.info.mtimeMs
    ) {
      log("[pending] Local configuration changed during auth setup. Rerun npm run setup:auth.");
      return { configured: false, status: "pending" };
    }
    await rename(temporaryPath, configPath);
    temporaryPath = undefined;
    log("[ok] Screenpipe API key saved to local configuration.");
    return { configured: true, status: "configured" };
  } catch {
    log(pendingMessage);
    return { configured: false, status: "pending" };
  } finally {
    if (temporaryPath) await rm(temporaryPath, { force: true });
    if (lock) {
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }
}
