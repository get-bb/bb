import { z } from "zod";
import { deriveConnectBaseUrl } from "@bb/connect-client";

export interface MachineCode {
  code: string;
  expiresAt: number;
  serverUrl: string;
}

export type MachineCodeErrorCode = "machine_limit" | "network" | "not_paired";

export class MachineCodeError extends Error {
  constructor(readonly code: MachineCodeErrorCode) {
    super(code);
    this.name = "MachineCodeError";
  }
}

export async function redeemMachineCode(args: {
  signal: AbortSignal;
  code: string;
  serverUrl: string;
}): Promise<{ credential: string; machineId: string; serverUrl: string }> {
  const response = await fetch(
    `${deriveConnectBaseUrl(args.serverUrl)}/api/connect/redeem-machine`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: args.code }),
      signal: AbortSignal.any([args.signal, AbortSignal.timeout(10_000)]),
    },
  );
  if (!response.ok)
    throw new Error(`Machine redeem failed (${response.status})`);
  return z
    .object({
      credential: z.string().min(1),
      machineId: z.string().min(1),
      serverUrl: z.string().url(),
    })
    .parse(await response.json());
}
