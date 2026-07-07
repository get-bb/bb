// Redeem a one-time connect code against the connect cloud for a durable
// tunnel credential. Ported from the kernel's services/connect/redeem.ts.

export const DEFAULT_CONNECT_BASE_URL = "https://getbb.app";

export interface RedeemedCredential {
  credential: string;
  handle: string;
}

/**
 * Derive the connect cloud apex (`https://getbb.app`) from a server URL
 * (`https://<handle>.getbb.app`) by dropping the handle label.
 */
export function deriveConnectBaseUrl(serverUrl: string): string {
  return new URL(serverUrl).origin.replace(/\/\/[^.]+\./, "//");
}

/** `https://getbb.app` + `sawyer` → `https://sawyer.getbb.app`. */
export function serverUrlForHandle(baseUrl: string, handle: string): string {
  const url = new URL(baseUrl);
  return `${url.protocol}//${handle}.${url.host}`;
}

export async function redeemConnectCode(args: {
  code: string;
  baseUrl: string;
}): Promise<RedeemedCredential> {
  const res = await fetch(`${args.baseUrl}/api/connect/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: args.code }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      `Redeem failed (${res.status})${body.error ? `: ${body.error}` : ""}`,
    );
  }
  const data = (await res.json()) as RedeemedCredential;
  return { credential: data.credential, handle: data.handle };
}
