import { z } from "zod";

// The durable machine credential minted by pairing. On a bb server it lives in
// the connect plugin's kv storage (bb.db); the desktop app caches a copy so it
// can reach the connect gate without a local server.
// `handle` is the paired server's routing label (subdomain), which may differ
// from the account's primary handle when multiple bbs are connected.
export const connectCredentialSchema = z.object({
  serverUrl: z.string().min(1),
  handle: z.string().min(1),
  credential: z.string().min(1),
});

export type ConnectCredential = z.infer<typeof connectCredentialSchema>;

export type ConnectPublicProtocol = "http:" | "https:";

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
