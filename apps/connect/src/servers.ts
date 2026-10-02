import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  SERVER_OFFLINE_AFTER_MS,
  isLive,
  schema,
  server,
  sha256Hex,
  tunnelConnectedLookup,
  type ConnectDb,
  type TunnelConnectedLookup,
} from "@bb/connect-db";
import {
  parseCookie,
  verifyMachineCredential,
  verifySessionCookieDetails,
} from "./session.js";
import {
  invalidateDesktopSessionGrant,
  issueDesktopSessionCookie,
  type DesktopSessionAccount,
} from "./desktop-session.js";
import { resolveConnectRuntime } from "./cloud-dev.js";
import { jsonResponse, methodNotAllowed } from "./json-response.js";
import { MACHINE_CREDENTIAL_HEADER } from "./protocol-headers.js";
import type { Env } from "./tunnel-do.js";

const serverCredentialCache = new Map<
  string,
  { value: string | null; expires: number }
>();
const SERVER_CRED_TTL_MS = 20_000;

export async function verifyServerCredential(
  credential: string,
  db: ConnectDb,
): Promise<string | null> {
  if (!credential) return null;
  const now = Date.now();
  const cached = serverCredentialCache.get(credential);
  if (cached && cached.expires > now) return cached.value;
  if (cached) serverCredentialCache.delete(credential);

  const hash = await sha256Hex(credential);
  const row = await db
    .select({ userId: server.userId })
    .from(server)
    .where(and(eq(server.credentialHash, hash), isNull(server.revokedAt)))
    .get();
  const userId = row?.userId ?? null;
  serverCredentialCache.set(credential, {
    value: userId,
    expires: now + SERVER_CRED_TTL_MS,
  });
  return userId;
}

export async function revokeServerCredential(
  credential: string,
  db: ConnectDb,
): Promise<{ subdomain: string } | null> {
  const presented = credential.trim();
  if (!presented) return null;

  const credentialHash = await sha256Hex(presented);
  const revoked = await db
    .update(server)
    .set({ credentialHash: null, revokedAt: new Date() })
    .where(
      and(eq(server.credentialHash, credentialHash), isNull(server.revokedAt)),
    )
    .returning({ subdomain: server.subdomain })
    .get();
  serverCredentialCache.delete(presented);
  invalidateDesktopSessionGrant({ kind: "server", credentialHash });
  return revoked ?? null;
}

export async function resolveAccount(
  request: Request,
  secret: string,
  db: ConnectDb,
  sessionCookieName: string,
): Promise<DesktopSessionAccount | null> {
  const presented = request.headers.get(MACHINE_CREDENTIAL_HEADER) ?? "";
  if (presented) {
    const machineUserId = await verifyMachineCredential(presented, db);
    if (machineUserId) {
      return {
        userId: machineUserId,
        grant: { kind: "machine", credentialHash: await sha256Hex(presented) },
      };
    }
    const serverUserId = await verifyServerCredential(presented, db);
    if (serverUserId) {
      return {
        userId: serverUserId,
        grant: { kind: "server", credentialHash: await sha256Hex(presented) },
      };
    }
  }

  const cookie = parseCookie(request.headers.get("cookie"), sessionCookieName);
  if (!cookie) return null;
  const verified = await verifySessionCookieDetails(cookie, secret, db);
  return verified
    ? {
        userId: verified.userId,
        grant: { kind: "session", sessionId: verified.sessionId },
      }
    : null;
}

interface AccountServerListing {
  handle: string;
  name: string;
  live: boolean;
}

export async function listAccountServers(
  db: ConnectDb,
  userId: string,
  now: number = Date.now(),
  tunnelConnected: TunnelConnectedLookup | null = null,
): Promise<AccountServerListing[]> {
  const rows = await db
    .select({
      subdomain: server.subdomain,
      name: server.name,
      lastSeenAt: server.lastSeenAt,
      credentialHash: server.credentialHash,
      revokedAt: server.revokedAt,
    })
    .from(server)
    .where(eq(server.userId, userId))
    .all();

  return Promise.all(
    rows.map(async (row) => {
      const handle = row.subdomain;
      const trimmed = row.name.trim();
      const name = trimmed.length > 0 ? trimmed : handle;
      const connected = row.credentialHash != null && row.revokedAt == null;
      const live =
        connected &&
        isLive({
          lastSeenMs: row.lastSeenAt?.getTime() ?? null,
          now,
          offlineAfterMs: SERVER_OFFLINE_AFTER_MS,
          tunnelConnected:
            tunnelConnected === null ? null : await tunnelConnected(handle),
        });
      return { handle, name, live };
    }),
  );
}

async function resolveRequestAccount(request: Request, env: Env) {
  const db = drizzle(env.DB, { schema });
  const runtime = resolveConnectRuntime(env);
  const account = await resolveAccount(
    request,
    env.BETTER_AUTH_SECRET,
    db,
    runtime.sessionCookieName,
  );
  return { account, db, runtime };
}

export async function handleListAccountServers(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "GET") {
    return methodNotAllowed("GET");
  }

  const { account, db } = await resolveRequestAccount(request, env);
  if (!account) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const servers = await listAccountServers(
    db,
    account.userId,
    Date.now(),
    tunnelConnectedLookup(env, env.TUNNEL_DO),
  );
  return jsonResponse({ servers }, 200);
}

export async function handleDisconnectServer(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowed("POST");
  }

  const db = drizzle(env.DB, { schema });
  const credential = request.headers.get(MACHINE_CREDENTIAL_HEADER) ?? "";
  const revoked = await revokeServerCredential(credential, db);
  if (!revoked) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const stub = env.TUNNEL_DO.get(env.TUNNEL_DO.idFromName(revoked.subdomain));
    await stub.fetch("https://tunnel/__control/close");
  } catch {}
  return Response.json({ ok: true });
}

export async function handleCreateDesktopSession(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowed("POST");
  }
  const { account, runtime } = await resolveRequestAccount(request, env);
  if (!account) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  const cookie = await issueDesktopSessionCookie(account, {
    baseDomain: env.BASE_DOMAIN,
    name: runtime.desktopSessionCookieName,
    secret: env.BETTER_AUTH_SECRET,
  });
  return jsonResponse({ cookie }, 200);
}
