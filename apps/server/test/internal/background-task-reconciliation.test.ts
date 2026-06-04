import { listEvents } from "@bb/db";
import { threadScope, turnScope } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { settleDanglingBackgroundTasks } from "../../src/services/threads/background-task-reconciliation.js";
import {
  seedEnvironment,
  seedHost,
  seedProjectWithSource,
  seedStoredEvent,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

function backgroundTaskItemData(args: {
  itemId: string;
  taskStatus: string;
  status: string;
}): Record<string, unknown> {
  return {
    providerThreadId: "claude-session-1",
    item: {
      id: args.itemId,
      type: "backgroundTask",
      taskType: "local_workflow",
      description: "fixture workflow",
      status: args.status,
      taskStatus: args.taskStatus,
      skipTranscript: false,
      workflowName: "fixture-mini",
      usage: { totalTokens: 100, toolUses: 2, durationMs: 1500 },
    },
  };
}

describe("settleDanglingBackgroundTasks", () => {
  it("settles open backgroundTask items as interrupted and is idempotent", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps);
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
      });

      seedStoredEvent(harness.deps, {
        threadId: thread.id,
        sequence: 1,
        type: "turn/started",
        scope: turnScope("turn-1"),
        providerThreadId: "claude-session-1",
        data: { providerThreadId: "claude-session-1" },
      });
      seedStoredEvent(harness.deps, {
        threadId: thread.id,
        sequence: 2,
        type: "item/started",
        scope: turnScope("turn-1"),
        providerThreadId: "claude-session-1",
        itemId: "task:wf-1",
        itemKind: "backgroundTask",
        data: backgroundTaskItemData({
          itemId: "task:wf-1",
          status: "pending",
          taskStatus: "running",
        }),
      });
      seedStoredEvent(harness.deps, {
        threadId: thread.id,
        sequence: 3,
        type: "item/backgroundTask/progress",
        scope: threadScope(),
        providerThreadId: "claude-session-1",
        itemId: "task:wf-1",
        itemKind: "backgroundTask",
        data: backgroundTaskItemData({
          itemId: "task:wf-1",
          status: "pending",
          taskStatus: "running",
        }),
      });

      settleDanglingBackgroundTasks(harness.deps, { hostId: host.id });

      const rows = listEvents(harness.deps.db, { threadId: thread.id });
      const completed = rows.filter(
        (row) => row.type === "item/backgroundTask/completed",
      );
      expect(completed).toHaveLength(1);
      const data = JSON.parse(completed[0]!.data) as {
        item: { status: string; taskStatus: string; workflowName: string };
      };
      expect(data.item.status).toBe("interrupted");
      expect(data.item.taskStatus).toBe("stopped");
      // The rest of the latest snapshot is preserved.
      expect(data.item.workflowName).toBe("fixture-mini");

      // Idempotent: the item is now settled, nothing further appends.
      settleDanglingBackgroundTasks(harness.deps, { hostId: host.id });
      expect(
        listEvents(harness.deps.db, { threadId: thread.id }).filter(
          (row) => row.type === "item/backgroundTask/completed",
        ),
      ).toHaveLength(1);
    });
  });

  it("does not touch already-settled tasks or other hosts", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps);
      const otherHost = seedHost(harness.deps, {
        id: "host_other",
        name: "Other Host",
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
      });

      seedStoredEvent(harness.deps, {
        threadId: thread.id,
        sequence: 1,
        type: "turn/started",
        scope: turnScope("turn-1"),
        data: { providerThreadId: "claude-session-1" },
      });
      seedStoredEvent(harness.deps, {
        threadId: thread.id,
        sequence: 2,
        type: "item/started",
        scope: turnScope("turn-1"),
        itemId: "task:wf-done",
        itemKind: "backgroundTask",
        data: backgroundTaskItemData({
          itemId: "task:wf-done",
          status: "pending",
          taskStatus: "running",
        }),
      });
      seedStoredEvent(harness.deps, {
        threadId: thread.id,
        sequence: 3,
        type: "item/backgroundTask/completed",
        scope: threadScope(),
        itemId: "task:wf-done",
        itemKind: "backgroundTask",
        data: backgroundTaskItemData({
          itemId: "task:wf-done",
          status: "completed",
          taskStatus: "completed",
        }),
      });

      // Settling the OTHER host must not touch this host's threads either.
      settleDanglingBackgroundTasks(harness.deps, { hostId: otherHost.id });
      settleDanglingBackgroundTasks(harness.deps, { hostId: host.id });

      const completed = listEvents(harness.deps.db, {
        threadId: thread.id,
      }).filter((row) => row.type === "item/backgroundTask/completed");
      expect(completed).toHaveLength(1);
      const data = JSON.parse(completed[0]!.data) as {
        item: { status: string };
      };
      expect(data.item.status).toBe("completed");
    });
  });
});
