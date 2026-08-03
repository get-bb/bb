import {
  bbAppRuntimeVerifyTokens,
  readBbAppRuntimeFile,
  type BbAppRuntimeFile,
} from "@bb/config/app-runtime-file";
import { stopVerifiedProcess } from "@bb/config/verified-process-stop";
import type { VerifiedProcessOps } from "@bb/config/verified-process-stop";

/**
 * A "foreign runtime" is a bb this desktop app did not start: a `bb-app start`
 * from a terminal, a launchd service, or a second desktop build. The desktop
 * finds it by probing the port, then describes it from the runtime file that
 * the launcher writes into the data directory.
 *
 * A bb older than that file reports `null` details. The caller must then offer
 * only "connect" and "quit", because it cannot name or safely stop the process.
 */
export interface ForeignRuntimeDetails {
  dataDir: string;
  pid: number;
  startedAt: string;
  surface: string;
  version: string;
}

export interface ReadForeignRuntimeDetailsArgs {
  dataDir: string | null;
  serverUrl: string;
}

export interface StopForeignRuntimeArgs {
  dataDir: string;
  processOps?: VerifiedProcessOps;
  timeoutMs: number;
}

export type StopForeignRuntimeResult =
  | { kind: "no-runtime-file" }
  | { kind: "not-running" }
  | { kind: "stopped" }
  | { kind: "unverified"; pid: number };

function matchesProbedServer(
  runtimeFile: BbAppRuntimeFile,
  serverUrl: string,
): boolean {
  try {
    return new URL(runtimeFile.serverUrl).host === new URL(serverUrl).host;
  } catch {
    return false;
  }
}

/**
 * Read the details of the bb that answered a probe. Returns `null` when the
 * data directory is unknown, when no runtime file exists, or when the file
 * describes a different server than the one that answered — a stale file from
 * an earlier run on another port must never be used to stop a live process.
 */
export async function readForeignRuntimeDetails(
  args: ReadForeignRuntimeDetailsArgs,
): Promise<ForeignRuntimeDetails | null> {
  if (args.dataDir === null) {
    return null;
  }

  const runtimeFile = await readBbAppRuntimeFile(args.dataDir);
  if (runtimeFile === null) {
    return null;
  }
  if (!matchesProbedServer(runtimeFile, args.serverUrl)) {
    return null;
  }

  return {
    dataDir: args.dataDir,
    pid: runtimeFile.pid,
    startedAt: runtimeFile.startedAt,
    surface: runtimeFile.surface,
    version: runtimeFile.version,
  };
}

export async function stopForeignRuntime(
  args: StopForeignRuntimeArgs,
): Promise<StopForeignRuntimeResult> {
  const runtimeFile = await readBbAppRuntimeFile(args.dataDir);
  if (runtimeFile === null) {
    return { kind: "no-runtime-file" };
  }

  const stopResult = await stopVerifiedProcess({
    pid: runtimeFile.pid,
    processOps: args.processOps,
    signal: "SIGTERM",
    timeoutMs: args.timeoutMs,
    verifyTokens: bbAppRuntimeVerifyTokens(runtimeFile),
  });

  if (stopResult.kind === "unverified") {
    return { kind: "unverified", pid: runtimeFile.pid };
  }
  if (stopResult.kind === "not-running") {
    return { kind: "not-running" };
  }
  return { kind: "stopped" };
}
