import { z } from "zod";
import {
  ConnectListError,
  listAccountServers,
  type ConnectCredential,
} from "@bb/connect-client";

/** POST /api/v1/plugins/connect/rpc/listAccountServers result body. */
const connectAccountServerSchema = z
  .object({
    handle: z.string().min(1),
    name: z.string().min(1),
    live: z.boolean(),
    url: z.string().min(1),
  })
  .strict();
export type ConnectAccountServer = z.infer<typeof connectAccountServerSchema>;

const connectListAccountServersResultSchema = z
  .object({
    servers: z.array(connectAccountServerSchema),
    selfHandle: z.string().min(1),
  })
  .strict();

type ConnectListAccountServersResult = z.infer<
  typeof connectListAccountServersResultSchema
>;

const rpcSuccessSchema = z
  .object({
    ok: z.literal(true),
    result: connectListAccountServersResultSchema,
  })
  .strict();

/**
 * `{ ok: false, error }` from the plugin route. A string `error` is the
 * route's own refusal (plugin not running, auth); an object is the structured
 * handler failure, whose `message` carries the connect plugin's stable code.
 */
const rpcFailureSchema = z
  .object({
    ok: z.literal(false),
    error: z.union([
      z.string(),
      z.object({ code: z.string(), message: z.string() }).passthrough(),
    ]),
  })
  .passthrough();

/**
 * Why a sync produced no server list. Every value is actionable from the
 * Server menu, so the menu can say which one it was.
 *
 * - `no-credential`: no local runtime, and the app never enrolled a machine
 *   credential of its own (it gets one after a Connect sign-in via the local
 *   server).
 * - `plugin-disabled`: the local server answered but its connect plugin is
 *   not running.
 * - `not-paired`: the local server's connect plugin is on but not paired.
 * - `unauthorized`: the gate refused the app's cached credential.
 * - `unavailable`: the local server or the gate could not be reached or
 *   answered with something unexpected.
 */
export type ConnectServerSyncSkipReason =
  | "no-credential"
  | "plugin-disabled"
  | "not-paired"
  | "unauthorized"
  | "unavailable";

export type FetchConnectAccountServersResult =
  | { ok: true; result: ConnectListAccountServersResult }
  | { ok: false; reason: ConnectServerSyncSkipReason };

const CONNECT_PLUGIN_ID = "connect";
const LIST_ACCOUNT_SERVERS_RPC = "listAccountServers";
const CONNECT_SERVER_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const CONNECT_SERVER_SYNC_MIN_INTERVAL_MS = 60 * 1000;

type ConnectServerSyncFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json" | "text">>;

type ConnectServerSyncLog = (message: string) => void;

interface FetchConnectAccountServersArgs {
  /** Local builtin server origin, e.g. `http://127.0.0.1:38886`. */
  serverUrl: string;
  fetchImpl?: ConnectServerSyncFetch;
}

/**
 * Call the local bb server's connect plugin RPC:
 * `POST /api/v1/plugins/connect/rpc/listAccountServers`
 *
 * Auth is the plugin route "local" policy: `content-type: application/json`
 * on POST (no Origin required when the header is absent). A failure carries
 * the reason the server gave: HTTP 503 means the plugin is not running,
 * `{ code: "handler_error", message: "not_paired" }` means it is on but
 * unpaired, and anything else (server down, non-JSON, unknown shape) is
 * `unavailable`.
 */
export async function fetchConnectAccountServers(
  args: FetchConnectAccountServersArgs,
): Promise<FetchConnectAccountServersResult> {
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
    return { ok: false, reason: "unavailable" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  const success = rpcSuccessSchema.safeParse(body);
  if (success.success) {
    return { ok: true, result: success.data.result };
  }

  if (response.status === 503) {
    return { ok: false, reason: "plugin-disabled" };
  }
  const failure = rpcFailureSchema.safeParse(body);
  if (
    failure.success &&
    typeof failure.data.error === "object" &&
    failure.data.error.code === "handler_error" &&
    failure.data.error.message === "not_paired"
  ) {
    return { ok: false, reason: "not-paired" };
  }
  return { ok: false, reason: "unavailable" };
}

/**
 * The account servers a desktop can target: everything except `selfHandle`
 * (the local server's own tunnel twin, already reachable as "This Mac").
 */
export function selectTargetableConnectServers(
  result: ConnectListAccountServersResult,
): ConnectAccountServer[] {
  return result.servers.filter((server) => server.handle !== result.selfHandle);
}

interface CreateConnectServerSyncArgs {
  /**
   * The app's own cached machine credential, or null when it has none. Used
   * when no local runtime is up, so a remote target still lists servers.
   */
  getCredential: () => ConnectCredential | null;
  /** Builtin/local server URL when the runtime is up; null when not. */
  getLocalServerUrl: () => string | null;
  /** Fresh targetable server list after every successful sync. */
  onServers: (servers: ConnectAccountServer[]) => void;
  /** A sync that produced no list, with the reason the Server menu shows. */
  onSkipped: (reason: ConnectServerSyncSkipReason) => void;
  /** The gate refused the cached credential — the caller must drop it. */
  onUnauthorized: () => void;
  /**
   * Transport for the direct gate call. Separate from `fetchImpl` because the
   * gate client needs a full `fetch`, while the local RPC needs only a slice
   * of the response.
   */
  gateFetchImpl?: typeof fetch;
  fetchImpl?: ConnectServerSyncFetch;
  log?: ConnectServerSyncLog;
  now?: () => number;
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
   * On Server-menu open: sync when the last successful/attempted sync is
   * older than minIntervalMs (default 60s).
   */
  onListRequested(): void;
  /** Sync once, now, coalescing with a sync already in flight. */
  syncNow(): Promise<void>;
}

/**
 * Periodically pull Connect account servers from the local builtin server's
 * connect plugin RPC and hand them to `onServers` for the Server menu.
 */
export function createConnectServerSync(
  args: CreateConnectServerSyncArgs,
): ConnectServerSync {
  const intervalMs = CONNECT_SERVER_SYNC_INTERVAL_MS;
  const minIntervalMs =
    args.minIntervalMs ?? CONNECT_SERVER_SYNC_MIN_INTERVAL_MS;
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
  let loggedSkipReason: ConnectServerSyncSkipReason | null = null;

  /**
   * Prefer the local server: it holds the pairing secret and always reflects
   * whether the plugin is on. Fall back to the app's own credential so a
   * remote target keeps a live server list with no local runtime.
   */
  async function fetchServers(): Promise<FetchConnectAccountServersResult> {
    const serverUrl = args.getLocalServerUrl();
    if (serverUrl !== null) {
      return fetchConnectAccountServers({
        serverUrl,
        fetchImpl: args.fetchImpl,
      });
    }
    const credential = args.getCredential();
    if (credential === null) {
      return { ok: false, reason: "no-credential" };
    }
    try {
      const result = await listAccountServers(credential, args.gateFetchImpl);
      return { ok: true, result };
    } catch (error) {
      if (error instanceof ConnectListError && error.code === "unauthorized") {
        args.onUnauthorized();
        return { ok: false, reason: "unauthorized" };
      }
      return { ok: false, reason: "unavailable" };
    }
  }

  async function runSync(): Promise<void> {
    lastSyncAttemptAt = now();
    const outcome = await fetchServers();
    if (!outcome.ok) {
      // One log line per failure streak, plus one when the reason changes.
      if (loggedSkipReason !== outcome.reason) {
        loggedSkipReason = outcome.reason;
        log?.(`connect server sync skipped (${outcome.reason})`);
      }
      args.onSkipped(outcome.reason);
      return;
    }

    loggedSkipReason = null;
    args.onServers(selectTargetableConnectServers(outcome.result));
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
