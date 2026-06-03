import type { RawData } from "ws";
import { WebSocket } from "ws";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  buildHostDaemonWebSocketAuthorizationHeader,
  buildHostDaemonWebSocketProtocols,
  createHostDaemonClient,
  type HostDaemonCommandEnvelope,
} from "@bb/host-daemon-contract";
import { createBrowserBbSdk, type AppRealtimeEvent } from "@bb/sdk/browser";
import { createPublicApiClient } from "@bb/server-contract";
import { turnScope, type AppChangeKind } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { createTestDaemonEventEnvelope } from "../helpers/commands.js";
import {
  createTestDaemonHostKey,
  startTestServer,
} from "../helpers/test-app.js";

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

class SdkWebSocketAdapter {
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  private readonly socket: WebSocket;

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on("open", () => {
      this.onopen?.(new Event("open"));
    });
    this.socket.on("message", (data) => {
      this.onmessage?.(
        new MessageEvent("message", { data: data.toString("utf8") }),
      );
    });
    this.socket.on("close", (code, reason) => {
      this.onclose?.(
        new CloseEvent("close", {
          code,
          reason: reason.toString("utf8"),
        }),
      );
    });
    this.socket.on("error", () => {
      this.onerror?.(new Event("error"));
    });
  }

  get readyState(): number {
    return this.socket.readyState;
  }

  close(): void {
    this.socket.close();
  }

  send(data: string): void {
    this.socket.send(data);
  }
}

interface AppBroadcastHub {
  notifyApp(changes: AppChangeKind[]): void;
}

interface WaitForSdkAppSubscriptionArgs {
  hub: AppBroadcastHub;
  waitForNextAppMessage: () => Promise<AppRealtimeEvent>;
}

function waitForClose(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("close", () => resolve());
    socket.once("error", reject);
  });
}

function waitForMatchingMessage<T>(
  socket: WebSocket,
  matches: (message: unknown) => message is T,
  timeoutMs = 3_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      socket.off("error", onError);
      reject(new Error("Timed out waiting for websocket message"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onMessage = (data: RawData) => {
      const message = JSON.parse(data.toString("utf8")) as unknown;
      if (!matches(message)) {
        return;
      }
      cleanup();
      resolve(message);
    };

    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}

async function waitForThreadSubscription(
  hub: { notifyThread(threadId: string, changes: string[]): void },
  socket: WebSocket,
  threadId: string,
): Promise<void> {
  const readyMessage = waitForMatchingMessage<{
    changes: string[];
    entity: string;
    id?: string;
  }>(
    socket,
    (
      message,
    ): message is { changes: string[]; entity: string; id?: string } => {
      if (message == null || typeof message !== "object") {
        return false;
      }
      const record = message as Record<string, unknown>;
      return (
        record.entity === "thread" &&
        record.id === threadId &&
        Array.isArray(record.changes) &&
        record.changes.includes("status-changed")
      );
    },
    2_000,
  );
  const interval = setInterval(() => {
    hub.notifyThread(threadId, ["status-changed"]);
  }, 25);

  try {
    hub.notifyThread(threadId, ["status-changed"]);
    await readyMessage;
  } finally {
    clearInterval(interval);
  }
}

async function waitForSdkAppSubscription(
  args: WaitForSdkAppSubscriptionArgs,
): Promise<void> {
  const readyMessage = args.waitForNextAppMessage();
  const interval = setInterval(() => {
    args.hub.notifyApp(["apps-changed"]);
  }, 25);

  try {
    args.hub.notifyApp(["apps-changed"]);
    await readyMessage;
  } finally {
    clearInterval(interval);
  }
}

async function fetchSingleCommand(
  daemonClient: ReturnType<typeof createHostDaemonClient>,
  sessionId: string,
  afterCursor?: number,
): Promise<HostDaemonCommandEnvelope> {
  const response = await daemonClient.session.commands.$get({
    query: {
      sessionId,
      limit: "100",
      waitMs: "0",
    },
  });
  expect(response.status).toBe(200);
  const body = await response.json();
  if (!body) {
    throw new Error("Expected response body");
  }
  const commands =
    afterCursor == null
      ? body.commands
      : body.commands.filter((command) => command.cursor > afterCursor);
  expect(commands).toHaveLength(1);
  return commands[0];
}

describe("server integration", () => {
  it("closes active websocket clients during server shutdown", async () => {
    const server = await startTestServer();
    let serverClosed = false;

    try {
      const socket = new WebSocket(
        `${server.baseUrl.replace("http", "ws")}/ws`,
      );
      await waitForOpen(socket);

      const closePromise = waitForClose(socket);
      await server.close();
      serverClosed = true;
      await closePromise;

      expect(socket.readyState).toBe(WebSocket.CLOSED);
    } finally {
      if (!serverClosed) {
        await server.close();
      }
    }
  });

  it("runs session open -> thread creation -> command fetch -> result report -> state update", async () => {
    const server = await startTestServer();
    try {
      const daemonClient = createHostDaemonClient(
        server.baseUrl,
        createTestDaemonHostKey(),
      );
      const publicClient = createPublicApiClient(server.baseUrl);

      const sessionResponse = await daemonClient.session.open.$post({
        json: {
          hostId: "host-1",
          instanceId: "instance-1",
          hostName: "Test Host",
          hostType: "persistent",
          dataDir: "/tmp/host-1-data",
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          activeThreads: [],
        },
      });
      expect(sessionResponse.status).toBe(201);
      const session = await sessionResponse.json();

      const projectResponse = await publicClient.projects.$post({
        json: {
          name: "Test Project",
          source: {
            type: "local_path",
            hostId: "host-1",
            path: "/tmp/project-root",
          },
        },
      });
      const project = await projectResponse.json();

      const threadResponse = await publicClient.threads.$post({
        json: {
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [{ type: "text", text: "Build the feature" }],
          environment: {
            type: "host",
            hostId: "host-1",
            workspace: { type: "unmanaged", path: null },
          },
        },
      });
      expect(threadResponse.status).toBe(201);
      const thread = await threadResponse.json();

      const provisionCommand = await fetchSingleCommand(
        daemonClient,
        session.sessionId,
      );
      expect(provisionCommand.command.type).toBe("environment.provision");

      const resultResponse = await daemonClient.session["command-result"].$post(
        {
          json: {
            sessionId: session.sessionId,
            attemptId: provisionCommand.attemptId,
            commandId: provisionCommand.id,
            completedAt: Date.now(),
            type: "environment.provision",
            ok: true,
            result: {
              path: "/tmp/project-root",
              branchName: "bb/test",
              defaultBranch: "main",
              isGitRepo: true,
              isWorktree: false,
              transcript: [],
            },
          },
        },
      );
      expect(resultResponse.status).toBe(200);

      const threadGetResponse = await publicClient.threads[":id"].$get({
        param: { id: thread.id },
      });
      const updatedThread = await threadGetResponse.json();
      expect(updatedThread.status).toBe("provisioning");
      if (!updatedThread.environmentId) {
        throw new Error("Expected updated thread environmentId");
      }

      const environmentGetResponse = await publicClient.environments[
        ":id"
      ].$get({
        param: { id: updatedThread.environmentId },
      });
      const environment = await environmentGetResponse.json();
      if (!("status" in environment)) {
        throw new Error("Expected environment payload with status");
      }
      expect(environment.status).toBe("ready");

      const threadStartCommand = await fetchSingleCommand(
        daemonClient,
        session.sessionId,
      );
      expect(threadStartCommand.command.type).toBe("thread.start");
    } finally {
      await server.close();
    }
  });

  it("sends events-appended websocket notifications for thread event ingestion", async () => {
    const server = await startTestServer();
    try {
      const daemonClient = createHostDaemonClient(
        server.baseUrl,
        createTestDaemonHostKey(),
      );
      const publicClient = createPublicApiClient(server.baseUrl);

      const session = await (
        await daemonClient.session.open.$post({
          json: {
            hostId: "host-1",
            instanceId: "instance-1",
            hostName: "Test Host",
            hostType: "persistent",
            dataDir: "/tmp/host-1-data",
            protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
            activeThreads: [],
          },
        })
      ).json();
      const project = await (
        await publicClient.projects.$post({
          json: {
            name: "Event Project",
            source: {
              type: "local_path",
              hostId: "host-1",
              path: "/tmp/event-project",
            },
          },
        })
      ).json();
      const thread = await (
        await publicClient.threads.$post({
          json: {
            origin: "app",
            projectId: project.id,
            providerId: "codex",
            model: "gpt-5",
            input: [{ type: "text", text: "Start the event thread" }],
            environment: {
              type: "host",
              hostId: "host-1",
              workspace: { type: "unmanaged", path: null },
            },
          },
        })
      ).json();
      const provisionCommand = await fetchSingleCommand(
        daemonClient,
        session.sessionId,
        0,
      );
      await daemonClient.session["command-result"].$post({
        json: {
          sessionId: session.sessionId,
          attemptId: provisionCommand.attemptId,
          commandId: provisionCommand.id,
          completedAt: Date.now(),
          type: "environment.provision",
          ok: true,
          result: {
            path: "/tmp/event-project",
            branchName: "bb/event",
            defaultBranch: "main",
            isGitRepo: true,
            isWorktree: false,
            transcript: [],
          },
        },
      });
      const threadStartCommand = await fetchSingleCommand(
        daemonClient,
        session.sessionId,
        provisionCommand.cursor,
      );
      expect(threadStartCommand.command.type).toBe("thread.start");
      await daemonClient.session["command-result"].$post({
        json: {
          sessionId: session.sessionId,
          attemptId: threadStartCommand.attemptId,
          commandId: threadStartCommand.id,
          completedAt: Date.now(),
          type: "thread.start",
          ok: true,
          result: {
            providerThreadId: "provider-thread",
          },
        },
      });

      const ws = new WebSocket(`${server.baseUrl.replace("http", "ws")}/ws`);
      await waitForOpen(ws);
      ws.send(
        JSON.stringify({ type: "subscribe", entity: "thread", id: thread.id }),
      );
      await waitForThreadSubscription(server.hub, ws, thread.id);

      const messagePromise = waitForMatchingMessage<{
        changes: string[];
        entity: string;
        id?: string;
      }>(
        ws,
        (
          message,
        ): message is { changes: string[]; entity: string; id?: string } => {
          if (message == null || typeof message !== "object") {
            return false;
          }
          const record = message as Record<string, unknown>;
          return (
            record.entity === "thread" &&
            record.id === thread.id &&
            Array.isArray(record.changes) &&
            record.changes.includes("events-appended")
          );
        },
      );
      const eventResponse = await daemonClient.session.events.$post({
        json: {
          sessionId: session.sessionId,
          events: [
            createTestDaemonEventEnvelope({
              producerEventIdValue: 1,
              event: {
                type: "turn/started",
                threadId: thread.id,
                providerThreadId: "provider-thread",
                scope: turnScope("turn-1"),
              },
            }),
          ],
        },
      });
      expect(eventResponse.status).toBe(200);

      const message = await messagePromise;
      expect(message.changes).toContain("events-appended");
      ws.close();
    } finally {
      await server.close();
    }
  });

  it("delivers server app broadcasts to SDK bb.on consumers", async () => {
    const server = await startTestServer();
    let unsubscribeConnection: () => void = () => {};
    let unsubscribeApp: () => void = () => {};
    try {
      const sdk = createBrowserBbSdk({
        baseUrl: server.baseUrl,
        websocket: (url) => new SdkWebSocketAdapter(url),
      });
      const connected = new Promise<void>((resolve) => {
        unsubscribeConnection = sdk.on({
          event: "realtime:connection",
          callback(event) {
            if (event.state === "connected") {
              resolve();
            }
          },
        });
      });
      const appMessageResolvers: Array<(event: AppRealtimeEvent) => void> = [];
      const waitForNextAppMessage = () =>
        new Promise<AppRealtimeEvent>((resolve) => {
          appMessageResolvers.push(resolve);
        });
      unsubscribeApp = sdk.on({
        event: "app:changed",
        callback(event) {
          const resolve = appMessageResolvers.shift();
          if (!resolve) {
            return;
          }
          resolve(event);
        },
      });

      await connected;
      await waitForSdkAppSubscription({
        hub: server.hub,
        waitForNextAppMessage,
      });
      const received = waitForNextAppMessage();
      server.hub.notifyApp(["apps-changed"]);

      await expect(received).resolves.toEqual({
        type: "changed",
        entity: "app",
        changes: ["apps-changed"],
      });
    } finally {
      unsubscribeApp();
      unsubscribeConnection();
      await server.close();
    }
  });

  it("runs a full create -> send -> result -> events -> idle lifecycle", async () => {
    const server = await startTestServer();
    try {
      const daemonClient = createHostDaemonClient(
        server.baseUrl,
        createTestDaemonHostKey(),
      );
      const publicClient = createPublicApiClient(server.baseUrl);

      const session = await (
        await daemonClient.session.open.$post({
          json: {
            hostId: "host-1",
            instanceId: "instance-1",
            hostName: "Lifecycle Host",
            hostType: "persistent",
            dataDir: "/tmp/host-1-data",
            protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
            activeThreads: [],
          },
        })
      ).json();
      const project = await (
        await publicClient.projects.$post({
          json: {
            name: "Lifecycle Project",
            source: {
              type: "local_path",
              hostId: "host-1",
              path: "/tmp/lifecycle-project",
            },
          },
        })
      ).json();
      const thread = await (
        await publicClient.threads.$post({
          json: {
            origin: "app",
            projectId: project.id,
            providerId: "codex",
            model: "gpt-5",
            input: [{ type: "text", text: "Start the lifecycle thread" }],
            environment: {
              type: "host",
              hostId: "host-1",
              workspace: { type: "unmanaged", path: null },
            },
          },
        })
      ).json();

      const provisionCommand = await fetchSingleCommand(
        daemonClient,
        session.sessionId,
        0,
      );
      await daemonClient.session["command-result"].$post({
        json: {
          sessionId: session.sessionId,
          attemptId: provisionCommand.attemptId,
          commandId: provisionCommand.id,
          completedAt: Date.now(),
          type: "environment.provision",
          ok: true,
          result: {
            path: "/tmp/lifecycle-project",
            branchName: "bb/lifecycle",
            defaultBranch: "main",
            isGitRepo: true,
            isWorktree: false,
            transcript: [],
          },
        },
      });

      const initialThreadStartCommand = await fetchSingleCommand(
        daemonClient,
        session.sessionId,
        provisionCommand.cursor,
      );
      expect(initialThreadStartCommand.command.type).toBe("thread.start");

      await daemonClient.session["command-result"].$post({
        json: {
          sessionId: session.sessionId,
          attemptId: initialThreadStartCommand.attemptId,
          commandId: initialThreadStartCommand.id,
          completedAt: Date.now(),
          type: "thread.start",
          ok: true,
          result: {
            providerThreadId: "provider-thread",
          },
        },
      });

      const initialEventsResponse = await daemonClient.session.events.$post({
        json: {
          sessionId: session.sessionId,
          events: [
            createTestDaemonEventEnvelope({
              producerEventIdValue: 2,
              event: {
                type: "turn/started",
                threadId: thread.id,
                providerThreadId: "provider-thread",
                scope: turnScope("turn-initial"),
              },
            }),
            createTestDaemonEventEnvelope({
              producerEventIdValue: 3,
              event: {
                type: "turn/completed",
                threadId: thread.id,
                providerThreadId: "provider-thread",
                scope: turnScope("turn-initial"),
                status: "completed",
              },
            }),
          ],
        },
      });
      expect(initialEventsResponse.status).toBe(200);

      const afterInitialTurnThread = await (
        await publicClient.threads[":id"].$get({ param: { id: thread.id } })
      ).json();
      expect(afterInitialTurnThread.status).toBe("idle");

      const sendResponse = await publicClient.threads[":id"].send.$post({
        param: { id: thread.id },
        json: {
          input: [{ type: "text", text: "Continue the task" }],
          mode: "auto",
        },
      });
      expect(sendResponse.status).toBe(200);

      const turnSubmitCommand = await fetchSingleCommand(
        daemonClient,
        session.sessionId,
        initialThreadStartCommand.cursor,
      );
      expect(turnSubmitCommand.command.type).toBe("turn.submit");

      await daemonClient.session["command-result"].$post({
        json: {
          sessionId: session.sessionId,
          attemptId: turnSubmitCommand.attemptId,
          commandId: turnSubmitCommand.id,
          completedAt: Date.now(),
          type: "turn.submit",
          ok: true,
          result: { appliedAs: "new-turn" },
        },
      });

      const eventsResponse = await daemonClient.session.events.$post({
        json: {
          sessionId: session.sessionId,
          events: [
            createTestDaemonEventEnvelope({
              producerEventIdValue: 4,
              event: {
                type: "turn/started",
                threadId: thread.id,
                providerThreadId: "provider-thread",
                scope: turnScope("turn-1"),
              },
            }),
            createTestDaemonEventEnvelope({
              producerEventIdValue: 5,
              event: {
                type: "turn/completed",
                threadId: thread.id,
                providerThreadId: "provider-thread",
                scope: turnScope("turn-1"),
                status: "completed",
              },
            }),
          ],
        },
      });
      expect(eventsResponse.status).toBe(200);

      const finalThread = await (
        await publicClient.threads[":id"].$get({ param: { id: thread.id } })
      ).json();
      expect(finalThread.status).toBe("idle");
    } finally {
      await server.close();
    }
  });

  it("notifies replaced daemon websocket sessions with session-close", async () => {
    const server = await startTestServer();
    try {
      const hostKey = createTestDaemonHostKey();
      const daemonClient = createHostDaemonClient(server.baseUrl, hostKey);

      const firstSession = await (
        await daemonClient.session.open.$post({
          json: {
            hostId: "host-1",
            instanceId: "instance-1",
            hostName: "Test Host",
            hostType: "persistent",
            dataDir: "/tmp/host-1-data",
            protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
            activeThreads: [],
          },
        })
      ).json();

      const daemonWs = new WebSocket(
        `${server.baseUrl.replace("http", "ws")}/internal/ws?sessionId=${encodeURIComponent(firstSession.sessionId)}`,
        buildHostDaemonWebSocketProtocols(),
        {
          headers: {
            authorization: buildHostDaemonWebSocketAuthorizationHeader(hostKey),
          },
        },
      );
      await waitForOpen(daemonWs);

      const sessionClosePromise = waitForMatchingMessage<{
        reason: string;
        type: string;
      }>(
        daemonWs,
        (message): message is { reason: string; type: string } =>
          message != null &&
          typeof message === "object" &&
          "type" in message &&
          "reason" in message &&
          message.type === "session-close",
      );

      const secondSessionResponse = await daemonClient.session.open.$post({
        json: {
          hostId: "host-1",
          instanceId: "instance-2",
          hostName: "Test Host",
          hostType: "persistent",
          dataDir: "/tmp/host-1-data",
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          activeThreads: [],
        },
      });
      expect(secondSessionResponse.status).toBe(201);

      const sessionCloseMessage = await sessionClosePromise;
      expect(sessionCloseMessage).toEqual({
        type: "session-close",
        reason: "replaced",
      });

      daemonWs.close();
    } finally {
      await server.close();
    }
  });
});
