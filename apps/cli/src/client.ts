import { loadCliConfig } from "@bb/config/cli";
import { createNodeBbSdk, type BbSdk } from "@bb/sdk/node";
import type { Dispatcher } from "undici";

type CliRequestInit = RequestInit & { dispatcher?: Dispatcher };

function withServerHeaders(
  input: RequestInfo | URL,
  init: CliRequestInit | undefined,
): CliRequestInit | undefined {
  const config = loadCliConfig();
  const serverHeaders = config.BB_SERVER_HEADERS;
  if (serverHeaders === undefined || Object.keys(serverHeaders).length === 0) {
    return init;
  }
  const requestUrl = new URL(input instanceof Request ? input.url : input);
  const serverUrl = new URL(config.BB_SERVER_URL);
  if (requestUrl.origin !== serverUrl.origin) {
    return init;
  }
  try {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    for (const [name, value] of Object.entries(serverHeaders)) {
      headers.set(name, value);
    }
    return { ...init, headers, redirect: "error" };
  } catch {
    throw new Error("Invalid private BB server headers");
  }
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
