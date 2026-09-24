import { z } from "zod";
import {
  deriveConnectBaseUrl,
  type ConnectCredential,
} from "@bb/connect-client";

const revokeMachineResponseSchema = z.object({ ok: z.literal(true) });

export async function revokeMachine(
  credential: ConnectCredential,
  machineId: string,
): Promise<void> {
  const url = `${deriveConnectBaseUrl(credential.serverUrl).replace(/\/$/u, "")}/api/connect/revoke-machine`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bb-connect-machine": credential.credential,
    },
    body: JSON.stringify({ machineId }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`machine revoke failed (${response.status})`);
  }
  revokeMachineResponseSchema.parse(await response.json());
}
