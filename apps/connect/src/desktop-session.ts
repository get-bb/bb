import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import {
  CONNECT_SESSION_EXPIRES_IN_SECONDS,
  CONNECT_SESSION_UPDATE_AGE_SECONDS,
  machine,
  server,
  session,
  type ConnectDb,
  first,
} from "@bb/connect-db";
import { SettledLookupCache } from "./session.js";

export const DESKTOP_SESSION_TTL_MS = CONNECT_SESSION_EXPIRES_IN_SECONDS * 1000;
const DESKTOP_SESSION_REFRESH_BEFORE_EXPIRY_MS =
  (CONNECT_SESSION_EXPIRES_IN_SECONDS - CONNECT_SESSION_UPDATE_AGE_SECONDS) *
  1000;
const LEGACY_DESKTOP_SESSION_TTL_MS = 60 * 60 * 1000;
const GRANT_TTL_MS = 60_000;
export const DESKTOP_SESSION_USE_WRITE_MS = 60 * 60 * 1000;
const GRANT_MISS_TTL_MS = 20_000;

export type DesktopSessionGrant =
  | { kind: "machine"; credentialHash: string }
  | { kind: "server"; credentialHash: string }
  | { kind: "session"; sessionId: string };

export interface DesktopSessionAccount {
  userId: string;
  grant: DesktopSessionGrant;
}

export interface DesktopSessionCookie {
  domain: string;
  expiresAt: number;
  name: string;
  value: string;
}

export interface VerifiedDesktopSession {
  userId: string;
  refreshGrant: DesktopSessionGrant | null;
  unrecordedUse: DesktopSessionGrant | null;
}

interface GrantOwner {
  userId: string | null;
  lastUsedAt: number | null;
}

const grantCache = new SettledLookupCache<GrantOwner>();

function grantKey(grant: DesktopSessionGrant): string {
  return grant.kind === "session"
    ? `session:${grant.sessionId}`
    : `${grant.kind}:${grant.credentialHash}`;
}

export async function recordDesktopSessionUse(
  grant: DesktopSessionGrant,
  db: ConnectDb,
  now: number = Date.now(),
): Promise<void> {
  if (grant.kind !== "machine") return;
  await db
    .update(machine)
    .set({ lastSeenAt: new Date(now) })
    .where(
      and(
        eq(machine.credentialHash, grant.credentialHash),
        isNull(machine.revokedAt),
        or(
          isNull(machine.lastSeenAt),
          lt(machine.lastSeenAt, new Date(now - DESKTOP_SESSION_USE_WRITE_MS)),
        ),
      ),
    );
}

export function invalidateDesktopSessionGrant(
  grant: DesktopSessionGrant,
): void {
  grantCache.delete(grantKey(grant));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function stringToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlToString(value: string): string | null {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return new TextDecoder().decode(
      Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)),
    );
  } catch {
    return null;
  }
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function createDesktopSessionCookie(
  account: DesktopSessionAccount,
  secret: string,
  expiresAt: number,
): Promise<string> {
  const payload = stringToBase64Url(
    JSON.stringify({
      expiresAt,
      grant: account.grant,
      userId: account.userId,
    }),
  );
  return `${payload}.${await signPayload(payload, secret)}`;
}

export async function issueDesktopSessionCookie(
  account: DesktopSessionAccount,
  options: { baseDomain: string; name: string; secret: string },
  now: number = Date.now(),
): Promise<DesktopSessionCookie> {
  const expiresAt = now + DESKTOP_SESSION_TTL_MS;
  return {
    domain: `.${options.baseDomain}`,
    expiresAt,
    name: options.name,
    value: await createDesktopSessionCookie(account, options.secret, expiresAt),
  };
}

export function desktopSessionSetCookie(
  cookie: DesktopSessionCookie,
  secure: boolean,
): string {
  return [
    `${cookie.name}=${cookie.value}`,
    `Domain=${cookie.domain}`,
    "Path=/",
    `Expires=${new Date(cookie.expiresAt).toUTCString()}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function parseGrant(value: unknown): DesktopSessionGrant | null {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return null;
  }
  if (
    (value.kind === "machine" || value.kind === "server") &&
    "credentialHash" in value &&
    typeof value.credentialHash === "string"
  ) {
    return { kind: value.kind, credentialHash: value.credentialHash };
  }
  if (
    value.kind === "session" &&
    "sessionId" in value &&
    typeof value.sessionId === "string"
  ) {
    return { kind: "session", sessionId: value.sessionId };
  }
  return null;
}

interface DesktopSessionPayload {
  userId: string;
  expiresAt: number;
  grant: DesktopSessionGrant | null;
}

function parsePayload(decoded: string): DesktopSessionPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("userId" in value) ||
    typeof value.userId !== "string" ||
    !("expiresAt" in value) ||
    typeof value.expiresAt !== "number"
  ) {
    return null;
  }
  if (!("grant" in value)) {
    return { userId: value.userId, expiresAt: value.expiresAt, grant: null };
  }
  const grant = parseGrant(value.grant);
  return grant === null
    ? null
    : { userId: value.userId, expiresAt: value.expiresAt, grant };
}

async function lookupGrantOwner(
  grant: DesktopSessionGrant,
  db: ConnectDb,
  now: number,
): Promise<GrantOwner> {
  switch (grant.kind) {
    case "machine": {
      const row = await first(
        db
          .select({ userId: machine.userId, lastSeenAt: machine.lastSeenAt })
          .from(machine)
          .where(
            and(
              eq(machine.credentialHash, grant.credentialHash),
              isNull(machine.revokedAt),
            ),
          )
          .limit(1),
      );
      return {
        userId: row?.userId ?? null,
        lastUsedAt: row?.lastSeenAt?.getTime() ?? null,
      };
    }
    case "server": {
      const row = await first(
        db
          .select({ userId: server.userId })
          .from(server)
          .where(
            and(
              eq(server.credentialHash, grant.credentialHash),
              isNull(server.revokedAt),
            ),
          )
          .limit(1),
      );
      return { userId: row?.userId ?? null, lastUsedAt: null };
    }
    case "session": {
      const row = await first(
        db
          .select({ userId: session.userId })
          .from(session)
          .where(
            and(
              eq(session.id, grant.sessionId),
              gt(session.expiresAt, new Date(now)),
            ),
          )
          .limit(1),
      );
      return { userId: row?.userId ?? null, lastUsedAt: null };
    }
  }
}

function resolveGrantOwner(
  grant: DesktopSessionGrant,
  db: ConnectDb,
  now: number,
): Promise<GrantOwner> {
  return grantCache.read(grantKey(grant), {
    now,
    expires: (owner) =>
      now + (owner.userId === null ? GRANT_MISS_TTL_MS : GRANT_TTL_MS),
    load: () => lookupGrantOwner(grant, db, now),
  });
}

function claimUnrecordedUse(
  grant: DesktopSessionGrant,
  owner: GrantOwner,
  now: number,
): DesktopSessionGrant | null {
  if (grant.kind !== "machine") return null;
  if (
    owner.lastUsedAt !== null &&
    now - owner.lastUsedAt < DESKTOP_SESSION_USE_WRITE_MS
  ) {
    return null;
  }
  owner.lastUsedAt = now;
  return grant;
}

export async function verifyDesktopSessionCookie(
  cookieValue: string,
  secret: string,
  db: ConnectDb,
  now: number = Date.now(),
): Promise<VerifiedDesktopSession | null> {
  const dot = cookieValue.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = cookieValue.slice(0, dot);
  const signature = cookieValue.slice(dot + 1);
  const expected = await signPayload(payload, secret);
  if (signature.length !== expected.length) return null;
  let mismatch = 0;
  for (let index = 0; index < signature.length; index += 1) {
    mismatch |= signature.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  if (mismatch !== 0) return null;

  const decoded = base64UrlToString(payload);
  if (decoded === null) return null;
  const parsed = parsePayload(decoded);
  if (parsed === null || parsed.expiresAt <= now) return null;

  if (parsed.grant === null) {
    return parsed.expiresAt <= now + LEGACY_DESKTOP_SESSION_TTL_MS
      ? { userId: parsed.userId, refreshGrant: null, unrecordedUse: null }
      : null;
  }

  const owner = await resolveGrantOwner(parsed.grant, db, now);
  if (owner.userId !== parsed.userId) return null;
  return {
    userId: parsed.userId,
    refreshGrant:
      parsed.expiresAt <= now + DESKTOP_SESSION_REFRESH_BEFORE_EXPIRY_MS
        ? parsed.grant
        : null,
    unrecordedUse: claimUnrecordedUse(parsed.grant, owner, now),
  };
}
