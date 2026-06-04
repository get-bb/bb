import { loadCliConfig, type CliConfig } from "@bb/config/cli";
import {
  createHostDaemonLocalClient,
  DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST,
} from "@bb/host-daemon-contract";
import { WebSocket as NodeWsWebSocket, type RawData } from "ws";
import { createBbSdk, type BbSdk } from "./core.js";
import { wrapStandardWebsocket } from "./realtime-client.js";
import {
  createRequestTimeoutFetch,
  DEFAULT_BB_REQUEST_TIMEOUT_MS,
  type FetchImplementation,
} from "./response.js";
import { createHttpTransport } from "./transport-http.js";
import type {
  BbRealtimeSocket,
  BbRealtimeSocketFactory,
  BbSdkContext,
  BbSdkTransport,
} from "./transport.js";

export interface CreateNodeTransportArgs {
  baseUrl?: string;
  cliConfig?: CliConfig;
  fetch?: FetchImplementation;
  realtimeUrl?: string;
  timeoutMs?: number;
  websocket?: BbRealtimeSocketFactory;
}

export interface CreateNodeBbSdkArgs extends CreateNodeTransportArgs {
  context?: BbSdkContext;
}

export interface FetchLocalHostIdArgs {
  cliConfig?: CliConfig;
  hostDaemonUrl?: string;
}

function resolveCliConfig(cliConfig?: CliConfig): CliConfig {
  return cliConfig ?? loadCliConfig();
}

function resolveHostDaemonUrl(cliConfig?: CliConfig): string {
  const config = resolveCliConfig(cliConfig);
  return `http://${DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST}:${config.BB_HOST_DAEMON_PORT}`;
}

function decodeWsMessageData(data: RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  return Buffer.from(data).toString("utf8");
}

function wrapNodeWsWebsocket(url: string): BbRealtimeSocket {
  const socket = new NodeWsWebSocket(url);
  const adapter: BbRealtimeSocket = {
    close: () => socket.close(),
    onclose: null,
    onerror: null,
    onmessage: null,
    onopen: null,
    get readyState() {
      return socket.readyState;
    },
    send: (data) => socket.send(data),
  };
  socket.on("open", () => adapter.onopen?.());
  socket.on("message", (data) =>
    adapter.onmessage?.({ data: decodeWsMessageData(data) }),
  );
  socket.on("close", () => adapter.onclose?.());
  socket.on("error", () => adapter.onerror?.());
  return adapter;
}

/**
 * Node 22+ ships a global WebSocket; older supported Node versions (20.x)
 * fall back to the `ws` package so bb.on works out of the box everywhere.
 */
function createNodeWebsocketFactory(): BbRealtimeSocketFactory {
  return (url) => {
    if (typeof WebSocket !== "undefined") {
      return wrapStandardWebsocket(new WebSocket(url));
    }
    return wrapNodeWsWebsocket(url);
  };
}

export function createNodeTransport(
  args: CreateNodeTransportArgs = {},
): BbSdkTransport {
  const cliConfig = resolveCliConfig(args.cliConfig);
  return createHttpTransport({
    baseUrl: args.baseUrl ?? cliConfig.BB_SERVER_URL,
    fetch:
      args.fetch ??
      createRequestTimeoutFetch({
        timeoutMs: args.timeoutMs ?? DEFAULT_BB_REQUEST_TIMEOUT_MS,
      }),
    realtimeUrl: args.realtimeUrl,
    runtime: "node",
    websocket: args.websocket ?? createNodeWebsocketFactory(),
  });
}

export function createNodeBbSdk(args: CreateNodeBbSdkArgs = {}): BbSdk {
  return createBbSdk({
    context: args.context,
    transport: createNodeTransport(args),
  });
}

export async function fetchLocalHostId(
  args: FetchLocalHostIdArgs = {},
): Promise<string | null> {
  try {
    const client = createHostDaemonLocalClient(
      args.hostDaemonUrl ?? resolveHostDaemonUrl(args.cliConfig),
    );
    const response = await client.status.$get();
    if (!response.ok) {
      return null;
    }
    const body = await response.json();
    return body.hostId;
  } catch {
    return null;
  }
}

export const bb = createNodeBbSdk();

export {
  createBbSdk,
  createHttpTransport,
  createRequestTimeoutFetch,
  DEFAULT_BB_REQUEST_TIMEOUT_MS,
};
export type { BbSdk, BbSdkContext, BbSdkTransport, FetchImplementation };
export type * from "./realtime.js";
export type * from "./areas/apps.js";
export type * from "./areas/environments.js";
export type * from "./areas/hosts.js";
export type * from "./areas/managers.js";
export type * from "./areas/projects.js";
export type * from "./areas/providers.js";
export type * from "./areas/replay.js";
export type * from "./areas/status.js";
export type * from "./areas/threads.js";
