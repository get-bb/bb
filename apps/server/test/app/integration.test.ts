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
import { wrapNodeWsWebsocket } from "@bb/sdk/node-websocket";
import { createPublicApiClient } from "@bb/server-contract";
import {
  turnScope,
  type SystemChangeKind,
  type ThreadChangeKind,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import { notifyGlobalAppsChanged } from "../../src/routes/apps.js";
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

interface AppBroadcastHub {
  notifyAppsChanged(): void;
}

interface SystemBroadcastHub {
  notifySystem(changes: SystemChangeKind[]): void;
}

interface ThreadBroadcastHub {
  notifyThread(threadId: string, changes: ThreadChangeKind[]): void;
}

interface ChangedBroadcast {
  changes: string[];
  entity: string;
  id?: string;
}

interface ChangedBroadcastMatchArgs {
  entity: string;
  /** Omitted means "any id" — list-level broadcasts carry none. */
  id?: string;
  kind: string;
}

function isChangedBroadcastFor(
  args: ChangedBroadcastMatchArgs,
): (message: unknown) => message is ChangedBroadcast {
  return (message): message is ChangedBroadcast =>
    typeof message === "object" &&
    message !== null &&
    "entity" in message &&
    message.entity === args.entity &&
    (args.id === undefined || ("id" in message && message.id === args.id)) &&
    "changes" in message &&
    Array.isArray(message.changes) &&
    message.changes.includes(args.kind);
}

interface WaitForSdkAppSubscriptionArgs {
  hub: AppBroadcastHub;
  waitForNextAppMessage: () => Promise<AppRealtimeEvent>;
}

interface BroadcastUntilObservedArgs {
  fire: () => void;
  observed: Promise<unknown>;
}

/**
 * Subscriptions register asynchronously server-side, so a single broadcast
 * can land before the subscription exists: keep re-firing every 25ms until
 * the observer sees one.
 */
async function broadcastUntilObserved(
  args: BroadcastUntilObservedArgs,
): Promise<void> {
  const interval = setInterval(args.fire, 25);
  try {
    args.fire();
    await args.observed;
  } finally {
    clearInterval(interval);
  }
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
  hub: ThreadBroadcastHub,
  socket: WebSocket,
  threadId: string,
): Promise<void> {
  await broadcastUntilObserved({
    fire: () => hub.notifyThread(threadId, ["status-changed"]),
    observed: waitForMatchingMessage(
      socket,
      isChangedBroadcastFor({
        entity: "thread",
        id: threadId,
        kind: "status-changed",
      }),
      2_000,
    ),
  });
}

async function waitForSystemSubscription(
  hub: SystemBroadcastHub,
  socket: WebSocket,
): Promise<void> {
  await broadcastUntilObserved({
    fire: () => hub.notifySystem(["config-changed"]),
    observed: waitForMatchingMessage(
      socket,
      isChangedBroadcastFor({ entity: "system", kind: "config-changed" }),
      2_000,
    ),
  });
}

async function waitForSdkAppSubscription(
  args: WaitForSdkAppSubscriptionArgs,
): Promise<void> {
  await broadcastUntilObserved({
    fire: () => args.hub.notifyAppsChanged(),
    observed: args.waitForNextAppMessage(),
  });
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

      const messagePromise = waitForMatchingMessage(
        ws,
        isChangedBroadcastFor({
          entity: "thread",
          id: thread.id,
          kind: "events-appended",
        }),
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
        websocket: wrapNodeWsWebsocket,
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
      server.hub.notifyAppsChanged();

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

  it("broadcasts apps-changed to system and app subscribers via notifyGlobalAppsChanged", async () => {
    const server = await startTestServer();
    try {
      const wsUrl = `${server.baseUrl.replace("http", "ws")}/ws`;
      const systemWs = new WebSocket(wsUrl);
      const appWs = new WebSocket(wsUrl);
      await Promise.all([waitForOpen(systemWs), waitForOpen(appWs)]);

      systemWs.send(JSON.stringify({ type: "subscribe", entity: "system" }));
      appWs.send(JSON.stringify({ type: "subscribe", entity: "app" }));
      // Messages on a socket are handled in order, so confirming this later
      // "system" subscription also confirms the earlier "app" one.
      appWs.send(JSON.stringify({ type: "subscribe", entity: "system" }));
      await waitForSystemSubscription(server.hub, systemWs);
      await waitForSystemSubscription(server.hub, appWs);

      const systemMessage = waitForMatchingMessage(
        systemWs,
        isChangedBroadcastFor({ entity: "system", kind: "apps-changed" }),
      );
      const appMessage = waitForMatchingMessage(
        appWs,
        isChangedBroadcastFor({ entity: "app", kind: "apps-changed" }),
      );

      await notifyGlobalAppsChanged(server.deps);

      await expect(systemMessage).resolves.toEqual({
        type: "changed",
        entity: "system",
        changes: ["apps-changed"],
      });
      await expect(appMessage).resolves.toEqual({
        type: "changed",
        entity: "app",
        changes: ["apps-changed"],
      });

      systemWs.close();
      appWs.close();
    } finally {
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
