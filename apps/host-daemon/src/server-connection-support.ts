import ReconnectingWebSocket from "partysocket/ws";
import {
  type HostDaemonActiveThread,
  type HostDaemonInteractiveRequestKey,
  type HostDaemonOpenThreadWork,
  type HostDaemonLoadedEnvironment,
  type HostDaemonConnectSharesReplaceMessage,
  type HostDaemonOnlineRpcCancelMessage,
  type HostDaemonOnlineRpcRequestMessage,
  type HostDaemonServerWsMessage,
  type HostDaemonSessionOpenResponse,
  type HostDaemonWatchSetReplaceMessage,
} from "@bb/host-daemon-contract";
import type { HostDaemonLogger } from "./logger.js";
import type { ServerClient } from "./server-client.js";
import type { ServerRouteResolver } from "./server-routes.js";
import type { ProtocolSelfUpdater } from "./protocol-self-update.js";
import { createNodeWebSocketConstructor } from "./websocket-constructor.js";

export interface ReconnectingWebSocketLike {
  readonly bufferedAmount?: number;
  readonly readyState: number;
  onopen: ((event: any) => void) | null;
  onmessage: ((event: any) => void) | null;
  onclose: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  send(data: string | Uint8Array<ArrayBuffer>): void;
  close(code?: number, reason?: string): void;
  reconnect(code?: number, reason?: string): void;
}

interface ReconnectingWebSocketOptions {
  minReconnectionDelay: number;
  maxReconnectionDelay: number;
  reconnectionDelayGrowFactor: number;
  connectionTimeout: number;
  headers?: () => Record<string, string>;
  maxRetries: number;
  onFrameWritten: () => void;
  protocols?: string[];
}

export type CreateReconnectingWebSocket = (
  urlProvider: () => Promise<string>,
  options: ReconnectingWebSocketOptions,
) => ReconnectingWebSocketLike;

export type HostDaemonServerTerminalMessage = Exclude<
  HostDaemonServerWsMessage,
  | { type: "machine.shutdown" }
  | { type: "interactive-requests.end" }
  | { type: "server.moved" }
  | { type: "session-close" }
  | { type: "heartbeat-ack" }
  | { type: "machine-environment.replace" }
  | { type: "provider-session-policy.replace" }
  | { type: "server-routes.replace" }
  | HostDaemonOnlineRpcRequestMessage
  | HostDaemonOnlineRpcCancelMessage
  | HostDaemonWatchSetReplaceMessage
  | HostDaemonConnectSharesReplaceMessage
>;

export type ServerMovedNotice =
  | {
      source: "message";
      serverUrl: string;
      headers: Record<string, string>;
    }
  | {
      source: "session-open";
      serverUrl: string;
      headers: Record<string, string> | null;
      toHostName: string;
      movedAt: number;
    };

export interface ServerConnectionOptions {
  routes: ServerRouteResolver;
  hostKey: string;
  logger: HostDaemonLogger;
  serverClient: ServerClient;
  protocolSelfUpdater?: ProtocolSelfUpdater;
  onSelfUpdateInstalled?: () => void | Promise<void>;
  hostId: string;
  hostName: string;
  dataDir: string;
  instanceId: string;
  localApiPort: number | null;
  setSession?: (session: HostDaemonSessionOpenResponse | null) => void;
  getActiveThreads?: () =>
    | HostDaemonActiveThread[]
    | Promise<HostDaemonActiveThread[]>;
  getUndeliveredEventThreadIds?: () => string[];
  getTurnCommandThreadIds?: () => string[];
  getOpenThreadWork?: () => HostDaemonOpenThreadWork[];
  getLoadedEnvironments?: () =>
    | HostDaemonLoadedEnvironment[]
    | Promise<HostDaemonLoadedEnvironment[]>;
  onTerminalMessage?: (
    message: HostDaemonServerTerminalMessage,
  ) => void | Promise<void>;
  onHostRpcRequest?: (
    message: HostDaemonOnlineRpcRequestMessage,
  ) => void | Promise<void>;
  onHostRpcCancel?: (message: HostDaemonOnlineRpcCancelMessage) => void;
  onWatchSetReplace?: (
    message: HostDaemonWatchSetReplaceMessage,
  ) => void | Promise<void>;
  onConnectSharesReplace?: (
    message: HostDaemonConnectSharesReplaceMessage,
  ) => void | Promise<void>;
  onSessionOpened?: (
    session: HostDaemonSessionOpenResponse,
  ) => void | Promise<void>;
  onIdleProviderSessionTimeout?: (minutes: number) => void;
  onAgentCpuPriority?: (enabled: boolean) => void;
  onMachineEnvironment?: (
    environment: HostDaemonSessionOpenResponse["machineEnvironment"],
  ) => void;
  onMachineShutdown?: () => void | Promise<void>;
  onInteractiveRequestsEnded?: (args: {
    reason: string;
    requests: HostDaemonInteractiveRequestKey[];
  }) => void;
  onServerMoved?: (move: ServerMovedNotice) => Promise<void>;
  createWebSocket?: CreateReconnectingWebSocket;
  startupTimeoutMs?: number;
}

export const DEFAULT_MIN_RECONNECTION_DELAY = 1_000;
export const DEFAULT_MAX_RECONNECTION_DELAY = 10_000;
export const DEFAULT_RECONNECTION_DELAY_GROW_FACTOR = 2;
export const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
export const DEFAULT_STARTUP_TIMEOUT_MS = 60_000;
export const OPEN_READY_STATE = 1;

export function createDefaultReconnectingWebSocket(
  urlProvider: () => Promise<string>,
  options: ReconnectingWebSocketOptions,
): ReconnectingWebSocketLike {
  const { headers, onFrameWritten, protocols, ...reconnectionOptions } =
    options;
  return new ReconnectingWebSocket(urlProvider, protocols ?? [], {
    ...reconnectionOptions,
    WebSocket: createNodeWebSocketConstructor({ headers, onFrameWritten }),
  });
}

export function decodeWebSocketMessageData(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  return String(data);
}
