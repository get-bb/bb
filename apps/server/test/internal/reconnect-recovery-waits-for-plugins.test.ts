import { getThread, hostDaemonSessions } from "@bb/db";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProviderRegistryService,
  type ProviderRegistryService,
} from "../../src/services/providers/provider-registry.js";
import { setPluginThreadEventEmitter } from "../../src/services/plugins/plugin-thread-events.js";
import { internalAuthHeaders } from "../helpers/commands.js";
import { seedThreadFixture, seedTurnStarted } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

afterEach(() => {
  setPluginThreadEventEmitter(undefined);
});

function recordTurnFailedAnnouncements(): string[] {
  const announced: string[] = [];
  setPluginThreadEventEmitter({
    emitThreadEvents: () => {},
    emitTerminalInput: () => {},
    emitHostDeleted: () => {},
    emitEnvironmentRemoved: () => {},
    emitThreadCreated: () => {},
    emitThreadActive: () => {},
    emitThreadIdle: () => {},
    emitThreadFailed: () => {},
    emitThreadArchived: () => {},
    emitThreadDeleted: () => {},
    emitInteractionPending: () => {},
    emitMessageQueued: () => {},
    emitMessageDispatched: () => {},
    emitMessageCancelled: () => {},
    emitThreadUnarchived: () => {},
    emitThreadParentChanged: () => {},
    emitTurnFailed: (threadId) => announced.push(threadId),
  });
  return announced;
}

function deferPluginStartup(harness: TestAppHarness): ProviderRegistryService {
  const registry = createProviderRegistryService({
    deferRegistrationsSettled: true,
  });
  for (const registration of harness.deps.providerRegistry.list()) {
    registry.register(registration);
  }
  harness.deps.providerRegistry = registry;
  return registry;
}

function seedActiveTurnThread(harness: TestAppHarness) {
  const fixture = seedThreadFixture(harness, {
    thread: { status: "active" },
  });
  seedTurnStarted(harness.deps, {
    environmentId: fixture.environment.id,
    threadId: fixture.thread.id,
    turnId: "turn-live-1",
  });
  return fixture;
}

function openSession(
  harness: TestAppHarness,
  args: { hostId: string; instanceId: string; activeThreadIds: string[] },
): Promise<Response> {
  return Promise.resolve(
    harness.app.request("/internal/session/open", {
      method: "POST",
      headers: internalAuthHeaders(harness, { hostId: args.hostId }),
      body: JSON.stringify({
        hostId: args.hostId,
        instanceId: args.instanceId,
        hostName: "Test Host",
        hasMachineCredential: false,
        platform: "darwin",
        dataDir: "/tmp/host-daemon-reopened",
        localApiPort: null,
        protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
        activeThreads: args.activeThreadIds.map((threadId) => ({ threadId })),
      }),
    }),
  );
}

async function waitForSessionOpened(
  harness: TestAppHarness,
  args: { hostId: string; instanceId: string },
): Promise<void> {
  await vi.waitFor(() =>
    expect(
      harness.db
        .select({ id: hostDaemonSessions.id })
        .from(hostDaemonSessions)
        .where(
          and(
            eq(hostDaemonSessions.hostId, args.hostId),
            eq(hostDaemonSessions.instanceId, args.instanceId),
          ),
        )
        .get(),
    ).toBeDefined(),
  );
  await new Promise((resolve) => setImmediate(resolve));
}

describe("daemon reconnect recovery during plugin startup", () => {
  it("interrupts a restarted daemon's cut turn only after plugins finish loading", async () => {
    await withTestHarness(async (harness) => {
      const { host, thread } = seedActiveTurnThread(harness);
      const registry = deferPluginStartup(harness);
      const announced = recordTurnFailedAnnouncements();

      const opened = openSession(harness, {
        hostId: host.id,
        instanceId: "instance-restarted",
        activeThreadIds: [],
      });
      await waitForSessionOpened(harness, {
        hostId: host.id,
        instanceId: "instance-restarted",
      });

      expect(getThread(harness.db, thread.id)?.status).toBe("active");
      expect(announced).toEqual([]);

      registry.markRegistrationsSettled();
      expect((await opened).status).toBe(201);

      expect(getThread(harness.db, thread.id)?.status).toBe("error");
      expect(announced).toEqual([thread.id]);
    });
  });

  it("recovers once from the newest session when the daemon restarts again during plugin startup", async () => {
    await withTestHarness(async (harness) => {
      const { host, thread } = seedActiveTurnThread(harness);
      const registry = deferPluginStartup(harness);
      const announced = recordTurnFailedAnnouncements();

      const superseded = openSession(harness, {
        hostId: host.id,
        instanceId: "instance-superseded",
        activeThreadIds: [thread.id],
      });
      await waitForSessionOpened(harness, {
        hostId: host.id,
        instanceId: "instance-superseded",
      });
      const latest = openSession(harness, {
        hostId: host.id,
        instanceId: "instance-latest",
        activeThreadIds: [],
      });
      await waitForSessionOpened(harness, {
        hostId: host.id,
        instanceId: "instance-latest",
      });

      registry.markRegistrationsSettled();
      expect((await superseded).status).toBe(201);
      expect((await latest).status).toBe(201);

      expect(getThread(harness.db, thread.id)?.status).toBe("error");
      expect(announced).toEqual([thread.id]);
    });
  });
});
