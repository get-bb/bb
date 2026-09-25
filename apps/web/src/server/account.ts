import { and, eq, gt, inArray, isNull, lt, lte, or } from "drizzle-orm";
import {
  CONNECT_CODE_TTL_MS,
  HANDLE_MAX_LENGTH,
  type ConnectDb,
  connectCode,
  resolveServerCredential,
  rowsChanged,
  server,
  sha256Hex,
  user,
  validateLabel,
} from "@bb/connect-db";
import {
  type CreateServerError,
  type Deps,
  type ServerSummary,
  createServer,
  denyOutstandingLinkApprovals,
  findProfile,
  serverUrlForLabel,
  toServerSummary,
  tunnelUrlForServerUrl,
} from "./api.js";
import { generateConnectCode, generateToken } from "./tokens.js";

export const LINK_POLL_INTERVAL_MS = 2_000;
export const LINK_DELIVERY_GRACE_MS = 2 * 60 * 1000;
export const LINK_CLIENT_NAME_MAX_LENGTH = 100;
export const LINK_EXPIRED_ROW_RETENTION_MS = 60 * 60 * 1000;
export const LINK_EXPIRED_ROW_PRUNE_LIMIT = 100;
const LINK_LOCATION_PART_MAX_LENGTH = 60;
const LINK_PURPOSE = "server-link";
const USER_CODE_INSERT_ATTEMPTS = 5;
const UNKNOWN_CLIENT_IP = "unknown";
const INVISIBLE_CONTROL_CHARACTERS = /[\p{Cc}\p{Bidi_Control}]/gu;

type ErrorResult<S extends number, E extends string> = {
  status: S;
  body: { error: E };
};

type OkResult<T> = { status: 200; body: T };

export function accountApiResponse(result: {
  status: number;
  body: unknown;
}): Response {
  return Response.json(result.body, { status: result.status });
}

export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null);
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? Object.fromEntries(Object.entries(body))
    : {};
}

export interface AccountMe {
  userId: string;
  githubLogin: string | null;
  name: string;
  avatarUrl: string | null;
  handle: string | null;
  serverId: string;
  serverLabel: string;
  serverUrl: string;
  tunnelUrl: string;
}

export async function getAccountMe(
  deps: Pick<Deps, "db" | "serverUrlTemplate">,
  credential: string,
): Promise<OkResult<AccountMe> | ErrorResult<401, "unauthorized">> {
  const resolved = await resolveServerCredential(deps.db, credential);
  if (!resolved) return { status: 401, body: { error: "unauthorized" } };
  const account = await deps.db
    .select({
      name: user.name,
      image: user.image,
      githubLogin: user.githubLogin,
    })
    .from(user)
    .where(eq(user.id, resolved.userId))
    .get();
  if (!account) return { status: 401, body: { error: "unauthorized" } };
  const prof = await findProfile(deps.db, resolved.userId);
  const serverUrl = serverUrlForLabel(
    resolved.server.subdomain,
    deps.serverUrlTemplate,
  );
  return {
    status: 200,
    body: {
      userId: resolved.userId,
      githubLogin: account.githubLogin,
      name: account.name,
      avatarUrl: account.image,
      handle: prof?.handle ?? null,
      serverId: resolved.server.id,
      serverLabel: resolved.server.subdomain,
      serverUrl,
      tunnelUrl: tunnelUrlForServerUrl(serverUrl),
    },
  };
}

export interface LinkStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresAt: number;
  intervalMs: number;
}

export function linkVerificationUrl(appUrl: string, userCode: string): string {
  const url = new URL("/link", appUrl);
  url.searchParams.set("code", userCode);
  return url.toString();
}

export function stripControlCharacters(value: string): string {
  return value.replace(INVISIBLE_CONTROL_CHARACTERS, "").trim();
}

function cfText(cf: unknown, key: string): string | null {
  const value =
    typeof cf === "object" && cf !== null ? Reflect.get(cf, key) : undefined;
  if (typeof value !== "string") return null;
  const clean = stripControlCharacters(value).slice(
    0,
    LINK_LOCATION_PART_MAX_LENGTH,
  );
  return clean === "" ? null : clean;
}

function countryName(code: string | null): string | null {
  if (code === null || code === "XX") return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export interface LinkRequestOrigin {
  clientIp: string;
  location: string | null;
}

export function linkRequestOrigin(request: Request): LinkRequestOrigin {
  const cf: unknown = Reflect.get(request, "cf");
  const place = [cfText(cf, "city"), countryName(cfText(cf, "country"))]
    .filter((part) => part !== null)
    .join(", ");
  return {
    clientIp:
      request.headers.get("cf-connecting-ip")?.trim() || UNKNOWN_CLIENT_IP,
    location: place === "" ? null : place,
  };
}

export interface LinkStartRateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

async function pruneExpiredLinkRequests(
  db: ConnectDb,
  now: number,
): Promise<void> {
  const stale = db
    .select({ code: connectCode.code })
    .from(connectCode)
    .where(
      and(
        eq(connectCode.purpose, LINK_PURPOSE),
        isNull(connectCode.approvedAt),
        lt(
          connectCode.expiresAt,
          new Date(now - LINK_EXPIRED_ROW_RETENTION_MS),
        ),
      ),
    )
    .limit(LINK_EXPIRED_ROW_PRUNE_LIMIT);
  try {
    await db.delete(connectCode).where(inArray(connectCode.code, stale)).run();
  } catch (error) {
    console.error("bb account: pruning expired link requests failed", error);
  }
}

export async function startServerLink(
  deps: Pick<Deps, "db" | "appUrl"> & { rateLimiter: LinkStartRateLimiter },
  input: { clientName: unknown } & LinkRequestOrigin,
  now: number = Date.now(),
): Promise<
  | OkResult<LinkStartResponse>
  | ErrorResult<400, "invalid-client-name">
  | ErrorResult<429, "rate-limited">
  | ErrorResult<503, "unavailable">
> {
  const clientName =
    typeof input.clientName === "string"
      ? stripControlCharacters(input.clientName)
      : "";
  if (
    clientName.length === 0 ||
    clientName.length > LINK_CLIENT_NAME_MAX_LENGTH
  ) {
    return { status: 400, body: { error: "invalid-client-name" } };
  }
  const admitted = await deps.rateLimiter.limit({ key: input.clientIp });
  if (!admitted.success) {
    return { status: 429, body: { error: "rate-limited" } };
  }
  await pruneExpiredLinkRequests(deps.db, now);
  const deviceCode = generateToken("bbdev_");
  const deviceCodeHash = await sha256Hex(deviceCode);
  const expiresAt = now + CONNECT_CODE_TTL_MS;
  for (let attempt = 0; attempt < USER_CODE_INSERT_ATTEMPTS; attempt += 1) {
    const userCode = generateConnectCode();
    const inserted = await deps.db
      .insert(connectCode)
      .values({
        code: userCode,
        userId: null,
        serverId: null,
        purpose: LINK_PURPOSE,
        deviceCodeHash,
        clientName,
        requestLocation: input.location,
        expiresAt: new Date(expiresAt),
        createdAt: new Date(now),
      })
      .onConflictDoNothing({ target: connectCode.code })
      .run();
    if (rowsChanged(inserted) === 0) continue;
    return {
      status: 200,
      body: {
        deviceCode,
        userCode,
        verificationUrl: linkVerificationUrl(deps.appUrl, userCode),
        expiresAt,
        intervalMs: LINK_POLL_INTERVAL_MS,
      },
    };
  }
  return { status: 503, body: { error: "unavailable" } };
}

export type LinkPollResponse =
  | { status: "pending" }
  | {
      status: "approved";
      credential: string;
      serverId: string;
      handle: string;
      serverUrl: string;
      tunnelUrl: string;
    };

type LinkPollError =
  | ErrorResult<403, "denied">
  | ErrorResult<404, "invalid-code">
  | ErrorResult<409, "already-used">
  | ErrorResult<410, "expired">
  | ErrorResult<429, "slow-down">;

export async function pollServerLink(
  deps: Pick<Deps, "db" | "serverUrlTemplate" | "closeTunnel">,
  rawDeviceCode: unknown,
  now: number = Date.now(),
): Promise<OkResult<LinkPollResponse> | LinkPollError> {
  const deviceCode =
    typeof rawDeviceCode === "string" ? rawDeviceCode.trim() : "";
  if (!deviceCode) return { status: 404, body: { error: "invalid-code" } };
  const deviceCodeHash = await sha256Hex(deviceCode);
  const row = await deps.db
    .select()
    .from(connectCode)
    .where(
      and(
        eq(connectCode.deviceCodeHash, deviceCodeHash),
        eq(connectCode.purpose, LINK_PURPOSE),
      ),
    )
    .get();
  if (!row) return { status: 404, body: { error: "invalid-code" } };

  const polled = await deps.db
    .update(connectCode)
    .set({ polledAt: new Date(now) })
    .where(
      and(
        eq(connectCode.code, row.code),
        or(
          isNull(connectCode.polledAt),
          lte(connectCode.polledAt, new Date(now - LINK_POLL_INTERVAL_MS)),
        ),
      ),
    )
    .run();
  if (rowsChanged(polled) === 0) {
    return { status: 429, body: { error: "slow-down" } };
  }

  if (row.deniedAt !== null) return { status: 403, body: { error: "denied" } };
  if (row.approvedAt === null || row.serverId === null) {
    return row.expiresAt.getTime() <= now
      ? { status: 410, body: { error: "expired" } }
      : { status: 200, body: { status: "pending" } };
  }
  return deliverLinkCredential(
    deps,
    { ...row, approvedAt: row.approvedAt, serverId: row.serverId },
    now,
  );
}

async function deliverLinkCredential(
  deps: Pick<Deps, "db" | "serverUrlTemplate" | "closeTunnel">,
  row: LinkRow & { approvedAt: Date; serverId: string },
  now: number,
): Promise<OkResult<LinkPollResponse> | LinkPollError> {
  const target = await deps.db
    .select()
    .from(server)
    .where(eq(server.id, row.serverId))
    .get();
  if (!target) return { status: 404, body: { error: "invalid-code" } };
  if (
    target.revokedAt !== null &&
    target.revokedAt.getTime() >= row.approvedAt.getTime()
  ) {
    return { status: 403, body: { error: "denied" } };
  }
  const credential = generateToken("bbcred_");
  const credentialHash = await sha256Hex(credential);
  if (row.consumedAt === null) {
    const deliverBefore = new Date(
      row.expiresAt.getTime() + LINK_DELIVERY_GRACE_MS,
    );
    if (now >= deliverBefore.getTime()) {
      return { status: 410, body: { error: "expired" } };
    }
    const claimed = await deps.db
      .update(connectCode)
      .set({
        consumedAt: new Date(now),
        deliveredCredentialHash: credentialHash,
      })
      .where(
        and(
          eq(connectCode.code, row.code),
          isNull(connectCode.consumedAt),
          isNull(connectCode.deniedAt),
          gt(connectCode.expiresAt, new Date(now - LINK_DELIVERY_GRACE_MS)),
        ),
      )
      .run();
    if (rowsChanged(claimed) === 0) {
      return { status: 409, body: { error: "already-used" } };
    }
    const minted = await deps.db
      .update(server)
      .set({ credentialHash, revokedAt: null })
      .where(
        and(
          eq(server.id, target.id),
          or(isNull(server.revokedAt), lt(server.revokedAt, row.approvedAt)),
        ),
      )
      .run();
    if (rowsChanged(minted) === 0) {
      return { status: 403, body: { error: "denied" } };
    }
    await denyOutstandingLinkApprovals(
      deps.db,
      target.id,
      new Date(now),
      row.code,
    );
  } else {
    if (
      row.expiresAt.getTime() <= now ||
      row.deliveredCredentialHash === null
    ) {
      return { status: 409, body: { error: "already-used" } };
    }
    const rotated = await deps.db
      .update(server)
      .set({ credentialHash })
      .where(
        and(
          eq(server.id, target.id),
          eq(server.credentialHash, row.deliveredCredentialHash),
          isNull(server.revokedAt),
        ),
      )
      .run();
    if (rowsChanged(rotated) === 0) {
      return { status: 409, body: { error: "already-used" } };
    }
    await deps.db
      .update(connectCode)
      .set({ deliveredCredentialHash: credentialHash })
      .where(eq(connectCode.code, row.code))
      .run();
  }
  if (target.credentialHash !== null) {
    try {
      await deps.closeTunnel(target.subdomain);
    } catch {}
  }
  const serverUrl = serverUrlForLabel(target.subdomain, deps.serverUrlTemplate);
  return {
    status: 200,
    body: {
      status: "approved",
      credential,
      serverId: target.id,
      handle: target.subdomain,
      serverUrl,
      tunnelUrl: tunnelUrlForServerUrl(serverUrl),
    },
  };
}

export function normalizeUserCode(raw: string): string {
  const compact = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, "");
  return compact.length === 8
    ? `${compact.slice(0, 4)}-${compact.slice(4)}`
    : raw.trim().toUpperCase();
}

function labelSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function fitLabel(value: string): string {
  return value.slice(0, HANDLE_MAX_LENGTH).replace(/-+$/u, "");
}

export function suggestHandle(githubLogin: string | null): string {
  if (!githubLogin) return "";
  const suggestion = fitLabel(labelSlug(githubLogin));
  return validateLabel(suggestion) === null ? suggestion : "";
}

export function suggestServerLabel(handle: string, clientName: string): string {
  const slug = labelSlug(clientName);
  const suggestion = fitLabel(slug ? `${handle}-${slug}` : `${handle}-bb`);
  return validateLabel(suggestion) === null ? suggestion : "";
}

export interface LinkRequestSummary {
  userCode: string;
  clientName: string;
  requestedAt: number;
  location: string | null;
  expiresAt: number;
}

export type LinkRequestView =
  | { state: "invalid" }
  | { state: "expired" }
  | { state: "used" }
  | { state: "denied" }
  | { state: "approved"; serverUrl: string }
  | {
      state: "claim-handle";
      request: LinkRequestSummary;
      suggestedHandle: string;
      serverUrlTemplate: string;
    }
  | {
      state: "choose-server";
      request: LinkRequestSummary;
      handle: string;
      servers: ServerSummary[];
      maxServers: number;
      suggestedLabel: string;
      serverUrlTemplate: string;
    };

type LinkRow = typeof connectCode.$inferSelect;

async function findLinkRow(
  deps: Pick<Deps, "db">,
  rawCode: string,
): Promise<LinkRow | undefined> {
  const code = normalizeUserCode(rawCode);
  if (!code) return undefined;
  return deps.db
    .select()
    .from(connectCode)
    .where(
      and(eq(connectCode.code, code), eq(connectCode.purpose, LINK_PURPOSE)),
    )
    .get();
}

export async function getLinkRequestView(
  deps: Deps,
  userId: string,
  rawCode: string,
  maxServers: number,
  now: number = Date.now(),
): Promise<LinkRequestView> {
  const row = await findLinkRow(deps, rawCode);
  if (!row) return { state: "invalid" };
  if (row.approvedAt !== null && row.userId === userId && row.serverId) {
    const approved = await deps.db
      .select({ subdomain: server.subdomain })
      .from(server)
      .where(eq(server.id, row.serverId))
      .get();
    if (approved) {
      return {
        state: "approved",
        serverUrl: serverUrlForLabel(
          approved.subdomain,
          deps.serverUrlTemplate,
        ),
      };
    }
  }
  if (row.consumedAt !== null || row.approvedAt !== null) {
    return { state: "used" };
  }
  if (row.deniedAt !== null) return { state: "denied" };
  if (row.expiresAt.getTime() <= now) return { state: "expired" };

  const request: LinkRequestSummary = {
    userCode: row.code,
    clientName: row.clientName ?? "",
    requestedAt: row.createdAt.getTime(),
    location: row.requestLocation,
    expiresAt: row.expiresAt.getTime(),
  };
  const prof = await findProfile(deps.db, userId);
  if (!prof) {
    const account = await deps.db
      .select({ githubLogin: user.githubLogin })
      .from(user)
      .where(eq(user.id, userId))
      .get();
    return {
      state: "claim-handle",
      request,
      suggestedHandle: suggestHandle(account?.githubLogin ?? null),
      serverUrlTemplate: deps.serverUrlTemplate,
    };
  }
  const rows = await deps.db
    .select()
    .from(server)
    .where(eq(server.userId, userId))
    .all();
  const servers = rows
    .map((srv) =>
      toServerSummary(srv, prof.handle, deps.serverUrlTemplate, now),
    )
    .sort((a, b) =>
      a.isPrimary !== b.isPrimary
        ? a.isPrimary
          ? -1
          : 1
        : a.createdAt - b.createdAt,
    );
  return {
    state: "choose-server",
    request,
    handle: prof.handle,
    servers,
    maxServers,
    suggestedLabel: suggestServerLabel(prof.handle, request.clientName),
    serverUrlTemplate: deps.serverUrlTemplate,
  };
}

export type LinkApprovalTarget =
  | { kind: "new"; label: string }
  | { kind: "existing"; serverId: string }
  | { kind: "replace"; serverId: string; typedCode: string };

type LinkDecisionError =
  | "invalid"
  | "expired"
  | "used"
  | "denied"
  | "not-found"
  | "confirm-replace"
  | "code-mismatch";

export type LinkApprovalResult =
  | { ok: true; serverUrl: string }
  | { error: LinkDecisionError | CreateServerError };

function pendingLinkError(row: LinkRow, now: number): LinkDecisionError | null {
  if (row.consumedAt !== null || row.approvedAt !== null) return "used";
  if (row.deniedAt !== null) return "denied";
  if (row.expiresAt.getTime() <= now) return "expired";
  return null;
}

function pendingLinkCondition(code: string, now: number) {
  return and(
    eq(connectCode.code, code),
    eq(connectCode.purpose, LINK_PURPOSE),
    isNull(connectCode.approvedAt),
    isNull(connectCode.deniedAt),
    isNull(connectCode.consumedAt),
    gt(connectCode.expiresAt, new Date(now)),
  );
}

async function linkDecisionFailure(
  deps: Pick<Deps, "db">,
  code: string,
  now: number,
): Promise<LinkDecisionError> {
  const current = await findLinkRow(deps, code);
  return current ? (pendingLinkError(current, now) ?? "used") : "invalid";
}

export async function approveServerLink(
  deps: Deps,
  userId: string,
  rawCode: string,
  target: LinkApprovalTarget,
  now: number = Date.now(),
): Promise<LinkApprovalResult> {
  const row = await findLinkRow(deps, rawCode);
  if (!row) return { error: "invalid" };
  const pending = pendingLinkError(row, now);
  if (pending) return { error: pending };
  if (!(await findProfile(deps.db, userId))) return { error: "no-handle" };

  let serverId: string;
  let subdomain: string;
  let created = false;
  if (target.kind === "new") {
    const result = await createServer(deps, userId, target.label);
    if ("error" in result) return { error: result.error };
    serverId = result.server.id;
    subdomain = result.server.subdomain;
    created = true;
  } else {
    const existing = await deps.db
      .select({
        id: server.id,
        subdomain: server.subdomain,
        credentialHash: server.credentialHash,
        revokedAt: server.revokedAt,
      })
      .from(server)
      .where(and(eq(server.id, target.serverId), eq(server.userId, userId)))
      .get();
    if (!existing) return { error: "not-found" };
    const linked =
      existing.credentialHash !== null && existing.revokedAt === null;
    if (target.kind === "existing" && linked) {
      return { error: "confirm-replace" };
    }
    if (
      target.kind === "replace" &&
      normalizeUserCode(target.typedCode) !== row.code
    ) {
      return { error: "code-mismatch" };
    }
    serverId = existing.id;
    subdomain = existing.subdomain;
  }

  const approved = await deps.db
    .update(connectCode)
    .set({ userId, serverId, approvedAt: new Date(now) })
    .where(pendingLinkCondition(row.code, now))
    .run();
  if (rowsChanged(approved) === 0) {
    if (created) {
      await deps.db.delete(server).where(eq(server.id, serverId)).run();
    }
    return { error: await linkDecisionFailure(deps, row.code, now) };
  }
  return {
    ok: true,
    serverUrl: serverUrlForLabel(subdomain, deps.serverUrlTemplate),
  };
}

export async function denyServerLink(
  deps: Pick<Deps, "db">,
  rawCode: string,
  now: number = Date.now(),
): Promise<{ ok: true } | { error: LinkDecisionError }> {
  const row = await findLinkRow(deps, rawCode);
  if (!row) return { error: "invalid" };
  const denied = await deps.db
    .update(connectCode)
    .set({ deniedAt: new Date(now) })
    .where(pendingLinkCondition(row.code, now))
    .run();
  if (rowsChanged(denied) === 0) {
    return { error: await linkDecisionFailure(deps, row.code, now) };
  }
  return { ok: true };
}
