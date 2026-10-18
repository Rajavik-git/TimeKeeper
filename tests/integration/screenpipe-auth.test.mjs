import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { prepareScreenpipeAuth } from "../../scripts/screenpipe-auth.mjs";

const directories = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture(text = "# Keep me\nOTHER=value\nSCREENPIPE_API_KEY=\n") {
  const rootDir = await mkdtemp(join(tmpdir(), "timekeeper-auth-test-"));
  directories.push(rootDir);
  await writeFile(join(rootDir, ".env"), text);
  const run = vi.fn(() => ({ status: 0, stdout: "sp-secret-fixture\n" }));
  const log = vi.fn();
  return { rootDir, run, log, env: {} };
}

it("preserves an existing nonblank API key without running the CLI", async () => {
  const text = "# Keep\nSCREENPIPE_API_KEY=existing-custom-key\nOTHER=42\n";
  const options = await fixture(text);
  expect((await prepareScreenpipeAuth(options)).configured).toBe(true);
  expect(options.run).not.toHaveBeenCalled();
  expect(await readFile(join(options.rootDir, ".env"), "utf8")).toBe(text);
});

it("preserves an exported API key without persisting it or discovering credentials", async () => {
  const options = await fixture();
  const before = await readFile(join(options.rootDir, ".env"), "utf8");
  expect(
    (
      await prepareScreenpipeAuth({
        ...options,
        check: true,
        env: { SCREENPIPE_API_KEY: "custom-exported" },
      })
    ).configured,
  ).toBe(true);
  expect(options.run).not.toHaveBeenCalled();
  expect(await readFile(join(options.rootDir, ".env"), "utf8")).toBe(before);
});

it.each(["SCREENPIPE_LOCAL_API_KEY"])("uses exported %s", async (name) => {
  const options = await fixture();
  expect(
    (await prepareScreenpipeAuth({ ...options, env: { [name]: "sp-exported" } })).configured,
  ).toBe(true);
  expect(options.run).not.toHaveBeenCalled();
  expect(await readFile(join(options.rootDir, ".env"), "utf8")).toBe(
    "# Keep me\nOTHER=value\nSCREENPIPE_API_KEY=\nSCREENPIPE_API_KEY=sp-exported\n",
  );
  if (process.platform !== "win32")
    expect((await stat(join(options.rootDir, ".env"))).mode & 0o777).toBe(0o600);
});

it("uses an explicit executable with isolated cwd, bounded capture and no shell", async () => {
  const options = await fixture("OTHER=42");
  expect(
    (
      await prepareScreenpipeAuth({
        ...options,
        env: { SCREENPIPE_CLI: "/fixture path/screenpipe" },
      })
    ).configured,
  ).toBe(true);
  expect(options.run).toHaveBeenCalledExactlyOnceWith(
    "/fixture path/screenpipe",
    ["auth", "token"],
    expect.objectContaining({
      timeout: 10000,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16384,
      env: expect.objectContaining({ npm_config_offline: "true" }),
    }),
  );
  const cwd = options.run.mock.calls[0][2].cwd;
  expect(cwd).not.toBe(options.rootDir);
  await expect(stat(cwd)).rejects.toThrow();
  expect(options.log.mock.calls.flat().join("\n")).not.toContain("sp-secret-fixture");
});

it("falls back to offline npx without downloading packages", async () => {
  const options = await fixture();
  options.run.mockReturnValueOnce({ status: null, error: new Error("private") });
  expect((await prepareScreenpipeAuth({ ...options, platform: "linux" })).configured).toBe(true);
  expect(options.run.mock.calls[1].slice(0, 2)).toEqual([
    "npx",
    ["--no-install", "screenpipe", "auth", "token"],
  ]);
});

it.each([
  { status: 0, stdout: "sp-secret\nextra" },
  { status: 0, stdout: "not-a-provider-token" },
  { status: 1, stdout: "sp-secret", stderr: "private failure sp-secret" },
  { status: null, error: new Error("timeout sp-secret") },
])("keeps malformed or failed discovery pending and redacts output", async (result) => {
  const options = await fixture();
  const before = await readFile(join(options.rootDir, ".env"), "utf8");
  options.run.mockReturnValue(result);
  expect((await prepareScreenpipeAuth(options)).configured).toBe(false);
  expect(await readFile(join(options.rootDir, ".env"), "utf8")).toBe(before);
  expect(options.log.mock.calls.flat().join("\n")).not.toMatch(/sp-secret|private failure/);
  expect(await readdir(options.rootDir)).toEqual([".env"]);
});

it("check mode neither discovers credentials nor writes files", async () => {
  const options = await fixture();
  const before = await readdir(options.rootDir);
  expect(
    (
      await prepareScreenpipeAuth({
        ...options,
        check: true,
        env: { SCREENPIPE_LOCAL_API_KEY: "sp-exported" },
      })
    ).configured,
  ).toBe(false);
  expect(options.run).not.toHaveBeenCalled();
  expect(await readdir(options.rootDir)).toEqual(before);
});

it("preserves concurrent configuration edits made during credential discovery", async () => {
  const options = await fixture();
  const { writeFileSync } = await import("node:fs");
  options.run.mockImplementation(() => {
    writeFileSync(join(options.rootDir, ".env"), "OTHER=concurrent\n");
    return { status: 0, stdout: "sp-secret" };
  });
  expect((await prepareScreenpipeAuth(options)).configured).toBe(false);
  expect(await readFile(join(options.rootDir, ".env"), "utf8")).toBe("OTHER=concurrent\n");
});

it("does not follow a symlink configuration or steal an existing setup lock", async () => {
  const options = await fixture();
  const path = join(options.rootDir, ".env");
  const target = join(options.rootDir, "target");
  await writeFile(target, "OTHER=preserve\n");
  await rm(path);
  await symlink(target, path);
  expect((await prepareScreenpipeAuth(options)).configured).toBe(false);
  expect(options.run).not.toHaveBeenCalled();
  expect(await readFile(target, "utf8")).toBe("OTHER=preserve\n");
  await rm(path);
  await writeFile(path, "SCREENPIPE_API_KEY=\n");
  const lockPath = join(options.rootDir, ".env.screenpipe-auth.lock");
  await writeFile(lockPath, "other setup");
  expect((await prepareScreenpipeAuth(options)).configured).toBe(false);
  expect(await readFile(lockPath, "utf8")).toBe("other setup");
});

it("uses the native CLI configured in the local file", async () => {
  const options = await fixture(
    'SCREENPIPE_CLI="/configured path/screenpipe"\nSCREENPIPE_API_KEY=\n',
  );
  expect((await prepareScreenpipeAuth(options)).configured).toBe(true);
  expect(options.run.mock.calls[0][0]).toBe("/configured path/screenpipe");
});

it("preserves comments, duplicate blank keys and CRLF line endings", async () => {
  const options = await fixture(
    "# Local settings\r\nOTHER='unchanged'\r\nexport SCREENPIPE_API_KEY=\r\nSCREENPIPE_API_KEY=\r\n",
  );
  expect((await prepareScreenpipeAuth(options)).configured).toBe(true);
  expect(await readFile(join(options.rootDir, ".env"), "utf8")).toBe(
    "# Local settings\r\nOTHER='unchanged'\r\nexport SCREENPIPE_API_KEY=\r\nSCREENPIPE_API_KEY=\r\nSCREENPIPE_API_KEY=sp-secret-fixture\r\n",
  );
});

it("rejects multiline exported values without credential discovery", async () => {
  const options = await fixture();
  expect(
    (
      await prepareScreenpipeAuth({
        ...options,
        env: { SCREENPIPE_LOCAL_API_KEY: "sp-secret\nOTHER=overwritten" },
      })
    ).configured,
  ).toBe(false);
  expect(options.run).not.toHaveBeenCalled();
  expect(await readFile(join(options.rootDir, ".env"), "utf8")).toContain("OTHER=value");
});

it.each([
  "OTHER='line\nSCREENPIPE_API_KEY=\nrest'\nSCREENPIPE_API_KEY=\nUNCHANGED=value\n",
  "SCREENPIPE_API_KEY=''\nOTHER='multiple\nlines'\nUNCHANGED=value\n",
])("preserves complete multiline definitions when appending the API key", async (text) => {
  const options = await fixture(text);
  expect((await prepareScreenpipeAuth(options)).configured).toBe(true);
  const saved = await readFile(join(options.rootDir, ".env"), "utf8");
  expect(saved.startsWith(text)).toBe(true);
  expect(parseEnv(saved)).toEqual({ ...parseEnv(text), SCREENPIPE_API_KEY: "sp-secret-fixture" });
});

it("uses a static Windows npx command without interpolating configuration", async () => {
  const options = await fixture();
  options.run.mockReturnValueOnce({ status: null, error: new Error("not installed") });
  expect((await prepareScreenpipeAuth({ ...options, platform: "win32" })).configured).toBe(true);
  expect(options.run.mock.calls[1]).toEqual([
    "cmd.exe",
    ["/d", "/s", "/c", "npx --no-install screenpipe auth token"],
    expect.objectContaining({
      shell: false,
      env: expect.objectContaining({ npm_config_offline: "true", npm_config_yes: "false" }),
    }),
  ]);
});

it("executes an explicit Windows native executable directly with no command shell", async () => {
  const options = await fixture();
  const executable = "C:\\Program Files\\Screenpipe\\screenpipe.exe";
  expect(
    (
      await prepareScreenpipeAuth({
        ...options,
        platform: "win32",
        env: { SCREENPIPE_CLI: executable },
      })
    ).configured,
  ).toBe(true);
  expect(options.run).toHaveBeenCalledExactlyOnceWith(
    executable,
    ["auth", "token"],
    expect.objectContaining({ shell: false }),
  );
});

it.each([false, true])(
  "honors a configured key file without reading or replacing its contents (check=%s)",
  async (check) => {
    const options = await fixture("SCREENPIPE_API_KEY_FILE=key-file\nOTHER=keep\n");
    const keyPath = join(options.rootDir, "key-file");
    await writeFile(keyPath, "");
    const before = await readFile(join(options.rootDir, ".env"), "utf8");
    expect(await prepareScreenpipeAuth({ ...options, check })).toEqual({
      configured: true,
      status: "configured",
    });
    expect(options.run).not.toHaveBeenCalled();
    expect(await readFile(join(options.rootDir, ".env"), "utf8")).toBe(before);
    expect(options.log.mock.calls.flat().join("\n")).toContain(
      "contents and API access are unverified",
    );
  },
);

it("preserves an unavailable key-file setting without credential discovery", async () => {
  const options = await fixture("SCREENPIPE_API_KEY_FILE=missing-file\n");
  expect((await prepareScreenpipeAuth(options)).configured).toBe(false);
  expect(options.run).not.toHaveBeenCalled();
  expect(await readFile(join(options.rootDir, ".env"), "utf8")).toBe(
    "SCREENPIPE_API_KEY_FILE=missing-file\n",
  );
});

it("exported key-file setting overrides the same local setting", async () => {
  const options = await fixture("SCREENPIPE_API_KEY_FILE=missing-file\n");
  const keyPath = join(options.rootDir, "exported-file");
  await writeFile(keyPath, "");
  expect(
    (await prepareScreenpipeAuth({ ...options, env: { SCREENPIPE_API_KEY_FILE: keyPath } }))
      .configured,
  ).toBe(true);
  expect(options.run).not.toHaveBeenCalled();
});

it.each([
  { exported: "", local: "SCREENPIPE_API_KEY=existing-local-key\n" },
  { exported: " ", local: "SCREENPIPE_API_KEY=existing-local-key\n" },
  { exported: "", local: "OTHER=unchanged\n" },
  { exported: " \t ", local: "OTHER=unchanged\n" },
])(
  "preserves local configuration masked by an empty exported key: $exported",
  async ({ exported, local }) => {
    const options = await fixture(local);
    expect(
      await prepareScreenpipeAuth({ ...options, env: { SCREENPIPE_API_KEY: exported } }),
    ).toEqual({ configured: false, status: "pending" });
    expect(options.run).not.toHaveBeenCalled();
    expect(await readFile(join(options.rootDir, ".env"), "utf8")).toBe(local);
    expect(options.log.mock.calls.flat().join("\n")).toMatch(/Unset (it|the exported variable)/);
    expect(options.log.mock.calls.flat().join("\n")).not.toContain("existing-local-key");
  },
);

it("honors a configured key file when an empty exported direct key masks the local key", async () => {
  const options = await fixture("SCREENPIPE_API_KEY=local-key\nSCREENPIPE_API_KEY_FILE=key-file\n");
  await writeFile(join(options.rootDir, "key-file"), "");
  expect(await prepareScreenpipeAuth({ ...options, env: { SCREENPIPE_API_KEY: "" } })).toEqual({
    configured: true,
    status: "configured",
  });
  expect(options.run).not.toHaveBeenCalled();
  expect(await readFile(join(options.rootDir, ".env"), "utf8")).toContain(
    "SCREENPIPE_API_KEY=local-key\n",
  );
});

it.each(["exported", "local"])(
  "reports whitespace-only %s direct key before key-file config",
  async (location) => {
    const local =
      location === "local"
        ? 'SCREENPIPE_API_KEY="   "\nSCREENPIPE_API_KEY_FILE=key-file\n'
        : "SCREENPIPE_API_KEY_FILE=key-file\n";
    const options = await fixture(local);
    await writeFile(join(options.rootDir, "key-file"), "");
    const env = location === "exported" ? { SCREENPIPE_API_KEY: "   " } : {};
    expect(await prepareScreenpipeAuth({ ...options, env })).toEqual({
      configured: false,
      status: "pending",
    });
    expect(options.run).not.toHaveBeenCalled();
    expect(await readFile(join(options.rootDir, ".env"), "utf8")).toBe(local);
    expect(options.log.mock.calls.flat().join("\n")).toContain("contains only whitespace");
  },
);
