import {
  createConnection,
  createEnvironment,
  createProject,
  createTerminalSession,
  createThread,
  ensurePersonalProject,
  migrate,
  noopNotifier,
  upsertHost,
  type DbConnection,
} from "@bb/db";
import { afterEach, describe, expect, it } from "vitest";
import {
  getTerminalWebsocketReauthorizePair,
  isRegistryIssuedTerminalWebsocketAuthorization,
  resolveTerminalWebsocketOpenAuthorization,
  TERMINAL_WS_OPEN_ACTION_NAME,
  TERMINAL_WS_REAUTHORIZE_ACTION_NAME,
} from "../../src/auth/terminal-websocket-authorization.js";
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

function seedStandard(db: DbConnection) {
  const host = upsertHost(db, noopNotifier, {
    id: "host-terminal-auth",
    name: "Terminal Auth Host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "Standard",
    source: {
      type: "local_path",
      hostId: host.id,
      path: "/tmp/terminal-auth-project",
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
    providerId: "test",
    status: "idle",
    environmentId: environment.id,
  });
  return { host, project, environment, thread };
}

describe("terminal WebSocket open authorization registry", () => {
  it("issues open for standard environment-bound and thread-bound terminals", () => {
    const db = createTestDb();
    const { host, environment, thread } = seedStandard(db);

    const envTerminal = createTerminalSession(db, {
      cols: 80,
      daemonSessionId: null,
      environmentId: environment.id,
      hostId: host.id,
      initialCwd: "/tmp",
      rows: 24,
      status: "disconnected",
      threadId: null,
      title: "env-term",
    });
    const threadTerminal = createTerminalSession(db, {
      cols: 80,
      daemonSessionId: null,
      environmentId: environment.id,
      hostId: host.id,
      initialCwd: "/tmp",
      rows: 24,
      status: "disconnected",
      threadId: thread.id,
      title: "thread-term",
    });

    const envIssued = resolveTerminalWebsocketOpenAuthorization(
      db,
      envTerminal.id,
    );
    expect(envIssued.kind).toBe("issued");
    if (envIssued.kind === "issued") {
      expect(envIssued.action.name).toBe(TERMINAL_WS_OPEN_ACTION_NAME);
      expect(envIssued.resource).toEqual({
        kind: "terminal",
        id: envTerminal.id,
      });
      expect(
        isRegistryIssuedTerminalWebsocketAuthorization(
          envIssued.action,
          envIssued.resource,
        ),
      ).toBe(true);
    }

    const threadIssued = resolveTerminalWebsocketOpenAuthorization(
      db,
      threadTerminal.id,
    );
    expect(threadIssued.kind).toBe("issued");
  });

  it("denies missing, personal, host-path, and inconsistent lineage non-enumerating", () => {
    const db = createTestDb();
    const { host, environment, project } = seedStandard(db);
    const personal = ensurePersonalProject(db);
    const personalEnv = createEnvironment(db, noopNotifier, {
      projectId: personal.id,
      hostId: host.id,
      workspaceProvisionType: "unmanaged",
      status: "ready",
    });
    const otherEnv = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      workspaceProvisionType: "unmanaged",
      status: "ready",
    });
    const otherThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "test",
      status: "idle",
      environmentId: otherEnv.id,
    });
    const environmentlessThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "test",
      status: "idle",
    });

    const hostPath = createTerminalSession(db, {
      cols: 80,
      daemonSessionId: null,
      environmentId: null,
      hostId: host.id,
      initialCwd: "/tmp",
      rows: 24,
      status: "disconnected",
      threadId: null,
      title: "host-path",
    });
    const personalTerminal = createTerminalSession(db, {
      cols: 80,
      daemonSessionId: null,
      environmentId: personalEnv.id,
      hostId: host.id,
      initialCwd: "/tmp",
      rows: 24,
      status: "disconnected",
      threadId: null,
      title: "personal",
    });
    const inconsistent = createTerminalSession(db, {
      cols: 80,
      daemonSessionId: null,
      environmentId: environment.id,
      hostId: host.id,
      initialCwd: "/tmp",
      rows: 24,
      status: "disconnected",
      threadId: otherThread.id,
      title: "inconsistent",
    });
    const environmentless = createTerminalSession(db, {
      cols: 80,
      daemonSessionId: null,
      environmentId: environment.id,
      hostId: host.id,
      initialCwd: "/tmp",
      rows: 24,
      status: "disconnected",
      threadId: environmentlessThread.id,
      title: "environmentless-thread",
    });
    const wrongHost = upsertHost(db, noopNotifier, {
      id: "host-terminal-auth-other",
      name: "Other Terminal Host",
      type: "persistent",
    });
    const hostInconsistent = createTerminalSession(db, {
      cols: 80,
      daemonSessionId: null,
      environmentId: environment.id,
      hostId: wrongHost.id,
      initialCwd: "/tmp",
      rows: 24,
      status: "disconnected",
      threadId: null,
      title: "inconsistent-host",
    });

    for (const terminalId of [
      "missing-terminal",
      hostPath.id,
      personalTerminal.id,
      inconsistent.id,
      environmentless.id,
      hostInconsistent.id,
    ]) {
      expect(resolveTerminalWebsocketOpenAuthorization(db, terminalId)).toEqual(
        { kind: "denied" },
      );
    }

    // Structural forgery is not registry-issued.
    expect(
      isRegistryIssuedTerminalWebsocketAuthorization(
        { name: TERMINAL_WS_OPEN_ACTION_NAME },
        { kind: "terminal", id: hostPath.id },
      ),
    ).toBe(false);

    const reauthorize = getTerminalWebsocketReauthorizePair();
    expect(reauthorize.action.name).toBe(TERMINAL_WS_REAUTHORIZE_ACTION_NAME);
    expect(
      isRegistryIssuedTerminalWebsocketAuthorization(
        reauthorize.action,
        reauthorize.resource,
      ),
    ).toBe(true);
  });

  it("is compatible with local-owner allow-all authorize", async () => {
    const db = createTestDb();
    const { host, environment } = seedStandard(db);
    const terminal = createTerminalSession(db, {
      cols: 80,
      daemonSessionId: null,
      environmentId: environment.id,
      hostId: host.id,
      initialCwd: "/tmp",
      rows: 24,
      status: "disconnected",
      threadId: null,
      title: "ok",
    });
    const session = await createLocalOwnerPrincipalPolicy().resolve({
      method: "GET",
      target: `/ws/terminals/${terminal.id}`,
      transport: "websocket",
      getHeader: () => undefined,
    });
    const issued = resolveTerminalWebsocketOpenAuthorization(db, terminal.id);
    expect(issued.kind).toBe("issued");
    if (issued.kind !== "issued") {
      return;
    }
    await expect(
      session.authorize(issued.action, issued.resource),
    ).resolves.toEqual({ allowed: true });
  });
});
