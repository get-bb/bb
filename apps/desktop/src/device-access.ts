import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createDpopProof,
  createNodeDpopSigner,
  dpopPrivateJwkSchema,
  generateDpopPrivateJwk,
  type DpopSigner,
} from "@bb/sdk/node";
import { z } from "zod";
import type { SessionCookieJar } from "./local-server-access.js";

const DEVICE_CREDENTIALS_FILE_NAME = "device-credentials.bin";
export const ACCESS_TOKEN_RENEW_MARGIN_MS = 60_000;
export const BROWSER_COOKIE_REMINT_MARGIN_MS = 15 * 60_000;
const MIN_KEEP_ALIVE_DELAY_MS = 5_000;
const KEEP_ALIVE_RETRY_DELAY_MS = 30_000;

const storedDeviceCredentialSchema = z
  .object({
    privateJwk: dpopPrivateJwkSchema,
    accessToken: z.string().min(1),
    accessTokenExpiresAt: z.number().int(),
    credentialId: z.string().min(1),
  })
  .strict();
export type StoredDeviceCredential = z.infer<
  typeof storedDeviceCredentialSchema
>;

const deviceCredentialsFileSchema = z
  .object({ origins: z.record(z.string(), storedDeviceCredentialSchema) })
  .strict();
type DeviceCredentialsFile = z.infer<typeof deviceCredentialsFileSchema>;

export interface DeviceCredentialEncryption {
  decryptString(encrypted: Buffer): string;
  encryptString(plainText: string): Buffer;
  isEncryptionAvailable(): boolean;
}

export interface DeviceCredentialFs {
  readFile(path: string): Promise<Buffer>;
  rm(path: string, options: { force: true }): Promise<void>;
  writeFile(path: string, data: Buffer): Promise<void>;
}

export interface DeviceCredentialStore {
  canPersist(): boolean;
  read(origin: string): Promise<StoredDeviceCredential | null>;
  write(origin: string, credential: StoredDeviceCredential): Promise<void>;
  remove(origin: string): Promise<void>;
}

const defaultFs: DeviceCredentialFs = {
  readFile,
  rm,
  writeFile: (path, data) => writeFile(path, data, { mode: 0o600 }),
};

export function createDeviceCredentialStore(args: {
  encryption: DeviceCredentialEncryption;
  fs?: DeviceCredentialFs;
  userDataPath: string;
}): DeviceCredentialStore {
  const fsImpl = args.fs ?? defaultFs;
  const filePath = join(args.userDataPath, DEVICE_CREDENTIALS_FILE_NAME);
  let pending: Promise<unknown> = Promise.resolve();

  const readAll = async (): Promise<DeviceCredentialsFile> => {
    if (!args.encryption.isEncryptionAvailable()) return { origins: {} };
    let encrypted: Buffer;
    try {
      encrypted = await fsImpl.readFile(filePath);
    } catch {
      return { origins: {} };
    }
    try {
      const parsed = deviceCredentialsFileSchema.safeParse(
        JSON.parse(args.encryption.decryptString(encrypted)),
      );
      return parsed.success ? parsed.data : { origins: {} };
    } catch {
      return { origins: {} };
    }
  };

  const writeAll = async (file: DeviceCredentialsFile): Promise<void> => {
    if (Object.keys(file.origins).length === 0) {
      await fsImpl.rm(filePath, { force: true });
      return;
    }
    await fsImpl.writeFile(
      filePath,
      args.encryption.encryptString(JSON.stringify(file)),
    );
  };

  const serialized = <T>(task: () => Promise<T>): Promise<T> => {
    const next = pending.then(task, task);
    pending = next.catch(() => undefined);
    return next;
  };

  return {
    canPersist() {
      return args.encryption.isEncryptionAvailable();
    },
    read(origin) {
      return serialized(
        async () => (await readAll()).origins[new URL(origin).origin] ?? null,
      );
    },
    write(origin, credential) {
      return serialized(async () => {
        if (!args.encryption.isEncryptionAvailable()) return;
        const file = await readAll();
        await writeAll({
          origins: { ...file.origins, [new URL(origin).origin]: credential },
        });
      });
    },
    remove(origin) {
      return serialized(async () => {
        const file = await readAll();
        const origins = { ...file.origins };
        delete origins[new URL(origin).origin];
        await writeAll({ origins });
      });
    },
  };
}

export type DeviceFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const errorBodySchema = z.object({ code: z.string(), message: z.string() });

async function errorBody(
  response: Response,
): Promise<{ code: string; message: string }> {
  try {
    const parsed = errorBodySchema.safeParse(await response.clone().json());
    if (parsed.success) return parsed.data;
  } catch {}
  return {
    code: `http_${response.status}`,
    message: `HTTP ${response.status}`,
  };
}

export async function sendDpopRequest(args: {
  accessToken: string | null;
  body?: string;
  bindAccessToken: boolean;
  fetchImpl: DeviceFetch;
  method: string;
  signer: DpopSigner;
  url: string;
}): Promise<Response> {
  let response: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const proof = await createDpopProof({
      signer: args.signer,
      method: args.method,
      url: args.url,
      ...(args.bindAccessToken && args.accessToken !== null
        ? { accessToken: args.accessToken }
        : {}),
    });
    const headers = new Headers({ dpop: proof });
    if (args.accessToken !== null) {
      headers.set("authorization", `DPoP ${args.accessToken}`);
    }
    if (args.body !== undefined) {
      headers.set("content-type", "application/json");
    }
    response = await args.fetchImpl(args.url, {
      method: args.method,
      headers,
      ...(args.body === undefined ? {} : { body: args.body }),
    });
    if (
      response.status !== 401 ||
      (await errorBody(response)).code !== "invalid_dpop_proof"
    ) {
      return response;
    }
  }
  if (response === null) throw new Error("DPoP request was never sent");
  return response;
}

const redeemedDeviceSchema = z.object({
  kind: z.literal("device"),
  credential: z.object({ id: z.string().min(1) }),
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.number().int(),
});

export type PairDeviceResult =
  | { ok: true; credential: StoredDeviceCredential }
  | { ok: false; code: string; message: string };

export async function pairDevice(args: {
  code: string;
  fetchImpl: DeviceFetch;
  label: string;
  origin: string;
  store: DeviceCredentialStore;
}): Promise<PairDeviceResult> {
  if (!args.store.canPersist()) {
    return {
      ok: false,
      code: "credential_storage_unavailable",
      message:
        "This computer's keychain is unavailable, so bb can't keep a sign-in for this server.",
    };
  }
  const privateJwk = generateDpopPrivateJwk();
  const origin = new URL(args.origin).origin;
  let response: Response;
  try {
    response = await sendDpopRequest({
      accessToken: null,
      bindAccessToken: false,
      body: JSON.stringify({
        kind: "device",
        code: args.code,
        label: args.label,
      }),
      fetchImpl: args.fetchImpl,
      method: "POST",
      signer: createNodeDpopSigner(privateJwk),
      url: `${origin}/api/v1/access/pairings/redeem`,
    });
  } catch (error) {
    return {
      ok: false,
      code: "network",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  if (!response.ok) return { ok: false, ...(await errorBody(response)) };
  const parsed = redeemedDeviceSchema.safeParse(await response.json());
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid_response",
      message: "The server's sign-in answer was not understood.",
    };
  }
  const credential: StoredDeviceCredential = {
    privateJwk,
    accessToken: parsed.data.accessToken,
    accessTokenExpiresAt: parsed.data.accessTokenExpiresAt,
    credentialId: parsed.data.credential.id,
  };
  await args.store.write(origin, credential);
  return { ok: true, credential };
}

const renewedSchema = z.object({
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.number().int(),
});

const browserCookieSchema = z.object({
  token: z.string().min(1),
  cookieName: z.string().min(1),
  expiresAt: z.number().int(),
});

export type DeviceSessionOutcome =
  | { kind: "active"; accessTokenExpiresAt: number; cookieExpiresAt: number }
  | { kind: "no-credential" }
  | { kind: "revoked" }
  | { kind: "failed"; detail: string };

export function nextKeepAliveDelayMs(args: {
  accessTokenExpiresAt: number;
  cookieExpiresAt: number;
  now: number;
}): number {
  const due = Math.min(
    args.accessTokenExpiresAt - ACCESS_TOKEN_RENEW_MARGIN_MS,
    args.cookieExpiresAt - BROWSER_COOKIE_REMINT_MARGIN_MS,
  );
  return Math.max(due - args.now, MIN_KEEP_ALIVE_DELAY_MS);
}

async function renewAccessToken(args: {
  credential: StoredDeviceCredential;
  fetchImpl: DeviceFetch;
  origin: string;
  store: DeviceCredentialStore;
}): Promise<
  | { kind: "renewed"; credential: StoredDeviceCredential }
  | { kind: "revoked" }
  | { kind: "failed"; detail: string }
> {
  const response = await sendDpopRequest({
    accessToken: args.credential.accessToken,
    bindAccessToken: false,
    fetchImpl: args.fetchImpl,
    method: "POST",
    signer: createNodeDpopSigner(args.credential.privateJwk),
    url: `${args.origin}/api/v1/access/token`,
  });
  if (!response.ok) {
    const body = await errorBody(response);
    if (response.status === 401 && body.code === "unauthenticated") {
      await args.store.remove(args.origin);
      return { kind: "revoked" };
    }
    return { kind: "failed", detail: `${body.code}: ${body.message}` };
  }
  const parsed = renewedSchema.safeParse(await response.json());
  if (!parsed.success) {
    return { kind: "failed", detail: "unexpected renewal response" };
  }
  const credential: StoredDeviceCredential = {
    ...args.credential,
    accessToken: parsed.data.accessToken,
    accessTokenExpiresAt: parsed.data.accessTokenExpiresAt,
  };
  await args.store.write(args.origin, credential);
  return { kind: "renewed", credential };
}

export async function refreshDeviceSession(args: {
  cookieExpiresAt: number | null;
  cookieJar: SessionCookieJar;
  fetchImpl: DeviceFetch;
  now: () => number;
  origin: string;
  store: DeviceCredentialStore;
}): Promise<DeviceSessionOutcome> {
  const origin = new URL(args.origin).origin;
  let credential = await args.store.read(origin);
  if (credential === null) return { kind: "no-credential" };
  try {
    if (
      credential.accessTokenExpiresAt - ACCESS_TOKEN_RENEW_MARGIN_MS <=
      args.now()
    ) {
      const renewed = await renewAccessToken({
        credential,
        fetchImpl: args.fetchImpl,
        origin,
        store: args.store,
      });
      if (renewed.kind !== "renewed") return renewed;
      credential = renewed.credential;
    }
    if (
      args.cookieExpiresAt !== null &&
      args.cookieExpiresAt - BROWSER_COOKIE_REMINT_MARGIN_MS > args.now()
    ) {
      return {
        kind: "active",
        accessTokenExpiresAt: credential.accessTokenExpiresAt,
        cookieExpiresAt: args.cookieExpiresAt,
      };
    }
    const response = await sendDpopRequest({
      accessToken: credential.accessToken,
      bindAccessToken: true,
      fetchImpl: args.fetchImpl,
      method: "POST",
      signer: createNodeDpopSigner(credential.privateJwk),
      url: `${origin}/api/v1/access/device-browser-sessions`,
    });
    if (!response.ok) {
      const body = await errorBody(response);
      if (response.status === 401 && body.code === "unauthenticated") {
        await args.store.remove(origin);
        return { kind: "revoked" };
      }
      return { kind: "failed", detail: `${body.code}: ${body.message}` };
    }
    const cookie = browserCookieSchema.safeParse(await response.json());
    if (!cookie.success) {
      return { kind: "failed", detail: "unexpected browser session response" };
    }
    await args.cookieJar.set({
      expirationDate: cookie.data.expiresAt / 1000,
      httpOnly: true,
      name: cookie.data.cookieName,
      path: "/",
      sameSite: "lax",
      secure: origin.startsWith("https://"),
      url: origin,
      value: cookie.data.token,
    });
    return {
      kind: "active",
      accessTokenExpiresAt: credential.accessTokenExpiresAt,
      cookieExpiresAt: cookie.data.expiresAt,
    };
  } catch (error) {
    return {
      kind: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface DeviceSessionKeeper {
  readonly origin: string;
  refresh(): Promise<DeviceSessionOutcome>;
  stop(): void;
}

export function createDeviceSessionKeeper(args: {
  cookieJar: SessionCookieJar;
  fetchImpl: DeviceFetch;
  logWarning: (message: string) => void;
  now: () => number;
  onRevoked: () => void;
  origin: string;
  schedule: (task: () => void, delayMs: number) => () => void;
  store: DeviceCredentialStore;
}): DeviceSessionKeeper {
  const origin = new URL(args.origin).origin;
  let cookieExpiresAt: number | null = null;
  let cancelTimer: (() => void) | null = null;
  let stopped = false;
  let inFlight: Promise<DeviceSessionOutcome> | null = null;

  const scheduleNext = (delayMs: number): void => {
    cancelTimer?.();
    cancelTimer = args.schedule(() => {
      cancelTimer = null;
      void refresh();
    }, delayMs);
  };

  const run = async (): Promise<DeviceSessionOutcome> => {
    const outcome = await refreshDeviceSession({
      cookieExpiresAt,
      cookieJar: args.cookieJar,
      fetchImpl: args.fetchImpl,
      now: args.now,
      origin,
      store: args.store,
    });
    if (stopped) return outcome;
    switch (outcome.kind) {
      case "active":
        cookieExpiresAt = outcome.cookieExpiresAt;
        scheduleNext(
          nextKeepAliveDelayMs({
            accessTokenExpiresAt: outcome.accessTokenExpiresAt,
            cookieExpiresAt: outcome.cookieExpiresAt,
            now: args.now(),
          }),
        );
        break;
      case "failed":
        args.logWarning(
          `[desktop] could not keep the sign-in for ${origin} alive: ${outcome.detail}`,
        );
        scheduleNext(KEEP_ALIVE_RETRY_DELAY_MS);
        break;
      case "revoked":
        cookieExpiresAt = null;
        args.onRevoked();
        break;
      case "no-credential":
        cookieExpiresAt = null;
        break;
    }
    return outcome;
  };

  const refresh = (): Promise<DeviceSessionOutcome> => {
    if (inFlight !== null) return inFlight;
    inFlight = run().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return {
    origin,
    refresh,
    stop() {
      stopped = true;
      cancelTimer?.();
      cancelTimer = null;
    },
  };
}
