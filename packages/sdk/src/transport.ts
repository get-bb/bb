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

export type BbRealtimeSocketFactory = (url: string) => WebSocket;

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
