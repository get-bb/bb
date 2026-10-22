import { listQueuedThreadMessages } from "@bb/db";
import { threadScope, turnScope } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  createAppUpdateResumer,
  type AppUpdateInterruptResult,
} from "../../src/services/system/app-update-resume.js";
import {
  seedEnvironment,
  seedHost,
  seedPrimaryHost,
  seedProjectWithSource,
  seedStoredEvent,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedThreadOnHost(
  harness: TestAppHarness,
  hostId: string,
  status: "idle" | "active",
) {
  const { project } = seedProjectWithSource(harness.deps, { hostId });
  const environment = seedEnvironment(harness.deps, {
    hostId,
    projectId: project.id,
    path: `/tmp/app-update-resume-${hostId}-${project.id}`,
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status,
    title: `Thread on ${hostId}`,
  });
  seedThreadRuntimeState(harness.deps, {
    threadId: thread.id,
    environmentId: environment.id,
    providerThreadId: `provider-${thread.id}`,
  });
  return { environment, thread };
}

function seedCommand(
  harness: TestAppHarness,
  args: {
    command: string;
    environmentId: string;
    finished: boolean;
    itemId: string;
    sequence: number;
    threadId: string;
  },
) {
  const item = {
    id: args.itemId,
    type: "commandExecution",
    command: args.command,
    cwd: "/tmp/project",
    status: "inProgress",
    approvalStatus: null,
    aggregatedOutput: null,
    exitCode: null,
  };
  const base = {
    threadId: args.threadId,
    environmentId: args.environmentId,
    scope: turnScope("turn-1"),
    providerThreadId: `provider-${args.threadId}`,
    itemId: args.itemId,
    itemKind: "commandExecution" as const,
  };
  seedStoredEvent(harness.deps, {
    ...base,
    sequence: args.sequence,
    type: "item/started",
    data: { item },
  });
  if (args.finished) {
    seedStoredEvent(harness.deps, {
      ...base,
      sequence: args.sequence + 1,
      type: "item/completed",
      data: { item: { ...item, status: "completed", exitCode: 0 } },
    });
  }
}

function interruptResult(
  threads: Array<{ threadId: string; command: string | null }>,
  idleThreadsWithJobs: AppUpdateInterruptResult["idleThreadsWithJobs"] = [],
): AppUpdateInterruptResult {
  return {
    idleThreadsWithJobs,
    threads: threads.map((thread) => ({ ...thread, providerId: "codex" })),
    waitMs: 0,
  };
}

describe("app update resumer", () => {
  it("parks one resume message per thread until the next boot releases them per host", () =>
    withTestHarness(async (harness) => {
      const hostA = seedHost(harness.deps, { id: "host-a", name: "A" });
      const hostB = seedHost(harness.deps, { id: "host-b", name: "B" });
      const first = seedThreadOnHost(harness, hostA.id, "idle").thread;
      const second = seedThreadOnHost(harness, hostA.id, "idle").thread;
      const other = seedThreadOnHost(harness, hostB.id, "idle").thread;
      const withJobs = seedThreadOnHost(harness, hostB.id, "idle").thread;
      let clock = 1_000_000;
      const resumer = createAppUpdateResumer({
        deps: harness.deps,
        now: () => clock,
      });

      await resumer.parkResumes({
        result: interruptResult(
          [
            { threadId: first.id, command: "pnpm test" },
            { threadId: second.id, command: null },
            { threadId: other.id, command: "git rebase main" },
          ],
          [{ threadId: withJobs.id, jobs: ["pnpm dev", "vite build"] }],
        ),
        targetVersion: "1.1.0",
      });

      const [parked] = listQueuedThreadMessages(harness.db, first.id);
      expect(parked?.sendAt).toBeGreaterThan(clock + 60 * 60 * 1000);
      expect(JSON.parse(parked?.systemNotice ?? "null")).toEqual({
        kind: "app-update-resume",
        subject: { kind: "app-update", targetVersion: "1.1.0" },
      });
      expect(parked?.content).toContain(
        "bb restarted to install an update while you were running `pnpm test`. It may be half applied, so check it, then continue.",
      );
      expect(
        listQueuedThreadMessages(harness.db, second.id)[0]?.content,
      ).toContain(
        "while you were working. Check whether your last step finished, then continue.",
      );
      expect(
        listQueuedThreadMessages(harness.db, withJobs.id)[0]?.content,
      ).toContain(
        "while these background jobs were running: `pnpm dev`, `vite build`. They stopped at the restart.",
      );

      await resumer.parkResumes({
        result: interruptResult([{ threadId: first.id, command: "pnpm test" }]),
        targetVersion: "1.1.0",
      });
      expect(listQueuedThreadMessages(harness.db, first.id)).toHaveLength(1);

      clock = 2_000_000;
      expect(resumer.releaseResumes()).toBe(4);
      expect(resumer.resumedThreadCount()).toBe(4);
      expect(listQueuedThreadMessages(harness.db, first.id)[0]?.sendAt).toBe(
        clock,
      );
      expect(listQueuedThreadMessages(harness.db, second.id)[0]?.sendAt).toBe(
        clock + 10_000,
      );
      expect(listQueuedThreadMessages(harness.db, other.id)[0]?.sendAt).toBe(
        clock,
      );
      expect(listQueuedThreadMessages(harness.db, withJobs.id)[0]?.sendAt).toBe(
        clock + 10_000,
      );
    }));

  it("restarts without waiting when nothing is running", () =>
    withTestHarness(async (harness) => {
      const resumer = createAppUpdateResumer({ deps: harness.deps });
      expect(await resumer.interrupt()).toEqual({
        idleThreadsWithJobs: [],
        threads: [],
        waitMs: expect.any(Number),
      });
    }));

  it("records the command each running thread was in and the jobs of idle threads on this machine", () =>
    withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host-local", name: "Local" });
      seedPrimaryHost(harness.deps, host.id);
      const running = seedThreadOnHost(harness, host.id, "active");
      seedCommand(harness, {
        command: "pnpm lint",
        environmentId: running.environment.id,
        finished: true,
        itemId: "command-done",
        sequence: 1,
        threadId: running.thread.id,
      });
      seedCommand(harness, {
        command: "pnpm test",
        environmentId: running.environment.id,
        finished: false,
        itemId: "command-open",
        sequence: 3,
        threadId: running.thread.id,
      });
      const thinking = seedThreadOnHost(harness, host.id, "active");
      const idle = seedThreadOnHost(harness, host.id, "idle");
      const backgroundItem = {
        id: "task:dev",
        type: "backgroundTask",
        taskType: "local_bash",
        description: "pnpm dev",
        status: "pending",
        taskStatus: "running",
        skipTranscript: false,
        foreground: false,
      };
      const idleEvent = {
        threadId: idle.thread.id,
        environmentId: idle.environment.id,
        scope: turnScope("turn-idle"),
        providerThreadId: `provider-${idle.thread.id}`,
      };
      seedStoredEvent(harness.deps, {
        ...idleEvent,
        sequence: 1,
        type: "turn/started",
        data: { providerThreadId: `provider-${idle.thread.id}` },
      });
      seedStoredEvent(harness.deps, {
        ...idleEvent,
        sequence: 2,
        type: "item/started",
        itemId: backgroundItem.id,
        itemKind: "backgroundTask",
        data: {
          providerThreadId: `provider-${idle.thread.id}`,
          item: backgroundItem,
        },
      });
      seedStoredEvent(harness.deps, {
        ...idleEvent,
        sequence: 3,
        type: "item/backgroundTask/progress",
        scope: threadScope(),
        itemId: backgroundItem.id,
        itemKind: "backgroundTask",
        data: {
          providerThreadId: `provider-${idle.thread.id}`,
          item: backgroundItem,
        },
      });

      const resumer = createAppUpdateResumer({
        deps: harness.deps,
        stopGraceMs: 10,
      });
      const result = await resumer.interrupt();

      expect(
        [...result.threads].sort((a, b) =>
          a.threadId.localeCompare(b.threadId),
        ),
      ).toEqual(
        [
          {
            command: "pnpm test",
            providerId: expect.any(String),
            threadId: running.thread.id,
          },
          {
            command: null,
            providerId: expect.any(String),
            threadId: thinking.thread.id,
          },
        ].sort((a, b) => a.threadId.localeCompare(b.threadId)),
      );
      expect(result.idleThreadsWithJobs).toEqual([
        { jobs: ["pnpm dev"], threadId: idle.thread.id },
      ]);
    }));
});
