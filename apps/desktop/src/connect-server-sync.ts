import { z } from "zod";
import {
  connectServerId,
  type ServerRegistry,
} from "./server-registry.js";

/** POST /api/v1/plugins/connect/rpc/listAccountServers result body. */
export const connectAccountServerSchema = z
  .object({
    handle: z.string().min(1),
    name: z.string().min(1),
    live: z.boolean(),
    url: z.string().min(1),
  })
  .strict();

export const connectListAccountServersResultSchema = z
  .object({
    servers: z.array(connectAccountServerSchema),
    selfHandle: z.string().min(1),
  })
  .strict();

export type ConnectListAccountServersResult = z.infer<
  typeof connectListAccountServersResultSchema
>;

const rpcSuccessSchema = z
  .object({
    ok: z.literal(true),
    result: connectListAccountServersResultSchema,
  })
  .strict();

const rpcFailureSchema = z
  .object({
    ok: z.literal(false),
    error: z.string().optional(),
  })
  .passthrough();

export const CONNECT_PLUGIN_ID = "connect";
export const LIST_ACCOUNT_SERVERS_RPC = "listAccountServers";
export const CONNECT_SERVER_SYNC_INTERVAL_MS = 10 * 60 * 1000;
export const CONNECT_SERVER_SYNC_MIN_INTERVAL_MS = 60 * 1000;

export type ConnectServerSyncFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json" | "text">>;

export type ConnectServerSyncLog = (message: string) => void;

export interface FetchConnectAccountServersArgs {
  /** Local builtin server origin, e.g. `http://127.0.0.1:38886`. */
  serverUrl: string;
  fetchImpl?: ConnectServerSyncFetch;
}

/**
 * Call the local bb server's connect plugin RPC:
 * `POST /api/v1/plugins/connect/rpc/listAccountServers`
 *
 * Auth is the plugin route "local" policy: `content-type: application/json`
 * on POST (no Origin required when the header is absent). Returns null when
 * the plugin is unavailable, unpaired, or the server is down — callers treat
 * that as a silent no-op.
 */
export async function fetchConnectAccountServers(
  args: FetchConnectAccountServersArgs,
): Promise<ConnectListAccountServersResult | null> {
  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  const base = args.serverUrl.replace(/\/$/u, "");
  const url = `${base}/api/v1/plugins/${encodeURIComponent(CONNECT_PLUGIN_ID)}/rpc/${encodeURIComponent(LIST_ACCOUNT_SERVERS_RPC)}`;

  let response: Pick<Response, "ok" | "status" | "json" | "text">;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    });
  } catch {
    return null;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }

  const success = rpcSuccessSchema.safeParse(body);
  if (success.success) {
    return success.data.result;
  }

  // ok:false, wrong shape, HTTP error body — all map to silent no-op.
  rpcFailureSchema.safeParse(body);
  return null;
}

export interface ApplyConnectServerSyncArgs {
  registry: Pick<ServerRegistry, "upsert" | "removeBySource">;
  result: ConnectListAccountServersResult;
}

/**
 * Upsert connect-source registry rows from an account list; drop connect rows
 * whose handle disappeared. Skips `selfHandle` (the local server's tunnel twin).
 */
export async function applyConnectServerSync(
  args: ApplyConnectServerSyncArgs,
): Promise<{ upsertedIds: string[]; removedIds: string[] }> {
  const keepIds = new Set<string>();
  const upsertedIds: string[] = [];

  for (const server of args.result.servers) {
    if (server.handle === args.result.selfHandle) {
      continue;
    }
    const id = connectServerId(server.handle);
    keepIds.add(id);
    await args.registry.upsert({
      id,
      name: server.name,
      source: "connect",
      url: server.url,
    });
    upsertedIds.push(id);
  }

  const removedIds = await args.registry.removeBySource("connect", keepIds);
  return { upsertedIds, removedIds };
}

export interface CreateConnectServerSyncArgs {
  /** Builtin/local server URL when the runtime is up; null when not. */
  getLocalServerUrl: () => string | null;
  registry: Pick<ServerRegistry, "upsert" | "removeBySource">;
  fetchImpl?: ConnectServerSyncFetch;
  log?: ConnectServerSyncLog;
  now?: () => number;
  intervalMs?: number;
  minIntervalMs?: number;
  setIntervalFn?: (handler: () => void, timeout: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
}

export interface ConnectServerSync {
  /** Start the 10-minute background timer (unref'd so it does not keep the app alive). */
  start(): void;
  stop(): void;
  /** After local runtime attach/spawn — sync immediately. */
  onRuntimeReady(): void;
  /**
   * On servers list() IPC: sync when the last successful/attempted sync is
   * older than minIntervalMs (default 60s).
   */
  onListRequested(): void;
  /** Exposed for tests. */
  syncNow(): Promise<void>;
}

/**
 * Periodically sync Connect account servers into the desktop registry via the
 * local builtin server's connect plugin RPC.
 */
export function createConnectServerSync(
  args: CreateConnectServerSyncArgs,
): ConnectServerSync {
  const intervalMs = args.intervalMs ?? CONNECT_SERVER_SYNC_INTERVAL_MS;
  const minIntervalMs = args.minIntervalMs ?? CONNECT_SERVER_SYNC_MIN_INTERVAL_MS;
  const now = args.now ?? Date.now;
  const setIntervalFn =
    args.setIntervalFn ??
    ((handler: () => void, timeout: number) => setInterval(handler, timeout));
  const clearIntervalFn =
    args.clearIntervalFn ??
    ((handle: unknown) => {
      clearInterval(handle as ReturnType<typeof setInterval>);
    });
  const log = args.log;

  let timer: unknown = null;
  let lastSyncAttemptAt = 0;
  let inFlight: Promise<void> | null = null;
  let loggedFailure = false;

  async function runSync(): Promise<void> {
    lastSyncAttemptAt = now();
    const serverUrl = args.getLocalServerUrl();
    if (serverUrl === null) {
      return;
    }

    const result = await fetchConnectAccountServers({
      serverUrl,
      fetchImpl: args.fetchImpl,
    });
    if (result === null) {
      if (!loggedFailure) {
        loggedFailure = true;
        log?.(
          "connect server sync skipped (plugin disabled, not paired, or local server unavailable)",
        );
      }
      return;
    }

    loggedFailure = false;
    await applyConnectServerSync({
      registry: args.registry,
      result,
    });
  }

  function syncNow(): Promise<void> {
    if (inFlight !== null) {
      return inFlight;
    }
    inFlight = runSync().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function onRuntimeReady(): void {
    void syncNow();
  }

  function onListRequested(): void {
    if (now() - lastSyncAttemptAt < minIntervalMs) {
      return;
    }
    void syncNow();
  }

  function start(): void {
    if (timer !== null) {
      return;
    }
    const handle = setIntervalFn(() => {
      void syncNow();
    }, intervalMs);
    // Electron/Node timers: unref so the interval cannot keep the app alive.
    if (
      typeof handle === "object" &&
      handle !== null &&
      "unref" in handle &&
      typeof handle.unref === "function"
    ) {
      handle.unref();
    }
    timer = handle;
  }

  function stop(): void {
    if (timer === null) {
      return;
    }
    clearIntervalFn(timer);
    timer = null;
  }

  return {
    start,
    stop,
    onRuntimeReady,
    onListRequested,
    syncNow,
  };
}
