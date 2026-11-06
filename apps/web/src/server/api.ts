import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import {
  CONNECT_CODE_TTL_MS,
  MACHINE_UNUSED_AFTER_MS,
  MAX_PER_ACCOUNT,
  SERVER_OFFLINE_AFTER_MS,
  auditLog,
  checkLabelAvailability,
  connectCode,
  isLive,
  labelClaim,
  machine,
  machineRoutingKey,
  nextTunnelConnected,
  profile,
  resolveServerCredential,
  rowsChanged,
  server,
  sha256Hex,
  user,
  first,
} from "@bb/connect-db";
import type {
  ConnectDb,
  LabelAvailability,
  MachineKind,
  TunnelConnectedLookup,
} from "@bb/connect-db";
import { generateConnectCode, generateToken } from "./tokens.js";

export interface Deps {
  db: ConnectDb;
  appUrl: string;
  serverUrlTemplate: string;
  closeTunnel: (routingKey: string) => Promise<void>;
  tunnelConnected: TunnelConnectedLookup | null;
}

export function resolveServerUrlTemplate(
  value: string | undefined,
  baseDomain: string,
): string {
  const template = value?.trim() || `https://{label}.${baseDomain}`;
  if (template.split("{label}").length !== 2) {
    throw new Error("CONNECT_SERVER_URL_TEMPLATE must contain {label} once");
  }
  const probe = "bb-label-probe";
  const url = new URL(template.replace("{label}", probe));
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.hostname !== `${probe}.${baseDomain}`
  ) {
    throw new Error(
      "CONNECT_SERVER_URL_TEMPLATE must be an HTTP(S) origin under BASE_DOMAIN",
    );
  }
  return `${url.protocol}//{label}.${baseDomain}${url.port ? `:${url.port}` : ""}`;
}

export function serverUrlForLabel(label: string, template: string): string {
  return template.replace("{label}", label);
}

export function tunnelUrlForServerUrl(serverUrl: string): string {
  return `${serverUrl.replace(/^http/u, "ws")}/__tunnel`;
}

type ProfileRow = typeof profile.$inferSelect;

export async function findProfile(
  db: ConnectDb,
  userId: string,
): Promise<ProfileRow | undefined> {
  return first(
    db.select().from(profile).where(eq(profile.userId, userId)).limit(1),
  );
}

async function findServerByCredential(
  db: ConnectDb,
  credential: string,
): Promise<{ id: string; userId: string } | undefined> {
  const resolved = await resolveServerCredential(db, credential);
  return resolved
    ? { id: resolved.server.id, userId: resolved.userId }
    : undefined;
}

async function insertConnectCode(
  db: ConnectDb,
  {
    userId,
    serverId,
    purpose,
  }: {
    userId: string;
    serverId: string;
    purpose: "server-pair" | "machine-pair";
  },
): Promise<string> {
  const code = generateConnectCode();
  const now = new Date();
  await db.insert(connectCode).values({
    code,
    userId,
    serverId,
    purpose,
    expiresAt: new Date(now.getTime() + CONNECT_CODE_TTL_MS),
    createdAt: now,
  });
  return code;
}

async function hasMachineCapacity(
  db: ConnectDb,
  userId: string,
): Promise<boolean> {
  const active = await db
    .select({ id: machine.id })
    .from(machine)
    .where(and(eq(machine.userId, userId), isNull(machine.revokedAt)));
  return active.length < MAX_PER_ACCOUNT;
}

async function consumeConnectCode(
  db: ConnectDb,
  code: string,
): Promise<boolean> {
  const consumed = await db
    .update(connectCode)
    .set({ consumedAt: new Date() })
    .where(and(eq(connectCode.code, code), isNull(connectCode.consumedAt)));
  return rowsChanged(consumed) > 0;
}

type ConnectApiResult =
  | Awaited<ReturnType<typeof redeemConnectCode>>
  | Awaited<ReturnType<typeof redeemMachineCode>>
  | Awaited<ReturnType<typeof createMachineCodeForServerCredential>>
  | Awaited<ReturnType<typeof revokeMachineForServerCredential>>;

export function connectApiResponse(result: ConnectApiResult): Response {
  return "status" in result
    ? Response.json({ error: result.error }, { status: result.status })
    : Response.json(result);
}

export interface ServerSummary {
  id: string;
  subdomain: string;
  name: string;
  isPrimary: boolean;
  connected: boolean;
  online: boolean;
  lastSeenAt: number | null;
  version: string | null;
  createdAt: number;
  serverUrl: string;
}

export interface AccountState {
  handle: string | null;
  servers: ServerSummary[];
  appUrl: string;
  serverUrlTemplate: string;
  githubLogin: string | null;
  maxServers: number;
  machines: MachineSummary[];
}

export interface MachineSummary {
  id: string;
  name: string | null;
  kind: MachineKind | null;
  subdomain: string | null;
  online: boolean;
  lastSeenAt: number | null;
  unused: boolean;
  createdAt: number;
}

type ServerRow = typeof server.$inferSelect;

export function toServerSummary(
  srv: ServerRow,
  handle: string,
  serverUrlTemplate: string,
  now: number,
  tunnelConnected: boolean | null,
): ServerSummary {
  const lastSeenMs = srv.lastSeenAt?.getTime() ?? null;
  const connected = srv.credentialHash != null && srv.revokedAt == null;
  return {
    id: srv.id,
    subdomain: srv.subdomain,
    name: srv.name,
    isPrimary: srv.subdomain === handle,
    connected,
    online:
      connected &&
      (nextTunnelConnected(srv, now) ||
        isLive({
          lastSeenMs,
          now,
          offlineAfterMs: SERVER_OFFLINE_AFTER_MS,
          tunnelConnected,
        })),
    lastSeenAt: lastSeenMs,
    version: srv.version,
    createdAt: srv.createdAt.getTime(),
    serverUrl: serverUrlForLabel(srv.subdomain, serverUrlTemplate),
  };
}

export async function listServerSummaries(
  deps: Pick<Deps, "serverUrlTemplate" | "tunnelConnected">,
  rows: readonly ServerRow[],
  handle: string,
  now: number,
): Promise<ServerSummary[]> {
  const lookup = deps.tunnelConnected;
  const summaries = await Promise.all(
    rows.map(async (srv) =>
      toServerSummary(
        srv,
        handle,
        deps.serverUrlTemplate,
        now,
        lookup !== null && srv.credentialHash != null && srv.revokedAt == null
          ? await lookup(srv.subdomain)
          : null,
      ),
    ),
  );
  return summaries.sort((a, b) =>
    a.isPrimary !== b.isPrimary
      ? a.isPrimary
        ? -1
        : 1
      : a.createdAt - b.createdAt,
  );
}

async function resolveServer(
  db: ConnectDb,
  userId: string,
  serverId: string | undefined,
): Promise<ServerRow | undefined> {
  if (serverId) {
    return first(
      db
        .select()
        .from(server)
        .where(and(eq(server.id, serverId), eq(server.userId, userId)))
        .limit(1),
    );
  }
  const prof = await findProfile(db, userId);
  if (!prof) return undefined;
  const primary = await first(
    db
      .select()
      .from(server)
      .where(and(eq(server.userId, userId), eq(server.subdomain, prof.handle)))
      .limit(1),
  );
  if (primary) return primary;
  const all = await db.select().from(server).where(eq(server.userId, userId));
  return [...all].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )[0];
}

export async function getAccountState(
  deps: Deps,
  userId: string,
): Promise<AccountState> {
  const { db, serverUrlTemplate } = deps;
  await retryPendingMachineRevocations(deps, userId);
  const prof = await findProfile(db, userId);
  const userRow = await first(
    db
      .select({ githubLogin: user.githubLogin })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1),
  );

  const now = Date.now();
  const base = {
    appUrl: deps.appUrl,
    serverUrlTemplate,
    githubLogin: userRow?.githubLogin ?? null,
    maxServers: MAX_PER_ACCOUNT,
  };

  const machines = await listMachineSummaries(deps, userId, now);
  const abandoned = machines.filter(isAbandonedPairing);
  for (const row of abandoned) {
    await revokeMachine(deps, userId, row.id);
  }
  const activeMachines = machines.filter((row) => !isAbandonedPairing(row));

  if (!prof) {
    return { handle: null, machines: activeMachines, servers: [], ...base };
  }

  const serverRows = await db
    .select()
    .from(server)
    .where(eq(server.userId, userId));

  const servers = await listServerSummaries(deps, serverRows, prof.handle, now);

  return { handle: prof.handle, machines: activeMachines, servers, ...base };
}

function isAbandonedPairing(row: MachineSummary): boolean {
  return row.kind !== null && row.lastSeenAt === null && row.unused;
}

async function listMachineSummaries(
  deps: Pick<Deps, "db" | "tunnelConnected">,
  userId: string,
  now: number,
): Promise<MachineSummary[]> {
  const machineRows = await deps.db
    .select({
      id: machine.id,
      name: machine.name,
      kind: machine.kind,
      subdomain: machine.subdomain,
      lastSeenAt: machine.lastSeenAt,
      nextTunnelGate: machine.nextTunnelGate,
      nextTunnelAt: machine.nextTunnelAt,
      createdAt: machine.createdAt,
    })
    .from(machine)
    .where(and(eq(machine.userId, userId), isNull(machine.revokedAt)));
  const machineTunnels = await machineTunnelsConnected(deps, userId);
  return machineRows
    .map((row) => {
      const lastSeenMs = row.lastSeenAt?.getTime() ?? null;
      const createdMs = row.createdAt.getTime();
      const online =
        machineTunnels.get(row.id) === true ||
        nextTunnelConnected(row, now) ||
        isLive({
          lastSeenMs,
          now,
          offlineAfterMs: SERVER_OFFLINE_AFTER_MS,
          tunnelConnected: null,
        });
      return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        subdomain: row.subdomain,
        online,
        lastSeenAt: lastSeenMs,
        unused:
          !online && now - (lastSeenMs ?? createdMs) > MACHINE_UNUSED_AFTER_MS,
        createdAt: createdMs,
      };
    })
    .sort((left, right) => left.createdAt - right.createdAt);
}

export async function revokeUnusedDevices(
  deps: Pick<Deps, "db" | "closeTunnel" | "tunnelConnected">,
  userId: string,
): Promise<{ ok: true; revoked: number }> {
  const unused = (await listMachineSummaries(deps, userId, Date.now())).filter(
    (row) => row.unused,
  );
  for (const row of unused) {
    await revokeMachine(deps, userId, row.id);
  }
  return { ok: true, revoked: unused.length };
}

export async function deleteAccount(
  deps: Pick<Deps, "db" | "closeTunnel">,
  userId: string,
  confirmHandle: string,
): Promise<{ ok: true } | { error: "no-handle" | "handle-mismatch" }> {
  const { db } = deps;
  const prof = await findProfile(db, userId);
  if (!prof) return { error: "no-handle" };
  if (prof.handle !== confirmHandle.trim().toLowerCase()) {
    return { error: "handle-mismatch" };
  }

  const servers = await db
    .select({ subdomain: server.subdomain })
    .from(server)
    .where(eq(server.userId, userId));
  const machineClaims = await db
    .select({ label: labelClaim.label, generation: labelClaim.generation })
    .from(labelClaim)
    .where(and(eq(labelClaim.userId, userId), eq(labelClaim.kind, "machine")));

  await db.insert(auditLog).values({
    id: crypto.randomUUID(),
    userId,
    action: ACCOUNT_DELETE_AUDIT_ACTION,
    detail: JSON.stringify({
      handle: prof.handle,
      servers: servers.length,
    }),
    createdAt: new Date(),
  });
  await db.delete(user).where(eq(user.id, userId));

  await Promise.allSettled([
    ...servers.map((row) => deps.closeTunnel(row.subdomain)),
    ...machineClaims.map((claim) =>
      deps.closeTunnel(machineRoutingKey(claim.label, claim.generation)),
    ),
  ]);
  return { ok: true };
}

export const ACCOUNT_DELETE_AUDIT_ACTION = "account.delete";

async function machineTunnelsConnected(
  deps: Pick<Deps, "db" | "tunnelConnected">,
  userId: string,
): Promise<Map<string, boolean | null>> {
  const lookup = deps.tunnelConnected;
  if (lookup === null) return new Map();
  const claims = await deps.db
    .select({
      machineId: labelClaim.ownerId,
      label: labelClaim.label,
      generation: labelClaim.generation,
    })
    .from(labelClaim)
    .where(and(eq(labelClaim.userId, userId), eq(labelClaim.kind, "machine")));
  return new Map(
    await Promise.all(
      claims.map(
        async (claim) =>
          [
            claim.machineId,
            await lookup(machineRoutingKey(claim.label, claim.generation)),
          ] as const,
      ),
    ),
  );
}

export async function revokeMachine(
  deps: Pick<Deps, "db" | "closeTunnel">,
  userId: string,
  machineId: string,
): Promise<{ ok: true } | { error: "not-found" | "tunnel-close-failed" }> {
  const existing = await first(
    deps.db
      .select({ id: machine.id, revokedAt: machine.revokedAt })
      .from(machine)
      .where(and(eq(machine.id, machineId), eq(machine.userId, userId)))
      .limit(1),
  );
  if (!existing) return { error: "not-found" };

  await deps.db
    .update(machine)
    .set({ revokedAt: existing.revokedAt ?? new Date() })
    .where(
      and(
        eq(machine.id, machineId),
        eq(machine.userId, userId),
        isNull(machine.revokedAt),
      ),
    );

  const claim = await first(
    deps.db
      .select()
      .from(labelClaim)
      .where(
        and(eq(labelClaim.kind, "machine"), eq(labelClaim.ownerId, machineId)),
      )
      .limit(1),
  );

  if (claim) {
    try {
      await deps.closeTunnel(machineRoutingKey(claim.label, claim.generation));
    } catch {
      return { error: "tunnel-close-failed" };
    }
  }

  await deps.db
    .update(machine)
    .set({ subdomain: null })
    .where(and(eq(machine.id, machineId), eq(machine.userId, userId)));
  return { ok: true };
}

async function retryPendingMachineRevocations(
  deps: Pick<Deps, "db" | "closeTunnel">,
  userId: string,
): Promise<void> {
  const pending = await deps.db
    .select({ id: machine.id })
    .from(machine)
    .where(
      and(
        eq(machine.userId, userId),
        isNotNull(machine.revokedAt),
        isNotNull(machine.subdomain),
      ),
    );
  for (const row of pending) {
    await revokeMachine(deps, userId, row.id);
  }
}

export async function checkAvailability(
  deps: Deps,
  rawLabel: string,
): Promise<LabelAvailability> {
  return checkLabelAvailability(deps.db, rawLabel);
}

type ClaimError =
  | "already-claimed"
  | "taken"
  | "too-short"
  | "too-long"
  | "invalid-format"
  | "reserved";

export async function claimHandle(
  deps: Deps,
  userId: string,
  rawHandle: string,
): Promise<{ ok: true; handle: string } | { error: ClaimError }> {
  const { db } = deps;
  const existing = await findProfile(db, userId);
  if (existing) return { error: "already-claimed" };

  const avail = await checkLabelAvailability(db, rawHandle);
  if (!avail.available) {
    return { error: avail.reason === "invalid" ? avail.error : "taken" };
  }
  const handle = avail.label;

  const now = new Date();
  try {
    await db.insert(profile).values({ userId, handle, createdAt: now });
  } catch {
    return { error: "taken" };
  }
  try {
    await db.insert(server).values({
      id: crypto.randomUUID(),
      userId,
      name: "default",
      subdomain: handle,
      createdAt: now,
    });
  } catch {
    await db
      .delete(profile)
      .where(and(eq(profile.userId, userId), eq(profile.handle, handle)));
    return { error: "taken" };
  }
  return { ok: true, handle };
}

export type CreateServerError =
  | "no-handle"
  | "server-limit"
  | "taken"
  | ClaimError;

export async function createServer(
  deps: Deps,
  userId: string,
  rawLabel: string,
): Promise<{ ok: true; server: ServerSummary } | { error: CreateServerError }> {
  const { db, serverUrlTemplate } = deps;
  const prof = await findProfile(db, userId);
  if (!prof) return { error: "no-handle" };

  const owned = await db.select().from(server).where(eq(server.userId, userId));
  if (owned.length >= MAX_PER_ACCOUNT) return { error: "server-limit" };

  const avail = await checkLabelAvailability(db, rawLabel);
  if (!avail.available) {
    return { error: avail.reason === "invalid" ? avail.error : "taken" };
  }
  const label = avail.label;

  const now = new Date();
  const id = crypto.randomUUID();
  try {
    await db
      .insert(server)
      .values({ id, userId, name: label, subdomain: label, createdAt: now });
  } catch {
    return { error: "taken" };
  }
  const afterCount = await db
    .select()
    .from(server)
    .where(eq(server.userId, userId));
  if (afterCount.length > MAX_PER_ACCOUNT) {
    await db.delete(server).where(eq(server.id, id));
    return { error: "server-limit" };
  }
  const created = await first(
    db.select().from(server).where(eq(server.id, id)).limit(1),
  );
  if (!created) {
    return { error: "taken" };
  }
  return {
    ok: true,
    server: toServerSummary(
      created,
      prof.handle,
      serverUrlTemplate,
      Date.now(),
      null,
    ),
  };
}

export interface IssuedCode {
  code: string;
  expiresInMs: number;
  serverUrl: string;
  serverId: string;
}

export async function createConnectCode(
  deps: Deps,
  userId: string,
  opts: { serverId?: string; reuse?: boolean } = {},
): Promise<IssuedCode | { error: string }> {
  const { db, serverUrlTemplate } = deps;
  const srv = await resolveServer(db, userId, opts.serverId);
  if (!srv) return { error: "no-server" };
  const serverUrl = serverUrlForLabel(srv.subdomain, serverUrlTemplate);
  const now = Date.now();

  if (opts.reuse) {
    const open = await db
      .select()
      .from(connectCode)
      .where(
        and(
          eq(connectCode.serverId, srv.id),
          eq(connectCode.purpose, "server-pair"),
          isNull(connectCode.consumedAt),
        ),
      );
    const valid = open
      .filter((c) => c.expiresAt.getTime() > now)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (valid) {
      return {
        code: valid.code,
        expiresInMs: valid.expiresAt.getTime() - now,
        serverUrl,
        serverId: srv.id,
      };
    }
  }

  const code = await insertConnectCode(db, {
    userId,
    serverId: srv.id,
    purpose: "server-pair",
  });
  return {
    code,
    expiresInMs: CONNECT_CODE_TTL_MS,
    serverUrl,
    serverId: srv.id,
  };
}

async function createMachineCode(
  deps: Deps,
  userId: string,
  serverId?: string,
): Promise<
  { code: string; expiresInMs: number; serverUrl: string } | { error: string }
> {
  const { db, serverUrlTemplate } = deps;
  const prof = await findProfile(db, userId);
  if (!prof) return { error: "no-handle" };

  const srv = await resolveServer(db, userId, serverId);
  if (!srv) return { error: "no-server" };

  if (!(await hasMachineCapacity(db, userId))) {
    return { error: "machine-limit" };
  }

  const code = await insertConnectCode(db, {
    userId,
    serverId: srv.id,
    purpose: "machine-pair",
  });
  return {
    code,
    expiresInMs: CONNECT_CODE_TTL_MS,
    serverUrl: serverUrlForLabel(srv.subdomain, serverUrlTemplate),
  };
}

export async function createMachineCodeForServerCredential(
  deps: Deps,
  credential: string,
): Promise<
  | { code: string; expiresInMs: number; serverUrl: string }
  | { error: string; status: number }
> {
  const srv = await findServerByCredential(deps.db, credential);
  if (!srv) return { error: "unauthorized", status: 401 };
  const result = await createMachineCode(deps, srv.userId, srv.id);
  if ("error" in result) {
    return {
      error: result.error,
      status: result.error === "machine-limit" ? 409 : 404,
    };
  }
  return result;
}

export async function revokeMachineForServerCredential(
  deps: Pick<Deps, "db" | "closeTunnel">,
  credential: string,
  machineId: string,
): Promise<{ ok: true } | { error: string; status: number }> {
  const srv = await findServerByCredential(deps.db, credential);
  if (!srv) return { error: "unauthorized", status: 401 };
  const result = await revokeMachine(deps, srv.userId, machineId);
  return "error" in result
    ? {
        error: result.error,
        status: result.error === "tunnel-close-failed" ? 503 : 404,
      }
    : result;
}

export async function denyOutstandingLinkApprovals(
  db: ConnectDb,
  serverId: string,
  now: Date,
  exceptCode: string | null,
): Promise<void> {
  await db
    .update(connectCode)
    .set({ deniedAt: now })
    .where(
      and(
        eq(connectCode.purpose, "server-link"),
        eq(connectCode.serverId, serverId),
        isNotNull(connectCode.approvedAt),
        isNull(connectCode.consumedAt),
        isNull(connectCode.deniedAt),
        ...(exceptCode === null ? [] : [ne(connectCode.code, exceptCode)]),
      ),
    );
}

export async function disconnectServer(
  deps: Deps,
  userId: string,
  serverId: string,
): Promise<{ ok: true } | { error: string }> {
  const { db } = deps;
  const srv = await first(
    db
      .select()
      .from(server)
      .where(and(eq(server.id, serverId), eq(server.userId, userId)))
      .limit(1),
  );
  if (!srv) return { error: "not-found" };

  const now = new Date();
  await db
    .update(server)
    .set({ credentialHash: null, revokedAt: now })
    .where(eq(server.id, srv.id));
  await denyOutstandingLinkApprovals(db, srv.id, now, null);
  try {
    await deps.closeTunnel(srv.subdomain);
  } catch {}
  return { ok: true };
}

export async function removeServer(
  deps: Deps,
  userId: string,
  serverId: string,
): Promise<{ ok: true } | { error: string }> {
  const { db } = deps;
  const prof = await findProfile(db, userId);
  const srv = await first(
    db
      .select()
      .from(server)
      .where(and(eq(server.id, serverId), eq(server.userId, userId)))
      .limit(1),
  );
  if (!srv) return { error: "not-found" };
  if (prof && srv.subdomain === prof.handle) return { error: "is-primary" };
  if (srv.credentialHash != null && srv.revokedAt == null) {
    return { error: "connected" };
  }

  await db.delete(server).where(eq(server.id, srv.id));
  return { ok: true };
}

export async function redeemConnectCode(
  deps: Pick<Deps, "db" | "serverUrlTemplate">,
  code: string,
): Promise<
  | {
      credential: string;
      serverId: string;
      handle: string | null;
      tunnelUrl: string | null;
    }
  | { error: string; status: number }
> {
  const { db, serverUrlTemplate } = deps;
  const normalized = code.trim().toUpperCase();
  if (!normalized) return { error: "missing-code", status: 400 };

  const row = await first(
    db
      .select()
      .from(connectCode)
      .where(eq(connectCode.code, normalized))
      .limit(1),
  );
  if (!row || row.serverId == null || row.purpose !== "server-pair")
    return { error: "invalid-code", status: 404 };
  if (row.consumedAt != null) return { error: "already-used", status: 409 };
  if (row.expiresAt.getTime() < Date.now())
    return { error: "expired", status: 410 };

  if (!(await consumeConnectCode(db, normalized)))
    return { error: "already-used", status: 409 };

  const minted = await mintServerCredential(db, row.serverId);
  const handle = minted.server?.subdomain ?? null;
  const serverUrl = handle
    ? serverUrlForLabel(handle, serverUrlTemplate)
    : null;
  return {
    credential: minted.credential,
    serverId: row.serverId,
    handle,
    tunnelUrl: serverUrl ? tunnelUrlForServerUrl(serverUrl) : null,
  };
}

async function mintServerCredential(
  db: ConnectDb,
  serverId: string,
): Promise<{ credential: string; server: ServerRow | undefined }> {
  const credential = generateToken("bbcred_");
  await db
    .update(server)
    .set({ credentialHash: await sha256Hex(credential), revokedAt: null })
    .where(eq(server.id, serverId));
  await denyOutstandingLinkApprovals(db, serverId, new Date(), null);
  const minted = await first(
    db.select().from(server).where(eq(server.id, serverId)).limit(1),
  );
  return { credential, server: minted };
}

async function machineIdForCode(userId: string, code: string): Promise<string> {
  const hash = await sha256Hex(JSON.stringify([userId, code]));
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

export async function lookupMachineCodeForServerCredential(
  deps: Pick<Deps, "db">,
  credential: string,
  code: string,
): Promise<
  | { consumed: boolean; machineId: string | null }
  | { error: string; status: number }
> {
  const srv = await findServerByCredential(deps.db, credential);
  if (!srv) return { error: "unauthorized", status: 401 };
  const row = await first(
    deps.db
      .select()
      .from(connectCode)
      .where(
        and(
          eq(connectCode.code, code.trim().toUpperCase()),
          eq(connectCode.serverId, srv.id),
          eq(connectCode.userId, srv.userId),
          eq(connectCode.purpose, "machine-pair"),
        ),
      )
      .limit(1),
  );
  if (!row || row.userId === null)
    return { error: "invalid-code", status: 404 };
  const device = await first(
    deps.db
      .select({ id: machine.id })
      .from(machine)
      .where(
        and(
          eq(machine.id, await machineIdForCode(row.userId, row.code)),
          eq(machine.userId, srv.userId),
        ),
      )
      .limit(1),
  );
  return { consumed: row.consumedAt !== null, machineId: device?.id ?? null };
}

export async function redeemMachineCode(
  deps: Pick<Deps, "db" | "serverUrlTemplate">,
  code: string,
  device: { name: string | null; kind: MachineKind | null },
): Promise<
  | {
      credential: string;
      machineId: string;
      handle: string | null;
      serverUrl: string | null;
    }
  | { error: string; status: number }
> {
  const { db, serverUrlTemplate } = deps;
  const normalized = code.trim().toUpperCase();
  if (!normalized) return { error: "missing-code", status: 400 };

  const row = await first(
    db
      .select()
      .from(connectCode)
      .where(eq(connectCode.code, normalized))
      .limit(1),
  );
  if (!row || row.purpose !== "machine-pair" || row.userId === null)
    return { error: "invalid-code", status: 404 };
  const ownerId = row.userId;
  if (row.consumedAt != null) return { error: "already-used", status: 409 };
  if (row.expiresAt.getTime() < Date.now())
    return { error: "expired", status: 410 };

  if (!(await hasMachineCapacity(db, ownerId))) {
    return { error: "machine-limit", status: 409 };
  }

  if (!(await consumeConnectCode(db, normalized)))
    return { error: "already-used", status: 409 };

  const credential = generateToken("bbcm_");
  const machineId = await machineIdForCode(ownerId, normalized);
  await db.insert(machine).values({
    id: machineId,
    name: device.name,
    kind: device.kind,
    userId: ownerId,
    credentialHash: await sha256Hex(credential),
    createdAt: new Date(),
  });

  const prof = await findProfile(db, ownerId);
  const targetServer =
    row.serverId == null
      ? null
      : await first(
          db.select().from(server).where(eq(server.id, row.serverId)).limit(1),
        );
  const label = targetServer?.subdomain ?? prof?.handle ?? null;
  return {
    credential,
    machineId,
    handle: prof?.handle ?? null,
    serverUrl: label ? serverUrlForLabel(label, serverUrlTemplate) : null,
  };
}
