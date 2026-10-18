import { build } from "esbuild";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Bundles the Node API into one CommonJS file and, with --sidecar, the Tauri external binary.
const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist/sidecar");
const bundle = join(output, "api.cjs");
const nodeMajor = (await readFile(resolve(root, ".nvmrc"), "utf8")).trim().split(".")[0];

/** createRequire(import.meta.url) cannot be resolved in a CommonJS bundle; use require. */
const bundledRequire = {
  name: "bundled-require",
  setup(context) {
    context.onLoad({ filter: /src[\\/]backend[\\/]api[\\/]validation\.ts$/ }, async (args) => ({
      contents: (await readFile(args.path, "utf8")).replace(
        "createRequire(import.meta.url)(",
        "require(",
      ),
      loader: "ts",
    }));
  },
};

await mkdir(output, { recursive: true });
await build({
  entryPoints: [resolve(root, "src/backend/api/index.ts")],
  outfile: bundle,
  bundle: true,
  platform: "node",
  target: `node${nodeMajor}`,
  format: "cjs",
  external: ["node:sqlite"],
  plugins: [bundledRequire],
});
console.log(`Bundled standalone API: ${bundle}`);
if (!process.argv.includes("--sidecar")) process.exit(0);

const triples = {
  win32: { x64: "x86_64-pc-windows-msvc" },
  linux: { x64: "x86_64-unknown-linux-gnu", arm64: "aarch64-unknown-linux-gnu" },
};
const triple = triples[process.platform]?.[process.arch];
if (!triple) throw new Error(`Unsupported sidecar target: ${process.platform}/${process.arch}`);
const binary = resolve(
  root,
  "src-tauri/binaries",
  `timekeeper-api-${triple}${process.platform === "win32" ? ".exe" : ""}`,
);
await mkdir(resolve(root, "src-tauri/binaries"), { recursive: true });
const blob = join(output, "api.blob");
const config = join(output, "sea-config.json");

async function freePort() {
  const server = createServer();
  await new Promise((ready, reject) => server.once("error", reject).listen(0, "127.0.0.1", ready));
  const port = server.address().port;
  await new Promise((closed) => server.close(closed));
  return port;
}

/** Starts the binary against a new database and requires an initialized empty workspace. */
async function checkSidecar() {
  const directory = await mkdtemp(join(tmpdir(), "timekeeper-sidecar-"));
  const port = await freePort();
  const child = spawn(binary, [bundle], {
    env: {
      ...process.env,
      TIMEKEEPER_DB: join(directory, "app", "timekeeper.db"),
      TIMEKEEPER_PORT: String(port),
    },
    stdio: "ignore",
  });
  let spawnError;
  child.on("error", (error) => {
    spawnError = error;
  });
  try {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`Sidecar exited with code ${child.exitCode}`);
      try {
        const health = await fetch(`http://127.0.0.1:${port}/health`);
        const catalog = await fetch(`http://127.0.0.1:${port}/api/catalog`);
        if (health.ok && catalog.ok && (await catalog.json()).settings) return;
      } catch {
        // Wait for SQLite initialization and the listening socket.
      }
      await new Promise((wait) => setTimeout(wait, 200));
    }
    throw new Error("Sidecar did not serve /health and /api/catalog within 12 seconds");
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await Promise.race([
        new Promise((exited) => child.once("exit", exited)),
        new Promise((wait) => setTimeout(wait, 2000)),
      ]);
    }
    await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  }
}

try {
  if (process.argv.includes("--force-fallback"))
    throw new Error("Fallback requested for verification");
  await writeFile(
    config,
    JSON.stringify({
      main: bundle,
      output: blob,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    }),
  );
  execFileSync(process.execPath, ["--experimental-sea-config", config], {
    cwd: root,
    stdio: "inherit",
  });
  await copyFile(process.execPath, binary);
  const args = [
    resolve(root, "node_modules/postject/dist/cli.js"),
    binary,
    "NODE_SEA_BLOB",
    blob,
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ];
  if (process.platform === "darwin") args.push("--macho-segment-name", "NODE_SEA");
  execFileSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  await checkSidecar();
  console.log(`SEA sidecar passed SQLite startup: ${binary}`);
} catch (error) {
  // The installer also ships api.cjs, so a plain Node binary can run it as an argument.
  console.warn(`SEA unavailable (${error.message}); checking bundled Node fallback.`);
  await copyFile(process.execPath, binary);
  await checkSidecar();
  console.log(`Bundled Node fallback passed SQLite startup: ${binary}`);
}
