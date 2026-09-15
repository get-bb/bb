import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  type HostDaemonOnlineRpcRequestMessage,
  type HostDaemonRpcCommand,
} from "@bb/host-daemon-contract";
import { openSession, upsertHost } from "@bb/db";
import { readServerMovedFile } from "@bb/server-archive";
import type { ServerMoveStatus } from "@bb/server-contract";
import { createDeferredPromise } from "@bb/test-helpers";
import { describe, expect, it, vi } from "vitest";
import { createServerMoveCoordinator } from "../../src/services/server-move/coordinator.js";
import { isServerMoveFrozen } from "../../src/services/server-move/freeze-state.js";
import { onDaemonSocketMessage } from "../../src/ws/daemon-protocol.js";
import {
  createTestServerMoveEnvironment,
  inspectResult,
  registerFakeDaemon,
  TEST_SERVER_MOVE_TIMINGS,
  type FakeDaemonReply,
} from "../helpers/server-move.js";
import { seedHost, seedPrimaryHost } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const OLD = "host-old";
const NEW = "host-new";
const WORKER = "host-worker";
const SANDBOX = "host-sandbox";
const OFFLINE = "host-offline";
const DIRECT_URL = "https://desktop.example.test";
const CONNECT_URL = "https://laptop.getbb.test";

const START_DIRECT = {
  targetHostId: NEW,
  serverUrl: DIRECT_URL,
  stopRunningWork: true as const,
  archiveExistingTargetServerData: false,
};

function ok(result: unknown): FakeDaemonReply {
  return { ok: true, result };
}

function fail(errorMessage: string): FakeDaemonReply {
  return { ok: false, errorCode: "test_failure", errorMessage };
}

function seedTopology(harness: TestAppHarness): void {
  seedHost(harness.deps, { id: OLD, name: "Laptop" });
  seedPrimaryHost(harness.deps, OLD);
  seedHost(harness.deps, { id: NEW, name: "Desktop" });
  seedHost(harness.deps, { id: WORKER, name: "Worker" });
  seedHost(harness.deps, { id: OFFLINE, name: "Offline" });
  upsertHost(harness.db, harness.hub, {
    id: SANDBOX,
    name: "Sandbox",
    type: "ephemeral",
  });
}

function targetReply(
  request: HostDaemonOnlineRpcRequestMessage,
): FakeDaemonReply {
  switch (request.command.type) {
    case "server_move.inspect":
      return ok(inspectResult());
    case "server_move.prepare":
      return ok({ localServerUrl: "http://127.0.0.1:39101", pid: 4242 });
    case "server_move.activate":
    case "server_move.abort":
      return ok({ ok: true });
    default:
      throw new Error(`Unexpected target command ${request.command.type}`);
  }
}

function probeReply(
  request: HostDaemonOnlineRpcRequestMessage,
): FakeDaemonReply {
  if (request.command.type === "server_move.probe") {
    return ok({ reachable: true, message: null, state: "pending" });
  }
  if (request.command.type === "server_move.inspect") {
    return ok(inspectResult());
  }
  throw new Error(`Unexpected command ${request.command.type}`);
}

function requireCommand<TType extends HostDaemonRpcCommand["type"]>(
  requests: readonly HostDaemonOnlineRpcRequestMessage[],
  type: TType,
): Extract<HostDaemonRpcCommand, { type: TType }> {
  const command = requests
    .map((request) => request.command)
    .find(
      (
        candidate,
      ): candidate is Extract<HostDaemonRpcCommand, { type: TType }> =>
        candidate.type === type,
    );
  if (command === undefined) {
    throw new Error(`Missing ${type} request`);
  }
  return command;
}

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the call to throw");
}

function stepStatuses(status: ServerMoveStatus | null): [string, string][] {
  return (status?.steps ?? []).map((step) => [step.id, step.status]);
}

async function writeConfig(harness: TestAppHarness, value: unknown) {
  const path = join(harness.config.dataDir, "config.json");
  const text = `${JSON.stringify(value)}\n`;
  await writeFile(path, text);
  return { path, text };
}

describe("server move coordinator", () => {
  it("runs a direct move in step order and hands the server to the target", () =>
    withTestHarness(async (harness) => {
      seedTopology(harness);
      const config = await writeConfig(harness, {
        config: { BB_LOG_LEVEL: "debug" },
        machineCredential: "stale-credential",
        serverHeaders: { "x-stale": "1" },
      });
      await writeFile(join(harness.config.dataDir, "bb.db"), "");
      const { environment, events, plugins } =
        createTestServerMoveEnvironment(harness);
      const coordinator = createServerMoveCoordinator(environment);
      const notifySystem = vi.spyOn(harness.hub, "notifySystem");
      const progressSnapshots: (ServerMoveStatus | null)[] = [];
      const old = registerFakeDaemon(harness, {
        events,
        hostId: OLD,
        handle: probeReply,
      });
      const worker = registerFakeDaemon(harness, {
        events,
        hostId: WORKER,
        handle: probeReply,
      });
      const sandbox = registerFakeDaemon(harness, {
        events,
        hostId: SANDBOX,
        handle: (request) => {
          throw new Error(`The sandbox got ${request.command.type}`);
        },
      });
      const target = registerFakeDaemon(harness, {
        events,
        hostId: NEW,
        handle: (request) => {
          if (request.command.type === "server_move.prepare") {
            coordinator.handleProgress(NEW, {
              type: "server_move.progress",
              moveId: request.command.moveId,
              step: "transfer",
              message: "Downloading the export",
            });
            progressSnapshots.push(coordinator.getStatus());
            coordinator.handleProgress(WORKER, {
              type: "server_move.progress",
              moveId: request.command.moveId,
              step: "start-target",
              message: "Ignored from another machine",
            });
            coordinator.handleProgress(NEW, {
              type: "server_move.progress",
              moveId: request.command.moveId,
              step: "update-target",
              message: "Installing bb",
            });
            progressSnapshots.push(coordinator.getStatus());
            coordinator.handleProgress(NEW, {
              type: "server_move.progress",
              moveId: request.command.moveId,
              step: "start-target",
              message: "Starting the new server",
            });
            progressSnapshots.push(coordinator.getStatus());
          }
          return targetReply(request);
        },
      });

      const started = await coordinator.start(START_DIRECT);

      expect(started).toMatchObject({
        state: "preparing",
        mode: "direct",
        targetHostId: NEW,
        targetHostName: "Desktop",
        serverUrl: DIRECT_URL,
        destinationStatusUrl: `${DIRECT_URL}/health`,
        finishedAt: null,
        error: null,
        cancellable: true,
      });
      expect(coordinator.isFrozen()).toBe(true);
      await expect.poll(() => events.includes("retire")).toBe(true);
      await expect
        .poll(() => existsSync(join(harness.config.dataDir, "server-move")))
        .toBe(false);

      const status = coordinator.getStatus();
      expect(status).toMatchObject({
        moveId: started.moveId,
        state: "completed",
        error: null,
        cancellable: false,
      });
      expect(stepStatuses(status)).toEqual([
        ["stop-work", "done"],
        ["update-target", "done"],
        ["export", "done"],
        ["transfer", "done"],
        ["start-target", "done"],
        ["verify-address", "done"],
        ["switch", "done"],
      ]);
      expect(progressSnapshots[0]?.steps[3]).toEqual({
        id: "transfer",
        status: "running",
        message: "Downloading the export",
      });
      expect(stepStatuses(progressSnapshots[1] ?? null)).toEqual([
        ["stop-work", "done"],
        ["update-target", "running"],
        ["export", "done"],
        ["transfer", "done"],
        ["start-target", "pending"],
        ["verify-address", "pending"],
        ["switch", "pending"],
      ]);
      expect(progressSnapshots[1]?.steps[1]?.message).toBe("Installing bb");
      expect(progressSnapshots[2]?.steps.slice(3, 5)).toEqual([
        { id: "transfer", status: "done", message: "Downloading the export" },
        {
          id: "start-target",
          status: "running",
          message: "Starting the new server",
        },
      ]);
      expect(progressSnapshots[2]?.steps[1]?.status).toBe("done");

      const probes = events
        .filter((event) => event.endsWith(":server_move.probe"))
        .sort();
      expect(probes).toEqual([
        `${OLD}:server_move.probe`,
        `${WORKER}:server_move.probe`,
      ]);
      for (const probe of probes) {
        expect(events.indexOf(probe)).toBeGreaterThan(
          events.indexOf(`${NEW}:server_move.prepare`),
        );
        expect(events.indexOf(probe)).toBeLessThan(
          events.indexOf(`${NEW}:server_move.activate`),
        );
      }
      expect(
        events.filter((event) => !event.endsWith(":server_move.probe")),
      ).toEqual([
        `${NEW}:server_move.inspect`,
        `${OLD}:server_move.inspect`,
        "schedules:paused",
        "stop-work",
        "plugins:suspend",
        `${NEW}:server_move.inspect`,
        "export",
        `${NEW}:server_move.prepare`,
        `${NEW}:server_move.activate`,
        "plugins:stop",
        `server.moved:${OLD}`,
        `server.moved:${WORKER}`,
        "retire",
      ]);

      const prepare = requireCommand(target.requests, "server_move.prepare");
      expect(prepare).toMatchObject({
        moveId: started.moveId,
        archive: {
          downloadPath: `/internal/server-move/${started.moveId}/archive`,
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        },
        bbApp: null,
        serverPort: 39_101,
        bindHost: null,
        sourceDataDir: harness.config.dataDir,
        sourceServerHostId: OLD,
        serverUrl: DIRECT_URL,
        archiveExistingServerData: false,
      });
      expect(Object.keys(prepare.archive).sort()).toEqual([
        "downloadPath",
        "sha256",
        "sizeBytes",
      ]);
      expect(requireCommand(target.requests, "server_move.activate")).toEqual({
        type: "server_move.activate",
        moveId: started.moveId,
        activationToken: prepare.activationToken,
        lastMove: {
          moveId: started.moveId,
          fromHostId: OLD,
          fromHostName: "Laptop",
          toHostId: NEW,
          toHostName: "Desktop",
          completedAt: expect.any(Number),
          oldCopyDeletedAt: null,
        },
      });
      expect(
        target.requests.some(
          (request) => request.command.type === "server_move.abort",
        ),
      ).toBe(false);

      const moved = await readServerMovedFile(harness.config.dataDir);
      expect(moved).toMatchObject({
        version: 1,
        moveId: started.moveId,
        fromHostId: OLD,
        toHostId: NEW,
        toHostName: "Desktop",
        serverUrl: DIRECT_URL,
        mode: "direct",
        connectHandle: null,
      });
      expect(moved?.oldCopyEntries).toEqual(["auth-secret", "bb.db"]);
      expect(JSON.parse(await readFile(config.path, "utf8"))).toEqual({
        config: { BB_LOG_LEVEL: "debug" },
        serverUrl: DIRECT_URL,
      });
      expect(old.movedMessages).toEqual([
        { type: "server.moved", serverUrl: DIRECT_URL, headers: {} },
      ]);
      expect(worker.movedMessages).toEqual([
        { type: "server.moved", serverUrl: DIRECT_URL, headers: {} },
      ]);
      expect(target.movedMessages).toEqual([]);
      expect(sandbox.movedMessages).toEqual([]);
      expect(coordinator.movedTo()).toEqual({
        serverUrl: DIRECT_URL,
        toHostName: "Desktop",
        movedAt: moved?.movedAt,
      });
      expect(plugins).toEqual({
        paused: true,
        resumes: 0,
        stops: 1,
        suspends: 1,
      });
      expect(coordinator.isFrozen()).toBe(true);
      expect(notifySystem).toHaveBeenCalledWith(["server-move-changed"]);
      await expect
        .poll(() =>
          existsSync(
            join(harness.config.dataDir, "server-move", started.moveId),
          ),
        )
        .toBe(false);
      await expect(coordinator.start(START_DIRECT)).rejects.toMatchObject({
        status: 409,
        body: { code: "server_move_in_progress" },
      });
    }));

  it("moves a bb connect server with the old server's own grant and no address probe", () =>
    withTestHarness(async (harness) => {
      seedTopology(harness);
      const base = createTestServerMoveEnvironment(harness);
      const { events } = base;
      const grantHeaders = { "x-bb-connect-machine": "bbcm_laptop" };
      const coordinator = createServerMoveCoordinator({
        ...base.environment,
        resolveMode: async () => ({
          mode: "connect",
          connectHandle: "laptop",
          serverUrl: CONNECT_URL,
        }),
        resolveServerHostGrant: async (hostId) => {
          events.push(`grant:${hostId}`);
          return { serverUrl: CONNECT_URL, headers: grantHeaders };
        },
      });
      const old = registerFakeDaemon(harness, {
        events,
        hostId: OLD,
        handle: probeReply,
      });
      const worker = registerFakeDaemon(harness, {
        events,
        hostId: WORKER,
        handle: probeReply,
      });
      const target = registerFakeDaemon(harness, {
        events,
        hostId: NEW,
        handle: targetReply,
      });

      const started = await coordinator.start({
        ...START_DIRECT,
        serverUrl: null,
      });
      expect(started).toMatchObject({
        mode: "connect",
        serverUrl: CONNECT_URL,
        destinationStatusUrl: null,
      });
      await expect.poll(() => events.includes("retire")).toBe(true);

      expect(events).toEqual([
        `${NEW}:server_move.inspect`,
        `${OLD}:server_move.inspect`,
        "schedules:paused",
        "stop-work",
        `grant:${OLD}`,
        "plugins:suspend",
        `${NEW}:server_move.inspect`,
        "export",
        `${NEW}:server_move.prepare`,
        `${NEW}:server_move.activate`,
        "plugins:stop",
        `server.moved:${OLD}`,
        "retire",
      ]);
      expect(coordinator.getStatus()?.steps[5]).toMatchObject({
        id: "verify-address",
        status: "skipped",
      });
      expect(old.movedMessages).toEqual([
        { type: "server.moved", serverUrl: CONNECT_URL, headers: grantHeaders },
      ]);
      expect(worker.movedMessages).toEqual([]);
      expect(target.movedMessages).toEqual([]);
      expect(
        requireCommand(target.requests, "server_move.prepare"),
      ).toMatchObject({ serverUrl: CONNECT_URL });
      expect(await readServerMovedFile(harness.config.dataDir)).toMatchObject({
        mode: "connect",
        connectHandle: "laptop",
        serverUrl: CONNECT_URL,
      });
      expect(
        JSON.parse(
          await readFile(join(harness.config.dataDir, "config.json"), "utf8"),
        ),
      ).toEqual({ serverUrl: CONNECT_URL, serverHeaders: grantHeaders });
    }));

  it.each([
    {
      name: "the target inspect during update-target",
      failedStep: "update-target",
      stepMessage: "inspect exploded",
      configure:
        (state: { inspects: number }) =>
        (request: HostDaemonOnlineRpcRequestMessage): FakeDaemonReply => {
          if (request.command.type === "server_move.inspect") {
            state.inspects += 1;
            return state.inspects === 1
              ? ok(inspectResult())
              : fail("inspect exploded");
          }
          return targetReply(request);
        },
      workerProbe: probeReply,
      pluginSuspends: 1,
    },
    {
      name: "prepare on the target",
      failedStep: "transfer",
      stepMessage: "download failed",
      configure:
        () =>
        (request: HostDaemonOnlineRpcRequestMessage): FakeDaemonReply =>
          request.command.type === "server_move.prepare"
            ? fail("download failed")
            : targetReply(request),
      workerProbe: probeReply,
      pluginSuspends: 1,
    },
    {
      name: "an address probe",
      failedStep: "verify-address",
      stepMessage: "Worker: connection refused",
      configure: () => targetReply,
      workerProbe: (request: HostDaemonOnlineRpcRequestMessage) =>
        request.command.type === "server_move.probe"
          ? ok({ reachable: false, message: "connection refused", state: null })
          : probeReply(request),
      pluginSuspends: 1,
    },
    {
      name: "activation on the target",
      failedStep: "switch",
      stepMessage: "Desktop couldn't take over: token rejected",
      configure:
        () =>
        (request: HostDaemonOnlineRpcRequestMessage): FakeDaemonReply =>
          request.command.type === "server_move.activate"
            ? fail("token rejected")
            : targetReply(request),
      workerProbe: probeReply,
      pluginSuspends: 1,
    },
  ])("aborts, unfreezes, and resumes schedules when $name fails", (scenario) =>
    withTestHarness(async (harness) => {
      seedTopology(harness);
      const config = await writeConfig(harness, {
        config: { BB_LOG_LEVEL: "info" },
      });
      const { environment, events, plugins } =
        createTestServerMoveEnvironment(harness);
      const coordinator = createServerMoveCoordinator(environment);
      const old = registerFakeDaemon(harness, {
        events,
        hostId: OLD,
        handle: probeReply,
      });
      const worker = registerFakeDaemon(harness, {
        events,
        hostId: WORKER,
        handle: scenario.workerProbe,
      });
      const target = registerFakeDaemon(harness, {
        events,
        hostId: NEW,
        handle: scenario.configure({ inspects: 0 }),
      });

      await coordinator.start(START_DIRECT);
      await expect
        .poll(() => events.includes(`${NEW}:server_move.abort`))
        .toBe(true);
      await expect
        .poll(() => events.includes("deferred-work:resumed"))
        .toBe(true);

      const status = coordinator.getStatus();
      expect(status).toMatchObject({
        state: "failed",
        cancellable: false,
        error: { step: scenario.failedStep },
      });
      expect(status?.error?.message).toContain(scenario.stepMessage);
      expect(
        status?.steps.find((step) => step.id === scenario.failedStep),
      ).toMatchObject({ status: "failed" });
      expect(coordinator.isFrozen()).toBe(false);
      expect(plugins).toEqual({
        paused: false,
        resumes: scenario.pluginSuspends,
        stops: 0,
        suspends: scenario.pluginSuspends,
      });
      expect(isServerMoveFrozen(harness.db)).toBe(false);
      expect(events).toContain("schedules:resumed");
      expect(events.indexOf("schedules:resumed")).toBeGreaterThan(
        events.indexOf("plugins:resume"),
      );
      expect(events).not.toContain("retire");
      expect(coordinator.movedTo()).toBeNull();
      expect(await readServerMovedFile(harness.config.dataDir)).toBeNull();
      expect(await readFile(config.path, "utf8")).toBe(config.text);
      expect([
        ...old.movedMessages,
        ...worker.movedMessages,
        ...target.movedMessages,
      ]).toEqual([]);
      await expect
        .poll(() =>
          existsSync(
            join(harness.config.dataDir, "server-move", status?.moveId ?? ""),
          ),
        )
        .toBe(false);
    }),
  );

  it.each([
    { hung: "suspendAllButConnect" as const, warning: "suspension" },
    { hung: "stop" as const, warning: "shutdown" },
  ])(
    "keeps moving when plugin $warning outlives its time box",
    ({ hung, warning }) =>
      withTestHarness(async (harness) => {
        seedTopology(harness);
        const base = createTestServerMoveEnvironment(harness, {
          timings: { ...TEST_SERVER_MOVE_TIMINGS, pluginShutdownTimeoutMs: 50 },
        });
        const { events } = base;
        const never = createDeferredPromise<void>();
        const coordinator = createServerMoveCoordinator({
          ...base.environment,
          plugins: {
            ...base.environment.plugins,
            [hung]: async () => {
              events.push(`plugins:${hung}:hung`);
              await never.promise;
            },
          },
        });
        const warn = vi.spyOn(harness.deps.logger, "warn");
        registerFakeDaemon(harness, {
          events,
          hostId: OLD,
          handle: probeReply,
        });
        registerFakeDaemon(harness, {
          events,
          hostId: WORKER,
          handle: probeReply,
        });
        registerFakeDaemon(harness, {
          events,
          hostId: NEW,
          handle: targetReply,
        });

        await coordinator.start(START_DIRECT);
        await expect.poll(() => events.includes("retire")).toBe(true);

        expect(coordinator.getStatus()?.state).toBe("completed");
        expect(events).toContain(`plugins:${hung}:hung`);
        expect(events).toContain(`server.moved:${OLD}`);
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({ timeoutMs: 50 }),
          `Server move plugin ${warning} did not finish in time; continuing`,
        );
        never.resolve();
      }),
  );

  it("maps daemon error codes into the failed step's message", () =>
    withTestHarness(async (harness) => {
      seedTopology(harness);
      const { environment, events } = createTestServerMoveEnvironment(harness);
      const coordinator = createServerMoveCoordinator(environment);
      registerFakeDaemon(harness, { events, hostId: OLD, handle: probeReply });
      registerFakeDaemon(harness, {
        events,
        hostId: NEW,
        handle: (request) =>
          request.command.type === "server_move.prepare"
            ? {
                ok: false,
                errorCode: "server_move_archive_corrupt",
                errorMessage: "Archive data is corrupt: unexpected end of file",
              }
            : targetReply(request),
      });

      await coordinator.start(START_DIRECT);
      await expect.poll(() => coordinator.getStatus()?.state).toBe("failed");

      expect(coordinator.getStatus()?.error).toEqual({
        step: "transfer",
        message:
          "The machine couldn't unpack the export: Archive data is corrupt: unexpected end of file",
      });
    }));

  it("treats an already-activated target as switched and never aborts it", () =>
    withTestHarness(async (harness) => {
      seedTopology(harness);
      const { environment, events, plugins } =
        createTestServerMoveEnvironment(harness);
      const coordinator = createServerMoveCoordinator(environment);
      registerFakeDaemon(harness, { events, hostId: OLD, handle: probeReply });
      registerFakeDaemon(harness, {
        events,
        hostId: WORKER,
        handle: probeReply,
      });
      registerFakeDaemon(harness, {
        events,
        hostId: NEW,
        handle: (request) =>
          request.command.type === "server_move.activate"
            ? {
                ok: false,
                errorCode: "server_move_already_activated",
                errorMessage: "Already activated",
              }
            : targetReply(request),
      });

      await coordinator.start(START_DIRECT);
      await expect.poll(() => events.includes("retire")).toBe(true);

      expect(coordinator.getStatus()?.state).toBe("completed");
      expect(events).not.toContain(`${NEW}:server_move.abort`);
      expect(events).toContain(`server.moved:${OLD}`);
      expect(plugins).toMatchObject({ resumes: 0, stops: 1 });
      expect(await readServerMovedFile(harness.config.dataDir)).not.toBeNull();
    }));

  it("rolls back the lock and keeps plugins running when the old config can't be rewritten", () =>
    withTestHarness(async (harness) => {
      seedTopology(harness);
      const config = await writeConfig(harness, { unknownKey: true });
      const { environment, events, plugins } =
        createTestServerMoveEnvironment(harness);
      const coordinator = createServerMoveCoordinator(environment);
      registerFakeDaemon(harness, { events, hostId: OLD, handle: probeReply });
      registerFakeDaemon(harness, {
        events,
        hostId: WORKER,
        handle: probeReply,
      });
      registerFakeDaemon(harness, { events, hostId: NEW, handle: targetReply });

      await coordinator.start(START_DIRECT);
      await expect
        .poll(() => events.includes(`${NEW}:server_move.abort`))
        .toBe(true);

      expect(coordinator.getStatus()).toMatchObject({
        state: "failed",
        error: { step: "switch" },
      });
      expect(await readServerMovedFile(harness.config.dataDir)).toBeNull();
      expect(await readFile(config.path, "utf8")).toBe(config.text);
      expect(events).not.toContain(`${NEW}:server_move.activate`);
      expect(plugins).toEqual({
        paused: false,
        resumes: 1,
        stops: 0,
        suspends: 1,
      });
      expect(coordinator.isFrozen()).toBe(false);
    }));

  it("cancels while the target prepares, ignores its late reply, and allows a new move", () =>
    withTestHarness(async (harness) => {
      seedTopology(harness);
      const { environment, events, plugins } =
        createTestServerMoveEnvironment(harness);
      const coordinator = createServerMoveCoordinator(environment);
      const prepareReply = createDeferredPromise<FakeDaemonReply>();
      let prepares = 0;
      registerFakeDaemon(harness, { events, hostId: OLD, handle: probeReply });
      registerFakeDaemon(harness, {
        events,
        hostId: WORKER,
        handle: probeReply,
      });
      const target = registerFakeDaemon(harness, {
        events,
        hostId: NEW,
        handle: (request) => {
          if (request.command.type === "server_move.prepare") {
            prepares += 1;
            if (prepares === 1) {
              return prepareReply.promise;
            }
          }
          return targetReply(request);
        },
      });
      const session = openSession(harness.db, {
        hostId: NEW,
        instanceId: "instance-new",
        hostName: "Desktop",
        dataDir: "/home/me/.bb-machines/laptop",
        protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
        heartbeatIntervalMs: 5_000,
        leaseTimeoutMs: 30_000,
      });

      const started = await coordinator.start(START_DIRECT);
      await expect
        .poll(() => events.includes(`${NEW}:server_move.prepare`))
        .toBe(true);
      onDaemonSocketMessage(
        harness.deps,
        {
          hostId: NEW,
          raw: JSON.stringify({
            type: "server_move.progress",
            moveId: started.moveId,
            step: "transfer",
            message: "Downloaded 40%",
          }),
          sessionId: session.id,
          socket: { close() {}, send() {} },
        },
        undefined,
        coordinator,
      );
      expect(coordinator.getStatus()?.steps[3]).toEqual({
        id: "transfer",
        status: "running",
        message: "Downloaded 40%",
      });

      expect(isServerMoveFrozen(harness.db)).toBe(true);
      expect(plugins.suspends).toBe(1);

      const cancelled = coordinator.cancel();

      expect(cancelled).toMatchObject({
        moveId: started.moveId,
        state: "cancelled",
        cancellable: false,
        error: { step: "transfer", message: "The move was cancelled" },
      });
      expect(coordinator.isFrozen()).toBe(false);
      await expect.poll(() => isServerMoveFrozen(harness.db)).toBe(false);
      expect(events.indexOf("plugins:resume")).toBeLessThan(
        events.indexOf("schedules:resumed"),
      );
      expect(plugins.paused).toBe(false);
      await expect
        .poll(() => events.includes(`${NEW}:server_move.abort`))
        .toBe(true);
      prepareReply.resolve(
        ok({ localServerUrl: "http://127.0.0.1:39101", pid: 4242 }),
      );
      await expect
        .poll(() =>
          existsSync(
            join(harness.config.dataDir, "server-move", started.moveId),
          ),
        )
        .toBe(false);
      expect(coordinator.getStatus()?.state).toBe("cancelled");
      expect(events).not.toContain(`${NEW}:server_move.activate`);
      expect(events).not.toContain("plugins:stop");
      expect(plugins).toMatchObject({ resumes: 1, stops: 0, suspends: 1 });
      expect(captureError(() => coordinator.cancel())).toMatchObject({
        status: 409,
        body: { code: "server_move_not_cancellable" },
      });

      const restarted = await coordinator.start(START_DIRECT);
      expect(restarted.moveId).not.toBe(started.moveId);
      await expect.poll(() => events.includes("retire")).toBe(true);
      expect(coordinator.getStatus()?.state).toBe("completed");
      expect(plugins).toMatchObject({ resumes: 1, stops: 1, suspends: 2 });
      expect(
        target.requests.filter(
          (request) => request.command.type === "server_move.activate",
        ),
      ).toHaveLength(1);
    }));

  it("keeps the tunnel up during activation and retries an unconfirmed activation", () =>
    withTestHarness(async (harness) => {
      seedTopology(harness);
      const { environment, events, plugins } = createTestServerMoveEnvironment(
        harness,
        {
          timings: {
            ...TEST_SERVER_MOVE_TIMINGS,
            activateAttemptTimeoutMs: 100,
            activateRetryWindowMs: 2_000,
          },
        },
      );
      const coordinator = createServerMoveCoordinator(environment);
      const lostReply = createDeferredPromise<FakeDaemonReply>();
      let activations = 0;
      registerFakeDaemon(harness, { events, hostId: OLD, handle: probeReply });
      registerFakeDaemon(harness, {
        events,
        hostId: WORKER,
        handle: probeReply,
      });
      registerFakeDaemon(harness, {
        events,
        hostId: NEW,
        handle: (request) => {
          if (request.command.type !== "server_move.activate") {
            return targetReply(request);
          }
          activations += 1;
          expect(plugins.stops).toBe(0);
          return activations === 1 ? lostReply.promise : ok({ ok: true });
        },
      });

      await coordinator.start(START_DIRECT);
      await expect.poll(() => events.includes("retire")).toBe(true);

      expect(activations).toBe(2);
      expect(
        events.slice(events.indexOf(`${NEW}:server_move.activate`)),
      ).toEqual([
        `${NEW}:server_move.activate`,
        `${NEW}:server_move.activate`,
        "plugins:stop",
        `server.moved:${OLD}`,
        `server.moved:${WORKER}`,
        "retire",
      ]);
      expect(coordinator.getStatus()?.state).toBe("completed");
      expect(events).not.toContain(`${NEW}:server_move.abort`);
      expect(plugins).toMatchObject({ resumes: 0, stops: 1 });
      lostReply.resolve(ok({ ok: true }));
    }));

  it("commits the switch when the target drops after an activation attempt", () =>
    withTestHarness(async (harness) => {
      seedTopology(harness);
      const { environment, events, plugins } = createTestServerMoveEnvironment(
        harness,
        {
          timings: {
            ...TEST_SERVER_MOVE_TIMINGS,
            activateRetryWindowMs: 300,
          },
        },
      );
      const coordinator = createServerMoveCoordinator(environment);
      registerFakeDaemon(harness, { events, hostId: OLD, handle: probeReply });
      registerFakeDaemon(harness, {
        events,
        hostId: WORKER,
        handle: probeReply,
      });
      const target = registerFakeDaemon(harness, {
        events,
        hostId: NEW,
        handle: (request) => {
          if (request.command.type !== "server_move.activate") {
            return targetReply(request);
          }
          harness.hub.unregisterDaemon(target.sessionId);
          return createDeferredPromise<FakeDaemonReply>().promise;
        },
      });

      await coordinator.start(START_DIRECT);
      await expect.poll(() => events.includes("retire")).toBe(true);

      expect(coordinator.getStatus()?.state).toBe("completed");
      expect(events).not.toContain(`${NEW}:server_move.abort`);
      expect(events).toContain(`server.moved:${WORKER}`);
      expect(plugins).toMatchObject({ resumes: 0, stops: 1 });
      expect(await readServerMovedFile(harness.config.dataDir)).not.toBeNull();
    }));

  it("rolls back when the target is gone before activation can be sent", () =>
    withTestHarness(async (harness) => {
      seedTopology(harness);
      const config = await writeConfig(harness, {
        config: { BB_LOG_LEVEL: "info" },
      });
      const { environment, events, plugins } = createTestServerMoveEnvironment(
        harness,
        {
          timings: {
            ...TEST_SERVER_MOVE_TIMINGS,
            activateRetryWindowMs: 200,
          },
        },
      );
      const coordinator = createServerMoveCoordinator(environment);
      const handles: { targetSessionId: string | null } = {
        targetSessionId: null,
      };
      registerFakeDaemon(harness, { events, hostId: OLD, handle: probeReply });
      registerFakeDaemon(harness, {
        events,
        hostId: WORKER,
        handle: (request) => {
          if (
            request.command.type === "server_move.probe" &&
            handles.targetSessionId !== null
          ) {
            harness.hub.unregisterDaemon(handles.targetSessionId);
          }
          return probeReply(request);
        },
      });
      handles.targetSessionId = registerFakeDaemon(harness, {
        events,
        hostId: NEW,
        handle: targetReply,
      }).sessionId;

      await coordinator.start(START_DIRECT);
      await expect.poll(() => coordinator.getStatus()?.state).toBe("failed");
      await expect.poll(() => plugins.resumes).toBe(1);

      expect(coordinator.getStatus()?.error).toEqual({
        step: "switch",
        message: "Desktop disconnected before it could take over",
      });
      expect(events).not.toContain(`${NEW}:server_move.activate`);
      expect(events).not.toContain("plugins:stop");
      expect(events).not.toContain("retire");
      expect(events.some((event) => event.startsWith("server.moved"))).toBe(
        false,
      );
      expect(await readServerMovedFile(harness.config.dataDir)).toBeNull();
      expect(await readFile(config.path, "utf8")).toBe(config.text);
      expect(coordinator.isFrozen()).toBe(false);
    }));

  it("keeps a newer move frozen when the cancelled move's plugins finish resuming late", () =>
    withTestHarness(async (harness) => {
      seedTopology(harness);
      const base = createTestServerMoveEnvironment(harness);
      const { events, plugins } = base;
      const slowResume = createDeferredPromise<void>();
      const coordinator = createServerMoveCoordinator({
        ...base.environment,
        plugins: {
          ...base.environment.plugins,
          resumeSuspended: async () => {
            await base.environment.plugins.resumeSuspended();
            await slowResume.promise;
          },
        },
      });
      const secondPrepare = createDeferredPromise<FakeDaemonReply>();
      let prepares = 0;
      registerFakeDaemon(harness, { events, hostId: OLD, handle: probeReply });
      registerFakeDaemon(harness, {
        events,
        hostId: WORKER,
        handle: probeReply,
      });
      registerFakeDaemon(harness, {
        events,
        hostId: NEW,
        handle: (request) => {
          if (request.command.type === "server_move.prepare") {
            prepares += 1;
            return prepares === 1
              ? createDeferredPromise<FakeDaemonReply>().promise
              : secondPrepare.promise;
          }
          return targetReply(request);
        },
      });

      await coordinator.start(START_DIRECT);
      await expect.poll(() => prepares).toBe(1);
      coordinator.cancel();
      await expect.poll(() => plugins.resumes).toBe(1);
      expect(isServerMoveFrozen(harness.db)).toBe(true);

      await coordinator.start(START_DIRECT);
      await expect.poll(() => prepares).toBe(2);
      slowResume.resolve();
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      expect(coordinator.getStatus()?.state).toBe("preparing");
      expect(isServerMoveFrozen(harness.db)).toBe(true);
      expect(plugins.paused).toBe(true);
      expect(events).not.toContain("deferred-work:resumed");

      secondPrepare.resolve(
        ok({ localServerUrl: "http://127.0.0.1:39101", pid: 4242 }),
      );
      await expect.poll(() => events.includes("retire")).toBe(true);
      expect(coordinator.getStatus()?.state).toBe("completed");
    }));

  it("refuses to cancel once the switch starts", () =>
    withTestHarness(async (harness) => {
      seedTopology(harness);
      const { environment, events } = createTestServerMoveEnvironment(harness);
      const coordinator = createServerMoveCoordinator(environment);
      const activateReply = createDeferredPromise<FakeDaemonReply>();
      registerFakeDaemon(harness, { events, hostId: OLD, handle: probeReply });
      registerFakeDaemon(harness, {
        events,
        hostId: WORKER,
        handle: probeReply,
      });
      registerFakeDaemon(harness, {
        events,
        hostId: NEW,
        handle: (request) =>
          request.command.type === "server_move.activate"
            ? activateReply.promise
            : targetReply(request),
      });

      await coordinator.start(START_DIRECT);
      await expect
        .poll(() => events.includes(`${NEW}:server_move.activate`))
        .toBe(true);
      expect(coordinator.getStatus()).toMatchObject({
        state: "switching",
        cancellable: false,
      });

      expect(captureError(() => coordinator.cancel())).toMatchObject({
        status: 409,
        body: {
          code: "server_move_not_cancellable",
          message: "The move can't be cancelled after the switch starts",
        },
      });
      activateReply.resolve(ok({ ok: true }));
      await expect.poll(() => events.includes("retire")).toBe(true);
      expect(coordinator.getStatus()?.state).toBe("completed");
      expect(events).not.toContain(`${NEW}:server_move.abort`);
    }));

  it("rejects starts that are blocked or need confirmation, and cancels without a move", () =>
    withTestHarness(async (harness) => {
      seedTopology(harness);
      const { environment, events } = createTestServerMoveEnvironment(harness);
      const coordinator = createServerMoveCoordinator(environment);
      registerFakeDaemon(harness, { events, hostId: OLD, handle: probeReply });
      registerFakeDaemon(harness, {
        events,
        hostId: NEW,
        handle: (request) =>
          request.command.type === "server_move.inspect"
            ? ok(
                inspectResult({
                  existingServerData: {
                    path: "/home/me/.bb",
                    sizeBytes: 1_024,
                  },
                }),
              )
            : targetReply(request),
      });

      expect(captureError(() => coordinator.cancel())).toMatchObject({
        status: 409,
        body: {
          code: "server_move_not_cancellable",
          message: "No server move is in progress",
        },
      });
      await expect(
        coordinator.start({ ...START_DIRECT, targetHostId: OFFLINE }),
      ).rejects.toMatchObject({
        status: 400,
        body: {
          code: "server_move_blocked",
          details: {
            items: [expect.objectContaining({ id: "target-offline" })],
          },
        },
      });
      await expect(
        coordinator.start({ ...START_DIRECT, serverUrl: null }),
      ).rejects.toMatchObject({
        status: 400,
        body: {
          code: "server_move_blocked",
          details: {
            items: [expect.objectContaining({ id: "server-url-required" })],
          },
        },
      });
      await expect(coordinator.start(START_DIRECT)).rejects.toMatchObject({
        status: 400,
        body: {
          code: "server_move_blocked",
          details: {
            items: [
              expect.objectContaining({ id: "archive-existing-data-required" }),
            ],
          },
        },
      });
      expect(coordinator.getStatus()).toBeNull();
      expect(coordinator.isFrozen()).toBe(false);
      expect(events).not.toContain("stop-work");
    }));
});
