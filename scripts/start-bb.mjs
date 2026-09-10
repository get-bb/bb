import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  stopProcessGroupLeaderFirst,
  supportsProcessGroups,
} from "../packages/process-utils/src/index.ts";

import {
  clearPreparedRuntime,
  clearRuntimeOutputs,
  runtimeSourceFingerprint,
  sealPreparedRuntime,
  validatePreparedRuntime,
} from "./prepared-runtime.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const requireFromRoot = createRequire(resolve(repoRoot, "package.json"));
const WORKTREE_RUNTIME_POLICY_ARG = "--worktree-runtime-policy";
const BUILD_TERMINATION_TIMEOUT_MS = 5_000;
const BUILD_KILL_GRACE_MS = 1_000;

function waitForProcess(child) {
  return new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      resolvePromise({ code, signal });
    });
  });
}

export async function runBuildProcess(request) {
  let child;
  let stopPromise;
  const stopChild = () => {
    stopPromise ??= stopProcessGroupLeaderFirst({
      child,
      timeoutMs: BUILD_TERMINATION_TIMEOUT_MS,
      killGraceMs: BUILD_KILL_GRACE_MS,
    });
  };
  const handleSigint = () => stopChild();
  const handleSigterm = () => stopChild();
  // Register before spawn so a child that becomes ready immediately cannot
  // prompt another process to signal us before the handlers exist.
  process.on("SIGINT", handleSigint);
  process.on("SIGTERM", handleSigterm);

  try {
    child = spawn(request.command, request.args, {
      cwd: request.cwd,
      detached: supportsProcessGroups(),
      env: request.env,
      stdio: "inherit",
    });
    const result = await waitForProcess(child);
    await stopPromise;
    return result;
  } finally {
    process.off("SIGINT", handleSigint);
    process.off("SIGTERM", handleSigterm);
  }
}

async function buildRuntimeArtifacts() {
  const turboEntrypoint = requireFromRoot.resolve("turbo/bin/turbo");
  const result = await runBuildProcess({
    args: [
      turboEntrypoint,
      "run",
      "build",
      "--filter=@bb/bundled-plugins",
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
    command: process.execPath,
    cwd: repoRoot,
    env: {
      ...process.env,
      BB_BUILD_TOOLCHAIN: `${process.version}-${process.platform}-${process.arch}`,
    },
  });
  if (result.code === 0) {
    return;
  }
  if (result.signal !== null) {
    throw new Error(`Runtime build stopped by ${result.signal}`);
  }
  throw new Error(`Runtime build failed with exit code ${result.code ?? 1}`);
}

export async function runNativeModulePreflight({
  checkOnly = false,
  cwd = repoRoot,
  env = process.env,
  nodePath = process.execPath,
  scriptPath = resolve(repoRoot, "scripts/ensure-native-modules.mjs"),
} = {}) {
  // Each check needs a fresh module cache. The process group also lets the
  // launcher stop a blocked download or source build during shutdown.
  const result = await runBuildProcess({
    args: [scriptPath, ...(checkOnly ? ["--check"] : [])],
    command: nodePath,
    cwd,
    env,
  });
  if (result.code === 0) {
    return;
  }
  if (result.signal !== null) {
    throw new Error(`Native module preflight stopped by ${result.signal}`);
  }
  throw new Error(
    `Native module preflight failed with exit code ${result.code ?? 1}`,
  );
}

export function parseStartBbArgs(args) {
  if (args[0] !== WORKTREE_RUNTIME_POLICY_ARG) {
    return { cliArgs: args, useWorktreeRuntimePolicy: false };
  }
  return {
    cliArgs: args.slice(1),
    useWorktreeRuntimePolicy: true,
  };
}

export async function prepareRuntime() {
  let reusable = false;
  try {
    await validatePreparedRuntime(repoRoot);
    reusable = true;
  } catch {}
  await clearPreparedRuntime(repoRoot);
  if (!reusable) await clearRuntimeOutputs(repoRoot);
  await runNativeModulePreflight();
  const sourceFingerprint = runtimeSourceFingerprint(repoRoot);
  await buildRuntimeArtifacts();
  await sealPreparedRuntime(repoRoot, sourceFingerprint);
}

export async function main(args = process.argv.slice(2)) {
  const action = ["prepare", "launch"].includes(args[0])
    ? args.shift()
    : "start";
  if (action === "prepare" && args.length !== 0) {
    throw new Error("Preparation accepts no runtime arguments");
  }
  const parsedArgs = parseStartBbArgs(args);
  if (action !== "launch") await prepareRuntime();
  if (action === "prepare") return;
  if (action === "launch") await validatePreparedRuntime(repoRoot);
  const { resolveWorktreeRuntimePolicy, runBbApp } =
    await import("../packages/bb-app/src/launcher.ts");
  await runBbApp(parsedArgs.cliArgs, {
    beforeServerStart: () => runNativeModulePreflight({ checkOnly: true }),
    worktreePolicy: parsedArgs.useWorktreeRuntimePolicy
      ? resolveWorktreeRuntimePolicy({
          env: process.env,
          homeDir: homedir(),
        })
      : null,
  });
}

const isMainModule =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  await main();
}
