import { dirname } from "node:path";
import { delimiter } from "node:path";
import { sanitizeInheritedChildProcessEnv } from "@bb/process-utils";
import { z } from "zod";
import type { FetchFn } from "../server-client.js";
import { CommandDispatchError } from "../command-dispatch-support.js";
import type { DetachedProcessSpawner } from "./service-manager.js";

export const SERVER_MOVE_START_FAILED = "server_move_start_failed";

const HEALTH_REQUEST_TIMEOUT_MS = 2_000;
const PROCESS_POLL_INTERVAL_MS = 100;

const pendingHealthSchema = z.object({
  serverMove: z
    .object({
      state: z.string(),
      moveId: z.string(),
    })
    .optional(),
});

const pendingVerificationSchema = z.object({
  moveId: z.string(),
  verified: z.boolean(),
  message: z.string().nullable(),
});

export interface PendingServerLaunchRequest {
  bbServerEntry: string;
  dataDir: string;
  serverPort: number;
  bindHost: string | null;
  hostDaemonPort: number | null;
  env: NodeJS.ProcessEnv;
  logPath: string;
}

export type PendingServerLauncher = (
  request: PendingServerLaunchRequest,
) => Promise<number>;

export interface WaitForPendingServerArgs {
  fetchFn: FetchFn;
  localServerUrl: string;
  moveId: string;
  pid: number;
  logPath: string;
  timeoutMs: number;
  pollIntervalMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  signal: AbortSignal;
}

export interface StopProcessGroupArgs {
  pid: number;
  timeoutMs: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export function createPendingServerEnv(
  env: NodeJS.ProcessEnv,
  hostDaemonPort: number | null,
): NodeJS.ProcessEnv {
  const sanitized = sanitizeInheritedChildProcessEnv({ env });
  const executableDirectory = dirname(process.execPath);
  return {
    ...sanitized,
    PATH:
      sanitized.PATH === undefined
        ? executableDirectory
        : `${executableDirectory}${delimiter}${sanitized.PATH}`,
    ...(hostDaemonPort === null
      ? {}
      : { BB_HOST_DAEMON_PORT: String(hostDaemonPort) }),
  };
}

export function createDefaultPendingServerLauncher(
  spawnDetached: DetachedProcessSpawner,
): PendingServerLauncher {
  return (request) =>
    spawnDetached({
      command: process.execPath,
      args: [
        request.bbServerEntry,
        "--data-dir",
        request.dataDir,
        "--server-port",
        String(request.serverPort),
        ...(request.hostDaemonPort === null
          ? []
          : ["--host-daemon-port", String(request.hostDaemonPort)]),
        ...(request.bindHost === null
          ? []
          : ["--server-bind-host", request.bindHost]),
      ],
      env: request.env,
      logPath: request.logPath,
    });
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, signal);
      return true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EPERM") {
        return true;
      }
    }
  }
  return false;
}

export function isProcessGroupAlive(pid: number): boolean {
  return signalProcessGroup(pid, 0);
}

export async function stopProcessGroup(
  args: StopProcessGroupArgs,
): Promise<void> {
  if (!signalProcessGroup(args.pid, "SIGTERM")) {
    return;
  }
  const deadline = args.now() + args.timeoutMs;
  while (args.now() < deadline) {
    if (!isProcessGroupAlive(args.pid)) {
      return;
    }
    await args.sleep(PROCESS_POLL_INTERVAL_MS);
  }
  signalProcessGroup(args.pid, "SIGKILL");
  const killDeadline = args.now() + 2_000;
  while (args.now() < killDeadline && isProcessGroupAlive(args.pid)) {
    await args.sleep(PROCESS_POLL_INTERVAL_MS);
  }
}

interface FetchJsonArgs {
  fetchFn: FetchFn;
  url: string;
  signal: AbortSignal;
  timeoutMs: number;
}

async function fetchJson(args: FetchJsonArgs): Promise<unknown> {
  const response = await args.fetchFn(args.url, {
    method: "GET",
    signal: AbortSignal.any([args.signal, AbortSignal.timeout(args.timeoutMs)]),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

function baseUrl(url: string): string {
  return url.replace(/\/+$/u, "");
}

export async function readPendingServerMoveId(args: {
  fetchFn: FetchFn;
  serverUrl: string;
  signal: AbortSignal;
  timeoutMs: number;
}): Promise<string | null> {
  const health = pendingHealthSchema.parse(
    await fetchJson({
      fetchFn: args.fetchFn,
      url: `${baseUrl(args.serverUrl)}/health`,
      signal: args.signal,
      timeoutMs: args.timeoutMs,
    }),
  );
  return health.serverMove?.moveId ?? null;
}

export async function waitForPendingServer(
  args: WaitForPendingServerArgs,
): Promise<void> {
  const deadline = args.now() + args.timeoutMs;
  let lastMessage = "The server did not answer yet";
  while (args.now() < deadline) {
    args.signal.throwIfAborted();
    if (!isProcessGroupAlive(args.pid)) {
      throw new CommandDispatchError(
        SERVER_MOVE_START_FAILED,
        `The imported server exited before it became ready. See ${args.logPath}`,
      );
    }
    try {
      const moveId = await readPendingServerMoveId({
        fetchFn: args.fetchFn,
        serverUrl: args.localServerUrl,
        signal: args.signal,
        timeoutMs: HEALTH_REQUEST_TIMEOUT_MS,
      });
      if (moveId !== args.moveId) {
        lastMessage =
          moveId === null
            ? "The server at the target port is not in pending move mode"
            : `The server at the target port belongs to move ${moveId}`;
      } else {
        const verification = pendingVerificationSchema.parse(
          await fetchJson({
            fetchFn: args.fetchFn,
            url: `${baseUrl(args.localServerUrl)}/internal/server-move/pending`,
            signal: args.signal,
            timeoutMs: HEALTH_REQUEST_TIMEOUT_MS,
          }),
        );
        if (verification.moveId === args.moveId && verification.verified) {
          return;
        }
        lastMessage =
          verification.message ?? "The imported server is not verified yet";
      }
    } catch (error) {
      args.signal.throwIfAborted();
      lastMessage = error instanceof Error ? error.message : String(error);
    }
    await args.sleep(args.pollIntervalMs);
  }
  throw new CommandDispatchError(
    SERVER_MOVE_START_FAILED,
    `The imported server did not become ready within ${Math.round(args.timeoutMs / 1000)}s: ${lastMessage}. See ${args.logPath}`,
  );
}
