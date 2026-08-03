import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createNodeVerifiedProcessOps,
  stopVerifiedProcess,
  type VerifiedProcessOps,
  type WaitForProcessExitArgs,
} from "@bb/config/verified-process-stop";
import { z } from "zod";

const OWNED_RUNTIME_PID_FILE_NAME = "owned-runtime.json";

const ownedRuntimePidFileSchema = z.object({
  bridgePath: z.string().min(1),
  pid: z.number().int().positive(),
  serverUrl: z.string().min(1),
  startedAt: z.string().min(1),
});

export type ReapStaleOwnedRuntimeResult =
  | ClearedStaleOwnedRuntimePidFileResult
  | NoStaleOwnedRuntimePidFileResult
  | ReapedStaleOwnedRuntimeResult
  | SkippedStaleOwnedRuntimeResult;

export interface OwnedRuntimePidFile {
  bridgePath: string;
  pid: number;
  serverUrl: string;
  startedAt: string;
}

export interface WriteOwnedRuntimePidFileArgs {
  bridgePath: string;
  pid: number;
  serverUrl: string;
  userDataPath: string;
}

export interface ClearOwnedRuntimePidFileArgs {
  userDataPath: string;
}

export interface ReadOwnedRuntimePidFileArgs {
  userDataPath: string;
}

export interface ReapStaleOwnedRuntimeArgs {
  processOps?: OwnedRuntimeProcessOps;
  signal: NodeJS.Signals;
  timeoutMs: number;
  userDataPath: string;
}

export type OwnedRuntimeProcessOps = VerifiedProcessOps;
export type { WaitForProcessExitArgs };

export interface NoStaleOwnedRuntimePidFileResult {
  kind: "no-pid-file";
}

export interface ClearedStaleOwnedRuntimePidFileResult {
  kind: "cleared-stale-pid-file";
  pid: number;
}

export interface ReapedStaleOwnedRuntimeResult {
  kind: "reaped";
  pid: number;
}

export interface SkippedStaleOwnedRuntimeResult {
  command: string | null;
  kind: "skipped-unverified-process";
  pid: number;
}

function ownedRuntimePidFilePath(userDataPath: string): string {
  return join(userDataPath, OWNED_RUNTIME_PID_FILE_NAME);
}

export function createNodeOwnedRuntimeProcessOps(): OwnedRuntimeProcessOps {
  return createNodeVerifiedProcessOps();
}

export async function writeOwnedRuntimePidFile(
  args: WriteOwnedRuntimePidFileArgs,
): Promise<void> {
  const pidFile: OwnedRuntimePidFile = {
    bridgePath: args.bridgePath,
    pid: args.pid,
    serverUrl: args.serverUrl,
    startedAt: new Date().toISOString(),
  };
  await mkdir(args.userDataPath, { recursive: true });
  await writeFile(
    ownedRuntimePidFilePath(args.userDataPath),
    `${JSON.stringify(pidFile, null, 2)}\n`,
    "utf8",
  );
}

export async function clearOwnedRuntimePidFile(
  args: ClearOwnedRuntimePidFileArgs,
): Promise<void> {
  await rm(ownedRuntimePidFilePath(args.userDataPath), { force: true });
}

export async function readOwnedRuntimePidFile(
  args: ReadOwnedRuntimePidFileArgs,
): Promise<OwnedRuntimePidFile | null> {
  try {
    const rawPidFile = await readFile(
      ownedRuntimePidFilePath(args.userDataPath),
      "utf8",
    );
    const parsed = ownedRuntimePidFileSchema.safeParse(JSON.parse(rawPidFile));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function reapStaleOwnedRuntime(
  args: ReapStaleOwnedRuntimeArgs,
): Promise<ReapStaleOwnedRuntimeResult> {
  const processOps = args.processOps ?? createNodeOwnedRuntimeProcessOps();
  const pidFile = await readOwnedRuntimePidFile({
    userDataPath: args.userDataPath,
  });

  if (pidFile === null) {
    return { kind: "no-pid-file" };
  }

  const stopResult = await stopVerifiedProcess({
    pid: pidFile.pid,
    processOps,
    signal: args.signal,
    timeoutMs: args.timeoutMs,
    verifyTokens: [pidFile.bridgePath],
  });

  if (stopResult.kind === "not-running") {
    await clearOwnedRuntimePidFile({ userDataPath: args.userDataPath });
    return {
      kind: "cleared-stale-pid-file",
      pid: pidFile.pid,
    };
  }

  if (stopResult.kind === "unverified") {
    return {
      command: stopResult.command,
      kind: "skipped-unverified-process",
      pid: pidFile.pid,
    };
  }

  await clearOwnedRuntimePidFile({ userDataPath: args.userDataPath });
  return {
    kind: "reaped",
    pid: pidFile.pid,
  };
}
