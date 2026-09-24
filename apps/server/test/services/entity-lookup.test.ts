import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  closeSession,
  createConnection,
  createEnvironment,
  createProject,
  createThread,
  hostDaemonSessions,
  migrate,
  markProjectDeleted,
  noopNotifier,
  openSession,
  updateHost,
  upsertHost,
  type DbConnection,
} from "@bb/db";
import type { Host, Project } from "@bb/domain";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { HOST_RECONNECT_GRACE_MS } from "../../src/constants.js";
import { ApiError } from "../../src/errors.js";
import { NotificationHub } from "../../src/ws/hub.js";
import {
  listPublicHostsWithStatus,
  requireConnectedHostSession,
  requireNonDestroyedHostWithStatus,
  requirePublicProject,
  requireReadyEnvironment,
  requireThreadEnvironment,
} from "../../src/services/lib/entity-lookup.js";

interface SetupResult {
  db: DbConnection;
  host: Host;
  hub: NotificationHub;
  project: Project;
}

type ThrowingCallback = () => void;

function setup(): SetupResult {
  const db = createConnection(":memory:");
  migrate(db);
  const hub = new NotificationHub();
  const hostRow = upsertHost(db, noopNotifier, {
    id: "host_entity_lookup",
    name: "Entity Lookup Host",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "Entity Lookup Project",
    source: {
      type: "local_path",
      hostId: hostRow.id,
      path: "/tmp/entity-lookup",
    },
  });
  const host = makeHost({
    id: hostRow.id,
    name: hostRow.name,
    status: "disconnected",
    maxPermissionMode: hostRow.maxPermissionMode,
    lastSeenAt: hostRow.lastSeenAt,
    createdAt: hostRow.createdAt,
    updatedAt: hostRow.updatedAt,
  });
  return { db, host, hub, project };
}

function openTestSession(db: DbConnection, hostId: string) {
  return openSession(db, {
    hostId,
    instanceId: "instance-entity-lookup",
    hostName: "Entity Lookup Host",
    dataDir: "/tmp/entity-lookup-data",
    protocolVersion: 1,
    heartbeatIntervalMs: 5_000,
    leaseTimeoutMs: 30_000,
  });
}

function closeTestSession(
  db: DbConnection,
  args: {
    closeReason: "daemon-disconnect" | "expired";
    closedAt: number;
    sessionId: string;
  },
): void {
  closeSession(db, noopNotifier, args.sessionId, args.closeReason);
  db.update(hostDaemonSessions)
    .set({ closedAt: args.closedAt })
    .where(eq(hostDaemonSessions.id, args.sessionId))
    .run();
}

function captureApiError(callback: ThrowingCallback): ApiError {
  try {
    callback();
  } catch (error) {
    if (error instanceof ApiError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected ApiError");
}

describe("entity lookup lifecycle errors", () => {
  it("returns structured environment_not_ready details", () => {
    const { db, host, project } = setup();
    try {
      const environment = createEnvironment(db, noopNotifier, {
        providerOwnsPath: false,
        hostId: host.id,
        projectId: project.id,
        environmentProvider: {
          environmentProviderId: "git-worktree",
          instanceKey: null,
          selection: {
            machine: { type: "existing", hostId: host.id },
            inputs: null,
          },
        },
        path: null,
        status: "destroyed",
      });

      const error = captureApiError(() => {
        requireReadyEnvironment(db, environment.id);
      });

      expect(error.status).toBe(409);
      expect(error.body).toEqual({
        code: "environment_not_ready",
        message: "Environment unavailable",
        details: {
          environmentStatus: "destroyed",
          hasPath: false,
        },
      });
    } finally {
      db.$client.close();
    }
  });

  it("returns structured thread_environment_unavailable details", () => {
    const { db, host, project } = setup();
    try {
      const unattachedThread = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      const unattachedError = captureApiError(() => {
        requireThreadEnvironment(db, unattachedThread.id);
      });
      expect(unattachedError.body).toEqual({
        code: "thread_environment_unavailable",
        message: "Thread environment is unavailable",
        details: {
          reason: "never_attached",
          environmentStatus: null,
        },
      });

      const environment = createEnvironment(db, noopNotifier, {
        providerOwnsPath: false,
        hostId: host.id,
        projectId: project.id,
        environmentProvider: {
          environmentProviderId: "git-worktree",
          instanceKey: null,
          selection: {
            machine: { type: "existing", hostId: host.id },
            inputs: null,
          },
        },
        path: null,
        status: "destroyed",
      });
      const destroyedEnvironmentThread = createThread(db, noopNotifier, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
      });
      const destroyedError = captureApiError(() => {
        requireThreadEnvironment(db, destroyedEnvironmentThread.id);
      });
      expect(destroyedError.body).toEqual({
        code: "thread_environment_unavailable",
        message: "Thread environment is unavailable",
        details: {
          reason: "destroyed",
          environmentStatus: "destroyed",
        },
      });
    } finally {
      db.$client.close();
    }
  });

  it("returns structured host_unavailable details", () => {
    const { db, host, hub } = setup();
    try {
      const disconnectedError = captureApiError(() => {
        requireConnectedHostSession({ db, hub }, host.id);
      });
      expect(disconnectedError.status).toBe(502);
      expect(disconnectedError.body).toEqual({
        code: "host_unavailable",
        message: "Host is not connected",
        details: {
          reason: "disconnected",
          hostStatus: "disconnected",
          suspendedAt: null,
          destroyedAt: null,
        },
      });

      updateHost(db, noopNotifier, host.id, {
        phase: "suspended",
        suspendedAt: 123,
      });
      const suspendedError = captureApiError(() => {
        requireConnectedHostSession({ db, hub }, host.id);
      });
      expect(suspendedError.status).toBe(502);
      expect(suspendedError.body).toEqual({
        code: "host_unavailable",
        message: "Host is suspended",
        details: {
          reason: "suspended",
          hostStatus: "disconnected",
          suspendedAt: 123,
          destroyedAt: null,
        },
      });

      updateHost(db, noopNotifier, host.id, { suspendedAt: null });
      const legacySuspendedError = captureApiError(() => {
        requireConnectedHostSession({ db, hub }, host.id);
      });
      expect(legacySuspendedError.body.details).toMatchObject({
        reason: "suspended",
        suspendedAt: null,
      });

      updateHost(db, noopNotifier, host.id, { destroyedAt: 456 });
      const destroyedError = captureApiError(() => {
        requireNonDestroyedHostWithStatus({ db, hub }, host.id);
      });
      expect(destroyedError.status).toBe(404);
      expect(destroyedError.body).toEqual({
        code: "host_unavailable",
        message: "Host is unavailable",
        details: {
          reason: "destroyed",
          hostStatus: null,
          suspendedAt: null,
          destroyedAt: 456,
        },
      });
    } finally {
      db.$client.close();
    }
  });

  it("returns project_unavailable for pending project deletion", () => {
    const { db, project } = setup();
    try {
      markProjectDeleted(db, noopNotifier, {
        deletedAt: 123,
        projectId: project.id,
      });

      const error = captureApiError(() => {
        requirePublicProject(db, project.id);
      });

      expect(error.status).toBe(404);
      expect(error.body).toEqual({
        code: "project_unavailable",
        message: "Project is unavailable",
        details: {
          reason: "pending_deletion",
          deletedAt: 123,
        },
      });
    } finally {
      db.$client.close();
    }
  });

  it("returns project_unavailable for repeated project deletion", () => {
    const { db, project } = setup();
    try {
      markProjectDeleted(db, noopNotifier, {
        deletedAt: 123,
        projectId: project.id,
      });
      const repeated = markProjectDeleted(db, noopNotifier, {
        deletedAt: 456,
        projectId: project.id,
      });
      expect(repeated).toBeNull();

      const error = captureApiError(() => {
        requirePublicProject(db, project.id);
      });

      expect(error.status).toBe(404);
      expect(error.body).toEqual({
        code: "project_unavailable",
        message: "Project is unavailable",
        details: {
          reason: "pending_deletion",
          deletedAt: 123,
        },
      });
    } finally {
      db.$client.close();
    }
  });
});

describe("host status after a lost daemon connection", () => {
  it("shows a host whose socket just closed as connected while refusing its commands", () => {
    const { db, host, hub } = setup();
    try {
      const session = openTestSession(db, host.id);
      closeTestSession(db, {
        closeReason: "daemon-disconnect",
        closedAt: Date.now() - HOST_RECONNECT_GRACE_MS + 5_000,
        sessionId: session.id,
      });

      expect(listPublicHostsWithStatus({ db, hub })[0]?.status).toBe(
        "connected",
      );
      expect(requireNonDestroyedHostWithStatus({ db, hub }, host.id).status).toBe(
        "connected",
      );
      expect(
        captureApiError(() => requireConnectedHostSession({ db, hub }, host.id))
          .status,
      ).toBe(502);
    } finally {
      db.$client.close();
    }
  });

  it("shows the host disconnected once the reconnect grace ends", () => {
    const { db, host, hub } = setup();
    try {
      const session = openTestSession(db, host.id);
      closeTestSession(db, {
        closeReason: "daemon-disconnect",
        closedAt: Date.now() - HOST_RECONNECT_GRACE_MS - 1,
        sessionId: session.id,
      });

      expect(listPublicHostsWithStatus({ db, hub })[0]?.status).toBe(
        "disconnected",
      );
    } finally {
      db.$client.close();
    }
  });

  it("shows a host the server expired as disconnected immediately", () => {
    const { db, host, hub } = setup();
    try {
      const session = openTestSession(db, host.id);
      closeTestSession(db, {
        closeReason: "expired",
        closedAt: Date.now(),
        sessionId: session.id,
      });

      expect(listPublicHostsWithStatus({ db, hub })[0]?.status).toBe(
        "disconnected",
      );
    } finally {
      db.$client.close();
    }
  });

  it("keeps the host connected while its reconnecting daemon has opened a session but not registered its socket", () => {
    const { db, host, hub } = setup();
    try {
      const lost = openTestSession(db, host.id);
      closeTestSession(db, {
        closeReason: "daemon-disconnect",
        closedAt: Date.now() - 1_000,
        sessionId: lost.id,
      });
      openTestSession(db, host.id);

      expect(listPublicHostsWithStatus({ db, hub })[0]?.status).toBe(
        "connected",
      );
    } finally {
      db.$client.close();
    }
  });
});
