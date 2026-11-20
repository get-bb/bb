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
import {
  deviceRequestHeaders,
  freshDeviceCredential,
  isRetryableDeviceFailure,
  resolveServerAuthorization,
  websocketHeaders,
  type ServerAuthorization,
} from "./server-auth.js";

type CliRequestInit = RequestInit & { dispatcher?: Dispatcher };

function requestUrl(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : String(input);
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();
}

function isReplayableBody(body: RequestInit["body"]): boolean {
  return (
    body === undefined ||
    body === null ||
    typeof body === "string" ||
    body instanceof URLSearchParams ||
    body instanceof FormData ||
    body instanceof Blob ||
    body instanceof ArrayBuffer
  );
}

export async function cliFetch(
  input: RequestInfo | URL,
  init?: CliRequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  const url = requestUrl(input);
  const auth: ServerAuthorization = headers.has("authorization")
    ? { kind: "none" }
    : resolveServerAuthorization(url);
  if (auth.kind === "local") {
    headers.set("authorization", auth.authorization);
    return fetch(input, { ...init, headers });
  }
  if (auth.kind === "none") return fetch(input, { ...init, headers });
  const method = requestMethod(input, init);
  const send = async (forceRenew: boolean): Promise<Response> => {
    const credential = await freshDeviceCredential(auth, { forceRenew });
    const signed = new Headers(headers);
    for (const [name, value] of Object.entries(
      await deviceRequestHeaders(credential, method, url),
    )) {
      signed.set(name, value);
    }
    return fetch(input, { ...init, headers: signed });
  };
  const response = await send(false);
  if (
    isReplayableBody(init?.body) &&
    (await isRetryableDeviceFailure(response))
  ) {
    return send(true);
  }
  return response;
}

function cliSdkFetch(timeoutMs: number | undefined): typeof cliFetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set(CLI_REQUEST_HEADER_NAME, "1");
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
    websocket: createNodeWebsocketFactory({ headers: websocketHeaders }),
  });
}
