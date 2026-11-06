import {
  createBbSdk,
  createGuideArea,
  createNodeTransport,
  type BbSdk,
  type BbSdkTransport,
} from "@bb/sdk/node";
import type { Dispatcher } from "undici";

type CliRequestInit = RequestInit & { dispatcher?: Dispatcher };

export function cliFetch(
  input: RequestInfo | URL,
  init?: CliRequestInit,
): Promise<Response> {
  return fetch(input, init);
}

function cliFetchWithTimeout(timeoutMs: number): typeof cliFetch {
  return (input, init) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    return cliFetch(input, {
      ...init,
      signal: init?.signal
        ? AbortSignal.any([init.signal, timeoutSignal])
        : timeoutSignal,
    });
  };
}

export function createCliTransport(
  baseUrl: string,
  timeoutMs?: number,
): BbSdkTransport {
  return createNodeTransport({
    baseUrl,
    fetch: timeoutMs === undefined ? cliFetch : cliFetchWithTimeout(timeoutMs),
  });
}

export function createCliBbSdk(baseUrl: string, timeoutMs?: number): BbSdk {
  return createBbSdk({
    guide: createGuideArea(),
    transport: createCliTransport(baseUrl, timeoutMs),
  });
}
