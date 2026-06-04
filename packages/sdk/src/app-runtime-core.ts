import type { ApplicationId } from "@bb/domain";
import { createBbSdk, type BbSdk } from "./core.js";
import { createHttpTransport } from "./transport-http.js";
import type { FetchImplementation } from "./response.js";
import type { BbRealtimeSocketFactory } from "./transport.js";

/**
 * Values the server serializes into every served app HTML page. This is
 * exactly the set the injected runtime consumes — do not add fields here
 * without a consumer in {@link createInjectedBbSdk}.
 */
export interface AppRuntimeBootstrap {
  applicationId: ApplicationId;
  appSessionToken: string | null;
  targetThreadId: string | null;
  wsUrl: string;
}

export interface CreateInjectedBbSdkArgs {
  bootstrap: AppRuntimeBootstrap;
  fetch?: FetchImplementation;
  websocket?: BbRealtimeSocketFactory;
}

/**
 * The SDK as installed on `window.bb` inside served app pages. Unlike the
 * generic {@link BbSdk} (which also serves the CLI, where no app context
 * exists), the injected runtime always knows which app it is serving, so
 * both id fields are required.
 */
export interface InjectedBbSdk extends BbSdk {
  /** @deprecated Alias of {@link InjectedBbSdk.applicationId}. */
  appId: ApplicationId;
  applicationId: ApplicationId;
}

export function createInjectedBbSdk(
  args: CreateInjectedBbSdkArgs,
): InjectedBbSdk {
  return {
    ...createBbSdk({
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
    }),
    appId: args.bootstrap.applicationId,
    applicationId: args.bootstrap.applicationId,
  };
}
