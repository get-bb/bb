import {
  createPendingInteraction,
  getThread,
  listEvents,
  hostDaemonCommands,
} from "@bb/db";
import {
  backgroundTaskItemStatus,
  encodeClientTurnRequestIdNumber,
  systemProviderTurnWatchdogEventDataSchema,
  systemThreadInterruptedEventDataSchema,
  threadScope,
  turnScope,
} from "@bb/domain";
import type {
  BackgroundTaskStatus,
  ProviderTurnWatchdogThreadScopedActivityEventType,
} from "@bb/domain";
import { desc } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  runProviderTurnWatchdogSweep,
  PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS,
} from "../../../src/services/threads/provider-turn-watchdog.js";
import { runThreadLifecycleSweep } from "../../../src/services/system/periodic-sweeps.js";
import {
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
} from "../../helpers/commands.js";
import {
  seedEnvironment,
  seedEvent,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../../helpers/seed.js";
import { createTestAppHarness } from "../../helpers/test-app.js";

const WATCHDOG_NOW = 2_000_000;
const PROVIDER_THREAD_ID = "provider-thread-watchdog";
const ACTIVE_TURN_ID = "turn-watchdog-active";

interface WatchdogTestContext {
  environmentId: string;
  harness: Awaited<ReturnType<typeof createTestAppHarness>>;
  hostId: string;
  sessionId: string;
  threadId: string;
}

interface SeedActiveTurnArgs {
  acceptedAt?: number;
  context: WatchdogTestContext;
  startedAt: number;
  turnId?: string;
}

async function createWatchdogTestContext(): Promise<WatchdogTestContext> {
  const harness = await createTestAppHarness();
  const { host, session } = seedHostSession(harness.deps, {
    id: "host-provider-turn-watchdog",
  });
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

  return {
    environmentId: environment.id,
    harness,
    hostId: host.id,
    sessionId: session.id,
    threadId: thread.id,
  };
}

function seedActiveTurn(args: SeedActiveTurnArgs): void {
  const turnId = args.turnId ?? ACTIVE_TURN_ID;
  seedEvent(args.context.harness.deps, {
    threadId: args.context.threadId,
    environmentId: args.context.environmentId,
    providerThreadId: PROVIDER_THREAD_ID,
    sequence: 1,
    type: "turn/started",
    scope: turnScope(turnId),
    createdAt: args.startedAt,
    data: { providerThreadId: PROVIDER_THREAD_ID },
  });

  if (args.acceptedAt === undefined) {
    return;
  }

  seedEvent(args.context.harness.deps, {
    threadId: args.context.threadId,
    environmentId: args.context.environmentId,
    providerThreadId: PROVIDER_THREAD_ID,
    sequence: 2,
    type: "turn/input/accepted",
    scope: turnScope(turnId),
    createdAt: args.acceptedAt,
    data: {
      providerThreadId: PROVIDER_THREAD_ID,
      clientRequestId: encodeClientTurnRequestIdNumber({ value: 1 }),
    },
  });
}

interface SeedBackgroundTaskEventArgs {
  context: WatchdogTestContext;
  createdAt: number;
  providerThreadId?: string;
  sequence: number;
  taskStatus?: BackgroundTaskStatus;
  type?: ProviderTurnWatchdogThreadScopedActivityEventType;
}

/**
 * Seeds a thread-scoped (turn_id NULL) background task event, the only
 * liveness signal a provider emits while a dynamic workflow runs.
 */
function seedBackgroundTaskEvent(args: SeedBackgroundTaskEventArgs): void {
  const taskStatus = args.taskStatus ?? "running";
  const providerThreadId = args.providerThreadId ?? PROVIDER_THREAD_ID;
  seedEvent(args.context.harness.deps, {
    threadId: args.context.threadId,
    environmentId: args.context.environmentId,
    providerThreadId,
    sequence: args.sequence,
    type: args.type ?? "item/backgroundTask/progress",
    scope: threadScope(),
    createdAt: args.createdAt,
    data: {
      providerThreadId,
      item: {
        type: "backgroundTask",
        id: "task:watchdog-workflow",
        taskType: "local_workflow",
        description: "Workflow under test",
        status: backgroundTaskItemStatus(taskStatus),
        taskStatus,
        skipTranscript: false,
      },
    },
  });
}

function listWatchdogEvents(context: WatchdogTestContext) {
  return listEvents(context.harness.db, {
    threadId: context.threadId,
  }).filter((event) => event.type === "system/provider-turn-watchdog");
}

function latestInterruptedReason(context: WatchdogTestContext) {
  const interruptedRows = listEvents(context.harness.db, {
    threadId: context.threadId,
  }).filter((event) => event.type === "system/thread/interrupted");
  const latest = interruptedRows[interruptedRows.length - 1];
  if (!latest) {
    return null;
  }
  return systemThreadInterruptedEventDataSchema.parse(JSON.parse(latest.data))
    .reason;
}

describe("provider turn watchdog", () => {
  it("records a diagnostic event and stops a provider turn after idle activity", async () => {
    const context = await createWatchdogTestContext();
    try {
      const lastActivityAt =
        WATCHDOG_NOW - PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS - 1;
      seedActiveTurn({
        context,
        startedAt: lastActivityAt - 10_000,
        acceptedAt: lastActivityAt,
      });

      const result = runProviderTurnWatchdogSweep(context.harness.deps, {
        now: WATCHDOG_NOW,
      });

      expect(result.interruptedThreadIds).toEqual([context.threadId]);
      const watchdogEvents = listWatchdogEvents(context);
      expect(watchdogEvents).toHaveLength(1);
      const watchdogData = systemProviderTurnWatchdogEventDataSchema.parse(
        JSON.parse(watchdogEvents[0]?.data ?? "{}"),
      );
      expect(watchdogData).toMatchObject({
        reason: "provider-turn-idle",
        activeTurnId: ACTIVE_TURN_ID,
        elapsedMs: PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS + 1,
        lastActivityEventSequence: 2,
        lastActivityEventType: "turn/input/accepted",
        providerThreadId: PROVIDER_THREAD_ID,
      });
      expect(
        getThread(context.harness.db, context.threadId)?.stopRequestedAt,
      ).not.toBeNull();

      const queuedStop = await waitForQueuedCommand(
        context.harness,
        ({ command }) =>
          command.type === "thread.stop" &&
          command.threadId === context.threadId,
      );
      const response = await reportQueuedCommandSuccess(
        context.harness,
        queuedStop,
        {},
      );
      expect(response.status).toBe(200);
      expect(getThread(context.harness.db, context.threadId)?.status).toBe(
        "error",
      );
      expect(latestInterruptedReason(context)).toBe("provider-turn-idle");
    } finally {
      await context.harness.cleanup();
    }
  });

  it("does not stop a provider turn with recent provider activity", async () => {
    const context = await createWatchdogTestContext();
    try {
      seedActiveTurn({
        context,
        startedAt: WATCHDOG_NOW - PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS,
        acceptedAt: WATCHDOG_NOW - PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS + 1,
      });

      const result = runProviderTurnWatchdogSweep(context.harness.deps, {
        now: WATCHDOG_NOW,
      });

      expect(result.interruptedThreadIds).toEqual([]);
      expect(listWatchdogEvents(context)).toHaveLength(0);
      expect(
        context.harness.db
          .select()
          .from(hostDaemonCommands)
          .orderBy(desc(hostDaemonCommands.createdAt))
          .all(),
      ).toHaveLength(0);
    } finally {
      await context.harness.cleanup();
    }
  });

  it("waits while the active turn has a pending interaction", async () => {
    const context = await createWatchdogTestContext();
    try {
      seedActiveTurn({
        context,
        startedAt: WATCHDOG_NOW - PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS - 1,
      });
      createPendingInteraction(context.harness.db, {
        threadId: context.threadId,
        turnId: ACTIVE_TURN_ID,
        providerId: "codex",
        providerThreadId: PROVIDER_THREAD_ID,
        providerRequestId: "request-active-turn",
        sessionId: context.sessionId,
        payload: "{}",
      });

      const result = runProviderTurnWatchdogSweep(context.harness.deps, {
        now: WATCHDOG_NOW,
      });

      expect(result.interruptedThreadIds).toEqual([]);
      expect(listWatchdogEvents(context)).toHaveLength(0);
    } finally {
      await context.harness.cleanup();
    }
  });

  it("ignores pending interactions from a previous turn", async () => {
    const context = await createWatchdogTestContext();
    try {
      seedActiveTurn({
        context,
        startedAt: WATCHDOG_NOW - PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS - 1,
      });
      createPendingInteraction(context.harness.db, {
        threadId: context.threadId,
        turnId: "turn-previous",
        providerId: "codex",
        providerThreadId: PROVIDER_THREAD_ID,
        providerRequestId: "request-previous-turn",
        sessionId: context.sessionId,
        payload: "{}",
      });

      const result = runProviderTurnWatchdogSweep(context.harness.deps, {
        now: WATCHDOG_NOW,
      });

      expect(result.interruptedThreadIds).toEqual([context.threadId]);
      expect(listWatchdogEvents(context)).toHaveLength(1);
    } finally {
      await context.harness.cleanup();
    }
  });

  it("does not stop a provider turn while a background task streams thread-scoped progress", async () => {
    const context = await createWatchdogTestContext();
    try {
      seedActiveTurn({
        context,
        startedAt: WATCHDOG_NOW - PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS - 10_000,
        acceptedAt: WATCHDOG_NOW - PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS - 9_999,
      });
      seedBackgroundTaskEvent({
        context,
        sequence: 3,
        createdAt: WATCHDOG_NOW - 1_000,
      });

      const result = runProviderTurnWatchdogSweep(context.harness.deps, {
        now: WATCHDOG_NOW,
      });

      expect(result.interruptedThreadIds).toEqual([]);
      expect(listWatchdogEvents(context)).toHaveLength(0);
    } finally {
      await context.harness.cleanup();
    }
  });

  it("stops a provider turn when background task progress goes stale", async () => {
    const context = await createWatchdogTestContext();
    try {
      const turnStartedAt =
        WATCHDOG_NOW - PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS - 10_000;
      seedActiveTurn({
        context,
        startedAt: turnStartedAt,
        acceptedAt: turnStartedAt + 1,
      });
      seedBackgroundTaskEvent({
        context,
        sequence: 3,
        createdAt: WATCHDOG_NOW - PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS - 1,
      });

      const result = runProviderTurnWatchdogSweep(context.harness.deps, {
        now: WATCHDOG_NOW,
      });

      expect(result.interruptedThreadIds).toEqual([context.threadId]);
      const watchdogEvents = listWatchdogEvents(context);
      expect(watchdogEvents).toHaveLength(1);
      const watchdogData = systemProviderTurnWatchdogEventDataSchema.parse(
        JSON.parse(watchdogEvents[0]?.data ?? "{}"),
      );
      expect(watchdogData).toMatchObject({
        reason: "provider-turn-idle",
        activeTurnId: ACTIVE_TURN_ID,
        activeTurnStartedAt: turnStartedAt,
        elapsedMs: PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS + 1,
        lastActivityEventSequence: 3,
        lastActivityEventType: "item/backgroundTask/progress",
        providerThreadId: PROVIDER_THREAD_ID,
      });
    } finally {
      await context.harness.cleanup();
    }
  });

  it("measures idle from background task completion, not the pruned progress trail", async () => {
    const context = await createWatchdogTestContext();
    try {
      seedActiveTurn({
        context,
        startedAt: WATCHDOG_NOW - PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS - 10_000,
      });
      seedBackgroundTaskEvent({
        context,
        sequence: 2,
        createdAt: WATCHDOG_NOW - PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS - 5_000,
      });
      seedBackgroundTaskEvent({
        context,
        sequence: 3,
        createdAt: WATCHDOG_NOW - 1_000,
        taskStatus: "completed",
        type: "item/backgroundTask/completed",
      });

      const result = runProviderTurnWatchdogSweep(context.harness.deps, {
        now: WATCHDOG_NOW,
      });

      expect(result.interruptedThreadIds).toEqual([]);
      expect(listWatchdogEvents(context)).toHaveLength(0);
    } finally {
      await context.harness.cleanup();
    }
  });

  it("ignores thread-scoped activity when no turn has started", async () => {
    const context = await createWatchdogTestContext();
    try {
      seedBackgroundTaskEvent({
        context,
        sequence: 1,
        createdAt: WATCHDOG_NOW - PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS - 1,
      });

      const result = runProviderTurnWatchdogSweep(context.harness.deps, {
        now: WATCHDOG_NOW,
      });

      expect(result.interruptedThreadIds).toEqual([]);
      expect(listWatchdogEvents(context)).toHaveLength(0);
    } finally {
      await context.harness.cleanup();
    }
  });

  it("waits on a pending interaction even when the latest activity is thread-scoped", async () => {
    const context = await createWatchdogTestContext();
    try {
      seedActiveTurn({
        context,
        startedAt: WATCHDOG_NOW - PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS - 10_000,
      });
      seedBackgroundTaskEvent({
        context,
        sequence: 2,
        createdAt: WATCHDOG_NOW - PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS - 1,
      });
      createPendingInteraction(context.harness.db, {
        threadId: context.threadId,
        turnId: ACTIVE_TURN_ID,
        providerId: "codex",
        providerThreadId: PROVIDER_THREAD_ID,
        providerRequestId: "request-active-turn",
        sessionId: context.sessionId,
        payload: "{}",
      });

      const result = runProviderTurnWatchdogSweep(context.harness.deps, {
        now: WATCHDOG_NOW,
      });

      expect(result.interruptedThreadIds).toEqual([]);
      expect(listWatchdogEvents(context)).toHaveLength(0);
    } finally {
      await context.harness.cleanup();
    }
  });

  it("does not anchor on thread-scoped activity from before the active turn", async () => {
    const context = await createWatchdogTestContext();
    try {
      seedBackgroundTaskEvent({
        context,
        sequence: 1,
        createdAt: WATCHDOG_NOW - PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS - 60_000,
      });
      seedEvent(context.harness.deps, {
        threadId: context.threadId,
        environmentId: context.environmentId,
        providerThreadId: PROVIDER_THREAD_ID,
        sequence: 2,
        type: "turn/started",
        scope: turnScope(ACTIVE_TURN_ID),
        createdAt: WATCHDOG_NOW - PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS - 1,
        data: { providerThreadId: PROVIDER_THREAD_ID },
      });

      const result = runProviderTurnWatchdogSweep(context.harness.deps, {
        now: WATCHDOG_NOW,
      });

      expect(result.interruptedThreadIds).toEqual([context.threadId]);
      const watchdogEvents = listWatchdogEvents(context);
      expect(watchdogEvents).toHaveLength(1);
      const watchdogData = systemProviderTurnWatchdogEventDataSchema.parse(
        JSON.parse(watchdogEvents[0]?.data ?? "{}"),
      );
      expect(watchdogData).toMatchObject({
        lastActivityEventSequence: 2,
        lastActivityEventType: "turn/started",
        elapsedMs: PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS + 1,
      });
    } finally {
      await context.harness.cleanup();
    }
  });

  it("does not let thread-scoped provider errors defer a wedged turn", async () => {
    const context = await createWatchdogTestContext();
    try {
      const turnStartedAt =
        WATCHDOG_NOW - PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS - 10_000;
      seedActiveTurn({ context, startedAt: turnStartedAt });
      seedEvent(context.harness.deps, {
        threadId: context.threadId,
        environmentId: context.environmentId,
        providerThreadId: PROVIDER_THREAD_ID,
        sequence: 2,
        type: "provider/error",
        scope: threadScope(),
        createdAt: WATCHDOG_NOW - 1_000,
        data: {
          providerThreadId: PROVIDER_THREAD_ID,
          message: "session-level provider error",
        },
      });

      const result = runProviderTurnWatchdogSweep(context.harness.deps, {
        now: WATCHDOG_NOW,
      });

      expect(result.interruptedThreadIds).toEqual([context.threadId]);
      const watchdogEvents = listWatchdogEvents(context);
      expect(watchdogEvents).toHaveLength(1);
      const watchdogData = systemProviderTurnWatchdogEventDataSchema.parse(
        JSON.parse(watchdogEvents[0]?.data ?? "{}"),
      );
      expect(watchdogData).toMatchObject({
        lastActivityEventSequence: 1,
        lastActivityEventType: "turn/started",
        elapsedMs: PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS + 10_000,
      });
    } finally {
      await context.harness.cleanup();
    }
  });

  it("stops a provider turn when idle for exactly the threshold", async () => {
    const context = await createWatchdogTestContext();
    try {
      seedActiveTurn({
        context,
        startedAt: WATCHDOG_NOW - PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS,
      });

      const result = runProviderTurnWatchdogSweep(context.harness.deps, {
        now: WATCHDOG_NOW,
      });

      expect(result.interruptedThreadIds).toEqual([context.threadId]);
    } finally {
      await context.harness.cleanup();
    }
  });

  it("falls back past an empty-string providerThreadId on the anchor event", async () => {
    const context = await createWatchdogTestContext();
    try {
      seedActiveTurn({
        context,
        startedAt: WATCHDOG_NOW - PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS - 10_000,
      });
      // The claude adapter emits background task events with providerThreadId
      // "" until the session identity is stamped; the persisted watchdog
      // event requires a non-empty-or-null provider thread id.
      seedBackgroundTaskEvent({
        context,
        sequence: 2,
        createdAt: WATCHDOG_NOW - PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS - 1,
        providerThreadId: "",
      });

      const result = runProviderTurnWatchdogSweep(context.harness.deps, {
        now: WATCHDOG_NOW,
      });

      expect(result.interruptedThreadIds).toEqual([context.threadId]);
      const watchdogEvents = listWatchdogEvents(context);
      expect(watchdogEvents).toHaveLength(1);
      const watchdogData = systemProviderTurnWatchdogEventDataSchema.parse(
        JSON.parse(watchdogEvents[0]?.data ?? "{}"),
      );
      expect(watchdogData).toMatchObject({
        lastActivityEventSequence: 2,
        lastActivityEventType: "item/backgroundTask/progress",
        providerThreadId: PROVIDER_THREAD_ID,
      });
    } finally {
      await context.harness.cleanup();
    }
  });

  it("does not resurrect a completed turn from trailing thread-scoped activity", async () => {
    const context = await createWatchdogTestContext();
    try {
      seedActiveTurn({
        context,
        startedAt: WATCHDOG_NOW - PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS - 10_000,
      });
      seedEvent(context.harness.deps, {
        threadId: context.threadId,
        environmentId: context.environmentId,
        providerThreadId: PROVIDER_THREAD_ID,
        sequence: 2,
        type: "turn/completed",
        scope: turnScope(ACTIVE_TURN_ID),
        createdAt: WATCHDOG_NOW - PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS - 9_000,
        data: { providerThreadId: PROVIDER_THREAD_ID, status: "completed" },
      });
      seedBackgroundTaskEvent({
        context,
        sequence: 3,
        createdAt: WATCHDOG_NOW - PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS - 1,
      });

      const result = runProviderTurnWatchdogSweep(context.harness.deps, {
        now: WATCHDOG_NOW,
      });

      expect(result.interruptedThreadIds).toEqual([]);
      expect(listWatchdogEvents(context)).toHaveLength(0);
    } finally {
      await context.harness.cleanup();
    }
  });

  it("preserves the watchdog interruption reason when a failed stop is retried", async () => {
    const context = await createWatchdogTestContext();
    try {
      seedActiveTurn({
        context,
        startedAt: WATCHDOG_NOW - PROVIDER_TURN_IDLE_WATCHDOG_THRESHOLD_MS - 1,
      });
      runProviderTurnWatchdogSweep(context.harness.deps, {
        now: WATCHDOG_NOW,
      });
      const firstStop = await waitForQueuedCommand(
        context.harness,
        ({ command }) =>
          command.type === "thread.stop" &&
          command.threadId === context.threadId,
      );
      const failureResponse = await reportQueuedCommandError(
        context.harness,
        firstStop,
        {
          errorCode: "stop_failed",
          errorMessage: "Stop failed",
        },
      );
      expect(failureResponse.status).toBe(200);

      await runThreadLifecycleSweep(context.harness.deps);
      const retryStop = await waitForQueuedCommandAfter(
        context.harness,
        firstStop.row.cursor,
        ({ command }) =>
          command.type === "thread.stop" &&
          command.threadId === context.threadId,
      );
      const successResponse = await reportQueuedCommandSuccess(
        context.harness,
        retryStop,
        {},
      );

      expect(successResponse.status).toBe(200);
      expect(getThread(context.harness.db, context.threadId)?.status).toBe(
        "error",
      );
      expect(latestInterruptedReason(context)).toBe("provider-turn-idle");
    } finally {
      await context.harness.cleanup();
    }
  });
});
