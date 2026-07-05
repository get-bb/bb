import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  CONNECT_CODE_TTL_MS,
  MAX_MACHINES_PER_SERVER,
  SERVER_OFFLINE_AFTER_MS,
  connectCode,
  machine,
  profile,
  server,
  validateHandle,
} from "@bb/connect-db";
import type { Env } from "./env.js";
import { generateConnectCode, generateToken, sha256Hex } from "./tokens.js";

export interface AccountState {
  handle: string | null;
  server: {
    connected: boolean;
    online: boolean;
    lastSeenAt: number | null;
    version: string | null;
  } | null;
  appUrl: string;
  baseDomain: string;
  serverUrl: string | null;
}

/** Product-state read for the dashboard. */
export async function getAccountState(env: Env, userId: string): Promise<AccountState> {
  const db = drizzle(env.DB);
  const prof = await db.select().from(profile).where(eq(profile.userId, userId)).get();
  const srv = prof
    ? await db.select().from(server).where(eq(server.userId, userId)).get()
    : undefined;
  const online =
    srv?.lastSeenAt != null && Date.now() - srv.lastSeenAt.getTime() < SERVER_OFFLINE_AFTER_MS;
  return {
    handle: prof?.handle ?? null,
    server: srv
      ? {
          connected: srv.credentialHash != null && srv.revokedAt == null,
          online,
          lastSeenAt: srv.lastSeenAt?.getTime() ?? null,
          version: srv.version,
        }
      : null,
    appUrl: env.APP_URL,
    baseDomain: env.BASE_DOMAIN,
    serverUrl: prof ? `https://${prof.handle}.${env.BASE_DOMAIN}` : null,
  };
}

/** Claim a handle + create the default server row. */
export async function claimHandle(
  env: Env,
  userId: string,
  rawHandle: string,
): Promise<{ ok: true; handle: string } | { error: string }> {
  const db = drizzle(env.DB);
  const existing = await db.select().from(profile).where(eq(profile.userId, userId)).get();
  if (existing) return { error: "already-claimed" };

  const handle = rawHandle.trim().toLowerCase();
  const invalid = validateHandle(handle);
  if (invalid) return { error: invalid };

  const taken = await db.select().from(profile).where(eq(profile.handle, handle)).get();
  if (taken) return { error: "taken" };

  const now = new Date();
  try {
    await db.insert(profile).values({ userId, handle, createdAt: now }).run();
  } catch {
    return { error: "taken" };
  }
  await db
    .insert(server)
    .values({ id: crypto.randomUUID(), userId, name: "default", createdAt: now })
    .run();
  return { ok: true, handle };
}

/** Mint a one-time server-pair code. */
export async function createConnectCode(
  env: Env,
  userId: string,
): Promise<{ code: string; expiresInMs: number; serverUrl: string } | { error: string }> {
  const db = drizzle(env.DB);
  const prof = await db.select().from(profile).where(eq(profile.userId, userId)).get();
  if (!prof) return { error: "no-handle" };
  const srv = await db.select().from(server).where(eq(server.userId, userId)).get();
  if (!srv) return { error: "no-server" };

  const code = generateConnectCode();
  const now = new Date();
  await db
    .insert(connectCode)
    .values({
      code,
      userId,
      serverId: srv.id,
      purpose: "server-pair",
      expiresAt: new Date(now.getTime() + CONNECT_CODE_TTL_MS),
      createdAt: now,
    })
    .run();
  return {
    code,
    expiresInMs: CONNECT_CODE_TTL_MS,
    serverUrl: `https://${prof.handle}.${env.BASE_DOMAIN}`,
  };
}

/**
 * Redeem a connect code (called by the tunnel client — the code is the
 * credential). Atomically consumes the code, mints a durable tunnel credential,
 * pins it (hashed) on the server row, returns plaintext once.
 */
export async function redeemConnectCode(
  env: Env,
  code: string,
): Promise<
  | { credential: string; serverId: string; handle: string | null; tunnelUrl: string | null }
  | { error: string; status: number }
> {
  const db = drizzle(env.DB);
  const normalized = code.trim().toUpperCase();
  if (!normalized) return { error: "missing-code", status: 400 };

  const row = await db.select().from(connectCode).where(eq(connectCode.code, normalized)).get();
  if (!row || row.serverId == null) return { error: "invalid-code", status: 404 };
  if (row.consumedAt != null) return { error: "already-used", status: 409 };
  if (row.expiresAt.getTime() < Date.now()) return { error: "expired", status: 410 };

  const consumed = await db
    .update(connectCode)
    .set({ consumedAt: new Date() })
    .where(and(eq(connectCode.code, normalized), isNull(connectCode.consumedAt)))
    .run();
  if (consumed.meta.changes === 0) return { error: "already-used", status: 409 };

  const credential = generateToken("bbcred_", 32);
  await db
    .update(server)
    .set({ credentialHash: await sha256Hex(credential), revokedAt: null })
    .where(eq(server.id, row.serverId))
    .run();

  const prof = await db.select().from(profile).where(eq(profile.userId, row.userId)).get();
  return {
    credential,
    serverId: row.serverId,
    handle: prof?.handle ?? null,
    tunnelUrl: prof ? `wss://${prof.handle}.${env.BASE_DOMAIN}/__tunnel` : null,
  };
}

/** Mint a one-time machine-pair code (dashboard "Add a machine"). */
export async function createMachineCode(
  env: Env,
  userId: string,
): Promise<{ code: string; expiresInMs: number; serverUrl: string } | { error: string }> {
  const db = drizzle(env.DB);
  const prof = await db.select().from(profile).where(eq(profile.userId, userId)).get();
  if (!prof) return { error: "no-handle" };

  const active = await db.select().from(machine).where(eq(machine.userId, userId)).all();
  if (active.filter((m) => m.revokedAt == null).length >= MAX_MACHINES_PER_SERVER) {
    return { error: "machine-limit" };
  }

  const code = generateConnectCode();
  const now = new Date();
  await db
    .insert(connectCode)
    .values({
      code,
      userId,
      serverId: null,
      purpose: "machine-pair",
      expiresAt: new Date(now.getTime() + CONNECT_CODE_TTL_MS),
      createdAt: now,
    })
    .run();
  return {
    code,
    expiresInMs: CONNECT_CODE_TTL_MS,
    serverUrl: `https://${prof.handle}.${env.BASE_DOMAIN}`,
  };
}

/**
 * Redeem a machine-pair code (called by the daemon join). Consumes the code,
 * creates a machine row, returns the durable machine credential once. The
 * daemon presents this on the `x-bb-connect-machine` header so the gate lets its
 * /internal traffic through to the server.
 */
export async function redeemMachineCode(
  env: Env,
  code: string,
): Promise<
  | { credential: string; machineId: string; handle: string | null; serverUrl: string | null }
  | { error: string; status: number }
> {
  const db = drizzle(env.DB);
  const normalized = code.trim().toUpperCase();
  if (!normalized) return { error: "missing-code", status: 400 };

  const row = await db.select().from(connectCode).where(eq(connectCode.code, normalized)).get();
  if (!row || row.purpose !== "machine-pair") return { error: "invalid-code", status: 404 };
  if (row.consumedAt != null) return { error: "already-used", status: 409 };
  if (row.expiresAt.getTime() < Date.now()) return { error: "expired", status: 410 };

  // Re-check the cap here, not just at code creation: createMachineCode's
  // count is a TOCTOU (N codes each minted while under the limit could all
  // redeem past it). Checked before consuming so a rejected redeem leaves the
  // code usable.
  const machines = await db.select().from(machine).where(eq(machine.userId, row.userId)).all();
  if (machines.filter((m) => m.revokedAt == null).length >= MAX_MACHINES_PER_SERVER) {
    return { error: "machine-limit", status: 409 };
  }

  const consumed = await db
    .update(connectCode)
    .set({ consumedAt: new Date() })
    .where(and(eq(connectCode.code, normalized), isNull(connectCode.consumedAt)))
    .run();
  if (consumed.meta.changes === 0) return { error: "already-used", status: 409 };

  const credential = generateToken("bbcm_", 32);
  const machineId = crypto.randomUUID();
  await db
    .insert(machine)
    .values({
      id: machineId,
      userId: row.userId,
      credentialHash: await sha256Hex(credential),
      createdAt: new Date(),
    })
    .run();

  const prof = await db.select().from(profile).where(eq(profile.userId, row.userId)).get();
  return {
    credential,
    machineId,
    handle: prof?.handle ?? null,
    serverUrl: prof ? `https://${prof.handle}.${env.BASE_DOMAIN}` : null,
  };
}

/** Revoke the credential AND sever the live tunnel. */
export async function disconnectServer(env: Env, userId: string): Promise<{ ok: true }> {
  const db = drizzle(env.DB);
  await db
    .update(server)
    .set({ credentialHash: null, revokedAt: new Date() })
    .where(eq(server.userId, userId))
    .run();
  const prof = await db.select().from(profile).where(eq(profile.userId, userId)).get();
  if (prof) {
    try {
      const stub = env.TUNNEL_DO.get(env.TUNNEL_DO.idFromName(prof.handle));
      await stub.fetch("https://tunnel/__control/close");
    } catch {
      // best-effort; the credential is already revoked so reconnect is blocked
    }
  }
  return { ok: true };
}
