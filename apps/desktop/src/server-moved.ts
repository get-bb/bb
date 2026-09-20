import { watch as watchDirectory } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readBbAppRuntimeFile } from "@bb/config/app-runtime-file";
import {
  formatBbAppConfigPath,
  parseBbAppManagedConfig,
} from "@bb/config/bb-app-managed-config";
import { isProcessRunning } from "@bb/config/verified-process-stop";
import type { ConnectCredential } from "@bb/connect-client";
import { SERVER_MOVED_ERROR_CODE } from "@bb/host-daemon-contract";
import {
  readServerMovedFile,
  SERVER_MOVED_FILE_NAME,
  type ServerMovedFile,
} from "@bb/server-archive";
import { z } from "zod";
import type { ServerProbeFetch } from "./server-probe.js";
import {
  normalizeCustomServerUrl,
  type ConnectServerRef,
  type ServerTargetFs,
  type ServerTargetStore,
} from "./server-target.js";

export const SERVER_MOVE_NOTICE_FILE_NAME = "server-move-notice.json";
export const SERVER_MOVED_WATCH_DEBOUNCE_MS = 500;
export const SERVER_MOVED_POLL_INTERVAL_MS = 2_000;
export const SERVER_MOVE_DESTINATION_TIMEOUT_MS = 60_000;
export const SERVER_MOVE_DESTINATION_INTERVAL_MS = 1_000;
export const SERVER_MOVE_COMMIT_TIMEOUT_MS = 120_000;
export const SERVER_MOVE_COMMIT_INTERVAL_MS = 1_000;

const CONNECT_MACHINE_CREDENTIAL_HEADER = "x-bb-connect-machine";
const SERVER_MOVED_STATUS = 410;
const DESTINATION_REQUEST_TIMEOUT_MS = 1_000;

export type ServerMovedTarget =
  | { kind: "connect"; server: ConnectServerRef }
  | { kind: "custom"; url: string };

export interface DesktopServerMove {
  moveId: string;
  target: ServerMovedTarget;
  toHostName: string;
}

export interface ServerMovedNotice {
  detail: string;
  message: string;
}

type ResolveServerMovedTargetResult =
  | { ok: true; target: ServerMovedTarget }
  | { ok: false; reason: string };

interface ReadServerMovedLockArgs {
  dataDir: string;
  logWarning(message: string): void;
}

export interface ServerMoveNoticeStore {
  hasShown(moveId: string): Promise<boolean>;
  markShown(moveId: string): Promise<void>;
}

interface CreateServerMoveNoticeStoreArgs {
  fs?: ServerTargetFs;
  storagePath: string;
}

interface ApplyServerMoveArgs {
  move: DesktopServerMove;
  noticeStore: ServerMoveNoticeStore;
  showNotice(notice: ServerMovedNotice): void;
  targetStore: Pick<
    ServerTargetStore,
    "getTarget" | "setConnectServer" | "setCustomServerUrl"
  >;
}

interface ApplyServerMoveResult {
  noticeShown: boolean;
  switched: boolean;
}

interface EnsureServerMovedRuntimeArgs {
  hasLocalRuntime(): boolean;
  isLocalAddressFree(): Promise<boolean>;
  logInfo(message: string): void;
  localServerUrl: string;
  startLocalRuntime(): Promise<void>;
}

type EnsureServerMovedRuntimeResult = "external" | "kept" | "started";

interface ServerMovedWatcherHandle {
  close(): void;
  on(event: "error", listener: (error: Error) => void): unknown;
}

type WatchServerMovedDirectory = (
  dataDir: string,
  listener: (eventType: string, filename: string | null) => void,
) => ServerMovedWatcherHandle;

type ScheduleServerMovedCheck = (
  callback: () => void,
  delayMs: number,
) => () => void;

interface CreateServerMovedWatcherArgs {
  confirmMove(
    move: DesktopServerMove,
    isCancelled: () => boolean,
  ): Promise<boolean>;
  dataDir: string;
  debounceMs: number;
  logWarning(message: string): void;
  onMove(move: DesktopServerMove): void;
  pollIntervalMs: number;
  schedule?: ScheduleServerMovedCheck;
  watch?: WatchServerMovedDirectory;
}

export interface ServerMovedWatcher {
  start(): void;
  stop(): void;
}

export type LocalServerMoveProbe =
  | "answered"
  | "moved"
  | "refused"
  | "unanswered";

interface ProbeLocalServerMoveArgs {
  fetchImpl?: ServerProbeFetch;
  serverUrl: string;
  timeoutMs: number;
}

interface HasLiveBbAppLauncherArgs {
  dataDir: string;
  isRunning?: (pid: number) => boolean;
}

export type ServerMoveCommitResult =
  | "cancelled"
  | "committed"
  | "timed-out"
  | "withdrawn";

interface WaitForCommittedServerMoveArgs {
  dataDir: string;
  hasLiveLocalLauncher(): Promise<boolean>;
  intervalMs: number;
  isCancelled(): boolean;
  logWarning(message: string): void;
  move: DesktopServerMove;
  now?: () => number;
  probeLocalServer(): Promise<LocalServerMoveProbe>;
  sleep?: (delayMs: number) => Promise<void>;
  timeoutMs: number;
}

interface ReadServerMovedConnectCredentialArgs {
  dataDir: string;
  logWarning(message: string): void;
  move: DesktopServerMove;
  remoteServerUrl: string;
}

interface WaitForServerMoveDestinationArgs {
  fetchImpl: ServerProbeFetch;
  intervalMs: number;
  isCancelled(): boolean;
  now?: () => number;
  serverUrl: string;
  sleep?: (delayMs: number) => Promise<void>;
  timeoutMs: number;
}

const serverMoveNoticeFileSchema = z
  .object({
    moveId: z.string().min(1),
  })
  .strict();

const serverMovedResponseSchema = z
  .object({
    code: z.literal(SERVER_MOVED_ERROR_CODE),
  })
  .passthrough();

const connectionRefusedErrorSchema = z
  .object({
    code: z.literal("ECONNREFUSED"),
  })
  .passthrough();

const serverMoveDestinationHealthSchema = z
  .object({
    ok: z.literal(true),
    serverMove: z
      .object({
        state: z.string(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const defaultNoticeFs: ServerTargetFs = {
  mkdir,
  readFile,
  writeFile,
};

const scheduleWithTimer: ScheduleServerMovedCheck = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  return () => {
    clearTimeout(timer);
  };
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isConnectionRefused(error: unknown): boolean {
  if (connectionRefusedErrorSchema.safeParse(error).success) {
    return true;
  }
  return (
    error instanceof Error &&
    (connectionRefusedErrorSchema.safeParse(error.cause).success ||
      error.message.includes("ERR_CONNECTION_REFUSED"))
  );
}

async function sleepFor(delayMs: number): Promise<void> {
  await new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, delayMs);
  });
}

export function resolveServerMovedTarget(
  file: ServerMovedFile,
): ResolveServerMovedTargetResult {
  const url = normalizeCustomServerUrl(file.serverUrl);
  if (url === null) {
    return {
      ok: false,
      reason: `serverUrl ${JSON.stringify(file.serverUrl)} is not an http(s) URL`,
    };
  }
  if (file.mode === "direct") {
    return { ok: true, target: { kind: "custom", url } };
  }
  if (file.connectHandle === null) {
    return { ok: false, reason: "a bb Connect move has no connectHandle" };
  }
  return {
    ok: true,
    target: {
      kind: "connect",
      server: { handle: file.connectHandle, name: file.toHostName, url },
    },
  };
}

export async function readServerMovedLock(
  args: ReadServerMovedLockArgs,
): Promise<DesktopServerMove | null> {
  const lockPath = join(args.dataDir, SERVER_MOVED_FILE_NAME);
  let file: ServerMovedFile | null;
  try {
    file = await readServerMovedFile(args.dataDir);
  } catch (error) {
    args.logWarning(`[desktop] ignoring ${lockPath}: ${errorMessage(error)}`);
    return null;
  }
  if (file === null) {
    return null;
  }
  const resolved = resolveServerMovedTarget(file);
  if (!resolved.ok) {
    args.logWarning(`[desktop] ignoring ${lockPath}: ${resolved.reason}`);
    return null;
  }
  return {
    moveId: file.moveId,
    target: resolved.target,
    toHostName: file.toHostName,
  };
}

export function formatServerMovedNotice(
  move: DesktopServerMove,
): ServerMovedNotice {
  return {
    detail: `bb now opens the server on ${move.toHostName}. This computer stays connected to it as a regular machine.`,
    message: `Your bb server moved to ${move.toHostName}`,
  };
}

export function createServerMoveNoticeStore(
  args: CreateServerMoveNoticeStoreArgs,
): ServerMoveNoticeStore {
  const fsImpl = args.fs ?? defaultNoticeFs;

  async function readShownMoveId(): Promise<string | null> {
    let raw: string;
    try {
      raw = await fsImpl.readFile(args.storagePath, "utf8");
    } catch {
      return null;
    }
    try {
      const parsed = serverMoveNoticeFileSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data.moveId : null;
    } catch {
      return null;
    }
  }

  return {
    async hasShown(moveId) {
      return (await readShownMoveId()) === moveId;
    },
    async markShown(moveId) {
      await fsImpl.mkdir(dirname(args.storagePath), { recursive: true });
      await fsImpl.writeFile(
        args.storagePath,
        `${JSON.stringify({ moveId }, null, 2)}\n`,
        "utf8",
      );
    },
  };
}

export async function applyServerMove(
  args: ApplyServerMoveArgs,
): Promise<ApplyServerMoveResult> {
  const alreadyNoticed = await args.noticeStore.hasShown(args.move.moveId);
  const switched =
    !alreadyNoticed || args.targetStore.getTarget().kind === "builtin";
  if (switched) {
    if (args.move.target.kind === "connect") {
      await args.targetStore.setConnectServer(args.move.target.server);
    } else {
      await args.targetStore.setCustomServerUrl(args.move.target.url);
    }
  }
  if (alreadyNoticed) {
    return { noticeShown: false, switched };
  }
  await args.noticeStore.markShown(args.move.moveId);
  args.showNotice(formatServerMovedNotice(args.move));
  return { noticeShown: true, switched };
}

export async function ensureServerMovedRuntime(
  args: EnsureServerMovedRuntimeArgs,
): Promise<EnsureServerMovedRuntimeResult> {
  if (args.hasLocalRuntime()) {
    return "kept";
  }
  if (!(await args.isLocalAddressFree())) {
    args.logInfo(
      `[desktop] another bb process answers at ${args.localServerUrl}; not starting a machine runtime from this app`,
    );
    return "external";
  }
  await args.startLocalRuntime();
  return "started";
}

export function createServerMovedWatcher(
  args: CreateServerMovedWatcherArgs,
): ServerMovedWatcher {
  const watch: WatchServerMovedDirectory =
    args.watch ?? ((dataDir, listener) => watchDirectory(dataDir, listener));
  const schedule = args.schedule ?? scheduleWithTimer;
  let active = false;
  let watcher: ServerMovedWatcherHandle | null = null;
  let cancelDebouncedCheck: (() => void) | null = null;
  let cancelPoll: (() => void) | null = null;
  let generation = 0;
  let checking = false;
  let recheckRequested = false;
  let deliveredMoveId: string | null = null;

  function closeWatcher(): void {
    const current = watcher;
    watcher = null;
    current?.close();
  }

  async function readCommittedMove(
    checkGeneration: number,
  ): Promise<DesktopServerMove | null> {
    const move = await readServerMovedLock({
      dataDir: args.dataDir,
      logWarning: args.logWarning,
    });
    if (
      checkGeneration !== generation ||
      move === null ||
      move.moveId === deliveredMoveId
    ) {
      return null;
    }
    const committed = await args.confirmMove(
      move,
      () => checkGeneration !== generation,
    );
    return committed && checkGeneration === generation ? move : null;
  }

  async function checkLock(): Promise<void> {
    if (checking) {
      recheckRequested = true;
      return;
    }
    checking = true;
    recheckRequested = false;
    let move: DesktopServerMove | null;
    try {
      move = await readCommittedMove(generation);
    } finally {
      checking = false;
    }
    if (move !== null) {
      deliveredMoveId = move.moveId;
      args.onMove(move);
      return;
    }
    if (recheckRequested && active) {
      recheckRequested = false;
      scheduleCheck();
    }
  }

  function scheduleCheck(): void {
    cancelDebouncedCheck?.();
    cancelDebouncedCheck = schedule(() => {
      cancelDebouncedCheck = null;
      void checkLock();
    }, args.debounceMs);
  }

  function schedulePoll(): void {
    const pollGeneration = generation;
    cancelPoll = schedule(() => {
      cancelPoll = null;
      void checkLock().then(() => {
        if (pollGeneration === generation) {
          schedulePoll();
        }
      });
    }, args.pollIntervalMs);
  }

  function fallBackToPolling(reason: string): void {
    closeWatcher();
    cancelPoll?.();
    args.logWarning(
      `[desktop] ${reason}; checking ${join(args.dataDir, SERVER_MOVED_FILE_NAME)} every ${args.pollIntervalMs}ms instead`,
    );
    schedulePoll();
  }

  function startWatching(): void {
    const startGeneration = generation;
    try {
      watcher = watch(args.dataDir, (_eventType, filename) => {
        if (filename !== null && filename !== SERVER_MOVED_FILE_NAME) {
          return;
        }
        scheduleCheck();
      });
    } catch (error) {
      fallBackToPolling(
        `could not watch ${args.dataDir} for a server move: ${errorMessage(error)}`,
      );
      return;
    }
    watcher.on("error", (error) => {
      if (startGeneration !== generation) {
        return;
      }
      fallBackToPolling(
        `stopped watching ${args.dataDir} for a server move: ${errorMessage(error)}`,
      );
    });
  }

  return {
    start() {
      if (active) {
        return;
      }
      active = true;
      generation += 1;
      startWatching();
      scheduleCheck();
    },
    stop() {
      active = false;
      generation += 1;
      cancelDebouncedCheck?.();
      cancelDebouncedCheck = null;
      cancelPoll?.();
      cancelPoll = null;
      closeWatcher();
    },
  };
}

export async function probeLocalServerMove(
  args: ProbeLocalServerMoveArgs,
): Promise<LocalServerMoveProbe> {
  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetchImpl(new URL("/health", args.serverUrl).toString(), {
      signal: AbortSignal.timeout(args.timeoutMs),
    });
  } catch (error) {
    return isConnectionRefused(error) ? "refused" : "unanswered";
  }
  if (response.status !== SERVER_MOVED_STATUS) {
    await response.body?.cancel().catch(() => undefined);
    return "answered";
  }
  try {
    return serverMovedResponseSchema.safeParse(await response.json()).success
      ? "moved"
      : "answered";
  } catch {
    return "answered";
  }
}

export async function hasLiveBbAppLauncher(
  args: HasLiveBbAppLauncherArgs,
): Promise<boolean> {
  const runtimeFile = await readBbAppRuntimeFile(args.dataDir);
  const isRunning = args.isRunning ?? isProcessRunning;
  return runtimeFile !== null && isRunning(runtimeFile.pid);
}

export async function waitForCommittedServerMove(
  args: WaitForCommittedServerMoveArgs,
): Promise<ServerMoveCommitResult> {
  const now = args.now ?? Date.now;
  const sleep = args.sleep ?? sleepFor;
  const deadline = now() + args.timeoutMs;
  while (!args.isCancelled()) {
    const current = await readServerMovedLock({
      dataDir: args.dataDir,
      logWarning: args.logWarning,
    });
    if (current === null || current.moveId !== args.move.moveId) {
      return "withdrawn";
    }
    const probe = await args.probeLocalServer();
    if (
      probe === "moved" ||
      (probe === "refused" && !(await args.hasLiveLocalLauncher()))
    ) {
      return "committed";
    }
    if (now() >= deadline) {
      return "timed-out";
    }
    await sleep(args.intervalMs);
  }
  return "cancelled";
}

export async function readServerMovedConnectCredential(
  args: ReadServerMovedConnectCredentialArgs,
): Promise<ConnectCredential | null> {
  if (
    args.move.target.kind !== "connect" ||
    normalizeCustomServerUrl(args.remoteServerUrl) !==
      args.move.target.server.url
  ) {
    return null;
  }
  const configPath = formatBbAppConfigPath(args.dataDir);
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    args.logWarning(
      `[desktop] could not read ${configPath} for this computer's bb Connect access: ${errorMessage(error)}`,
    );
    return null;
  }
  let config: ReturnType<typeof parseBbAppManagedConfig>;
  try {
    config = parseBbAppManagedConfig(JSON.parse(raw));
  } catch (error) {
    args.logWarning(
      `[desktop] ignoring ${configPath} for bb Connect access: ${errorMessage(error)}`,
    );
    return null;
  }
  const credential =
    config.serverHeaders?.[CONNECT_MACHINE_CREDENTIAL_HEADER]?.trim() ?? "";
  if (
    credential.length === 0 ||
    config.serverUrl === undefined ||
    normalizeCustomServerUrl(config.serverUrl) !== args.move.target.server.url
  ) {
    return null;
  }
  return {
    credential,
    handle: args.move.target.server.handle,
    serverUrl: args.move.target.server.url,
  };
}

async function isServerMoveDestinationReady(
  fetchImpl: ServerProbeFetch,
  healthUrl: string,
): Promise<boolean> {
  try {
    const response = await fetchImpl(healthUrl, {
      signal: AbortSignal.timeout(DESTINATION_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return false;
    }
    const parsed = serverMoveDestinationHealthSchema.safeParse(
      await response.json(),
    );
    return parsed.success && parsed.data.serverMove?.state !== "pending";
  } catch {
    return false;
  }
}

export async function waitForServerMoveDestination(
  args: WaitForServerMoveDestinationArgs,
): Promise<boolean> {
  const now = args.now ?? Date.now;
  const sleep = args.sleep ?? sleepFor;
  const deadline = now() + args.timeoutMs;
  const healthUrl = new URL("/health", args.serverUrl).toString();
  while (!args.isCancelled()) {
    if (await isServerMoveDestinationReady(args.fetchImpl, healthUrl)) {
      return true;
    }
    if (now() >= deadline) {
      return false;
    }
    await sleep(args.intervalMs);
  }
  return false;
}
