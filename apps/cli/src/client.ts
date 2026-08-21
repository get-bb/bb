import { createNodeBbSdk, type BbSdk } from "@bb/sdk/node";
import type { Dispatcher } from "undici";

/**
 * Node's fetch accepts the non-standard undici `dispatcher` option so one call
 * can use its own connection pool and timeouts (see plugin-cli-proxy.ts).
 */
type CliRequestInit = RequestInit & { dispatcher?: Dispatcher };

export function cliFetch(
  input: RequestInfo | URL,
  init?: CliRequestInit,
): Promise<Response> {
  return fetch(input, init);
}

export function createCliBbSdk(baseUrl: string): BbSdk {
  return createNodeBbSdk({ baseUrl, fetch: cliFetch });
}
