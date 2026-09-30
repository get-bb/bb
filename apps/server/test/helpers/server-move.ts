import {
  hostDaemonOnlineRpcResponseMessageSchema,
  hostDaemonServerWsMessageSchema,
  type HostDaemonOnlineRpcRequestMessage,
  type HostDaemonOnlineRpcResponseMessage,
  type ServerMovedMessage,
  type ServerMoveInspectResult,
} from "@bb/host-daemon-contract";
import type {
  ServerMoveEnvironment,
  ServerMoveTimings,
} from "../../src/services/server-move/coordinator.js";
import { exportServerArchive } from "../../src/services/server-move/export.js";
import type { TestAppHarness } from "./test-app.js";

export type FakeDaemonReply =
  | { ok: true; result: unknown }
  | { ok: false; errorCode: string; errorMessage: string };

export type FakeDaemonHandler = (
  request: HostDaemonOnlineRpcRequestMessage,
) => FakeDaemonReply | Promise<FakeDaemonReply>;

export interface FakeDaemon {
  hostId: string;
  movedMessages: ServerMovedMessage[];
  requests: HostDaemonOnlineRpcRequestMessage[];
  sessionId: string;
}

export interface RegisterFakeDaemonArgs {
  events: string[];
  handle: FakeDaemonHandler;
  hostId: string;
}

export const TEST_SERVER_MOVE_TIMINGS: ServerMoveTimings = {
  abortTimeoutMs: 1_000,
  activateAttemptTimeoutMs: 2_000,
  activateRetryDelayMs: 10,
  activateRetryWindowMs: 2_000,
  inspectTimeoutMs: 2_000,
  pluginShutdownTimeoutMs: 2_000,
  prepareTimeoutMs: 10_000,
  probeTimeoutMs: 2_000,
  recoveryProbeIntervalMs: 50,
  retireDelayMs: 0,
  stopWorkTimeoutMs: 2_000,
};

export function inspectResult(
  overrides: Partial<ServerMoveInspectResult> = {},
): ServerMoveInspectResult {
  return {
    dataDir: "/home/me/.bb-machines/laptop",
    platform: "linux",
    timeZone: "UTC",
    bbAppVersion: "0.0.0-test",
    serverEntryAvailable: true,
    serviceManager: "systemd-user",
    existingServerData: null,
    dataDirHasServerData: false,
    portAvailable: true,
    ghAuthenticated: null,
    codexCredentialsPresent: false,
    pathsExist: {},
    diskFreeBytes: null,
    ...overrides,
  };
}

function toResponse(
  request: HostDaemonOnlineRpcRequestMessage,
  reply: FakeDaemonReply,
): HostDaemonOnlineRpcResponseMessage {
  if (reply.ok) {
    return hostDaemonOnlineRpcResponseMessageSchema.parse({
      type: "host-rpc.response",
      requestId: request.requestId,
      commandType: request.command.type,
      ok: true,
      result: reply.result,
    });
  }
  return {
    type: "host-rpc.response",
    requestId: request.requestId,
    commandType: request.command.type,
    ok: false,
    errorCode: reply.errorCode,
    errorMessage: reply.errorMessage,
  };
}

export function registerFakeDaemon(
  harness: Pick<TestAppHarness, "hub">,
  args: RegisterFakeDaemonArgs,
): FakeDaemon {
  const daemon: FakeDaemon = {
    hostId: args.hostId,
    movedMessages: [],
    requests: [],
    sessionId: `session-${args.hostId}`,
  };
  harness.hub.registerDaemon(daemon.sessionId, args.hostId, {
    close() {},
    send(data) {
      const message = hostDaemonServerWsMessageSchema.parse(JSON.parse(data));
      if (message.type === "server.moved") {
        args.events.push(`server.moved:${args.hostId}`);
        daemon.movedMessages.push(message);
        return;
      }
      if (message.type !== "host-rpc.request") {
        return;
      }
      daemon.requests.push(message);
      args.events.push(`${args.hostId}:${message.command.type}`);
      void Promise.resolve()
        .then(() => args.handle(message))
        .catch((error: unknown): FakeDaemonReply => ({
          ok: false,
          errorCode: "test_rpc_error",
          errorMessage: error instanceof Error ? error.message : String(error),
        }))
        .then((reply) => {
          harness.hub.recordHostOnlineRpcResponse({
            message: toResponse(message, reply),
            sessionId: daemon.sessionId,
          });
        });
    },
  });
  return daemon;
}

export interface TestServerMovePlugins {
  paused: boolean;
  resumes: number;
  stops: number;
  suspends: number;
}

export interface TestServerMoveEnvironment {
  environment: ServerMoveEnvironment;
  events: string[];
  plugins: TestServerMovePlugins;
}

export function createTestServerMoveEnvironment(
  harness: TestAppHarness,
  overrides: Partial<ServerMoveEnvironment> = {},
): TestServerMoveEnvironment {
  const events: string[] = [];
  const plugins: TestServerMovePlugins = {
    paused: false,
    resumes: 0,
    stops: 0,
    suspends: 0,
  };
  const environment: ServerMoveEnvironment = {
    allowLoopbackServerUrl: false,
    bindHost: null,
    deps: harness.deps,
    exportArchive: (args) => {
      events.push("export");
      return exportServerArchive({
        appVersion: harness.config.appVersion,
        dataDir: harness.config.dataDir,
        db: harness.db,
        fileName: "server.tar.gz",
        logger: harness.deps.logger,
        now: Date.now(),
        sourceServerHostId: args.sourceServerHostId,
        workDir: args.workDir,
      });
    },
    fullArtifact: {
      availability: async () => ({
        available: false,
        reason: "The test server has no packaged bb-app.",
      }),
      build: async () => {
        throw new Error("The test server has no packaged bb-app.");
      },
    },
    now: Date.now,
    plugins: {
      async resumeSuspended() {
        plugins.resumes += 1;
        events.push("plugins:resume");
      },
      setSchedulesPaused(paused) {
        plugins.paused = paused;
        events.push(`schedules:${paused ? "paused" : "resumed"}`);
      },
      async stop() {
        plugins.stops += 1;
        events.push("plugins:stop");
      },
      async suspendAllButConnect() {
        plugins.suspends += 1;
        events.push("plugins:suspend");
      },
    },
    readServerDiskFreeBytes: async () => null,
    resolveMode: async () => ({ mode: "direct" }),
    resolveServerHostGrant: async () => {
      throw new Error("Direct moves don't resolve a server access grant");
    },
    resumeDeferredWork() {
      events.push("deferred-work:resumed");
    },
    retireProcess() {
      events.push("retire");
    },
    serverAppSurface: "web",
    serverTimeZone: "UTC",
    stopRunningWork: async () => {
      events.push("stop-work");
    },
    targetServerPort: () => 39_101,
    timings: TEST_SERVER_MOVE_TIMINGS,
    ...overrides,
  };
  return { environment, events, plugins };
}
