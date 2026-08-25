import {
  getThread,
  listDispatchHolds,
  listEvents,
  listQueuedThreadMessages,
} from "@bb/db";
import { describe, expect, it } from "vitest";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { acceptThreadSendRequest } from "../../src/services/threads/thread-send-request.js";
import {
  cancelDispatchHold,
  releaseDispatchHoldAndDispatch,
} from "../../src/services/threads/dispatch-hold-release.js";
import {
  createThreadDispatchHold,
  parseDispatchHoldPayload,
} from "../../src/services/threads/dispatch-holds.js";
import {
  runDueDispatchHoldSweep,
  runOrphanedDispatchHoldSweep,
} from "../../src/services/threads/dispatch-hold-sweeps.js";
import { textInput } from "../helpers/prompt-input.js";
import { waitForQueuedCommand } from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const WORKSPACE_PATH = "/tmp/dispatch-holds-project";

/**
 * A project whose unmanaged workspace already has a ready environment, so a
 * released cold-start hold provisions synchronously and reaches the point
 * where a real start command is dispatched.
 */
function seedHeldCreateFixture(harness: TestAppHarness, hostId: string) {
  const { host } = seedHostSession(harness.deps, { id: hostId });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: WORKSPACE_PATH,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: WORKSPACE_PATH,
  });
  return { environment, host, project };
}

function createHeldThread(
  harness: TestAppHarness,
  args: { hostId: string; holdUntil: number; projectId: string },
) {
  return createThreadFromRequest(harness.deps, {
    environment: {
      type: "host",
      hostId: args.hostId,
      workspace: { type: "unmanaged", path: WORKSPACE_PATH },
    },
    holdUntil: args.holdUntil,
    input: textInput("Run this later"),
    origin: "app",
    projectId: args.projectId,
    providerId: "codex",
    startedOnBehalfOf: null,
  });
}

function threadEventTypes(harness: TestAppHarness, threadId: string) {
  return listEvents(harness.db, { threadId }).map((event) => event.type);
}

describe("held thread creation", () => {
  it("inserts an idle thread with no turn and no provisioning advance", async () => {
    await withTestHarness(async (harness) => {
      const { project, host } = seedHeldCreateFixture(
        harness,
        "host-held-create",
      );

      const thread = await createHeldThread(harness, {
        holdUntil: Date.now() + 60_000,
        hostId: host.id,
        projectId: project.id,
      });

      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
      // No turn was requested and no thread start was persisted: the whole
      // point of a hold is that nothing has been dispatched yet.
      expect(threadEventTypes(harness, thread.id)).toEqual([
        "system/dispatch-hold",
      ]);

      const holds = listDispatchHolds(harness.db, {
        threadId: thread.id,
        liveOnly: true,
      });
      expect(holds).toHaveLength(1);
      expect(holds[0]?.holder).toBe("user");
      expect(holds[0]?.userReleasable).toBe(true);
      expect(holds[0]?.resumeAt).toBeGreaterThan(Date.now());
      // The cold-start context is what lets a release provision the thread
      // after a restart, when no in-memory provisioning context survives.
      expect(holds[0]?.originalRequest).not.toBeNull();
    });
  });

  it("leaves the un-held creation path allocating no hold row", async () => {
    await withTestHarness(async (harness) => {
      const { project, host } = seedHeldCreateFixture(
        harness,
        "host-unheld-create",
      );

      const thread = await createThreadFromRequest(harness.deps, {
        environment: {
          type: "host",
          hostId: host.id,
          workspace: { type: "unmanaged", path: WORKSPACE_PATH },
        },
        input: textInput("Run this now"),
        origin: "app",
        projectId: project.id,
        providerId: "codex",
        startedOnBehalfOf: null,
      });

      expect(listDispatchHolds(harness.db, { threadId: thread.id })).toEqual(
        [],
      );
      expect(threadEventTypes(harness, thread.id)).toContain(
        "client/turn/requested",
      );
      expect(threadEventTypes(harness, thread.id)).not.toContain(
        "system/dispatch-hold",
      );
    });
  });

  it("provisions and dispatches the first turn when the hold releases", async () => {
    await withTestHarness(async (harness) => {
      const { project, host } = seedHeldCreateFixture(
        harness,
        "host-held-release",
      );
      const thread = await createHeldThread(harness, {
        holdUntil: Date.now() + 60_000,
        hostId: host.id,
        projectId: project.id,
      });
      const hold = listDispatchHolds(harness.db, {
        threadId: thread.id,
        liveOnly: true,
      })[0]!;

      await releaseDispatchHoldAndDispatch(harness.deps, {
        hold,
        releaseKind: "user",
      });

      const queuedStart = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      if (queuedStart.command.type !== "thread.start") {
        throw new Error("Expected a thread.start command");
      }
      expect(queuedStart.command.input).toEqual(textInput("Run this later"));
      expect(threadEventTypes(harness, thread.id)).toContain(
        "client/turn/requested",
      );
      expect(
        listDispatchHolds(harness.db, { threadId: thread.id })[0]?.releaseKind,
      ).toBe("user");
    });
  });

  it("dispatches exactly once when a timer and a user release race", async () => {
    await withTestHarness(async (harness) => {
      const { project, host } = seedHeldCreateFixture(
        harness,
        "host-held-double-release",
      );
      const thread = await createHeldThread(harness, {
        holdUntil: Date.now() - 1,
        hostId: host.id,
        projectId: project.id,
      });
      const hold = listDispatchHolds(harness.db, {
        threadId: thread.id,
        liveOnly: true,
      })[0]!;

      // Both callers hold the same pre-release row, which is exactly the race
      // the compare-and-set exists for.
      const first = await releaseDispatchHoldAndDispatch(harness.deps, {
        hold,
        releaseKind: "timer",
      });
      const second = await releaseDispatchHoldAndDispatch(harness.deps, {
        hold,
        releaseKind: "user",
      });

      expect(first?.releaseKind).toBe("timer");
      expect(second).toBeNull();
      const turnRequests = threadEventTypes(harness, thread.id).filter(
        (type) => type === "client/turn/requested",
      );
      expect(turnRequests).toHaveLength(1);
    });
  });

  it("cancels without dispatching anything", async () => {
    await withTestHarness(async (harness) => {
      const { project, host } = seedHeldCreateFixture(
        harness,
        "host-held-cancel",
      );
      const thread = await createHeldThread(harness, {
        holdUntil: Date.now() + 60_000,
        hostId: host.id,
        projectId: project.id,
      });
      const hold = listDispatchHolds(harness.db, {
        threadId: thread.id,
        liveOnly: true,
      })[0]!;

      const cancelled = await cancelDispatchHold(harness.deps, hold);

      expect(cancelled.releaseKind).toBe("cancelled");
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
      expect(threadEventTypes(harness, thread.id)).not.toContain(
        "client/turn/requested",
      );
      expect(
        listDispatchHolds(harness.db, {
          threadId: thread.id,
          liveOnly: true,
        }),
      ).toEqual([]);
    });
  });
});

describe("held sends", () => {
  it("holds instead of sending and releases into the queue on an active thread", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-held-send" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: WORKSPACE_PATH,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: WORKSPACE_PATH,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "active",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-held-send",
        threadId: thread.id,
      });
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        threadId: thread.id,
        turnId: "turn-held-send",
        providerThreadId: "provider-held-send",
      });

      const response = await acceptThreadSendRequest(harness.deps, {
        payload: {
          holdUntil: Date.now() + 60_000,
          input: textInput("Follow up later"),
          mode: "queue-if-active",
        },
        thread,
      });

      expect(response.delivery).toBe("held");
      expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
      const hold = listDispatchHolds(harness.db, {
        threadId: thread.id,
        liveOnly: true,
      })[0]!;
      // A follow-up hold carries no cold-start context: the thread has run.
      expect(hold.originalRequest).toBeNull();

      await releaseDispatchHoldAndDispatch(harness.deps, {
        hold,
        releaseKind: "user",
      });

      // The thread is busy, so the release queues rather than interrupting the
      // turn that is already running.
      const queued = listQueuedThreadMessages(harness.db, thread.id);
      expect(queued).toHaveLength(1);
      // The tuple frozen when the hold was created is what dispatches, not a
      // freshly resolved one.
      const payload = parseDispatchHoldPayload(hold);
      if (payload.kind !== "inline") {
        throw new Error("Expected an inline hold payload");
      }
      expect(queued[0]?.model).toBe(payload.execution.model);
      expect(JSON.parse(queued[0]!.content)).toEqual(
        textInput("Follow up later"),
      );
    });
  });

  it("does not hold when holdUntil is absent", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-unheld-send",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: WORKSPACE_PATH,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: WORKSPACE_PATH,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "active",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-unheld-send",
        threadId: thread.id,
      });
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        threadId: thread.id,
        turnId: "turn-unheld-send",
        providerThreadId: "provider-unheld-send",
      });

      const response = await acceptThreadSendRequest(harness.deps, {
        payload: {
          input: textInput("Follow up now"),
          mode: "queue-if-active",
        },
        thread,
      });

      expect(response.delivery).toBe("queued");
      expect(listDispatchHolds(harness.db, { threadId: thread.id })).toEqual(
        [],
      );
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(1);
    });
  });
});

describe("dispatch hold sweeps", () => {
  it("releases and dispatches a hold whose resumeAt has passed", async () => {
    await withTestHarness(async (harness) => {
      const { project, host } = seedHeldCreateFixture(harness, "host-due-hold");
      const thread = await createHeldThread(harness, {
        holdUntil: Date.now() - 1_000,
        hostId: host.id,
        projectId: project.id,
      });

      await runDueDispatchHoldSweep(harness.deps, Date.now());

      const queuedStart = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      expect(queuedStart.command.type).toBe("thread.start");
      expect(
        listDispatchHolds(harness.db, { threadId: thread.id })[0]?.releaseKind,
      ).toBe("timer");
    });
  });

  it("leaves a hold whose resumeAt has not arrived alone", async () => {
    await withTestHarness(async (harness) => {
      const { project, host } = seedHeldCreateFixture(
        harness,
        "host-future-hold",
      );
      const thread = await createHeldThread(harness, {
        holdUntil: Date.now() + 60_000,
        hostId: host.id,
        projectId: project.id,
      });

      await runDueDispatchHoldSweep(harness.deps, Date.now());

      expect(
        listDispatchHolds(harness.db, {
          threadId: thread.id,
          liveOnly: true,
        }),
      ).toHaveLength(1);
      expect(threadEventTypes(harness, thread.id)).not.toContain(
        "client/turn/requested",
      );
    });
  });

  it("releases plugin-owned holds whose plugin is no longer running", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-orphan" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: WORKSPACE_PATH,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: WORKSPACE_PATH,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "active",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-orphan",
        threadId: thread.id,
      });
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        threadId: thread.id,
        turnId: "turn-orphan",
        providerThreadId: "provider-orphan",
      });
      createThreadDispatchHold(harness.deps, {
        environmentId: environment.id,
        holder: "plugin:gone",
        payload: {
          kind: "inline",
          input: textInput("Held by a plugin"),
          execution: {
            model: "gpt-5",
            permissionMode: "auto",
            reasoningLevel: "medium",
            serviceTier: "default",
            source: "client/turn/requested",
          },
          pluginInputs: {},
        },
        reason: "Held by a plugin",
        resumeAt: null,
        threadId: thread.id,
        userReleasable: false,
      });

      await runOrphanedDispatchHoldSweep(harness.deps, {
        isPluginLoaded: () => false,
      });

      expect(
        listDispatchHolds(harness.db, { threadId: thread.id })[0]?.releaseKind,
      ).toBe("orphaned");
    });
  });

  it("leaves holds owned by a running plugin and by the user alone", async () => {
    await withTestHarness(async (harness) => {
      const { project, host } = seedHeldCreateFixture(
        harness,
        "host-orphan-exempt",
      );
      const thread = await createHeldThread(harness, {
        holdUntil: Date.now() + 60_000,
        hostId: host.id,
        projectId: project.id,
      });

      await runOrphanedDispatchHoldSweep(harness.deps, {
        isPluginLoaded: () => false,
      });

      expect(
        listDispatchHolds(harness.db, {
          threadId: thread.id,
          liveOnly: true,
        }),
      ).toHaveLength(1);
    });
  });
});
