import { createApiClient } from "@bb/server-contract";
import {
  readJsonResponse,
  readVoidResponse,
  resolveResponse,
} from "./response.js";
import type { BbSdkTransport, CreateHttpTransportArgs } from "./transport.js";

const SAME_ORIGIN_BASE_URL = "";

export function createHttpTransport(
  args: CreateHttpTransportArgs,
): BbSdkTransport {
  const baseUrl = args.baseUrl ?? SAME_ORIGIN_BASE_URL;
  const fetchImpl = args.fetch ?? fetch;
  const client = createApiClient(baseUrl, { fetch: fetchImpl });

  const transport: BbSdkTransport = {
    api: client.api,
    baseUrl,
    fetch: fetchImpl,
    runtime: args.runtime,
    websocket: args.websocket,
    readJson: readJsonResponse,
    readVoid: readVoidResponse,
    resolve: resolveResponse,
  };
  if (args.realtimeUrl) transport.realtimeUrl = args.realtimeUrl;
  return transport;
}
