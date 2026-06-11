import { createBbSdk, type BbSdk } from "./core.js";
import { createHttpTransport } from "./transport-http.js";
import type {
  BbRealtimeSocketFactory,
  BbSdkContext,
  BbSdkTransport,
} from "./transport.js";

export interface CreateBrowserTransportArgs {
  baseUrl?: string;
  fetch?: typeof fetch;
  realtimeUrl?: string;
  websocket?: BbRealtimeSocketFactory;
}

export interface CreateBrowserBbSdkArgs extends CreateBrowserTransportArgs {
  context?: BbSdkContext;
}

export function createBrowserTransport(
  args: CreateBrowserTransportArgs = {},
): BbSdkTransport {
  return createHttpTransport({
    baseUrl: args.baseUrl,
    fetch: args.fetch,
    realtimeUrl: args.realtimeUrl,
    runtime: "browser",
    websocket: args.websocket,
  });
}

export function createBrowserBbSdk(args: CreateBrowserBbSdkArgs = {}): BbSdk {
  return createBbSdk({
    context: args.context,
    transport: createBrowserTransport(args),
  });
}

export const bb = createBrowserBbSdk();

export { createBbSdk, createHttpTransport };
export type { BbSdk, BbSdkContext, BbSdkTransport };
export type * from "./realtime.js";
export type * from "./areas/apps.js";
export type * from "./areas/environments.js";
export type * from "./areas/hosts.js";
export type * from "./areas/projects.js";
export type * from "./areas/providers.js";
export type * from "./areas/replay.js";
export type * from "./areas/status.js";
export type * from "./areas/threads.js";
export type * from "./areas/workflows.js";
