import { execFile } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { install, screenpipeOrigin } from "../../install.mjs";

const directories = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture({ configured = false, installed = false } = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), "timekeeper-setup-"));
  directories.push(rootDir);
  await writeFile(join(rootDir, ".nvmrc"), "24.22.0\n");
  await writeFile(join(rootDir, ".env.example"), "SCREENPIPE_API_URL=http://127.0.0.1:3030\n");
  if (configured) await writeFile(join(rootDir, ".env"), "TIMEKEEPER_DB=keep-this.db\n");
  if (installed) {
    await mkdir(join(rootDir, "node_modules"));
    await writeFile(join(rootDir, "node_modules", ".package-lock.json"), "{}\n");
  }
  const run = vi.fn(() => ({ status: 0 }));
  const fetchHealth = vi.fn(async () => Response.json({ status: "healthy" }));
  const log = vi.fn();
  const options = { rootDir, nodeVersion: "24.22.0", env: {}, run, fetchHealth, log };
  return { ...options, options, output: () => log.mock.calls.flat().join("\n") };
}

describe("environment setup", () => {
  it("runs the CLI from another directory and installs an offline fixture through npm ci", async () => {
    const { rootDir } = await fixture({ configured: true });
    await copyFile(new URL("../../install.mjs", import.meta.url), join(rootDir, "install.mjs"));
    await mkdir(join(rootDir, "fixture-package"));
    await writeFile(
      join(rootDir, "fixture-package", "package.json"),
      JSON.stringify({ name: "fixture-package", version: "1.0.0" }),
    );
    const manifest = {
      name: "setup-fixture",
      version: "0.0.0",
      devDependencies: { "fixture-package": "file:./fixture-package" },
    };
    await writeFile(join(rootDir, "package.json"), JSON.stringify(manifest));
    await writeFile(
      join(rootDir, "package-lock.json"),
      JSON.stringify({
        ...manifest,
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": manifest,
          "fixture-package": { name: "fixture-package", version: "1.0.0", dev: true },
          "node_modules/fixture-package": { resolved: "fixture-package", link: true },
        },
      }),
    );
    const options = {
      cwd: tmpdir(),
      env: { ...process.env, npm_config_offline: "true", npm_config_cache: join(rootDir, "cache") },
      timeout: 15000,
    };
    const execute = promisify(execFile);
    const result = await execute(
      process.execPath,
      [join(rootDir, "install.mjs"), "--skip-screenpipe"],
      options,
    );
    expect(result.stdout).toContain("Selected environment checks passed");
    expect(
      await readFile(join(rootDir, "node_modules", "fixture-package", "package.json"), "utf8"),
    ).toContain("fixture-package");
    const check = await execute(
      process.execPath,
      [join(rootDir, "install.mjs"), "--check", "--skip-screenpipe"],
      options,
    );
    expect(check.stdout).toContain("Selected environment checks passed");
    expect(check.stdout).not.toContain("[install]");
    expect(await readFile(join(rootDir, ".env"), "utf8")).toBe("TIMEKEEPER_DB=keep-this.db\n");
  }, 20000);

  it("installs dependencies in the repository without touching existing configuration or data", async () => {
    const { options, rootDir, run, fetchHealth } = await fixture({ configured: true });
    await writeFile(join(rootDir, "keep-this.db"), "existing workspace");
    expect(await install({ ...options, args: [] })).toBe(0);
    expect(await readFile(join(rootDir, ".env"), "utf8")).toBe("TIMEKEEPER_DB=keep-this.db\n");
    expect(await readFile(join(rootDir, "keep-this.db"), "utf8")).toBe("existing workspace");
    expect(run.mock.calls.map(([command, args]) => [command, args])).toEqual([
      ["npm", ["--version"]],
      ["npm", ["ci", "--include=dev", "--no-audit", "--no-fund"]],
    ]);
    expect(run.mock.calls.every(([, , settings]) => settings.cwd === rootDir)).toBe(true);
    expect(fetchHealth).toHaveBeenCalledExactlyOnceWith(
      "http://127.0.0.1:3030/health",
      expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }),
    );
  });

  it("creates missing configuration and preserves it on a later run", async () => {
    const { options, rootDir } = await fixture();
    expect(await install({ ...options, args: [] })).toBe(0);
    expect(await readFile(join(rootDir, ".env"), "utf8")).toBe(
      await readFile(join(rootDir, ".env.example"), "utf8"),
    );
    await writeFile(join(rootDir, ".env"), "SCREENPIPE_API_URL=http://localhost:4040\n");
    expect(await install({ ...options, args: [] })).toBe(0);
    expect(await readFile(join(rootDir, ".env"), "utf8")).toBe(
      "SCREENPIPE_API_URL=http://localhost:4040\n",
    );
  });

  it("reports missing prerequisites in check mode without creating files or installing packages", async () => {
    const { options, rootDir, run, output } = await fixture();
    const before = await readdir(rootDir);
    expect(await install({ ...options, args: ["--check"] })).toBe(2);
    expect(await readdir(rootDir)).toEqual(before);
    expect(run).toHaveBeenCalledTimes(1);
    expect(output()).toContain("Missing .env");
    expect(output()).toContain("dependencies missing");
  });

  it("checks a prepared workspace without reinstalling dependencies", async () => {
    const { options, run } = await fixture({ configured: true, installed: true });
    expect(await install({ ...options, args: ["--check"] })).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("uses exported configuration before the local file", async () => {
    const { options, rootDir, fetchHealth } = await fixture({ configured: true });
    await writeFile(join(rootDir, ".env"), "SCREENPIPE_API_URL=http://localhost:4040\n");
    expect(
      await install({ ...options, args: [], env: { SCREENPIPE_API_URL: "http://[::1]:5050" } }),
    ).toBe(0);
    expect(fetchHealth.mock.calls[0][0]).toBe("http://[::1]:5050/health");
  });

  it("rejects unsupported Node or missing npm before writes or network calls", async () => {
    const { options, rootDir, run, fetchHealth } = await fixture();
    const before = await readdir(rootDir);
    expect(await install({ ...options, args: [], nodeVersion: "25.9.0" })).toBe(2);
    expect(run).not.toHaveBeenCalled();
    run.mockReturnValue({ status: null, error: new Error("missing") });
    expect(await install({ ...options, args: [] })).toBe(2);
    expect(await readdir(rootDir)).toEqual(before);
    expect(fetchHealth).not.toHaveBeenCalled();
  });

  it("keeps a failed npm installation retryable and does not check Screenpipe", async () => {
    const { options, rootDir, run, fetchHealth } = await fixture();
    run.mockImplementation((_command, args) => ({ status: args[0] === "ci" ? 1 : 0 }));
    expect(await install({ ...options, args: [] })).toBe(1);
    expect(await readFile(join(rootDir, ".env"), "utf8")).toContain("SCREENPIPE_API_URL=");
    expect(fetchHealth).not.toHaveBeenCalled();
  });

  it.each([
    ["unavailable", () => Promise.reject(new Error("private diagnostic"))],
    ["HTTP failure", async () => new Response("private diagnostic", { status: 503 })],
    ["degraded", async () => Response.json({ status: "degraded", message: "private diagnostic" })],
    ["unrelated JSON", async () => Response.json({ ok: true, message: "private diagnostic" })],
    ["invalid JSON", async () => new Response("private diagnostic")],
  ])(
    "reports partial setup for %s health without exposing the response",
    async (_name, fetchHealth) => {
      const { options, output } = await fixture();
      expect(await install({ ...options, args: [], fetchHealth })).toBe(2);
      expect(output()).toContain("preparation is partial");
      expect(output()).not.toContain("private diagnostic");
    },
  );

  it("skips Screenpipe explicitly for local development", async () => {
    const { options, fetchHealth, output } = await fixture();
    expect(await install({ ...options, args: ["--skip-screenpipe"] })).toBe(0);
    expect(fetchHealth).not.toHaveBeenCalled();
    expect(output()).toContain("[skipped] Screenpipe");
  });

  it("reports missing Rust tools only when desktop checks are selected", async () => {
    const { options, run, output } = await fixture();
    run.mockImplementation((command) => ({ status: command === "cargo" ? 1 : 0 }));
    expect(await install({ ...options, args: ["--desktop", "--skip-screenpipe"] })).toBe(2);
    expect(output()).toContain("cargo is unavailable");
    expect(output()).toContain("native behavior need separate verification");
  });

  it("rejects invalid origins before dependency installation and never prints credentials", async () => {
    const { options, run, fetchHealth, output } = await fixture();
    expect(
      await install({
        ...options,
        args: [],
        env: { SCREENPIPE_API_URL: "http://secret@localhost:3030" },
      }),
    ).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(fetchHealth).not.toHaveBeenCalled();
    expect(output()).not.toContain("secret");
  });

  it("shows help or rejects unknown options without reading configuration", async () => {
    const log = vi.fn();
    const rootDir = "/nonexistent-timekeeper-setup";
    expect(await install({ rootDir, args: ["--help"], log })).toBe(0);
    expect(await install({ rootDir, args: ["--unknown"], log })).toBe(1);
  });
});

describe("Screenpipe origin", () => {
  it.each(["http://127.0.0.1:3030", "http://localhost:3030/", "http://[::1]:3030"])(
    "accepts %s",
    (value) => expect(screenpipeOrigin(value)).toBe(new URL(value).origin),
  );

  it.each([
    "https://localhost:3030",
    "http://example.com:3030",
    "http://localhost:3030/search",
    "http://localhost:3030?token=secret",
    "http://localhost:3030#secret",
    "http://user:secret@localhost:3030",
    "not a URL",
    "",
  ])("rejects %s", (value) => expect(() => screenpipeOrigin(value)).toThrow("HTTP loopback"));
});
