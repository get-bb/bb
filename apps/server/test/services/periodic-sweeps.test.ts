import { eq } from "drizzle-orm";
import {
  CLOSED_SESSION_ROW_RETENTION_MS,
  getQueuedThreadMessage,
  getThread,
  hostDaemonSessions,
  listQueuedThreadMessages,
} from "@bb/db";
import { turnScope } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import {
  type PeriodicSweepJob,
  runPeriodicSweepJobs,
  runPeriodicSweeps,
  runStartupRecoverySweep,
} from "../../src/services/system/periodic-sweeps.js";
import {
  createTestDaemonEventEnvelope,
  internalAuthHeaders,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
} from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedHostSession,
  seedQueuedMessage,
  seedThreadFixture,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { testLogger, withTestHarness } from "../helpers/test-app.js";

type ReleaseCallback = () => void;

function releaseRunningJob(release: ReleaseCallback | null): void {
  if (!release) {
    throw new Error("Expected a pending sweep job");
  }
  release();
}

describe("runPeriodicSweeps", () => {
  it("startup recovery auto-sends the oldest queued message on idle provider threads", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness, {
        thread: { status: "idle" },
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-startup-queued-message-recovery",
      });
      const firstQueuedMessage = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("First startup queued message"),
      });
      const secondQueuedMessage = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("Second startup queued message"),
      });

      await runStartupRecoverySweep(harness.deps);

      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "turn.submit" && command.threadId === thread.id,
      );
      expect(queued.command).toMatchObject({
        environmentId: environment.id,
        input: [{ type: "text", text: "First startup queued message" }],
        resumeContext: {
          providerThreadId: "provider-startup-queued-message-recovery",
        },
      });
      expect(
        getQueuedThreadMessage(harness.db, firstQueuedMessage.id),
      ).toBeNull();
      expect(
        listQueuedThreadMessages(harness.db, thread.id).map((row) => row.id),
      ).toEqual([secondQueuedMessage.id]);
      expect(getThread(harness.db, thread.id)?.status).toBe("active");
    });
  });

  it("continues stacked persisted queued messages in order after the browser is gone", async () => {
    await withTestHarness(async (harness) => {
      const { environment, session, thread } = seedThreadFixture(harness, {
        thread: { status: "idle" },
      });
      const providerThreadId = "provider-stacked-queued-message-recovery";
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId,
      });
      const queuedMessages = [
        seedQueuedMessage(harness.deps, {
          threadId: thread.id,
          content: textInput("First persisted queued message"),
        }),
        seedQueuedMessage(harness.deps, {
          threadId: thread.id,
          content: textInput("Second persisted queued message"),
        }),
        seedQueuedMessage(harness.deps, {
          threadId: thread.id,
          content: textInput("Third persisted queued message"),
        }),
      ];

      await runStartupRecoverySweep(harness.deps);

      let afterCursor = 0;
      for (const [index, queuedMessage] of queuedMessages.entries()) {
        const expectedText = [
          "First persisted queued message",
          "Second persisted queued message",
          "Third persisted queued message",
        ][index];
        if (!expectedText) {
          throw new Error(`Missing expected text for queued message ${index}`);
        }

        const queued =
          index === 0
            ? await waitForQueuedCommand(
                harness,
                ({ command }) =>
                  command.type === "turn.submit" &&
                  command.threadId === thread.id,
              )
            : await waitForQueuedCommandAfter(
                harness,
                afterCursor,
                ({ command }) =>
                  command.type === "turn.submit" &&
                  command.threadId === thread.id,
              );
        afterCursor = queued.row.cursor;
        expect(queued.command).toMatchObject({
          environmentId: environment.id,
          input: [{ type: "text", text: expectedText }],
          resumeContext: { providerThreadId },
        });
        expect(getQueuedThreadMessage(harness.db, queuedMessage.id)).toBeNull();
        expect(
          listQueuedThreadMessages(harness.db, thread.id).map((row) => row.id),
        ).toEqual(queuedMessages.slice(index + 1).map((row) => row.id));

        const turnId = `turn-stacked-queued-message-${index + 1}`;
        const completionResponse = await harness.app.request(
          "/internal/session/events",
          {
            method: "POST",
            headers: internalAuthHeaders(harness),
            body: JSON.stringify({
              sessionId: session.id,
              events: [
                createTestDaemonEventEnvelope({
                  event: {
                    type: "turn/started",
                    threadId: thread.id,
                    providerThreadId,
                    scope: turnScope(turnId),
                  },
                }),
                createTestDaemonEventEnvelope({
                  event: {
                    type: "turn/completed",
                    threadId: thread.id,
                    providerThreadId,
                    scope: turnScope(turnId),
                    status: "completed",
                  },
                }),
              ],
            }),
          },
        );
        expect(
          completionResponse.status,
          await completionResponse.clone().text(),
        ).toBe(200);
      }

      expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
    });
  });

  it("continues later sweep jobs after an earlier job fails", async () => {
    await withTestHarness(async (harness) => {
      const { session } = seedHostSession(harness.deps);
      const closedAt = Date.now() - CLOSED_SESSION_ROW_RETENTION_MS - 1;
      harness.db
        .update(hostDaemonSessions)
        .set({
          closedAt,
          status: "closed",
          updatedAt: closedAt,
        })
        .where(eq(hostDaemonSessions.id, session.id))
        .run();

      const logger = {
        ...testLogger,
        error: vi.fn(),
      };
      const deps = {
        ...harness.deps,
        logger,
        machineAuth: {
          ...harness.deps.machineAuth,
          pruneExpiredKeys: vi.fn(async () => {
            throw new Error("machine auth prune failed");
          }),
        },
        pluginSchedules: harness.pluginService,
      };

      await runPeriodicSweeps(deps);

      const sessionAfterSweep = harness.db
        .select({ id: hostDaemonSessions.id })
        .from(hostDaemonSessions)
        .where(eq(hostDaemonSessions.id, session.id))
        .get();
      expect(sessionAfterSweep).toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          sweepJob: "machine-auth-prune",
          sweepJobCategory: "retention",
        }),
        "Periodic sweep job failed",
      );
    });
  });

  it("isolates job failures in the generic runner", async () => {
    await withTestHarness(async (harness) => {
      const logger = {
        ...testLogger,
        error: vi.fn(),
      };
      const deps = {
        ...harness.deps,
        logger,
        pluginSchedules: harness.pluginService,
      };
      let laterJobRuns = 0;
      const jobs: PeriodicSweepJob[] = [
        {
          cadenceMs: 0,
          category: "retention",
          name: "test-failing-sweep",
          run() {
            throw new Error("synthetic sweep failure");
          },
        },
        {
          cadenceMs: 0,
          category: "retention",
          name: "test-later-sweep",
          run() {
            laterJobRuns += 1;
          },
        },
      ];

      await runPeriodicSweepJobs(deps, jobs, Date.now());

      expect(laterJobRuns).toBe(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          sweepJob: "test-failing-sweep",
          sweepJobCategory: "retention",
        }),
        "Periodic sweep job failed",
      );
    });
  });

  it("skips a generic job that is already running in another tick", async () => {
    await withTestHarness(async (harness) => {
      let runCount = 0;
      let releaseJob: (() => void) | null = null;
      let resolveJobStarted: (() => void) | null = null;
      const jobStarted = new Promise<void>((resolveStarted) => {
        resolveJobStarted = resolveStarted;
      });
      const jobs: PeriodicSweepJob[] = [
        {
          cadenceMs: 0,
          category: "maintenance",
          name: "test-overlap-sweep",
          async run() {
            runCount += 1;
            if (resolveJobStarted) {
              resolveJobStarted();
            }
            await new Promise<void>((resolveRunningJob) => {
              releaseJob = resolveRunningJob;
            });
          },
        },
      ];

      const deps = { ...harness.deps, pluginSchedules: harness.pluginService };
      const firstSweep = runPeriodicSweepJobs(deps, jobs, 10_000);
      await jobStarted;
      await runPeriodicSweepJobs(deps, jobs, 10_001);
      expect(runCount).toBe(1);
      releaseRunningJob(releaseJob);
      await firstSweep;
    });
  });

  it("does not run cadence-limited generic jobs early", async () => {
    await withTestHarness(async (harness) => {
      let runCount = 0;
      const jobs: PeriodicSweepJob[] = [
        {
          cadenceMs: 1_000,
          category: "maintenance",
          name: "test-cadence-sweep",
          run() {
            runCount += 1;
          },
        },
      ];

      const deps = { ...harness.deps, pluginSchedules: harness.pluginService };
      await runPeriodicSweepJobs(deps, jobs, 20_000);
      await runPeriodicSweepJobs(deps, jobs, 20_999);
      await runPeriodicSweepJobs(deps, jobs, 21_000);

      expect(runCount).toBe(2);
    });
  });
});
