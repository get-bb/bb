import type { ApiClient } from "@bb/server-contract";
import type {
  FetchImplementation,
  JsonBodyOf,
} from "./response.js";

export type BbSdkRuntime = "node" | "browser" | "injected-app";

export interface BbSdkTransport {
  api: ApiClient["api"];
  baseUrl: string;
  fetch: FetchImplementation;
  realtimeUrl?: string;
  runtime: BbSdkRuntime;
  readJson<TResponse extends Response>(
    response: Promise<TResponse>,
  ): Promise<JsonBodyOf<TResponse>>;
  readVoid<TResponse extends Response>(
    response: Promise<TResponse>,
  ): Promise<void>;
  resolve<TResponse extends Response>(
    response: Promise<TResponse>,
  ): Promise<TResponse>;
  websocket?: BbRealtimeSocketFactory;
}

/**
 * Raw socket payload. Treated as opaque until decoded — realtime ignores
 * non-string frames.
 */
export interface BbRealtimeSocketMessageEvent {
  data: unknown;
}

/**
 * Minimal runtime-agnostic socket shape consumed by the realtime client.
 * Default factories adapt the environment's WebSocket (browser/Node global,
 * or the `ws` package on older Node) to this interface; custom `websocket`
 * factories can wrap any implementation the same way.
 */
export interface BbRealtimeSocket {
  close(): void;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: BbRealtimeSocketMessageEvent) => void) | null;
  onopen: (() => void) | null;
  readyState: number;
  send(data: string): void;
}

export type BbRealtimeSocketFactory = (url: string) => BbRealtimeSocket;

export interface BbSdkContext {
  applicationId?: string;
  appSessionToken?: string;
  targetThreadId?: string;
  appRootPath?: string;
  appDataPath?: string;
  appsRootPath?: string;
}

export interface CreateHttpTransportArgs {
  baseUrl?: string;
  fetch?: FetchImplementation;
  realtimeUrl?: string;
  runtime: BbSdkRuntime;
  websocket?: BbRealtimeSocketFactory;
}

export interface ApiFetchArgs {
  body?: string;
  headers?: HeadersInit;
  method: string;
  path: string;
}

export interface BuildApiUrlArgs {
  baseUrl: string;
  path: string;
}

export function buildApiUrl(args: BuildApiUrlArgs): string {
  return `${args.baseUrl.replace(/\/$/u, "")}/api/v1${args.path}`;
}
