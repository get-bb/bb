import {
  createConnection,
  createEnvironment,
  createProject,
  createThread,
  ensurePersonalProject,
  markInstalledPluginRemoved,
  migrate,
  noopNotifier,
  setInstalledPluginEnabled,
  upsertHost,
  upsertInstalledPlugin,
  type DbConnection,
} from "@bb/db";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLIENT_WS_REAUTHORIZE_ACTION_NAME,
  CLIENT_WS_SUBSCRIBE_ACTION_NAME,
  CLIENT_WS_SUBSCRIBE_PLUGIN_CHANNEL_ACTION_NAME,
  getClientWebsocketReauthorizePair,
  isRegistryIssuedClientWebsocketAuthorization,
  resolveClientWebsocketSubscribeAuthorization,
} from "../../src/auth/client-websocket-authorization.js";
import { createLocalOwnerPrincipalPolicy } from "../../src/auth/local-owner-adapter.js";

const openDatabases: DbConnection[] = [];

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()!.$client.close();
  }
});

function createTestDb(): DbConnection {
  const db = createConnection(":memory:");
  migrate(db);
  openDatabases.push(db);
  return db;
}

function seedStandardWorkspace(db: DbConnection) {
  const host = upsertHost(db, noopNotifier, {
    id: "host-client-ws",
    name: "Client WS Host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "Standard Project",
    source: {
      type: "local_path",
      hostId: host.id,
      path: "/tmp/standard-project",
    },
  });
  const environment = createEnvironment(db, noopNotifier, {
    projectId: project.id,
    hostId: host.id,
    workspaceProvisionType: "unmanaged",
    status: "ready",
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "test-provider",
    status: "idle",
  });
  return { host, project, environment, thread };
}

describe("client WebSocket authorization registry", () => {
  it("issues exact standard detail targets and rejects personal/missing/list/host/system", () => {
    const db = createTestDb();
    const { project, environment, thread } = seedStandardWorkspace(db);
    const personal = ensurePersonalProject(db);
    const personalThread = createThread(db, noopNotifier, {
      projectId: personal.id,
      providerId: "test-provider",
      status: "idle",
    });
    const personalEnvironment = createEnvironment(db, noopNotifier, {
      projectId: personal.id,
      hostId: "host-client-ws",
      workspaceProvisionType: "unmanaged",
      status: "ready",
    });

    const threadIssued = resolveClientWebsocketSubscribeAuthorization(db, {
      kind: "thread-detail",
      threadId: thread.id,
    });
    expect(threadIssued.kind).toBe("issued");
    if (threadIssued.kind === "issued") {
      expect(threadIssued.action.name).toBe(CLIENT_WS_SUBSCRIBE_ACTION_NAME);
      expect(threadIssued.resource).toEqual({
        kind: "threadEvents",
        id: thread.id,
      });
      expect(
        isRegistryIssuedClientWebsocketAuthorization(
          threadIssued.action,
          threadIssued.resource,
        ),
      ).toBe(true);
    }

    const projectIssued = resolveClientWebsocketSubscribeAuthorization(db, {
      kind: "project-detail",
      projectId: project.id,
    });
    expect(projectIssued.kind).toBe("issued");

    const environmentIssued = resolveClientWebsocketSubscribeAuthorization(db, {
      kind: "environment-detail",
      environmentId: environment.id,
    });
    expect(environmentIssued.kind).toBe("issued");

    const deniedTargets = [
      { kind: "thread-detail" as const, threadId: "missing-thread" },
      { kind: "thread-detail" as const, threadId: personalThread.id },
      { kind: "project-detail" as const, projectId: PERSONAL_PROJECT_ID },
      {
        kind: "environment-detail" as const,
        environmentId: personalEnvironment.id,
      },
      { kind: "environment-detail" as const, environmentId: "missing-env" },
      { kind: "project-detail" as const, projectId: "missing-project" },
      { kind: "thread-list" as const },
      { kind: "project-list" as const },
      { kind: "environment-list" as const },
      { kind: "host-detail" as const, hostId: "host-client-ws" },
      { kind: "host-list" as const },
      { kind: "system" as const },
      {
        kind: "plugin-channel" as const,
        pluginId: "missing-plugin",
        channel: "x",
      },
    ];
    for (const target of deniedTargets) {
      expect(resolveClientWebsocketSubscribeAuthorization(db, target)).toEqual({
        kind: "denied",
      });
    }
  });

  it("issues plugin-channel only for existing enabled non-removed plugins", () => {
    const db = createTestDb();
    upsertInstalledPlugin(db, {
      id: "linear",
      source: "path:/plugins/linear",
      provenance: { kind: "direct" },
      sourceIntent: { kind: "path", canonicalPath: "/plugins/linear" },
      exactResolution: { kind: "path" },
      updateState: {
        lastCheckAt: null,
        availableCompatibleVersion: null,
        newestIncompatibleVersion: null,
        statusDetail: null,
      },
      activeArtifactId: null,
      rootDir: "/plugins/linear",
      version: "1.0.0",
      enabled: true,
    });
    upsertInstalledPlugin(db, {
      id: "disabled-plugin",
      source: "path:/plugins/disabled",
      provenance: { kind: "direct" },
      sourceIntent: { kind: "path", canonicalPath: "/plugins/disabled" },
      exactResolution: { kind: "path" },
      updateState: {
        lastCheckAt: null,
        availableCompatibleVersion: null,
        newestIncompatibleVersion: null,
        statusDetail: null,
      },
      activeArtifactId: null,
      rootDir: "/plugins/disabled",
      version: "1.0.0",
      enabled: true,
    });
    setInstalledPluginEnabled(db, "disabled-plugin", false);
    upsertInstalledPlugin(db, {
      id: "removed-plugin",
      source: "path:/plugins/removed",
      provenance: { kind: "direct" },
      sourceIntent: { kind: "path", canonicalPath: "/plugins/removed" },
      exactResolution: { kind: "path" },
      updateState: {
        lastCheckAt: null,
        availableCompatibleVersion: null,
        newestIncompatibleVersion: null,
        statusDetail: null,
      },
      activeArtifactId: null,
      rootDir: "/plugins/removed",
      version: "1.0.0",
      enabled: true,
    });
    markInstalledPluginRemoved(db, "removed-plugin");

    const issued = resolveClientWebsocketSubscribeAuthorization(db, {
      kind: "plugin-channel",
      pluginId: "linear",
      channel: "issues",
    });
    expect(issued.kind).toBe("issued");
    if (issued.kind === "issued") {
      expect(issued.action.name).toBe(
        CLIENT_WS_SUBSCRIBE_PLUGIN_CHANNEL_ACTION_NAME,
      );
      expect(issued.resource).toEqual({ kind: "plugin", id: "linear" });
      expect(
        isRegistryIssuedClientWebsocketAuthorization(
          issued.action,
          issued.resource,
        ),
      ).toBe(true);
    }

    expect(
      resolveClientWebsocketSubscribeAuthorization(db, {
        kind: "plugin-channel",
        pluginId: "disabled-plugin",
        channel: "issues",
      }),
    ).toEqual({ kind: "denied" });
    expect(
      resolveClientWebsocketSubscribeAuthorization(db, {
        kind: "plugin-channel",
        pluginId: "removed-plugin",
        channel: "issues",
      }),
    ).toEqual({ kind: "denied" });
  });

  it("denies structural forgeries and mismatched issued pairs", () => {
    const db = createTestDb();
    const { thread } = seedStandardWorkspace(db);
    const issued = resolveClientWebsocketSubscribeAuthorization(db, {
      kind: "thread-detail",
      threadId: thread.id,
    });
    expect(issued.kind).toBe("issued");
    if (issued.kind !== "issued") {
      return;
    }

    // Structural copy of action/resource is not registry-issued.
    expect(
      isRegistryIssuedClientWebsocketAuthorization(
        { name: issued.action.name },
        { kind: issued.resource.kind, id: issued.resource.id },
      ),
    ).toBe(false);

    // Mismatched pairs: real action with forged resource.
    expect(
      isRegistryIssuedClientWebsocketAuthorization(issued.action, {
        kind: "threadEvents",
        id: thread.id,
      }),
    ).toBe(false);

    const other = resolveClientWebsocketSubscribeAuthorization(db, {
      kind: "thread-detail",
      threadId: thread.id,
    });
    expect(other.kind).toBe("issued");
    if (other.kind === "issued") {
      // Cross-pairing two independently issued pairs fails.
      expect(
        isRegistryIssuedClientWebsocketAuthorization(
          issued.action,
          other.resource,
        ),
      ).toBe(false);
    }

    const reauthorize = getClientWebsocketReauthorizePair();
    expect(reauthorize.action.name).toBe(CLIENT_WS_REAUTHORIZE_ACTION_NAME);
    expect(
      isRegistryIssuedClientWebsocketAuthorization(
        reauthorize.action,
        reauthorize.resource,
      ),
    ).toBe(true);
    expect(
      isRegistryIssuedClientWebsocketAuthorization(
        { name: CLIENT_WS_REAUTHORIZE_ACTION_NAME },
        { kind: "clientSocket", id: null },
      ),
    ).toBe(false);
  });

  it("is compatible with local-owner allow-all authorize", async () => {
    const db = createTestDb();
    const { thread } = seedStandardWorkspace(db);
    const session = await createLocalOwnerPrincipalPolicy().resolve({
      method: "GET",
      target: "/ws",
      transport: "websocket",
      getHeader: () => undefined,
    });
    const issued = resolveClientWebsocketSubscribeAuthorization(db, {
      kind: "thread-detail",
      threadId: thread.id,
    });
    expect(issued.kind).toBe("issued");
    if (issued.kind !== "issued") {
      return;
    }
    await expect(
      session.authorize(issued.action, issued.resource),
    ).resolves.toEqual({ allowed: true });
    const reauthorize = getClientWebsocketReauthorizePair();
    await expect(
      session.authorize(reauthorize.action, reauthorize.resource),
    ).resolves.toEqual({ allowed: true });
  });
});
