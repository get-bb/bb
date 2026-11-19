import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import {
  createAccessCredentialId,
  deleteAccessCredential,
  getAccessCredentialByTokenHash,
  insertAccessCredential,
  listAccessCredentials,
  touchAccessCredential,
  type DbConnection,
  type StoredAccessCredential,
} from "@bb/db";
import type { AccessCredentialKind } from "@bb/domain";

export const ACCESS_TOKEN_PREFIX = "bbs_";
const PAIRING_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const PAIRING_CODE_GROUP_LENGTH = 5;
const PAIRING_CODE_TTL_MS = 10 * 60_000;
const MAX_PENDING_PAIRING_CODES = 20;
const PAIRING_FAILURE_WINDOW_MS = 5 * 60_000;
const MAX_PAIRING_FAILURES = 10;
const LAST_USED_WRITE_INTERVAL_MS = 60_000;

export type AccessCredential = StoredAccessCredential;

interface PendingPairingCode {
  expiresAt: number;
}

export interface AccessPairing {
  code: string;
  expiresAt: number;
}

export type RedeemPairingResult =
  | { outcome: "redeemed"; credential: AccessCredential; token: string }
  | { outcome: "invalid" }
  | { outcome: "rate-limited"; retryAt: number };

export interface RedeemPairingArgs {
  code: string;
  kind: AccessCredentialKind;
  label: string;
  origin: string;
  secureOnly: boolean;
}

type SocketCloser = () => void;

export interface AccessService {
  readonly tunnelMarker: string;
  isTunnelMarker(value: string): boolean;
  createPairing(): AccessPairing;
  redeemPairing(args: RedeemPairingArgs): RedeemPairingResult;
  credentialForToken(token: string): AccessCredential | null;
  listCredentials(): AccessCredential[];
  revokeCredential(id: string): boolean;
  trackSocket(credentialId: string, close: SocketCloser): () => void;
}

interface CreateAccessServiceArgs {
  db: DbConnection;
  now?: () => number;
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

export function createAccessService(
  args: CreateAccessServiceArgs,
): AccessService {
  const now = args.now ?? Date.now;
  const tunnelMarker = randomBytes(32).toString("base64url");
  const pendingCodes = new Map<string, PendingPairingCode>();
  const failures: number[] = [];
  const credentialsByHash = new Map<string, AccessCredential>();
  const sockets = new Map<string, Set<SocketCloser>>();

  const prunePendingCodes = (at: number): void => {
    for (const [code, pending] of pendingCodes) {
      if (pending.expiresAt <= at) pendingCodes.delete(code);
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

  const forgetCredential = (id: string): void => {
    for (const [hash, credential] of credentialsByHash) {
      if (credential.id === id) credentialsByHash.delete(hash);
    }
  };

  return {
    tunnelMarker,

    isTunnelMarker(value) {
      return timingSafeEqualStrings(value, tunnelMarker);
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
      pendingCodes.set(code, { expiresAt });
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
      const code = normalizePairingCode(redeem.code);
      if (!pendingCodes.delete(code)) {
        failures.push(at);
        return { outcome: "invalid" };
      }
      const token = `${ACCESS_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
      const credential: AccessCredential = {
        id: createAccessCredentialId(),
        kind: redeem.kind,
        label: redeem.label,
        secureOnly: redeem.secureOnly,
        origin: redeem.origin,
        createdAt: at,
        lastUsedAt: at,
      };
      const tokenHash = hashAccessToken(token);
      insertAccessCredential(args.db, { ...credential, tokenHash });
      credentialsByHash.set(tokenHash, credential);
      return { outcome: "redeemed", credential, token };
    },

    credentialForToken(token) {
      if (!token.startsWith(ACCESS_TOKEN_PREFIX)) return null;
      const tokenHash = hashAccessToken(token);
      let credential =
        credentialsByHash.get(tokenHash) ??
        getAccessCredentialByTokenHash(args.db, tokenHash);
      if (credential === null) return null;
      credentialsByHash.set(tokenHash, credential);
      const at = now();
      if (at - credential.lastUsedAt >= LAST_USED_WRITE_INTERVAL_MS) {
        touchAccessCredential(args.db, { id: credential.id, lastUsedAt: at });
        credential = { ...credential, lastUsedAt: at };
        credentialsByHash.set(tokenHash, credential);
      }
      return credential;
    },

    listCredentials() {
      return listAccessCredentials(args.db);
    },

    revokeCredential(id) {
      const removed = deleteAccessCredential(args.db, id);
      forgetCredential(id);
      const closers = sockets.get(id);
      sockets.delete(id);
      for (const close of closers ?? []) close();
      return removed;
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
