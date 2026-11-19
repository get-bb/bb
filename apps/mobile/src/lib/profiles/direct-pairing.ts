import { z } from "zod";
import { probeServer, type ProbeFetch } from "./probe";
import type { DirectServerAccess } from "./profile";

const PAIRING_TIMEOUT_MS = 8000;
const ACCESS_LABEL_MAX_LENGTH = 80;

export const DIRECT_SIGN_IN_HELP =
  "This bb needs a sign-in code. On the server machine run `bb access pair`, or open Settings → Devices on a signed-in browser.";

const redeemedSchema = z.object({
  kind: z.literal("device"),
  token: z.string().min(1),
  cookieName: z.string().min(1),
});

const errorSchema = z.object({ code: z.string() });

export type PairingFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type RedeemDirectPairingResult =
  | { ok: true; access: DirectServerAccess }
  | { ok: false; error: string };

export interface RedeemDirectPairingArgs {
  serverUrl: string;
  code: string;
  label: string;
  fetchImpl: PairingFetch;
}

async function readJson(response: {
  json(): Promise<unknown>;
}): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function failureMessage(status: number, body: unknown): string {
  const parsed = errorSchema.safeParse(body);
  const code = parsed.success ? parsed.data.code : null;
  if (code === "invalid_pairing_code") {
    return "That code is wrong, expired or already used. Make a new one and try again.";
  }
  if (status === 429 || code === "pairing_rate_limited") {
    return "Too many wrong codes. Wait a few minutes, then try again.";
  }
  return `The server refused the code (HTTP ${status}).`;
}

export async function redeemDirectPairing(
  args: RedeemDirectPairingArgs,
): Promise<RedeemDirectPairingResult> {
  const code = args.code.trim();
  if (code.length === 0) return { ok: false, error: "Enter the sign-in code." };
  let response: Awaited<ReturnType<PairingFetch>>;
  try {
    response = await args.fetchImpl(
      `${args.serverUrl.replace(/\/+$/u, "")}/api/v1/access/pairings/redeem`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "device",
          code,
          label: args.label.slice(0, ACCESS_LABEL_MAX_LENGTH),
        }),
        signal: AbortSignal.timeout(PAIRING_TIMEOUT_MS),
      },
    );
  } catch (error) {
    return {
      ok: false,
      error: `Could not reach the server: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const body = await readJson(response);
  if (!response.ok) {
    return { ok: false, error: failureMessage(response.status, body) };
  }
  const parsed = redeemedSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: "The server answered the code unexpectedly." };
  }
  return {
    ok: true,
    access: { token: parsed.data.token, cookieName: parsed.data.cookieName },
  };
}

export type DirectServerCheck =
  | { kind: "ready"; serverUrl: string; access: DirectServerAccess | null }
  | { kind: "needs-code"; serverUrl: string; message: string }
  | { kind: "failed"; message: string };

function probeFailure(
  stage: "health" | "config",
  error: string,
): DirectServerCheck {
  const where =
    stage === "health"
      ? "Could not reach the server"
      : "Reached the server, but it does not look like bb";
  return { kind: "failed", message: `${where}: ${error}` };
}

export async function checkDirectServer(
  serverUrl: string,
  fetchImpl: ProbeFetch,
): Promise<DirectServerCheck> {
  const probe = await probeServer(serverUrl, fetchImpl, null);
  if (probe.ok) {
    return { kind: "ready", serverUrl: probe.serverUrl, access: null };
  }
  if (probe.stage === "sign-in") {
    return {
      kind: "needs-code",
      serverUrl: probe.serverUrl,
      message: DIRECT_SIGN_IN_HELP,
    };
  }
  return probeFailure(probe.stage, probe.error);
}

export interface PairDirectServerArgs {
  serverUrl: string;
  code: string;
  label: string;
  fetchImpl: ProbeFetch & PairingFetch;
}

export async function pairDirectServer(
  args: PairDirectServerArgs,
): Promise<DirectServerCheck> {
  const redeemed = await redeemDirectPairing(args);
  if (!redeemed.ok) {
    return {
      kind: "needs-code",
      serverUrl: args.serverUrl,
      message: redeemed.error,
    };
  }
  const probe = await probeServer(
    args.serverUrl,
    args.fetchImpl,
    redeemed.access.token,
  );
  if (probe.ok) {
    return {
      kind: "ready",
      serverUrl: probe.serverUrl,
      access: redeemed.access,
    };
  }
  if (probe.stage === "sign-in") {
    return {
      kind: "needs-code",
      serverUrl: args.serverUrl,
      message: probe.error,
    };
  }
  return probeFailure(probe.stage, probe.error);
}
