import { and, eq, gt, isNull } from "drizzle-orm";
import {
  type ConnectDb,
  labelClaim,
  machine,
  machineRoutingKey,
  profile,
  server,
  session,
} from "@bb/connect-db";

// Per-isolate caches. The gate authenticates every request (including each
// static asset), so a single page load fires dozens of requests through the
// same warm isolate. Without caching, that's 3 sequential D1 round-trips per
// request (~150ms each); with it, only the first request in a burst touches
// D1. TTLs are short so sign-out / disconnect take effect quickly (and the DO
// already severs a live tunnel on revoke, so a stale-cached label still can't
// reach a disconnected server).
const LABEL_TTL_MS = 15_000;
const SESSION_TTL_MS = 20_000;

interface CacheEntry<T> {
  value: T;
  expires: number;
}
const labelCache = new Map<string, CacheEntry<ResolvedLabel | null>>();
const sessionCache = new Map<string, CacheEntry<string | null>>();

function cacheGet<T>(
  map: Map<string, CacheEntry<T>>,
  key: string,
  now: number,
): T | undefined {
  const hit = map.get(key);
  if (hit && hit.expires > now) return hit.value;
  if (hit) map.delete(key);
  return undefined;
}

interface ResolvedServer {
  kind: "server";
  /**
   * The account that owns this server (`server.userId`). Session and machine
   * auth scope to this: only this account may visit the server, and only this
   * account's machines may traverse `/internal/*`. With multi-server, an
   * account owns several servers, each with its own `userId === this account`.
   */
  userId: string;
  server: {
    id: string;
    credentialHash: string | null;
    revokedAt: Date | null;
    /** Last tunnel heartbeat; null = never connected. Drives the offline page. */
    lastSeenAt: Date | null;
  };
}

interface ResolvedMachine {
  kind: "machine";
  routingKey: string;
  userId: string;
  accountHandle: string;
  machine: {
    id: string;
    credentialHash: string;
    revokedAt: Date | null;
    /** Last tunnel heartbeat; null = never connected. */
    lastSeenAt: Date | null;
  };
}

type ResolvedLabel = ResolvedServer | ResolvedMachine;

/**
 * Preserve the existing server-label resolution path and precedence: first
 * resolve `server.subdomain` exactly as main does, then fall through to a
 * machine label. Machine claims supply the ownership generation used to keep a
 * stale cached resolution pinned to the previous machine TunnelDO after reuse.
 *
 * Pass `{ fresh: true }` to bypass the read cache for credential-sensitive
 * paths (tunnel (re)connect): the ~15s cache TTL would otherwise let a
 * just-revoked credential re-establish a tunnel from a warm isolate. The
 * fresh read still refreshes the cache for subsequent visitor lookups.
 */
export async function resolveLabel(
  label: string,
  db: ConnectDb,
  options?: { fresh?: boolean },
): Promise<ResolvedLabel | null> {
  const now = Date.now();
  if (!options?.fresh) {
    const cached = cacheGet(labelCache, label, now);
    if (cached !== undefined) return cached;
  }

  const serverRow = await db
    .select({
      userId: server.userId,
      serverId: server.id,
      credentialHash: server.credentialHash,
      revokedAt: server.revokedAt,
      lastSeenAt: server.lastSeenAt,
    })
    .from(server)
    .where(eq(server.subdomain, label))
    .get();
  if (serverRow) {
    const resolvedServer: ResolvedServer = {
      kind: "server",
      userId: serverRow.userId,
      server: {
        id: serverRow.serverId,
        credentialHash: serverRow.credentialHash,
        revokedAt: serverRow.revokedAt,
        lastSeenAt: serverRow.lastSeenAt,
      },
    };
    labelCache.set(label, {
      value: resolvedServer,
      expires: now + LABEL_TTL_MS,
    });
    return resolvedServer;
  }

  const machineRow = await db
    .select({
      userId: machine.userId,
      accountHandle: profile.handle,
      machineId: machine.id,
      credentialHash: machine.credentialHash,
      revokedAt: machine.revokedAt,
      lastSeenAt: machine.lastSeenAt,
      generation: labelClaim.generation,
    })
    .from(machine)
    .innerJoin(profile, eq(profile.userId, machine.userId))
    .innerJoin(
      labelClaim,
      and(
        eq(labelClaim.label, machine.subdomain),
        eq(labelClaim.kind, "machine"),
        eq(labelClaim.ownerId, machine.id),
      ),
    )
    .where(eq(machine.subdomain, label))
    .get();
  const resolvedMachine: ResolvedMachine | null = machineRow
    ? {
        kind: "machine",
        routingKey: machineRoutingKey(label, machineRow.generation),
        userId: machineRow.userId,
        accountHandle: machineRow.accountHandle,
        machine: {
          id: machineRow.machineId,
          credentialHash: machineRow.credentialHash,
          revokedAt: machineRow.revokedAt,
          lastSeenAt: machineRow.lastSeenAt,
        },
      }
    : null;
  labelCache.set(label, {
    value: resolvedMachine,
    expires: now + LABEL_TTL_MS,
  });
  return resolvedMachine;
}

/**
 * Verify a better-auth session cookie directly against D1 (no cross-worker
 * call), cached per-isolate. Mirrors better-auth's
 * `${token}.${base64(hmac-sha256(token,secret))}` scheme. Returns the userId
 * when the signature is valid and the session row exists and is unexpired.
 */
export async function verifySessionCookie(
  cookieValue: string,
  secret: string,
  db: ConnectDb,
): Promise<string | null> {
  // better-auth URL-encodes the cookie value, so the base64 signature arrives
  // with %2F/%2B/%3D. Decode before splitting/comparing (the hex token is
  // unaffected by decoding).
  const decoded = safeDecode(cookieValue);
  const dot = decoded.lastIndexOf(".");
  if (dot <= 0) return null;
  const token = decoded.slice(0, dot);
  const providedSig = decoded.slice(dot + 1);

  const now = Date.now();
  // Cache on the full `token.sig` value, not the token alone: keying on the
  // token would return a cached userId before the signature is checked, so a
  // valid `token` with a forged signature would authenticate (and a forged
  // one would negative-poison the real token). The full-cookie key makes the
  // cache reflect exactly what passed verification.
  const cached = cacheGet(sessionCache, decoded, now);
  if (cached !== undefined) return cached;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(token),
  );
  const expectedSig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
  if (!constantTimeEqual(providedSig, expectedSig)) {
    sessionCache.set(decoded, { value: null, expires: now + SESSION_TTL_MS });
    return null;
  }

  const row = await db
    .select({ userId: session.userId })
    .from(session)
    .where(and(eq(session.token, token), gt(session.expiresAt, new Date())))
    .get();
  const userId = row?.userId ?? null;
  sessionCache.set(decoded, { value: userId, expires: now + SESSION_TTL_MS });
  return userId;
}

const machineLastSeenWrites = new Map<string, number>();
export const MACHINE_LAST_SEEN_WRITE_INTERVAL_MS = 60_000;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify a bb-connect machine credential (presented by a daemon on the
 * `x-bb-connect-machine` header) against D1. Returns the owning userId when the
 * credential matches a non-revoked machine. Successful verification is not
 * cached: dashboard revocation is the lost-machine recovery hatch and must
 * take effect on the next request.
 */
export async function verifyMachineCredential(
  credential: string,
  db: ConnectDb,
): Promise<string | null> {
  return (await verifyMachineCredentialDetails(credential, db))?.userId ?? null;
}

export async function verifyMachineCredentialDetails(
  credential: string,
  db: ConnectDb,
): Promise<{ machineId: string; userId: string } | null> {
  if (!credential) return null;
  const hash = await sha256Hex(credential);
  const row = await db
    .select({ machineId: machine.id, userId: machine.userId })
    .from(machine)
    .where(and(eq(machine.credentialHash, hash), isNull(machine.revokedAt)))
    .get();
  return row ?? null;
}

/** Best-effort liveness write, capped to one D1 update per machine per minute/isolate. */
export async function markMachineSeen(
  machineId: string,
  db: ConnectDb,
  now: number = Date.now(),
): Promise<boolean> {
  const previous = machineLastSeenWrites.get(machineId);
  if (
    previous !== undefined &&
    now - previous < MACHINE_LAST_SEEN_WRITE_INTERVAL_MS
  ) {
    return false;
  }
  machineLastSeenWrites.set(machineId, now);
  await db
    .update(machine)
    .set({ lastSeenAt: new Date(now) })
    .where(and(eq(machine.id, machineId), isNull(machine.revokedAt)))
    .run();
  return true;
}

export function parseCookie(
  header: string | null,
  name: string,
): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
