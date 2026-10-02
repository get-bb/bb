import { loadCliConfig, loadCliServerHeaders } from "@bb/config/cli";
import { createNodeBbSdk, type BbSdk } from "@bb/sdk/node";
import type { Dispatcher } from "undici";

type CliRequestInit = RequestInit & { dispatcher?: Dispatcher };

function withServerHeaders(
  input: RequestInfo | URL,
  init: CliRequestInit | undefined,
): CliRequestInit | undefined {
  const serverHeaders = loadCliServerHeaders();
  if (serverHeaders === undefined) {
    return init;
  }
  const requestUrl = new URL(input instanceof Request ? input.url : input);
  const serverUrl = new URL(loadCliConfig().BB_SERVER_URL);
  if (requestUrl.origin !== serverUrl.origin) {
    return init;
  }
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  for (const [name, value] of Object.entries(serverHeaders)) {
    headers.set(name, value);
  }
  return { ...init, headers };
}

export function cliFetch(
  input: RequestInfo | URL,
  init?: CliRequestInit,
): Promise<Response> {
  return fetch(input, withServerHeaders(input, init));
}

export function createCliBbSdk(baseUrl: string): BbSdk {
  return createNodeBbSdk({ baseUrl, fetch: cliFetch });
}
