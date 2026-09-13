import { z } from "zod";
import {
  deriveConnectBaseUrl,
  type ConnectCredential,
} from "@bb/connect-client";

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

export type MachineCodeErrorCode = "machine_limit" | "network" | "not_paired";

export class MachineCodeError extends Error {
  constructor(readonly code: MachineCodeErrorCode) {
    super(code);
    this.name = "MachineCodeError";
  }
}

export async function fetchMachineCode(
  credential: ConnectCredential,
  signal: AbortSignal,
): Promise<MachineCode> {
  const url = `${deriveConnectBaseUrl(credential.serverUrl).replace(/\/$/u, "")}/api/connect/machine-code`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "x-bb-connect-machine": credential.credential },
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
  } catch {
    signal.throwIfAborted();
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

export async function lookupMachineCode(
  credential: ConnectCredential,
  code: string,
  signal: AbortSignal,
) {
  const response = await fetch(
    `${deriveConnectBaseUrl(credential.serverUrl)}/api/connect/machine-code`,
    {
      method: "GET",
      headers: {
        "x-bb-connect-machine": credential.credential,
        "x-bb-connect-code": code,
      },
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    },
  );
  if (!response.ok)
    throw new Error(`Machine code lookup failed (${response.status})`);
  return z
    .object({ consumed: z.boolean(), machineId: z.string().nullable() })
    .parse(await response.json());
}
