import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  SERVER_OFFLINE_AFTER_MS,
  schema,
  server,
  type ConnectDb,
} from "@bb/connect-db";
import {
  parseCookie,
  verifyMachineCredential,
  verifySessionCookie,
} from "./session.js";
import type { Env } from "./tunnel-do.js";

const SESSION_COOKIE = "__Secure-better-auth.session_token";

const serverCredentialCache = new Map<
  string,
  { value: string | null; expires: number }
>();
const SERVER_CRED_TTL_MS = 20_000;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Verify a durable server tunnel credential (the plaintext stored by a paired
 * bb). Returns the owning userId when the hash matches a non-revoked server row.
 * Same isolate-cache shape as machine credentials so a warm list endpoint does
 * not re-hash every call.
 */
export async function verifyServerCredential(
  credential: string,
  db: ConnectDb,
): Promise<string | null> {
  if (!credential) return null;
  const now = Date.now();
  const cached = serverCredentialCache.get(credential);
  if (cached && cached.expires > now) return cached.value;
  if (cached) serverCredentialCache.delete(credential);

  const hash = await sha256Hex(credential);
  const row = await db
    .select({ userId: server.userId })
    .from(server)
    .where(and(eq(server.credentialHash, hash), isNull(server.revokedAt)))
    .get();
  const userId = row?.userId ?? null;
  serverCredentialCache.set(credential, {
    value: userId,
    expires: now + SERVER_CRED_TTL_MS,
  });
  return userId;
}

/**
 * Resolve the authenticated account for account-scoped connect APIs.
 *
 * Accepts, in order:
 *   1. `x-bb-connect-machine` — machine credential (daemon) OR a paired
 *      server's tunnel credential (plugin passthrough uses the same header
 *      with the stored pairing secret).
 *   2. Owner better-auth session cookie.
 *
 * Returns null when nothing authenticates.
 */
export async function resolveAccountUserId(
  request: Request,
  secret: string,
  db: ConnectDb,
): Promise<string | null> {
  const presented = request.headers.get("x-bb-connect-machine") ?? "";
  if (presented) {
    const machineUserId = await verifyMachineCredential(presented, db);
    if (machineUserId) return machineUserId;
    // Paired bbs store a server tunnel credential, not a machine credential.
    // Accept it on the same header so the plugin can call this endpoint with
    // its stored pairing secret without inventing a second auth scheme.
    const serverUserId = await verifyServerCredential(presented, db);
    if (serverUserId) return serverUserId;
  }

  const cookie = parseCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (!cookie) return null;
  return verifySessionCookie(cookie, secret, db);
}

export interface AccountServerListing {
  /** Routing label (`server.subdomain`) — `<handle>.getbb.app`. */
  handle: string;
  /** Human-readable row name; falls back to handle when empty. */
  name: string;
  /**
   * Best-effort tunnel liveness from `server.last_seen_at` vs
   * `SERVER_OFFLINE_AFTER_MS` (same rule as the dashboard `online` flag).
   * TunnelDO knows the live socket, but probing every DO would fan out per
   * row; heartbeats already write last_seen_at while a tunnel is up.
   */
  live: boolean;
}

/**
 * Every server row owned by `userId`, projected for account listing.
 * Targeted `WHERE user_id = ?` — never load-all-and-filter.
 */
export async function listAccountServers(
  db: ConnectDb,
  userId: string,
  now: number = Date.now(),
): Promise<AccountServerListing[]> {
  const rows = await db
    .select({
      subdomain: server.subdomain,
      name: server.name,
      lastSeenAt: server.lastSeenAt,
      credentialHash: server.credentialHash,
      revokedAt: server.revokedAt,
    })
    .from(server)
    .where(eq(server.userId, userId))
    .all();

  return rows.map((row) => {
    const handle = row.subdomain;
    const trimmed = row.name.trim();
    const name = trimmed.length > 0 ? trimmed : handle;
    const connected = row.credentialHash != null && row.revokedAt == null;
    const lastSeenMs = row.lastSeenAt?.getTime() ?? null;
    const live =
      connected &&
      lastSeenMs != null &&
      now - lastSeenMs < SERVER_OFFLINE_AFTER_MS;
    return { handle, name, live };
  });
}

/** `GET /api/connect/servers` — account-scoped server list for desktop/plugin. */
export async function handleListAccountServers(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8", allow: "GET" },
    });
  }

  const db = drizzle(env.DB, { schema });
  const userId = await resolveAccountUserId(request, env.BETTER_AUTH_SECRET, db);
  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const servers = await listAccountServers(db, userId);
  return new Response(JSON.stringify({ servers }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
