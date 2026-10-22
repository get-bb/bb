import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import {
  CONNECT_SESSION_EXPIRES_IN_SECONDS,
  CONNECT_SESSION_UPDATE_AGE_SECONDS,
  type ConnectDb,
  labelClaim,
  machine,
  machineRoutingKey,
  profile,
  server,
  session,
  sha256Hex,
} from "@bb/connect-db";

const LABEL_TTL_MS = 15_000;
const SESSION_TTL_MS = 20_000;
const MACHINE_CREDENTIAL_TTL_MS = 20_000;
const SESSION_REFRESH_BEFORE_EXPIRY_MS =
  (CONNECT_SESSION_EXPIRES_IN_SECONDS - CONNECT_SESSION_UPDATE_AGE_SECONDS) *
  1000;

export const LOOKUP_JOIN_TIMEOUT_MS = 2_000;
const LOOKUP_POLL_MS = 10;

type LookupOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

interface InFlightLookup<T> {
  startedAt: number;
  outcome: LookupOutcome<T> | null;
}

async function awaitOutcome<T>(
  lookup: InFlightLookup<T>,
): Promise<LookupOutcome<T> | null> {
  const deadline = lookup.startedAt + LOOKUP_JOIN_TIMEOUT_MS;
  while (lookup.outcome === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, LOOKUP_POLL_MS));
  }
  return lookup.outcome;
}

export class SettledLookupCache<T> {
  private readonly entries = new Map<string, { value: T; expires: number }>();
  private readonly lookups = new Map<string, InFlightLookup<T>>();
  private generation = 0;

  async read(
    key: string,
    options: {
      now: number;
      fresh?: boolean;
      expires: (value: T) => number;
      load: () => Promise<T>;
    },
  ): Promise<T> {
    if (!options.fresh) {
      for (;;) {
        const hit = this.entries.get(key);
        if (hit && hit.expires > options.now) return hit.value;
        if (hit) this.entries.delete(key);
        const inFlight = this.lookups.get(key);
        if (
          inFlight === undefined ||
          Date.now() - inFlight.startedAt >= LOOKUP_JOIN_TIMEOUT_MS
        ) {
          break;
        }
        const outcome = await awaitOutcome(inFlight);
        if (outcome?.ok === true) return outcome.value;
        if (outcome?.ok === false) throw outcome.error;
      }
    }
    const generation = this.generation;
    const lookup: InFlightLookup<T> = { startedAt: Date.now(), outcome: null };
    this.lookups.set(key, lookup);
    try {
      const value = await options.load();
      lookup.outcome = { ok: true, value };
      if (generation === this.generation) {
        this.entries.set(key, { value, expires: options.expires(value) });
      }
      return value;
    } catch (error) {
      lookup.outcome = { ok: false, error };
      throw error;
    } finally {
      if (this.lookups.get(key) === lookup) this.lookups.delete(key);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
    this.lookups.delete(key);
    this.generation += 1;
  }

  prime(key: string, value: T, expires: number): void {
    this.entries.set(key, { value, expires });
  }
}

const labelCache = new SettledLookupCache<ResolvedLabel | null>();

interface CachedSession {
  sessionId: string;
  userId: string;
  expiresAt: number;
}

const sessionCache = new SettledLookupCache<CachedSession | null>();

export function invalidateSessionCookie(cookieValue: string): void {
  sessionCache.delete(safeDecode(cookieValue));
}

interface ResolvedServer {
  kind: "server";
  userId: string;
  server: {
    id: string;
    credentialHash: string | null;
    revokedAt: Date | null;
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
    lastSeenAt: Date | null;
  };
}

type ResolvedLabel = ResolvedServer | ResolvedMachine;

export async function resolveLabel(
  label: string,
  db: ConnectDb,
  options?: { fresh?: boolean },
): Promise<ResolvedLabel | null> {
  const now = Date.now();
  return labelCache.read(label, {
    now,
    fresh: options?.fresh,
    expires: () => now + LABEL_TTL_MS,
    load: () => lookupLabel(label, db),
  });
}

export async function resolveLabels(
  labels: readonly string[],
  db: ConnectDb,
): Promise<Map<string, ResolvedLabel | null>> {
  const wanted = [...new Set(labels)];
  const resolved = new Map<string, ResolvedLabel | null>();
  if (wanted.length === 0) return resolved;
  const now = Date.now();
  const [serverRows, machineRows] = await Promise.all([
    db
      .select({
        label: server.subdomain,
        userId: server.userId,
        serverId: server.id,
        credentialHash: server.credentialHash,
        revokedAt: server.revokedAt,
        lastSeenAt: server.lastSeenAt,
      })
      .from(server)
      .where(inArray(server.subdomain, wanted))
      .all(),
    db
      .select({
        label: machine.subdomain,
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
      .where(inArray(machine.subdomain, wanted))
      .all(),
  ]);
  for (const label of wanted) resolved.set(label, null);
  for (const row of machineRows) {
    if (row.label === null) continue;
    resolved.set(row.label, {
      kind: "machine",
      routingKey: machineRoutingKey(row.label, row.generation),
      userId: row.userId,
      accountHandle: row.accountHandle,
      machine: {
        id: row.machineId,
        credentialHash: row.credentialHash,
        revokedAt: row.revokedAt,
        lastSeenAt: row.lastSeenAt,
      },
    });
  }
  for (const row of serverRows) {
    resolved.set(row.label, {
      kind: "server",
      userId: row.userId,
      server: {
        id: row.serverId,
        credentialHash: row.credentialHash,
        revokedAt: row.revokedAt,
        lastSeenAt: row.lastSeenAt,
      },
    });
  }
  for (const [label, value] of resolved) {
    labelCache.prime(label, value, now + LABEL_TTL_MS);
  }
  return resolved;
}

async function lookupLabel(
  label: string,
  db: ConnectDb,
): Promise<ResolvedLabel | null> {
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
    return {
      kind: "server",
      userId: serverRow.userId,
      server: {
        id: serverRow.serverId,
        credentialHash: serverRow.credentialHash,
        revokedAt: serverRow.revokedAt,
        lastSeenAt: serverRow.lastSeenAt,
      },
    };
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
  if (!machineRow) return null;
  return {
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
  };
}

export interface VerifiedSessionCookie {
  sessionId: string;
  userId: string;
  needsRefresh: boolean;
}

function verifiedSession(
  session: CachedSession,
  now: number,
): VerifiedSessionCookie {
  return {
    sessionId: session.sessionId,
    userId: session.userId,
    needsRefresh: session.expiresAt <= now + SESSION_REFRESH_BEFORE_EXPIRY_MS,
  };
}

export async function verifySessionCookieDetails(
  cookieValue: string,
  secret: string,
  db: ConnectDb,
): Promise<VerifiedSessionCookie | null> {
  const decoded = safeDecode(cookieValue);
  const dot = decoded.lastIndexOf(".");
  if (dot <= 0) return null;

  const now = Date.now();
  let loaded = false;
  const read = (fresh: boolean) =>
    sessionCache.read(decoded, {
      now,
      fresh,
      expires: (looked) =>
        looked === null
          ? now + SESSION_TTL_MS
          : Math.min(now + SESSION_TTL_MS, looked.expiresAt),
      load: () => {
        loaded = true;
        return lookupCachedSession(
          decoded.slice(0, dot),
          decoded.slice(dot + 1),
          secret,
          db,
          now,
        );
      },
    });
  let cachedSession = await read(false);
  if (
    !loaded &&
    cachedSession !== null &&
    verifiedSession(cachedSession, now).needsRefresh
  ) {
    cachedSession = await read(true);
  }
  return cachedSession === null ? null : verifiedSession(cachedSession, now);
}

async function lookupCachedSession(
  token: string,
  providedSig: string,
  secret: string,
  db: ConnectDb,
  now: number,
): Promise<CachedSession | null> {
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
  if (!constantTimeEqual(providedSig, expectedSig)) return null;

  const row = await db
    .select({
      expiresAt: session.expiresAt,
      sessionId: session.id,
      userId: session.userId,
    })
    .from(session)
    .where(and(eq(session.token, token), gt(session.expiresAt, new Date(now))))
    .get();
  return row
    ? {
        sessionId: row.sessionId,
        userId: row.userId,
        expiresAt: row.expiresAt.getTime(),
      }
    : null;
}

const machineLastSeenWrites = new Map<string, number>();
export const MACHINE_LAST_SEEN_WRITE_INTERVAL_MS = 60_000;

export async function verifyMachineCredential(
  credential: string,
  db: ConnectDb,
): Promise<string | null> {
  return (await verifyMachineCredentialDetails(credential, db))?.userId ?? null;
}

interface VerifiedMachine {
  machineId: string;
  userId: string;
}

const machineCredentialCache = new SettledLookupCache<VerifiedMachine | null>();

export async function verifyMachineCredentialDetails(
  credential: string,
  db: ConnectDb,
): Promise<VerifiedMachine | null> {
  if (!credential) return null;
  const hash = await sha256Hex(credential);
  const now = Date.now();
  return machineCredentialCache.read(hash, {
    now,
    expires: () => now + MACHINE_CREDENTIAL_TTL_MS,
    load: () => lookupMachineCredential(hash, db),
  });
}

async function lookupMachineCredential(
  hash: string,
  db: ConnectDb,
): Promise<VerifiedMachine | null> {
  const row = await db
    .select({ machineId: machine.id, userId: machine.userId })
    .from(machine)
    .where(and(eq(machine.credentialHash, hash), isNull(machine.revokedAt)))
    .get();
  return row ?? null;
}

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
