import type { HeaderPair } from "@bb/tunnel-contract";
import { toUint8Array } from "./bytes.js";
import type {
  SealedChannelClient,
  SealedRequest,
  SealedResponse,
} from "./client.js";

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const STRIPPED_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

export interface SealedFetchTarget {
  path: string;
  origin: string;
}

function headerPairs(headers: Headers): HeaderPair[] {
  const pairs: HeaderPair[] = [];
  headers.forEach((value, name) => {
    pairs.push([name, value]);
  });
  return pairs;
}

async function readRequestBody(request: Request): Promise<Uint8Array | null> {
  if (request.body === null) return null;
  return new Uint8Array(await request.arrayBuffer());
}

export function sealedResponseHeaders(pairs: HeaderPair[]): Headers {
  const headers = new Headers();
  for (const [name, value] of pairs) {
    if (STRIPPED_RESPONSE_HEADERS.has(name.toLowerCase())) continue;
    try {
      headers.append(name, value);
    } catch {}
  }
  return headers;
}

export function toFetchResponse(sealed: SealedResponse): Response {
  const headers = sealedResponseHeaders(sealed.headers);
  const body =
    sealed.body === null
      ? null
      : sealed.body instanceof Uint8Array
        ? sealed.body.slice().buffer
        : sealed.body;
  return new Response(body as BodyInit | null, {
    status: sealed.status,
    headers,
  });
}

export interface SealedFetchOptions {
  origin: string;
  extraHeaders?: HeaderPair[];
}

export async function sealedFetch(
  client: SealedChannelClient,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  options: SealedFetchOptions,
): Promise<Response> {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin !== options.origin) {
    throw new TypeError(
      `sealed-channel: refusing to seal a cross-origin request to ${url.origin}`,
    );
  }
  const body = await readRequestBody(request);
  const signal = request.signal;
  let method = request.method;
  let path = `${url.pathname}${url.search}`;
  let headers = headerPairs(request.headers);
  headers = headers.filter(
    ([name]) => name.toLowerCase() !== "accept-encoding",
  );
  headers.push(["accept-encoding", "identity"]);
  for (const pair of options.extraHeaders ?? []) headers.push(pair);
  let currentBody = body;
  let current = url;
  for (let redirects = 0; ; redirects += 1) {
    const sealedRequest: SealedRequest = {
      method,
      path,
      headers,
      body: currentBody,
      ...(signal !== undefined ? { signal } : {}),
    };
    const sealed = await client.request(sealedRequest);
    const location = sealed.headers.find(
      ([name]) => name.toLowerCase() === "location",
    )?.[1];
    if (
      request.redirect === "follow" &&
      REDIRECT_STATUSES.has(sealed.status) &&
      location !== undefined &&
      redirects < MAX_REDIRECTS
    ) {
      const next = new URL(location, current);
      if (next.origin === options.origin) {
        await discardBody(sealed);
        if (
          sealed.status === 303 ||
          (sealed.status !== 307 && sealed.status !== 308 && method === "POST")
        ) {
          method = "GET";
          currentBody = null;
        }
        path = `${next.pathname}${next.search}`;
        current = next;
        continue;
      }
    }
    const response = toFetchResponse(sealed);
    Object.defineProperty(response, "url", { value: current.href });
    return response;
  }
}

async function discardBody(sealed: SealedResponse): Promise<void> {
  if (sealed.body === null || sealed.body instanceof Uint8Array) return;
  try {
    await sealed.body.cancel();
  } catch {}
}

export { toUint8Array };
