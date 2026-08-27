import {
  getThread,
  listDispatchHolds,
  listEvents,
  listQueuedThreadMessages,
} from "@bb/db";
import {
  DISPATCH_HOLD_INPUT_PREVIEW_MAX_LENGTH,
  systemDispatchHoldEventDataSchema,
  type PromptInput,
  type SystemDispatchHoldEventData,
} from "@bb/domain";
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
  updateLiveDispatchHold,
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

/**
 * The held-message preview on a hold's timeline row. The row's whole job is to
 * say which message is waiting, so what lands in the event — and what
 * deliberately does not — is the contract worth pinning.
 */
describe("dispatch hold input preview", () => {
  function seedHoldableThread(harness: TestAppHarness, hostId: string) {
    const { environment, project } = seedHeldCreateFixture(harness, hostId);
    const thread = seedThread(harness.deps, {
      environmentId: environment.id,
      projectId: project.id,
      status: "idle",
    });
    return { environment, thread };
  }

  function holdWithInput(
    harness: TestAppHarness,
    args: { environmentId: string; input: PromptInput[]; threadId: string },
  ) {
    return createThreadDispatchHold(harness.deps, {
      environmentId: args.environmentId,
      holder: "plugin:scheduled-send",
      payload: {
        kind: "inline",
        input: args.input,
        execution: {
          model: "gpt-5",
          permissionMode: "auto",
          reasoningLevel: "medium",
          serviceTier: "default",
          source: "client/turn/requested",
        },
        pluginInputs: {},
      },
      reason: "Scheduled",
      resumeAt: null,
      threadId: args.threadId,
      userReleasable: true,
    });
  }

  function holdEventData(harness: TestAppHarness, threadId: string) {
    return listEvents(harness.db, { threadId })
      .filter((event) => event.type === "system/dispatch-hold")
      .map(
        (event) =>
          systemDispatchHoldEventDataSchema.parse(
            JSON.parse(event.data),
          ) satisfies SystemDispatchHoldEventData,
      );
  }

  it("carries the visible message text and drops agent-only context", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedHoldableThread(harness, "host-preview");
      holdWithInput(harness, {
        environmentId: environment.id,
        threadId: thread.id,
        input: [
          {
            type: "text",
            text: "Ship the release notes",
            mentions: [],
          },
          {
            type: "text",
            text: "<context>secret repo dump</context>",
            mentions: [],
            visibility: "agent-only",
          },
        ],
      });

      expect(holdEventData(harness, thread.id).at(-1)?.inputPreview).toBe(
        "Ship the release notes",
      );
    });
  });

  it("truncates to exactly the schema's cap, and leaves a message at the cap whole", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedHoldableThread(harness, "host-cap");
      const atCap = "a".repeat(DISPATCH_HOLD_INPUT_PREVIEW_MAX_LENGTH);
      holdWithInput(harness, {
        environmentId: environment.id,
        threadId: thread.id,
        input: textInput(atCap),
      });
      expect(holdEventData(harness, thread.id).at(-1)?.inputPreview).toBe(atCap);
    });

    await withTestHarness(async (harness) => {
      const { environment, thread } = seedHoldableThread(harness, "host-over");
      holdWithInput(harness, {
        environmentId: environment.id,
        threadId: thread.id,
        input: textInput("b".repeat(DISPATCH_HOLD_INPUT_PREVIEW_MAX_LENGTH + 1)),
      });

      const preview = holdEventData(harness, thread.id).at(-1)?.inputPreview;
      // The schema caps the field, so an off-by-one here would make the event
      // unparseable rather than merely ugly.
      expect(preview).toHaveLength(DISPATCH_HOLD_INPUT_PREVIEW_MAX_LENGTH);
      expect(preview?.endsWith("…")).toBe(true);
    });
  });

  it("omits the field entirely when the hold has no message of its own", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedHoldableThread(harness, "host-retry");
      createThreadDispatchHold(harness.deps, {
        environmentId: environment.id,
        holder: "plugin:provider-retry",
        payload: {
          kind: "retry",
          retryOfTurnRequestId: "creq_abcdefghjk",
          attempt: 2,
        },
        reason: "Rate limited",
        resumeAt: Date.now() + 60_000,
        threadId: thread.id,
        userReleasable: false,
      });

      const data = holdEventData(harness, thread.id).at(-1);
      // Absent, not empty: a reader that sees the field can trust it names a
      // message the user actually wrote.
      expect(data).not.toHaveProperty("inputPreview");
    });
  });

  it("re-emits the row when the user edits the held message", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedHoldableThread(harness, "host-edit");
      const hold = holdWithInput(harness, {
        environmentId: environment.id,
        threadId: thread.id,
        input: textInput("First draft"),
      });

      updateLiveDispatchHold(harness.deps, {
        holdId: hold.id,
        input: textInput("Second draft"),
      });

      // Without a fresh event the timeline row would keep quoting "First
      // draft" forever — the row is built from events alone.
      expect(holdEventData(harness, thread.id).at(-1)?.inputPreview).toBe(
        "Second draft",
      );
    });
  });
});
