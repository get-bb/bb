import type { ThreadListEntry } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  buildPinnedSidebarState,
  buildSectionThreadList,
  CHRONOLOGICAL_CONTAINER_ID,
} from "@bb/client-core";
import {
  collectSectionThreadDndLookup,
  NEST_BAND_ARMED_FRACTION,
  NEST_BAND_FRACTION,
  PINNED_THREAD_PARENT_KEY,
  resolvePinnedReorderPlacement,
  resolveSectionThreadDropDecision,
  resolveSectionThreadDropTarget,
  resolveSectionThreadSectionOverId,
  resolveProjectedSectionThreadDropTarget,
  resolveThreadRowNestCollisions,
} from "./useSectionThreadDnd";
import { getSidebarThreadRowDroppableId } from "./sidebarThreadRowDroppable";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";

function createThread(overrides: Partial<ThreadListEntry>): ThreadListEntry {
  return makeThreadListEntry({
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

function createLookupWithPinnedThread(
  overrides: Partial<ThreadListEntry> = {},
) {
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
      resolveSectionThreadDropTarget(lookup, "loose", sectionBKey ?? null),
    ).toEqual({
      activeId: "loose",
      fromParentKey: CHRONOLOGICAL_CONTAINER_ID,
      toParentKey: sectionBKey,
    });
  });

  it("accepts an empty section section itself as a target", () => {
    const lookup = createLookup();
    const sectionBKey = lookup.sectionParentKeyBySectionId.get("section:b");

    expect(
      resolveSectionThreadDropTarget(lookup, "loose", "section:b"),
    ).toEqual({
      activeId: "loose",
      fromParentKey: CHRONOLOGICAL_CONTAINER_ID,
      toParentKey: sectionBKey,
    });
  });

  it("moves a section thread back to the loose Threads section", () => {
    const lookup = createLookup();
    const sectionAKey = lookup.sectionParentKeyBySectionId.get("section:a");

    expect(resolveSectionThreadDropTarget(lookup, "in-a", "threads")).toEqual({
      activeId: "in-a",
      fromParentKey: sectionAKey,
      toParentKey: CHRONOLOGICAL_CONTAINER_ID,
    });
  });

  it("preserves a projected destination through self-collision", () => {
    const lookup = createLookup();
    const sectionBKey = lookup.sectionParentKeyBySectionId.get("section:b");

    expect(sectionBKey).toBeDefined();
    expect(
      resolveProjectedSectionThreadDropTarget(
        lookup,
        "loose",
        sectionBKey ?? null,
      ),
    ).toEqual({
      activeId: "loose",
      fromParentKey: CHRONOLOGICAL_CONTAINER_ID,
      toParentKey: sectionBKey,
    });
  });

  it("rejects same-parent and non-thread moves", () => {
    const lookup = createLookup();
    const sectionAKey = lookup.sectionParentKeyBySectionId.get("section:a");

    expect(
      resolveSectionThreadDropTarget(lookup, "in-a", sectionAKey ?? null),
    ).toBeNull();
    expect(
      resolveSectionThreadDropTarget(
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

function createNestedLookup(pinnedThreads: ThreadListEntry[] = []) {
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
    ).toEqual({ kind: "detach", activeId: "child-a", sectionId: "a" });
    expect(
      resolveSectionThreadDropDecision(lookup, "grandchild-a", "threads"),
    ).toEqual({ kind: "detach", activeId: "grandchild-a", sectionId: null });
    expect(
      resolveSectionThreadDropTarget(lookup, "child-a", sectionAKey ?? null),
    ).toMatchObject({ activeId: "child-a", toParentKey: sectionAKey });
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
    ).toEqual({ kind: "detach", activeId: "pinned-child", sectionId: null });
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
  const resolve = (y: number, band: number | null) =>
    resolveThreadRowNestCollisions({
      collisions: [rowCollision, groupCollision],
      droppableRects,
      pointerCoordinates: { x: 20, y },
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
