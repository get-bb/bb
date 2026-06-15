import { and, eq } from "drizzle-orm";
import {
  createThreadSchedule,
  events,
  getThreadSchedule,
  setThreadExecutionOverride,
  threads,
  threadSchedules,
} from "@bb/db";
import { threadScope, turnRequestEventDataSchema, turnScope } from "@bb/domain";
import { renderTemplate } from "@bb/templates";
import { describe, expect, it } from "vitest";
import { sweepDueThreadSchedules } from "../../src/services/scheduling/thread-schedule-sweep.js";
import { appendClientTurnEvent } from "../../src/services/threads/thread-events.js";
import {
  listQueuedThreadCommands,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedEvent,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { createTestAppHarness, withTestHarness } from "../helpers/test-app.js";

type TestHarness = Awaited<ReturnType<typeof createTestAppHarness>>;

interface SeedRunnableThreadArgs {
  environmentId: string;
  harness: TestHarness;
  providerId?: string;
  projectId: string;
  status?: "active" | "idle";
  turnId?: string;
}

interface ExpectedScheduleInputArgs {
  prompt: string;
  scheduleId: string;
}

function expectedScheduleInput(args: ExpectedScheduleInputArgs) {
  return textInput(
    renderTemplate("systemMessageThreadScheduleDue", {
      prompt: args.prompt,
      scheduleId: args.scheduleId,
    }),
  );
}

function seedRunnableThread(args: SeedRunnableThreadArgs) {
  const status = args.status ?? "idle";
  const thread = seedThread(args.harness.deps, {
    projectId: args.projectId,
    environmentId: args.environmentId,
    providerId: args.providerId,
    status,
  });
  seedEvent(args.harness.deps, {
    threadId: thread.id,
    environmentId: args.environmentId,
    providerThreadId: "provider-thread",
    sequence: 1,
    type: "thread/identity",
    scope: threadScope(),
    data: {},
  });
  appendClientTurnEvent(args.harness.deps, {
    threadId: thread.id,
    environmentId: args.environmentId,
    type: "client/turn/requested",
    input: textInput("Bootstrap thread"),
    target: { kind: "thread-start" },
    execution: {
      model: "gpt-5",
      reasoningLevel: "medium",
      permissionMode: "full",
      serviceTier: "default",
      source: "client/turn/requested",
    },
    initiator: "user",
    senderThreadId: null,
    requestMethod: "thread/start",
    source: "spawn",
  });

  if (status === "active") {
    seedEvent(args.harness.deps, {
      threadId: thread.id,
      environmentId: args.environmentId,
      providerThreadId: "provider-thread",
      sequence: 3,
      type: "turn/started",
      scope: turnScope(args.turnId ?? "turn-active-schedule"),
      data: {},
    });
  }

  return thread;
}

interface SeedDueThreadScheduleFixtureArgs {
  environmentPath: string;
  harness: TestHarness;
  hostId: string;
  providerId?: string;
  status?: "active" | "idle";
}

function seedDueThreadScheduleFixture(args: SeedDueThreadScheduleFixtureArgs) {
  const { host } = seedHostSession(args.harness.deps, {
    id: args.hostId,
  });
  const { project } = seedProjectWithSource(args.harness.deps, {
    hostId: host.id,
  });
  const environment = seedEnvironment(args.harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: args.environmentPath,
  });
  const thread = seedRunnableThread({
    harness: args.harness,
    environmentId: environment.id,
    projectId: project.id,
    providerId: args.providerId,
    status: args.status,
  });
  const now = Date.now();
  const schedule = createThreadSchedule(args.harness.db, args.harness.hub, {
    projectId: project.id,
    threadId: thread.id,
    name: "due-check",
    cron: "0 8 * * *",
    timezone: "UTC",
    prompt: "Run if useful.",
    enabled: true,
    nextFireAt: now - 1,
  });

  return { environment, host, now, project, schedule, thread };
}

describe("thread schedule sweep", () => {
  it("queues turn.submit for a due schedule on an idle thread", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-schedule-run",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/thread-schedule-run-environment",
      });
      const thread = seedRunnableThread({
        harness,
        environmentId: environment.id,
        projectId: project.id,
      });
      const now = Date.now();
      const schedule = createThreadSchedule(harness.db, harness.hub, {
        projectId: project.id,
        threadId: thread.id,
        name: "daily-recap",
        cron: "0 8 * * *",
        timezone: "UTC",
        prompt: "Run the daily recap if there is useful progress.",
        enabled: true,
        nextFireAt: now - 1,
      });

      const sweepPromise = sweepDueThreadSchedules(harness.deps, { now });
      const queuedTurnSubmit = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "turn.submit" && command.threadId === thread.id,
      );
      await sweepPromise;

      expect(queuedTurnSubmit.command).toMatchObject({
        input: expectedScheduleInput({
          prompt: "Run the daily recap if there is useful progress.",
          scheduleId: schedule.id,
        }),
        target: { mode: "start" },
      });
      expect(
        harness.db.select().from(threads).where(eq(threads.id, thread.id)).get()
          ?.status,
      ).toBe("active");

      const updatedSchedule = getThreadSchedule(harness.db, schedule.id);
      expect(updatedSchedule?.lastFiredAt).toBe(now);
      expect(updatedSchedule?.nextFireAt).toBeGreaterThan(now);
      const queuedSubmitCount = listQueuedThreadCommands(
        harness,
        "turn.submit",
        thread.id,
      ).length;

      await sweepDueThreadSchedules(harness.deps, { now });

      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(queuedSubmitCount);
      expect(getThreadSchedule(harness.db, schedule.id)).toMatchObject({
        lastFiredAt: now,
        nextFireAt: updatedSchedule?.nextFireAt,
      });

      const clientRequests = harness.db
        .select()
        .from(events)
        .where(
          and(
            eq(events.threadId, thread.id),
            eq(events.type, "client/turn/requested"),
          ),
        )
        .orderBy(events.sequence)
        .all();
      const scheduleRequest = clientRequests[clientRequests.length - 1];
      if (!scheduleRequest) {
        throw new Error("Expected schedule client request event");
      }
      const requestData = turnRequestEventDataSchema.parse(
        JSON.parse(scheduleRequest.data),
      );
      expect(requestData).toMatchObject({
        initiator: "system",
        input: expectedScheduleInput({
          prompt: "Run the daily recap if there is useful progress.",
          scheduleId: schedule.id,
        }),
        target: { kind: "new-turn" },
      });
    });
  });

  it("queues due schedules as auto submits when the thread is active", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-schedule-active",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/thread-schedule-active-environment",
      });
      const thread = seedRunnableThread({
        harness,
        environmentId: environment.id,
        projectId: project.id,
        status: "active",
        turnId: "turn-active-schedule",
      });
      const now = Date.now();
      const schedule = createThreadSchedule(harness.db, harness.hub, {
        projectId: project.id,
        threadId: thread.id,
        name: "active-check",
        cron: "0 8 * * *",
        timezone: "UTC",
        prompt: "Check active work.",
        enabled: true,
        nextFireAt: now - 1,
      });

      const sweepPromise = sweepDueThreadSchedules(harness.deps, { now });
      const queuedTurnSubmit = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "turn.submit" && command.threadId === thread.id,
      );
      await sweepPromise;

      expect(queuedTurnSubmit.command).toMatchObject({
        input: expectedScheduleInput({
          prompt: "Check active work.",
          scheduleId: schedule.id,
        }),
        target: {
          mode: "auto",
          expectedTurnId: "turn-active-schedule",
        },
      });
    });
  });

  it("ignores disabled schedules even when nextFireAt is in the past", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-schedule-disabled",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/thread-schedule-disabled-environment",
      });
      const thread = seedRunnableThread({
        harness,
        environmentId: environment.id,
        projectId: project.id,
      });
      const now = Date.now();
      const schedule = createThreadSchedule(harness.db, harness.hub, {
        projectId: project.id,
        threadId: thread.id,
        name: "disabled-check",
        cron: "0 8 * * *",
        timezone: "UTC",
        prompt: "Should not run.",
        enabled: false,
        nextFireAt: now - 1,
      });

      await sweepDueThreadSchedules(harness.deps, { now });

      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(0);
      expect(getThreadSchedule(harness.db, schedule.id)).toMatchObject({
        enabled: false,
        lastFiredAt: null,
        nextFireAt: schedule.nextFireAt,
      });
    });
  });

  it("disables invalid stored schedules instead of deleting them", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-schedule-invalid-stored",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/thread-schedule-invalid-stored-environment",
      });
      const thread = seedRunnableThread({
        harness,
        environmentId: environment.id,
        projectId: project.id,
      });
      const now = Date.now();
      const schedule = createThreadSchedule(harness.db, harness.hub, {
        projectId: project.id,
        threadId: thread.id,
        name: "invalid-stored",
        cron: "0 8 * * *",
        timezone: "Mars/Olympus",
        prompt: "Should not run.",
        enabled: true,
        nextFireAt: now - 1,
      });

      await sweepDueThreadSchedules(harness.deps, { now });

      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(0);
      expect(getThreadSchedule(harness.db, schedule.id)).toMatchObject({
        cron: "0 8 * * *",
        enabled: false,
        lastFiredAt: null,
        name: "invalid-stored",
        nextFireAt: schedule.nextFireAt,
        timezone: "Mars/Olympus",
      });
    });
  });

  it("disables enabled schedules for archived threads encountered by the sweep", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-schedule-archived",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/thread-schedule-archived-environment",
      });
      const thread = seedRunnableThread({
        harness,
        environmentId: environment.id,
        projectId: project.id,
      });
      const now = Date.now();
      harness.db
        .update(threads)
        .set({ archivedAt: now - 1, updatedAt: now - 1 })
        .where(eq(threads.id, thread.id))
        .run();
      const schedule = createThreadSchedule(harness.db, harness.hub, {
        projectId: project.id,
        threadId: thread.id,
        name: "archived-check",
        cron: "0 8 * * *",
        timezone: "UTC",
        prompt: "Should remain dormant.",
        enabled: true,
        nextFireAt: now - 1,
      });

      await sweepDueThreadSchedules(harness.deps, { now });

      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(0);
      const updatedSchedule = getThreadSchedule(harness.db, schedule.id);
      expect(updatedSchedule).toMatchObject({
        enabled: false,
        lastFiredAt: null,
        nextFireAt: schedule.nextFireAt,
      });
    });
  });

  it("does not queue when another worker advances the schedule first", async () => {
    await withTestHarness(async (harness) => {
      const { now, schedule, thread } = seedDueThreadScheduleFixture({
        harness,
        hostId: "host-thread-schedule-stale-expected",
        environmentPath: "/tmp/thread-schedule-stale-expected-environment",
      });

      const sweepPromise = sweepDueThreadSchedules(harness.deps, { now });
      harness.db
        .update(threadSchedules)
        .set({ nextFireAt: now + 60_000, updatedAt: now })
        .where(eq(threadSchedules.id, schedule.id))
        .run();
      await sweepPromise;

      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(0);
      expect(getThreadSchedule(harness.db, schedule.id)).toMatchObject({
        lastFiredAt: null,
        nextFireAt: now + 60_000,
      });
    });
  });

  it("skip-advances without firing when execution options are invalid", async () => {
    await withTestHarness(async (harness) => {
      const { now, schedule, thread } = seedDueThreadScheduleFixture({
        harness,
        hostId: "host-thread-schedule-invalid-execution",
        environmentPath: "/tmp/thread-schedule-invalid-execution-environment",
      });
      setThreadExecutionOverride(harness.db, {
        threadId: thread.id,
        modelOverride: "gpt-5",
        reasoningLevelOverride: "max",
      });

      await sweepDueThreadSchedules(harness.deps, { now });

      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(0);
      const updatedSchedule = getThreadSchedule(harness.db, schedule.id);
      expect(updatedSchedule?.lastFiredAt).toBeNull();
      expect(updatedSchedule?.nextFireAt).toBeGreaterThan(now);
    });
  });

  it("skips a due schedule for a stopping thread", async () => {
    await withTestHarness(async (harness) => {
      const { now, schedule, thread } = seedDueThreadScheduleFixture({
        harness,
        hostId: "host-thread-schedule-stopping",
        environmentPath: "/tmp/thread-schedule-stopping-environment",
      });
      harness.db
        .update(threads)
        .set({ status: "stopping", updatedAt: now - 1 })
        .where(eq(threads.id, thread.id))
        .run();

      await sweepDueThreadSchedules(harness.deps, { now });

      // No turn is dispatched into the stopping thread, and it is not
      // reactivated — it stays `stopping` until the stop settles.
      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(0);
      expect(
        harness.db.select().from(threads).where(eq(threads.id, thread.id)).get()
          ?.status,
      ).toBe("stopping");
      // The occurrence is skip-advanced, not fired or disabled.
      const updatedSchedule = getThreadSchedule(harness.db, schedule.id);
      expect(updatedSchedule?.enabled).toBe(true);
      expect(updatedSchedule?.lastFiredAt).toBeNull();
      expect(updatedSchedule?.nextFireAt).toBeGreaterThan(now);
    });
  });
});
