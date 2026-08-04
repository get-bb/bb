import { z } from "zod";
import type { ConnectCredential } from "./credential.js";

const redeemMachineResponseSchema = z.object({
  credential: z.string().min(1),
  machineId: z.string().min(1),
  handle: z.string().nullable(),
  serverUrl: z.string().nullable(),
});

const redeemMachineErrorSchema = z.object({ error: z.string() });

export type ConnectMachineRedeemErrorCode =
  | "already_used"
  | "expired"
  | "invalid_code"
  | "machine_limit"
  | "network"
  | "invalid_response";

export class ConnectMachineRedeemError extends Error {
  constructor(
    readonly code: ConnectMachineRedeemErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConnectMachineRedeemError";
  }
}

function codeForStatus(
  status: number,
  wireError: string,
): ConnectMachineRedeemErrorCode {
  if (wireError === "machine-limit") return "machine_limit";
  if (wireError === "already-used" || status === 409) return "already_used";
  if (wireError === "expired" || status === 410) return "expired";
  if (status >= 500) return "network";
  return "invalid_code";
}

/** `https://<label>.getbb.app` → `<label>`. */
function handleFromServerUrl(serverUrl: string): string | null {
  const [label] = new URL(serverUrl).hostname.split(".");
  return label === undefined || label.length === 0 ? null : label;
}

/**
 * Redeem a one-time machine code at the connect apex for this client's own
 * durable machine credential (`POST /api/connect/redeem-machine`).
 *
 * A machine credential is a separate, individually revocable identity on the
 * account. Clients that need to reach the gate without a bb server enroll this
 * way instead of copying a server's pairing secret.
 */
export async function redeemMachineCredential(
  args: { apexUrl: string; code: string },
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ConnectCredential> {
  const url = `${args.apexUrl.replace(/\/$/u, "")}/api/connect/redeem-machine`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: args.code }),
    });
  } catch (error) {
    throw new ConnectMachineRedeemError(
      "network",
      error instanceof Error ? error.message : String(error),
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ConnectMachineRedeemError(
      "invalid_response",
      "Machine redeem returned non-JSON",
    );
  }

  if (!response.ok) {
    const parsedError = redeemMachineErrorSchema.safeParse(body);
    const wireError = parsedError.success ? parsedError.data.error : "";
    throw new ConnectMachineRedeemError(
      codeForStatus(response.status, wireError),
      `Machine redeem failed (${response.status})${wireError ? `: ${wireError}` : ""}`,
    );
  }

  const parsed = redeemMachineResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new ConnectMachineRedeemError(
      "invalid_response",
      "Machine redeem response failed schema validation",
    );
  }
  const { credential, handle, serverUrl } = parsed.data;
  // The gate echoes the server the code targeted. Without it there is nothing
  // to point a session at, so treat the row as unusable.
  if (serverUrl === null) {
    throw new ConnectMachineRedeemError(
      "invalid_response",
      "Machine redeem returned no server URL",
    );
  }
  const resolvedHandle = handle ?? handleFromServerUrl(serverUrl);
  if (resolvedHandle === null) {
    throw new ConnectMachineRedeemError(
      "invalid_response",
      "Machine redeem returned no routing handle",
    );
  }
  return { credential, handle: resolvedHandle, serverUrl };
}
