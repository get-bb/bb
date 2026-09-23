// @vitest-environment jsdom

import { act, cleanup } from "@testing-library/react";
import type {
  CollisionDetection,
  DragCancelEvent,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import {
  makeSidebarEnvironment,
  makeSidebarThread,
  type SidebarThreadOverrides,
} from "../model/fixtures.js";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSectionThreadList,
  CHRONOLOGICAL_CONTAINER_ID,
  type ProjectThreadItem,
} from "../model/project-thread-groups.js";
import { buildPinnedSidebarState } from "../model/pinned-sidebar-threads.js";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import { getSidebarThreadRowDroppableId } from "../rows/sidebarThreadRowDroppable.js";
import type { SectionThreadDndState } from "./useSectionThreadDnd.js";

installTestPluginRuntime();
const {
  collectSectionThreadDndLookup,
  NEST_HOVER_DELAY_MS,
  useSectionThreadDnd,
} = await import("./useSectionThreadDnd.js");

let updateThreadDeferred: {
  resolve: (value: never) => void;
  reject: (reason: unknown) => void;
} | null = null;

const updateThreadFake = vi.fn(
  () =>
    new Promise<never>((resolve, reject) => {
      updateThreadDeferred = { resolve, reject };
    }),
);

function resolveUpdateThread(value: unknown): void {
  updateThreadDeferred?.resolve(value as never);
}

function rejectUpdateThread(reason: unknown): void {
  updateThreadDeferred?.reject(reason);
}

async function flushTasks(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

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

const SECTIONS = [
  { id: "a", name: "Section A" },
  { id: "b", name: "Section B" },
];
const ROOT_ITEMS = buildSectionThreadList(
  [
    createThread({ id: "dragged", sectionId: "a" }),
    createThread({ id: "peer-a", sectionId: "a", createdAt: 2 }),
    createThread({ id: "in-b", sectionId: "b", createdAt: 3 }),
    createThread({ id: "loose", createdAt: 4 }),
  ],
  undefined,
  SECTIONS,
);
const LOOKUP = collectSectionThreadDndLookup(
  ROOT_ITEMS,
  CHRONOLOGICAL_CONTAINER_ID,
);
const SECTION_B_PARENT_KEY =
  LOOKUP.sectionParentKeyBySectionId.get("section:b");

function dragStart(id: string): DragStartEvent {
  return { active: { id } } as DragStartEvent;
}

function dragOver(activeId: string, overId: string): DragOverEvent {
  return { active: { id: activeId }, over: { id: overId } } as DragOverEvent;
}

function dragEnd(activeId: string, overId: string): DragEndEvent {
  return { active: { id: activeId }, over: { id: overId } } as DragEndEvent;
}

interface HarnessProps {
  rootItems: readonly ProjectThreadItem[];
}

function renderSectionThreadDnd(
  initialRootItems = ROOT_ITEMS,
  pinnedThreads: readonly SidebarThread[] = [],
) {
  const result: { current: SectionThreadDndState | null } = { current: null };
  const pinnedRootNodes = buildPinnedSidebarState({
    threads: pinnedThreads,
  }).rootNodes;
  function Harness({ rootItems }: HarnessProps) {
    result.current = useSectionThreadDnd({
      containerId: CHRONOLOGICAL_CONTAINER_ID,
      enabled: true,
      rootItems,
      topLevelSectionOrder: ["pinned", "section:a", "section:b", "threads"],
      onTopLevelSectionOrderChange: vi.fn(),
      pinnedReorderPending: false,
      pinnedThreads,
      pinnedRootNodes,
      onReorderPinnedThread: vi.fn(),
    });
    return null;
  }
  const slot = renderSlot(
    { component: Harness },
    { rootItems: initialRootItems },
    { sdk: { threads: { update: updateThreadFake } } },
  );
  return {
    inspection: slot.inspection,
    result,
    rerender: (props: HarnessProps) => slot.rerender(<Harness {...props} />),
  };
}

describe("useSectionThreadDnd pin mutations", () => {
  it("routes drag pinning through the optimistic sidebar action", async () => {
    const { inspection, result } = renderSectionThreadDnd();
    const props = () => result.current!.dndContextProps;

    act(() => props().onDragStart?.(dragStart("loose")));
    act(() => props().onDragEnd?.(dragEnd("loose", "pinned")));
    await flushTasks();

    expect(inspection.sidebarActionCalls).toEqual([
      { method: "setPinned", threadId: "loose", pinned: true },
    ]);
    expect(inspection.sdkCalls).not.toContainEqual({
      method: "threads.pin",
      args: [{ threadId: "loose" }],
    });
  });

  it("routes drag unpinning through the optimistic sidebar action", async () => {
    const pinned = createThread({
      id: "pinned-thread",
      pinnedAt: 42,
      sectionId: "a",
    });
    const { inspection, result } = renderSectionThreadDnd(ROOT_ITEMS, [pinned]);
    const props = () => result.current!.dndContextProps;

    act(() => props().onDragStart?.(dragStart(pinned.id)));
    act(() => props().onDragEnd?.(dragEnd(pinned.id, "section:a")));
    await flushTasks();

    expect(inspection.sidebarActionCalls).toEqual([
      { method: "setPinned", threadId: pinned.id, pinned: false },
    ]);
    expect(inspection.sdkCalls).not.toContainEqual({
      method: "threads.unpin",
      args: [{ threadId: pinned.id }],
    });
  });
});

function notePointerMove() {
  document.dispatchEvent(
    new MouseEvent("pointermove", { bubbles: true, clientX: 10, clientY: 10 }),
  );
}

afterEach(() => {
  cleanup();
  updateThreadDeferred = null;
});

describe("useSectionThreadDnd projection feedback loop (#1830)", () => {
  it("does not project a sidebar target while the pointer is in the main panel", () => {
    const originalElementsFromPoint = document.elementsFromPoint;
    const main = document.createElement("main");
    const sidebar = document.createElement("aside");
    const sidebarRow = document.createElement("div");
    sidebar.dataset.sidebar = "sidebar";
    sidebar.append(sidebarRow);
    document.body.append(main, sidebar);
    const elementsFromPoint = vi.fn((): Element[] => [main]);
    document.elementsFromPoint = elementsFromPoint;
    try {
      const { result } = renderSectionThreadDnd();
      const rect = {
        top: 0,
        left: 0,
        width: 200,
        height: 28,
        right: 200,
        bottom: 28,
      };
      const collide = () =>
        result.current!.dndContextProps.collisionDetection!({
          active: { id: "section:a" },
          collisionRect: rect,
          droppableRects: new Map([["section:b", rect]]),
          droppableContainers: [{ id: "section:b" }],
          pointerCoordinates: { x: 20, y: 14 },
        } as unknown as Parameters<CollisionDetection>[0]);

      expect(collide()).toEqual([]);
      elementsFromPoint.mockReturnValue([sidebarRow]);
      expect(collide().map(({ id }) => id)).toEqual(["section:b"]);
    } finally {
      main.remove();
      sidebar.remove();
      document.elementsFromPoint = originalElementsFromPoint;
    }
  });

  it("keeps the landing projection until the moved row replaces it", () => {
    const { result, rerender } = renderSectionThreadDnd();
    const props = () => result.current!.dndContextProps;

    act(() => props().onDragStart?.(dragStart("dragged")));
    act(() => props().onDragOver?.(dragOver("dragged", "section:b")));
    expect(result.current?.activeThread?.id).toBe("dragged");
    expect(result.current?.dragOverParentKey).toBe(SECTION_B_PARENT_KEY);

    act(() => props().onDragEnd?.(dragEnd("dragged", "section:b")));
    expect(result.current?.activeThread?.id).toBe("dragged");

    const movedRootItems = buildSectionThreadList(
      [
        createThread({ id: "dragged", sectionId: "b" }),
        createThread({ id: "peer-a", sectionId: "a", createdAt: 2 }),
        createThread({ id: "in-b", sectionId: "b", createdAt: 3 }),
        createThread({ id: "loose", createdAt: 4 }),
      ],
      undefined,
      SECTIONS,
    );
    rerender({ rootItems: movedRootItems });
    expect(result.current?.activeThread).toBeNull();
    expect(result.current?.dragOverParentKey).toBeNull();
  });

  it("follows the resolved drop parent and clears it over the source section", () => {
    const { result } = renderSectionThreadDnd();
    const props = () => result.current!.dndContextProps;

    act(() => props().onDragStart?.(dragStart("dragged")));
    act(() => props().onDragOver?.(dragOver("dragged", "section:b")));
    expect(result.current?.dragOverParentKey).toBe(SECTION_B_PARENT_KEY);

    act(() => props().onDragOver?.(dragOver("dragged", "loose")));
    expect(result.current?.dragOverParentKey).toBe(CHRONOLOGICAL_CONTAINER_ID);

    act(() => props().onDragOver?.(dragOver("dragged", "peer-a")));
    expect(result.current?.dragOverParentKey).toBeNull();

    act(() => props().onDragOver?.(dragOver("dragged", "section:b")));
    expect(result.current?.dragOverParentKey).toBe(SECTION_B_PARENT_KEY);
  });
});

describe("useSectionThreadDnd nest projection", () => {
  it("projects a nest target from a row collision and keeps it through self-collision", () => {
    const { result } = renderSectionThreadDnd();
    const props = () => result.current!.dndContextProps;

    act(() => props().onDragStart?.(dragStart("dragged")));
    act(() =>
      props().onDragOver?.(
        dragOver("dragged", getSidebarThreadRowDroppableId("in-b")),
      ),
    );
    expect(result.current?.nestTarget).toEqual({
      threadId: "in-b",
      state: "valid",
    });
    expect(result.current?.dragOverParentKey).toBeNull();

    act(() => notePointerMove());
    act(() => props().onDragOver?.(dragOver("dragged", "dragged")));
    expect(result.current?.nestTarget).toEqual({
      threadId: "in-b",
      state: "valid",
    });

    act(() => notePointerMove());
    act(() => props().onDragOver?.(dragOver("dragged", "section:b")));
    expect(result.current?.nestTarget).toBeNull();
    expect(result.current?.dragOverParentKey).toBe(SECTION_B_PARENT_KEY);

    act(() => notePointerMove());
    act(() => props().onDragOver?.(dragOver("dragged", "peer-a")));
    expect(result.current?.dragOverParentKey).toBeNull();

    act(() =>
      props().onDragCancel?.({
        active: { id: "dragged" },
      } as DragCancelEvent),
    );
    expect(result.current?.nestTarget).toBeNull();
  });
});

describe("worktree group drop collisions", () => {
  it("keeps an empty Threads destination when hidden group children overlap the pointer", () => {
    const rootItems = buildSectionThreadList(
      [
        Object.assign(
          createThread({
            id: "first",
            sectionId: "a",
            environment: makeSidebarEnvironment({
              id: "env",
              isWorktree: true,
              name: "Reviewer worktree group",
            }),
            createdAt: 3,
          }),
          { displayTitle: "Worktree root A" },
        ),
        createThread({
          id: "second",
          sectionId: "a",
          environment: makeSidebarEnvironment({ id: "env", isWorktree: true }),
          createdAt: 2,
        }),
        createThread({
          id: "child",
          sectionId: "a",
          environment: makeSidebarEnvironment({ id: "env", isWorktree: true }),
          parentThreadId: "second",
        }),
      ],
      undefined,
      SECTIONS,
      new Set(),
      true,
    );
    const lookup = collectSectionThreadDndLookup(
      rootItems,
      CHRONOLOGICAL_CONTAINER_ID,
    );
    const activeId = [...lookup.groupThreadsByItemId.keys()][0];
    const { result } = renderSectionThreadDnd(rootItems);
    const props = () => result.current!.dndContextProps;
    act(() => props().onDragStart?.(dragStart(activeId)));
    expect(result.current?.activeThread?.title).toBe(
      "Reviewer worktree group (3 threads)",
    );
    expect(
      result.current?.activeThread &&
        "displayTitle" in result.current.activeThread
        ? result.current.activeThread.displayTitle
        : null,
    ).toBe("Reviewer worktree group (3 threads)");
    act(() => props().onDragOver?.(dragOver(activeId, "threads")));
    expect(result.current?.dragOverParentKey).toBe(CHRONOLOGICAL_CONTAINER_ID);

    const sourceRect = {
      top: 100,
      left: 0,
      width: 200,
      height: 28,
      right: 200,
      bottom: 128,
    };
    const targetRect = { ...sourceRect, top: 40, bottom: 68 };
    const sourceIds = [
      activeId,
      "first",
      "second",
      "child",
      getSidebarThreadRowDroppableId("child"),
    ];
    const droppableRects = new Map([
      ...sourceIds.map((id): [string, typeof sourceRect] => [id, sourceRect]),
      [CHRONOLOGICAL_CONTAINER_ID, targetRect],
    ]);
    for (const pointerCoordinates of [
      { x: 20, y: 114 },
      { x: 20, y: 150 },
    ]) {
      const collisions = props().collisionDetection!({
        active: { id: activeId },
        collisionRect: sourceRect,
        droppableRects,
        droppableContainers: [...droppableRects.keys()].map((id) => ({ id })),
        pointerCoordinates,
      } as unknown as Parameters<CollisionDetection>[0]);
      expect(collisions.map(({ id }) => id)).toEqual([
        CHRONOLOGICAL_CONTAINER_ID,
      ]);
    }
    act(() =>
      props().onDragCancel?.({ active: { id: activeId } } as DragCancelEvent),
    );
  });
});

describe("useSectionThreadDnd settled drop cleanup", () => {
  const nestedRootItems = buildSectionThreadList(
    [
      createThread({ id: "dragged", sectionId: "b", parentThreadId: "in-b" }),
      createThread({ id: "peer-a", sectionId: "a", createdAt: 2 }),
      createThread({ id: "in-b", sectionId: "b", createdAt: 3 }),
      createThread({ id: "loose", createdAt: 4 }),
    ],
    undefined,
    SECTIONS,
  );
  const withoutDraggedRootItems = buildSectionThreadList(
    [
      createThread({ id: "peer-a", sectionId: "a", createdAt: 2 }),
      createThread({ id: "in-b", sectionId: "b", createdAt: 3 }),
      createThread({ id: "loose", createdAt: 4 }),
    ],
    undefined,
    SECTIONS,
  );

  async function nestDraggedOntoInB(settle: () => void) {
    const view = renderSectionThreadDnd();
    const props = () => view.result.current!.dndContextProps;

    act(() => props().onDragStart?.(dragStart("dragged")));
    act(() =>
      props().onDragOver?.(
        dragOver("dragged", getSidebarThreadRowDroppableId("in-b")),
      ),
    );
    expect(view.result.current?.nestTarget).toEqual({
      threadId: "in-b",
      state: "valid",
    });

    act(() =>
      props().onDragEnd?.(
        dragEnd("dragged", getSidebarThreadRowDroppableId("in-b")),
      ),
    );
    await flushTasks();
    expect(updateThreadDeferred).not.toBeNull();
    settle();
    await flushTasks();
    return view;
  }

  it("does not resurrect the nest projection when the dropped row later leaves the tree", async () => {
    const { result, rerender } = await nestDraggedOntoInB(() =>
      resolveUpdateThread(createThread({ id: "dragged" })),
    );

    rerender({ rootItems: nestedRootItems });
    expect(result.current?.nestTarget).toBeNull();
    expect(result.current?.activeThread).toBeNull();

    rerender({ rootItems: withoutDraggedRootItems });
    expect(result.current?.nestTarget).toBeNull();
    expect(result.current?.activeThread).toBeNull();
  });

  it("clears the nest projection when the drop mutation fails", async () => {
    const { result } = await nestDraggedOntoInB(() =>
      rejectUpdateThread(new Error("nope")),
    );

    expect(result.current?.nestTarget).toBeNull();
    expect(result.current?.activeThread).toBeNull();
  });
});

describe("useSectionThreadDnd nest hover delay", () => {
  const rowRect = {
    top: 100,
    left: 0,
    width: 200,
    height: 28,
    right: 200,
    bottom: 128,
  };
  const rowDroppableId = getSidebarThreadRowDroppableId("in-b");

  afterEach(() => {
    vi.useRealTimers();
  });

  it("only offers the row as a nest target after the pointer rests on it", () => {
    vi.useFakeTimers();
    const { result } = renderSectionThreadDnd();
    const props = () => result.current!.dndContextProps;
    const collide = (y: number, left = 0) =>
      props().collisionDetection!({
        active: { id: "dragged" },
        collisionRect: {
          ...rowRect,
          left,
          right: left + rowRect.width,
        },
        droppableRects: new Map([[rowDroppableId, rowRect]]),
        droppableContainers: [{ id: rowDroppableId }],
        pointerCoordinates: { x: 20, y },
      } as unknown as Parameters<CollisionDetection>[0]).map(({ id }) => id);

    act(() => props().onDragStart?.(dragStart("dragged")));
    expect(collide(114, 48)).toEqual([]);
    act(() => vi.advanceTimersByTime(NEST_HOVER_DELAY_MS - 1));
    expect(collide(114, 48)).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(collide(114, 48)).toEqual([rowDroppableId]);

    expect(collide(140)).toEqual([]);
    expect(collide(114)).toEqual([]);
    act(() => vi.advanceTimersByTime(NEST_HOVER_DELAY_MS));
    expect(collide(114)).toEqual([rowDroppableId]);

    act(() =>
      props().onDragCancel?.({ active: { id: "dragged" } } as DragCancelEvent),
    );
    act(() => props().onDragStart?.(dragStart("dragged")));
    expect(collide(114)).toEqual([]);
  });
});
