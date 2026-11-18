import {
  MCP_LOCAL_PATH,
  MCP_SCOPES,
  OAUTH_PROTECTED_RESOURCE_METADATA_PATH,
  mcpResourceForOrigin,
} from "@bb/connect-db";
import { json, type Reply } from "./reply.js";

const MCP_CLIENT_NAME_HEADER_MAX_LENGTH = 80;
const MCP_PATH_DECODE_ROUNDS = 4;
const MCP_LOCAL_PATH_NORMALIZED = MCP_LOCAL_PATH.toLowerCase();
const MCP_PROTECTED_RESOURCE_METADATA_PATHS: ReadonlySet<string> = new Set([
  OAUTH_PROTECTED_RESOURCE_METADATA_PATH,
  `${OAUTH_PROTECTED_RESOURCE_METADATA_PATH}/mcp`,
]);

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

export function mcpProtectedResourceMetadataReply(
  origin: string,
  authorizationServer: string,
): Reply {
  return json(
    {
      resource: mcpResourceForOrigin(origin),
      authorization_servers: [authorizationServer],
      scopes_supported: [...MCP_SCOPES],
      bearer_methods_supported: ["header"],
      resource_name: "bb",
    },
    200,
    { "cache-control": "public, max-age=300" },
  );
}

export function mcpChallengeReply(
  origin: string,
  error: "invalid_token" | null,
): Reply {
  const parameters = [
    ...(error === null ? [] : [`error="${error}"`]),
    `resource_metadata="${origin}${OAUTH_PROTECTED_RESOURCE_METADATA_PATH}/mcp"`,
    `scope="${MCP_SCOPES.join(" ")}"`,
  ];
  return json({ error: "unauthorized" }, 401, {
    "cache-control": "no-store",
    "www-authenticate": `Bearer ${parameters.join(", ")}`,
  });
}

export function headerSafeClientName(value: string): string {
  const safe = value
    .replace(/[^\x20-\x7e]/gu, "?")
    .trim()
    .slice(0, MCP_CLIENT_NAME_HEADER_MAX_LENGTH)
    .trim();
  return safe === "" ? "unknown" : safe;
}

export function readBearerToken(
  authorization: string | undefined,
): string | null {
  const match = /^bearer(?:\s+(.*))?$/iu.exec((authorization ?? "").trim());
  if (match === null) return null;
  return (match[1] ?? "").trim();
}
