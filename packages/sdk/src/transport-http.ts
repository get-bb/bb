import { createApiClient } from "@bb/server-contract";
import {
  readJsonResponse,
  readVoidResponse,
  resolveResponse,
} from "./response.js";
import type {
  ApiFetchArgs,
  BbSdkTransport,
  CreateHttpTransportArgs,
} from "./transport.js";
import { buildApiUrl } from "./transport.js";

const SAME_ORIGIN_BASE_URL = "";

export function createHttpTransport(
  args: CreateHttpTransportArgs,
): BbSdkTransport {
  const baseUrl = args.baseUrl ?? SAME_ORIGIN_BASE_URL;
  const fetchImpl = args.fetch ?? fetch;
  const client = createApiClient(baseUrl, { fetch: fetchImpl });

  return {
    api: client.api,
    baseUrl,
    fetch: fetchImpl,
    ...(args.realtimeUrl ? { realtimeUrl: args.realtimeUrl } : {}),
    runtime: args.runtime,
    websocket: args.websocket,
    readJson: (response) => readJsonResponse({ response }),
    readVoid: (response) => readVoidResponse({ response }),
    resolve: (response) => resolveResponse({ response }),
  };
}

export function fetchApi(args: ApiFetchArgs, transport: BbSdkTransport) {
  return transport.fetch(buildApiUrl({ baseUrl: transport.baseUrl, path: args.path }), {
    body: args.body,
    headers: args.headers,
    method: args.method,
  });
}
