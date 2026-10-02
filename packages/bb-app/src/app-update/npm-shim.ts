import { join } from "node:path";
import semver from "semver";
import {
  APP_UPDATE_RESTART_EXIT_CODE,
  readAppUpdateStateFile,
  type AppUpdateState,
  type InstalledNpmAppRevision,
  type NpmAppRevision,
} from "@bb/config/app-update";
import type { ChildProcessExitResult } from "@bb/config/child-process-exit";
import { isUsableNpmRevision } from "./npm-revision.js";
import {
  acquireShimLock,
  createLauncherEnv,
  installShimSignalForwarding,
  spawnLauncherProcess,
  toShimExitCode,
  type AcquireShimLock,
  type LauncherRun,
  type LauncherUpdateMode,
  type ShimOutput,
} from "./shim-support.js";

export interface RunNpmShimArgs {
  acquireLock?: AcquireShimLock;
  bundled: NpmAppRevision;
  dataDir: string;
  isUsable?: (revision: NpmAppRevision) => boolean;
  nodeAbi?: string;
  output: ShimOutput;
  spawnLauncher: (
    revision: NpmAppRevision,
    mode: LauncherUpdateMode,
  ) => LauncherRun;
  useBundled: boolean;
}

export interface NpmRevisionSelection {
  reason: "abi-mismatch" | "bundled-newer" | "installed-newer" | "none";
  revision: NpmAppRevision;
}

export function selectNpmRevision(args: {
  bundled: NpmAppRevision;
  current: InstalledNpmAppRevision | null;
  isUsable: (revision: NpmAppRevision) => boolean;
  nodeAbi: string;
}): NpmRevisionSelection {
  const current = args.current;
  if (current === null || !args.isUsable(current)) {
    return { reason: "none", revision: args.bundled };
  }
  if (
    semver.valid(current.version) === null ||
    semver.valid(args.bundled.version) === null ||
    !semver.gt(current.version, args.bundled.version)
  ) {
    return { reason: "bundled-newer", revision: args.bundled };
  }
  if (current.nodeAbi !== args.nodeAbi) {
    return { reason: "abi-mismatch", revision: args.bundled };
  }
  return { reason: "installed-newer", revision: current };
}

export function spawnNpmLauncher(args: {
  cliArgs: string[];
  mode: LauncherUpdateMode;
  revision: NpmAppRevision;
}): LauncherRun {
  return spawnLauncherProcess({
    args: [
      join(args.revision.packageRoot, "dist", "bb-app.js"),
      ...args.cliArgs,
    ],
    env: createLauncherEnv(args.mode),
  });
}

export async function runNpmShim(args: RunNpmShimArgs): Promise<number> {
  const isUsable = args.isUsable ?? isUsableNpmRevision;
  const nodeAbi = args.nodeAbi ?? process.versions.modules;
  let useBundled = args.useBundled;
  let shuttingDown = false;
  let running: LauncherRun | null = null;
  const removeSignalForwarding = installShimSignalForwarding({
    current: () => running,
    onShutdown: () => {
      shuttingDown = true;
    },
  });

  const select = (state: AppUpdateState): NpmAppRevision => {
    if (useBundled) return args.bundled;
    const selection = selectNpmRevision({
      bundled: args.bundled,
      current: state.current,
      isUsable,
      nodeAbi,
    });
    if (selection.reason === "installed-newer") {
      args.output.info(
        `Using bb-app ${selection.revision.version} from an in-app update. Run with --bundled to use ${args.bundled.version}.`,
      );
    } else if (selection.reason === "abi-mismatch" && state.current !== null) {
      args.output.warn(
        `bb-app ${state.current.version} from an in-app update was installed for a different Node.js version; using ${args.bundled.version}.`,
      );
    }
    return selection.revision;
  };

  const run = async (
    revision: NpmAppRevision,
    mode: LauncherUpdateMode,
  ): Promise<ChildProcessExitResult> => {
    running = args.spawnLauncher(revision, mode);
    const exit = await running.exit;
    running = null;
    return exit;
  };

  const lock = await (args.acquireLock ?? acquireShimLock)(args.dataDir);
  try {
    const initialState = await readAppUpdateStateFile(args.dataDir);
    if (lock === null) {
      args.output.info(
        "Another bb-app is managing this data directory; in-app updates are off for this run.",
      );
      return toShimExitCode(
        await run(
          initialState === null ? args.bundled : select(initialState),
          "passive",
        ),
      );
    }
    if (initialState === null) {
      args.output.info(
        "bb-app-update.json was written by a newer bb; in-app updates are off for this run.",
      );
      return toShimExitCode(await run(args.bundled, "passive"));
    }
    let launch = select(initialState);
    for (;;) {
      const exit = await run(launch, "npm");
      if (exit.code !== APP_UPDATE_RESTART_EXIT_CODE) {
        return toShimExitCode(exit);
      }
      if (shuttingDown) return 0;
      useBundled = false;
      const state = await readAppUpdateStateFile(args.dataDir);
      if (state !== null) launch = select(state);
    }
  } finally {
    removeSignalForwarding();
    await lock?.release();
  }
}
