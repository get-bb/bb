// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
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
} from "./projectThreadGroups";
import {
  collectSectionThreadDndLookup,
  SectionThreadProjectionGate,
  useSectionThreadDnd,
} from "./useSectionThreadDnd";

function createThread(overrides: Partial<ThreadListEntry>): ThreadListEntry {
  return {
    id: "thread",
    projectId: "project",
    environmentId: null,
    providerId: "codex",
    title: "Thread",
    titleFallback: "Thread",
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: 0,
    latestAttentionAt: 2,
    createdAt: 1,
    updatedAt: 2,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  };
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
    expect(result.current?.projectedSectionId).toBe("b");

    // The projection re-rendered the row into section B and dnd-kit resolved
    // `over` against the source section again with the pointer unmoved. That
    // is our own render feeding back, so the projection must hold; reverting
    // here is what looped until React error #185.
    act(() => props().onDragOver?.(dragOver("dragged", "peer-a")));
    expect(result.current?.dragOverParentKey).toBe(SECTION_B_PARENT_KEY);
    expect(result.current?.projectedSectionId).toBe("b");

    // A target the pointer has not visited yet is still allowed.
    act(() => props().onDragOver?.(dragOver("dragged", "loose")));
    expect(result.current?.dragOverParentKey).toBe(CHRONOLOGICAL_CONTAINER_ID);
    expect(result.current?.projectedSectionId).toBeNull();

    // Real input re-opens every target, including the source section.
    act(() => notePointerMove());
    act(() => props().onDragOver?.(dragOver("dragged", "peer-a")));
    expect(result.current?.dragOverParentKey).toBeNull();
    expect(result.current?.projectedSectionId).toBeUndefined();

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
