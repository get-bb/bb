// Redeem a one-time connect code against the connect cloud for a durable
// tunnel credential. The server owns this (not the CLI) so the credential
// lifecycle lives in one place; the app UI can call the same pairing route.

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
