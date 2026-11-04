import {
  getThread,
  listEvents,
  listQueuedThreadMessages,
  updateThread,
} from "@bb/db";
import {
  turnRequestEventDataSchema,
  type ThreadParentNotifications,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import { runQueuedMessageDispatch } from "../../src/services/threads/queued-message-dispatch.js";
import { handleThreadOwnershipChange } from "../../src/services/threads/thread-ownership.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const WORKSPACE_PATH = "/tmp/thread-ownership-notices";

interface OwnershipFixture {
  children: string[];
  expireWindows: () => void;
  harness: TestAppHarness;
  move: (childId: string, parentId: string | null) => Promise<void>;
  parents: string[];
  setParentNotifications: (
    childId: string,
    value: ThreadParentNotifications,
  ) => void;
}

function withOwnershipFixture(
  run: (fixture: OwnershipFixture) => Promise<void>,
): Promise<void> {
  return withTestHarness(async (harness) => {
    const { host } = seedHostSession(harness.deps, {
      id: "host-ownership-notices",
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
    const parents = ["A", "B", "C"].map((title) => {
      const parent = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        title,
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: `provider-${title}`,
        threadId: parent.id,
      });
      return parent.id;
    });
    const children = ["One", "Two", "Three"].map(
      (title) =>
        seedThread(harness.deps, {
          parentThreadId: parents[0],
          projectId: project.id,
          title,
        }).id,
    );
    await run({
      children,
      harness,
      parents,
      expireWindows() {
        harness.db.$client
          .prepare("UPDATE queued_thread_messages SET send_at = ?")
          .run(Date.now() - 1_000);
      },
      async move(childId, parentThreadId) {
        const previousThread = getThread(harness.db, childId)!;
        const updatedThread = updateThread(
          harness.db,
          harness.deps.hub,
          childId,
          { parentThreadId },
        )!;
        await handleThreadOwnershipChange(harness.deps, {
          previousThread,
          updatedThread,
        });
      },
      setParentNotifications(childId, parentNotifications) {
        updateThread(harness.db, harness.deps.hub, childId, {
          parentNotifications,
        });
      },
    });
  });
}

function pendingNotices(fixture: OwnershipFixture) {
  return fixture.parents.flatMap((parentId) =>
    listQueuedThreadMessages(fixture.harness.db, parentId).map((row) => ({
      parent: parentId,
      kind: JSON.parse(row.systemNotice ?? "null")?.kind,
      children: (
        JSON.parse(row.coalesceState ?? "[]") as {
          change: string;
          childThread: { id: string };
        }[]
      ).map((entry) => `${entry.change}:${entry.childThread.id}`),
    })),
  );
}

function deliveredSystemTurns(harness: TestAppHarness, threadId: string) {
  return listEvents(harness.db, { threadId })
    .filter((event) => event.type === "client/turn/requested")
    .map((event) => turnRequestEventDataSchema.parse(JSON.parse(event.data)))
    .filter((request) => request.initiator === "system");
}

function promptText(
  request: ReturnType<typeof deliveredSystemTurns>[number],
): string {
  return request.input
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

describe("ownership notices", () => {
  it("batch several children unassigned together into one delivered notice", async () => {
    await withOwnershipFixture(async (fixture) => {
      const [a] = fixture.parents;
      await Promise.all(
        fixture.children.map((childId) => fixture.move(childId, null)),
      );

      const rows = listQueuedThreadMessages(fixture.harness.db, a!);
      expect(rows).toHaveLength(1);
      await runQueuedMessageDispatch(fixture.harness.deps, {
        kind: "time-reached",
        now: rows[0]!.sendAt! + 1,
      });

      const delivered = deliveredSystemTurns(fixture.harness, a!);
      expect(delivered).toHaveLength(1);
      expect(delivered[0]).toMatchObject({
        systemMessageKind: "ownership-batch",
        systemMessageSubject: { kind: "thread-batch", count: 3 },
      });
      expect(promptText(delivered[0]!)).toBe(
        [
          "[bb system]",
          "",
          "These threads are no longer children of this thread:",
          "",
          ...fixture.children.map((childId) => `- @thread:${childId}`),
        ].join("\n"),
      );
      expect(listQueuedThreadMessages(fixture.harness.db, a!)).toEqual([]);
    });
  });

  it("keep a single change worded as one child", async () => {
    await withOwnershipFixture(async (fixture) => {
      const [a, b] = fixture.parents;
      const [child] = fixture.children;
      await fixture.move(child!, b!);
      await runQueuedMessageDispatch(fixture.harness.deps, {
        kind: "time-reached",
        now: Date.now() + 5_000,
      });

      expect(deliveredSystemTurns(fixture.harness, b!)).toEqual([
        expect.objectContaining({
          systemMessageKind: "ownership-assigned",
          systemMessageSubject: {
            kind: "thread",
            threadId: child,
            threadName: "One",
          },
        }),
      ]);
      expect(promptText(deliveredSystemTurns(fixture.harness, b!)[0]!)).toBe(
        `[bb system]\n\n@thread:${child} is now a child of this thread.`,
      );
      expect(promptText(deliveredSystemTurns(fixture.harness, a!)[0]!)).toBe(
        `[bb system]\n\n@thread:${child} is no longer a child of this thread.`,
      );
    });
  });

  it("persist the notice as a scheduled row before the window elapses", async () => {
    await withOwnershipFixture(async (fixture) => {
      const [a] = fixture.parents;
      const [first, second] = fixture.children;
      await fixture.move(first!, null);
      await fixture.move(second!, null);

      const [row, ...rest] = listQueuedThreadMessages(fixture.harness.db, a!);
      expect(rest).toEqual([]);
      expect(row).toMatchObject({
        coalesceKey: "thread-ownership",
        state: "scheduled",
      });
      expect(row!.sendAt!).toBeGreaterThan(Date.now());
      expect(pendingNotices(fixture)).toEqual([
        {
          parent: a,
          kind: "ownership-batch",
          children: [`removed:${first}`, `removed:${second}`],
        },
      ]);
    });
  });

  it("withdraw a move undone inside the window", async () => {
    await withOwnershipFixture(async (fixture) => {
      const [a, b] = fixture.parents;
      const [child] = fixture.children;
      await fixture.move(child!, b!);
      await fixture.move(child!, a!);

      expect(pendingNotices(fixture)).toEqual([]);
    });
  });

  it("never notify an intermediate parent", async () => {
    await withOwnershipFixture(async (fixture) => {
      const [a, b, c] = fixture.parents;
      const [child] = fixture.children;
      await fixture.move(child!, b!);
      await fixture.move(child!, c!);

      expect(pendingNotices(fixture)).toEqual([
        {
          parent: a,
          kind: "ownership-removed",
          children: [`removed:${child}`],
        },
        {
          parent: c,
          kind: "ownership-assigned",
          children: [`assigned:${child}`],
        },
      ]);
    });
  });

  it("keep other children in a row when one child's change is withdrawn", async () => {
    await withOwnershipFixture(async (fixture) => {
      const [a] = fixture.parents;
      const [first, second] = fixture.children;
      await fixture.move(first!, null);
      await fixture.move(second!, null);
      await fixture.move(first!, a!);

      expect(pendingNotices(fixture)).toEqual([
        {
          parent: a,
          kind: "ownership-removed",
          children: [`removed:${second}`],
        },
      ]);
    });
  });

  it("use the delivered parent as the baseline for a later correction", async () => {
    await withOwnershipFixture(async (fixture) => {
      const [a, b] = fixture.parents;
      const [child] = fixture.children;
      await fixture.move(child!, b!);
      await runQueuedMessageDispatch(fixture.harness.deps, {
        kind: "time-reached",
        now: Date.now() + 5_000,
      });
      expect(pendingNotices(fixture)).toEqual([]);
      await fixture.move(child!, a!);

      expect(pendingNotices(fixture)).toEqual([
        {
          parent: a,
          kind: "ownership-assigned",
          children: [`assigned:${child}`],
        },
        {
          parent: b,
          kind: "ownership-removed",
          children: [`removed:${child}`],
        },
      ]);
    });
  });

  it("withdraw a move undone after its window but before delivery", async () => {
    await withOwnershipFixture(async (fixture) => {
      const [a, b] = fixture.parents;
      const [child] = fixture.children;
      await fixture.move(child!, b!);
      fixture.expireWindows();
      await fixture.move(child!, a!);

      expect(pendingNotices(fixture)).toEqual([]);
    });
  });

  it.each(["stuck", "off"] as const)(
    "skip the unassignment notice when parent notifications are %s",
    async (value) => {
      await withOwnershipFixture(async (fixture) => {
        const [a, b] = fixture.parents;
        const [child] = fixture.children;
        fixture.setParentNotifications(child!, value);
        await fixture.move(child!, b!);
        await fixture.move(child!, a!);
        expect(pendingNotices(fixture)).toEqual([]);

        await fixture.move(child!, b!);
        expect(pendingNotices(fixture)).toEqual([
          {
            parent: b,
            kind: "ownership-assigned",
            children: [`assigned:${child}`],
          },
        ]);
      });
    },
  );
});
