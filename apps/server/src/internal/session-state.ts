import { eq } from "drizzle-orm";
import { getSessionById, hostDaemonSessions } from "@bb/db";
import type { DbConnection, HostDaemonSessionRow } from "@bb/db";
import { ApiError } from "../errors.js";
import { getAuthenticatedDaemon } from "./auth.js";

type AuthenticatedDaemonContext = Parameters<typeof getAuthenticatedDaemon>[0];

export interface RequireAuthorizedActiveSessionArgs {
  hostId: string;
  sessionId: string;
}

export interface RequireAuthenticatedDaemonSessionArgs {
  context: AuthenticatedDaemonContext;
  db: DbConnection;
  sessionId: string;
}

export type InactiveSessionReason = "active" | "closed" | "missing";

export interface InactiveSessionLogFields {
  authenticatedHostId?: string;
  closeReason?: string | null;
  closedAt?: number | null;
  inactiveSessionReason: InactiveSessionReason;
  leaseExpiresAt?: number;
  leaseStaleByMs?: number;
  sessionHostId?: string;
  sessionId: string;
  sessionStatus?: string;
}

export interface GetInactiveSessionLogFieldsArgs {
  authenticatedHostId?: string;
  now: number;
  sessionId: string;
}

export function requireAuthorizedOpenSession(
  db: DbConnection,
  args: RequireAuthorizedActiveSessionArgs,
) {
  const session = getSessionById(db, { sessionId: args.sessionId });
  if (!session || session.status !== "active") {
    throw new ApiError(401, "inactive_session", "Session is not active");
  }
  if (session.hostId !== args.hostId) {
    throw new ApiError(
      403,
      "invalid_request",
      "Session does not belong to the authenticated host",
    );
  }

  return session;
}

export function requireAuthenticatedDaemonSession(
  args: RequireAuthenticatedDaemonSessionArgs,
): HostDaemonSessionRow {
  const daemon = getAuthenticatedDaemon(args.context);
  return requireAuthorizedOpenSession(args.db, {
    hostId: daemon.hostId,
    sessionId: args.sessionId,
  });
}

export function getInactiveSessionLogFields(
  db: DbConnection,
  args: GetInactiveSessionLogFieldsArgs,
): InactiveSessionLogFields {
  const session =
    db
      .select()
      .from(hostDaemonSessions)
      .where(eq(hostDaemonSessions.id, args.sessionId))
      .get() ?? null;

  if (!session) {
    return {
      authenticatedHostId: args.authenticatedHostId,
      inactiveSessionReason: "missing",
      sessionId: args.sessionId,
    };
  }

  if (session.status !== "active") {
    return {
      authenticatedHostId: args.authenticatedHostId,
      closeReason: session.closeReason,
      closedAt: session.closedAt,
      inactiveSessionReason: "closed",
      leaseExpiresAt: session.leaseExpiresAt,
      sessionHostId: session.hostId,
      sessionId: args.sessionId,
      sessionStatus: session.status,
    };
  }

  return {
    authenticatedHostId: args.authenticatedHostId,
    inactiveSessionReason: "active",
    leaseExpiresAt: session.leaseExpiresAt,
    ...(session.leaseExpiresAt <= args.now
      ? { leaseStaleByMs: args.now - session.leaseExpiresAt }
      : {}),
    sessionHostId: session.hostId,
    sessionId: args.sessionId,
    sessionStatus: session.status,
  };
}
