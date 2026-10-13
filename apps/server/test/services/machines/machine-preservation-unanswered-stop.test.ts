import { afterEach, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  events,
  getHost,
  getThread,
  listQueuedThreadMessagesWaitingOnKind,
  updateHost,
} from "@bb/db";
import { maintainMachine } from "../../../src/services/machines/lifecycle.js";
import { requestMachineSuspension } from "../../../src/services/machines/provider-orchestration.js";
import { setPluginMachineProviderBridge } from "../../../src/services/plugins/plugin-machine-provider-registry.js";
import { installMachineProvider } from "../../helpers/machine-provider.js";
import { advanceUntilTrue } from "../../helpers/fake-timers.js";
import { HostOnlineRpcTimeoutError } from "../../../src/ws/hub.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedQueuedMessage,
  seedThread,
  seedTurnStarted,
} from "../../helpers/seed.js";
import { textInput } from "../../helpers/prompt-input.js";
import { withTestHarness } from "../../helpers/test-app.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setPluginMachineProviderBridge(undefined);
});

it("preserves a machine whose daemon never answers the stop, and frees the queue", async () =>
  withTestHarness(async (harness) => {
    const { host } = seedHostSession(harness.deps, { id: "unanswered-stop" });
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
    });
    const thread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      status: "active",
    });
    seedTurnStarted(harness.deps, {
      threadId: thread.id,
      environmentId: environment.id,
      turnId: "turn-unanswered",
    });
    vi.spyOn(harness.hub, "requestHostOnlineRpc").mockImplementation(
      async () => {
        seedQueuedMessage(harness.deps, {
          threadId: thread.id,
          content: textInput("okay push it when you're ready"),
          waitingOn: { kind: "stopping" },
        });
        throw new HostOnlineRpcTimeoutError();
      },
    );
    const save = vi.fn(async () => {});

    await maintainMachine(harness.deps, host.id, "operation-unanswered", save);

    expect(save).toHaveBeenCalledOnce();
    expect(getThread(harness.db, thread.id)?.status).toBe("idle");
    expect(
      harness.db
        .select({ id: events.id })
        .from(events)
        .where(
          and(
            eq(events.threadId, thread.id),
            eq(events.type, "system/error"),
            sql`json_extract(${events.data}, '$.code') = 'machine_maintenance'`,
          ),
        )
        .all(),
    ).toHaveLength(1);
    await vi.waitFor(() => {
      expect(
        listQueuedThreadMessagesWaitingOnKind(harness.db, {
          threadId: thread.id,
          kind: "stopping",
        }),
      ).toHaveLength(0);
    });
  }));

it("does not snapshot a connected machine whose daemon answers neither the stop nor the shutdown", async () =>
  withTestHarness(async (harness) => {
    const { host } = seedHostSession(harness.deps, { id: "unanswered-save" });
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
    });
    const thread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      status: "active",
    });
    seedTurnStarted(harness.deps, {
      threadId: thread.id,
      environmentId: environment.id,
      turnId: "turn-unanswered-save",
    });
    const suspend = vi.fn(async () => ({ resource: { id: "owned" } }));
    installMachineProvider({
      suspend,
      resume: async ({ resource }) => ({ resource }),
    });
    updateHost(harness.db, harness.hub, host.id, {
      machineProviderId: "test-machine",
      resource: { id: "owned" },
    });
    vi.spyOn(harness.hub, "requestHostOnlineRpc").mockRejectedValue(
      new HostOnlineRpcTimeoutError(),
    );
    const shutdown = vi
      .spyOn(harness.hub, "requestDaemonShutdown")
      .mockReturnValue(true);
    vi.useFakeTimers();

    const requested = requestMachineSuspension(harness.deps, host.id).catch(
      (error: unknown) => error,
    );
    await advanceUntilTrue(
      () =>
        getHost(harness.db, host.id)?.statusMessage?.includes(
          "did not shut down cleanly",
        ) === true,
      5_000,
    );
    await requested;

    expect(shutdown).toHaveBeenCalledOnce();
    expect(suspend).not.toHaveBeenCalled();
    expect(getHost(harness.db, host.id)?.statusMessage).toContain(
      "did not shut down cleanly",
    );
  }));
