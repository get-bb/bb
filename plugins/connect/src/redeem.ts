// Redeem a one-time connect code against the connect cloud for a durable
// tunnel credential. Ported from the kernel's services/connect/redeem.ts.

export const DEFAULT_CONNECT_BASE_URL = "https://getbb.app";

/**
 * Resolve the unpaired Connect apex. Source development may point at the
 * worktree-local Cloud, but production always keeps the hosted default.
 */
export function resolveDefaultConnectBaseUrl(env: NodeJS.ProcessEnv): string {
  const configured = env.BB_DEV_CONNECT_BASE_URL?.trim();
  if (env.NODE_ENV !== "development" || !configured) {
    return DEFAULT_CONNECT_BASE_URL;
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error(
      "BB_DEV_CONNECT_BASE_URL must be an http://bb.localhost:<port> origin",
    );
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "bb.localhost" ||
    url.port.length === 0 ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error(
      "BB_DEV_CONNECT_BASE_URL must be an http://bb.localhost:<port> origin",
    );
  }
  return url.origin;
}

interface RedeemedCredential {
  credential: string;
  /**
   * Routing label of the redeemed server (its subdomain). Equal to the
   * account handle for the primary server; a distinct label when pairing an
   * additional bb. Used to build serverUrl and share URLs — not necessarily
   * the account's primary handle.
   */
  handle: string;
}

/**
 * Typed pairing failure. `code` is the stable, UI-facing reason (mapped to
 * human copy by the panel); `message` keeps the raw wire detail for the CLI
 * and the plugin log — never shown verbatim in the panel.
 */
type ConnectPairErrorCode =
  | "invalid_code"
  | "expired_code"
  | "already_used"
  | "network";

export class ConnectPairError extends Error {
  constructor(
    readonly code: ConnectPairErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConnectPairError";
  }
}

/** Map an HTTP redeem rejection (status + optional wire error) to a code. */
function pairErrorCodeForRedeem(
  status: number,
  wireError: string | undefined,
): ConnectPairErrorCode {
  const detail = (wireError ?? "").toLowerCase();
  if (detail.includes("expired") || status === 410) return "expired_code";
  if (
    detail.includes("already") ||
    detail.includes("used") ||
    detail.includes("redeemed") ||
    status === 409
  ) {
    return "already_used";
  }
  if (status >= 500) return "network";
  return "invalid_code";
}

/** Normalize any thrown value from a pair attempt into a ConnectPairError. */
export function asConnectPairError(error: unknown): ConnectPairError {
  if (error instanceof ConnectPairError) return error;
  // fetch() rejects (DNS/refused/reset/offline) with a TypeError — transport,
  // not a bad code.
  const message = error instanceof Error ? error.message : String(error);
  return new ConnectPairError("network", message);
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
    throw new ConnectPairError(
      pairErrorCodeForRedeem(res.status, body.error),
      `Redeem failed (${res.status})${body.error ? `: ${body.error}` : ""}`,
    );
  }
  const data = (await res.json()) as RedeemedCredential;
  return { credential: data.credential, handle: data.handle };
}
