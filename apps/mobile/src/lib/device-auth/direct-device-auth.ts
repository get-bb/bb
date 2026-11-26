import { createDpopProof, type DpopSigner } from "@bb/sdk/dpop";
import { z } from "zod";
import type {
  DeviceAccessRecord,
  DeviceAccessStore,
} from "./device-access-store";
import {
  createDeviceSigner,
  generateDevicePrivateJwk,
  type DeviceCryptoDeps,
} from "./device-key";

export const ACCESS_TOKEN_RENEW_MARGIN_MS = 60_000;
const REQUEST_TIMEOUT_MS = 8000;

const errorBodySchema = z.object({ code: z.string() });

const redeemedSchema = z.object({
  kind: z.literal("device"),
  credential: z.object({ id: z.string().min(1) }),
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.number().int(),
});

const renewedSchema = z.object({
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.number().int(),
});

export const deviceBrowserSessionSchema = z.object({
  token: z.string().min(1),
  cookieName: z.string().min(1),
  expiresAt: z.number().int(),
});
export type DeviceBrowserSession = z.infer<typeof deviceBrowserSessionSchema>;

const ticketSchema = z.object({ ticket: z.string().min(1) });

export class DeviceAccessRevokedError extends Error {
  constructor() {
    super("This bb no longer accepts this phone’s sign-in.");
    this.name = "DeviceAccessRevokedError";
  }
}

export interface DirectDeviceAuth {
  readonly profileId: string;
  readonly serverOrigin: string;
  readonly credentialId: string;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  mintBrowserSession(): Promise<DeviceBrowserSession>;
  websocketUrl(socketUrl: string): Promise<string>;
  onRevoked(listener: () => void): () => void;
}

export interface CreateDirectDeviceAuthArgs {
  profileId: string;
  serverUrl: string;
  record: DeviceAccessRecord;
  store: DeviceAccessStore;
  crypto: DeviceCryptoDeps;
  baseFetch: typeof fetch;
  now?: () => number;
}

function trimmedBase(serverUrl: string): string {
  return serverUrl.replace(/\/+$/u, "");
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

async function errorCode(response: Response): Promise<string | null> {
  try {
    const parsed = errorBodySchema.safeParse(await response.clone().json());
    return parsed.success ? parsed.data.code : null;
  } catch {
    return null;
  }
}

export function createDirectDeviceAuth(
  args: CreateDirectDeviceAuthArgs,
): DirectDeviceAuth {
  const now = args.now ?? Date.now;
  const base = trimmedBase(args.serverUrl);
  const signer: DpopSigner = createDeviceSigner(
    args.record.privateJwk,
    args.crypto,
  );
  let record = args.record;
  let renewing: Promise<void> | null = null;
  let revoked = false;
  const revokedListeners = new Set<() => void>();

  const noteRevoked = (): void => {
    if (revoked) return;
    revoked = true;
    for (const listener of revokedListeners) listener();
  };
  const markRevoked = (): never => {
    noteRevoked();
    throw new DeviceAccessRevokedError();
  };

  const renewOnce = async (): Promise<Response> => {
    const url = `${base}/api/v1/access/token`;
    return args.baseFetch(url, {
      method: "POST",
      headers: {
        authorization: `DPoP ${record.accessToken}`,
        dpop: await createDpopProof({ signer, method: "POST", url }),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  };

  const renew = async (): Promise<void> => {
    let response = await renewOnce();
    if (
      response.status === 401 &&
      (await errorCode(response)) === "invalid_dpop_proof"
    ) {
      response = await renewOnce();
    }
    if (response.status === 401) markRevoked();
    if (!response.ok) {
      throw new Error(
        `Could not renew this phone’s sign-in (HTTP ${response.status})`,
      );
    }
    const parsed = renewedSchema.parse(await response.json());
    record = {
      ...record,
      accessToken: parsed.accessToken,
      accessTokenExpiresAt: parsed.accessTokenExpiresAt,
    };
    await args.store.write(record.credentialId, record);
  };

  const ensureFresh = async (force: boolean): Promise<void> => {
    if (revoked) throw new DeviceAccessRevokedError();
    if (
      !force &&
      record.accessTokenExpiresAt - now() > ACCESS_TOKEN_RENEW_MARGIN_MS
    ) {
      return;
    }
    renewing ??= renew().finally(() => {
      renewing = null;
    });
    await renewing;
  };

  const signedFetch = async (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
  ): Promise<Response> => {
    const url = requestUrl(input);
    const method =
      init?.method ?? (input instanceof Request ? input.method : "GET");
    const headers = new Headers(init?.headers);
    headers.set("authorization", `DPoP ${record.accessToken}`);
    headers.set(
      "dpop",
      await createDpopProof({
        signer,
        method,
        url,
        accessToken: record.accessToken,
      }),
    );
    return args.baseFetch(input, { ...init, headers });
  };

  const authorizedFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    await ensureFresh(false);
    const response = await signedFetch(input, init);
    if (response.status !== 401) return response;
    const code = await errorCode(response);
    if (code === "access_token_expired") {
      await ensureFresh(true);
      return signedFetch(input, init);
    }
    if (code === "invalid_dpop_proof") return signedFetch(input, init);
    if (code === "unauthenticated") noteRevoked();
    return response;
  };

  return {
    profileId: args.profileId,
    serverOrigin: new URL(args.serverUrl).origin,
    credentialId: record.credentialId,
    fetch: authorizedFetch,
    async mintBrowserSession() {
      const response = await authorizedFetch(
        `${base}/api/v1/access/device-browser-sessions`,
        { method: "POST", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      if (response.status === 401) markRevoked();
      if (!response.ok) {
        throw new Error(
          `Could not start this phone’s browser session (HTTP ${response.status})`,
        );
      }
      return deviceBrowserSessionSchema.parse(await response.json());
    },
    async websocketUrl(socketUrl) {
      const response = await authorizedFetch(
        `${base}/api/v1/access/websocket-tickets`,
        { method: "POST", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      if (response.status === 401) markRevoked();
      if (!response.ok) {
        throw new Error(
          `Could not get a realtime ticket (HTTP ${response.status})`,
        );
      }
      const { ticket } = ticketSchema.parse(await response.json());
      const proof = await createDpopProof({
        signer,
        method: "GET",
        url: socketUrl,
        accessToken: ticket,
      });
      const url = new URL(socketUrl);
      url.searchParams.set("wsTicket", ticket);
      url.searchParams.set("dpop", proof);
      return url.href;
    },
    onRevoked(listener) {
      revokedListeners.add(listener);
      return () => {
        revokedListeners.delete(listener);
      };
    },
  };
}

export type RedeemDevicePairingResult =
  | { ok: true; record: DeviceAccessRecord }
  | { ok: false; error: string };

export interface RedeemDevicePairingArgs {
  serverUrl: string;
  code: string;
  label: string;
  crypto: DeviceCryptoDeps;
  fetchImpl: typeof fetch;
  now?: () => number;
}

const ACCESS_LABEL_MAX_LENGTH = 80;

function pairingFailure(status: number, code: string | null): string {
  if (code === "invalid_pairing_code") {
    return "That code is wrong, expired or already used. Make a new one and try again.";
  }
  if (status === 429 || code === "pairing_rate_limited") {
    return "Too many wrong codes. Wait a few minutes, then try again.";
  }
  if (code === "invalid_dpop_proof") {
    return "The server refused this phone’s key. Check the phone’s clock, then try again.";
  }
  return `The server refused the code (HTTP ${status}).`;
}

export async function redeemDevicePairing(
  args: RedeemDevicePairingArgs,
): Promise<RedeemDevicePairingResult> {
  const code = args.code.trim();
  if (code.length === 0) return { ok: false, error: "Enter the sign-in code." };
  const privateJwk = generateDevicePrivateJwk();
  const signer = createDeviceSigner(privateJwk, args.crypto);
  const url = `${trimmedBase(args.serverUrl)}/api/v1/access/pairings/redeem`;
  let response: Response;
  try {
    response = await args.fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        dpop: await createDpopProof({
          signer,
          method: "POST",
          url,
          ...(args.now === undefined ? {} : { nowMs: args.now() }),
        }),
      },
      body: JSON.stringify({
        kind: "device",
        code,
        label: args.label.slice(0, ACCESS_LABEL_MAX_LENGTH),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      error: `Could not reach the server: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: pairingFailure(response.status, await errorCode(response)),
    };
  }
  const parsed = redeemedSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!parsed.success) {
    return { ok: false, error: "The server answered the code unexpectedly." };
  }
  return {
    ok: true,
    record: {
      privateJwk,
      credentialId: parsed.data.credential.id,
      accessToken: parsed.data.accessToken,
      accessTokenExpiresAt: parsed.data.accessTokenExpiresAt,
    },
  };
}
