import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import {
  createAccessCredentialId,
  deleteAccessCredential,
  deleteAccessCredentialsByKindAndLabel,
  deleteExpiredAccessCredentials,
  getAccessCredential,
  getAccessCredentialByTokenHash,
  insertAccessCredential,
  listAccessCredentials,
  touchAccessCredential,
  type DbConnection,
  type StoredAccessCredential,
} from "@bb/db";
import {
  LOCAL_ACCESS_TOKEN_FILE_NAME,
  localAccessTokenFromSecret,
} from "@bb/config/local-access-token";
import { readOrCreateSecretFile } from "@bb/secret-storage";
import { z } from "zod";
import { verifyDpopProof, type DpopFailure } from "./dpop.js";

export const ACCESS_TOKEN_PREFIX = "bbs_";
export const DEVICE_ACCESS_TOKEN_PREFIX = "bbt_";
const SIGNING_KEY_FILE_NAME = "access-signing-key";
const PAIRING_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const PAIRING_CODE_GROUP_LENGTH = 5;
const PAIRING_CODE_TTL_MS = 10 * 60_000;
const MAX_PENDING_PAIRING_CODES = 20;
const PAIRING_FAILURE_WINDOW_MS = 5 * 60_000;
const MAX_PAIRING_FAILURES = 10;
const LAST_USED_WRITE_INTERVAL_MS = 60_000;
export const SESSION_IDLE_LIFETIME_MS = 30 * 24 * 60 * 60_000;
export const DEVICE_ACCESS_TOKEN_TTL_MS = 60 * 60_000;
export const DEVICE_BROWSER_SESSION_TTL_MS = 60 * 60_000;
export const WEBSOCKET_TICKET_TTL_MS = 5 * 60_000;
const REPLAY_RETENTION_MS = 2 * 300_000;

export type AccessCredential = StoredAccessCredential;

export interface AccessPairing {
  code: string;
  expiresAt: number;
}

export interface IssuedDeviceToken {
  accessToken: string;
  accessTokenExpiresAt: number;
}

export type RedeemPairingResult =
  | { outcome: "redeemed-browser"; credential: AccessCredential; token: string }
  | {
      outcome: "redeemed-device";
      credential: AccessCredential;
      token: IssuedDeviceToken;
    }
  | { outcome: "invalid" }
  | { outcome: "invalid-proof"; failure: DpopFailure }
  | { outcome: "rate-limited"; retryAt: number };

export interface DpopRequest {
  method: string;
  url: string;
  proof: string | undefined;
}

export type RedeemPairingArgs = {
  code: string;
  label: string;
  origin: string;
  secureOnly: boolean;
} & ({ kind: "browser" } | { kind: "device"; proof: DpopRequest });

export type DeviceTokenCheck =
  | { outcome: "valid"; credential: AccessCredential }
  | { outcome: "expired" }
  | { outcome: "invalid-proof"; failure: DpopFailure }
  | { outcome: "invalid" };

export type RenewDeviceTokenResult =
  | {
      outcome: "renewed";
      credential: AccessCredential;
      token: IssuedDeviceToken;
    }
  | { outcome: "invalid-proof"; failure: DpopFailure }
  | { outcome: "invalid" };

export interface IssuedSessionCookie {
  credential: AccessCredential;
  token: string;
}

export interface WebSocketTicket {
  ticket: string;
  expiresAt: number;
}

type SocketCloser = () => void;

export interface AccessService {
  readonly tunnelMarker: string;
  isTunnelMarker(value: string): boolean;
  isLocalToken(value: string): boolean;
  createPairing(): AccessPairing;
  redeemPairing(args: RedeemPairingArgs): RedeemPairingResult;
  credentialForToken(token: string): AccessCredential | null;
  checkDeviceToken(token: string, proof: DpopRequest): DeviceTokenCheck;
  renewDeviceToken(token: string, proof: DpopRequest): RenewDeviceTokenResult;
  createLocalBrowserSession(args: {
    label: string;
    origin: string;
  }): IssuedSessionCookie;
  createDeviceBrowserSession(args: {
    device: AccessCredential;
    origin: string;
    secureOnly: boolean;
  }): IssuedSessionCookie;
  createWebSocketTicket(credential: AccessCredential): WebSocketTicket;
  checkWebSocketTicket(ticket: string, proof: DpopRequest): DeviceTokenCheck;
  listCredentials(): AccessCredential[];
  revokeCredential(id: string): boolean;
  sweepExpired(): void;
  trackSocket(credentialId: string, close: SocketCloser): () => void;
}

interface CreateAccessServiceArgs {
  db: DbConnection;
  localToken: string;
  signingKey: string;
  now?: () => number;
}

const signedClaimsSchema = z
  .object({
    v: z.literal(1),
    use: z.enum(["access", "websocket"]),
    sid: z.string().min(1),
    jkt: z.string().nullable(),
    iat: z.number().int(),
    exp: z.number().int(),
  })
  .strict();
type SignedClaims = z.infer<typeof signedClaimsSchema>;

export async function readOrCreateLocalAccessToken(
  dataDir: string,
): Promise<string> {
  return localAccessTokenFromSecret(
    await readOrCreateSecretFile({
      bytes: 32,
      dataDir,
      encoding: "base64url",
      fileName: LOCAL_ACCESS_TOKEN_FILE_NAME,
    }),
  );
}

export function readOrCreateAccessSigningKey(dataDir: string): Promise<string> {
  return readOrCreateSecretFile({
    bytes: 32,
    dataDir,
    encoding: "base64url",
    fileName: SIGNING_KEY_FILE_NAME,
  });
}

export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function randomPairingCodeGroup(): string {
  let group = "";
  for (let index = 0; index < PAIRING_CODE_GROUP_LENGTH; index += 1) {
    group += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)];
  }
  return group;
}

export function normalizePairingCode(raw: string): string {
  const compact = raw
    .toUpperCase()
    .replace(/[\s-]/gu, "")
    .replace(/O/gu, "0")
    .replace(/[IL]/gu, "1");
  if (compact.length !== PAIRING_CODE_GROUP_LENGTH * 2) return compact;
  return `${compact.slice(0, PAIRING_CODE_GROUP_LENGTH)}-${compact.slice(PAIRING_CODE_GROUP_LENGTH)}`;
}

function newOpaqueToken(): string {
  return `${ACCESS_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function createAccessService(
  args: CreateAccessServiceArgs,
): AccessService {
  const now = args.now ?? Date.now;
  const startedAtSeconds = Math.floor(now() / 1000);
  const tunnelMarker = randomBytes(32).toString("base64url");
  const pendingCodes = new Map<string, number>();
  const failures: number[] = [];
  const credentialsByHash = new Map<string, AccessCredential>();
  const sockets = new Map<string, Set<SocketCloser>>();
  const seenProofs = new Map<string, number>();

  const sign = (claims: SignedClaims): string => {
    const body = Buffer.from(JSON.stringify(claims), "utf8").toString(
      "base64url",
    );
    const mac = createHmac("sha256", args.signingKey)
      .update(body)
      .digest("base64url");
    return `${DEVICE_ACCESS_TOKEN_PREFIX}${body}.${mac}`;
  };

  const readSigned = (token: string): SignedClaims | null => {
    if (!token.startsWith(DEVICE_ACCESS_TOKEN_PREFIX)) return null;
    const [body, mac, extra] = token
      .slice(DEVICE_ACCESS_TOKEN_PREFIX.length)
      .split(".");
    if (body === undefined || mac === undefined || extra !== undefined) {
      return null;
    }
    const expected = createHmac("sha256", args.signingKey)
      .update(body)
      .digest("base64url");
    if (!timingSafeEqualStrings(mac, expected)) return null;
    try {
      const parsed = signedClaimsSchema.safeParse(
        JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
      );
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  };

  const prunePendingCodes = (at: number): void => {
    for (const [code, expiresAt] of pendingCodes) {
      if (expiresAt <= at) pendingCodes.delete(code);
    }
  };

  const recentFailures = (at: number): number => {
    while (
      failures.length > 0 &&
      failures[0]! <= at - PAIRING_FAILURE_WINDOW_MS
    ) {
      failures.shift();
    }
    return failures.length;
  };

  const forgetCredentials = (ids: ReadonlySet<string>): void => {
    for (const [hash, credential] of credentialsByHash) {
      if (
        ids.has(credential.id) ||
        (credential.parentId !== null && ids.has(credential.parentId))
      ) {
        credentialsByHash.delete(hash);
      }
    }
  };

  const closeSockets = (ids: Iterable<string>): void => {
    for (const id of ids) {
      const closers = sockets.get(id);
      sockets.delete(id);
      for (const close of closers ?? []) close();
    }
  };

  const consumeProof = (jkt: string, jti: string, at: number): boolean => {
    for (const [key, expiresAt] of seenProofs) {
      if (expiresAt <= at) seenProofs.delete(key);
    }
    const key = `${jkt}:${jti}`;
    if (seenProofs.has(key)) return false;
    seenProofs.set(key, at + REPLAY_RETENTION_MS);
    return true;
  };

  const checkProof = (
    proof: DpopRequest,
    expectedJkt: string | null,
    boundToken: string | null,
  ): { ok: true; jkt: string } | { ok: false; failure: DpopFailure } => {
    const at = now();
    const verified = verifyDpopProof({
      proof: proof.proof,
      method: proof.method,
      url: proof.url,
      nowSeconds: Math.floor(at / 1000),
      notBeforeSeconds: startedAtSeconds,
      expectedJkt,
      accessToken: boundToken,
    });
    if (!verified.ok) return verified;
    if (!consumeProof(verified.jkt, verified.jti, at)) {
      return { ok: false, failure: "replay" };
    }
    return { ok: true, jkt: verified.jkt };
  };

  const issueDeviceToken = (
    credential: AccessCredential,
  ): IssuedDeviceToken => {
    const at = now();
    const accessTokenExpiresAt = Math.min(
      at + DEVICE_ACCESS_TOKEN_TTL_MS,
      credential.expiresAt,
    );
    return {
      accessToken: sign({
        v: 1,
        use: "access",
        sid: credential.id,
        jkt: credential.dpopJkt,
        iat: at,
        exp: accessTokenExpiresAt,
      }),
      accessTokenExpiresAt,
    };
  };

  const liveCredential = (id: string): AccessCredential | null => {
    const credential = getAccessCredential(args.db, id);
    return credential === null || credential.expiresAt <= now()
      ? null
      : credential;
  };

  const checkSigned = (
    token: string,
    use: SignedClaims["use"],
    proof: DpopRequest,
  ): DeviceTokenCheck => {
    const claims = readSigned(token);
    if (claims === null || claims.use !== use) return { outcome: "invalid" };
    const credential = liveCredential(claims.sid);
    if (credential === null || credential.dpopJkt !== claims.jkt) {
      return { outcome: "invalid" };
    }
    if (claims.jkt !== null) {
      const checked = checkProof(proof, claims.jkt, token);
      if (!checked.ok) {
        return { outcome: "invalid-proof", failure: checked.failure };
      }
    }
    if (claims.exp <= now()) return { outcome: "expired" };
    return { outcome: "valid", credential };
  };

  const insertSessionCookie = (
    credential: Omit<AccessCredential, "id" | "createdAt" | "lastUsedAt">,
  ): IssuedSessionCookie => {
    const at = now();
    const token = newOpaqueToken();
    const stored: AccessCredential = {
      ...credential,
      id: createAccessCredentialId(),
      createdAt: at,
      lastUsedAt: at,
    };
    const tokenHash = hashAccessToken(token);
    insertAccessCredential(args.db, { ...stored, tokenHash });
    credentialsByHash.set(tokenHash, stored);
    return { credential: stored, token };
  };

  return {
    tunnelMarker,

    isTunnelMarker(value) {
      return timingSafeEqualStrings(value, tunnelMarker);
    },

    isLocalToken(value) {
      return timingSafeEqualStrings(value, args.localToken);
    },

    createPairing() {
      const at = now();
      prunePendingCodes(at);
      while (pendingCodes.size >= MAX_PENDING_PAIRING_CODES) {
        const oldest = pendingCodes.keys().next().value;
        if (oldest === undefined) break;
        pendingCodes.delete(oldest);
      }
      let code = "";
      do {
        code = `${randomPairingCodeGroup()}-${randomPairingCodeGroup()}`;
      } while (pendingCodes.has(code));
      const expiresAt = at + PAIRING_CODE_TTL_MS;
      pendingCodes.set(code, expiresAt);
      return { code, expiresAt };
    },

    redeemPairing(redeem) {
      const at = now();
      prunePendingCodes(at);
      if (recentFailures(at) >= MAX_PAIRING_FAILURES) {
        return {
          outcome: "rate-limited",
          retryAt: failures[0]! + PAIRING_FAILURE_WINDOW_MS,
        };
      }
      let jkt: string | null = null;
      if (redeem.kind === "device") {
        const checked = checkProof(redeem.proof, null, null);
        if (!checked.ok) {
          return { outcome: "invalid-proof", failure: checked.failure };
        }
        jkt = checked.jkt;
      }
      const code = normalizePairingCode(redeem.code);
      if (!pendingCodes.delete(code)) {
        failures.push(at);
        return { outcome: "invalid" };
      }
      if (jkt === null) {
        const issued = insertSessionCookie({
          kind: "browser",
          label: redeem.label,
          dpopJkt: null,
          parentId: null,
          secureOnly: redeem.secureOnly,
          origin: redeem.origin,
          expiresAt: at + SESSION_IDLE_LIFETIME_MS,
        });
        return {
          outcome: "redeemed-browser",
          credential: issued.credential,
          token: issued.token,
        };
      }
      const credential: AccessCredential = {
        id: createAccessCredentialId(),
        kind: "device",
        label: redeem.label,
        dpopJkt: jkt,
        parentId: null,
        secureOnly: redeem.secureOnly,
        origin: redeem.origin,
        createdAt: at,
        lastUsedAt: at,
        expiresAt: at + SESSION_IDLE_LIFETIME_MS,
      };
      insertAccessCredential(args.db, { ...credential, tokenHash: null });
      return {
        outcome: "redeemed-device",
        credential,
        token: issueDeviceToken(credential),
      };
    },

    credentialForToken(token) {
      if (!token.startsWith(ACCESS_TOKEN_PREFIX)) return null;
      const tokenHash = hashAccessToken(token);
      let credential =
        credentialsByHash.get(tokenHash) ??
        getAccessCredentialByTokenHash(args.db, tokenHash);
      if (credential === null) return null;
      const at = now();
      if (credential.expiresAt <= at) {
        credentialsByHash.delete(tokenHash);
        return null;
      }
      if (
        credential.kind !== "device-browser" &&
        at - credential.lastUsedAt >= LAST_USED_WRITE_INTERVAL_MS
      ) {
        const expiresAt = at + SESSION_IDLE_LIFETIME_MS;
        touchAccessCredential(args.db, {
          id: credential.id,
          lastUsedAt: at,
          expiresAt,
        });
        credential = { ...credential, lastUsedAt: at, expiresAt };
      }
      credentialsByHash.set(tokenHash, credential);
      return credential;
    },

    checkDeviceToken(token, proof) {
      return checkSigned(token, "access", proof);
    },

    renewDeviceToken(token, proof) {
      const claims = readSigned(token);
      if (claims === null || claims.use !== "access" || claims.jkt === null) {
        return { outcome: "invalid" };
      }
      const credential = liveCredential(claims.sid);
      if (credential === null || credential.dpopJkt !== claims.jkt) {
        return { outcome: "invalid" };
      }
      const checked = checkProof(proof, claims.jkt, null);
      if (!checked.ok)
        return { outcome: "invalid-proof", failure: checked.failure };
      const at = now();
      const renewed: AccessCredential = {
        ...credential,
        lastUsedAt: at,
        expiresAt: at + SESSION_IDLE_LIFETIME_MS,
      };
      touchAccessCredential(args.db, {
        id: renewed.id,
        lastUsedAt: renewed.lastUsedAt,
        expiresAt: renewed.expiresAt,
      });
      return {
        outcome: "renewed",
        credential: renewed,
        token: issueDeviceToken(renewed),
      };
    },

    createLocalBrowserSession(session) {
      const replaced = new Set(
        deleteAccessCredentialsByKindAndLabel(args.db, {
          kind: "local-browser",
          label: session.label,
        }),
      );
      forgetCredentials(replaced);
      closeSockets(replaced);
      return insertSessionCookie({
        kind: "local-browser",
        label: session.label,
        dpopJkt: null,
        parentId: null,
        secureOnly: false,
        origin: session.origin,
        expiresAt: now() + SESSION_IDLE_LIFETIME_MS,
      });
    },

    createDeviceBrowserSession(session) {
      return insertSessionCookie({
        kind: "device-browser",
        label: session.device.label,
        dpopJkt: null,
        parentId: session.device.id,
        secureOnly: session.secureOnly,
        origin: session.origin,
        expiresAt: Math.min(
          now() + DEVICE_BROWSER_SESSION_TTL_MS,
          session.device.expiresAt,
        ),
      });
    },

    createWebSocketTicket(credential) {
      const at = now();
      const expiresAt = Math.min(
        at + WEBSOCKET_TICKET_TTL_MS,
        credential.expiresAt,
      );
      return {
        ticket: sign({
          v: 1,
          use: "websocket",
          sid: credential.id,
          jkt: credential.dpopJkt,
          iat: at,
          exp: expiresAt,
        }),
        expiresAt,
      };
    },

    checkWebSocketTicket(ticket, proof) {
      return checkSigned(ticket, "websocket", proof);
    },

    listCredentials() {
      const at = now();
      return listAccessCredentials(args.db).filter(
        (credential) => credential.expiresAt > at,
      );
    },

    revokeCredential(id) {
      const removed = deleteAccessCredential(args.db, id);
      forgetCredentials(new Set([id]));
      closeSockets([id]);
      return removed;
    },

    sweepExpired() {
      const expired = new Set(deleteExpiredAccessCredentials(args.db, now()));
      if (expired.size === 0) return;
      forgetCredentials(expired);
      closeSockets(expired);
    },

    trackSocket(credentialId, close) {
      let closers = sockets.get(credentialId);
      if (closers === undefined) {
        closers = new Set();
        sockets.set(credentialId, closers);
      }
      closers.add(close);
      return () => {
        const current = sockets.get(credentialId);
        current?.delete(close);
        if (current?.size === 0) sockets.delete(credentialId);
      };
    },
  };
}
