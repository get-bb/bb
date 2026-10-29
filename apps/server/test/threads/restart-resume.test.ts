import {
  getLatestThreadSequence,
  getThread,
  listEvents,
  listQueuedThreadMessages,
  setExperiments,
} from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
} from "@bb/domain";
import { afterEach, describe, expect, it } from "vitest";
import { handleHostSessionOpened } from "../../src/internal/session-owner-side-effects.js";
import { setPluginThreadEventEmitter } from "../../src/services/plugins/plugin-thread-events.js";
import { applyLoggedThreadLifecycleEvent } from "../../src/services/threads/lifecycle-outcome.js";
import { runQueuedMessageDispatch } from "../../src/services/threads/queued-message-dispatch.js";
import {
  recordResumesForShutdown,
  releaseRestartResumes,
  scheduleRestartResumes,
} from "../../src/services/threads/restart-resume.js";
import {
  ACTIVE_TURN_ID,
  enableRestartContinuation,
  seedBackgroundJob,
  seedCommand,
  seedThreadOnHost,
  waitingOnKind,
} from "../helpers/restart-resume.js";
import {
  seedEvent,
  seedHostSession,
  seedSession,
} from "../helpers/seed.js";
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

function turnRequests(harness: TestAppHarness, threadId: string) {
  return listEvents(harness.db, { threadId }).filter(
    (event) => event.type === "client/turn/requested",
  );
}

async function restartDaemon(
  harness: TestAppHarness,
  host: { session: Parameters<typeof handleHostSessionOpened>[1]["openedSession"]; hostId: string },
) {
  const replacement = seedSession(harness.deps, host.hostId, {
    instanceId: "instance-2",
  });
  await handleHostSessionOpened(harness.deps, {
    activeThreads: [],
    hostId: host.hostId,
    openedSession: replacement,
    previousSession: host.session,
    undeliveredEventThreadIds: [],
  });
}

async function sweepPastResumes(harness: TestAppHarness): Promise<void> {
  await runQueuedMessageDispatch(harness.deps, {
    kind: "time-reached",
    now: Date.now() + 120_000,
  });
}

function seedAutomaticResumeTurns(
  harness: TestAppHarness,
  args: { count: number; environmentId: string; threadId: string },
) {
  for (let index = 0; index < args.count; index += 1) {
    const sequence =
      getLatestThreadSequence(harness.db, { threadId: args.threadId }) + 1;
    seedEvent(harness.deps, {
      threadId: args.threadId,
      environmentId: args.environmentId,
      providerThreadId: `provider-${args.threadId}`,
      sequence,
      type: "client/turn/requested",
      scope: threadScope(),
      data: {
        direction: "outbound",
        requestId: encodeClientTurnRequestIdNumber({ value: sequence }),
        input: [{ type: "text", text: "bb restarted" }],
        target: { kind: "new-turn" },
        execution: {
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          source: "client/turn/requested",
        },
        initiator: "system",
        senderThreadId: null,
        systemMessageKind: "restart-resume",
        request: { method: "turn/start", params: {} },
        source: "tell",
      },
    });
  }
}

describe("continuing threads after a restart", () => {
  it("resumes the turns and awaited background work a daemon restart cut, without a retry", () =>
    withTestHarness(async (harness) => {
      enableRestartContinuation(harness);
      const announced = recordTurnFailedAnnouncements();
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-crashed",
        name: "Crashed",
      });
      const working = seedThreadOnHost(harness, host.id, "active");
      seedCommand(harness, {
        command: "pnpm test",
        environmentId: working.environment.id,
        threadId: working.thread.id,
      });
      const delegating = seedThreadOnHost(harness, host.id, "idle");
      seedBackgroundJob(harness, {
        description: "Review the migration",
        environmentId: delegating.environment.id,
        taskType: "local_agent",
        threadId: delegating.thread.id,
      });
      const serving = seedThreadOnHost(harness, host.id, "idle");
      seedBackgroundJob(harness, {
        description: "pnpm dev",
        environmentId: serving.environment.id,
        taskType: "local_bash",
        threadId: serving.thread.id,
      });

      await restartDaemon(harness, { hostId: host.id, session });

      expect(getThread(harness.db, working.thread.id)?.status).toBe("error");
      expect(announced).toEqual([]);
      expect(
        listEvents(harness.db, { threadId: working.thread.id })
          .filter((event) => event.type === "system/error")
          .map((event) => JSON.parse(event.data).detail),
      ).toEqual(["bb will send this thread a message to continue."]);
      const [resume] = listQueuedThreadMessages(harness.db, working.thread.id);
      expect(resume?.content).toContain(
        "bb restarted, or the machine running this thread did, while you were running `pnpm test`. The restart interrupted it; the user did not reject it, even if your history shows it as interrupted or rejected by the user.",
      );
      expect(resume && waitingOnKind(resume)).toBe("time");
      expect(
        listQueuedThreadMessages(harness.db, delegating.thread.id)[0]?.content,
      ).toContain(
        "while this background work was running: `Review the migration`",
      );
      expect(
        listQueuedThreadMessages(harness.db, serving.thread.id),
      ).toHaveLength(0);

      await sweepPastResumes(harness);

      expect(turnRequests(harness, working.thread.id)).toHaveLength(2);
      expect(
        listQueuedThreadMessages(harness.db, working.thread.id),
      ).toHaveLength(0);
    }));

  it("keeps a thread's resume parked across a quit, then drops it if the turn finished or the user stopped it", () =>
    withTestHarness(async (harness) => {
      enableRestartContinuation(harness);
      const surviving = seedHostSession(harness.deps, {
        id: "host-surviving",
        name: "Surviving",
      });
      const restarted = seedHostSession(harness.deps, {
        id: "host-restarted",
        name: "Restarted",
      });
      const finishes = seedThreadOnHost(harness, surviving.host.id, "active");
      const stopped = seedThreadOnHost(harness, surviving.host.id, "active");
      const cut = seedThreadOnHost(harness, restarted.host.id, "active");
      await recordResumesForShutdown(harness.deps, { now: Date.now() });
      for (const { thread } of [finishes, stopped, cut]) {
        expect(
          listQueuedThreadMessages(harness.db, thread.id).map(waitingOnKind),
        ).toEqual(["time"]);
      }
      releaseRestartResumes(harness.deps, { now: Date.now() });

      for (const { thread } of [finishes, stopped, cut]) {
        expect(
          listQueuedThreadMessages(harness.db, thread.id).map(waitingOnKind),
        ).toEqual(["thread-busy"]);
      }

      await restartDaemon(harness, {
        hostId: restarted.host.id,
        session: restarted.session,
      });
      seedEvent(harness.deps, {
        threadId: finishes.thread.id,
        environmentId: finishes.environment.id,
        providerThreadId: `provider-${finishes.thread.id}`,
        sequence:
          getLatestThreadSequence(harness.db, {
            threadId: finishes.thread.id,
          }) + 1,
        type: "turn/completed",
        scope: turnScope(ACTIVE_TURN_ID),
        data: {
          providerThreadId: `provider-${finishes.thread.id}`,
          status: "completed",
        },
      });
      applyLoggedThreadLifecycleEvent(harness.deps, {
        event: { type: "run.succeeded" },
        threadId: finishes.thread.id,
      });
      seedEvent(harness.deps, {
        threadId: stopped.thread.id,
        environmentId: stopped.environment.id,
        sequence:
          getLatestThreadSequence(harness.db, { threadId: stopped.thread.id }) +
          1,
        type: "system/thread/interrupted",
        scope: threadScope(),
        data: { reason: "manual-stop" },
      });
      harness.db.$client
        .prepare("UPDATE threads SET status = ? WHERE id = ?")
        .run("idle", stopped.thread.id);
      for (const { thread } of [finishes, stopped]) {
        await runQueuedMessageDispatch(harness.deps, {
          kind: "thread-ready",
          threadId: thread.id,
        });
      }
      await sweepPastResumes(harness);

      expect(turnRequests(harness, finishes.thread.id)).toHaveLength(1);
      expect(turnRequests(harness, stopped.thread.id)).toHaveLength(1);
      expect(turnRequests(harness, cut.thread.id)).toHaveLength(2);
      for (const { thread } of [finishes, stopped, cut]) {
        expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(0);
      }
    }));

  it("resumes a child before the parent waiting on it, and tells the parent nothing else", () =>
    withTestHarness(async (harness) => {
      enableRestartContinuation(harness);
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-family",
        name: "Family",
      });
      const parent = seedThreadOnHost(harness, host.id, "active");
      seedCommand(harness, {
        command: "bb thread wait thr_child",
        environmentId: parent.environment.id,
        threadId: parent.thread.id,
      });
      const child = seedThreadOnHost(harness, host.id, "active");
      harness.db.$client
        .prepare("UPDATE threads SET parent_thread_id = ? WHERE id = ?")
        .run(parent.thread.id, child.thread.id);

      await restartDaemon(harness, { hostId: host.id, session });
      scheduleRestartResumes(harness.deps, {
        hostIdByThread: new Map([
          [parent.thread.id, host.id],
          [child.thread.id, host.id],
        ]),
        startAt: Date.now(),
      });

      const [parentResume] = listQueuedThreadMessages(
        harness.db,
        parent.thread.id,
      );
      const [childResume] = listQueuedThreadMessages(
        harness.db,
        child.thread.id,
      );
      expect(childResume?.sendAt ?? Infinity).toBeLessThan(
        parentResume?.sendAt ?? 0,
      );
      expect(parentResume?.content).toContain(
        "while you were running `bb thread wait thr_child`",
      );
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_300));
      expect(
        listQueuedThreadMessages(harness.db, parent.thread.id),
      ).toHaveLength(1);
      expect(turnRequests(harness, parent.thread.id)).toHaveLength(1);
    }));

  it("stops resuming a thread after three automatic resumes in a row", () =>
    withTestHarness(async (harness) => {
      enableRestartContinuation(harness);
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-looping",
        name: "Looping",
      });
      const looping = seedThreadOnHost(harness, host.id, "active");
      seedAutomaticResumeTurns(harness, {
        count: 3,
        environmentId: looping.environment.id,
        threadId: looping.thread.id,
      });
      const recovering = seedThreadOnHost(harness, host.id, "active");
      seedAutomaticResumeTurns(harness, {
        count: 2,
        environmentId: recovering.environment.id,
        threadId: recovering.thread.id,
      });

      await restartDaemon(harness, { hostId: host.id, session });

      expect(
        listQueuedThreadMessages(harness.db, looping.thread.id),
      ).toHaveLength(0);
      expect(
        listQueuedThreadMessages(harness.db, recovering.thread.id),
      ).toHaveLength(1);
    }));

  it("leaves interrupted threads alone while the experiment is off", () =>
    withTestHarness(async (harness) => {
      setExperiments(harness.db, { continueThreadsAfterRestarts: false });
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-off",
        name: "Off",
      });
      const working = seedThreadOnHost(harness, host.id, "active");

      await restartDaemon(harness, { hostId: host.id, session });

      expect(getThread(harness.db, working.thread.id)?.status).toBe("error");
      expect(
        listQueuedThreadMessages(harness.db, working.thread.id),
      ).toHaveLength(0);
    }));
});
