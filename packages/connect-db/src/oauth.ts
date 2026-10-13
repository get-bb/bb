import { parseVisitorHost } from "./constants.js";

export const MCP_PUBLIC_PATH = "/mcp";
export const MCP_PLUGIN_ID = "bb--mcp";
export const MCP_LOCAL_PATH = `/api/v1/plugins/${MCP_PLUGIN_ID}/http/mcp`;

export const OAUTH_PROTECTED_RESOURCE_METADATA_PATH =
  "/.well-known/oauth-protected-resource";
export const OAUTH_AUTHORIZATION_SERVER_METADATA_PATH =
  "/.well-known/oauth-authorization-server";
export const OAUTH_AUTHORIZE_PATH = "/oauth/authorize";
export const OAUTH_TOKEN_PATH = "/oauth/token";
export const OAUTH_REVOKE_PATH = "/oauth/revoke";

export const MCP_SCOPE = "bb";
export const MCP_SCOPES = [MCP_SCOPE] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export const OAUTH_CODE_TTL_MS = 60 * 1000;
export const OAUTH_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const OAUTH_REFRESH_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000;
export const OAUTH_REFRESH_REUSE_GRACE_MS = 60 * 1000;
export const OAUTH_ROTATED_REFRESH_RETENTION_MS = 24 * 60 * 60 * 1000;
export const OAUTH_REVOKED_GRANT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const OAUTH_MAX_GRANTS_PER_CLIENT = 10;

export const OAUTH_ACCESS_TOKEN_PREFIX = "bbmcp_";
export const OAUTH_REFRESH_TOKEN_PREFIX = "bbmcpr_";
export const OAUTH_CODE_PREFIX = "bbmcpc_";

const OAUTH_SECRET_BODY = "[A-Za-z0-9_-]{43}";
const OAUTH_REFRESH_TOKEN_PATTERN = new RegExp(
  `^${OAUTH_REFRESH_TOKEN_PREFIX}${OAUTH_SECRET_BODY}$`,
  "u",
);
const OAUTH_CODE_PATTERN = new RegExp(
  `^${OAUTH_CODE_PREFIX}${OAUTH_SECRET_BODY}$`,
  "u",
);

export function isWellFormedOAuthRefreshToken(value: string): boolean {
  return OAUTH_REFRESH_TOKEN_PATTERN.test(value);
}

export function isWellFormedOAuthCode(value: string): boolean {
  return OAUTH_CODE_PATTERN.test(value);
}

export const GATE_OAUTH_AUTH_KIND = "oauth";
export const GATE_OAUTH_SCOPE_HEADER = "x-bb-gate-oauth-scope";
export const GATE_OAUTH_CLIENT_HEADER = "x-bb-gate-oauth-client";
export const GATE_OAUTH_GRANT_HEADER = "x-bb-gate-oauth-grant";

const ACCESS_TOKEN_SIGNING_CONTEXT = "bb-mcp-access-token-v1";

export function parseMcpScopes(value: string | null | undefined): McpScope[] {
  if (!value) return [];
  const requested = new Set(value.split(/\s+/u).filter(Boolean));
  return MCP_SCOPES.filter((scope) => requested.has(scope));
}

export function formatMcpScopes(scopes: readonly McpScope[]): string {
  return MCP_SCOPES.filter((scope) => scopes.includes(scope)).join(" ");
}

export function mcpResourceForOrigin(origin: string): string {
  return `${origin}${MCP_PUBLIC_PATH}`;
}

export interface ParsedMcpResource {
  handle: string;
  resource: string;
}

export function parseMcpResource(
  value: string,
  options: { baseDomain: string; allowHttp: boolean },
): ParsedMcpResource | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" &&
    !(options.allowHttp && url.protocol === "http:")
  ) {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== MCP_PUBLIC_PATH) return null;
  const parsed = parseVisitorHost(url.hostname, options.baseDomain);
  if (parsed === null || parsed.target !== null) return null;
  return {
    handle: parsed.handle,
    resource: mcpResourceForOrigin(url.origin),
  };
}

export interface McpAccessTokenClaims {
  version: 1;
  userId: string;
  serverId: string;
  grantId: string;
  resource: string;
  scope: string;
  clientName: string;
  issuedAt: number;
  expiresAt: number;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) return null;
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  try {
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function accessTokenKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function signingInput(payload: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(
    `${ACCESS_TOKEN_SIGNING_CONTEXT}.${payload}`,
  );
  const bytes = new Uint8Array(new ArrayBuffer(encoded.length));
  bytes.set(encoded);
  return bytes;
}

export async function signMcpAccessToken(
  claims: McpAccessTokenClaims,
  secret: string,
): Promise<string> {
  const payload = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(claims)),
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    await accessTokenKey(secret),
    signingInput(payload),
  );
  return `${OAUTH_ACCESS_TOKEN_PREFIX}${payload}.${bytesToBase64Url(
    new Uint8Array(signature),
  )}`;
}

function parseAccessTokenClaims(value: unknown): McpAccessTokenClaims | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return null;
  const {
    userId,
    serverId,
    grantId,
    resource,
    scope,
    clientName,
    issuedAt,
    expiresAt,
  } = record;
  if (
    typeof userId !== "string" ||
    typeof serverId !== "string" ||
    typeof grantId !== "string" ||
    typeof resource !== "string" ||
    typeof scope !== "string" ||
    typeof clientName !== "string" ||
    typeof issuedAt !== "number" ||
    typeof expiresAt !== "number"
  ) {
    return null;
  }
  return {
    version: 1,
    userId,
    serverId,
    grantId,
    resource,
    scope,
    clientName,
    issuedAt,
    expiresAt,
  };
}

export async function verifyMcpAccessToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): Promise<McpAccessTokenClaims | null> {
  if (!token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) return null;
  const body = token.slice(OAUTH_ACCESS_TOKEN_PREFIX.length);
  const separator = body.indexOf(".");
  if (separator <= 0) return null;
  const payload = body.slice(0, separator);
  const signature = base64UrlToBytes(body.slice(separator + 1));
  const payloadBytes = base64UrlToBytes(payload);
  if (signature === null || payloadBytes === null) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await accessTokenKey(secret),
    signature,
    signingInput(payload),
  );
  if (!valid) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  const claims = parseAccessTokenClaims(parsed);
  if (claims === null || claims.expiresAt <= now) return null;
  return claims;
}
