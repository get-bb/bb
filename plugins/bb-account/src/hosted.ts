import { z } from "zod";
import {
  FETCH_BODY_MAX_BYTES,
  type AccountFetchResult,
  type RedeemErrorCode,
} from "./contract.js";

const REQUEST_TIMEOUT_MS = 15_000;
const DISCONNECT_TIMEOUT_MS = 5_000;

type JsonValue = AccountFetchResult["body"];

export class HostedRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "HostedRequestError";
  }
}

export class RedeemError extends Error {
  constructor(
    readonly code: RedeemErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RedeemError";
  }
}

export const profileResponseSchema = z.object({
  userId: z.string().min(1),
  githubLogin: z.string().nullable(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  handle: z.string().nullable(),
  serverId: z.string().min(1),
  serverLabel: z.string().min(1),
  serverUrl: z.string().url(),
});

export type AccountProfile = z.infer<typeof profileResponseSchema>;

const linkStartResponseSchema = z.object({
  deviceCode: z.string().min(1),
  userCode: z.string().min(1),
  verificationUrl: z.string().url(),
  expiresAt: z.number(),
  intervalMs: z.number().int().positive(),
});

export type LinkStart = z.infer<typeof linkStartResponseSchema>;

const linkPollResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({
    status: z.literal("approved"),
    credential: z.string().min(1),
    serverId: z.string().min(1),
    handle: z.string().min(1).nullable().optional(),
    serverUrl: z.string().url().nullable().optional(),
  }),
]);

export type LinkPollResult =
  | { kind: "pending" }
  | {
      kind: "approved";
      credential: string;
      serverId: string;
      handle: string | null;
      serverUrl: string | null;
    }
  | { kind: "slow-down" }
  | { kind: "denied" }
  | { kind: "expired" }
  | { kind: "invalid" }
  | { kind: "already-used" };

const redeemResponseSchema = z.object({
  credential: z.string().min(1),
  serverId: z.string().min(1).nullable().optional(),
  handle: z.string().min(1).nullable().optional(),
});

export interface RedeemedCredential {
  credential: string;
  serverId: string | null;
  handle: string | null;
}

export function credentialHeaders(credential: string): Record<string, string> {
  return {
    authorization: `Bearer ${credential}`,
    "x-bb-connect-machine": credential,
  };
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause;
    if (cause instanceof Error && cause.message.length > 0) {
      return `${error.message} (${cause.message})`;
    }
    return error.message;
  }
  return String(error);
}

async function send(url: URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      redirect: "manual",
      signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new HostedRequestError(
      `couldn't reach ${url.host}: ${describeError(error)}`,
      null,
    );
  }
}

async function readTextCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > FETCH_BODY_MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new HostedRequestError(
      "getbb.app response exceeded 1 MB",
      response.status,
    );
  }
  const reader = response.body?.getReader();
  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > FETCH_BODY_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new HostedRequestError(
        "getbb.app response exceeded 1 MB",
        response.status,
      );
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJsonOrNull(text: string): JsonValue {
  if (text.trim().length === 0) return null;
  try {
    return z.json().parse(JSON.parse(text));
  } catch {
    return null;
  }
}

async function readJson(response: Response): Promise<JsonValue> {
  return parseJsonOrNull(await readTextCapped(response));
}

function endpoint(origin: string, path: string): URL {
  return new URL(path, origin);
}

export async function fetchProfile(
  baseUrl: string,
  credential: string,
): Promise<{ kind: "ok"; profile: AccountProfile } | { kind: "unauthorized" }> {
  const response = await send(endpoint(baseUrl, "/api/account/me"), {
    method: "GET",
    headers: { accept: "application/json", ...credentialHeaders(credential) },
  });
  const body = await readJson(response);
  if (response.status === 401) return { kind: "unauthorized" };
  if (!response.ok) {
    throw new HostedRequestError(
      `getbb.app returned HTTP ${response.status} for the account profile`,
      response.status,
    );
  }
  const parsed = profileResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new HostedRequestError(
      "getbb.app returned an account profile bb doesn't understand",
      response.status,
    );
  }
  return { kind: "ok", profile: parsed.data };
}

export async function startLink(
  baseUrl: string,
  clientName: string,
): Promise<LinkStart> {
  const response = await send(endpoint(baseUrl, "/api/account/link/start"), {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ clientName }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new HostedRequestError(
      `getbb.app returned HTTP ${response.status} when starting sign-in`,
      response.status,
    );
  }
  const parsed = linkStartResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new HostedRequestError(
      "getbb.app returned a sign-in link bb doesn't understand",
      response.status,
    );
  }
  if (new URL(parsed.data.verificationUrl).origin !== new URL(baseUrl).origin) {
    throw new HostedRequestError(
      "getbb.app returned a sign-in link for a different site",
      response.status,
    );
  }
  return parsed.data;
}

export async function pollLink(
  baseUrl: string,
  deviceCode: string,
): Promise<LinkPollResult> {
  const response = await send(endpoint(baseUrl, "/api/account/link/poll"), {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ deviceCode }),
  });
  const body = await readJson(response);
  switch (response.status) {
    case 403:
      return { kind: "denied" };
    case 404:
      return { kind: "invalid" };
    case 409:
      return { kind: "already-used" };
    case 410:
      return { kind: "expired" };
    case 429:
      return { kind: "slow-down" };
  }
  if (!response.ok) {
    throw new HostedRequestError(
      `getbb.app returned HTTP ${response.status} while waiting for approval`,
      response.status,
    );
  }
  const parsed = linkPollResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new HostedRequestError(
      "getbb.app returned a sign-in status bb doesn't understand",
      response.status,
    );
  }
  if (parsed.data.status === "pending") return { kind: "pending" };
  return {
    kind: "approved",
    credential: parsed.data.credential,
    serverId: parsed.data.serverId,
    handle: parsed.data.handle ?? null,
    serverUrl: parsed.data.serverUrl ?? null,
  };
}

function redeemErrorCode(status: number, wireError: string): RedeemErrorCode {
  const detail = wireError.toLowerCase();
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

export async function redeemCode(
  baseUrl: string,
  code: string,
): Promise<RedeemedCredential> {
  let response: Response;
  try {
    response = await send(endpoint(baseUrl, "/api/connect/redeem"), {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ code }),
    });
  } catch (error) {
    throw new RedeemError("network", describeError(error));
  }
  const body = await readJson(response).catch(() => null);
  if (!response.ok) {
    const wire = z.object({ error: z.string() }).safeParse(body);
    const wireError = wire.success ? wire.data.error : "";
    throw new RedeemError(
      redeemErrorCode(response.status, wireError),
      `Redeem failed (${response.status})${wireError ? `: ${wireError}` : ""}`,
    );
  }
  const parsed = redeemResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new RedeemError(
      "network",
      "getbb.app returned a pairing response bb doesn't understand",
    );
  }
  return {
    credential: parsed.data.credential,
    serverId: parsed.data.serverId ?? null,
    handle: parsed.data.handle ?? null,
  };
}

export async function disconnectServer(
  serverUrl: string,
  credential: string,
): Promise<void> {
  const response = await send(endpoint(serverUrl, "/api/connect/disconnect"), {
    method: "POST",
    headers: credentialHeaders(credential),
    signal: AbortSignal.timeout(DISCONNECT_TIMEOUT_MS),
  });
  await response.body?.cancel().catch(() => undefined);
  if (!response.ok && response.status !== 401 && response.status !== 403) {
    throw new HostedRequestError(
      `getbb.app returned HTTP ${response.status}`,
      response.status,
    );
  }
}

export async function authenticatedFetch(args: {
  origin: string;
  method: "GET" | "POST";
  path: string;
  bodyText: string | null;
  credential: string;
}): Promise<AccountFetchResult> {
  const url = endpoint(args.origin, args.path);
  if (url.origin !== args.origin || url.pathname !== args.path) {
    throw new Error(`path ${args.path} does not stay on ${args.origin}`);
  }
  const response = await send(url, {
    method: args.method,
    headers: {
      accept: "application/json",
      ...(args.bodyText === null ? {} : { "content-type": "application/json" }),
      ...credentialHeaders(args.credential),
    },
    ...(args.bodyText === null ? {} : { body: args.bodyText }),
  });
  return { status: response.status, body: await readJson(response) };
}
