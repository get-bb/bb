import { and, eq, isNull } from "drizzle-orm";
import {
  MCP_LOCAL_PATH,
  MCP_SCOPES,
  OAUTH_PROTECTED_RESOURCE_METADATA_PATH,
  type ConnectDb,
  formatMcpScopes,
  mcpResourceForOrigin,
  oauthGrant,
  parseMcpScopes,
  verifyMcpAccessToken,
} from "@bb/connect-db";
import { SettledLookupCache } from "./session.js";

export const MCP_GRANT_CACHE_TTL_MS = 30_000;
const MCP_CLIENT_NAME_HEADER_MAX_LENGTH = 80;

const MCP_PROTECTED_RESOURCE_METADATA_PATHS: ReadonlySet<string> = new Set([
  OAUTH_PROTECTED_RESOURCE_METADATA_PATH,
  `${OAUTH_PROTECTED_RESOURCE_METADATA_PATH}/mcp`,
]);
const MCP_PATH_DECODE_ROUNDS = 4;
const MCP_LOCAL_PATH_NORMALIZED = MCP_LOCAL_PATH.toLowerCase();

export interface McpForwardAuth {
  scope: string;
  grantId: string;
  clientName: string;
}

interface CachedGrant {
  userId: string;
  serverId: string;
  revokedAt: number | null;
  lastUsedAt: number | null;
}

const grantCache = new SettledLookupCache<CachedGrant | null>();

export function isMcpProtectedResourceMetadataPath(pathname: string): boolean {
  return MCP_PROTECTED_RESOURCE_METADATA_PATHS.has(pathname);
}

function decodePathOnce(value: string): string {
  return value.replace(/%([0-9a-f]{2})/giu, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

export function isMcpLocalPath(pathname: string): boolean {
  let decoded = pathname;
  for (let round = 0; round < MCP_PATH_DECODE_ROUNDS; round += 1) {
    const next = decodePathOnce(decoded);
    if (next === decoded) break;
    decoded = next;
  }
  const segments: string[] = [];
  for (const raw of decoded.toLowerCase().split(/[/\\]+/u)) {
    const segment = raw.replace(/;.*$/u, "").replace(/[\s\0]+/gu, "");
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const normalized = `/${segments.join("/")}`;
  return (
    normalized === MCP_LOCAL_PATH_NORMALIZED ||
    normalized.startsWith(`${MCP_LOCAL_PATH_NORMALIZED}/`)
  );
}

export function mcpProtectedResourceMetadataResponse(
  origin: string,
  authorizationServer: string,
): Response {
  return Response.json(
    {
      resource: mcpResourceForOrigin(origin),
      authorization_servers: [authorizationServer],
      scopes_supported: [...MCP_SCOPES],
      bearer_methods_supported: ["header"],
      resource_name: "bb",
    },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}

export function mcpChallengeResponse(
  origin: string,
  error: "invalid_token" | null,
): Response {
  const parameters = [
    ...(error === null ? [] : [`error="${error}"`]),
    `resource_metadata="${origin}${OAUTH_PROTECTED_RESOURCE_METADATA_PATH}/mcp"`,
    `scope="${MCP_SCOPES.join(" ")}"`,
  ];
  return Response.json(
    { error: "unauthorized" },
    {
      status: 401,
      headers: {
        "cache-control": "no-store",
        "www-authenticate": `Bearer ${parameters.join(", ")}`,
      },
    },
  );
}

export function headerSafeClientName(value: string): string {
  const safe = value
    .replace(/[^\x20-\x7e]/gu, "?")
    .trim()
    .slice(0, MCP_CLIENT_NAME_HEADER_MAX_LENGTH)
    .trim();
  return safe === "" ? "unknown" : safe;
}

export function readBearerToken(headers: Headers): string | null {
  const match = /^bearer(?:\s+(.*))?$/iu.exec(
    (headers.get("authorization") ?? "").trim(),
  );
  if (match === null) return null;
  return (match[1] ?? "").trim();
}

async function lookupGrant(
  grantId: string,
  db: ConnectDb,
): Promise<CachedGrant | null> {
  const row = await db
    .select({
      userId: oauthGrant.userId,
      serverId: oauthGrant.serverId,
      revokedAt: oauthGrant.revokedAt,
      lastUsedAt: oauthGrant.lastUsedAt,
    })
    .from(oauthGrant)
    .where(eq(oauthGrant.id, grantId))
    .get();
  if (!row) return null;
  return {
    userId: row.userId,
    serverId: row.serverId,
    revokedAt: row.revokedAt?.getTime() ?? null,
    lastUsedAt: row.lastUsedAt?.getTime() ?? null,
  };
}

async function writeGrantFirstUse(
  grantId: string,
  db: ConnectDb,
  now: number,
): Promise<void> {
  await db
    .update(oauthGrant)
    .set({ lastUsedAt: new Date(now) })
    .where(and(eq(oauthGrant.id, grantId), isNull(oauthGrant.lastUsedAt)))
    .run();
}

interface McpAuthorization {
  forward: McpForwardAuth;
  recordUse: (() => Promise<void>) | null;
}

export async function authorizeMcpToken(
  token: string,
  options: {
    origin: string;
    userId: string;
    server: { id: string; revokedAt: Date | null };
    secret: string;
    db: ConnectDb;
    now?: number;
  },
): Promise<McpAuthorization | null> {
  const now = options.now ?? Date.now();
  if (options.server.revokedAt != null) return null;
  const claims = await verifyMcpAccessToken(token, options.secret, now);
  if (claims === null) return null;
  if (claims.resource !== mcpResourceForOrigin(options.origin)) return null;
  if (claims.userId !== options.userId) return null;
  if (claims.serverId !== options.server.id) return null;
  const scope = formatMcpScopes(parseMcpScopes(claims.scope));
  if (scope === "") return null;
  const grant = await grantCache.read(claims.grantId, {
    now,
    expires: () => now + MCP_GRANT_CACHE_TTL_MS,
    load: () => lookupGrant(claims.grantId, options.db),
  });
  if (grant === null || grant.revokedAt !== null) return null;
  if (grant.userId !== claims.userId || grant.serverId !== claims.serverId) {
    return null;
  }
  let recordUse: McpAuthorization["recordUse"] = null;
  if (grant.lastUsedAt === null) {
    grant.lastUsedAt = now;
    recordUse = () => writeGrantFirstUse(claims.grantId, options.db, now);
  }
  return {
    forward: {
      scope,
      grantId: claims.grantId,
      clientName: headerSafeClientName(claims.clientName),
    },
    recordUse,
  };
}
