import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  BROWSER_AUTOMATION_DEFAULT_TIMEOUT_MS,
  browserAutomationCloseMessageSchema,
  browserAutomationCommandMessageSchema,
  browserAutomationOpenMessageSchema,
  type BrowserAutomationOpenMessage,
} from "@bb/domain";
import { seedThreadFixture } from "../helpers/seed.js";
import {
  startTestServer,
  type RunningTestServer,
} from "../helpers/test-app.js";

interface DesktopRendererClient {
  close(): Promise<void>;
  nextMessage(): Promise<unknown>;
  send(message: unknown): void;
  socket: WebSocket;
  waitForClose(): Promise<{ code: number; reason: string }>;
}

const clients = new Set<DesktopRendererClient>();
let server: RunningTestServer | null = null;

function websocketUrl(baseUrl: string): string {
  const url = new URL("/ws", baseUrl);
  url.protocol = "ws:";
  return url.href;
}

async function connectRenderer(
  running: RunningTestServer,
): Promise<DesktopRendererClient> {
  const socket = new WebSocket(websocketUrl(running.baseUrl), {
    origin: running.baseUrl,
  });
  const queue: unknown[] = [];
  const waiters: Array<(message: unknown) => void> = [];
  let closeResult: { code: number; reason: string } | null = null;
  const closeWaiters: Array<(result: { code: number; reason: string }) => void> =
    [];
  socket.on("message", (data) => {
    const message: unknown = JSON.parse(data.toString());
    const waiter = waiters.shift();
    if (waiter) {
      waiter(message);
      return;
    }
    queue.push(message);
  });
  socket.on("close", (code, reason) => {
    closeResult = { code, reason: reason.toString() };
    for (const waiter of closeWaiters.splice(0)) {
      waiter(closeResult);
    }
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  const client: DesktopRendererClient = {
    socket,
    send(message) {
      socket.send(JSON.stringify(message));
    },
    nextMessage() {
      const queued = queue.shift();
      if (queued !== undefined) {
        return Promise.resolve(queued);
      }
      return new Promise<unknown>((resolve) => {
        waiters.push(resolve);
      });
    },
    waitForClose() {
      if (closeResult !== null) {
        return Promise.resolve(closeResult);
      }
      return new Promise((resolve) => {
        closeWaiters.push(resolve);
      });
    },
    async close() {
      if (socket.readyState === WebSocket.CLOSED) {
        return;
      }
      const closed = client.waitForClose();
      socket.close();
      await closed;
    },
  };
  clients.add(client);
  return client;
}

async function subscribeThread(
  client: DesktopRendererClient,
  threadId: string,
): Promise<void> {
  client.send({
    type: "subscribe",
    target: { kind: "thread-detail", threadId },
  });
  client.send({ type: "ping" });
  await expect(client.nextMessage()).resolves.toEqual({ type: "pong" });
}

afterEach(async () => {
  for (const client of clients) {
    client.socket.terminate();
  }
  clients.clear();
  if (server !== null) {
    await server.close();
    server = null;
  }
});

describe("browser automation over the realtime websocket", () => {
  it("runs the open, list, close lifecycle against a capability-advertising desktop renderer", async () => {
    server = await startTestServer();
    const { host, thread } = seedThreadFixture(server);
    const renderer = await connectRenderer(server);
    await subscribeThread(renderer, thread.id);
    renderer.send({
      type: "browser-automation.capability",
      windowId: "window-real",
    });
    renderer.send({ type: "ping" });
    await expect(renderer.nextMessage()).resolves.toEqual({ type: "pong" });

    const opening = server.deps.browserAutomation.open({
      threadId: thread.id,
      timeoutMs: BROWSER_AUTOMATION_DEFAULT_TIMEOUT_MS,
      url: "https://example.test/app",
    });
    const request: BrowserAutomationOpenMessage =
      browserAutomationOpenMessageSchema.parse(await renderer.nextMessage());
    expect(request).toMatchObject({
      threadId: thread.id,
      url: "https://example.test/app",
    });
    renderer.send({
      type: "browser-automation.open-ready",
      requestId: request.requestId,
      targetId: request.targetId,
      windowId: "window-real",
      tabId: "browser:automation-1",
      url: "https://example.test/app",
    });
    const target = await opening;
    expect(target).toMatchObject({
      targetId: request.targetId,
      threadId: thread.id,
      hostId: host.id,
      status: "ready",
    });
    expect(server.deps.browserAutomation.list({ threadId: thread.id })).toEqual(
      [target],
    );

    const closed = server.deps.browserAutomation.close({
      threadId: thread.id,
      targetId: target.targetId,
    });
    expect(closed.status).toBe("closed");
    expect(
      browserAutomationCloseMessageSchema.parse(await renderer.nextMessage()),
    ).toEqual({ type: "browser-automation.close", targetId: target.targetId });
    expect(server.deps.browserAutomation.list({ threadId: thread.id })).toEqual(
      [],
    );
  });

  it("coordinates command results and renderer Stop over the validated websocket boundary", async () => {
    server = await startTestServer();
    const { thread } = seedThreadFixture(server);
    const renderer = await connectRenderer(server);
    await subscribeThread(renderer, thread.id);
    renderer.send({
      type: "browser-automation.capability",
      windowId: "window-real",
    });
    renderer.send({ type: "ping" });
    await renderer.nextMessage();

    const opening = server.deps.browserAutomation.open({
      threadId: thread.id,
      url: "https://example.test/",
    });
    const open = browserAutomationOpenMessageSchema.parse(
      await renderer.nextMessage(),
    );
    renderer.send({
      type: "browser-automation.open-ready",
      requestId: open.requestId,
      targetId: open.targetId,
      windowId: "window-real",
      tabId: "browser:automation-1",
      url: "https://example.test/",
    });
    await opening;

    const running = server.deps.browserAutomation.run({
      threadId: thread.id,
      targetId: open.targetId,
      timeoutMs: 1_000,
      command: { kind: "press", key: "Enter" },
    });
    const command = browserAutomationCommandMessageSchema.parse(
      await renderer.nextMessage(),
    );
    expect(command).toMatchObject({
      targetId: open.targetId,
      windowId: "window-real",
      tabId: "browser:automation-1",
      navigationEpoch: 0,
      timeoutMs: 1_000,
      command: { kind: "press", key: "Enter" },
    });
    renderer.send({
      type: "browser-automation.command-result",
      commandId: command.commandId,
      targetId: command.targetId,
      windowId: command.windowId,
      tabId: command.tabId,
      result: {
        kind: "state",
        navigationEpoch: 0,
        ready: true,
        url: "https://example.test/next",
      },
    });
    await expect(running).resolves.toMatchObject({
      kind: "state",
      url: "https://example.test/next",
    });

    const waiting = server.deps.browserAutomation.run({
      threadId: thread.id,
      targetId: open.targetId,
      command: { kind: "wait", text: "Saved" },
    });
    const waitCommand = browserAutomationCommandMessageSchema.parse(
      await renderer.nextMessage(),
    );
    renderer.send({
      type: "browser-automation.cancel-request",
      commandId: waitCommand.commandId,
      targetId: waitCommand.targetId,
      windowId: waitCommand.windowId,
      tabId: waitCommand.tabId,
    });
    await expect(waiting).rejects.toMatchObject({
      body: { code: "browser_command_cancelled" },
    });
    await expect(renderer.nextMessage()).resolves.toMatchObject({
      type: "browser-automation.cancel",
      commandId: waitCommand.commandId,
      targetId: open.targetId,
    });
    expect(server.deps.browserAutomation.list({ threadId: thread.id })).toHaveLength(1);
  });

  it("gives older clients an update error and retires targets when the renderer disconnects", async () => {
    server = await startTestServer();
    const { thread } = seedThreadFixture(server);
    const legacy = await connectRenderer(server);
    await subscribeThread(legacy, thread.id);

    await expect(
      server.deps.browserAutomation.open({
        threadId: thread.id,
        timeoutMs: BROWSER_AUTOMATION_DEFAULT_TIMEOUT_MS,
        url: "https://example.test/",
      }),
    ).rejects.toMatchObject({
      body: {
        code: "browser_client_unavailable",
        details: { reason: "incompatible" },
      },
    });

    const renderer = await connectRenderer(server);
    await subscribeThread(renderer, thread.id);
    renderer.send({
      type: "browser-automation.capability",
      windowId: "window-real",
    });
    renderer.send({ type: "ping" });
    await expect(renderer.nextMessage()).resolves.toEqual({ type: "pong" });
    const opening = server.deps.browserAutomation.open({
      threadId: thread.id,
      timeoutMs: BROWSER_AUTOMATION_DEFAULT_TIMEOUT_MS,
      url: "https://example.test/",
    });
    const rejectedOpening = expect(opening).rejects.toMatchObject({
      body: {
        code: "browser_client_unavailable",
        details: { reason: "disconnected" },
      },
    });
    browserAutomationOpenMessageSchema.parse(await renderer.nextMessage());

    await renderer.close();
    await rejectedOpening;
    expect(server.deps.browserAutomation.list({ threadId: thread.id })).toEqual(
      [],
    );
    expect(legacy.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("retires targets and stops selecting a renderer that withdraws capability", async () => {
    server = await startTestServer();
    const { thread } = seedThreadFixture(server);
    const renderer = await connectRenderer(server);
    await subscribeThread(renderer, thread.id);
    renderer.send({
      type: "browser-automation.capability",
      windowId: "window-real",
    });
    renderer.send({ type: "ping" });
    await expect(renderer.nextMessage()).resolves.toEqual({ type: "pong" });

    const opening = server.deps.browserAutomation.open({
      threadId: thread.id,
      timeoutMs: BROWSER_AUTOMATION_DEFAULT_TIMEOUT_MS,
      url: "https://example.test/",
    });
    browserAutomationOpenMessageSchema.parse(await renderer.nextMessage());
    renderer.send({ type: "browser-automation.capability-unavailable" });

    await expect(opening).rejects.toMatchObject({
      body: {
        code: "browser_client_unavailable",
        details: { reason: "disconnected" },
      },
    });
    expect(server.deps.browserAutomation.list({ threadId: thread.id })).toEqual(
      [],
    );
    await expect(
      server.deps.browserAutomation.open({
        threadId: thread.id,
        timeoutMs: BROWSER_AUTOMATION_DEFAULT_TIMEOUT_MS,
        url: "https://example.test/",
      }),
    ).rejects.toMatchObject({
      body: {
        code: "browser_client_unavailable",
        details: { reason: "incompatible" },
      },
    });
    expect(renderer.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("closes sockets that send malformed browser automation messages", async () => {
    server = await startTestServer();
    const renderer = await connectRenderer(server);
    renderer.send({
      type: "browser-automation.open-ready",
      requestId: "req",
      targetId: "bt_forged",
      windowId: "window-real",
      tabId: "browser:user-tab",
      url: "https://example.test/",
      threadId: "thr_forged",
    });
    await expect(renderer.waitForClose()).resolves.toEqual({
      code: 1008,
      reason: "invalid-message",
    });
  });
});
