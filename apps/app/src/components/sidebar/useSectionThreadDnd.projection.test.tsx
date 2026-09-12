// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  CollisionDetection,
  DragCancelEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import type { ThreadListEntry } from "@bb/domain";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSectionThreadList,
  CHRONOLOGICAL_CONTAINER_ID,
} from "@bb/client-core";
import {
  collectSectionThreadDndLookup,
  NEST_HOVER_DELAY_MS,
  SectionThreadProjectionGate,
  useSectionThreadDnd,
} from "./useSectionThreadDnd";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { getSidebarThreadRowDroppableId } from "./sidebarThreadRowDroppable";

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

function renderSectionThreadDnd() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    () =>
      useSectionThreadDnd({
        containerId: CHRONOLOGICAL_CONTAINER_ID,
        enabled: true,
        rootItems: ROOT_ITEMS,
        topLevelSectionOrder: ["pinned", "section:a", "section:b", "threads"],
        onTopLevelSectionOrderChange: vi.fn(),
        pinnedReorderPending: false,
        pinnedThreads: [],
        onReorderPinnedThread: vi.fn(),
      }),
    { wrapper },
  );
}

function notePointerMove() {
  document.dispatchEvent(
    new MouseEvent("pointermove", { bubbles: true, clientX: 10, clientY: 10 }),
  );
}

afterEach(() => {
  cleanup();
});

describe("useSectionThreadDnd projection feedback loop (#1830)", () => {
  it("does not un-project when `over` flips back without new user input", () => {
    const { result } = renderSectionThreadDnd();
    const props = () => result.current!.dndContextProps;

    act(() => props().onDragStart?.(dragStart("dragged")));
    act(() => props().onDragOver?.(dragOver("dragged", "section:b")));
    expect(result.current?.dragOverParentKey).toBe(SECTION_B_PARENT_KEY);

    act(() => props().onDragOver?.(dragOver("dragged", "peer-a")));
    expect(result.current?.dragOverParentKey).toBe(SECTION_B_PARENT_KEY);

    act(() => props().onDragOver?.(dragOver("dragged", "loose")));
    expect(result.current?.dragOverParentKey).toBe(CHRONOLOGICAL_CONTAINER_ID);

    act(() => notePointerMove());
    act(() => props().onDragOver?.(dragOver("dragged", "peer-a")));
    expect(result.current?.dragOverParentKey).toBeNull();

    act(() => notePointerMove());
    act(() => props().onDragOver?.(dragOver("dragged", "section:b")));
    expect(result.current?.dragOverParentKey).toBe(SECTION_B_PARENT_KEY);
  });

  it("stops tracking input once the drag ends", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { result, unmount } = renderSectionThreadDnd();
    const props = () => result.current!.dndContextProps;

    act(() => props().onDragStart?.(dragStart("dragged")));
    const added = addSpy.mock.calls.filter(([type]) => type === "pointermove");
    expect(added).toHaveLength(1);

    act(() =>
      props().onDragCancel?.({ active: { id: "dragged" } } as DragCancelEvent),
    );
    expect(
      removeSpy.mock.calls.filter(([type]) => type === "pointermove"),
    ).toHaveLength(1);

    act(() => props().onDragStart?.(dragStart("dragged")));
    unmount();
    expect(
      removeSpy.mock.calls.filter(([type]) => type === "pointermove"),
    ).toHaveLength(2);
    addSpy.mockRestore();
    removeSpy.mockRestore();
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
    const collide = (y: number) =>
      props().collisionDetection!({
        active: { id: "dragged" },
        collisionRect: rowRect,
        droppableRects: new Map([[rowDroppableId, rowRect]]),
        droppableContainers: [{ id: rowDroppableId }],
        pointerCoordinates: { x: 20, y },
      } as unknown as Parameters<CollisionDetection>[0]).map(({ id }) => id);

    act(() => props().onDragStart?.(dragStart("dragged")));
    expect(collide(114)).toEqual([]);
    act(() => vi.advanceTimersByTime(NEST_HOVER_DELAY_MS - 1));
    expect(collide(114)).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(collide(114)).toEqual([rowDroppableId]);

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

describe("SectionThreadProjectionGate", () => {
  it("allows each target once per input and blocks reverts", () => {
    const gate = new SectionThreadProjectionGate();
    expect(gate.allow(null, "b")).toBe(true);
    expect(gate.allow("b", null)).toBe(false);
    expect(gate.allow("b", "c")).toBe(true);
    expect(gate.allow("c", "b")).toBe(false);

    gate.noteInput();
    expect(gate.allow("c", "b")).toBe(true);
    expect(gate.allow("b", "c")).toBe(false);

    gate.reset();
    expect(gate.allow("b", "c")).toBe(true);
  });
});
