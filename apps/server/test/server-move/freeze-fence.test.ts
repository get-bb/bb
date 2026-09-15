import {
  createTerminalSession,
  getEnvironment,
  getStoredThreadTabs,
  getTerminalSession,
  listEvents,
  listPendingInteractionsByThread,
  updateTerminalSession,
} from "@bb/db";
import { threadScope } from "@bb/domain";
import {
  groupHostDaemonEvents,
  hostDaemonServerWsMessageSchema,
  type HostDaemonServerWsMessage,
} from "@bb/host-daemon-contract";
import { describe, expect, it, vi, type Mock } from "vitest";
import { callHostOnlineRpc } from "../../src/services/hosts/online-rpc.js";
import { resumeServerMoveDeferredWork } from "../../src/services/server-move/environment.js";
import { setServerMoveFrozen } from "../../src/services/server-move/freeze-state.js";
import {
  onDaemonSocketMessage,
  onDaemonSocketOpen,
} from "../../src/ws/daemon-protocol.js";
import {
  internalAuthHeaders,
  registerTestHostRpcCapture,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { createCommandApprovalPayload } from "../helpers/pending-interactions.js";
import { seedSession, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

interface CapturingDaemonSocket {
  close: Mock<(code?: number, reason?: string) => void>;
  messages: HostDaemonServerWsMessage[];
  send: Mock<(data: string) => void>;
}

function connectCapturingDaemon(
  harness: TestAppHarness,
  args: { hostId: string; sessionId: string },
): CapturingDaemonSocket {
  const messages: HostDaemonServerWsMessage[] = [];
  const socket: CapturingDaemonSocket = {
    close: vi.fn<(code?: number, reason?: string) => void>(),
    messages,
    send: vi.fn<(data: string) => void>((data) => {
      const parsed = hostDaemonServerWsMessageSchema.safeParse(
        JSON.parse(data),
      );
      if (parsed.success) {
        messages.push(parsed.data);
      }
    }),
  };
  harness.hub.registerDaemon(args.sessionId, args.hostId, socket);
  return socket;
}

async function waitForSentMessage<
  TType extends HostDaemonServerWsMessage["type"],
>(
  socket: CapturingDaemonSocket,
  type: TType,
): Promise<Extract<HostDaemonServerWsMessage, { type: TType }>> {
  return vi.waitFor(() => {
    const found = socket.messages.find(
      (
        message,
      ): message is Extract<HostDaemonServerWsMessage, { type: TType }> =>
        message.type === type,
    );
    if (found === undefined) {
      throw new Error(`The daemon never received ${type}`);
    }
    return found;
  });
}

async function startThreadTerminalOpen(
  harness: TestAppHarness,
  args: { socket: CapturingDaemonSocket; threadId: string },
) {
  const response = harness.app.request("/api/v1/terminals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cols: 100,
      rows: 30,
      target: { kind: "thread", threadId: args.threadId },
    }),
  });
  const open = await waitForSentMessage(args.socket, "terminal.open");
  return { open, response: Promise.resolve(response) };
}

describe("writes while a server move is frozen", () => {
  it("drops daemon changes the snapshot would lose and applies them once unfrozen", () =>
    withTestHarness(async (harness) => {
      const { host, session, environment, thread } = seedThreadFixture(
        harness,
        {
          session: { id: "host-frozen-writes" },
          environment: {
            path: "/tmp/frozen-writes",
            status: "ready",
            isGitRepo: false,
            branchName: null,
          },
        },
      );
      const terminal = createTerminalSession(harness.db, {
        cols: 100,
        daemonSessionId: session.id,
        environmentId: environment.id,
        hostId: host.id,
        initialCwd: "/tmp/frozen-writes",
        rows: 30,
        status: "running",
        threadId: thread.id,
        title: "zsh",
      });
      const socket = { close: vi.fn(), send: vi.fn() };
      const plugins = {
        handleHostSignal: vi.fn(),
        handleHostWorkerExit: vi.fn(),
      };
      const feedChanges = () => {
        for (const raw of [
          {
            type: "environment-metadata-change",
            environmentId: environment.id,
            workspace: {
              path: environment.path,
              isGitRepo: true,
              isWorktree: true,
              branchName: "main",
              defaultBranch: "main",
            },
          },
          {
            type: "desktop-browser.changed",
            instanceId: "desktop-window",
            generation: "window-generation",
            threadId: thread.id,
            tabs: [
              {
                tabId: "frozen-tab",
                threadId: thread.id,
                url: "https://example.com",
                title: "Example",
                profile: { kind: "automation", id: "automation-profile" },
                presentation: "hidden",
                control: null,
              },
            ],
          },
          {
            type: "plugin-host.signal",
            pluginId: "fixture",
            generation: "generation-1",
            signal: "changed",
            payload: { sequence: 3 },
          },
          {
            type: "plugin-host.worker-exited",
            pluginId: "fixture",
            generation: "generation-1",
          },
          {
            type: "terminal.exited",
            terminalId: terminal.id,
            exitCode: 0,
            closeReason: "process-exit",
          },
        ]) {
          onDaemonSocketMessage(
            harness.deps,
            {
              hostId: host.id,
              sessionId: session.id,
              socket,
              raw: JSON.stringify(raw),
            },
            plugins,
          );
        }
      };

      setServerMoveFrozen(harness.db, true);
      try {
        feedChanges();

        expect(getEnvironment(harness.db, environment.id)).toMatchObject({
          isGitRepo: false,
          branchName: null,
        });
        expect(getStoredThreadTabs(harness.db, thread.id)).toBeNull();
        expect(plugins.handleHostSignal).not.toHaveBeenCalled();
        expect(plugins.handleHostWorkerExit).not.toHaveBeenCalled();
        expect(
          getTerminalSession(harness.db, {
            kind: "terminal",
            terminalId: terminal.id,
          }),
        ).toMatchObject({ status: "running", closeReason: null });
        expect(socket.close).not.toHaveBeenCalled();
      } finally {
        setServerMoveFrozen(harness.db, false);
      }

      feedChanges();

      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        isGitRepo: true,
        branchName: "main",
      });
      expect(getStoredThreadTabs(harness.db, thread.id)).not.toBeNull();
      expect(plugins.handleHostSignal).toHaveBeenCalledTimes(1);
      expect(plugins.handleHostWorkerExit).toHaveBeenCalledTimes(1);
      expect(
        getTerminalSession(harness.db, {
          kind: "terminal",
          terminalId: terminal.id,
        }),
      ).toMatchObject({ status: "exited", closeReason: "process-exit" });
      expect(socket.close).not.toHaveBeenCalled();
    }));

  it("keeps move traffic and live daemon updates flowing while frozen", () =>
    withTestHarness(async (harness) => {
      const { host, session, environment } = seedThreadFixture(harness, {
        session: { id: "host-frozen-live" },
      });
      const socket = connectCapturingDaemon(harness, {
        hostId: host.id,
        sessionId: session.id,
      });
      const notifyEnvironment = vi.spyOn(harness.hub, "notifyEnvironment");
      const serverMove = { handleProgress: vi.fn() };
      const feed = (raw: object) =>
        onDaemonSocketMessage(
          harness.deps,
          {
            hostId: host.id,
            sessionId: session.id,
            socket,
            raw: JSON.stringify(raw),
          },
          undefined,
          serverMove,
        );

      setServerMoveFrozen(harness.db, true);
      try {
        const probe = callHostOnlineRpc(harness.deps, {
          hostId: host.id,
          timeoutMs: 5_000,
          command: {
            type: "server_move.probe",
            url: "https://desktop.example.test",
            moveId: "move-frozen",
          },
        });
        const request = await waitForSentMessage(socket, "host-rpc.request");
        feed({
          type: "host-rpc.response",
          requestId: request.requestId,
          commandType: "server_move.probe",
          ok: true,
          result: { reachable: true, message: null },
        });
        await expect(probe).resolves.toEqual({
          reachable: true,
          message: null,
        });

        feed({ type: "heartbeat" });
        feed({
          type: "environment-change",
          environmentId: environment.id,
          change: "thread-storage-changed",
        });
        feed({
          type: "server_move.progress",
          moveId: "move-frozen",
          step: "transfer",
          message: "Downloaded 40%",
        });

        expect(socket.send).toHaveBeenCalledWith(
          JSON.stringify({ type: "heartbeat-ack" }),
        );
        expect(notifyEnvironment).toHaveBeenCalledWith(environment.id, [
          "thread-storage-changed",
        ]);
        expect(serverMove.handleProgress).toHaveBeenCalledWith(
          host.id,
          expect.objectContaining({ step: "transfer" }),
        );
        expect(socket.close).not.toHaveBeenCalled();
      } finally {
        setServerMoveFrozen(harness.db, false);
      }
    }));

  it("refuses a terminal the daemon opens while frozen without recording it", () =>
    withTestHarness(async (harness) => {
      const { host, session, thread } = seedThreadFixture(harness, {
        session: { id: "host-frozen-terminal-open" },
      });
      const socket = connectCapturingDaemon(harness, {
        hostId: host.id,
        sessionId: session.id,
      });
      const { open, response } = await startThreadTerminalOpen(harness, {
        socket,
        threadId: thread.id,
      });

      setServerMoveFrozen(harness.db, true);
      try {
        onDaemonSocketMessage(harness.deps, {
          hostId: host.id,
          sessionId: session.id,
          socket,
          raw: JSON.stringify({
            type: "terminal.opened",
            requestId: open.requestId,
            terminalId: open.terminalId,
            shell: "/bin/zsh",
            title: "zsh",
            initialCwd: "/tmp/frozen-terminal",
            cols: 100,
            rows: 30,
          }),
        });

        const refused = await response;
        expect(refused.status).toBe(503);
        expect(await readJson(refused)).toMatchObject({
          code: "server_moving",
        });
        expect(
          getTerminalSession(harness.db, {
            kind: "terminal",
            terminalId: open.terminalId,
          }),
        ).toMatchObject({ status: "starting", closeReason: null });
        expect(await waitForSentMessage(socket, "terminal.close")).toEqual({
          type: "terminal.close",
          terminalId: open.terminalId,
          reason: "open-timeout",
        });
        expect(socket.close).not.toHaveBeenCalled();
      } finally {
        setServerMoveFrozen(harness.db, false);
      }
    }));

  it("does not record a terminal open that fails while frozen", () =>
    withTestHarness(async (harness) => {
      const { host, session, thread } = seedThreadFixture(harness, {
        session: { id: "host-frozen-terminal-error" },
      });
      const socket = connectCapturingDaemon(harness, {
        hostId: host.id,
        sessionId: session.id,
      });
      const { open, response } = await startThreadTerminalOpen(harness, {
        socket,
        threadId: thread.id,
      });

      setServerMoveFrozen(harness.db, true);
      try {
        onDaemonSocketMessage(harness.deps, {
          hostId: host.id,
          sessionId: session.id,
          socket,
          raw: JSON.stringify({
            type: "terminal.error",
            requestId: open.requestId,
            terminalId: open.terminalId,
            code: "spawn_failed",
            message: "No shell",
          }),
        });

        const failed = await response;
        expect(failed.status).toBe(502);
        expect(await readJson(failed)).toMatchObject({ code: "spawn_failed" });
        expect(
          getTerminalSession(harness.db, {
            kind: "terminal",
            terminalId: open.terminalId,
          }),
        ).toMatchObject({ status: "starting", closeReason: null });
      } finally {
        setServerMoveFrozen(harness.db, false);
      }
    }));

  it("keeps disconnected terminals until the move is released when a daemon reconnects while frozen", () =>
    withTestHarness(async (harness) => {
      const {
        host,
        session: previousSession,
        environment,
        thread,
      } = seedThreadFixture(harness, {
        session: { id: "host-frozen-reconnect" },
      });
      const terminal = createTerminalSession(harness.db, {
        cols: 100,
        daemonSessionId: previousSession.id,
        environmentId: environment.id,
        hostId: host.id,
        initialCwd: "/tmp/frozen-reconnect",
        rows: 30,
        status: "running",
        threadId: thread.id,
        title: "zsh",
      });
      updateTerminalSession(harness.db, {
        scope: { kind: "terminal", terminalId: terminal.id },
        update: { kind: "disconnect" },
      });
      const session = seedSession(harness.deps, host.id);
      const readTerminal = () =>
        getTerminalSession(harness.db, {
          kind: "terminal",
          terminalId: terminal.id,
        });

      setServerMoveFrozen(harness.db, true);
      try {
        onDaemonSocketOpen(harness.deps, {
          hostId: host.id,
          sessionId: session.id,
          socket: registerTestHostRpcCapture(harness.deps, {
            hostId: host.id,
            sessionId: session.id,
          }),
        });
        expect(readTerminal()).toMatchObject({ status: "disconnected" });
      } finally {
        setServerMoveFrozen(harness.db, false);
      }

      resumeServerMoveDeferredWork(harness.deps);

      expect(readTerminal()).toMatchObject({
        status: "exited",
        closeReason: "daemon-disconnect",
      });
    }));

  it("refuses daemon session writes over HTTP while frozen and accepts them after", () =>
    withTestHarness(async (harness) => {
      const { session, thread } = seedThreadFixture(harness, {
        session: { id: "host-frozen-internal" },
      });
      const post = (path: string, body: unknown) =>
        harness.app.request(path, {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body: JSON.stringify(body),
        });
      const eventBatch = {
        sessionId: session.id,
        eventGroups: groupHostDaemonEvents([
          {
            threadId: thread.id,
            event: {
              type: "system/error",
              threadId: thread.id,
              scope: threadScope(),
              message: "Daemon error while frozen",
            },
          },
        ]),
      };
      const systemErrorCount = () =>
        listEvents(harness.db, { threadId: thread.id }).filter(
          (row) => row.type === "system/error",
        ).length;
      const writes: [string, unknown][] = [
        ["/internal/session/events", eventBatch],
        [
          "/internal/session/tool-call",
          {
            sessionId: session.id,
            threadId: thread.id,
            providerThreadId: "provider-frozen",
            turnId: "turn-frozen",
            callId: "call-frozen",
            tool: "frozen_tool",
          },
        ],
        [
          "/internal/session/interactive-request",
          {
            sessionId: session.id,
            interaction: {
              threadId: thread.id,
              turnId: "turn-frozen",
              providerId: "codex",
              providerThreadId: "provider-frozen",
              providerRequestId: "request-frozen",
              payload: createCommandApprovalPayload({
                itemId: "item-frozen",
                reason: "Needs approval",
                command: "git push",
                cwd: "/tmp/project",
              }),
            },
          },
        ],
        [
          "/internal/session/interactive-request/interrupt",
          {
            sessionId: session.id,
            providerId: "codex",
            threadIds: [thread.id],
            reason: "Provider stopped",
          },
        ],
      ];

      setServerMoveFrozen(harness.db, true);
      try {
        for (const [path, body] of writes) {
          const response = await post(path, body);
          expect(response.status, path).toBe(503);
          expect(await readJson(response), path).toMatchObject({
            code: "server_moving",
          });
        }
        expect(systemErrorCount()).toBe(0);
        expect(
          listPendingInteractionsByThread(harness.db, { threadId: thread.id }),
        ).toEqual([]);
      } finally {
        setServerMoveFrozen(harness.db, false);
      }

      const accepted = await post("/internal/session/events", eventBatch);
      expect(accepted.status).toBe(200);
      expect(systemErrorCount()).toBe(1);
    }));
});
