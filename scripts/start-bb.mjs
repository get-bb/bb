import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureNativeModules } from "./ensure-native-modules.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const requireFromRoot = createRequire(resolve(repoRoot, "package.json"));

function waitForProcess(child) {
  return new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      resolvePromise({ code, signal });
    });
  });
}

async function buildRuntimeArtifacts() {
  const turboEntrypoint = requireFromRoot.resolve("turbo/bin/turbo");
  const child = spawn(
    process.execPath,
    [
      turboEntrypoint,
      "run",
      "build",
      "--filter=@get-bb/plugin-sdk",
      "--filter=@bb/app",
      "--filter=@bb/server",
      "--filter=@bb/host-daemon",
      "--concurrency=2",
      "--output-logs=none",
      "--log-prefix=none",
      "--summarize=false",
      "--no-update-notifier",
    ],
    {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    },
  );
  const result = await waitForProcess(child);
  if (result.code === 0) {
    return;
  }
  if (result.signal !== null) {
    throw new Error(`Runtime build stopped by ${result.signal}`);
  }
  throw new Error(`Runtime build failed with exit code ${result.code ?? 1}`);
}

async function buildBundledPlugins() {
  const child = spawn(
    process.execPath,
    [
      "--conditions=source",
      "--import",
      "tsx",
      resolve(repoRoot, "apps/server/scripts/copy-builtin-plugins.ts"),
    ],
    {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    },
  );
  const result = await waitForProcess(child);
  if (result.code === 0) {
    return;
  }
  if (result.signal !== null) {
    throw new Error(`Bundled plugin build stopped by ${result.signal}`);
  }
  throw new Error(
    `Bundled plugin build failed with exit code ${result.code ?? 1}`,
  );
}

await buildRuntimeArtifacts();
await buildBundledPlugins();
ensureNativeModules({ repoRoot });

const { runBbApp } = await import("../packages/bb-app/src/index.ts");
await runBbApp();
