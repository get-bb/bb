import { z } from "zod";
import type { ConnectCredential } from "./credential.js";
import { deriveConnectBaseUrl } from "./redeem.js";

const machineCodeResponseSchema = z.object({
  code: z.string().min(1),
  expiresInMs: z.number().int().positive(),
  serverUrl: z.string().url(),
});

export interface MachineCode {
  code: string;
  expiresAt: number;
  serverUrl: string;
}

export class MachineCodeError extends Error {
  constructor(readonly code: "machine_limit" | "network" | "not_paired") {
    super(code);
    this.name = "MachineCodeError";
  }
}

export async function fetchMachineCode(
  credential: ConnectCredential,
): Promise<MachineCode> {
  const url = `${deriveConnectBaseUrl(credential.serverUrl).replace(/\/$/u, "")}/api/connect/machine-code`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "x-bb-connect-machine": credential.credential },
    });
  } catch {
    throw new MachineCodeError("network");
  }
  if (!response.ok) {
    throw new MachineCodeError(
      response.status === 409 ? "machine_limit" : "network",
    );
  }
  const parsed = machineCodeResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new MachineCodeError("network");
  return {
    code: parsed.data.code,
    expiresAt: Date.now() + parsed.data.expiresInMs,
    serverUrl: parsed.data.serverUrl,
  };
}
