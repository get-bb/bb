import { archiveThread, getThread, updateThread } from "@bb/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queueParentSystemMessage } from "../../src/services/threads/parent-system-messages.js";
import { handleThreadOwnershipChange } from "../../src/services/threads/thread-ownership.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

vi.mock(
  "../../src/services/threads/parent-system-messages.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../src/services/threads/parent-system-messages.js")
    >()),
    queueParentSystemMessage: vi.fn().mockResolvedValue(true),
  }),
);

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function withOwnershipFixture(
  run: (fixture: {
    childId: string;
    secondChildId: string;
    parents: string[];
    move: (childId: string, parentId: string | null) => Promise<void>;
    archive: () => void;
  }) => Promise<void>,
) {
  await withTestHarness(async (harness) => {
    const { host } = seedHostSession(harness.deps);
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const parents = ["A", "B", "C"].map(
      (title) =>
        seedThread(harness.deps, {
          projectId: project.id,
          title,
        }).id,
    );
    const child = seedThread(harness.deps, {
      projectId: project.id,
      parentThreadId: parents[0],
    });
    const secondChild = seedThread(harness.deps, {
      projectId: project.id,
      parentThreadId: parents[0],
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await run({
        childId: child.id,
        secondChildId: secondChild.id,
        parents,
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
          expect(getThread(harness.db, childId)?.parentThreadId).toBe(
            parentThreadId,
          );
        },
        archive() {
          archiveThread(harness.db, harness.deps.hub, child.id);
        },
      });
    } finally {
      await vi.advanceTimersByTimeAsync(2_000);
      vi.useRealTimers();
    }
  });
}

function notices() {
  return vi.mocked(queueParentSystemMessage).mock.calls.map(([, args]) => ({
    parent: args.parentThreadId,
    kind: args.systemMessageKind,
  }));
}

describe("ownership notice debounce", () => {
  it("waits two seconds before notifying the original and final parents", async () => {
    await withOwnershipFixture(async ({ childId, parents: [a, b], move }) => {
      await move(childId, b);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(notices()).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(notices()).toEqual([
        { parent: b, kind: "ownership-assigned" },
        { parent: a, kind: "ownership-removed" },
      ]);
    });
  });

  it("suppresses a move corrected at 1,999 ms", async () => {
    await withOwnershipFixture(async ({ childId, parents: [a, b], move }) => {
      await move(childId, b);
      await vi.advanceTimersByTimeAsync(1_999);
      await move(childId, a);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(notices()).toEqual([]);
    });
  });

  it("resets the deadline and never notifies an intermediate parent", async () => {
    await withOwnershipFixture(
      async ({ childId, parents: [a, b, c], move }) => {
        await move(childId, b);
        await vi.advanceTimersByTimeAsync(1_000);
        await move(childId, c);
        await vi.advanceTimersByTimeAsync(1_999);
        expect(notices()).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(notices()).toEqual([
          { parent: c, kind: "ownership-assigned" },
          { parent: a, kind: "ownership-removed" },
        ]);
      },
    );
  });

  it("preserves an originally absent parent across multiple moves", async () => {
    await withOwnershipFixture(async ({ childId, parents: [a, b], move }) => {
      await move(childId, null);
      await vi.advanceTimersByTimeAsync(2_000);
      vi.mocked(queueParentSystemMessage).mockClear();
      await move(childId, a);
      await move(childId, b);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(notices()).toEqual([{ parent: b, kind: "ownership-assigned" }]);
    });
  });

  it("debounces children independently", async () => {
    await withOwnershipFixture(
      async ({ childId, secondChildId, parents: [a, b, c], move }) => {
        await move(childId, b);
        await vi.advanceTimersByTimeAsync(1_000);
        await move(secondChildId, c);
        await move(childId, a);
        await vi.advanceTimersByTimeAsync(2_000);
        expect(notices()).toEqual([
          { parent: c, kind: "ownership-assigned" },
          { parent: a, kind: "ownership-removed" },
        ]);
      },
    );
  });

  it("uses the delivered parent as the baseline for a later correction", async () => {
    await withOwnershipFixture(async ({ childId, parents: [a, b], move }) => {
      await move(childId, b);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(notices()).toHaveLength(2);
      vi.mocked(queueParentSystemMessage).mockClear();
      await move(childId, a);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(notices()).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(notices()).toEqual([
        { parent: a, kind: "ownership-assigned" },
        { parent: b, kind: "ownership-removed" },
      ]);
    });
  });

  it("skips notices if the child is archived before delivery", async () => {
    await withOwnershipFixture(
      async ({ childId, parents: [, b], move, archive }) => {
        await move(childId, b);
        archive();
        await vi.advanceTimersByTimeAsync(2_000);
        expect(notices()).toEqual([]);
      },
    );
  });
});
