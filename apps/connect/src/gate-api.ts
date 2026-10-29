import { drizzle } from "drizzle-orm/d1";
import {
  NEXT_TUNNEL_WRITE_INTERVAL_MS,
  mcpResourceForOrigin,
  schema,
  sha256Hex,
  type ConnectDb,
} from "@bb/connect-db";
import {
  GATE_PRESENCE_BATCH_MAX,
  GATE_RESOLVE_BATCH_MAX,
  type GateAssertionOAuth,
  type GatePresenceBatchResponse,
  type GatePresenceRequest,
  type GatePresenceResponse,
  type GatePresenceResult,
  type GateResolveBatchResponse,
  type GateResolveRequest,
  type GateResolveResponse,
  type GateResolvedLabel,
} from "@bb/tunnel-contract/next";
import {
  markMachineSeen,
  resolveLabel,
  resolveLabels,
  verifyMachineCredentialDetails,
  verifySessionCookieDetails,
} from "./session.js";
import {
  desktopSessionSetCookie,
  issueDesktopSessionCookie,
  verifyDesktopSessionCookie,
} from "./desktop-session.js";
import { authorizeMcpToken } from "./mcp-gate.js";
import { resolveConnectRuntime } from "./cloud-dev.js";
import { jsonResponse, methodNotAllowed } from "./json-response.js";
import type { Env } from "./tunnel-do.js";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_RESOLVE_BATCH_BODY_BYTES = 256 * 1024;
const MAX_PRESENCE_BATCH_BODY_BYTES = 128 * 1024;
const MAX_VALUE_LENGTH = 8 * 1024;
const MAX_PRESENCE_ID_LENGTH = 128;
const PRESENCE_MAX_FUTURE_MS = 60_000;
const LABEL_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/u;
const NO_STORE = { "cache-control": "no-store" };

type ResolvedLabel = NonNullable<Awaited<ReturnType<typeof resolveLabel>>>;

function notFound(): Response {
  return new Response("bb connect: not found\n", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function invalidRequest(): Response {
  return jsonResponse({ error: "invalid_request" }, 400, NO_STORE);
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

async function constantTimeEqual(
  left: string,
  right: string,
): Promise<boolean> {
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}

async function gateRequestAuthorized(
  request: Request,
  env: Pick<Env, "GATE_SECRET">,
): Promise<boolean> {
  const secret = env.GATE_SECRET?.trim() ?? "";
  if (secret === "") return false;
  const match = /^Bearer (.+)$/u.exec(
    request.headers.get("authorization") ?? "",
  );
  if (match === null) return false;
  return constantTimeEqual(match[1] ?? "", secret);
}

function nextBaseDomain(env: Pick<Env, "NEXT_BASE_DOMAIN">): string | null {
  const value = env.NEXT_BASE_DOMAIN?.trim() ?? "";
  return value === "" ? null : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const present = Object.keys(value);
  return present.length === keys.length && keys.every((key) => key in value);
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value !== "" && value.length <= max;
}

function nullableValue(value: unknown): string | null | undefined {
  if (value === null) return null;
  return isBoundedString(value, MAX_VALUE_LENGTH) ? value : undefined;
}

const RESOLVE_KEYS = [
  "label",
  "session",
  "desktopSession",
  "credential",
  "machineCredential",
  "oauth",
] as const;

function parseGateResolveRequest(value: unknown): GateResolveRequest | null {
  if (!isRecord(value) || !hasExactKeys(value, RESOLVE_KEYS)) return null;
  const { label } = value;
  if (typeof label !== "string" || !LABEL_PATTERN.test(label)) return null;
  const session = nullableValue(value.session);
  const desktopSession = nullableValue(value.desktopSession);
  const credential = nullableValue(value.credential);
  const machineCredential = nullableValue(value.machineCredential);
  if (
    session === undefined ||
    desktopSession === undefined ||
    credential === undefined ||
    machineCredential === undefined
  ) {
    return null;
  }
  let oauth: GateResolveRequest["oauth"] = null;
  if (value.oauth !== null) {
    if (
      !isRecord(value.oauth) ||
      !hasExactKeys(value.oauth, ["token", "resource"])
    ) {
      return null;
    }
    const { token, resource } = value.oauth;
    if (
      !isBoundedString(token, MAX_VALUE_LENGTH) ||
      !isBoundedString(resource, MAX_VALUE_LENGTH)
    ) {
      return null;
    }
    oauth = { token, resource };
  }
  return {
    label,
    session,
    desktopSession,
    credential,
    machineCredential,
    oauth,
  };
}

const PRESENCE_KEYS = [
  "label",
  "state",
  "region",
  "gateMachineId",
  "at",
] as const;

function parseGatePresenceRequest(value: unknown): GatePresenceRequest | null {
  if (!isRecord(value) || !hasExactKeys(value, PRESENCE_KEYS)) return null;
  const { label, state, region, gateMachineId, at } = value;
  if (
    typeof label !== "string" ||
    !LABEL_PATTERN.test(label) ||
    (state !== "connected" && state !== "disconnected") ||
    !isBoundedString(region, MAX_PRESENCE_ID_LENGTH) ||
    !isBoundedString(gateMachineId, MAX_PRESENCE_ID_LENGTH) ||
    typeof at !== "number" ||
    !Number.isSafeInteger(at) ||
    at <= 0
  ) {
    return null;
  }
  return { label, state, region, gateMachineId, at };
}

function parseBatch<T>(
  value: unknown,
  key: string,
  max: number,
  parse: (entry: unknown) => T | null,
): T[] | null {
  if (!isRecord(value) || !hasExactKeys(value, [key])) return null;
  const entries = value[key];
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > max) {
    return null;
  }
  const parsed: T[] = [];
  for (const entry of entries) {
    const one = parse(entry);
    if (one === null) return null;
    parsed.push(one);
  }
  return parsed;
}

async function readJsonBody(
  request: Request,
  maxBytes = MAX_BODY_BYTES,
): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return undefined;
  const text = await request.text();
  if (text.length > maxBytes) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function toGateLabel(resolved: ResolvedLabel): GateResolvedLabel {
  if (resolved.kind === "server") {
    return {
      kind: "server",
      serverId: resolved.server.id,
      userId: resolved.userId,
      revoked: resolved.server.revokedAt != null,
      lastSeenAt: resolved.server.lastSeenAt?.getTime() ?? null,
    };
  }
  return {
    kind: "machine",
    machineId: resolved.machine.id,
    userId: resolved.userId,
    accountHandle: resolved.accountHandle,
    routingKey: resolved.routingKey,
    revoked: resolved.machine.revokedAt != null,
    lastSeenAt: resolved.machine.lastSeenAt?.getTime() ?? null,
  };
}

async function linkCredentialMatches(
  resolved: ResolvedLabel | null,
  credential: string,
): Promise<boolean> {
  if (resolved === null) return false;
  const owner = resolved.kind === "server" ? resolved.server : resolved.machine;
  if (owner.revokedAt != null || owner.credentialHash == null) return false;
  return constantTimeEqual(await sha256Hex(credential), owner.credentialHash);
}

async function resolveDesktopSession(
  cookie: string,
  resolved: ResolvedLabel | null,
  env: Env,
  db: ConnectDb,
): Promise<GateResolveResponse["desktopSession"]> {
  const verified = await verifyDesktopSessionCookie(
    cookie,
    env.BETTER_AUTH_SECRET,
    db,
  );
  if (verified === null) return null;
  if (
    verified.refreshGrant === null ||
    resolved === null ||
    resolved.userId !== verified.userId
  ) {
    return { userId: verified.userId, setCookie: null };
  }
  const runtime = resolveConnectRuntime(env);
  const renewed = await issueDesktopSessionCookie(
    { userId: verified.userId, grant: verified.refreshGrant },
    {
      baseDomain: env.BASE_DOMAIN,
      name: runtime.desktopSessionCookieName,
      secret: env.BETTER_AUTH_SECRET,
    },
  );
  return {
    userId: verified.userId,
    setCookie: desktopSessionSetCookie(
      renewed,
      new URL(runtime.accountAppUrl).protocol === "https:",
    ),
  };
}

function nextMcpOrigin(
  label: string,
  resource: string,
  env: Env,
): string | null {
  const base = nextBaseDomain(env);
  if (base === null) return null;
  const origin = `https://${label}.${base}`;
  if (resource === mcpResourceForOrigin(origin)) return origin;
  if (!resolveConnectRuntime(env).localCloud) return null;
  let url: URL;
  try {
    url = new URL(resource);
  } catch {
    return null;
  }
  return url.protocol === "http:" &&
    url.hostname === `${label}.${base}` &&
    resource === mcpResourceForOrigin(url.origin)
    ? url.origin
    : null;
}

async function resolveOAuth(
  label: string,
  presented: { token: string; resource: string },
  resolved: ResolvedLabel | null,
  env: Env,
  db: ConnectDb,
  ctx: ExecutionContext,
): Promise<GateAssertionOAuth | null> {
  if (resolved === null || resolved.kind !== "server") return null;
  const origin = nextMcpOrigin(label, presented.resource, env);
  if (origin === null) return null;
  const authorization = await authorizeMcpToken(presented.token, {
    origin,
    userId: resolved.userId,
    server: resolved.server,
    secret: env.BETTER_AUTH_SECRET,
    db,
  });
  if (authorization === null) return null;
  if (authorization.recordUse !== null) {
    ctx.waitUntil(authorization.recordUse());
  }
  return authorization.forward;
}

async function resolveOne(
  parsed: GateResolveRequest,
  env: Env,
  db: ConnectDb,
  ctx: ExecutionContext,
  preloaded?: ResolvedLabel | null,
): Promise<GateResolveResponse> {
  const resolved =
    preloaded !== undefined
      ? preloaded
      : await resolveLabel(
          parsed.label,
          db,
          parsed.credential !== null ? { fresh: true } : undefined,
        );

  const verifiedSession =
    parsed.session === null
      ? null
      : await verifySessionCookieDetails(
          parsed.session,
          env.BETTER_AUTH_SECRET,
          db,
        );
  const verifiedMachine =
    parsed.machineCredential === null
      ? null
      : await verifyMachineCredentialDetails(parsed.machineCredential, db);
  if (
    verifiedMachine !== null &&
    resolved !== null &&
    verifiedMachine.userId === resolved.userId
  ) {
    ctx.waitUntil(markMachineSeen(verifiedMachine, db));
  }

  return {
    label: resolved === null ? null : toGateLabel(resolved),
    session:
      verifiedSession === null
        ? null
        : {
            userId: verifiedSession.userId,
            needsRefresh: verifiedSession.needsRefresh,
          },
    desktopSession:
      parsed.desktopSession === null
        ? null
        : await resolveDesktopSession(parsed.desktopSession, resolved, env, db),
    credential:
      parsed.credential === null
        ? null
        : await linkCredentialMatches(resolved, parsed.credential),
    machine:
      verifiedMachine === null
        ? null
        : {
            machineId: verifiedMachine.machineId,
            userId: verifiedMachine.userId,
          },
    oauth:
      parsed.oauth === null
        ? null
        : await resolveOAuth(
            parsed.label,
            parsed.oauth,
            resolved,
            env,
            db,
            ctx,
          ),
  };
}

export async function handleGateResolve(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!(await gateRequestAuthorized(request, env))) return notFound();
  if (request.method !== "POST") return methodNotAllowed("POST");
  const parsed = parseGateResolveRequest(await readJsonBody(request));
  if (parsed === null) return invalidRequest();
  const db = drizzle(env.DB, { schema });
  return jsonResponse(await resolveOne(parsed, env, db, ctx), 200, NO_STORE);
}

export async function handleGateResolveBatch(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!(await gateRequestAuthorized(request, env))) return notFound();
  if (request.method !== "POST") return methodNotAllowed("POST");
  const requests = parseBatch(
    await readJsonBody(request, MAX_RESOLVE_BATCH_BODY_BYTES),
    "requests",
    GATE_RESOLVE_BATCH_MAX,
    parseGateResolveRequest,
  );
  if (requests === null) return invalidRequest();
  const db = drizzle(env.DB, { schema });
  const labels = await resolveLabels(
    requests.map((parsed) => parsed.label),
    db,
  ).catch(() => null);
  const answers = await Promise.all(
    requests.map((parsed) =>
      resolveOne(parsed, env, db, ctx, labels?.get(parsed.label)).catch(
        (error: unknown) => {
          console.error("bb connect: gate resolve batch entry failed", {
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        },
      ),
    ),
  );
  const body: GateResolveBatchResponse = { answers };
  return jsonResponse(body, 200, NO_STORE);
}

const PRESENCE_ROWS = `SELECT json_extract(value, '$.label') AS label,
  json_extract(value, '$.state') AS state,
  json_extract(value, '$.region') AS region,
  json_extract(value, '$.gateMachineId') AS gate,
  json_extract(value, '$.at') AS at
  FROM json_each(?1)`;

const MACHINE_HOLDS_LABEL = `machine.revoked_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM server WHERE server.subdomain = machine.subdomain)
  AND EXISTS (SELECT 1 FROM label_claim WHERE label_claim.label = machine.subdomain
    AND label_claim.kind = 'machine' AND label_claim.owner_id = machine.id)
  AND EXISTS (SELECT 1 FROM profile WHERE profile.user_id = machine.user_id)`;

function connectedUpdate(table: "server" | "machine"): string {
  return `UPDATE ${table} SET next_tunnel_gate = p.gate, next_tunnel_region = p.region,
  next_tunnel_at = p.at, last_seen_at = min(p.at, ?2)
  FROM (${PRESENCE_ROWS}) AS p
  WHERE p.state = 'connected' AND ${table}.subdomain = p.label
  ${table === "machine" ? `AND ${MACHINE_HOLDS_LABEL}` : ""}
  AND (${table}.next_tunnel_at IS NULL OR ${table}.next_tunnel_at < p.at)
  AND (${table}.next_tunnel_gate IS NULL OR ${table}.next_tunnel_at IS NULL
    OR ${table}.next_tunnel_gate <> p.gate OR ${table}.next_tunnel_region <> p.region
    OR ${table}.next_tunnel_at <= p.at - ?3)
  RETURNING ${table}.subdomain AS label`;
}

function disconnectedUpdate(table: "server" | "machine"): string {
  return `UPDATE ${table} SET next_tunnel_gate = NULL, next_tunnel_region = NULL,
  next_tunnel_at = p.at, last_seen_at = min(p.at, ?2)
  FROM (${PRESENCE_ROWS}) AS p
  WHERE p.state = 'disconnected' AND ${table}.subdomain = p.label
  ${table === "machine" ? `AND ${MACHINE_HOLDS_LABEL}` : ""}
  AND ${table}.next_tunnel_gate = p.gate AND ${table}.next_tunnel_at <= p.at
  RETURNING ${table}.subdomain AS label`;
}

const KNOWN_LABELS = `SELECT p.label AS label FROM (${PRESENCE_ROWS}) AS p
  WHERE EXISTS (SELECT 1 FROM server WHERE server.subdomain = p.label)
  OR EXISTS (SELECT 1 FROM machine
    JOIN profile ON profile.user_id = machine.user_id
    JOIN label_claim ON label_claim.label = machine.subdomain
      AND label_claim.kind = 'machine' AND label_claim.owner_id = machine.id
    WHERE machine.subdomain = p.label)`;

const PRESENCE_STATEMENTS: [string, number][] = [
  [KNOWN_LABELS, 1],
  [connectedUpdate("server"), 3],
  [disconnectedUpdate("server"), 2],
  [connectedUpdate("machine"), 3],
  [disconnectedUpdate("machine"), 2],
];

export async function recordNextTunnelPresence(
  d1: D1Database,
  reports: readonly GatePresenceRequest[],
  now: number,
): Promise<GatePresenceResult[]> {
  const rows = JSON.stringify(reports);
  const values = [rows, now, NEXT_TUNNEL_WRITE_INTERVAL_MS];
  const results = await d1.batch<{ label: string }>(
    PRESENCE_STATEMENTS.map(([statement, count]) =>
      d1.prepare(statement).bind(...values.slice(0, count)),
    ),
  );
  const [known, ...writes] = results;
  const knownLabels = new Set(known?.results.map((row) => row.label) ?? []);
  const recorded = new Set(
    writes.flatMap((write) => write.results.map((row) => row.label)),
  );
  return reports.map((report) => {
    if (recorded.has(report.label)) return "recorded";
    return knownLabels.has(report.label) ? "unchanged" : "unknown_label";
  });
}

export async function handleGatePresence(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!(await gateRequestAuthorized(request, env))) return notFound();
  if (request.method !== "POST") return methodNotAllowed("POST");
  const parsed = parseGatePresenceRequest(await readJsonBody(request));
  if (parsed === null) return invalidRequest();
  const now = Date.now();
  if (parsed.at > now + PRESENCE_MAX_FUTURE_MS) return invalidRequest();
  const [result] = await recordNextTunnelPresence(env.DB, [parsed], now);
  if (result === "unknown_label") {
    return jsonResponse({ error: "unknown_label" }, 404, NO_STORE);
  }
  const body: GatePresenceResponse = { recorded: result === "recorded" };
  return jsonResponse(body, 200, NO_STORE);
}

export async function handleGatePresenceBatch(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!(await gateRequestAuthorized(request, env))) return notFound();
  if (request.method !== "POST") return methodNotAllowed("POST");
  const reports = parseBatch(
    await readJsonBody(request, MAX_PRESENCE_BATCH_BODY_BYTES),
    "reports",
    GATE_PRESENCE_BATCH_MAX,
    parseGatePresenceRequest,
  );
  if (reports === null) return invalidRequest();
  const now = Date.now();
  const labels = new Set(reports.map((report) => report.label));
  if (
    labels.size !== reports.length ||
    reports.some((report) => report.at > now + PRESENCE_MAX_FUTURE_MS)
  ) {
    return invalidRequest();
  }
  const body: GatePresenceBatchResponse = {
    results: await recordNextTunnelPresence(env.DB, reports, now),
  };
  return jsonResponse(body, 200, NO_STORE);
}
