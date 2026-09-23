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
  buildPinInsertRequest,
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
      activeId: "loose",
      sectionId: "b",
      toParentKey: sectionBKey,
    });
  });

  it("accepts an empty section section itself as a target", () => {
    const lookup = createLookup();
    const sectionBKey = lookup.sectionParentKeyBySectionId.get("section:b");

    expect(
      resolveSectionThreadDropDecision(lookup, "loose", "section:b"),
    ).toEqual({
      kind: "move",
      activeId: "loose",
      sectionId: "b",
      toParentKey: sectionBKey,
    });
  });

  it("moves a section thread back to the loose Threads section", () => {
    const lookup = createLookup();

    expect(resolveSectionThreadDropDecision(lookup, "in-a", "threads")).toEqual(
      {
        kind: "move",
        activeId: "in-a",
        sectionId: null,
        toParentKey: CHRONOLOGICAL_CONTAINER_ID,
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
      activeId: "loose",
      sectionId: "b",
      toParentKey: sectionBKey,
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
    ).toEqual({ kind: "pin", activeId: "loose", detach: false });
  });

  it("preserves a projected Pinned destination through self-collision", () => {
    expect(
      resolveSectionThreadDropDecision(
        createLookupWithPinnedThread(),
        "loose",
        "loose",
        PINNED_THREAD_PARENT_KEY,
      ),
    ).toEqual({ kind: "pin", activeId: "loose", detach: false });
  });

  it("unpins a pinned thread into Threads and clears its section", () => {
    expect(
      resolveSectionThreadDropDecision(
        createLookupWithPinnedThread(),
        "pinned-1",
        "threads",
      ),
    ).toEqual({
      kind: "unpin",
      activeId: "pinned-1",
      sectionId: null,
      move: true,
      toParentKey: CHRONOLOGICAL_CONTAINER_ID,
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
      kind: "unpin",
      activeId: "pinned-1",
      sectionId: "a",
      move: false,
      toParentKey:
        createLookupWithPinnedThread().sectionParentKeyBySectionId.get(
          "section:a",
        ),
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
      activeId: "loose",
      parentThreadId: "parent-a",
      sectionId: "a",
      unpin: false,
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
      activeId: "other-project",
      parentThreadId: "grandchild-a",
      sectionId: "a",
      unpin: false,
    });
    expect(
      resolveSectionThreadDropDecision(
        createNestedLookup(),
        "grandchild-a",
        rowId("loose"),
      ),
    ).toEqual({
      kind: "nest",
      activeId: "grandchild-a",
      parentThreadId: "loose",
      sectionId: null,
      unpin: false,
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
      kind: "detach",
      activeId: "child-a",
      sectionId: "a",
      toParentKey: sectionAKey,
    });
    expect(
      resolveSectionThreadDropDecision(lookup, "grandchild-a", "threads"),
    ).toEqual({
      kind: "detach",
      activeId: "grandchild-a",
      sectionId: null,
      toParentKey: CHRONOLOGICAL_CONTAINER_ID,
    });
  });

  it("detaches before pinning a nested thread", () => {
    expect(
      resolveSectionThreadDropDecision(
        createNestedLookup(),
        "child-a",
        "pinned",
      ),
    ).toEqual({ kind: "pin", activeId: "child-a", detach: true });
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
    ).toEqual({ kind: "pin", activeId: "pinned-child", detach: true });
    expect(
      resolveSectionThreadDropDecision(lookup, "pinned-child", "threads"),
    ).toEqual({
      kind: "detach",
      activeId: "pinned-child",
      sectionId: null,
      toParentKey: CHRONOLOGICAL_CONTAINER_ID,
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
      activeId: "pinned-1",
      parentThreadId: "parent-a",
      sectionId: "a",
      unpin: true,
    });
    expect(
      resolveSectionThreadDropDecision(lookup, "pinned-1", rowId("pinned-2")),
    ).toEqual({
      kind: "nest",
      activeId: "pinned-1",
      parentThreadId: "pinned-2",
      sectionId: null,
      unpin: true,
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
      activeId: "loose",
      parentThreadId: "pinned-2",
      sectionId: null,
      unpin: false,
    });
  });
});

describe("pin insert requests", () => {
  it("pins before or after the hovered pinned root", () => {
    const lookup = createLookupWithPinnedThread();
    expect(
      buildPinInsertRequest(lookup, "loose", {
        threadId: "pinned-2",
        placement: "before",
      }),
    ).toEqual({
      itemId: "loose",
      previousItemId: "pinned-1",
      nextItemId: "pinned-2",
    });
    expect(
      buildPinInsertRequest(lookup, "loose", {
        threadId: "pinned-2",
        placement: "after",
      }),
    ).toEqual({
      itemId: "loose",
      previousItemId: "pinned-2",
      nextItemId: null,
    });
    expect(
      buildPinInsertRequest(lookup, "loose", {
        threadId: "in-a",
        placement: "after",
      }),
    ).toBeNull();
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

  it("moves only the represented group, including descendants, to another section", () => {
    const lookup = groupLookup();
    const activeId = [...lookup.groupThreadsByItemId.keys()][0];
    const decision = resolveSectionThreadDropDecision(
      lookup,
      activeId,
      "section:b",
    );
    expect(decision).toMatchObject({ kind: "move-group", sectionId: "b" });
    expect(
      decision?.kind === "move-group" && decision.threadIds.sort(),
    ).toEqual(["child", "first", "second"]);
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
      kind: "nest-group",
      activeId,
      threadIds: ["first", "second"],
      parentThreadId: "outside",
      sectionId: null,
    });
  });

  it("unparents worktree roots and moves the whole group to a section", () => {
    const lookup = nestedGroupLookup();
    const activeId = [...lookup.groupThreadsByItemId.keys()][0];
    const sectionBKey = lookup.sectionParentKeyBySectionId.get("section:b");
    const decision = resolveSectionThreadDropDecision(
      lookup,
      activeId,
      "section:b",
    );

    expect(decision).toMatchObject({
      kind: "detach-group",
      activeId,
      rootThreadIds: ["first", "second"],
      sectionId: "b",
      toParentKey: sectionBKey,
    });
    expect(
      decision?.kind === "detach-group" && decision.threadIds.sort(),
    ).toEqual(["child", "first", "second"]);
  });

  it("unparents a worktree group when dropped back into its current section", () => {
    const lookup = nestedGroupLookup();
    const activeId = [...lookup.groupThreadsByItemId.keys()][0];

    expect(
      resolveSectionThreadDropDecision(lookup, activeId, "section:a"),
    ).toMatchObject({
      kind: "detach-group",
      rootThreadIds: ["first", "second"],
      sectionId: "a",
    });
  });

  it("moves the first and other group members independently", () => {
    const lookup = groupLookup();
    for (const id of ["first", "second"]) {
      expect(
        resolveSectionThreadDropDecision(lookup, id, "section:b"),
      ).toMatchObject({ kind: "move", activeId: id, sectionId: "b" });
    }
    expect(
      resolveSectionThreadDropDecision(lookup, "child", "section:b"),
    ).toMatchObject({ kind: "detach", activeId: "child", sectionId: "b" });
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
    ).toMatchObject({ kind: "pin", detach: true });
  });

  it("allows moving back to Threads, pinning the group, and ignores same-section drops", () => {
    const lookup = groupLookup();
    const activeId = [...lookup.groupThreadsByItemId.keys()][0];
    expect(
      resolveSectionThreadDropDecision(lookup, activeId, "threads"),
    ).toMatchObject({ kind: "move-group", sectionId: null });
    expect(
      resolveSectionThreadDropDecision(lookup, activeId, "section:a"),
    ).toBeNull();
    expect(
      resolveSectionThreadDropDecision(lookup, activeId, "pinned"),
    ).toEqual({
      kind: "pin-group",
      activeId,
      rootThreadIds: ["first", "second"],
      detachRootThreadIds: [],
      pinRootThreadIds: ["first", "second"],
    });
    expect(
      resolveSectionThreadDropDecision(
        lookup,
        activeId,
        "section:b",
        null,
        null,
        { groups: true },
      ),
    ).toBeNull();
  });

  it("unparents and pins the roots of a nested worktree group", () => {
    const lookup = nestedGroupLookup();
    const activeId = [...lookup.groupThreadsByItemId.keys()][0];

    expect(
      resolveSectionThreadDropDecision(lookup, activeId, "pinned"),
    ).toEqual({
      kind: "pin-group",
      activeId,
      rootThreadIds: ["first", "second"],
      detachRootThreadIds: ["first", "second"],
      pinRootThreadIds: ["first", "second"],
    });
  });
});
