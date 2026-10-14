import { and, desc, eq, isNull, lt, ne, or } from "drizzle-orm";
import {
  type ConnectDb,
  MCP_SCOPE,
  MCP_SCOPES,
  OAUTH_ACCESS_TOKEN_TTL_MS,
  OAUTH_AUTHORIZE_PATH,
  OAUTH_CODE_PREFIX,
  OAUTH_CODE_TTL_MS,
  OAUTH_MAX_GRANTS_PER_CLIENT,
  OAUTH_REFRESH_REUSE_GRACE_MS,
  OAUTH_REFRESH_TOKEN_PREFIX,
  OAUTH_REFRESH_TOKEN_TTL_MS,
  OAUTH_REVOKE_PATH,
  OAUTH_REVOKED_GRANT_RETENTION_MS,
  OAUTH_TOKEN_PATH,
  auditLog,
  oauthCode,
  oauthGrant,
  oauthRefreshToken,
  parseMcpResource,
  parseMcpScopes,
  resolveServerCredential,
  rowsChanged,
  server,
  sha256Hex,
  signMcpAccessToken,
  verifyMcpAccessToken,
  OAUTH_ROTATED_REFRESH_RETENTION_MS,
  isWellFormedOAuthCode,
  isWellFormedOAuthRefreshToken,
} from "@bb/connect-db";
import type { Env } from "./env.js";

export const OAUTH_CLIENT_METADATA_MAX_BYTES = 5 * 1024;
export const OAUTH_CLIENT_METADATA_TIMEOUT_MS = 5_000;
export const OAUTH_CLIENT_NAME_MAX_LENGTH = 80;
export const OAUTH_AUDIT_ACTION_GRANT = "mcp.oauth.grant";
export const OAUTH_AUDIT_ACTION_REVOKE = "mcp.oauth.revoke";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);
const IPV4_LITERAL = /^\d+(\.\d+){3}$/u;
const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/u;
const INVISIBLE_CONTROL_CHARACTERS = /[\p{Cc}\p{Bidi_Control}]/gu;
const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";
const REFRESH_SUCCESSOR_CONTEXT = "bb-mcp-refresh-successor-v1";

export type OAuthEnv = Pick<
  Env,
  "APP_URL" | "BASE_DOMAIN" | "BETTER_AUTH_SECRET"
>;

export interface OAuthAuthorizeDeps {
  fetch?: typeof fetch;
  now?: () => number;
}

export interface OAuthConsentView {
  clientName: string;
  clientIdHost: string;
  redirectHost: string;
  loopbackRedirect: boolean;
  serverHandle: string;
  serverName: string;
}

export type OAuthAuthorizeResult =
  | { kind: "error-page"; message: string }
  | { kind: "consent"; consent: OAuthConsentView };

export type OAuthAuthorizeCompletion =
  | { kind: "redirect"; url: string }
  | { kind: "error-page"; message: string };

export interface OAuthGrantView {
  id: string;
  clientId: string;
  clientName: string;
  serverId: string;
  serverHandle: string;
  scope: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface OAuthClientMetadata {
  clientId: string;
  clientName: string;
  redirectUris: string[];
}

export type OAuthClientMetadataResult =
  | { ok: true; client: OAuthClientMetadata }
  | { ok: false; message: string };

export interface OAuthAuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint: string;
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  scopes_supported: string[];
  client_id_metadata_document_supported: boolean;
  authorization_response_iss_parameter_supported: boolean;
}

export function oauthIssuer(env: Pick<Env, "APP_URL">): string {
  return env.APP_URL.trim().replace(/\/+$/u, "");
}

function issuerAllowsHttp(issuer: string): boolean {
  return issuer.startsWith("http://");
}

export function oauthAuthorizationServerMetadata(
  env: Pick<Env, "APP_URL">,
): OAuthAuthorizationServerMetadata {
  const issuer = oauthIssuer(env);
  return {
    issuer,
    authorization_endpoint: `${issuer}${OAUTH_AUTHORIZE_PATH}`,
    token_endpoint: `${issuer}${OAUTH_TOKEN_PATH}`,
    revocation_endpoint: `${issuer}${OAUTH_REVOKE_PATH}`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...MCP_SCOPES],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

export function oauthAuthorizationServerMetadataResponse(
  env: Pick<Env, "APP_URL">,
): Response {
  return Response.json(oauthAuthorizationServerMetadata(env), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function randomSecret(prefix: string): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${prefix}${bytesToBase64Url(bytes)}`;
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLoopbackHttpUrl(url: URL): boolean {
  return url.protocol === "http:" && LOOPBACK_HOSTNAMES.has(url.hostname);
}

function isIpLiteralHost(hostname: string): boolean {
  return hostname.startsWith("[") || IPV4_LITERAL.test(hostname);
}

function isUsableRedirectUrl(url: URL): boolean {
  if (url.hash || url.username || url.password) return false;
  return url.protocol === "https:" || isLoopbackHttpUrl(url);
}

export function matchOAuthRedirectUri(
  requested: string,
  registered: readonly string[],
): boolean {
  const requestedUrl = parseUrl(requested);
  if (requestedUrl === null || !isUsableRedirectUrl(requestedUrl)) return false;
  if (requested.includes("#")) return false;
  if (!isLoopbackHttpUrl(requestedUrl)) return registered.includes(requested);
  return registered.some((candidate) => {
    const candidateUrl = parseUrl(candidate);
    return (
      candidateUrl !== null &&
      !candidate.includes("#") &&
      isUsableRedirectUrl(candidateUrl) &&
      isLoopbackHttpUrl(candidateUrl) &&
      candidateUrl.hostname === requestedUrl.hostname &&
      candidateUrl.pathname === requestedUrl.pathname &&
      candidateUrl.search === requestedUrl.search
    );
  });
}

function clientIdProblem(clientId: string, allowHttp: boolean): string | null {
  const url = parseUrl(clientId);
  if (url === null) return "client_id is not a URL";
  const loopback = LOOPBACK_HOSTNAMES.has(url.hostname);
  if (url.protocol === "http:") {
    if (!allowHttp || !loopback) return "client_id must be an https URL";
  } else if (url.protocol !== "https:") {
    return "client_id must be an https URL";
  }
  if (url.username || url.password) {
    return "client_id must not contain credentials";
  }
  if (clientId.includes("#")) return "client_id must not contain a fragment";
  if (url.pathname === "/" || url.pathname === "") {
    return "client_id must have a path";
  }
  if (!allowHttp && (loopback || isIpLiteralHost(url.hostname))) {
    return "client_id host is not allowed";
  }
  return null;
}

async function readLimitedText(
  response: Response,
  maxBytes: number,
): Promise<string | null> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function isJsonContentType(value: string | null): boolean {
  const mediaType = value?.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    mediaType === "application/json" ||
    (mediaType.startsWith("application/") && mediaType.endsWith("+json"))
  );
}

function parseClientMetadataDocument(
  clientId: string,
  text: string,
): OAuthClientMetadataResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: "client metadata is not valid JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: "client metadata is not a JSON object" };
  }
  const document: Record<string, unknown> = Object.fromEntries(
    Object.entries(parsed),
  );
  if (document.client_id !== clientId) {
    return {
      ok: false,
      message: "client metadata client_id does not match its URL",
    };
  }
  const clientName =
    typeof document.client_name === "string"
      ? document.client_name
          .replace(INVISIBLE_CONTROL_CHARACTERS, "")
          .trim()
          .slice(0, OAUTH_CLIENT_NAME_MAX_LENGTH)
          .trim()
      : "";
  if (!clientName) {
    return { ok: false, message: "client metadata has no client_name" };
  }
  const redirectUris = document.redirect_uris;
  if (
    !Array.isArray(redirectUris) ||
    redirectUris.length === 0 ||
    !redirectUris.every((uri): uri is string => typeof uri === "string")
  ) {
    return { ok: false, message: "client metadata has no redirect_uris" };
  }
  if (
    document.token_endpoint_auth_method !== undefined &&
    document.token_endpoint_auth_method !== "none"
  ) {
    return {
      ok: false,
      message:
        "only public clients (token_endpoint_auth_method none) are supported",
    };
  }
  return { ok: true, client: { clientId, clientName, redirectUris } };
}

export async function fetchOAuthClientMetadata(
  clientId: string,
  options: { allowHttp: boolean; fetch?: typeof fetch },
): Promise<OAuthClientMetadataResult> {
  const problem = clientIdProblem(clientId, options.allowHttp);
  if (problem !== null) return { ok: false, message: problem };
  const fetchImpl = options.fetch ?? fetch;
  try {
    const response = await fetchImpl(clientId, {
      method: "GET",
      redirect: "manual",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(OAUTH_CLIENT_METADATA_TIMEOUT_MS),
    });
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        message: "client metadata document could not be fetched",
      };
    }
    if (!isJsonContentType(response.headers.get("content-type"))) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, message: "client metadata document is not JSON" };
    }
    const text = await readLimitedText(
      response,
      OAUTH_CLIENT_METADATA_MAX_BYTES,
    );
    if (text === null) {
      return { ok: false, message: "client metadata document is too large" };
    }
    return parseClientMetadataDocument(clientId, text);
  } catch {
    return {
      ok: false,
      message: "client metadata document could not be fetched",
    };
  }
}

type ServerRow = typeof server.$inferSelect;

interface ValidAuthorization {
  kind: "valid";
  issuer: string;
  client: OAuthClientMetadata;
  redirectUri: string;
  state: string | null;
  server: ServerRow;
  resource: string;
  codeChallenge: string;
}

function singleParam(params: URLSearchParams, name: string): string | null {
  const values = params.getAll(name);
  return values.length === 1 ? (values[0] ?? null) : null;
}

function authorizationRedirect(
  redirectUri: string,
  issuer: string,
  state: string | null,
  values: Record<string, string>,
): { kind: "redirect"; url: string } {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(values)) {
    url.searchParams.set(name, value);
  }
  if (state !== null) url.searchParams.set("state", state);
  url.searchParams.set("iss", issuer);
  return { kind: "redirect", url: url.toString() };
}

async function validateAuthorization(
  env: OAuthEnv,
  db: ConnectDb,
  userId: string,
  params: URLSearchParams,
  deps: OAuthAuthorizeDeps,
): Promise<ValidAuthorization | { kind: "error-page"; message: string }> {
  const issuer = oauthIssuer(env);
  const allowHttp = issuerAllowsHttp(issuer);
  const clientId = singleParam(params, "client_id");
  if (!clientId) {
    return { kind: "error-page", message: "client_id is missing or repeated" };
  }
  const metadata = await fetchOAuthClientMetadata(clientId, {
    allowHttp,
    fetch: deps.fetch,
  });
  if (!metadata.ok) return { kind: "error-page", message: metadata.message };
  const client = metadata.client;
  const redirectUri = singleParam(params, "redirect_uri");
  if (!redirectUri) {
    return {
      kind: "error-page",
      message: "redirect_uri is missing or repeated",
    };
  }
  if (!matchOAuthRedirectUri(redirectUri, client.redirectUris)) {
    return {
      kind: "error-page",
      message: "redirect_uri is not registered for this client",
    };
  }
  const state = params.get("state");
  const fail = (
    error: string,
    description: string,
  ): { kind: "error-page"; message: string } => ({
    kind: "error-page",
    message: `${description} (${error})`,
  });

  if (params.get("response_type") !== "code") {
    return fail("unsupported_response_type", "response_type must be code");
  }
  const codeChallenge = singleParam(params, "code_challenge");
  if (
    codeChallenge === null ||
    !CODE_CHALLENGE_PATTERN.test(codeChallenge) ||
    params.get("code_challenge_method") !== "S256"
  ) {
    return fail("invalid_request", "an S256 PKCE code_challenge is required");
  }
  const rawResource = singleParam(params, "resource");
  const parsedResource =
    rawResource === null
      ? null
      : parseMcpResource(rawResource, {
          baseDomain: env.BASE_DOMAIN,
          allowHttp,
        });
  if (parsedResource === null) {
    return fail("invalid_target", "resource must be a bb server MCP URL");
  }
  const target = await db
    .select()
    .from(server)
    .where(
      and(
        eq(server.subdomain, parsedResource.handle),
        eq(server.userId, userId),
        isNull(server.revokedAt),
      ),
    )
    .get();
  if (!target) {
    return fail(
      "invalid_target",
      "resource is not a bb server owned by this account",
    );
  }
  const rawScope = params.get("scope");
  if (
    rawScope !== null &&
    rawScope.trim() !== "" &&
    parseMcpScopes(rawScope).length === 0
  ) {
    return fail("invalid_scope", "no supported scope was requested");
  }
  return {
    kind: "valid",
    issuer,
    client,
    redirectUri,
    state,
    server: target,
    resource: parsedResource.resource,
    codeChallenge,
  };
}

export async function prepareOAuthAuthorization(
  env: OAuthEnv,
  db: ConnectDb,
  userId: string,
  params: URLSearchParams,
  deps: OAuthAuthorizeDeps = {},
): Promise<OAuthAuthorizeResult> {
  const validated = await validateAuthorization(env, db, userId, params, deps);
  if (validated.kind !== "valid") return validated;
  const redirectUrl = new URL(validated.redirectUri);
  return {
    kind: "consent",
    consent: {
      clientName: validated.client.clientName,
      clientIdHost: new URL(validated.client.clientId).host,
      redirectHost: redirectUrl.host,
      loopbackRedirect: isLoopbackHttpUrl(redirectUrl),
      serverHandle: validated.server.subdomain,
      serverName: validated.server.name,
    },
  };
}

export async function completeOAuthAuthorization(
  env: OAuthEnv,
  db: ConnectDb,
  userId: string,
  params: URLSearchParams,
  decision: { approved: boolean },
  deps: OAuthAuthorizeDeps = {},
): Promise<OAuthAuthorizeCompletion> {
  const validated = await validateAuthorization(env, db, userId, params, deps);
  if (validated.kind !== "valid") return validated;
  if (!decision.approved) {
    return authorizationRedirect(
      validated.redirectUri,
      validated.issuer,
      validated.state,
      {
        error: "access_denied",
        error_description: "the user denied the request",
      },
    );
  }
  const now = (deps.now ?? Date.now)();
  const code = randomSecret(OAUTH_CODE_PREFIX);
  await db
    .delete(oauthCode)
    .where(lt(oauthCode.expiresAt, new Date(now)))
    .run();
  await db
    .insert(oauthCode)
    .values({
      codeHash: await sha256Hex(code),
      userId,
      serverId: validated.server.id,
      clientId: validated.client.clientId,
      clientName: validated.client.clientName,
      redirectUri: validated.redirectUri,
      resource: validated.resource,
      scope: MCP_SCOPE,
      codeChallenge: validated.codeChallenge,
      expiresAt: new Date(now + OAUTH_CODE_TTL_MS),
      createdAt: new Date(now),
    })
    .run();
  return authorizationRedirect(
    validated.redirectUri,
    validated.issuer,
    validated.state,
    { code },
  );
}

type OAuthRevokeReason = "user" | "client" | "server" | "superseded" | "reuse";

async function writeAudit(
  db: ConnectDb,
  userId: string,
  action: string,
  detail: Record<string, string>,
  now: number,
): Promise<void> {
  await db
    .insert(auditLog)
    .values({
      id: crypto.randomUUID(),
      userId,
      action,
      detail: JSON.stringify(detail),
      createdAt: new Date(now),
    })
    .run();
}

async function revokeGrantRow(
  db: ConnectDb,
  grant: { id: string; userId: string; serverId: string; clientId: string },
  reason: OAuthRevokeReason,
  now: number,
): Promise<boolean> {
  const revoked = await db
    .update(oauthGrant)
    .set({ revokedAt: new Date(now) })
    .where(and(eq(oauthGrant.id, grant.id), isNull(oauthGrant.revokedAt)))
    .run();
  if (rowsChanged(revoked) === 0) return false;
  await db
    .delete(oauthRefreshToken)
    .where(eq(oauthRefreshToken.grantId, grant.id))
    .run();
  await writeAudit(
    db,
    grant.userId,
    OAUTH_AUDIT_ACTION_REVOKE,
    {
      grantId: grant.id,
      serverId: grant.serverId,
      clientId: grant.clientId,
      reason,
    },
    now,
  );
  return true;
}

const grantViewColumns = {
  id: oauthGrant.id,
  clientId: oauthGrant.clientId,
  clientName: oauthGrant.clientName,
  serverId: oauthGrant.serverId,
  serverHandle: server.subdomain,
  scope: oauthGrant.scope,
  createdAt: oauthGrant.createdAt,
  lastUsedAt: oauthGrant.lastUsedAt,
};

function toGrantView(row: {
  id: string;
  clientId: string;
  clientName: string;
  serverId: string;
  serverHandle: string;
  scope: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}): OAuthGrantView {
  return {
    ...row,
    createdAt: row.createdAt.getTime(),
    lastUsedAt: row.lastUsedAt?.getTime() ?? null,
  };
}

export async function listOAuthGrantsForUser(
  db: ConnectDb,
  userId: string,
): Promise<OAuthGrantView[]> {
  const rows = await db
    .select(grantViewColumns)
    .from(oauthGrant)
    .innerJoin(server, eq(server.id, oauthGrant.serverId))
    .where(and(eq(oauthGrant.userId, userId), isNull(oauthGrant.revokedAt)))
    .orderBy(desc(oauthGrant.createdAt))
    .all();
  return rows.map(toGrantView);
}

export async function revokeOAuthGrantForUser(
  db: ConnectDb,
  userId: string,
  grantId: string,
): Promise<boolean> {
  const grant = await db
    .select()
    .from(oauthGrant)
    .where(and(eq(oauthGrant.id, grantId), eq(oauthGrant.userId, userId)))
    .get();
  if (!grant) return false;
  return revokeGrantRow(db, grant, "user", Date.now());
}

type CredentialResult<T> =
  | { status: 200; body: T }
  | { status: 401; body: { error: "unauthorized" } }
  | { status: 400; body: { error: "invalid-request" } };

export async function listOAuthGrantsForCredential(
  db: ConnectDb,
  credential: string,
): Promise<CredentialResult<{ grants: OAuthGrantView[] }>> {
  const resolved = await resolveServerCredential(db, credential);
  if (!resolved) return { status: 401, body: { error: "unauthorized" } };
  const rows = await db
    .select(grantViewColumns)
    .from(oauthGrant)
    .innerJoin(server, eq(server.id, oauthGrant.serverId))
    .where(
      and(
        eq(oauthGrant.serverId, resolved.server.id),
        eq(oauthGrant.userId, resolved.userId),
        isNull(oauthGrant.revokedAt),
      ),
    )
    .orderBy(desc(oauthGrant.createdAt))
    .all();
  return { status: 200, body: { grants: rows.map(toGrantView) } };
}

export async function revokeOAuthGrantForCredential(
  db: ConnectDb,
  credential: string,
  input: { grantId: unknown },
  deps: Pick<OAuthAuthorizeDeps, "now"> = {},
): Promise<CredentialResult<{ revoked: boolean }>> {
  const resolved = await resolveServerCredential(db, credential);
  if (!resolved) return { status: 401, body: { error: "unauthorized" } };
  if (typeof input.grantId !== "string" || input.grantId === "") {
    return { status: 400, body: { error: "invalid-request" } };
  }
  const grant = await db
    .select()
    .from(oauthGrant)
    .where(
      and(
        eq(oauthGrant.id, input.grantId),
        eq(oauthGrant.serverId, resolved.server.id),
        eq(oauthGrant.userId, resolved.userId),
      ),
    )
    .get();
  if (!grant) return { status: 200, body: { revoked: false } };
  const revoked = await revokeGrantRow(
    db,
    grant,
    "server",
    (deps.now ?? Date.now)(),
  );
  return { status: 200, body: { revoked } };
}

type OAuthTokenErrorCode =
  | "invalid_request"
  | "invalid_grant"
  | "unsupported_grant_type";

function tokenJson(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}

function tokenError(error: OAuthTokenErrorCode, description: string): Response {
  return tokenJson({ error, error_description: description }, 400);
}

async function readForm(request: Request): Promise<URLSearchParams | null> {
  const mediaType =
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ??
    "";
  if (mediaType !== FORM_CONTENT_TYPE) return null;
  return new URLSearchParams(await request.text());
}

type GrantRow = typeof oauthGrant.$inferSelect;

async function activeServerForGrant(
  db: ConnectDb,
  serverId: string,
  userId: string,
): Promise<boolean> {
  const row = await db
    .select({ id: server.id })
    .from(server)
    .where(
      and(
        eq(server.id, serverId),
        eq(server.userId, userId),
        isNull(server.revokedAt),
      ),
    )
    .get();
  return row !== undefined;
}

function resourceMatches(
  env: OAuthEnv,
  presented: string | null,
  stored: string,
): boolean {
  if (presented === null) return true;
  const parsed = parseMcpResource(presented, {
    baseDomain: env.BASE_DOMAIN,
    allowHttp: issuerAllowsHttp(oauthIssuer(env)),
  });
  return parsed !== null && parsed.resource === stored;
}

async function insertRefreshToken(
  db: ConnectDb,
  grantId: string,
  tokenHash: string,
  now: number,
): Promise<void> {
  await db
    .insert(oauthRefreshToken)
    .values({
      tokenHash,
      grantId,
      expiresAt: new Date(now + OAUTH_REFRESH_TOKEN_TTL_MS),
      createdAt: new Date(now),
    })
    .run();
}

async function tokenResponse(
  env: OAuthEnv,
  grant: Pick<
    GrantRow,
    "id" | "userId" | "serverId" | "resource" | "scope" | "clientName"
  >,
  refreshToken: string,
  now: number,
): Promise<Response> {
  const accessToken = await signMcpAccessToken(
    {
      version: 1,
      userId: grant.userId,
      serverId: grant.serverId,
      grantId: grant.id,
      resource: grant.resource,
      scope: grant.scope,
      clientName: grant.clientName,
      issuedAt: now,
      expiresAt: now + OAUTH_ACCESS_TOKEN_TTL_MS,
    },
    env.BETTER_AUTH_SECRET,
  );
  return tokenJson(
    {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: Math.floor(OAUTH_ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: refreshToken,
      scope: grant.scope,
    },
    200,
  );
}

async function trimGrantsForClient(
  db: ConnectDb,
  grant: Pick<GrantRow, "id" | "userId" | "serverId" | "clientId">,
  now: number,
): Promise<void> {
  const excess = await db
    .select()
    .from(oauthGrant)
    .where(
      and(
        eq(oauthGrant.userId, grant.userId),
        eq(oauthGrant.serverId, grant.serverId),
        eq(oauthGrant.clientId, grant.clientId),
        isNull(oauthGrant.revokedAt),
        ne(oauthGrant.id, grant.id),
      ),
    )
    .orderBy(desc(oauthGrant.createdAt), desc(oauthGrant.id))
    .limit(OAUTH_MAX_GRANTS_PER_CLIENT)
    .offset(OAUTH_MAX_GRANTS_PER_CLIENT - 1)
    .all();
  for (const earlier of excess) {
    await revokeGrantRow(db, earlier, "superseded", now);
  }
  await db
    .delete(oauthGrant)
    .where(
      and(
        eq(oauthGrant.userId, grant.userId),
        lt(
          oauthGrant.revokedAt,
          new Date(now - OAUTH_REVOKED_GRANT_RETENTION_MS),
        ),
      ),
    )
    .run();
}

async function exchangeAuthorizationCode(
  env: OAuthEnv,
  db: ConnectDb,
  form: URLSearchParams,
  now: number,
): Promise<Response> {
  const code = form.get("code");
  const clientId = form.get("client_id");
  const redirectUri = form.get("redirect_uri");
  const codeVerifier = form.get("code_verifier");
  if (!code || !clientId || !codeVerifier) {
    return tokenError(
      "invalid_request",
      "code, client_id and code_verifier are required",
    );
  }
  const invalid = () =>
    tokenError("invalid_grant", "authorization code is invalid or expired");
  if (!isWellFormedOAuthCode(code)) return invalid();
  const codeHash = await sha256Hex(code);
  const known = await db
    .select({ codeHash: oauthCode.codeHash })
    .from(oauthCode)
    .where(eq(oauthCode.codeHash, codeHash))
    .get();
  if (!known) return invalid();
  const consumed = await db
    .delete(oauthCode)
    .where(eq(oauthCode.codeHash, codeHash))
    .returning()
    .all();
  const row = consumed[0];
  if (!row) return invalid();
  if (row.expiresAt.getTime() <= now) return invalid();
  if (row.clientId !== clientId) return invalid();
  if (redirectUri !== null && redirectUri !== row.redirectUri) return invalid();
  if (!resourceMatches(env, form.get("resource"), row.resource)) {
    return invalid();
  }
  if (
    !CODE_VERIFIER_PATTERN.test(codeVerifier) ||
    (await pkceChallenge(codeVerifier)) !== row.codeChallenge
  ) {
    return invalid();
  }
  if (!(await activeServerForGrant(db, row.serverId, row.userId))) {
    return invalid();
  }
  const grant = {
    id: crypto.randomUUID(),
    userId: row.userId,
    serverId: row.serverId,
    clientId: row.clientId,
    clientName: row.clientName,
    resource: row.resource,
    scope: row.scope,
    createdAt: new Date(now),
  };
  await db.insert(oauthGrant).values(grant).run();
  await writeAudit(
    db,
    grant.userId,
    OAUTH_AUDIT_ACTION_GRANT,
    {
      grantId: grant.id,
      serverId: grant.serverId,
      clientId: grant.clientId,
      scope: grant.scope,
    },
    now,
  );
  const refreshToken = randomSecret(OAUTH_REFRESH_TOKEN_PREFIX);
  await insertRefreshToken(db, grant.id, await sha256Hex(refreshToken), now);
  await trimGrantsForClient(db, grant, now);
  return tokenResponse(env, grant, refreshToken, now);
}

type RefreshTokenRow = typeof oauthRefreshToken.$inferSelect;

type RefreshRotation =
  | { outcome: "rotated"; refreshToken: string }
  | { outcome: "reuse" };

async function successorRefreshToken(
  secret: string,
  presentedToken: string,
): Promise<string> {
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
    new TextEncoder().encode(`${REFRESH_SUCCESSOR_CONTEXT}.${presentedToken}`),
  );
  return `${OAUTH_REFRESH_TOKEN_PREFIX}${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function rotateRefreshToken(
  env: OAuthEnv,
  db: ConnectDb,
  presentedToken: string,
  presented: RefreshTokenRow,
  now: number,
): Promise<RefreshRotation> {
  if (
    presented.rotatedAt !== null &&
    now - presented.rotatedAt.getTime() > OAUTH_REFRESH_REUSE_GRACE_MS
  ) {
    return { outcome: "reuse" };
  }
  const refreshToken = await successorRefreshToken(
    env.BETTER_AUTH_SECRET,
    presentedToken,
  );
  await db
    .insert(oauthRefreshToken)
    .values({
      tokenHash: await sha256Hex(refreshToken),
      grantId: presented.grantId,
      expiresAt: new Date(now + OAUTH_REFRESH_TOKEN_TTL_MS),
      createdAt: new Date(now),
    })
    .onConflictDoNothing()
    .run();
  if (presented.rotatedAt === null) {
    await db
      .update(oauthRefreshToken)
      .set({ rotatedAt: new Date(now) })
      .where(
        and(
          eq(oauthRefreshToken.tokenHash, presented.tokenHash),
          isNull(oauthRefreshToken.rotatedAt),
        ),
      )
      .run();
  }
  return { outcome: "rotated", refreshToken };
}

async function exchangeRefreshToken(
  env: OAuthEnv,
  db: ConnectDb,
  form: URLSearchParams,
  now: number,
): Promise<Response> {
  const refreshToken = form.get("refresh_token");
  const clientId = form.get("client_id");
  if (!refreshToken || !clientId) {
    return tokenError(
      "invalid_request",
      "refresh_token and client_id are required",
    );
  }
  const invalid = () =>
    tokenError("invalid_grant", "refresh token is invalid or expired");
  if (!isWellFormedOAuthRefreshToken(refreshToken)) return invalid();
  const tokenHash = await sha256Hex(refreshToken);
  const row = await db
    .select({ token: oauthRefreshToken, grant: oauthGrant })
    .from(oauthRefreshToken)
    .innerJoin(oauthGrant, eq(oauthGrant.id, oauthRefreshToken.grantId))
    .where(eq(oauthRefreshToken.tokenHash, tokenHash))
    .get();
  if (!row) return invalid();
  const { token, grant } = row;
  if (token.expiresAt.getTime() <= now) return invalid();
  if (grant.revokedAt !== null || grant.clientId !== clientId) return invalid();
  if (!resourceMatches(env, form.get("resource"), grant.resource)) {
    return invalid();
  }
  if (!(await activeServerForGrant(db, grant.serverId, grant.userId))) {
    return invalid();
  }
  const rotation = await rotateRefreshToken(env, db, refreshToken, token, now);
  if (rotation.outcome === "reuse") {
    if (!(await revokeGrantRow(db, grant, "reuse", now))) {
      await db
        .delete(oauthRefreshToken)
        .where(eq(oauthRefreshToken.grantId, grant.id))
        .run();
    }
    return invalid();
  }
  await db
    .delete(oauthRefreshToken)
    .where(
      and(
        eq(oauthRefreshToken.grantId, grant.id),
        or(
          lt(oauthRefreshToken.expiresAt, new Date(now)),
          lt(
            oauthRefreshToken.rotatedAt,
            new Date(now - OAUTH_ROTATED_REFRESH_RETENTION_MS),
          ),
        ),
      ),
    )
    .run();
  await db
    .update(oauthGrant)
    .set({ lastUsedAt: new Date(now) })
    .where(eq(oauthGrant.id, grant.id))
    .run();
  return tokenResponse(env, grant, rotation.refreshToken, now);
}

export async function handleOAuthTokenRequest(
  env: OAuthEnv,
  db: ConnectDb,
  request: Request,
  deps: Pick<OAuthAuthorizeDeps, "now"> = {},
): Promise<Response> {
  const form = await readForm(request);
  if (form === null) {
    return tokenError(
      "invalid_request",
      `request body must be ${FORM_CONTENT_TYPE}`,
    );
  }
  const now = (deps.now ?? Date.now)();
  const grantType = form.get("grant_type");
  if (grantType === "authorization_code") {
    return exchangeAuthorizationCode(env, db, form, now);
  }
  if (grantType === "refresh_token") {
    return exchangeRefreshToken(env, db, form, now);
  }
  return tokenError(
    "unsupported_grant_type",
    "grant_type must be authorization_code or refresh_token",
  );
}

async function grantForPresentedToken(
  env: OAuthEnv,
  db: ConnectDb,
  token: string,
  now: number,
): Promise<GrantRow | undefined> {
  if (token.startsWith(OAUTH_REFRESH_TOKEN_PREFIX)) {
    if (!isWellFormedOAuthRefreshToken(token)) return undefined;
    const row = await db
      .select({ grant: oauthGrant })
      .from(oauthRefreshToken)
      .innerJoin(oauthGrant, eq(oauthGrant.id, oauthRefreshToken.grantId))
      .where(eq(oauthRefreshToken.tokenHash, await sha256Hex(token)))
      .get();
    return row?.grant;
  }
  const claims = await verifyMcpAccessToken(token, env.BETTER_AUTH_SECRET, now);
  if (claims === null) return undefined;
  return db
    .select()
    .from(oauthGrant)
    .where(eq(oauthGrant.id, claims.grantId))
    .get();
}

export async function handleOAuthRevokeRequest(
  env: OAuthEnv,
  db: ConnectDb,
  request: Request,
  deps: Pick<OAuthAuthorizeDeps, "now"> = {},
): Promise<Response> {
  const done = () =>
    new Response(null, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  const form = await readForm(request).catch(() => null);
  const token = form?.get("token");
  if (!token) return done();
  const now = (deps.now ?? Date.now)();
  const grant = await grantForPresentedToken(env, db, token, now);
  if (grant) await revokeGrantRow(db, grant, "client", now);
  return done();
}
