import { z } from "zod";
import {
  deriveConnectBaseUrl,
  type ConnectCredential,
} from "@bb/connect-client";

const renameMachineResponseSchema = z.object({ ok: z.literal(true) });

export async function renameMachine(
  credential: ConnectCredential,
  machineId: string,
  name: string,
): Promise<void> {
  const url = `${deriveConnectBaseUrl(credential.serverUrl).replace(/\/$/u, "")}/api/connect/rename-machine`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bb-connect-machine": credential.credential,
    },
    body: JSON.stringify({ machineId, name: name.slice(0, 120) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`machine rename failed (${response.status})`);
  }
  renameMachineResponseSchema.parse(await response.json());
}
