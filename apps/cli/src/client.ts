import { createNodeBbSdk, type BbSdk, type BbSdkContext } from "@bb/sdk/node";

export interface CreateCliBbSdkOptions {
  context?: BbSdkContext;
}

export function cliFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const credential = process.env.BB_CONNECT_MACHINE_CREDENTIAL?.trim();
  if (!credential) return fetch(input, init);
  const headers = new Headers(input instanceof Request ? input.headers : {});
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  headers.set("x-bb-connect-machine", credential);
  return fetch(input, { ...init, headers });
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
