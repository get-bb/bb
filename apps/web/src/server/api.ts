import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  CONNECT_CODE_TTL_MS,
  MAX_PER_ACCOUNT,
  SERVER_OFFLINE_AFTER_MS,
  checkLabelAvailability,
  connectCode,
  labelClaim,
  machine,
  machineRoutingKey,
  profile,
  server,
  user,
} from "@bb/connect-db";
import type { ConnectDb, LabelAvailability, LabelClaim } from "@bb/connect-db";
import type { Env } from "./env.js";
import { generateConnectCode, generateToken, sha256Hex } from "./tokens.js";

/**
 * Injected dependencies for the product-state functions. `db` is the shared
 * `ConnectDb` shape (D1 in the worker, in-memory better-sqlite3 in tests, per
 * AGENTS "never mock the database"); `closeTunnel` abstracts the TunnelDO so the
 * DB logic is testable without a Durable Object.
 */
export interface Deps {
  db: ConnectDb;
  appUrl: string;
  serverUrlTemplate: string;
  closeTunnel?: (routingKey: string) => Promise<void>;
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

function serverUrlForLabel(label: string, template: string): string {
  return template.replace("{label}", label);
}

export function depsFromEnv(env: Env): Deps {
  return {
    db: drizzle(env.DB),
    appUrl: env.APP_URL,
    serverUrlTemplate: resolveServerUrlTemplate(
      env.CONNECT_SERVER_URL_TEMPLATE,
      env.BASE_DOMAIN,
    ),
    closeTunnel: async (routingKey) => {
      const stub = env.TUNNEL_DO.get(env.TUNNEL_DO.idFromName(routingKey));
      const response = await stub.fetch("https://tunnel/__control/close");
      if (!response.ok) {
        throw new Error(`tunnel close failed (${response.status})`);
      }
    },
  };
}

async function closeMachineTunnel(
  deps: Pick<Deps, "closeTunnel">,
  claim: LabelClaim,
): Promise<void> {
  const closeTunnel = deps.closeTunnel;
  if (!closeTunnel) throw new Error("tunnel close unavailable");
  await closeTunnel(machineRoutingKey(claim.label, claim.generation));
}

/** One connected bb server, projected for the dashboard. */
export interface ServerSummary {
  id: string;
  /** Routing label — `<subdomain>.<baseDomain>`. */
  subdomain: string;
  name: string;
  /** The account handle names the primary/first server (subdomain === handle). */
  isPrimary: boolean;
  /** Has a live tunnel credential (paired, not revoked). */
  connected: boolean;
  /** Connected AND heartbeated within the offline window. */
  online: boolean;
  lastSeenAt: number | null;
  version: string | null;
  /** Row-creation time; the best "connected since" proxy we persist. */
  createdAt: number;
  serverUrl: string;
}

export interface AccountState {
  handle: string | null;
  /** Primary first, then oldest → newest. Empty until a handle is claimed. */
  servers: ServerSummary[];
  appUrl: string;
  serverUrlTemplate: string;
  /** GitHub login for the account footer link; null for pre-column rows. */
  githubLogin: string | null;
  /** Per-account server ceiling, surfaced in the footer as "N of MAX bbs". */
  maxServers: number;
  machines: MachineSummary[];
}

export interface MachineSummary {
  id: string;
  name: string | null;
  /** Routing label (`<subdomain>.<baseDomain>`); null until first expose. */
  subdomain: string | null;
  /** Heartbeated within the same offline window servers use. */
  online: boolean;
  lastSeenAt: number | null;
  createdAt: number;
}

type ServerRow = typeof server.$inferSelect;

function toServerSummary(
  srv: ServerRow,
  handle: string,
  serverUrlTemplate: string,
  now: number,
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
      lastSeenMs != null &&
      now - lastSeenMs < SERVER_OFFLINE_AFTER_MS,
    lastSeenAt: lastSeenMs,
    version: srv.version,
    createdAt: srv.createdAt.getTime(),
    serverUrl: serverUrlForLabel(srv.subdomain, serverUrlTemplate),
  };
}

/** Resolve the target server for a code/action: an explicit id (owner-scoped) or the primary. */
async function resolveServer(
  db: ConnectDb,
  userId: string,
  serverId: string | undefined,
): Promise<ServerRow | undefined> {
  if (serverId) {
    return db
      .select()
      .from(server)
      .where(and(eq(server.id, serverId), eq(server.userId, userId)))
      .get();
  }
  const prof = await db
    .select()
    .from(profile)
    .where(eq(profile.userId, userId))
    .get();
  if (!prof) return undefined;
  const primary = await db
    .select()
    .from(server)
    .where(and(eq(server.userId, userId), eq(server.subdomain, prof.handle)))
    .get();
  if (primary) return primary;
  const all = await db
    .select()
    .from(server)
    .where(eq(server.userId, userId))
    .all();
  return [...all].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )[0];
}

/** Product-state read for the dashboard: every server the account owns. */
export async function getAccountState(
  deps: Deps,
  userId: string,
): Promise<AccountState> {
  const { db, serverUrlTemplate } = deps;
  await retryPendingMachineRevocations(deps, userId);
  const prof = await db
    .select()
    .from(profile)
    .where(eq(profile.userId, userId))
    .get();
  const userRow = await db
    .select({ githubLogin: user.githubLogin })
    .from(user)
    .where(eq(user.id, userId))
    .get();

  const now = Date.now();
  const base = {
    appUrl: deps.appUrl,
    serverUrlTemplate,
    githubLogin: userRow?.githubLogin ?? null,
    maxServers: MAX_PER_ACCOUNT,
  };

  const machineRows = await db
    .select({
      id: machine.id,
      name: machine.name,
      subdomain: machine.subdomain,
      lastSeenAt: machine.lastSeenAt,
      createdAt: machine.createdAt,
    })
    .from(machine)
    .where(and(eq(machine.userId, userId), isNull(machine.revokedAt)))
    .all();
  const machines = machineRows
    .map((row) => {
      const lastSeenMs = row.lastSeenAt?.getTime() ?? null;
      return {
        id: row.id,
        name: row.name,
        subdomain: row.subdomain,
        online: lastSeenMs != null && now - lastSeenMs < SERVER_OFFLINE_AFTER_MS,
        lastSeenAt: lastSeenMs,
        createdAt: row.createdAt.getTime(),
      };
    })
    .sort((left, right) => left.createdAt - right.createdAt);

  if (!prof) {
    return { handle: null, machines, servers: [], ...base };
  }

  const serverRows = await db
    .select()
    .from(server)
    .where(eq(server.userId, userId))
    .all();

  const servers = serverRows
    .map((srv) => toServerSummary(srv, prof.handle, serverUrlTemplate, now))
    .sort((a, b) =>
      a.isPrimary !== b.isPrimary
        ? a.isPrimary
          ? -1
          : 1
        : a.createdAt - b.createdAt,
    );

  return { handle: prof.handle, machines, servers, ...base };
}

export async function revokeMachine(
  deps: Pick<Deps, "db" | "closeTunnel">,
  userId: string,
  machineId: string,
): Promise<{ ok: true } | { error: "not-found" | "tunnel-close-failed" }> {
  const existing = await deps.db
    .select({ id: machine.id, revokedAt: machine.revokedAt })
    .from(machine)
    .where(and(eq(machine.id, machineId), eq(machine.userId, userId)))
    .get();
  if (!existing) return { error: "not-found" };

  // Revoke first so neither a stale assignment request nor a reconnect can
  // attach after the closure barrier. Keep the claim pinned until the DO has
  // positively acknowledged close; failures are retryable and never free the
  // label for another tenant.
  await deps.db
    .update(machine)
    .set({ revokedAt: existing.revokedAt ?? new Date() })
    .where(
      and(
        eq(machine.id, machineId),
        eq(machine.userId, userId),
        isNull(machine.revokedAt),
      ),
    )
    .run();

  const claim = await deps.db
    .select()
    .from(labelClaim)
    .where(
      and(eq(labelClaim.kind, "machine"), eq(labelClaim.ownerId, machineId)),
    )
    .get();
  if (!claim && existing.revokedAt !== null) return { error: "not-found" };

  if (claim) {
    try {
      await closeMachineTunnel(deps, claim);
    } catch {
      return { error: "tunnel-close-failed" };
    }
  }

  await deps.db
    .update(machine)
    .set({ subdomain: null })
    .where(and(eq(machine.id, machineId), eq(machine.userId, userId)))
    .run();
  return { ok: true };
}

/** Retry closure/release for revocations left pending by a transient DO error. */
export async function retryPendingMachineRevocations(
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
    )
    .all();
  for (const row of pending) {
    await revokeMachine(deps, userId, row.id);
  }
}

/** Live label-availability check for the claim UIs (handle + "connect another"). */
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

/** Claim the account handle + create the primary server row (subdomain = handle). */
export async function claimHandle(
  deps: Deps,
  userId: string,
  rawHandle: string,
): Promise<{ ok: true; handle: string } | { error: ClaimError }> {
  const { db } = deps;
  const existing = await db
    .select()
    .from(profile)
    .where(eq(profile.userId, userId))
    .get();
  if (existing) return { error: "already-claimed" };

  // One namespace for handles + subdomains, so validate/collision-check both.
  const avail = await checkLabelAvailability(db, rawHandle);
  if (!avail.available) {
    return { error: avail.reason === "invalid" ? avail.error : "taken" };
  }
  const handle = avail.label;

  const now = new Date();
  try {
    // The profile trigger inserts label_claim in this same SQLite statement;
    // a global collision aborts both source and claim atomically.
    await db.insert(profile).values({ userId, handle, createdAt: now }).run();
  } catch {
    return { error: "taken" };
  }
  try {
    await db
      .insert(server)
      .values({
        id: crypto.randomUUID(),
        userId,
        name: "default",
        subdomain: handle,
        createdAt: now,
      })
      .run();
  } catch {
    await db
      .delete(profile)
      .where(and(eq(profile.userId, userId), eq(profile.handle, handle)))
      .run();
    return { error: "taken" };
  }
  return { ok: true, handle };
}

type CreateServerError = "no-handle" | "server-limit" | "taken" | ClaimError;

/**
 * Claim another server label for the account (the "Connect another bb" beat 1).
 * The row is created immediately so the label is held while the machine pairs.
 */
export async function createServer(
  deps: Deps,
  userId: string,
  rawLabel: string,
): Promise<{ ok: true; server: ServerSummary } | { error: CreateServerError }> {
  const { db, serverUrlTemplate } = deps;
  const prof = await db
    .select()
    .from(profile)
    .where(eq(profile.userId, userId))
    .get();
  if (!prof) return { error: "no-handle" };

  const owned = await db
    .select()
    .from(server)
    .where(eq(server.userId, userId))
    .all();
  if (owned.length >= MAX_PER_ACCOUNT) return { error: "server-limit" };

  const avail = await checkLabelAvailability(db, rawLabel);
  if (!avail.available) {
    return { error: avail.reason === "invalid" ? avail.error : "taken" };
  }
  const label = avail.label;

  const now = new Date();
  const id = crypto.randomUUID();
  try {
    // The server trigger claims the label in this same SQLite statement.
    await db
      .insert(server)
      .values({ id, userId, name: label, subdomain: label, createdAt: now })
      .run();
  } catch {
    return { error: "taken" };
  }
  // Re-check the cap after inserting: the pre-insert count is a TOCTOU
  // (concurrent claims could each see room and all insert). Deleting our own
  // row on overflow keeps the ceiling atomic without a transaction, mirroring
  // redeemMachineCode's re-check-at-the-atomic-step pattern.
  const afterCount = await db
    .select()
    .from(server)
    .where(eq(server.userId, userId))
    .all();
  if (afterCount.length > MAX_PER_ACCOUNT) {
    await db.delete(server).where(eq(server.id, id)).run();
    return { error: "server-limit" };
  }
  const created = await db.select().from(server).where(eq(server.id, id)).get();
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
    ),
  };
}

export interface IssuedCode {
  code: string;
  expiresInMs: number;
  serverUrl: string;
  serverId: string;
}

/**
 * Mint (or, with `reuse`, return an existing valid) one-time server-pair code
 * for a specific server. `reuse` backs the setup-mode panels so a poll/reload
 * does not spam fresh codes; the explicit "re-pair" action mints a new one.
 */
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
      )
      .all();
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

  const code = generateConnectCode();
  const nowDate = new Date();
  await db
    .insert(connectCode)
    .values({
      code,
      userId,
      serverId: srv.id,
      purpose: "server-pair",
      expiresAt: new Date(nowDate.getTime() + CONNECT_CODE_TTL_MS),
      createdAt: nowDate,
    })
    .run();
  return {
    code,
    expiresInMs: CONNECT_CODE_TTL_MS,
    serverUrl,
    serverId: srv.id,
  };
}

/** Mint a one-time machine-pair code (dashboard "Add machine"). */
export async function createMachineCode(
  deps: Deps,
  userId: string,
  serverId?: string,
): Promise<
  { code: string; expiresInMs: number; serverUrl: string } | { error: string }
> {
  const { db, serverUrlTemplate } = deps;
  const prof = await db
    .select()
    .from(profile)
    .where(eq(profile.userId, userId))
    .get();
  if (!prof) return { error: "no-handle" };

  // The machine credential is account-scoped, but the install one-liner names a
  // specific server URL (`--server`) — resolve it so the command dials the right bb.
  const srv = await resolveServer(db, userId, serverId);
  if (!srv) return { error: "no-server" };

  const active = await db
    .select()
    .from(machine)
    .where(eq(machine.userId, userId))
    .all();
  if (
    active.filter((m) => m.revokedAt == null).length >= MAX_PER_ACCOUNT
  ) {
    return { error: "machine-limit" };
  }

  const code = generateConnectCode();
  const now = new Date();
  await db
    .insert(connectCode)
    .values({
      code,
      userId,
      // Machine credentials are account-scoped, but the code remembers which
      // server the "Add machine" flow targeted so redeem can echo its URL.
      serverId: srv.id,
      purpose: "machine-pair",
      expiresAt: new Date(now.getTime() + CONNECT_CODE_TTL_MS),
      createdAt: now,
    })
    .run();
  return {
    code,
    expiresInMs: CONNECT_CODE_TTL_MS,
    serverUrl: serverUrlForLabel(srv.subdomain, serverUrlTemplate),
  };
}

/**
 * Mint a machine code for the exact bb identified by its durable tunnel
 * credential. This is the server-to-cloud half of the in-product one-command
 * flow; no browser session is involved.
 */
export async function createMachineCodeForServerCredential(
  deps: Deps,
  credential: string,
): Promise<
  | { code: string; expiresInMs: number; serverUrl: string }
  | { error: string; status: number }
> {
  const presented = credential.trim();
  if (!presented) return { error: "unauthorized", status: 401 };
  const srv = await deps.db
    .select({ id: server.id, userId: server.userId })
    .from(server)
    .where(
      and(
        eq(server.credentialHash, await sha256Hex(presented)),
        isNull(server.revokedAt),
      ),
    )
    .get();
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
  const presented = credential.trim();
  if (!presented) return { error: "unauthorized", status: 401 };
  const srv = await deps.db
    .select({ userId: server.userId })
    .from(server)
    .where(
      and(
        eq(server.credentialHash, await sha256Hex(presented)),
        isNull(server.revokedAt),
      ),
    )
    .get();
  if (!srv) return { error: "unauthorized", status: 401 };
  const result = await revokeMachine(deps, srv.userId, machineId);
  return "error" in result
    ? {
        error: result.error,
        status: result.error === "tunnel-close-failed" ? 503 : 404,
      }
    : result;
}

/**
 * Revoke ONE server's credential and sever its live tunnel. Server-scoped: only
 * the target row is cleared and only its TunnelDO (keyed by subdomain) is closed,
 * so disconnecting one bb never touches the account's other servers.
 */
export async function disconnectServer(
  deps: Deps,
  userId: string,
  serverId: string,
): Promise<{ ok: true } | { error: string }> {
  const { db } = deps;
  const srv = await db
    .select()
    .from(server)
    .where(and(eq(server.id, serverId), eq(server.userId, userId)))
    .get();
  if (!srv) return { error: "not-found" };

  await db
    .update(server)
    .set({ credentialHash: null, revokedAt: new Date() })
    .where(eq(server.id, srv.id))
    .run();
  try {
    await deps.closeTunnel?.(srv.subdomain);
  } catch {
    // best-effort; the credential is already revoked so reconnect is blocked
  }
  return { ok: true };
}

/**
 * Delete a never-paired secondary server row, freeing its subdomain for re-claim.
 * Distinct from `disconnectServer`: disconnect revokes a live credential but keeps
 * the row (so it can be re-paired at the same address); remove drops the row
 * entirely. Refuses the primary (subdomain === account handle) — that row is the
 * account's identity and must survive — and refuses a still-connected row, since
 * a live bb should be disconnected (revoked + tunnel closed), not silently deleted.
 */
export async function removeServer(
  deps: Deps,
  userId: string,
  serverId: string,
): Promise<{ ok: true } | { error: string }> {
  const { db } = deps;
  const prof = await db
    .select()
    .from(profile)
    .where(eq(profile.userId, userId))
    .get();
  const srv = await db
    .select()
    .from(server)
    .where(and(eq(server.id, serverId), eq(server.userId, userId)))
    .get();
  if (!srv) return { error: "not-found" };
  if (prof && srv.subdomain === prof.handle) return { error: "is-primary" };
  if (srv.credentialHash != null && srv.revokedAt == null) {
    return { error: "connected" };
  }

  await db.delete(server).where(eq(server.id, srv.id)).run();
  return { ok: true };
}

/**
 * Rows affected by a drizzle `.run()` across D1 (`meta.changes`) and
 * better-sqlite3 (`changes`) drivers.
 */
function rowsChanged(result: unknown): number {
  if (result && typeof result === "object") {
    const r = result as { meta?: { changes?: number }; changes?: number };
    if (typeof r.meta?.changes === "number") return r.meta.changes;
    if (typeof r.changes === "number") return r.changes;
  }
  return 0;
}

/**
 * Redeem a connect code (called by the tunnel client — the code is the
 * credential). Atomically consumes the code, mints a durable tunnel credential,
 * pins it (hashed) on the server row, returns plaintext once.
 *
 * `handle` is the redeemed server's routing label (its subdomain). For the
 * primary server this equals the account handle, so primary pairing is
 * byte-identical to the pre-multi-server behavior. The tunnel client uses
 * this field to build serverUrl / share URLs — it must not be the account's
 * primary handle when a non-primary server was paired.
 *
 * Accepts `Deps` (D1 in the worker via `depsFromEnv`, better-sqlite3 in tests).
 */
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

  const row = await db
    .select()
    .from(connectCode)
    .where(eq(connectCode.code, normalized))
    .get();
  if (!row || row.serverId == null)
    return { error: "invalid-code", status: 404 };
  if (row.consumedAt != null) return { error: "already-used", status: 409 };
  if (row.expiresAt.getTime() < Date.now())
    return { error: "expired", status: 410 };

  const consumed = await db
    .update(connectCode)
    .set({ consumedAt: new Date() })
    .where(
      and(eq(connectCode.code, normalized), isNull(connectCode.consumedAt)),
    )
    .run();
  if (rowsChanged(consumed) === 0)
    return { error: "already-used", status: 409 };

  const credential = generateToken("bbcred_", 32);
  await db
    .update(server)
    .set({ credentialHash: await sha256Hex(credential), revokedAt: null })
    .where(eq(server.id, row.serverId))
    .run();

  const srv = await db
    .select()
    .from(server)
    .where(eq(server.id, row.serverId))
    .get();
  // Routing label of the redeemed server (not necessarily the account handle).
  const handle = srv?.subdomain ?? null;
  const serverUrl = handle
    ? serverUrlForLabel(handle, serverUrlTemplate)
    : null;
  return {
    credential,
    serverId: row.serverId,
    handle,
    // Keyed by this server's subdomain (which may be non-primary), not the account handle.
    tunnelUrl: serverUrl
      ? `${serverUrl.replace(/^http/u, "ws")}/__tunnel`
      : null,
  };
}

/**
 * Redeem a machine-pair code (called by the daemon join). Consumes the code,
 * creates a machine row, and returns the durable machine credential once.
 */
export async function redeemMachineCode(
  deps: Pick<Deps, "db" | "serverUrlTemplate">,
  code: string,
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

  const row = await db
    .select()
    .from(connectCode)
    .where(eq(connectCode.code, normalized))
    .get();
  if (!row || row.purpose !== "machine-pair")
    return { error: "invalid-code", status: 404 };
  if (row.consumedAt != null) return { error: "already-used", status: 409 };
  if (row.expiresAt.getTime() < Date.now())
    return { error: "expired", status: 410 };

  // Re-check the cap here, not just at code creation: createMachineCode's
  // count is a TOCTOU (N codes each minted while under the limit could all
  // redeem past it). Checked before consuming so a rejected redeem leaves the
  // code usable.
  const machines = await db
    .select()
    .from(machine)
    .where(eq(machine.userId, row.userId))
    .all();
  if (
    machines.filter((m) => m.revokedAt == null).length >=
    MAX_PER_ACCOUNT
  ) {
    return { error: "machine-limit", status: 409 };
  }

  const consumed = await db
    .update(connectCode)
    .set({ consumedAt: new Date() })
    .where(
      and(eq(connectCode.code, normalized), isNull(connectCode.consumedAt)),
    )
    .run();
  if (rowsChanged(consumed) === 0)
    return { error: "already-used", status: 409 };

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

  const prof = await db
    .select()
    .from(profile)
    .where(eq(profile.userId, row.userId))
    .get();
  // Echo the server the "Add machine" flow targeted (carried on the code);
  // fall back to the primary handle for codes minted before serverId was set.
  const targetServer =
    row.serverId == null
      ? null
      : await db.select().from(server).where(eq(server.id, row.serverId)).get();
  const label = targetServer?.subdomain ?? prof?.handle ?? null;
  return {
    credential,
    machineId,
    handle: prof?.handle ?? null,
    serverUrl: label ? serverUrlForLabel(label, serverUrlTemplate) : null,
  };
}
