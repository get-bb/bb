import { EnvHttpProxyAgent } from "undici";

export function createUpstreamTransport() {
  const dispatcher = new EnvHttpProxyAgent({ allowH2: false });
  const upstreamFetch: typeof fetch = (input, init) => {
    const options = { ...init, dispatcher };
    return fetch(input, options);
  };
  return {
    fetch: upstreamFetch,
    destroy: () => dispatcher.destroy(),
  };
}

const TRANSPORT_CODES = new Set([
  "ERR_HTTP2_INVALID_SESSION",
  "ERR_HTTP2_GOAWAY_SESSION",
  "UND_ERR_DESTROYED",
  "UND_ERR_CLOSED",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
]);

export function transportErrorCode(error: unknown): string {
  let cause = error;
  for (let depth = 0; depth < 6 && cause instanceof Error; depth++) {
    if (
      "code" in cause &&
      typeof cause.code === "string" &&
      TRANSPORT_CODES.has(cause.code)
    ) {
      return cause.code;
    }
    cause = cause.cause;
  }
  return "unclassified transport error";
}
