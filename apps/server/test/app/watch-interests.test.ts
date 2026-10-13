import {
  createConnection,
  createEnvironment,
  createProject,
  createThread,
  environments,
  threads,
  migrate,
  noopNotifier,
  updateThread,
  upsertHost,
} from "@bb/db";
import { eq } from "drizzle-orm";
import {
  hostDaemonServerWsMessageSchema,
  type HostDaemonServerWsMessage,
} from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { NotificationHub } from "../../src/ws/hub.js";
import { WatchInterestCoordinator } from "../../src/ws/watch-interests.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";

function setup(queries?: string[]) {
  const db = createConnection(
    ":memory:",
    queries
      ? {
          slowQueryThresholdMs: 0,
          slowQueryLogger: {
            info(fields) {
              queries.push(fields.sql);
            },
          },
        }
      : undefined,
  );
  migrate(db);
  const hub = new NotificationHub();
  const watchInterests = new WatchInterestCoordinator({ db, hub });
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const environment = createEnvironment(db, noopNotifier, {
    providerOwnsPath: false,
    projectId: project.id,
    hostId: host.id,
    path: "/tmp/test-workspace",
    status: "ready",
  });
  return { db, environment, host, hub, project, watchInterests };
}

function lastDaemonMessage(socket: {
  messages: string[];
}): HostDaemonServerWsMessage {
  const message = socket.messages[socket.messages.length - 1];
  if (!message) {
    throw new Error("Expected daemon message");
  }
  return hostDaemonServerWsMessageSchema.parse(JSON.parse(message));
}

describe("WatchInterestCoordinator", () => {
  it("ref-counts duplicate workspace interests across sockets", () => {
    const { environment, host, hub, watchInterests } = setup();
    const daemonSocket = createMockHubSocket();
    const socketA = createMockHubSocket();
    const socketB = createMockHubSocket();
    hub.registerDaemon("session-1", host.id, daemonSocket);

    watchInterests.subscribe(socketA, {
      kind: "environment-detail",
      environmentId: environment.id,
    });
    watchInterests.subscribe(socketB, {
      kind: "environment-detail",
      environmentId: environment.id,
    });
    expect(daemonSocket.messages).toHaveLength(1);

    expect(lastDaemonMessage(daemonSocket)).toMatchObject({
      type: "watch-set.replace",
      workspaceTargets: [
        {
          environmentId: environment.id,
          workspaceContext: {
            workspacePath: "/tmp/test-workspace",
          },
        },
      ],
      threadStorageTargets: [],
    });

    watchInterests.unsubscribe(socketA, {
      kind: "environment-detail",
      environmentId: environment.id,
    });
    expect(daemonSocket.messages).toHaveLength(1);
    expect(lastDaemonMessage(daemonSocket)).toMatchObject({
      type: "watch-set.replace",
      workspaceTargets: [
        {
          environmentId: environment.id,
        },
      ],
    });

    watchInterests.unsubscribe(socketB, {
      kind: "environment-detail",
      environmentId: environment.id,
    });
    expect(daemonSocket.messages).toHaveLength(2);
    expect(lastDaemonMessage(daemonSocket)).toMatchObject({
      type: "watch-set.replace",
      workspaceTargets: [],
      threadStorageTargets: [],
    });
  });

  it("does not create watch targets for list subscriptions", () => {
    const { host, hub, watchInterests } = setup();
    const daemonSocket = createMockHubSocket();
    const socket = createMockHubSocket();
    hub.registerDaemon("session-1", host.id, daemonSocket);

    watchInterests.subscribe(socket, { kind: "environment-list" });
    watchInterests.subscribe(socket, { kind: "thread-list" });

    expect(daemonSocket.messages).toHaveLength(0);
    expect(watchInterests.reconcileWatchSetForHost(host.id)).toEqual({
      generation: 0,
      workspaceTargets: [],
      threadStorageTargets: [],
    });
  });

  it("releases all socket interests on socket close", () => {
    const { environment, host, hub, watchInterests } = setup();
    const daemonSocket = createMockHubSocket();
    const socket = createMockHubSocket();
    hub.registerDaemon("session-1", host.id, daemonSocket);

    watchInterests.subscribe(socket, {
      kind: "environment-detail",
      environmentId: environment.id,
    });
    watchInterests.releaseSocket(socket);

    expect(lastDaemonMessage(daemonSocket)).toMatchObject({
      type: "watch-set.replace",
      workspaceTargets: [],
      threadStorageTargets: [],
    });
  });

  it("includes current targets in session-open watch sets", () => {
    const { environment, host, watchInterests } = setup();
    const socket = createMockHubSocket();

    watchInterests.subscribe(socket, {
      kind: "environment-detail",
      environmentId: environment.id,
    });

    expect(watchInterests.reconcileWatchSetForHost(host.id)).toEqual({
      generation: 1,
      workspaceTargets: [
        {
          environmentId: environment.id,
          workspaceContext: {
            workspacePath: "/tmp/test-workspace",
          },
        },
      ],
      threadStorageTargets: [],
    });
  });

  it("omits unresolved workspace targets from snapshots", () => {
    const { db, host, project, watchInterests } = setup();
    const unready = createEnvironment(db, noopNotifier, {
      providerOwnsPath: false,
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/unready",
      status: "provisioning",
    });
    const destroyed = createEnvironment(db, noopNotifier, {
      providerOwnsPath: false,
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/destroyed",
      status: "destroyed",
    });
    const socket = createMockHubSocket();

    watchInterests.subscribe(socket, {
      kind: "environment-detail",
      environmentId: unready.id,
    });
    watchInterests.subscribe(socket, {
      kind: "environment-detail",
      environmentId: destroyed.id,
    });

    expect(
      watchInterests.reconcileWatchSetForHost(host.id).workspaceTargets,
    ).toEqual([]);
  });

  it("starts watching when a subscribed environment becomes ready", () => {
    const { db, host, hub, project, watchInterests } = setup();
    const daemonSocket = createMockHubSocket();
    const socket = createMockHubSocket();
    const environment = createEnvironment(db, noopNotifier, {
      providerOwnsPath: false,
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/later-ready",
      status: "provisioning",
    });
    hub.registerDaemon("session-1", host.id, daemonSocket);

    watchInterests.subscribe(socket, {
      kind: "environment-detail",
      environmentId: environment.id,
    });
    expect(daemonSocket.messages).toHaveLength(0);

    db.update(environments)
      .set({ status: "ready" })
      .where(eq(environments.id, environment.id))
      .run();
    hub.notifyEnvironment(environment.id, ["status-changed"]);

    expect(lastDaemonMessage(daemonSocket)).toMatchObject({
      type: "watch-set.replace",
      workspaceTargets: [
        {
          environmentId: environment.id,
          workspaceContext: {
            workspacePath: "/tmp/later-ready",
          },
        },
      ],
      threadStorageTargets: [],
    });
  });

  it("does not replace watch sets for ordinary workspace change events", () => {
    const { environment, host, hub, watchInterests } = setup();
    const daemonSocket = createMockHubSocket();
    const socket = createMockHubSocket();
    hub.registerDaemon("session-1", host.id, daemonSocket);

    watchInterests.subscribe(socket, {
      kind: "environment-detail",
      environmentId: environment.id,
    });
    const snapshotCount = daemonSocket.messages.length;

    hub.notifyEnvironment(environment.id, ["work-status-changed"]);

    expect(daemonSocket.messages).toHaveLength(snapshotCount);
  });

  it("does not replace a watch set when a relevant invalidation resolves identically", () => {
    const { environment, host, hub, watchInterests } = setup();
    const daemonSocket = createMockHubSocket();
    const socket = createMockHubSocket();
    hub.registerDaemon("session-1", host.id, daemonSocket);

    watchInterests.subscribe(socket, {
      kind: "environment-detail",
      environmentId: environment.id,
    });
    const snapshotCount = daemonSocket.messages.length;

    hub.notifyEnvironment(environment.id, ["metadata-changed"]);

    expect(daemonSocket.messages).toHaveLength(snapshotCount);
  });

  it("resolves thread-detail subscriptions to the owning thread storage target", () => {
    const { db, environment, host, project, watchInterests } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: environment.id,
      providerId: "codex",
    });
    const socket = createMockHubSocket();

    watchInterests.subscribe(socket, {
      kind: "thread-detail",
      threadId: thread.id,
    });

    expect(watchInterests.reconcileWatchSetForHost(host.id)).toMatchObject({
      threadStorageTargets: [
        {
          environmentId: environment.id,
          threadId: thread.id,
        },
      ],
      workspaceTargets: [],
    });
  });

  it("starts watching thread storage after a subscribed thread is attached to an environment", () => {
    const { db, environment, host, hub, project, watchInterests } = setup();
    const daemonSocket = createMockHubSocket();
    const socket = createMockHubSocket();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: null,
      providerId: "codex",
    });
    hub.registerDaemon("session-1", host.id, daemonSocket);

    watchInterests.subscribe(socket, {
      kind: "thread-detail",
      threadId: thread.id,
    });
    expect(daemonSocket.messages).toHaveLength(0);

    updateThread(db, hub, thread.id, {
      environmentId: environment.id,
    });

    expect(lastDaemonMessage(daemonSocket)).toMatchObject({
      type: "watch-set.replace",
      threadStorageTargets: [
        {
          environmentId: environment.id,
          threadId: thread.id,
        },
      ],
      workspaceTargets: [],
    });
  });
  it("batches a refresh while removing moved, archived and destroyed targets from their previous hosts", () => {
    const queries: string[] = [];
    const { db, environment, host, hub, project, watchInterests } =
      setup(queries);
    const otherHost = upsertHost(db, noopNotifier, { name: "other-host" });
    const otherEnvironment = createEnvironment(db, noopNotifier, {
      providerOwnsPath: false,
      projectId: project.id,
      hostId: otherHost.id,
      path: "/tmp/other-workspace",
      status: "ready",
    });
    const firstDaemon = createMockHubSocket();
    const secondDaemon = createMockHubSocket();
    hub.registerDaemon("first", host.id, firstDaemon);
    hub.registerDaemon("second", otherHost.id, secondDaemon);
    const socket = createMockHubSocket();
    for (const target of [environment, otherEnvironment])
      watchInterests.subscribe(socket, {
        kind: "environment-detail",
        environmentId: target.id,
      });
    const watched = Array.from({ length: 12 }, (_, index) =>
      createThread(db, noopNotifier, {
        projectId: project.id,
        environmentId: index % 2 === 0 ? environment.id : otherEnvironment.id,
        providerId: "test-provider",
      }),
    );
    for (const thread of watched)
      watchInterests.subscribe(socket, {
        kind: "thread-detail",
        threadId: thread.id,
      });
    db.update(environments)
      .set({ hostId: otherHost.id, path: "/tmp/moved" })
      .where(eq(environments.id, environment.id))
      .run();
    queries.length = 0;
    hub.notifyEnvironment(environment.id, ["metadata-changed"]);
    const reads = queries.filter((sql) => sql.startsWith("select ")).length;
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThanOrEqual(4);
    expect(lastDaemonMessage(firstDaemon)).toMatchObject({
      workspaceTargets: [],
      threadStorageTargets: [],
    });
    expect(lastDaemonMessage(secondDaemon)).toMatchObject({
      workspaceTargets: [
        {
          environmentId: environment.id,
          workspaceContext: { workspacePath: "/tmp/moved" },
        },
        { environmentId: otherEnvironment.id },
      ],
      threadStorageTargets: watched.map((thread) => ({
        threadId: thread.id,
        environmentId: thread.environmentId,
      })),
    });
    const generation = watchInterests.reconcileWatchSetForHost(
      otherHost.id,
    ).generation;
    hub.notifyEnvironment(environment.id, ["metadata-changed"]);
    expect(
      watchInterests.reconcileWatchSetForHost(otherHost.id).generation,
    ).toBe(generation);
    db.update(threads)
      .set({ archivedAt: Date.now() })
      .where(eq(threads.id, watched[0]!.id))
      .run();
    hub.notifyThread(watched[0]!.id, ["archived-changed"]);
    expect(
      watchInterests.reconcileWatchSetForHost(otherHost.id)
        .threadStorageTargets,
    ).toHaveLength(11);
    db.update(threads)
      .set({ deletedAt: Date.now() })
      .where(eq(threads.id, watched[2]!.id))
      .run();
    hub.notifyThread(watched[2]!.id, ["thread-deleted"]);
    expect(
      watchInterests.reconcileWatchSetForHost(otherHost.id)
        .threadStorageTargets,
    ).toHaveLength(10);
    db.update(environments)
      .set({ status: "destroyed" })
      .where(eq(environments.id, otherEnvironment.id))
      .run();
    hub.notifyEnvironment(otherEnvironment.id, ["status-changed"]);
    expect(watchInterests.reconcileWatchSetForHost(otherHost.id)).toMatchObject(
      {
        workspaceTargets: [{ environmentId: environment.id }],
        threadStorageTargets: watched
          .filter((_, index) => index > 2 && index % 2 === 0)
          .map((thread) => ({
            threadId: thread.id,
            environmentId: thread.environmentId,
          })),
      },
    );
    watchInterests.releaseSocket(socket);
    expect(lastDaemonMessage(secondDaemon)).toMatchObject({
      workspaceTargets: [],
      threadStorageTargets: [],
    });
    db.$client.close();
  });
});
