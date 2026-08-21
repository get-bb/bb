// Pure URL helpers for the connect cloud: no zod, no fetch. Kept apart from the
// credential schema so browser bundles that only need URL math (the connect
// plugin's settings section) do not pull the validation stack in.

type ConnectPublicProtocol = "http:" | "https:";

/** Local Cloud is HTTP-only; every non-local Connect gate is HTTPS-only. */
export function connectPublicProtocol(
  baseDomain: string,
): ConnectPublicProtocol {
  const hostname = new URL(`https://${baseDomain}`).hostname;
  return hostname.endsWith(".localhost") ? "http:" : "https:";
}

/**
 * Derive the connect cloud apex (`https://getbb.app`) from a server URL
 * (`https://<handle>.getbb.app`) by dropping the handle label.
 */
export function deriveConnectBaseUrl(serverUrl: string): string {
  return new URL(serverUrl).origin.replace(/\/\/[^.]+\./, "//");
}

/**
 * `https://getbb.app` + routing label → `https://<label>.getbb.app`.
 * `handle` is the redeemed server's subdomain (primary or additional).
 */
export function serverUrlForHandle(baseUrl: string, handle: string): string {
  const url = new URL(baseUrl);
  return `${url.protocol}//${handle}.${url.host}`;
}
