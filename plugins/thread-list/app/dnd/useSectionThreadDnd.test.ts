import {
  makeSidebarEnvironment,
  makeSidebarThread,
  type SidebarThreadOverrides,
} from "../model/fixtures.js";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { describe, expect, it } from "vitest";
import { buildPinnedSidebarState } from "../model/pinned-sidebar-threads.js";
import {
  buildSectionThreadList,
  CHRONOLOGICAL_CONTAINER_ID,
} from "../model/project-thread-groups.js";
import {
  buildPinInsertRequests,
  collectSectionThreadDndLookup,
  NEST_BAND_ARMED_FRACTION,
  NEST_BAND_FRACTION,
  NEST_CANCEL_OFFSET_PX,
  PINNED_THREAD_PARENT_KEY,
  resolvePinnedReorderPlacement,
  resolveSectionThreadDropDecision,
  resolveSectionThreadSectionOverId,
  resolveThreadRowNestCollisions,
} from "./useSectionThreadDnd.js";
import { getSidebarThreadRowDroppableId } from "../rows/sidebarThreadRowDroppable.js";

function createThread(overrides: SidebarThreadOverrides): SidebarThread {
  return makeSidebarThread({
    id: "thread",
    projectId: "project",
    title: "Thread",
    titleFallback: "Thread",
    lastReadAt: 0,
    latestAttentionAt: 2,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  });
}

function dropChanges(
  activeId: string,
  changes: {
    threadIds?: string[];
    unpinThreadIds?: string[];
    updates?: {
      threadId: string;
      parentThreadId?: string | null;
      sectionId?: string | null;
    }[];
    pinThreadIds?: string[];
  },
) {
  return {
    activeId,
    threadIds: changes.threadIds ?? [activeId],
    unpinThreadIds: changes.unpinThreadIds ?? [],
    updates: changes.updates ?? [],
    pinThreadIds: changes.pinThreadIds ?? [],
  };
}

function createLookup() {
  return collectSectionThreadDndLookup(
    buildSectionThreadList(
      [
        createThread({ id: "in-a", sectionId: "a" }),
        createThread({ id: "loose", createdAt: 2 }),
      ],
      undefined,
      [
        { id: "a", name: "Section A" },
        { id: "b", name: "Empty Section B" },
      ],
    ),
    CHRONOLOGICAL_CONTAINER_ID,
  );
}

function createLookupWithPinnedThread(overrides: SidebarThreadOverrides = {}) {
  return collectSectionThreadDndLookup(
    buildSectionThreadList(
      [
        createThread({ id: "in-a", sectionId: "a" }),
        createThread({ id: "loose", createdAt: 2 }),
      ],
      undefined,
      [
        { id: "a", name: "Section A" },
        { id: "b", name: "Empty Section B" },
      ],
    ),
    CHRONOLOGICAL_CONTAINER_ID,
    [
      createThread({
        id: "pinned-1",
        sectionId: "a",
        pinnedAt: 10,
        ...overrides,
      }),
      createThread({ id: "pinned-2", pinnedAt: 9 }),
    ],
  );
}

describe("section thread drop targets", () => {
  it("moves a loose thread onto an empty section header", () => {
    const lookup = createLookup();
    const sectionBKey = lookup.sectionParentKeyBySectionId.get("section:b");

    expect(sectionBKey).toBeDefined();
    expect(
      resolveSectionThreadDropDecision(lookup, "loose", sectionBKey ?? null),
    ).toEqual({
      kind: "move",
      toParentKey: sectionBKey,
      ...dropChanges("loose", {
        updates: [{ threadId: "loose", sectionId: "b" }],
      }),
    });
  });

  it("accepts an empty section section itself as a target", () => {
    const lookup = createLookup();
    const sectionBKey = lookup.sectionParentKeyBySectionId.get("section:b");

    expect(
      resolveSectionThreadDropDecision(lookup, "loose", "section:b"),
    ).toEqual({
      kind: "move",
      toParentKey: sectionBKey,
      ...dropChanges("loose", {
        updates: [{ threadId: "loose", sectionId: "b" }],
      }),
    });
  });

  it("moves a section thread back to the loose Threads section", () => {
    const lookup = createLookup();

    expect(resolveSectionThreadDropDecision(lookup, "in-a", "threads")).toEqual(
      {
        kind: "move",
        toParentKey: CHRONOLOGICAL_CONTAINER_ID,
        ...dropChanges("in-a", {
          updates: [{ threadId: "in-a", sectionId: null }],
        }),
      },
    );
  });

  it("preserves a projected destination through self-collision", () => {
    const lookup = createLookup();
    const sectionBKey = lookup.sectionParentKeyBySectionId.get("section:b");

    expect(sectionBKey).toBeDefined();
    expect(
      resolveSectionThreadDropDecision(
        lookup,
        "loose",
        "loose",
        sectionBKey ?? null,
      ),
    ).toEqual({
      kind: "move",
      toParentKey: sectionBKey,
      ...dropChanges("loose", {
        updates: [{ threadId: "loose", sectionId: "b" }],
      }),
    });
  });

  it("reports the thread's own section as unchanged and ignores non-thread moves", () => {
    const lookup = createLookup();
    const sectionAKey = lookup.sectionParentKeyBySectionId.get("section:a");

    expect(
      resolveSectionThreadDropDecision(lookup, "in-a", sectionAKey ?? null),
    ).toEqual({
      kind: "unchanged",
      activeId: "in-a",
      toParentKey: sectionAKey,
    });
    expect(
      resolveSectionThreadDropDecision(
        lookup,
        sectionAKey ?? "section:a",
        "threads",
      ),
    ).toBeNull();
  });
});

describe("section thread section drop targets", () => {
  it("resolves a section section", () => {
    const lookup = createLookup();
    const sectionAKey = lookup.sectionParentKeyBySectionId.get("section:a");

    expect(sectionAKey).toBeDefined();
    expect(
      resolveSectionThreadSectionOverId(lookup, sectionAKey ?? "section:a"),
    ).toBe("section:a");
  });

  it("resolves a thread inside a section", () => {
    expect(resolveSectionThreadSectionOverId(createLookup(), "in-a")).toBe(
      "section:a",
    );
  });

  it("resolves the chronological container to the Threads section", () => {
    expect(
      resolveSectionThreadSectionOverId(
        createLookup(),
        CHRONOLOGICAL_CONTAINER_ID,
      ),
    ).toBe("threads");
  });

  it("preserves another top-level section id", () => {
    expect(resolveSectionThreadSectionOverId(createLookup(), "pinned")).toBe(
      "pinned",
    );
  });
});

describe("section thread pin drop decisions", () => {
  it("pins an unpinned thread dropped on the Pinned container", () => {
    expect(
      resolveSectionThreadDropDecision(
        createLookupWithPinnedThread(),
        "loose",
        "pinned",
      ),
    ).toEqual({
      kind: "pin",
      ...dropChanges("loose", { pinThreadIds: ["loose"] }),
    });
  });

  it("preserves a projected Pinned destination through self-collision", () => {
    expect(
      resolveSectionThreadDropDecision(
        createLookupWithPinnedThread(),
        "loose",
        "loose",
        PINNED_THREAD_PARENT_KEY,
      ),
    ).toEqual({
      kind: "pin",
      ...dropChanges("loose", { pinThreadIds: ["loose"] }),
    });
  });

  it("unpins a pinned thread into Threads and clears its section", () => {
    expect(
      resolveSectionThreadDropDecision(
        createLookupWithPinnedThread(),
        "pinned-1",
        "threads",
      ),
    ).toEqual({
      kind: "move",
      toParentKey: CHRONOLOGICAL_CONTAINER_ID,
      ...dropChanges("pinned-1", {
        unpinThreadIds: ["pinned-1"],
        updates: [{ threadId: "pinned-1", sectionId: null }],
      }),
    });
  });

  it("unpins a pinned thread into a section without a redundant move", () => {
    expect(
      resolveSectionThreadDropDecision(
        createLookupWithPinnedThread(),
        "pinned-1",
        "section:a",
      ),
    ).toEqual({
      kind: "move",
      toParentKey:
        createLookupWithPinnedThread().sectionParentKeyBySectionId.get(
          "section:a",
        ),
      ...dropChanges("pinned-1", { unpinThreadIds: ["pinned-1"] }),
    });
  });

  it("keeps reorder-within-Pinned as a pinned reorder", () => {
    expect(
      resolveSectionThreadDropDecision(
        createLookupWithPinnedThread(),
        "pinned-1",
        "pinned-2",
      ),
    ).toEqual({
      kind: "reorder-pinned",
      activeId: "pinned-1",
      overId: "pinned-2",
    });
  });
});

function createNestedLookup(pinnedThreads: SidebarThread[] = []) {
  return collectSectionThreadDndLookup(
    buildSectionThreadList(
      [
        createThread({ id: "parent-a", title: "Parent A", sectionId: "a" }),
        createThread({
          id: "child-a",
          title: "Child A",
          sectionId: "a",
          parentThreadId: "parent-a",
          createdAt: 2,
        }),
        createThread({
          id: "grandchild-a",
          title: "Grandchild A",
          sectionId: "a",
          parentThreadId: "child-a",
          createdAt: 3,
        }),
        createThread({ id: "loose", title: "Loose", createdAt: 4 }),
        createThread({
          id: "other-project",
          title: "Other project",
          projectId: "project-2",
          createdAt: 5,
        }),
      ],
      undefined,
      [
        { id: "a", name: "Section A" },
        { id: "b", name: "Empty Section B" },
      ],
    ),
    CHRONOLOGICAL_CONTAINER_ID,
    pinnedThreads,
  );
}

const rowId = getSidebarThreadRowDroppableId;

describe("section thread nest drop decisions", () => {
  it("nests a loose thread under a section thread's row and adopts its section", () => {
    expect(
      resolveSectionThreadDropDecision(
        createNestedLookup(),
        "loose",
        rowId("parent-a"),
      ),
    ).toEqual({
      kind: "nest",
      parentThreadId: "parent-a",
      ...dropChanges("loose", {
        updates: [
          { threadId: "loose", parentThreadId: "parent-a", sectionId: "a" },
        ],
      }),
    });
  });

  it("nests under deeper rows and across projects", () => {
    expect(
      resolveSectionThreadDropDecision(
        createNestedLookup(),
        "other-project",
        rowId("grandchild-a"),
      ),
    ).toEqual({
      kind: "nest",
      parentThreadId: "grandchild-a",
      ...dropChanges("other-project", {
        updates: [
          {
            threadId: "other-project",
            parentThreadId: "grandchild-a",
            sectionId: "a",
          },
        ],
      }),
    });
    expect(
      resolveSectionThreadDropDecision(
        createNestedLookup(),
        "grandchild-a",
        rowId("loose"),
      ),
    ).toEqual({
      kind: "nest",
      parentThreadId: "loose",
      ...dropChanges("grandchild-a", {
        updates: [
          {
            threadId: "grandchild-a",
            parentThreadId: "loose",
            sectionId: null,
          },
        ],
      }),
    });
  });

  it("rejects nesting a thread inside its own subtree", () => {
    expect(
      resolveSectionThreadDropDecision(
        createNestedLookup(),
        "parent-a",
        rowId("grandchild-a"),
      ),
    ).toEqual({
      kind: "rejected",
      activeId: "parent-a",
      overThreadId: "grandchild-a",
      reason: "own-subtree",
    });
  });

  it("reports an unchanged drop onto the current parent", () => {
    expect(
      resolveSectionThreadDropDecision(
        createNestedLookup(),
        "child-a",
        rowId("parent-a"),
      ),
    ).toEqual({
      kind: "rejected",
      activeId: "child-a",
      overThreadId: "parent-a",
      reason: "already-child",
    });
  });

  it("keeps a projected nest through self-collision", () => {
    expect(
      resolveSectionThreadDropDecision(
        createNestedLookup(),
        "loose",
        rowId("loose"),
        null,
        "parent-a",
      ),
    ).toMatchObject({ kind: "nest", parentThreadId: "parent-a" });
    expect(
      resolveSectionThreadDropDecision(
        createNestedLookup(),
        "loose",
        "loose",
        null,
        "parent-a",
      ),
    ).toMatchObject({ kind: "nest", parentThreadId: "parent-a" });
  });

  it("detaches a nested thread dropped onto its own section or the Threads container", () => {
    const lookup = createNestedLookup();
    const sectionAKey = lookup.sectionParentKeyBySectionId.get("section:a");
    expect(
      resolveSectionThreadDropDecision(lookup, "child-a", sectionAKey ?? null),
    ).toEqual({
      kind: "move",
      toParentKey: sectionAKey,
      ...dropChanges("child-a", {
        updates: [
          { threadId: "child-a", parentThreadId: null, sectionId: "a" },
        ],
      }),
    });
    expect(
      resolveSectionThreadDropDecision(lookup, "grandchild-a", "threads"),
    ).toEqual({
      kind: "move",
      toParentKey: CHRONOLOGICAL_CONTAINER_ID,
      ...dropChanges("grandchild-a", {
        updates: [
          { threadId: "grandchild-a", parentThreadId: null, sectionId: null },
        ],
      }),
    });
  });

  it("detaches before pinning a nested thread", () => {
    expect(
      resolveSectionThreadDropDecision(
        createNestedLookup(),
        "child-a",
        "pinned",
      ),
    ).toEqual({
      kind: "pin",
      ...dropChanges("child-a", {
        updates: [{ threadId: "child-a", parentThreadId: null }],
        pinThreadIds: ["child-a"],
      }),
    });
  });

  it("detaches a child of a pinned thread dropped on the Pinned header", () => {
    const pinnedRoot = createThread({ id: "pinned-1", pinnedAt: 10 });
    const pinnedChild = createThread({
      id: "pinned-child",
      parentThreadId: "pinned-1",
      createdAt: 2,
    });
    const pinnedState = buildPinnedSidebarState({
      threads: [pinnedRoot, pinnedChild],
    });
    const lookup = collectSectionThreadDndLookup(
      buildSectionThreadList([], undefined, []),
      CHRONOLOGICAL_CONTAINER_ID,
      [pinnedRoot],
      pinnedState.rootNodes,
    );
    expect(
      resolveSectionThreadDropDecision(lookup, "pinned-child", "pinned"),
    ).toEqual({
      kind: "pin",
      ...dropChanges("pinned-child", {
        updates: [{ threadId: "pinned-child", parentThreadId: null }],
        pinThreadIds: ["pinned-child"],
      }),
    });
    expect(
      resolveSectionThreadDropDecision(lookup, "pinned-child", "threads"),
    ).toEqual({
      kind: "move",
      toParentKey: CHRONOLOGICAL_CONTAINER_ID,
      ...dropChanges("pinned-child", {
        updates: [
          { threadId: "pinned-child", parentThreadId: null, sectionId: null },
        ],
      }),
    });
  });

  it("unpins a pinned thread that nests under a section thread", () => {
    const lookup = createNestedLookup([
      createThread({ id: "pinned-1", pinnedAt: 10 }),
      createThread({ id: "pinned-2", pinnedAt: 9 }),
    ]);
    expect(
      resolveSectionThreadDropDecision(lookup, "pinned-1", rowId("parent-a")),
    ).toEqual({
      kind: "nest",
      parentThreadId: "parent-a",
      ...dropChanges("pinned-1", {
        unpinThreadIds: ["pinned-1"],
        updates: [
          { threadId: "pinned-1", parentThreadId: "parent-a", sectionId: "a" },
        ],
      }),
    });
    expect(
      resolveSectionThreadDropDecision(lookup, "pinned-1", rowId("pinned-2")),
    ).toEqual({
      kind: "nest",
      parentThreadId: "pinned-2",
      ...dropChanges("pinned-1", {
        unpinThreadIds: ["pinned-1"],
        updates: [
          { threadId: "pinned-1", parentThreadId: "pinned-2", sectionId: null },
        ],
      }),
    });
    expect(resolvePinnedReorderPlacement(lookup, "pinned-1", "pinned-2")).toBe(
      "after",
    );
    expect(resolvePinnedReorderPlacement(lookup, "pinned-2", "pinned-1")).toBe(
      "before",
    );
    expect(resolvePinnedReorderPlacement(lookup, "loose", "pinned-1")).toBe(
      null,
    );
    expect(
      resolveSectionThreadDropDecision(lookup, "loose", rowId("pinned-2")),
    ).toEqual({
      kind: "nest",
      parentThreadId: "pinned-2",
      ...dropChanges("loose", {
        updates: [
          { threadId: "loose", parentThreadId: "pinned-2", sectionId: null },
        ],
      }),
    });
  });
});

describe("pin insert requests", () => {
  it("pins before or after the hovered pinned root", () => {
    const lookup = createLookupWithPinnedThread();
    expect(
      buildPinInsertRequests(lookup, ["loose"], {
        threadId: "pinned-2",
        placement: "before",
      }),
    ).toEqual([
      {
        itemId: "loose",
        previousItemId: "pinned-1",
        nextItemId: "pinned-2",
      },
    ]);
    expect(
      buildPinInsertRequests(lookup, ["loose"], {
        threadId: "pinned-2",
        placement: "after",
      }),
    ).toEqual([
      {
        itemId: "loose",
        previousItemId: "pinned-2",
        nextItemId: null,
      },
    ]);
    expect(
      buildPinInsertRequests(lookup, ["loose"], {
        threadId: "in-a",
        placement: "after",
      }),
    ).toEqual([]);
  });

  it("keeps several pinned threads together in order at the insert point", () => {
    expect(
      buildPinInsertRequests(
        createLookupWithPinnedThread(),
        ["first", "second"],
        { threadId: "pinned-2", placement: "before" },
      ),
    ).toEqual([
      { itemId: "first", previousItemId: "pinned-1", nextItemId: "pinned-2" },
      { itemId: "second", previousItemId: "first", nextItemId: "pinned-2" },
    ]);
  });

  it("uses thread neighbours when Pinned shows an environment group", () => {
    const environment = makeSidebarEnvironment({ id: "env", isWorktree: true });
    const pinnedThreads = [
      createThread({ id: "pinned-1", pinnedAt: 10 }),
      createThread({ id: "grouped-1", environment, pinnedAt: 9 }),
      createThread({ id: "grouped-2", environment, pinnedAt: 8 }),
    ];
    const pinnedState = buildPinnedSidebarState({
      groupEnvironmentThreads: true,
      threads: pinnedThreads,
    });
    const lookup = collectSectionThreadDndLookup(
      buildSectionThreadList([createThread({ id: "loose" })], undefined, []),
      CHRONOLOGICAL_CONTAINER_ID,
      pinnedThreads,
      pinnedState.rootNodes,
      { pinnedRootItems: pinnedState.rootItems },
    );
    expect(
      buildPinInsertRequests(lookup, ["loose"], {
        threadId: "pinned-1",
        placement: "after",
      }),
    ).toEqual([
      { itemId: "loose", previousItemId: "pinned-1", nextItemId: "grouped-1" },
    ]);
  });
});

describe("thread row nest collisions", () => {
  const rect = {
    top: 100,
    left: 0,
    width: 200,
    height: 28,
    right: 200,
    bottom: 128,
  };
  const rowCollision = { id: rowId("parent-a") };
  const groupCollision = { id: "parent-a" };
  const droppableRects = new Map([[rowId("parent-a"), rect]]);
  const resolve = (y: number, band: number | null, pointerX = 20) =>
    resolveThreadRowNestCollisions({
      collisions: [rowCollision, groupCollision],
      droppableRects,
      pointerCoordinates: { x: pointerX, y },
      getBandFraction: () => band,
    });

  it("keeps the row target only inside the center band", () => {
    expect(resolve(114, NEST_BAND_FRACTION)).toEqual([
      rowCollision,
      groupCollision,
    ]);
    expect(resolve(103, NEST_BAND_FRACTION)).toEqual([groupCollision]);
    expect(resolve(125, NEST_BAND_FRACTION)).toEqual([groupCollision]);
  });

  it("widens the band once the row is armed", () => {
    expect(resolve(104, NEST_BAND_FRACTION)).toEqual([groupCollision]);
    expect(resolve(104, NEST_BAND_ARMED_FRACTION)).toEqual([
      rowCollision,
      groupCollision,
    ]);
  });

  it("still requires a dwell after moving to the right", () => {
    const candidates: unknown[] = [];
    const collisions = resolveThreadRowNestCollisions({
      collisions: [rowCollision, groupCollision],
      droppableRects,
      pointerCoordinates: { x: 20, y: 114 },
      getBandFraction: () => NEST_BAND_FRACTION,
      holdNestCandidate: (threadId) => {
        candidates.push(threadId);
        return false;
      },
    });

    expect(collisions).toEqual([groupCollision]);
    expect(candidates).toEqual(["parent-a"]);
  });

  it("retains an armed parent through its projected child row", () => {
    const resolveRetained = (
      y: number,
      pointerX: number,
      retainedRect?: typeof rect,
    ) =>
      resolveThreadRowNestCollisions({
        collisions: [groupCollision],
        droppableRects,
        pointerCoordinates: { x: pointerX, y },
        getBandFraction: () => NEST_BAND_ARMED_FRACTION,
        retainedRect,
        retainedThreadId: "parent-a",
      });

    expect(resolveRetained(140, 20)).toEqual([rowCollision, groupCollision]);
    expect(resolveRetained(140, -NEST_CANCEL_OFFSET_PX - 1)).toEqual([
      groupCollision,
    ]);
    expect(resolveRetained(157, 20)).toEqual([groupCollision]);
    expect(
      resolveRetained(170, 20, {
        ...rect,
        top: 158,
        bottom: 186,
      }),
    ).toEqual([rowCollision, groupCollision]);
  });

  it("cancels parenting after the pointer moves past the left tolerance", () => {
    expect(
      resolve(114, NEST_BAND_ARMED_FRACTION, -NEST_CANCEL_OFFSET_PX - 1),
    ).toEqual([groupCollision]);
  });

  it("reports where the pointer sits on the row", () => {
    const seen: unknown[] = [];
    resolveThreadRowNestCollisions({
      collisions: [rowCollision, groupCollision],
      droppableRects,
      pointerCoordinates: { x: 20, y: 103 },
      getBandFraction: () => NEST_BAND_FRACTION,
      onRowPointer: (info) => seen.push(info),
    });
    expect(seen).toEqual([
      { threadId: "parent-a", relativeY: 3 / 28, nesting: false },
    ]);
  });

  it("holds the row target until the candidate is ready", () => {
    const held: (string | null)[] = [];
    const seen: unknown[] = [];
    const resolveHeld = (y: number, ready: boolean) =>
      resolveThreadRowNestCollisions({
        collisions: [rowCollision, groupCollision],
        droppableRects,
        pointerCoordinates: { x: 20, y },
        getBandFraction: () => NEST_BAND_FRACTION,
        onRowPointer: (info) => seen.push(info),
        holdNestCandidate: (threadId) => {
          held.push(threadId);
          return ready;
        },
      });
    expect(resolveHeld(114, false)).toEqual([groupCollision]);
    expect(resolveHeld(114, true)).toEqual([rowCollision, groupCollision]);
    expect(resolveHeld(103, true)).toEqual([groupCollision]);
    expect(resolveHeld(140, true)).toEqual([groupCollision]);
    expect(held).toEqual(["parent-a", "parent-a", null, null]);
    expect(seen).toEqual([
      { threadId: "parent-a", relativeY: 0.5, nesting: false },
      { threadId: "parent-a", relativeY: 0.5, nesting: true },
      { threadId: "parent-a", relativeY: 3 / 28, nesting: false },
    ]);
  });

  it("drops the row target when it is not nestable or the pointer is outside", () => {
    expect(resolve(114, null)).toEqual([groupCollision]);
    expect(resolve(140, 1)).toEqual([groupCollision]);
    expect(
      resolveThreadRowNestCollisions({
        collisions: [rowCollision, groupCollision],
        droppableRects,
        pointerCoordinates: null,
        getBandFraction: () => 1,
      }),
    ).toEqual([groupCollision]);
  });
});

describe("worktree group section dragging", () => {
  function groupLookup() {
    return collectSectionThreadDndLookup(
      buildSectionThreadList(
        [
          createThread({
            id: "first",
            environment: makeSidebarEnvironment({
              id: "env",
              isWorktree: true,
            }),
            sectionId: "a",
            createdAt: 10,
          }),
          createThread({
            id: "second",
            environment: makeSidebarEnvironment({
              id: "env",
              isWorktree: true,
            }),
            sectionId: "a",
            createdAt: 9,
          }),
          createThread({
            id: "child",
            parentThreadId: "first",
            environment: makeSidebarEnvironment({
              id: "env",
              isWorktree: true,
            }),
            sectionId: "a",
          }),
          createThread({
            id: "other-section",
            environment: makeSidebarEnvironment({
              id: "env",
              isWorktree: true,
            }),
            sectionId: "b",
          }),
          createThread({ id: "outside", createdAt: 11 }),
        ],
        undefined,
        [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ],
        new Set(),
        true,
      ),
      CHRONOLOGICAL_CONTAINER_ID,
    );
  }

  function nestedGroupLookup() {
    return collectSectionThreadDndLookup(
      buildSectionThreadList(
        [
          createThread({ id: "outside", sectionId: "a", createdAt: 11 }),
          createThread({
            id: "first",
            parentThreadId: "outside",
            environment: makeSidebarEnvironment({
              id: "env",
              isWorktree: true,
            }),
            sectionId: "a",
            createdAt: 10,
          }),
          createThread({
            id: "second",
            parentThreadId: "outside",
            environment: makeSidebarEnvironment({
              id: "env",
              isWorktree: true,
            }),
            sectionId: "a",
            createdAt: 9,
          }),
          createThread({
            id: "child",
            parentThreadId: "first",
            environment: makeSidebarEnvironment({
              id: "env",
              isWorktree: true,
            }),
            sectionId: "a",
          }),
        ],
        undefined,
        [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ],
        new Set(),
        true,
      ),
      CHRONOLOGICAL_CONTAINER_ID,
    );
  }

  function pinnedGroupLookup() {
    const environment = makeSidebarEnvironment({
      id: "env",
      isWorktree: true,
    });
    const pinnedRoots = [
      createThread({
        id: "first",
        environment,
        pinnedAt: 10,
        sectionId: "a",
        createdAt: 10,
      }),
      createThread({
        id: "second",
        environment,
        pinnedAt: 9,
        sectionId: "a",
        createdAt: 9,
      }),
    ];
    const pinnedState = buildPinnedSidebarState({
      groupEnvironmentThreads: true,
      threads: pinnedRoots,
    });
    return collectSectionThreadDndLookup(
      buildSectionThreadList(
        [createThread({ id: "outside", sectionId: "b", createdAt: 11 })],
        undefined,
        [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ],
      ),
      CHRONOLOGICAL_CONTAINER_ID,
      pinnedRoots,
      pinnedState.rootNodes,
      { pinnedRootItems: pinnedState.rootItems },
    );
  }

  it("moves the group's top-level threads to another section and lets descendants follow", () => {
    const lookup = groupLookup();
    const activeId = [...lookup.groupThreadsByItemId.keys()][0];
    expect(
      resolveSectionThreadDropDecision(lookup, activeId, "section:b"),
    ).toEqual({
      kind: "move",
      toParentKey: lookup.sectionParentKeyBySectionId.get("section:b"),
      ...dropChanges(activeId, {
        threadIds: ["first", "second"],
        updates: [
          { threadId: "first", sectionId: "b" },
          { threadId: "second", sectionId: "b" },
        ],
      }),
    });
  });

  it("parents the roots of a worktree group without flattening descendants", () => {
    const lookup = groupLookup();
    const activeId = [...lookup.groupThreadsByItemId.keys()][0];

    expect(
      resolveSectionThreadDropDecision(
        lookup,
        activeId,
        getSidebarThreadRowDroppableId("outside"),
      ),
    ).toEqual({
      kind: "nest",
      parentThreadId: "outside",
      ...dropChanges(activeId, {
        threadIds: ["first", "second"],
        updates: [
          { threadId: "first", parentThreadId: "outside", sectionId: null },
          { threadId: "second", parentThreadId: "outside", sectionId: null },
        ],
      }),
    });
  });

  it("rejects nesting a worktree group under one of its own descendants", () => {
    const lookup = groupLookup();
    const activeId = [...lookup.groupThreadsByItemId.keys()][0];

    expect(
      resolveSectionThreadDropDecision(
        lookup,
        activeId,
        getSidebarThreadRowDroppableId("child"),
      ),
    ).toEqual({
      kind: "rejected",
      activeId,
      overThreadId: "child",
      reason: "own-subtree",
    });
  });

  it("unparents worktree roots when the group moves to a section", () => {
    const lookup = nestedGroupLookup();
    const activeId = [...lookup.groupThreadsByItemId.keys()][0];

    for (const sectionId of ["a", "b"]) {
      expect(
        resolveSectionThreadDropDecision(
          lookup,
          activeId,
          `section:${sectionId}`,
        ),
      ).toEqual({
        kind: "move",
        toParentKey: lookup.sectionParentKeyBySectionId.get(
          `section:${sectionId}`,
        ),
        ...dropChanges(activeId, {
          threadIds: ["first", "second"],
          updates: [
            { threadId: "first", parentThreadId: null, sectionId },
            { threadId: "second", parentThreadId: null, sectionId },
          ],
        }),
      });
    }
  });

  it("moves the first and other group members independently", () => {
    const lookup = groupLookup();
    for (const id of ["first", "second"]) {
      expect(
        resolveSectionThreadDropDecision(lookup, id, "section:b"),
      ).toMatchObject({
        kind: "move",
        threadIds: [id],
        updates: [{ threadId: id, sectionId: "b" }],
      });
    }
    expect(
      resolveSectionThreadDropDecision(lookup, "child", "section:b"),
    ).toMatchObject({
      kind: "move",
      updates: [{ threadId: "child", parentThreadId: null, sectionId: "b" }],
    });
    expect(
      resolveSectionThreadDropDecision(
        lookup,
        "first",
        getSidebarThreadRowDroppableId("child"),
      ),
    ).toMatchObject({ kind: "rejected", reason: "own-subtree" });
    expect(
      resolveSectionThreadDropDecision(
        lookup,
        "second",
        getSidebarThreadRowDroppableId("first"),
      ),
    ).toMatchObject({ kind: "nest", parentThreadId: "first" });
    expect(
      resolveSectionThreadDropDecision(lookup, "child", "pinned"),
    ).toMatchObject({
      kind: "pin",
      updates: [{ threadId: "child", parentThreadId: null }],
      pinThreadIds: ["child"],
    });
  });

  it("moves a group back to Threads, pins it, and reports its own section as unchanged", () => {
    const lookup = groupLookup();
    const activeId = [...lookup.groupThreadsByItemId.keys()][0];
    expect(
      resolveSectionThreadDropDecision(lookup, activeId, "threads"),
    ).toMatchObject({
      kind: "move",
      updates: [
        { threadId: "first", sectionId: null },
        { threadId: "second", sectionId: null },
      ],
    });
    expect(
      resolveSectionThreadDropDecision(lookup, activeId, "section:a"),
    ).toMatchObject({ kind: "unchanged", activeId });
    expect(
      resolveSectionThreadDropDecision(lookup, activeId, "pinned"),
    ).toEqual({
      kind: "pin",
      ...dropChanges(activeId, {
        threadIds: ["first", "second"],
        pinThreadIds: ["first", "second"],
      }),
    });
  });

  it("applies the grouped-mode rules to groups like single threads", () => {
    const lookup = nestedGroupLookup();
    const activeId = [...lookup.groupThreadsByItemId.keys()][0];
    const groups = { groups: true };

    expect(
      resolveSectionThreadDropDecision(
        lookup,
        activeId,
        "section:b",
        null,
        null,
        groups,
      ),
    ).toMatchObject({
      kind: "move",
      updates: [
        { threadId: "first", parentThreadId: null },
        { threadId: "second", parentThreadId: null },
      ],
    });
    expect(
      resolveSectionThreadDropDecision(
        groupLookup(),
        [...groupLookup().groupThreadsByItemId.keys()][0],
        "section:b",
        null,
        null,
        groups,
      ),
    ).toMatchObject({ kind: "unchanged" });
  });

  it("unparents and pins the roots of a nested worktree group", () => {
    const lookup = nestedGroupLookup();
    const activeId = [...lookup.groupThreadsByItemId.keys()][0];

    expect(
      resolveSectionThreadDropDecision(lookup, activeId, "pinned"),
    ).toEqual({
      kind: "pin",
      ...dropChanges(activeId, {
        threadIds: ["first", "second"],
        updates: [
          { threadId: "first", parentThreadId: null },
          { threadId: "second", parentThreadId: null },
        ],
        pinThreadIds: ["first", "second"],
      }),
    });
  });

  it("unpins a pinned environment group when it moves to a section", () => {
    const lookup = pinnedGroupLookup();
    const activeId = [...lookup.groupThreadsByItemId.keys()][0];

    expect(
      resolveSectionThreadDropDecision(lookup, activeId, "section:b"),
    ).toEqual({
      kind: "move",
      toParentKey: lookup.sectionParentKeyBySectionId.get("section:b"),
      ...dropChanges(activeId, {
        threadIds: ["first", "second"],
        unpinThreadIds: ["first", "second"],
        updates: [
          { threadId: "first", sectionId: "b" },
          { threadId: "second", sectionId: "b" },
        ],
      }),
    });
  });

  it("unpins a pinned environment group when it nests under a thread", () => {
    const lookup = pinnedGroupLookup();
    const activeId = [...lookup.groupThreadsByItemId.keys()][0];

    expect(
      resolveSectionThreadDropDecision(
        lookup,
        activeId,
        getSidebarThreadRowDroppableId("outside"),
      ),
    ).toEqual({
      kind: "nest",
      parentThreadId: "outside",
      ...dropChanges(activeId, {
        threadIds: ["first", "second"],
        unpinThreadIds: ["first", "second"],
        updates: [
          { threadId: "first", parentThreadId: "outside", sectionId: "b" },
          { threadId: "second", parentThreadId: "outside", sectionId: "b" },
        ],
      }),
    });
  });

  it("reports a pinned environment group dropped back in Pinned as unchanged", () => {
    const lookup = pinnedGroupLookup();
    const activeId = [...lookup.groupThreadsByItemId.keys()][0];

    expect(
      resolveSectionThreadDropDecision(lookup, activeId, "pinned"),
    ).toEqual({
      kind: "unchanged",
      activeId,
      toParentKey: PINNED_THREAD_PARENT_KEY,
    });
  });
});
