import { createNodeBbSdk, type BbSdk, type BbSdkContext } from "@bb/sdk/node";
import type { Dispatcher } from "undici";

export interface CreateCliBbSdkOptions {
  context?: BbSdkContext;
}

/**
 * Node's fetch accepts the non-standard undici `dispatcher` option so one call
 * can use its own connection pool and timeouts (see plugin-cli-proxy.ts).
 */
export type CliRequestInit = RequestInit & { dispatcher?: Dispatcher };

export function cliFetch(
  input: RequestInfo | URL,
  init?: CliRequestInit,
): Promise<Response> {
  return fetch(input, init);
}

export function createCliBbSdk(
  baseUrl: string,
  options: CreateCliBbSdkOptions = {},
): BbSdk {
  return createNodeBbSdk({
    baseUrl,
    context: options.context,
    fetch: cliFetch,
  });
}
