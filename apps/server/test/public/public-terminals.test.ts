import {
  createTerminalSession,
  getTerminalSession,
  listTerminalSessions,
  updateTerminalSession,
  updateTerminalSessions,
} from "@bb/db";
import type { EnvironmentStatus, TerminalSessionCloseReason } from "@bb/domain";
import {
  hostDaemonServerWsMessageSchema,
  type HostDaemonServerWsMessage,
} from "@bb/host-daemon-contract";
import {
  apiErrorSchema,
  terminalListResponseSchema,
  terminalServerMessageSchema,
  terminalOutputResponseSchema,
  type TerminalServerMessage,
  terminalSessionSchema,
} from "@bb/server-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHost,
  seedHostSession,
  seedProjectWithSource,
  seedSession,
  seedThread,
} from "../helpers/seed.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../helpers/test-app.js";
import {
  handleDaemonSocketClosed,
  handleHostSessionOpened,
} from "../../src/internal/session-owner-side-effects.js";
import { onDaemonSocketOpen } from "../../src/ws/daemon-protocol.js";

interface FakeDaemonSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
  sentMessages: string[];
}

interface FakeBrowserSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
  sentMessages: string[];
}

interface TerminalRouteFixture {
  environment: ReturnType<typeof seedEnvironment>;
  harness: TestAppHarness;
  host: ReturnType<typeof seedHost>;
  session: ReturnType<typeof seedHostSession>["session"];
  socket: FakeDaemonSocket;
  thread: ReturnType<typeof seedThread>;
}

type TestDb = TestAppHarness["db"];

function getTerminalSessionForThread(
  db: TestDb,
  args: { terminalId: string; threadId: string },
) {
  return getTerminalSession(db, { ...args, kind: "thread" });
}

function getThreadlessTerminalSessionForEnvironment(
  db: TestDb,
  args: { environmentId: string; terminalId: string },
) {
  return getTerminalSession(db, {
    ...args,
    kind: "threadless-environment",
  });
}

function listTerminalSessionsByThread(db: TestDb, threadId: string) {
  return listTerminalSessions(db, {
    scope: { kind: "thread", threadId },
    visible: false,
  });
}

function markTerminalSessionExited(
  db: TestDb,
  args: {
    closeReason: TerminalSessionCloseReason;
    exitCode: number | null;
    terminalId: string;
  },
) {
  return updateTerminalSession(db, {
    scope: { kind: "terminal", terminalId: args.terminalId },
    update: {
      closeReason: args.closeReason,
      exitCode: args.exitCode,
      kind: "exit",
    },
  });
}

function markTerminalSessionUserInput(
  db: TestDb,
  args: { now: number; terminalId: string; threadId: string },
) {
  return updateTerminalSession(db, {
    now: args.now,
    scope: {
      kind: "thread",
      terminalId: args.terminalId,
      threadId: args.threadId,
    },
    update: { kind: "user-input" },
  });
}

function markTerminalSessionsExited(
  db: TestDb,
  scope: Parameters<typeof updateTerminalSessions>[1]["scope"],
  closeReason: TerminalSessionCloseReason,
) {
  return updateTerminalSessions(db, {
    scope: { ...scope, statuses: ["starting", "running", "disconnected"] },
    update: { closeReason, kind: "exit" },
  });
}

function markThreadTerminalSessionsExited(
  db: TestDb,
  args: { closeReason: TerminalSessionCloseReason; threadId: string },
) {
  return markTerminalSessionsExited(
    db,
    { kind: "thread", threadId: args.threadId },
    args.closeReason,
  );
}

function markEnvironmentTerminalSessionsExited(
  db: TestDb,
  args: { closeReason: TerminalSessionCloseReason; environmentId: string },
) {
  return markTerminalSessionsExited(
    db,
    { environmentId: args.environmentId, kind: "environment" },
    args.closeReason,
  );
}

function markDaemonTerminalSessionsDisconnected(
  db: TestDb,
  args: { daemonSessionId: string },
) {
  return updateTerminalSessions(db, {
    scope: {
      daemonSessionId: args.daemonSessionId,
      kind: "daemon",
      statuses: ["starting", "running"],
    },
    update: { kind: "disconnect" },
  });
}

type TerminalOpenMessage = Extract<
  HostDaemonServerWsMessage,
  { type: "terminal.open" }
>;

interface PendingTerminalOpen {
  openMessage: TerminalOpenMessage;
  responsePromise: Promise<Response>;
}

interface CreateTerminalRouteFixtureArgs {
  environmentStatus?: EnvironmentStatus;
  terminalCloseTimeoutMs?: number;
}

function createFakeDaemonSocket(): FakeDaemonSocket {
  const sentMessages: string[] = [];
  const closeSocket: FakeDaemonSocket["close"] = () => {};
  const sendSocketMessage: FakeDaemonSocket["send"] = (data) => {
    sentMessages.push(data);
  };
  return {
    close: vi.fn(closeSocket),
    send: vi.fn(sendSocketMessage),
    sentMessages,
  };
}

function createFakeBrowserSocket(): FakeBrowserSocket {
  const sentMessages: string[] = [];
  const closeSocket: FakeBrowserSocket["close"] = () => {};
  const sendSocketMessage: FakeBrowserSocket["send"] = (data) => {
    sentMessages.push(data);
  };
  return {
    close: vi.fn(closeSocket),
    send: vi.fn(sendSocketMessage),
    sentMessages,
  };
}

function readBrowserMessages(
  socket: FakeBrowserSocket,
): TerminalServerMessage[] {
  return socket.sentMessages.map((message) =>
    terminalServerMessageSchema.parse(JSON.parse(message)),
  );
}

function readDaemonMessages(
  socket: FakeDaemonSocket,
): HostDaemonServerWsMessage[] {
  return socket.sentMessages.map((message) =>
    hostDaemonServerWsMessageSchema.parse(JSON.parse(message)),
  );
}

async function waitForDaemonMessage(
  socket: FakeDaemonSocket,
  messageIndex = 0,
): Promise<HostDaemonServerWsMessage> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const message = socket.sentMessages[messageIndex];
    if (message !== undefined) {
      return hostDaemonServerWsMessageSchema.parse(JSON.parse(message));
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for daemon message");
}

async function createTerminalRouteFixture(
  args: CreateTerminalRouteFixtureArgs = {},
): Promise<TerminalRouteFixture> {
  const harness = await createTestAppHarness(
    args.terminalCloseTimeoutMs === undefined
      ? {}
      : { terminalCloseTimeoutMs: args.terminalCloseTimeoutMs },
  );
  const seeded = seedHostSession(harness.deps, { id: "terminal-host" });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: seeded.host.id,
    path: "/tmp/terminal-project",
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: seeded.host.id,
    path: "/tmp/terminal-workspace",
    projectId: project.id,
    status: args.environmentStatus ?? "ready",
  });
  const thread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    status: "idle",
  });
  const socket = createFakeDaemonSocket();
  harness.hub.registerDaemon(seeded.session.id, seeded.host.id, socket);
  return {
    environment,
    harness,
    host: seeded.host,
    session: seeded.session,
    socket,
    thread,
  };
}

async function startPendingTerminalOpen(
  fixture: TerminalRouteFixture,
): Promise<PendingTerminalOpen> {
  const responsePromise = Promise.resolve(
    fixture.harness.app.request("/api/v1/terminals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cols: 100,
        rows: 30,
        target: { kind: "thread", threadId: fixture.thread.id },
      }),
    }),
  );
  const openMessage = await waitForDaemonMessage(fixture.socket);
  if (openMessage.type !== "terminal.open") {
    throw new Error(`Expected terminal.open, received ${openMessage.type}`);
  }
  return {
    openMessage,
    responsePromise,
  };
}

async function startPendingEnvironmentTerminalOpen(
  fixture: TerminalRouteFixture,
): Promise<PendingTerminalOpen> {
  const responsePromise = Promise.resolve(
    fixture.harness.app.request("/api/v1/terminals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cols: 100,
        rows: 30,
        target: {
          kind: "environment",
          environmentId: fixture.environment.id,
        },
      }),
    }),
  );
  const openMessage = await waitForDaemonMessage(fixture.socket);
  if (openMessage.type !== "terminal.open") {
    throw new Error(`Expected terminal.open, received ${openMessage.type}`);
  }
  return {
    openMessage,
    responsePromise,
  };
}

async function startPendingStandaloneTerminalOpen(
  fixture: TerminalRouteFixture,
): Promise<PendingTerminalOpen> {
  const responsePromise = Promise.resolve(
    fixture.harness.app.request("/api/v1/terminals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cols: 100,
        rows: 30,
        target: {
          kind: "host_path",
          hostId: fixture.host.id,
          cwd: "/tmp/standalone-terminal",
        },
      }),
    }),
  );
  const openMessage = await waitForDaemonMessage(fixture.socket);
  if (openMessage.type !== "terminal.open") {
    throw new Error(`Expected terminal.open, received ${openMessage.type}`);
  }
  return {
    openMessage,
    responsePromise,
  };
}

function acknowledgeTerminalOpen(
  fixture: TerminalRouteFixture,
  openMessage: TerminalOpenMessage,
  initialCwd = "/tmp/terminal-workspace",
): void {
  fixture.harness.deps.terminalSessions.handleDaemonTerminalMessage({
    hostId: fixture.host.id,
    sessionId: fixture.session.id,
    message: {
      type: "terminal.opened",
      requestId: openMessage.requestId,
      terminalId: openMessage.terminalId,
      shell: "/bin/zsh",
      title: "zsh",
      initialCwd,
      cols: 100,
      rows: 30,
    },
  });
}

describe("public terminal routes", () => {
  let harnesses: TestAppHarness[] = [];

  beforeEach(() => {
    harnesses = [];
  });

  afterEach(async () => {
    for (const harness of harnesses) {
      await harness.cleanup();
    }
  });

  it("lists terminal sessions for a thread", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const stored = createTerminalSession(fixture.harness.db, {
      cols: 120,
      daemonSessionId: fixture.session.id,
      environmentId: fixture.environment.id,
      hostId: fixture.host.id,
      initialCwd: fixture.environment.path ?? "/tmp/terminal-workspace",
      rows: 32,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });
    const exited = createTerminalSession(fixture.harness.db, {
      cols: 120,
      daemonSessionId: fixture.session.id,
      environmentId: fixture.environment.id,
      hostId: fixture.host.id,
      initialCwd: fixture.environment.path ?? "/tmp/terminal-workspace",
      rows: 32,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 2",
    });
    markTerminalSessionExited(fixture.harness.db, {
      terminalId: exited.id,
      exitCode: 0,
      closeReason: "user",
    });

    const response = await fixture.harness.app.request(
      `/api/v1/terminals?threadId=${encodeURIComponent(fixture.thread.id)}`,
    );

    expect(response.status).toBe(200);
    const body = terminalListResponseSchema.parse(await readJson(response));
    expect(body.sessions).toEqual([
      expect.objectContaining({
        id: stored.id,
        status: "running",
        title: "Terminal 1",
      }),
    ]);
  });

  it("gets and renames a terminal by ID without a redundant scope", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const stored = createTerminalSession(fixture.harness.db, {
      cols: 100,
      daemonSessionId: fixture.session.id,
      environmentId: fixture.environment.id,
      hostId: fixture.host.id,
      initialCwd: fixture.environment.path ?? "/tmp/terminal-workspace",
      rows: 30,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });

    const getResponse = await fixture.harness.app.request(
      `/api/v1/terminals/${stored.id}`,
    );
    expect(getResponse.status).toBe(200);
    expect(
      terminalSessionSchema.parse(await readJson(getResponse)),
    ).toMatchObject({
      id: stored.id,
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });

    const renameResponse = await fixture.harness.app.request(
      `/api/v1/terminals/${stored.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Dev server" }),
      },
    );
    expect(renameResponse.status).toBe(200);
    expect(
      terminalSessionSchema.parse(await readJson(renameResponse)),
    ).toMatchObject({
      id: stored.id,
      title: "Dev server",
    });
  });

  it.each([
    ["no scope", "/api/v1/terminals"],
    ["dual scope", "/api/v1/terminals?threadId=thr_one&environmentId=env_two"],
    ["cwd outside host scope", "/api/v1/terminals?threadId=thr_one&cwd=%2Ftmp"],
  ])("rejects terminal list requests with %s", async (_label, path) => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const response = await harness.app.request(path);

    expect(response.status).toBe(400);
    expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
      code: "invalid_request",
    });
  });

  it("rejects an unknown explicit terminal host instead of falling back", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);

    const response = await fixture.harness.app.request(
      "/api/v1/terminals?hostId=host_wrong",
    );

    expect(response.status).toBe(404);
    expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
      code: "host_not_found",
    });
  });

  it("creates and lists threadless terminal sessions for an environment", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);

    const pending = await startPendingEnvironmentTerminalOpen(fixture);

    expect(pending.openMessage).not.toHaveProperty("threadId");
    expect(pending.openMessage.target).toMatchObject({
      kind: "workspace",
      environmentId: fixture.environment.id,
      workspaceContext: {
        workspacePath: "/tmp/terminal-workspace",
      },
    });
    acknowledgeTerminalOpen(fixture, pending.openMessage);
    const response = await pending.responsePromise;

    expect(response.status).toBe(201);
    const created = terminalSessionSchema.parse(await readJson(response));
    expect(created).toMatchObject({
      environmentId: fixture.environment.id,
      threadId: null,
      status: "running",
      title: "zsh",
    });

    const environmentListResponse = await fixture.harness.app.request(
      `/api/v1/terminals?environmentId=${encodeURIComponent(
        fixture.environment.id,
      )}`,
    );
    expect(environmentListResponse.status).toBe(200);
    const environmentList = terminalListResponseSchema.parse(
      await readJson(environmentListResponse),
    );
    expect(environmentList.sessions).toEqual([
      expect.objectContaining({
        id: created.id,
        threadId: null,
      }),
    ]);

    const threadListResponse = await fixture.harness.app.request(
      `/api/v1/terminals?threadId=${encodeURIComponent(fixture.thread.id)}`,
    );
    const threadList = terminalListResponseSchema.parse(
      await readJson(threadListResponse),
    );
    expect(threadList.sessions).toEqual([]);
  });

  it("creates and lists terminal sessions for a host path without an environment", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);

    const pending = await startPendingStandaloneTerminalOpen(fixture);

    expect(pending.openMessage).not.toHaveProperty("threadId");
    expect(pending.openMessage.target).toEqual({
      kind: "host_path",
      cwd: "/tmp/standalone-terminal",
    });
    acknowledgeTerminalOpen(
      fixture,
      pending.openMessage,
      "/tmp/standalone-terminal",
    );
    const response = await pending.responsePromise;

    expect(response.status).toBe(201);
    const created = terminalSessionSchema.parse(await readJson(response));
    expect(created).toMatchObject({
      environmentId: null,
      hostId: fixture.host.id,
      initialCwd: "/tmp/standalone-terminal",
      threadId: null,
      status: "running",
    });

    const listResponse = await fixture.harness.app.request(
      `/api/v1/terminals?hostId=${encodeURIComponent(
        fixture.host.id,
      )}&cwd=${encodeURIComponent("/tmp/standalone-terminal")}`,
    );
    expect(listResponse.status).toBe(200);
    const list = terminalListResponseSchema.parse(await readJson(listResponse));
    expect(list.sessions).toEqual([
      expect.objectContaining({
        id: created.id,
        environmentId: null,
        threadId: null,
      }),
    ]);
  });

  it("creates a host terminal without an environment or cwd", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);

    const responsePromise = Promise.resolve(
      fixture.harness.app.request("/api/v1/terminals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cols: 100,
          rows: 30,
          target: {
            kind: "host_path",
            hostId: fixture.host.id,
            cwd: null,
          },
        }),
      }),
    );
    const openMessage = await waitForDaemonMessage(fixture.socket);
    if (openMessage.type !== "terminal.open") {
      throw new Error(`Expected terminal.open, received ${openMessage.type}`);
    }
    expect(openMessage).not.toHaveProperty("threadId");
    expect(openMessage.target).toEqual({
      kind: "host_path",
      cwd: null,
    });
    acknowledgeTerminalOpen(fixture, openMessage, "/home/bb");

    const response = await responsePromise;
    expect(response.status).toBe(201);
    expect(terminalSessionSchema.parse(await readJson(response))).toMatchObject(
      {
        environmentId: null,
        hostId: fixture.host.id,
        initialCwd: "/home/bb",
        threadId: null,
        status: "running",
      },
    );
  });

  it("keeps a non-empty cwd for a host home terminal disconnected before open", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);

    const responsePromise = Promise.resolve(
      fixture.harness.app.request("/api/v1/terminals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cols: 100,
          rows: 30,
          target: {
            kind: "host_path",
            hostId: fixture.host.id,
            cwd: null,
          },
        }),
      }),
    );
    const openMessage = await waitForDaemonMessage(fixture.socket);
    if (openMessage.type !== "terminal.open") {
      throw new Error(`Expected terminal.open, received ${openMessage.type}`);
    }

    fixture.harness.deps.terminalSessions.handleDaemonSessionClosed({
      sessionId: fixture.session.id,
    });

    const response = await responsePromise;
    expect(response.status).toBe(502);
    expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
      code: "host_disconnected",
    });

    const listResponse = await fixture.harness.app.request(
      `/api/v1/terminals?hostId=${encodeURIComponent(fixture.host.id)}`,
    );
    expect(listResponse.status).toBe(200);
    const list = terminalListResponseSchema.parse(await readJson(listResponse));
    expect(list.sessions).toEqual([
      expect.objectContaining({
        id: openMessage.terminalId,
        environmentId: null,
        initialCwd: "~",
        status: "disconnected",
        threadId: null,
      }),
    ]);
  });

  it("attaches browser sockets to threadless terminal sessions", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const stored = createTerminalSession(fixture.harness.db, {
      cols: 120,
      daemonSessionId: fixture.session.id,
      environmentId: fixture.environment.id,
      hostId: fixture.host.id,
      initialCwd: fixture.environment.path ?? "/tmp/terminal-workspace",
      rows: 32,
      status: "running",
      threadId: null,
      title: "Terminal 1",
    });
    const browserSocket = createFakeBrowserSocket();

    fixture.harness.deps.terminalSessions.attachBrowserTerminal({
      socket: browserSocket,
      sinceSeq: 0,
      terminalId: stored.id,
      threadId: null,
    });
    const attachMessage = await waitForDaemonMessage(fixture.socket);
    expect(attachMessage).toMatchObject({
      type: "terminal.attach",
      terminalId: stored.id,
      sinceSeq: 0,
      tailBytes: 512 * 1024,
    });
    if (attachMessage.type !== "terminal.attach") {
      throw new Error(
        `Expected terminal.attach, received ${attachMessage.type}`,
      );
    }

    fixture.harness.deps.terminalSessions.handleDaemonTerminalMessage({
      hostId: fixture.host.id,
      sessionId: fixture.session.id,
      message: {
        type: "terminal.replay",
        requestId: attachMessage.requestId,
        terminalId: stored.id,
        chunks: [],
        replayStartSeq: 0,
        nextSeq: 0,
      },
    });
    expect(readBrowserMessages(browserSocket)).toContainEqual(
      expect.objectContaining({
        type: "attached",
        session: expect.objectContaining({
          id: stored.id,
          threadId: null,
        }),
      }),
    );

    fixture.harness.deps.terminalSessions.handleBrowserTerminalMessage({
      socket: browserSocket,
      terminalId: stored.id,
      threadId: null,
      message: {
        type: "input",
        dataBase64: Buffer.from("pwd\n").toString("base64"),
      },
    });
    const inputMessage = await waitForDaemonMessage(fixture.socket, 1);
    expect(inputMessage).toMatchObject({
      type: "terminal.input",
      terminalId: stored.id,
    });
    expect(
      getThreadlessTerminalSessionForEnvironment(fixture.harness.db, {
        environmentId: fixture.environment.id,
        terminalId: stored.id,
      }),
    ).toMatchObject({
      lastUserInputAt: expect.any(Number),
    });
  });

  it("rejects terminal creation when the thread has no environment", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);
    const host = seedHost(harness.deps, { id: "terminal-no-env-host" });
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
      path: "/tmp/terminal-no-env-project",
    });
    const thread = seedThread(harness.deps, {
      environmentId: null,
      projectId: project.id,
      status: "idle",
    });

    const response = await harness.app.request("/api/v1/terminals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cols: 80,
        rows: 24,
        target: { kind: "thread", threadId: thread.id },
      }),
    });

    expect(response.status).toBe(409);
    expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
      code: "thread_environment_unavailable",
      details: {
        reason: "never_attached",
        environmentStatus: null,
      },
    });
  });

  it("opens a terminal after the daemon acknowledges the PTY", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);

    const responsePromise = fixture.harness.app.request("/api/v1/terminals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cols: 100,
        rows: 30,
        target: { kind: "thread", threadId: fixture.thread.id },
      }),
    });
    const openMessage = await waitForDaemonMessage(fixture.socket);
    if (openMessage.type !== "terminal.open") {
      throw new Error(`Expected terminal.open, received ${openMessage.type}`);
    }
    expect(openMessage).toMatchObject({
      cols: 100,
      rows: 30,
      threadId: fixture.thread.id,
      target: {
        kind: "workspace",
        environmentId: fixture.environment.id,
        workspaceContext: {
          workspacePath: "/tmp/terminal-workspace",
        },
      },
    });

    fixture.harness.deps.terminalSessions.handleDaemonTerminalMessage({
      hostId: fixture.host.id,
      sessionId: fixture.session.id,
      message: {
        type: "terminal.opened",
        requestId: openMessage.requestId,
        terminalId: openMessage.terminalId,
        shell: "/bin/zsh",
        title: "zsh",
        initialCwd: "/tmp/terminal-workspace",
        cols: 100,
        rows: 30,
      },
    });

    const response = await responsePromise;
    expect(response.status).toBe(201);
    const body = terminalSessionSchema.parse(await readJson(response));
    expect(body).toMatchObject({
      initialCwd: "/tmp/terminal-workspace",
      status: "running",
      title: "zsh",
    });
  });

  it("opens a command terminal with thread context for the daemon", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);

    const responsePromise = fixture.harness.app.request("/api/v1/terminals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cols: 100,
        rows: 30,
        start: { mode: "command", command: "pnpm dev" },
        target: { kind: "thread", threadId: fixture.thread.id },
      }),
    });
    const openMessage = await waitForDaemonMessage(fixture.socket);
    if (openMessage.type !== "terminal.open") {
      throw new Error(`Expected terminal.open, received ${openMessage.type}`);
    }
    expect(openMessage).toMatchObject({
      threadId: fixture.thread.id,
      start: { mode: "command", command: "pnpm dev" },
      target: {
        kind: "workspace",
        environmentId: fixture.environment.id,
        workspaceContext: {
          workspacePath: "/tmp/terminal-workspace",
        },
      },
    });

    acknowledgeTerminalOpen(fixture, openMessage);
    const response = await responsePromise;
    expect(response.status).toBe(201);
  });

  it("sends input to a running terminal over the daemon session", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const session = createTerminalSession(fixture.harness.db, {
      cols: 120,
      daemonSessionId: fixture.session.id,
      environmentId: fixture.environment.id,
      hostId: fixture.host.id,
      initialCwd: fixture.environment.path ?? "/tmp/terminal-workspace",
      rows: 32,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });

    const response = await fixture.harness.app.request(
      `/api/v1/terminals/${session.id}/input`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dataBase64: Buffer.from("echo hi\n", "utf8").toString("base64"),
        }),
      },
    );

    expect(response.status).toBe(200);
    const inputMessage = await waitForDaemonMessage(fixture.socket);
    expect(inputMessage).toMatchObject({
      type: "terminal.input",
      terminalId: session.id,
      dataBase64: Buffer.from("echo hi\n", "utf8").toString("base64"),
    });
    expect(
      getTerminalSessionForThread(fixture.harness.db, {
        threadId: fixture.thread.id,
        terminalId: session.id,
      })?.lastUserInputAt,
    ).not.toBeNull();
  });

  it("resizes a running terminal over the daemon session", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const session = createTerminalSession(fixture.harness.db, {
      cols: 120,
      daemonSessionId: fixture.session.id,
      environmentId: fixture.environment.id,
      hostId: fixture.host.id,
      initialCwd: fixture.environment.path ?? "/tmp/terminal-workspace",
      rows: 32,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });

    const response = await fixture.harness.app.request(
      `/api/v1/terminals/${session.id}/resize`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cols: 140, rows: 40 }),
      },
    );

    expect(response.status).toBe(200);
    expect(terminalSessionSchema.parse(await readJson(response))).toEqual(
      expect.objectContaining({
        id: session.id,
        cols: 140,
        rows: 40,
      }),
    );
    const resizeMessage = await waitForDaemonMessage(fixture.socket);
    expect(resizeMessage).toMatchObject({
      type: "terminal.resize",
      terminalId: session.id,
      cols: 140,
      rows: 40,
    });
  });

  it("reads output by requesting daemon replay", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const session = createTerminalSession(fixture.harness.db, {
      cols: 120,
      daemonSessionId: fixture.session.id,
      environmentId: fixture.environment.id,
      hostId: fixture.host.id,
      initialCwd: fixture.environment.path ?? "/tmp/terminal-workspace",
      rows: 32,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });

    const responsePromise = fixture.harness.app.request(
      `/api/v1/terminals/${session.id}/output?sinceSeq=2&limitChunks=1&tailBytes=3`,
    );
    const attachMessage = await waitForDaemonMessage(fixture.socket);
    if (attachMessage.type !== "terminal.attach") {
      throw new Error(
        `Expected terminal.attach, received ${attachMessage.type}`,
      );
    }
    expect(attachMessage).toMatchObject({
      terminalId: session.id,
      sinceSeq: 2,
      tailBytes: 3,
    });

    fixture.harness.deps.terminalSessions.handleDaemonTerminalMessage({
      hostId: fixture.host.id,
      sessionId: fixture.session.id,
      message: {
        type: "terminal.replay",
        requestId: attachMessage.requestId,
        terminalId: session.id,
        chunks: [
          {
            seq: 2,
            dataBase64: Buffer.from("old", "utf8").toString("base64"),
          },
          {
            seq: 3,
            dataBase64: Buffer.from("new", "utf8").toString("base64"),
          },
        ],
        replayStartSeq: 2,
        nextSeq: 4,
      },
    });

    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(
      terminalOutputResponseSchema.parse(await readJson(response)),
    ).toEqual({
      chunks: [
        {
          seq: 3,
          dataBase64: Buffer.from("new", "utf8").toString("base64"),
        },
      ],
      nextSeq: 4,
      truncated: true,
    });
  });

  it("rejects output reads for exited terminals", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const session = createTerminalSession(fixture.harness.db, {
      cols: 120,
      daemonSessionId: fixture.session.id,
      environmentId: fixture.environment.id,
      hostId: fixture.host.id,
      initialCwd: fixture.environment.path ?? "/tmp/terminal-workspace",
      rows: 32,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });
    markTerminalSessionExited(fixture.harness.db, {
      terminalId: session.id,
      exitCode: 0,
      closeReason: "process-exit",
    });

    const response = await fixture.harness.app.request(
      `/api/v1/terminals/${session.id}/output`,
    );

    expect(response.status).toBe(409);
    expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
      code: "terminal_output_unavailable",
    });
  });

  it("does not resurrect a pending terminal after thread deletion", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const { openMessage, responsePromise } =
      await startPendingTerminalOpen(fixture);

    markThreadTerminalSessionsExited(fixture.harness.db, {
      threadId: fixture.thread.id,
      closeReason: "thread-deleted",
    });
    acknowledgeTerminalOpen(fixture, openMessage);

    const response = await responsePromise;
    expect(response.status).toBe(409);
    expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
      code: "terminal_open_cancelled",
    });
    expect(
      listTerminalSessionsByThread(fixture.harness.db, fixture.thread.id),
    ).toEqual([
      expect.objectContaining({
        id: openMessage.terminalId,
        closeReason: "thread-deleted",
        daemonSessionId: null,
        status: "exited",
      }),
    ]);
    const closeMessage = await waitForDaemonMessage(fixture.socket, 1);
    expect(closeMessage).toMatchObject({
      type: "terminal.close",
      terminalId: openMessage.terminalId,
      reason: "thread-deleted",
    });
  });

  it("does not resurrect a pending terminal after environment destruction", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const { openMessage, responsePromise } =
      await startPendingTerminalOpen(fixture);

    markEnvironmentTerminalSessionsExited(fixture.harness.db, {
      environmentId: fixture.environment.id,
      closeReason: "environment-destroyed",
    });
    acknowledgeTerminalOpen(fixture, openMessage);

    const response = await responsePromise;
    expect(response.status).toBe(409);
    expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
      code: "terminal_open_cancelled",
    });
    expect(
      listTerminalSessionsByThread(fixture.harness.db, fixture.thread.id),
    ).toEqual([
      expect.objectContaining({
        id: openMessage.terminalId,
        closeReason: "environment-destroyed",
        daemonSessionId: null,
        status: "exited",
      }),
    ]);
    const closeMessage = await waitForDaemonMessage(fixture.socket, 1);
    expect(closeMessage).toMatchObject({
      type: "terminal.close",
      terminalId: openMessage.terminalId,
      reason: "environment-destroyed",
    });
  });

  it("does not resurrect a pending terminal after daemon disconnect", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const { openMessage, responsePromise } =
      await startPendingTerminalOpen(fixture);

    markDaemonTerminalSessionsDisconnected(fixture.harness.db, {
      daemonSessionId: fixture.session.id,
    });
    acknowledgeTerminalOpen(fixture, openMessage);

    const response = await responsePromise;
    expect(response.status).toBe(409);
    expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
      code: "terminal_open_cancelled",
    });
    expect(
      listTerminalSessionsByThread(fixture.harness.db, fixture.thread.id),
    ).toEqual([
      expect.objectContaining({
        id: openMessage.terminalId,
        daemonSessionId: null,
        status: "disconnected",
      }),
    ]);
    const closeMessage = await waitForDaemonMessage(fixture.socket, 1);
    expect(closeMessage).toMatchObject({
      type: "terminal.close",
      terminalId: openMessage.terminalId,
      reason: "daemon-disconnect",
    });
  });

  it("marks timed-out terminal opens exited", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);

    const response = await fixture.harness.app.request("/api/v1/terminals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cols: 80,
        rows: 24,
        target: { kind: "thread", threadId: fixture.thread.id },
      }),
    });

    expect(response.status).toBe(504);
    expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
      code: "terminal_open_timeout",
    });
    const sessions = listTerminalSessionsByThread(
      fixture.harness.db,
      fixture.thread.id,
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      closeReason: "open-timeout",
      status: "exited",
    });
    const closeMessage = hostDaemonServerWsMessageSchema.parse(
      JSON.parse(fixture.socket.sentMessages[1] ?? ""),
    );
    expect(closeMessage).toMatchObject({
      type: "terminal.close",
      reason: "open-timeout",
    });
  });

  it("marks running terminals disconnected when their daemon session closes", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const stored = createTerminalSession(fixture.harness.db, {
      cols: 80,
      daemonSessionId: fixture.session.id,
      environmentId: fixture.environment.id,
      hostId: fixture.host.id,
      initialCwd: "/tmp/terminal-workspace",
      rows: 24,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });
    const browserSocket = createFakeBrowserSocket();
    fixture.harness.hub.registerTerminalClient(stored.id, browserSocket);

    fixture.harness.deps.terminalSessions.handleDaemonSessionClosed({
      sessionId: fixture.session.id,
    });

    const sessions = listTerminalSessionsByThread(
      fixture.harness.db,
      fixture.thread.id,
    );
    expect(sessions).toEqual([
      expect.objectContaining({
        daemonSessionId: null,
        id: stored.id,
        status: "disconnected",
      }),
    ]);
    expect(readBrowserMessages(browserSocket)).toContainEqual(
      expect.objectContaining({
        type: "session-updated",
        session: expect.objectContaining({
          id: stored.id,
          status: "disconnected",
        }),
      }),
    );
  });

  it("expires disconnected terminals on daemon reconnect without restoring them in v1", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const stored = createTerminalSession(fixture.harness.db, {
      cols: 80,
      daemonSessionId: fixture.session.id,
      environmentId: fixture.environment.id,
      hostId: fixture.host.id,
      initialCwd: "/tmp/terminal-workspace",
      rows: 24,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });
    const browserSocket = createFakeBrowserSocket();
    fixture.harness.hub.registerTerminalClient(stored.id, browserSocket);

    fixture.harness.deps.terminalSessions.handleDaemonSessionClosed({
      sessionId: fixture.session.id,
    });
    const replacement = seedHostSession(fixture.harness.deps, {
      id: fixture.host.id,
    });
    const replacementSocket = createFakeDaemonSocket();
    onDaemonSocketOpen(fixture.harness.deps, {
      hostId: fixture.host.id,
      sessionId: replacement.session.id,
      socket: replacementSocket,
    });

    expect(await waitForDaemonMessage(replacementSocket)).toEqual({
      type: "connect-shares.replace",
      generation: 0,
      ports: [],
    });
    const closeMessage = await waitForDaemonMessage(replacementSocket, 1);
    expect(closeMessage).toMatchObject({
      type: "terminal.close",
      terminalId: stored.id,
      reason: "daemon-disconnect",
    });
    expect(
      listTerminalSessionsByThread(fixture.harness.db, fixture.thread.id),
    ).toEqual([
      expect.objectContaining({
        id: stored.id,
        closeReason: "daemon-disconnect",
        daemonSessionId: null,
        status: "exited",
      }),
    ]);
    expect(readBrowserMessages(browserSocket)).toContainEqual(
      expect.objectContaining({
        type: "exited",
        session: expect.objectContaining({
          id: stored.id,
          closeReason: "daemon-disconnect",
          status: "exited",
        }),
      }),
    );
  });

  it("expires terminals when a replacement daemon session opens before the old socket closes", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const stored = createTerminalSession(fixture.harness.db, {
      cols: 80,
      daemonSessionId: fixture.session.id,
      environmentId: fixture.environment.id,
      hostId: fixture.host.id,
      initialCwd: "/tmp/terminal-workspace",
      rows: 24,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });
    const browserSocket = createFakeBrowserSocket();
    fixture.harness.hub.registerTerminalClient(stored.id, browserSocket);

    const replacementSession = seedSession(
      fixture.harness.deps,
      fixture.host.id,
    );
    await handleHostSessionOpened(fixture.harness.deps, {
      activeThreads: [],
      hostId: fixture.host.id,
      openedSession: replacementSession,
      previousSession: fixture.session,
    });

    expect(
      listTerminalSessionsByThread(fixture.harness.db, fixture.thread.id),
    ).toEqual([
      expect.objectContaining({
        id: stored.id,
        daemonSessionId: null,
        status: "disconnected",
      }),
    ]);

    const replacementSocket = createFakeDaemonSocket();
    onDaemonSocketOpen(fixture.harness.deps, {
      hostId: fixture.host.id,
      sessionId: replacementSession.id,
      socket: replacementSocket,
    });

    expect(await waitForDaemonMessage(replacementSocket)).toEqual({
      type: "connect-shares.replace",
      generation: 0,
      ports: [],
    });
    const closeMessage = await waitForDaemonMessage(replacementSocket, 1);
    expect(closeMessage).toMatchObject({
      type: "terminal.close",
      terminalId: stored.id,
      reason: "daemon-disconnect",
    });
    expect(
      listTerminalSessionsByThread(fixture.harness.db, fixture.thread.id),
    ).toEqual([
      expect.objectContaining({
        id: stored.id,
        closeReason: "daemon-disconnect",
        daemonSessionId: null,
        status: "exited",
      }),
    ]);
    expect(readBrowserMessages(browserSocket)).toContainEqual(
      expect.objectContaining({
        type: "exited",
        session: expect.objectContaining({
          id: stored.id,
          closeReason: "daemon-disconnect",
          status: "exited",
        }),
      }),
    );
  });

  it("marks running terminals disconnected when their daemon socket closes", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const stored = createTerminalSession(fixture.harness.db, {
      cols: 80,
      daemonSessionId: fixture.session.id,
      environmentId: fixture.environment.id,
      hostId: fixture.host.id,
      initialCwd: "/tmp/terminal-workspace",
      rows: 24,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });
    const browserSocket = createFakeBrowserSocket();
    fixture.harness.hub.registerTerminalClient(stored.id, browserSocket);

    handleDaemonSocketClosed(fixture.harness.deps, {
      sessionId: fixture.session.id,
    });

    expect(
      listTerminalSessionsByThread(fixture.harness.db, fixture.thread.id),
    ).toEqual([
      expect.objectContaining({
        daemonSessionId: null,
        id: stored.id,
        status: "disconnected",
      }),
    ]);
    expect(readBrowserMessages(browserSocket)).toContainEqual(
      expect.objectContaining({
        type: "session-updated",
        session: expect.objectContaining({
          id: stored.id,
          status: "disconnected",
        }),
      }),
    );
  });

  it("closes terminal sessions when the owning thread is deleted", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const stored = createTerminalSession(fixture.harness.db, {
      cols: 80,
      daemonSessionId: fixture.session.id,
      environmentId: fixture.environment.id,
      hostId: fixture.host.id,
      initialCwd: "/tmp/terminal-workspace",
      rows: 24,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });
    const browserSocket = createFakeBrowserSocket();
    fixture.harness.hub.registerTerminalClient(stored.id, browserSocket);

    const response = await fixture.harness.app.request(
      `/api/v1/threads/${fixture.thread.id}`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ childThreadsConfirmed: false }),
      },
    );

    expect(response.status).toBe(200);
    const closeMessage = await waitForDaemonMessage(fixture.socket);
    expect(closeMessage).toMatchObject({
      type: "terminal.close",
      terminalId: stored.id,
      reason: "thread-deleted",
    });
    expect(
      listTerminalSessionsByThread(fixture.harness.db, fixture.thread.id),
    ).toEqual([]);
    expect(readBrowserMessages(browserSocket)).toContainEqual(
      expect.objectContaining({
        type: "exited",
        session: expect.objectContaining({
          id: stored.id,
          closeReason: "thread-deleted",
          status: "exited",
        }),
      }),
    );
  });

  it("closes terminal sessions when the owning thread is archived", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const stored = createTerminalSession(fixture.harness.db, {
      cols: 80,
      daemonSessionId: fixture.session.id,
      environmentId: fixture.environment.id,
      hostId: fixture.host.id,
      initialCwd: "/tmp/terminal-workspace",
      rows: 24,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });
    const browserSocket = createFakeBrowserSocket();
    fixture.harness.hub.registerTerminalClient(stored.id, browserSocket);

    const response = await fixture.harness.app.request(
      `/api/v1/threads/${fixture.thread.id}/archive`,
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(200);
    const closeMessage = await waitForDaemonMessage(fixture.socket);
    expect(closeMessage).toMatchObject({
      type: "terminal.close",
      terminalId: stored.id,
      reason: "thread-archived",
    });
    expect(
      listTerminalSessionsByThread(fixture.harness.db, fixture.thread.id),
    ).toEqual([
      expect.objectContaining({
        id: stored.id,
        closeReason: "thread-archived",
        daemonSessionId: null,
        status: "exited",
      }),
    ]);
    expect(readBrowserMessages(browserSocket)).toContainEqual(
      expect.objectContaining({
        type: "exited",
        session: expect.objectContaining({
          id: stored.id,
          closeReason: "thread-archived",
          status: "exited",
        }),
      }),
    );
  });

  it("serializes concurrent restarts and keeps the old terminal until replacement opens", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const stored = createTerminalSession(fixture.harness.db, {
      cols: 100,
      daemonSessionId: fixture.session.id,
      environmentId: fixture.environment.id,
      hostId: fixture.host.id,
      initialCwd: "/tmp/terminal-workspace",
      rows: 30,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });
    const restartRequest = () =>
      fixture.harness.app.request(`/api/v1/terminals/${stored.id}/restart`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });

    const firstResponsePromise = restartRequest();
    const secondResponsePromise = restartRequest();
    const openMessage = await waitForDaemonMessage(fixture.socket);
    if (openMessage.type !== "terminal.open") {
      throw new Error(`Expected terminal.open, received ${openMessage.type}`);
    }
    expect(
      getTerminalSession(fixture.harness.db, {
        kind: "terminal",
        terminalId: stored.id,
      }),
    ).toMatchObject({ status: "running" });
    acknowledgeTerminalOpen(fixture, openMessage);

    const closeMessage = await waitForDaemonMessage(fixture.socket, 1);
    expect(closeMessage).toMatchObject({
      type: "terminal.close",
      terminalId: stored.id,
      reason: "user",
    });
    fixture.harness.deps.terminalSessions.handleDaemonTerminalMessage({
      hostId: fixture.host.id,
      sessionId: fixture.session.id,
      message: {
        type: "terminal.exited",
        terminalId: stored.id,
        exitCode: 0,
        closeReason: "user",
      },
    });

    const [firstResponse, secondResponse] = await Promise.all([
      firstResponsePromise,
      secondResponsePromise,
    ]);
    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    const firstReplacement = terminalSessionSchema.parse(
      await readJson(firstResponse),
    );
    const secondReplacement = terminalSessionSchema.parse(
      await readJson(secondResponse),
    );
    expect(firstReplacement.id).toBe(openMessage.terminalId);
    expect(secondReplacement.id).toBe(openMessage.terminalId);
    expect(
      readDaemonMessages(fixture.socket).filter(
        (message) => message.type === "terminal.open",
      ),
    ).toHaveLength(1);
  });

  it("preserves the old terminal when restart cannot open a replacement", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const stored = createTerminalSession(fixture.harness.db, {
      cols: 100,
      daemonSessionId: fixture.session.id,
      environmentId: fixture.environment.id,
      hostId: fixture.host.id,
      initialCwd: "/tmp/terminal-workspace",
      rows: 30,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });
    const responsePromise = fixture.harness.app.request(
      `/api/v1/terminals/${stored.id}/restart`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const openMessage = await waitForDaemonMessage(fixture.socket);
    if (openMessage.type !== "terminal.open") {
      throw new Error(`Expected terminal.open, received ${openMessage.type}`);
    }
    fixture.harness.deps.terminalSessions.handleDaemonTerminalMessage({
      hostId: fixture.host.id,
      sessionId: fixture.session.id,
      message: {
        type: "terminal.error",
        requestId: openMessage.requestId,
        terminalId: openMessage.terminalId,
        code: "terminal_open_failed",
        message: "spawn failed",
      },
    });

    const response = await responsePromise;
    expect(response.status).toBe(502);
    expect(
      getTerminalSession(fixture.harness.db, {
        kind: "terminal",
        terminalId: stored.id,
      }),
    ).toMatchObject({ status: "running" });
    expect(
      readDaemonMessages(fixture.socket).filter(
        (message) => message.type === "terminal.close",
      ),
    ).toEqual([]);
  });

  it("closes a clean terminal through the public route when if-clean mode is requested", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const stored = createTerminalSession(fixture.harness.db, {
      cols: 80,
      daemonSessionId: fixture.session.id,
      environmentId: fixture.environment.id,
      hostId: fixture.host.id,
      initialCwd: "/tmp/terminal-workspace",
      rows: 24,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });

    const responsePromise = fixture.harness.app.request(
      `/api/v1/terminals/${stored.id}/close`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "if-clean", reason: "user" }),
      },
    );

    const closeMessage = await waitForDaemonMessage(fixture.socket);
    expect(closeMessage).toMatchObject({
      type: "terminal.close",
      terminalId: stored.id,
      reason: "user",
    });
    fixture.harness.deps.terminalSessions.handleDaemonTerminalMessage({
      hostId: fixture.host.id,
      sessionId: fixture.session.id,
      message: {
        type: "terminal.exited",
        terminalId: stored.id,
        exitCode: 0,
        closeReason: "user",
      },
    });

    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(terminalSessionSchema.parse(await readJson(response))).toMatchObject(
      {
        id: stored.id,
        closeReason: "user",
        status: "exited",
      },
    );
  });

  it("completes a terminal close when its daemon acknowledgement times out", async () => {
    const fixture = await createTerminalRouteFixture({
      terminalCloseTimeoutMs: 50,
    });
    harnesses.push(fixture.harness);
    const stored = createTerminalSession(fixture.harness.db, {
      cols: 80,
      daemonSessionId: fixture.session.id,
      environmentId: fixture.environment.id,
      hostId: fixture.host.id,
      initialCwd: "/tmp/terminal-workspace",
      rows: 24,
      status: "running",
      threadId: fixture.thread.id,
      title: "zsh",
    });

    const responsePromise = fixture.harness.app.request(
      `/api/v1/terminals/${stored.id}/close`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "force", reason: "user" }),
      },
    );

    await expect(waitForDaemonMessage(fixture.socket)).resolves.toMatchObject({
      type: "terminal.close",
      terminalId: stored.id,
      reason: "user",
    });
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(terminalSessionSchema.parse(await readJson(response))).toMatchObject(
      {
        id: stored.id,
        closeReason: "user",
        exitCode: null,
        status: "exited",
      },
    );
    expect(
      getTerminalSessionForThread(fixture.harness.db, {
        terminalId: stored.id,
        threadId: fixture.thread.id,
      }),
    ).toMatchObject({
      closeReason: "user",
      daemonSessionId: null,
      exitCode: null,
      status: "exited",
    });
  });

  it("keeps an undeliverable terminal close available for reconnect cleanup", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const stored = createTerminalSession(fixture.harness.db, {
      cols: 80,
      daemonSessionId: fixture.session.id,
      environmentId: fixture.environment.id,
      hostId: fixture.host.id,
      initialCwd: "/tmp/terminal-workspace",
      rows: 24,
      status: "running",
      threadId: fixture.thread.id,
      title: "zsh",
    });
    fixture.harness.hub.unregisterDaemon(fixture.session.id);

    const response = await fixture.harness.app.request(
      `/api/v1/terminals/${stored.id}/close`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "force", reason: "user" }),
      },
    );

    expect(response.status).toBe(502);
    expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
      code: "host_disconnected",
    });
    expect(
      getTerminalSessionForThread(fixture.harness.db, {
        terminalId: stored.id,
        threadId: fixture.thread.id,
      }),
    ).toMatchObject({
      closeReason: null,
      daemonSessionId: null,
      status: "disconnected",
    });

    const replacementSession = seedSession(
      fixture.harness.deps,
      fixture.host.id,
    );
    const replacementSocket = createFakeDaemonSocket();
    onDaemonSocketOpen(fixture.harness.deps, {
      hostId: fixture.host.id,
      sessionId: replacementSession.id,
      socket: replacementSocket,
    });

    expect(await waitForDaemonMessage(replacementSocket)).toEqual({
      type: "connect-shares.replace",
      generation: 0,
      ports: [],
    });
    await expect(
      waitForDaemonMessage(replacementSocket, 1),
    ).resolves.toMatchObject({
      type: "terminal.close",
      terminalId: stored.id,
      reason: "daemon-disconnect",
    });
    expect(
      getTerminalSessionForThread(fixture.harness.db, {
        terminalId: stored.id,
        threadId: fixture.thread.id,
      }),
    ).toMatchObject({
      closeReason: "daemon-disconnect",
      daemonSessionId: null,
      status: "exited",
    });
  });

  it("does not close a dirty terminal unless force mode is requested", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const stored = createTerminalSession(fixture.harness.db, {
      cols: 80,
      daemonSessionId: fixture.session.id,
      environmentId: fixture.environment.id,
      hostId: fixture.host.id,
      initialCwd: "/tmp/terminal-workspace",
      rows: 24,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });
    markTerminalSessionUserInput(fixture.harness.db, {
      terminalId: stored.id,
      threadId: fixture.thread.id,
      now: 10,
    });

    const response = await fixture.harness.app.request(
      `/api/v1/terminals/${stored.id}/close`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "if-clean", reason: "user" }),
      },
    );

    expect(response.status).toBe(200);
    expect(terminalSessionSchema.parse(await readJson(response))).toMatchObject(
      {
        id: stored.id,
        lastUserInputAt: 10,
        status: "running",
      },
    );
    expect(fixture.socket.sentMessages).toEqual([]);

    const forceResponsePromise = fixture.harness.app.request(
      `/api/v1/terminals/${stored.id}/close`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "force", reason: "user" }),
      },
    );

    const closeMessage = await waitForDaemonMessage(fixture.socket);
    expect(closeMessage).toMatchObject({
      type: "terminal.close",
      terminalId: stored.id,
      reason: "user",
    });
    fixture.harness.deps.terminalSessions.handleDaemonTerminalMessage({
      hostId: fixture.host.id,
      sessionId: fixture.session.id,
      message: {
        type: "terminal.exited",
        terminalId: stored.id,
        exitCode: 0,
        closeReason: "user",
      },
    });

    const forceResponse = await forceResponsePromise;
    expect(forceResponse.status).toBe(200);
    expect(
      terminalSessionSchema.parse(await readJson(forceResponse)),
    ).toMatchObject({
      id: stored.id,
      closeReason: "user",
      lastUserInputAt: 10,
      status: "exited",
    });
  });

  it("restores resize ownership when a newer browser attach fails", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const stored = createTerminalSession(fixture.harness.db, {
      cols: 80,
      daemonSessionId: fixture.session.id,
      environmentId: fixture.environment.id,
      hostId: fixture.host.id,
      initialCwd: "/tmp/terminal-workspace",
      rows: 24,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });
    const firstSocket = createFakeBrowserSocket();
    const secondSocket = createFakeBrowserSocket();

    fixture.harness.deps.terminalSessions.attachBrowserTerminal({
      threadId: fixture.thread.id,
      terminalId: stored.id,
      socket: firstSocket,
      sinceSeq: 0,
    });
    const firstAttach = await waitForDaemonMessage(fixture.socket, 0);
    if (firstAttach.type !== "terminal.attach") {
      throw new Error(`Expected terminal.attach, received ${firstAttach.type}`);
    }
    fixture.harness.deps.terminalSessions.handleDaemonTerminalMessage({
      hostId: fixture.host.id,
      sessionId: fixture.session.id,
      message: {
        type: "terminal.replay",
        requestId: firstAttach.requestId,
        terminalId: stored.id,
        chunks: [],
        replayStartSeq: 0,
        nextSeq: 0,
      },
    });

    fixture.harness.deps.terminalSessions.attachBrowserTerminal({
      threadId: fixture.thread.id,
      terminalId: stored.id,
      socket: secondSocket,
      sinceSeq: 0,
    });
    const secondAttach = await waitForDaemonMessage(fixture.socket, 1);
    if (secondAttach.type !== "terminal.attach") {
      throw new Error(
        `Expected terminal.attach, received ${secondAttach.type}`,
      );
    }
    fixture.harness.deps.terminalSessions.handleDaemonTerminalMessage({
      hostId: fixture.host.id,
      sessionId: fixture.session.id,
      message: {
        type: "terminal.error",
        requestId: secondAttach.requestId,
        terminalId: stored.id,
        code: "terminal_attach_failed",
        message: "attach failed",
      },
    });

    fixture.harness.deps.terminalSessions.handleBrowserTerminalMessage({
      threadId: fixture.thread.id,
      terminalId: stored.id,
      socket: firstSocket,
      message: { type: "resize", cols: 120, rows: 40 },
    });

    expect(await waitForDaemonMessage(fixture.socket, 2)).toMatchObject({
      type: "terminal.resize",
      terminalId: stored.id,
      cols: 120,
      rows: 40,
    });
  });

  it("streams terminal traffic between browser sockets and the owning daemon", async () => {
    const fixture = await createTerminalRouteFixture();
    harnesses.push(fixture.harness);
    const stored = createTerminalSession(fixture.harness.db, {
      cols: 80,
      daemonSessionId: fixture.session.id,
      environmentId: fixture.environment.id,
      hostId: fixture.host.id,
      initialCwd: "/tmp/terminal-workspace",
      rows: 24,
      status: "running",
      threadId: fixture.thread.id,
      title: "Terminal 1",
    });
    const browserSocket = createFakeBrowserSocket();

    fixture.harness.deps.terminalSessions.attachBrowserTerminal({
      threadId: fixture.thread.id,
      terminalId: stored.id,
      socket: browserSocket,
      sinceSeq: 0,
    });
    const attachMessage = await waitForDaemonMessage(fixture.socket);
    if (attachMessage.type !== "terminal.attach") {
      throw new Error(
        `Expected terminal.attach, received ${attachMessage.type}`,
      );
    }
    expect(attachMessage).toMatchObject({
      terminalId: stored.id,
      sinceSeq: 0,
      tailBytes: 512 * 1024,
    });

    const replayChunk = {
      seq: 0,
      dataBase64: Buffer.from("hello\n", "utf8").toString("base64"),
    };
    fixture.harness.deps.terminalSessions.handleDaemonTerminalMessage({
      hostId: fixture.host.id,
      sessionId: fixture.session.id,
      message: {
        type: "terminal.output",
        terminalId: stored.id,
        chunk: replayChunk,
      },
    });
    expect(readBrowserMessages(browserSocket)).toEqual([]);

    fixture.harness.deps.terminalSessions.handleDaemonTerminalMessage({
      hostId: fixture.host.id,
      sessionId: fixture.session.id,
      message: {
        type: "terminal.replay",
        requestId: attachMessage.requestId,
        terminalId: stored.id,
        chunks: [replayChunk],
        replayStartSeq: 0,
        nextSeq: 1,
      },
    });
    expect(readBrowserMessages(browserSocket)).toEqual([
      expect.objectContaining({
        type: "attached",
        replayStartSeq: 0,
        nextSeq: 1,
        session: expect.objectContaining({ id: stored.id }),
      }),
      { type: "output", chunk: replayChunk },
    ]);

    const liveChunk = {
      seq: 1,
      dataBase64: Buffer.from("world\n", "utf8").toString("base64"),
    };
    fixture.harness.deps.terminalSessions.handleDaemonTerminalMessage({
      hostId: fixture.host.id,
      sessionId: fixture.session.id,
      message: {
        type: "terminal.output",
        terminalId: stored.id,
        chunk: liveChunk,
      },
    });
    expect(readBrowserMessages(browserSocket)).toContainEqual({
      type: "output",
      chunk: liveChunk,
    });

    fixture.harness.deps.terminalSessions.handleBrowserTerminalMessage({
      threadId: fixture.thread.id,
      terminalId: stored.id,
      socket: browserSocket,
      message: {
        type: "input",
        dataBase64: Buffer.from("pwd\n", "utf8").toString("base64"),
      },
    });
    const inputMessage = await waitForDaemonMessage(fixture.socket, 1);
    expect(inputMessage).toMatchObject({
      type: "terminal.input",
      terminalId: stored.id,
      dataBase64: Buffer.from("pwd\n", "utf8").toString("base64"),
    });
    expect(
      getTerminalSessionForThread(fixture.harness.db, {
        terminalId: stored.id,
        threadId: fixture.thread.id,
      })?.lastUserInputAt,
    ).toBeTypeOf("number");
    expect(readBrowserMessages(browserSocket)).toContainEqual(
      expect.objectContaining({
        type: "session-updated",
        session: expect.objectContaining({
          id: stored.id,
          lastUserInputAt: expect.any(Number),
        }),
      }),
    );

    fixture.harness.deps.terminalSessions.handleBrowserTerminalMessage({
      threadId: fixture.thread.id,
      terminalId: stored.id,
      socket: browserSocket,
      message: {
        type: "resize",
        cols: 120,
        rows: 40,
      },
    });
    const resizeMessage = await waitForDaemonMessage(fixture.socket, 2);
    expect(resizeMessage).toMatchObject({
      type: "terminal.resize",
      terminalId: stored.id,
      cols: 120,
      rows: 40,
    });
    expect(readBrowserMessages(browserSocket)).toContainEqual(
      expect.objectContaining({
        type: "session-updated",
        session: expect.objectContaining({
          id: stored.id,
          cols: 120,
          rows: 40,
        }),
      }),
    );

    fixture.harness.deps.terminalSessions.handleBrowserTerminalMessage({
      threadId: fixture.thread.id,
      terminalId: stored.id,
      socket: browserSocket,
      message: {
        type: "close",
        reason: "user",
      },
    });
    const closeMessage = await waitForDaemonMessage(fixture.socket, 3);
    expect(closeMessage).toMatchObject({
      type: "terminal.close",
      terminalId: stored.id,
      reason: "user",
    });
    const finalChunk = {
      seq: 2,
      dataBase64: Buffer.from("final output\n", "utf8").toString("base64"),
    };
    fixture.harness.deps.terminalSessions.handleDaemonTerminalMessage({
      hostId: fixture.host.id,
      sessionId: fixture.session.id,
      message: {
        type: "terminal.output",
        terminalId: stored.id,
        chunk: finalChunk,
      },
    });
    fixture.harness.deps.terminalSessions.handleDaemonTerminalMessage({
      hostId: fixture.host.id,
      sessionId: fixture.session.id,
      message: {
        type: "terminal.exited",
        terminalId: stored.id,
        exitCode: 0,
        closeReason: "user",
      },
    });
    const closingMessages = readBrowserMessages(browserSocket).slice(-2);
    expect(closingMessages).toEqual([
      { type: "output", chunk: finalChunk },
      expect.objectContaining({
        type: "exited",
        session: expect.objectContaining({
          id: stored.id,
          closeReason: "user",
          status: "exited",
        }),
      }),
    ]);

    fixture.harness.deps.terminalSessions.handleDaemonTerminalMessage({
      hostId: fixture.host.id,
      sessionId: fixture.session.id,
      message: {
        type: "terminal.output",
        terminalId: stored.id,
        chunk: {
          seq: 3,
          dataBase64: Buffer.from("stale", "utf8").toString("base64"),
        },
      },
    });
    expect(readBrowserMessages(browserSocket).slice(-2)).toEqual(
      closingMessages,
    );
  });
});
