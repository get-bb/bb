import {
  createNodeBbSdk,
  createNodeWebsocketFactory,
  type BbSdk,
} from "@bb/sdk/node";
import {
  CALLER_THREAD_HEADER_NAME,
  CLI_REQUEST_HEADER_NAME,
} from "@bb/config/app-surface";
import type { Dispatcher } from "undici";
import { resolveContextThreadId } from "./context-env.js";
import { readServerCredential } from "./server-credentials.js";

type CliRequestInit = RequestInit & { dispatcher?: Dispatcher };

export function cliFetch(
  input: RequestInfo | URL,
  init?: CliRequestInit,
): Promise<Response> {
  return fetch(input, init);
}

function requestUrl(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : String(input);
}

export function serverAuthorization(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const credential = readServerCredential(url);
  return credential === null ? null : `Bearer ${credential.token}`;
}

function cliSdkFetch(timeoutMs: number | undefined): typeof cliFetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set(CLI_REQUEST_HEADER_NAME, "1");
    const authorization = headers.has("authorization")
      ? null
      : serverAuthorization(requestUrl(input));
    if (authorization !== null) headers.set("authorization", authorization);
    const callerThreadId = resolveContextThreadId();
    if (callerThreadId !== undefined) {
      headers.set(CALLER_THREAD_HEADER_NAME, callerThreadId);
    }
    if (timeoutMs === undefined) return cliFetch(input, { ...init, headers });
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    return cliFetch(input, {
      ...init,
      headers,
      signal: init?.signal
        ? AbortSignal.any([init.signal, timeoutSignal])
        : timeoutSignal,
    });
  };
}

export function createCliBbSdk(baseUrl: string, timeoutMs?: number): BbSdk {
  return createNodeBbSdk({
    baseUrl,
    fetch: cliSdkFetch(timeoutMs),
    websocket: createNodeWebsocketFactory({
      headers: (url): Record<string, string> => {
        const authorization = serverAuthorization(url);
        return authorization === null ? {} : { authorization };
      },
    }),
  });
}
