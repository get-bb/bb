import type { AppCapability } from "@bb/server-contract";
import type { ApplicationId } from "@bb/domain";
import { createBbSdk, type BbSdk } from "./core.js";
import { createHttpTransport } from "./transport-http.js";
import type { FetchImplementation } from "./response.js";
import type { BbRealtimeSocketFactory } from "./transport.js";

export interface AppRuntimeBootstrap {
  appId: ApplicationId;
  applicationId: ApplicationId;
  appSessionToken: string | null;
  capabilities: AppCapability[];
  dataUrl: string;
  messageUrl: string;
  targetThreadId: string | null;
  wsUrl: string;
}

export interface CreateInjectedBbSdkArgs {
  bootstrap: AppRuntimeBootstrap;
  fetch?: FetchImplementation;
  websocket?: BbRealtimeSocketFactory;
}

export function createInjectedBbSdk(args: CreateInjectedBbSdkArgs): BbSdk {
  return createBbSdk({
    context: {
      applicationId: args.bootstrap.applicationId,
      appSessionToken: args.bootstrap.appSessionToken ?? undefined,
      targetThreadId: args.bootstrap.targetThreadId ?? undefined,
    },
    transport: createHttpTransport({
      fetch: args.fetch,
      realtimeUrl: args.bootstrap.wsUrl,
      runtime: "injected-app",
      websocket: args.websocket,
    }),
  });
}
