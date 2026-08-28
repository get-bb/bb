import { z } from "zod";

export const DEFAULT_CONNECT_BASE_URL = "https://getbb.app";

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

const redeemedCredentialSchema = z.object({
  credential: z.string().min(1),
  handle: z.string().min(1),
});

const redeemErrorResponseSchema = z.object({ error: z.string().optional() });

type RedeemedCredential = z.infer<typeof redeemedCredentialSchema>;

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

export function asConnectPairError<T>(error: T): ConnectPairError {
  if (error instanceof ConnectPairError) return error;
  const parsed = z.union([z.instanceof(Error), z.string()]).safeParse(error);
  const message = parsed.success
    ? parsed.data instanceof Error
      ? parsed.data.message
      : parsed.data
    : String(error);
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
    const parsedBody = redeemErrorResponseSchema.safeParse(
      await res.json().catch(() => ({})),
    );
    const body = parsedBody.success ? parsedBody.data : {};
    throw new ConnectPairError(
      pairErrorCodeForRedeem(res.status, body.error),
      `Redeem failed (${res.status})${body.error ? `: ${body.error}` : ""}`,
    );
  }
  const parsed = redeemedCredentialSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new ConnectPairError(
      "network",
      "Redeem returned an invalid credential response",
    );
  }
  return parsed.data;
}
