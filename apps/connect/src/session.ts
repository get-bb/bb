import { and, eq, gt, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { machine, profile, server, session } from "@bb/connect-db";

// Per-isolate caches. The gate authenticates every request (including each
// static asset), so a single page load fires dozens of requests through the
// same warm isolate. Without caching, that's 3 sequential D1 round-trips per
// request (~150ms each); with it, only the first request in a burst touches
// D1. TTLs are short so sign-out / disconnect take effect quickly (and the DO
// already severs a live tunnel on revoke, so a stale-cached handle still can't
// reach a disconnected server).
const HANDLE_TTL_MS = 15_000;
const SESSION_TTL_MS = 20_000;

interface CacheEntry<T> {
  value: T;
  expires: number;
}
const handleCache = new Map<string, CacheEntry<ResolvedHandle | null>>();
const sessionCache = new Map<string, CacheEntry<string | null>>();

function cacheGet<T>(map: Map<string, CacheEntry<T>>, key: string, now: number): T | undefined {
  const hit = map.get(key);
  if (hit && hit.expires > now) return hit.value;
  if (hit) map.delete(key);
  return undefined;
}

export interface ResolvedHandle {
  userId: string;
  server: {
    id: string;
    credentialHash: string | null;
    revokedAt: Date | null;
  } | null;
}

/**
 * Resolve a handle to its owner + server in a single JOINed query, cached
 * per-isolate. `null` means the handle doesn't exist.
 *
 * Pass `{ fresh: true }` to bypass the read cache for credential-sensitive
 * paths (tunnel (re)connect): the ~15s cache TTL would otherwise let a
 * just-revoked credential re-establish a tunnel from a warm isolate. The
 * fresh read still refreshes the cache for subsequent visitor lookups.
 */
export async function resolveHandle(
  handle: string,
  db: ReturnType<typeof drizzle>,
  options?: { fresh?: boolean },
): Promise<ResolvedHandle | null> {
  const now = Date.now();
  if (!options?.fresh) {
    const cached = cacheGet(handleCache, handle, now);
    if (cached !== undefined) return cached;
  }

  const row = await db
    .select({
      userId: profile.userId,
      serverId: server.id,
      credentialHash: server.credentialHash,
      revokedAt: server.revokedAt,
    })
    .from(profile)
    .leftJoin(server, eq(server.userId, profile.userId))
    .where(eq(profile.handle, handle))
    .get();

  const resolved: ResolvedHandle | null = row
    ? {
        userId: row.userId,
        server: row.serverId
          ? { id: row.serverId, credentialHash: row.credentialHash, revokedAt: row.revokedAt }
          : null,
      }
    : null;
  handleCache.set(handle, { value: resolved, expires: now + HANDLE_TTL_MS });
  return resolved;
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
  db: ReturnType<typeof drizzle>,
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
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
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

const machineCache = new Map<string, CacheEntry<string | null>>();

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Verify a bb-connect machine credential (presented by a daemon on the
 * `x-bb-connect-machine` header) against D1. Returns the owning userId when the
 * credential matches a non-revoked machine. Cached per-isolate like sessions.
 */
export async function verifyMachineCredential(
  credential: string,
  db: ReturnType<typeof drizzle>,
): Promise<string | null> {
  if (!credential) return null;
  const now = Date.now();
  const cached = cacheGet(machineCache, credential, now);
  if (cached !== undefined) return cached;

  const hash = await sha256Hex(credential);
  const row = await db
    .select({ userId: machine.userId })
    .from(machine)
    .where(and(eq(machine.credentialHash, hash), isNull(machine.revokedAt)))
    .get();
  const userId = row?.userId ?? null;
  machineCache.set(credential, { value: userId, expires: now + SESSION_TTL_MS });
  return userId;
}

export function parseCookie(header: string | null, name: string): string | null {
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
