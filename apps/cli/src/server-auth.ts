import { isLoopbackHostname } from "@bb/config/loopback";
import { readLocalAccessTokenSync } from "@bb/config/local-access-token";
import { createDpopProof, createNodeDpopSigner } from "@bb/sdk/node";
import { z } from "zod";
import { resolveCliDataDir } from "./cli-error-log.js";
import {
  forgetServerCredential,
  readServerCredential,
  saveServerCredential,
  serverOrigin,
  type StoredServerCredential,
} from "./server-credentials.js";

const RENEW_BEFORE_EXPIRY_MS = 60_000;

const renewResponseSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.number().int(),
});

const errorCodeSchema = z.object({ code: z.string() });

export type ServerAuthorization =
  | { kind: "none" }
  | { kind: "local"; authorization: string }
  | { kind: "device"; serverUrl: string; credential: StoredServerCredential };

export function resolveServerAuthorization(url: string): ServerAuthorization {
  if (!URL.canParse(url)) return { kind: "none" };
  const credential = readServerCredential(url);
  if (credential !== null) {
    return { kind: "device", serverUrl: serverOrigin(url), credential };
  }
  if (!isLoopbackHostname(new URL(url).hostname)) return { kind: "none" };
  const localToken = readLocalAccessTokenSync(resolveCliDataDir());
  return localToken === null
    ? { kind: "none" }
    : { kind: "local", authorization: `Bearer ${localToken}` };
}

async function renewDeviceToken(
  serverUrl: string,
  credential: StoredServerCredential,
): Promise<StoredServerCredential> {
  const url = `${serverUrl}/api/v1/access/token`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `DPoP ${credential.accessToken}`,
      dpop: await createDpopProof({
        signer: createNodeDpopSigner(credential.privateJwk),
        method: "POST",
        url,
      }),
    },
  });
  if (response.status === 401) {
    const body = errorCodeSchema.safeParse(await response.json());
    if (body.success && body.data.code === "unauthenticated") {
      forgetServerCredential(serverUrl);
      throw new Error(
        `This CLI's sign-in to ${serverUrl} was revoked or expired. Run \`bb access login --code <code>\` again.`,
      );
    }
  }
  if (!response.ok) {
    throw new Error(
      `Could not renew this CLI's sign-in to ${serverUrl} (HTTP ${response.status}).`,
    );
  }
  const renewed = renewResponseSchema.parse(await response.json());
  const next = { ...credential, ...renewed };
  saveServerCredential(serverUrl, next);
  return next;
}

export async function freshDeviceCredential(
  auth: Extract<ServerAuthorization, { kind: "device" }>,
  options: { forceRenew: boolean } = { forceRenew: false },
): Promise<StoredServerCredential> {
  if (
    !options.forceRenew &&
    auth.credential.accessTokenExpiresAt - Date.now() > RENEW_BEFORE_EXPIRY_MS
  ) {
    return auth.credential;
  }
  return renewDeviceToken(auth.serverUrl, auth.credential);
}

export async function deviceRequestHeaders(
  credential: StoredServerCredential,
  method: string,
  url: string,
): Promise<Record<string, string>> {
  return {
    authorization: `DPoP ${credential.accessToken}`,
    dpop: await createDpopProof({
      signer: createNodeDpopSigner(credential.privateJwk),
      method,
      url,
      accessToken: credential.accessToken,
    }),
  };
}

export async function websocketHeaders(
  url: string,
): Promise<Record<string, string>> {
  const auth = resolveServerAuthorization(url);
  switch (auth.kind) {
    case "none":
      return {};
    case "local":
      return { authorization: auth.authorization };
    case "device":
      return deviceRequestHeaders(
        await freshDeviceCredential(auth),
        "GET",
        url,
      );
  }
}

export async function isRetryableDeviceFailure(
  response: Response,
): Promise<boolean> {
  if (response.status !== 401) return false;
  const body = errorCodeSchema.safeParse(
    await response
      .clone()
      .json()
      .catch(() => null),
  );
  return (
    body.success &&
    (body.data.code === "access_token_expired" ||
      body.data.code === "invalid_dpop_proof")
  );
}
