import {
  bbAppRuntimeVerifyTokens,
  clearOwnBbAppRuntimeFile,
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
  entryPath: string;
  pid: number;
  startedAt: string;
  surface: string;
  version: string;
}

interface ReadForeignRuntimeDetailsArgs {
  dataDir: string | null;
  serverUrl: string;
}

interface StopForeignRuntimeArgs {
  /** The record the person saw and approved, not a fresh read. */
  details: ForeignRuntimeDetails;
  killTimeoutMs: number;
  processOps?: VerifiedProcessOps;
  timeoutMs: number;
}

type StopForeignRuntimeResult =
  | { kind: "not-running" }
  | { kind: "replaced" }
  | { kind: "still-running"; pid: number }
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
    entryPath: runtimeFile.entryPath,
    pid: runtimeFile.pid,
    startedAt: runtimeFile.startedAt,
    surface: runtimeFile.surface,
    version: runtimeFile.version,
  };
}

/**
 * Stop the exact bb the person approved in the dialog.
 *
 * The dialog waits for a person, which can take any amount of time, and another
 * launcher can replace the record during that wait. So this re-reads the record
 * and refuses to act when it no longer describes what the dialog showed, rather
 * than stopping a process nobody was asked about.
 */
export async function stopForeignRuntime(
  args: StopForeignRuntimeArgs,
): Promise<StopForeignRuntimeResult> {
  const current = await readBbAppRuntimeFile(args.details.dataDir);
  if (
    current !== null &&
    (current.pid !== args.details.pid ||
      current.startedAt !== args.details.startedAt)
  ) {
    return { kind: "replaced" };
  }

  const stopResult = await stopVerifiedProcess({
    killTimeoutMs: args.killTimeoutMs,
    pid: args.details.pid,
    processOps: args.processOps,
    signal: "SIGTERM",
    startedAt: args.details.startedAt,
    timeoutMs: args.timeoutMs,
    verifyTokens: bbAppRuntimeVerifyTokens(args.details.entryPath),
  });

  if (stopResult.kind === "unverified") {
    return { kind: "unverified", pid: args.details.pid };
  }
  if (stopResult.kind === "still-running") {
    return { kind: "still-running", pid: args.details.pid };
  }
  if (stopResult.kind === "not-running") {
    return { kind: "not-running" };
  }
  // A SIGKILLed launcher never runs its own cleanup, so clear the record it
  // left behind, but only while it still names the process that was stopped.
  await clearOwnBbAppRuntimeFile({
    dataDir: args.details.dataDir,
    pid: args.details.pid,
  });
  return { kind: "stopped" };
}
