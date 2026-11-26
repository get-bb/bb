import { homedir } from "node:os";
import { loadCliConfig, type CliConfig } from "@bb/config/cli";
import { readLocalAccessTokenSync } from "@bb/config/local-access-token";
import { isLoopbackHostname } from "@bb/config/loopback";
import { parseDataDirEnvValue, resolveProdDataDir } from "@bb/config/runtime";
import {
  createHostDaemonLocalClient,
  DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST,
} from "@bb/host-daemon-contract";
import { createGuideArea } from "./areas/guide.js";
import { createBbSdk, type BbSdk, type BbSdkAreas } from "./core.js";
import { createNodeWebsocketFactory } from "./node-websocket.js";
import {
  createRequestTimeoutFetch,
  DEFAULT_BB_REQUEST_TIMEOUT_MS,
  type FetchImplementation,
} from "./response.js";
import { createHttpTransport } from "./transport-http.js";
import type {
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

function localServerAuthorization(url: string): string | null {
  if (!URL.canParse(url) || !isLoopbackHostname(new URL(url).hostname)) {
    return null;
  }
  const homeDir = homedir();
  const configured = process.env.BB_DATA_DIR?.trim();
  const dataDir =
    configured === undefined || configured.length === 0
      ? resolveProdDataDir({ homeDir })
      : parseDataDirEnvValue({ homeDir, rawDataDir: configured });
  const token = readLocalAccessTokenSync(dataDir);
  return token === null ? null : `Bearer ${token}`;
}

function withLocalServerAuthorization(
  fetchImpl: FetchImplementation,
): FetchImplementation {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    if (!headers.has("authorization")) {
      const authorization = localServerAuthorization(
        input instanceof Request ? input.url : String(input),
      );
      if (authorization !== null) headers.set("authorization", authorization);
    }
    return fetchImpl(input, { ...init, headers });
  };
}

export function createNodeTransport(
  args: CreateNodeTransportArgs = {},
): BbSdkTransport {
  return createHttpTransport({
    baseUrl: args.baseUrl ?? resolveCliConfig(args.cliConfig).BB_SERVER_URL,
    fetch:
      args.fetch ??
      withLocalServerAuthorization(
        createRequestTimeoutFetch({
          timeoutMs: args.timeoutMs ?? DEFAULT_BB_REQUEST_TIMEOUT_MS,
        }),
      ),
    realtimeUrl: args.realtimeUrl,
    runtime: "node",
    websocket:
      args.websocket ??
      createNodeWebsocketFactory({
        headers: (url): Record<string, string> => {
          const authorization = localServerAuthorization(url);
          return authorization === null ? {} : { authorization };
        },
      }),
  });
}

export function createNodeBbSdk(args: CreateNodeBbSdkArgs = {}): BbSdk {
  return createBbSdk({
    context: args.context,
    guide: createGuideArea(),
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

export {
  createBbSdk,
  createHttpTransport,
  createRequestTimeoutFetch,
  DEFAULT_BB_REQUEST_TIMEOUT_MS,
};
export { BbHttpError } from "./http-error.js";
export { BbRequestTimeoutError } from "./response.js";
export {
  createDpopProof,
  normalizeDpopHtu,
  type DpopPublicJwk,
  type DpopSigner,
} from "./dpop.js";
export {
  createNodeDpopSigner,
  dpopPrivateJwkSchema,
  generateDpopPrivateJwk,
  type DpopPrivateJwk,
} from "./node-dpop.js";
export {
  createNodeWebsocketFactory,
  type CreateNodeWebsocketFactoryArgs,
} from "./node-websocket.js";
export {
  pluginMutationResponseSchema,
  type PluginMutationResponse,
} from "./areas/plugins.js";
export { createBuiltinPlanCommandTextInput } from "./core.js";
export { createGuideArea } from "./areas/guide.js";
export { createRetiredEnvironmentMembers } from "./areas/retired-environment-members.js";
export {
  DEFAULT_THREAD_WAIT_TIMEOUT_MS,
  ThreadWaitTimeoutError,
  ThreadWaitUnreachableError,
} from "./areas/threads.js";
export type {
  BbSdk,
  BbSdkAreas,
  BbSdkContext,
  BbSdkTransport,
  FetchImplementation,
};
export type * from "./areas/skills.js";
export type {
  BbRealtimeSocket,
  BbRealtimeSocketFactory,
  BbRealtimeSocketMessageEvent,
} from "./transport.js";
export type { BbHttpErrorArgs } from "./http-error.js";
export type * from "./public-types.js";
