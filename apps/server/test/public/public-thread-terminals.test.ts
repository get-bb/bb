import {
  createTerminalSession,
  getTerminalSessionForThread,
  listTerminalSessionsByThread,
  markDaemonTerminalSessionsDisconnected,
  markEnvironmentTerminalSessionsExited,
  markTerminalSessionExited,
  markTerminalSessionUserInput,
  markThreadTerminalSessionsExited,
} from "@bb/db";
import type { EnvironmentStatus } from "@bb/domain";
import {
  hostDaemonServerWsMessageSchema,
  type HostDaemonServerWsMessage,
} from "@bb/host-daemon-contract";
import {
  apiErrorSchema,
  terminalServerMessageSchema,
  terminalOutputResponseSchema,
  type TerminalServerMessage,
  terminalSessionSchema,
  threadTerminalListResponseSchema,
} from "@bb/server-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHost,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../helpers/test-app.js";
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
  const harness = await createTestAppHarness();
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
    fixture.harness.app.request(
      `/api/v1/threads/${fixture.thread.id}/terminals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cols: 100, rows: 30 }),
      },
    ),
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
      initialCwd: "/tmp/terminal-workspace",
      cols: 100,
      rows: 30,
    },
  });
}

describe("public thread terminal routes", () => {
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
      `/api/v1/threads/${fixture.thread.id}/terminals`,
    );

    expect(response.status).toBe(200);
    const body = threadTerminalListResponseSchema.parse(
      await readJson(response),
    );
    expect(body.sessions).toEqual([
      expect.objectContaining({
        id: stored.id,
        status: "running",
        title: "Terminal 1",
      }),
    ]);
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

    const response = await harness.app.request(
      `/api/v1/threads/${thread.id}/terminals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cols: 80, rows: 24 }),
      },
    );

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

    const responsePromise = fixture.harness.app.request(
      `/api/v1/threads/${fixture.thread.id}/terminals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cols: 100, rows: 30 }),
      },
    );
    const openMessage = await waitForDaemonMessage(fixture.socket);
    if (openMessage.type !== "terminal.open") {
      throw new Error(`Expected terminal.open, received ${openMessage.type}`);
    }
    expect(openMessage).toMatchObject({
      cols: 100,
      environmentId: fixture.environment.id,
      rows: 30,
      threadId: fixture.thread.id,
      workspaceContext: {
        workspacePath: "/tmp/terminal-workspace",
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

    const responsePromise = fixture.harness.app.request(
      `/api/v1/threads/${fixture.thread.id}/terminals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cols: 100,
          rows: 30,
          start: { mode: "command", command: "pnpm dev" },
        }),
      },
    );
    const openMessage = await waitForDaemonMessage(fixture.socket);
    if (openMessage.type !== "terminal.open") {
      throw new Error(`Expected terminal.open, received ${openMessage.type}`);
    }
    expect(openMessage).toMatchObject({
      projectId: fixture.thread.projectId,
      start: { mode: "command", command: "pnpm dev" },
      threadStoragePath: expect.stringContaining(fixture.thread.id),
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
      `/api/v1/threads/${fixture.thread.id}/terminals/${session.id}/input`,
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
      `/api/v1/threads/${fixture.thread.id}/terminals/${session.id}/resize`,
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
      `/api/v1/threads/${fixture.thread.id}/terminals/${session.id}/output?sinceSeq=2&limitChunks=1&tailBytes=3`,
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
      `/api/v1/threads/${fixture.thread.id}/terminals/${session.id}/output`,
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

    const response = await fixture.harness.app.request(
      `/api/v1/threads/${fixture.thread.id}/terminals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cols: 80, rows: 24 }),
      },
    );

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

    const closeMessage = await waitForDaemonMessage(replacementSocket);
    expect(closeMessage).toMatchObject({
      type: "terminal.close",
      terminalId: stored.id,
      reason: "daemon-disconnect",
    });
    expect(replacementSocket.sentMessages).toHaveLength(1);
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

    const response = await fixture.harness.app.request(
      `/api/v1/threads/${fixture.thread.id}/terminals/${stored.id}/close`,
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
        closeReason: "user",
        status: "exited",
      },
    );
    const closeMessage = await waitForDaemonMessage(fixture.socket);
    expect(closeMessage).toMatchObject({
      type: "terminal.close",
      terminalId: stored.id,
      reason: "user",
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
      `/api/v1/threads/${fixture.thread.id}/terminals/${stored.id}/close`,
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

    const forceResponse = await fixture.harness.app.request(
      `/api/v1/threads/${fixture.thread.id}/terminals/${stored.id}/close`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "force", reason: "user" }),
      },
    );

    expect(forceResponse.status).toBe(200);
    expect(
      terminalSessionSchema.parse(await readJson(forceResponse)),
    ).toMatchObject({
      id: stored.id,
      closeReason: "user",
      lastUserInputAt: 10,
      status: "exited",
    });
    const closeMessage = await waitForDaemonMessage(fixture.socket);
    expect(closeMessage).toMatchObject({
      type: "terminal.close",
      terminalId: stored.id,
      reason: "user",
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
    });

    const replayChunk = {
      seq: 0,
      dataBase64: Buffer.from("hello\n", "utf8").toString("base64"),
    };
    fixture.harness.deps.terminalSessions.handleDaemonTerminalMessage({
      hostId: fixture.host.id,
      sessionId: fixture.session.id,
      message: {
        type: "terminal.replay",
        requestId: attachMessage.requestId,
        terminalId: stored.id,
        chunks: [replayChunk],
        nextSeq: 1,
      },
    });
    expect(readBrowserMessages(browserSocket)).toEqual([
      expect.objectContaining({
        type: "attached",
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
    expect(readBrowserMessages(browserSocket)).toContainEqual(
      expect.objectContaining({
        type: "exited",
        session: expect.objectContaining({
          id: stored.id,
          closeReason: "user",
          status: "exited",
        }),
      }),
    );
  });
});
