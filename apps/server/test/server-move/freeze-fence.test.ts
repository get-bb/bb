import {
  createTerminalSession,
  getEnvironment,
  getStoredThreadTabs,
  getTerminalSession,
  listEvents,
  listPendingInteractionsByThread,
  updateTerminalSession,
  type DbConnection,
} from "@bb/db";
import { threadScope } from "@bb/domain";
import {
  groupHostDaemonEvents,
  hostDaemonServerWsMessageSchema,
  type HostDaemonServerWsMessage,
} from "@bb/host-daemon-contract";
import { createDeferredPromise } from "@bb/test-helpers";
import { describe, expect, it, vi, type Mock } from "vitest";
import { callHostOnlineRpc } from "../../src/services/hosts/online-rpc.js";
import { createServerMoveCoordinator } from "../../src/services/server-move/coordinator.js";
import { resumeServerMoveDeferredWork } from "../../src/services/server-move/environment.js";
import {
  isServerMoveFrozen,
  isServerMoveSnapshotFenced,
  setServerMoveFrozen,
  setServerMoveSnapshotFence,
} from "../../src/services/server-move/freeze-state.js";
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
import {
  seedHost,
  seedPrimaryHost,
  seedSession,
  seedThreadFixture,
} from "../helpers/seed.js";
import {
  createTestServerMoveEnvironment,
  inspectResult,
  registerFakeDaemon,
  type FakeDaemonReply,
} from "../helpers/server-move.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const MOVE_SOURCE_HOST_ID = "host-fence-source";
const MOVE_TARGET_HOST_ID = "host-fence-target";

interface CapturingDaemonSocket {
  close: Mock<(code?: number, reason?: string) => void>;
  messages: HostDaemonServerWsMessage[];
  send: Mock<(data: string) => void>;
}

function setSnapshotFence(db: DbConnection, fenced: boolean): void {
  setServerMoveFrozen(db, fenced);
  setServerMoveSnapshotFence(db, fenced);
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

function seedDaemonChanges(harness: TestAppHarness, hostId: string) {
  const { host, session, environment, thread } = seedThreadFixture(harness, {
    session: { id: hostId },
    environment: {
      path: `/tmp/${hostId}`,
      status: "ready",
      isGitRepo: false,
      branchName: null,
    },
  });
  const terminal = createTerminalSession(harness.db, {
    cols: 100,
    daemonSessionId: session.id,
    environmentId: environment.id,
    hostId: host.id,
    initialCwd: `/tmp/${hostId}`,
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
  const readTerminal = () =>
    getTerminalSession(harness.db, {
      kind: "terminal",
      terminalId: terminal.id,
    });
  return {
    feed() {
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
    },
    expectDropped() {
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        isGitRepo: false,
        branchName: null,
      });
      expect(getStoredThreadTabs(harness.db, thread.id)).toBeNull();
      expect(plugins.handleHostSignal).not.toHaveBeenCalled();
      expect(plugins.handleHostWorkerExit).not.toHaveBeenCalled();
      expect(readTerminal()).toMatchObject({
        status: "running",
        closeReason: null,
      });
      expect(socket.close).not.toHaveBeenCalled();
    },
    expectApplied() {
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        isGitRepo: true,
        branchName: "main",
      });
      expect(getStoredThreadTabs(harness.db, thread.id)).not.toBeNull();
      expect(plugins.handleHostSignal).toHaveBeenCalledTimes(1);
      expect(plugins.handleHostWorkerExit).toHaveBeenCalledTimes(1);
      expect(readTerminal()).toMatchObject({
        status: "exited",
        closeReason: "process-exit",
      });
      expect(socket.close).not.toHaveBeenCalled();
    },
  };
}

function seedDisconnectedTerminal(harness: TestAppHarness, hostId: string) {
  const {
    host,
    session: previousSession,
    environment,
    thread,
  } = seedThreadFixture(harness, {
    session: { id: hostId },
  });
  const terminal = createTerminalSession(harness.db, {
    cols: 100,
    daemonSessionId: previousSession.id,
    environmentId: environment.id,
    hostId: host.id,
    initialCwd: `/tmp/${hostId}`,
    rows: 30,
    status: "running",
    threadId: thread.id,
    title: "zsh",
  });
  updateTerminalSession(harness.db, {
    scope: { kind: "terminal", terminalId: terminal.id },
    update: { kind: "disconnect", retainDaemonSession: false },
  });
  const session = seedSession(harness.deps, host.id);
  return {
    readTerminal: () =>
      getTerminalSession(harness.db, {
        kind: "terminal",
        terminalId: terminal.id,
      }),
    reconnect() {
      onDaemonSocketOpen(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
        socket: registerTestHostRpcCapture(harness.deps, {
          hostId: host.id,
          sessionId: session.id,
        }),
      });
    },
  };
}

function seedDaemonSessionWrites(harness: TestAppHarness, hostId: string) {
  const { session, thread } = seedThreadFixture(harness, {
    session: { id: hostId },
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
  return {
    eventBatch,
    post: (path: string, body: unknown) =>
      harness.app.request(path, {
        method: "POST",
        headers: internalAuthHeaders(harness),
        body: JSON.stringify(body),
      }),
    systemErrorCount: () =>
      listEvents(harness.db, { threadId: thread.id }).filter(
        (row) => row.type === "system/error",
      ).length,
    threadId: thread.id,
    writes,
  };
}

function snapshotFenceMove(
  harness: TestAppHarness,
  prepare: () => FakeDaemonReply | Promise<FakeDaemonReply>,
) {
  seedHost(harness.deps, { id: MOVE_SOURCE_HOST_ID, name: "Laptop" });
  seedPrimaryHost(harness.deps, MOVE_SOURCE_HOST_ID);
  seedHost(harness.deps, { id: MOVE_TARGET_HOST_ID, name: "Desktop" });
  const { environment, events } = createTestServerMoveEnvironment(harness);
  const observed: string[] = [];
  const observe = (step: string) => {
    observed.push(
      `${step} frozen=${isServerMoveFrozen(harness.db)} fenced=${isServerMoveSnapshotFenced(harness.db)}`,
    );
  };
  const coordinator = createServerMoveCoordinator({
    ...environment,
    exportArchive: (args) => {
      observe("export");
      return environment.exportArchive(args);
    },
    plugins: {
      ...environment.plugins,
      suspendAllButConnect: async () => {
        observe("suspend plugins");
        await environment.plugins.suspendAllButConnect();
      },
    },
    stopRunningWork: async () => {
      observe("stop work");
    },
  });
  const reply = (result: unknown): FakeDaemonReply => ({ ok: true, result });
  registerFakeDaemon(harness, {
    events,
    hostId: MOVE_SOURCE_HOST_ID,
    handle: (request) =>
      request.command.type === "server_move.probe"
        ? reply({ reachable: true, message: null, state: "pending" })
        : reply(inspectResult()),
  });
  registerFakeDaemon(harness, {
    events,
    hostId: MOVE_TARGET_HOST_ID,
    handle: (request) => {
      switch (request.command.type) {
        case "server_move.inspect":
          return reply(inspectResult());
        case "server_move.prepare":
          return prepare();
        case "server_move.abort":
          return reply({ ok: true });
        default:
          throw new Error(`Unexpected target command ${request.command.type}`);
      }
    },
  });
  return {
    coordinator,
    events,
    observed,
    start: () =>
      coordinator.start({
        targetHostId: MOVE_TARGET_HOST_ID,
        serverUrl: "https://desktop.example.test",
        stopRunningWork: true,
        archiveExistingTargetServerData: false,
      }),
  };
}

describe("writes while a server move is frozen", () => {
  it("accepts daemon changes while the server is frozen before the snapshot is taken", () =>
    withTestHarness(async (harness) => {
      const changes = seedDaemonChanges(harness, "host-frozen-before-export");

      setServerMoveFrozen(harness.db, true);
      try {
        changes.feed();
        changes.expectApplied();
      } finally {
        setServerMoveFrozen(harness.db, false);
      }
    }));

  it("drops daemon changes the snapshot would lose and applies them once the fence lifts", () =>
    withTestHarness(async (harness) => {
      const changes = seedDaemonChanges(harness, "host-frozen-writes");

      setSnapshotFence(harness.db, true);
      try {
        changes.feed();
        changes.expectDropped();
      } finally {
        setSnapshotFence(harness.db, false);
      }

      changes.feed();
      changes.expectApplied();
    }));

  it("keeps move traffic and live daemon updates flowing once the snapshot is taken", () =>
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

      setSnapshotFence(harness.db, true);
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
          result: { reachable: true, message: null, state: "pending" },
        });
        await expect(probe).resolves.toEqual({
          reachable: true,
          message: null,
          state: "pending",
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
        setSnapshotFence(harness.db, false);
      }
    }));

  it("refuses a terminal the daemon opens once the snapshot is taken without recording it", () =>
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

      setSnapshotFence(harness.db, true);
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
        setSnapshotFence(harness.db, false);
      }
    }));

  it("does not record a terminal open that fails once the snapshot is taken", () =>
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

      setSnapshotFence(harness.db, true);
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
        setSnapshotFence(harness.db, false);
      }
    }));

  it("expires disconnected terminals when a daemon reconnects before the snapshot is taken", () =>
    withTestHarness(async (harness) => {
      const disconnected = seedDisconnectedTerminal(
        harness,
        "host-frozen-reconnect-before-export",
      );

      setServerMoveFrozen(harness.db, true);
      try {
        disconnected.reconnect();
        expect(disconnected.readTerminal()).toMatchObject({
          status: "exited",
          closeReason: "daemon-disconnect",
        });
      } finally {
        setServerMoveFrozen(harness.db, false);
      }
    }));

  it("keeps disconnected terminals until the move is released when a daemon reconnects after the snapshot", () =>
    withTestHarness(async (harness) => {
      const disconnected = seedDisconnectedTerminal(
        harness,
        "host-frozen-reconnect",
      );

      setSnapshotFence(harness.db, true);
      try {
        disconnected.reconnect();
        expect(disconnected.readTerminal()).toMatchObject({
          status: "disconnected",
        });
      } finally {
        setSnapshotFence(harness.db, false);
      }

      resumeServerMoveDeferredWork(harness.deps);

      expect(disconnected.readTerminal()).toMatchObject({
        status: "exited",
        closeReason: "daemon-disconnect",
      });
    }));

  it("accepts daemon session writes over HTTP while frozen before the snapshot is taken", () =>
    withTestHarness(async (harness) => {
      const daemon = seedDaemonSessionWrites(
        harness,
        "host-frozen-internal-before-export",
      );

      setServerMoveFrozen(harness.db, true);
      try {
        for (const [path, body] of daemon.writes) {
          const response = await daemon.post(path, body);
          expect(await readJson(response), path).not.toMatchObject({
            code: "server_moving",
          });
        }
        expect(daemon.systemErrorCount()).toBe(1);
      } finally {
        setServerMoveFrozen(harness.db, false);
      }
    }));

  it("refuses daemon session writes over HTTP once the snapshot is taken and accepts them after", () =>
    withTestHarness(async (harness) => {
      const daemon = seedDaemonSessionWrites(harness, "host-frozen-internal");

      setSnapshotFence(harness.db, true);
      try {
        for (const [path, body] of daemon.writes) {
          const response = await daemon.post(path, body);
          expect(response.status, path).toBe(503);
          expect(await readJson(response), path).toMatchObject({
            code: "server_moving",
          });
        }
        expect(daemon.systemErrorCount()).toBe(0);
        expect(
          listPendingInteractionsByThread(harness.db, {
            threadId: daemon.threadId,
          }),
        ).toEqual([]);
      } finally {
        setSnapshotFence(harness.db, false);
      }

      const accepted = await daemon.post(
        "/internal/session/events",
        daemon.eventBatch,
      );
      expect(accepted.status).toBe(200);
      expect(daemon.systemErrorCount()).toBe(1);
    }));
});

describe("the server move snapshot fence", () => {
  it("fences daemon writes only from the export and lifts the fence when a later step fails", () =>
    withTestHarness(async (harness) => {
      const move = snapshotFenceMove(harness, () => ({
        ok: false,
        errorCode: "test_failure",
        errorMessage: "download failed",
      }));

      await move.start();
      await expect
        .poll(() => move.events.includes("deferred-work:resumed"))
        .toBe(true);

      expect(move.coordinator.getStatus()).toMatchObject({
        state: "failed",
        error: { step: "transfer" },
      });
      expect(move.observed).toEqual([
        "stop work frozen=true fenced=false",
        "suspend plugins frozen=true fenced=false",
        "export frozen=true fenced=true",
      ]);
      expect(isServerMoveSnapshotFenced(harness.db)).toBe(false);
      expect(isServerMoveFrozen(harness.db)).toBe(false);
    }));

  it("lifts the snapshot fence as soon as a move is cancelled after the export", () =>
    withTestHarness(async (harness) => {
      const prepareReply = createDeferredPromise<FakeDaemonReply>();
      const move = snapshotFenceMove(harness, () => prepareReply.promise);

      await move.start();
      await expect
        .poll(() =>
          move.events.includes(`${MOVE_TARGET_HOST_ID}:server_move.prepare`),
        )
        .toBe(true);
      expect(isServerMoveSnapshotFenced(harness.db)).toBe(true);

      move.coordinator.cancel();

      expect(isServerMoveSnapshotFenced(harness.db)).toBe(false);
      prepareReply.resolve({
        ok: true,
        result: { localServerUrl: "http://127.0.0.1:39101", pid: 4242 },
      });
      await expect.poll(() => isServerMoveFrozen(harness.db)).toBe(false);
      expect(move.coordinator.getStatus()?.state).toBe("cancelled");
    }));
});
