// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { Active, ClientRect, DroppableContainer } from "@dnd-kit/core";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { DragStartEvent } from "@dnd-kit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getProjectIdFromProjectDropTarget,
  getProjectThreadDropTargetId,
  getProjectThreadMoveId,
  getProjectThreadMoveTargetProjectId,
  getThreadIdFromProjectThreadMoveId,
  projectThreadMoveTransform,
  projectThreadMoveCollisionDetection,
  useProjectThreadMoveDnd,
} from "./useProjectThreadMoveDnd";

afterEach(() => {
  cleanup();
  delete document.body.dataset.sidebarDragging;
});

function makeRect(
  top: number,
  left: number,
  width: number,
  height: number,
): ClientRect {
  return {
    bottom: top + height,
    left,
    right: left + width,
    top,
    width,
    height,
  };
}

function makeDroppable(id: string): DroppableContainer {
  return {
    data: { current: {} },
    disabled: false,
    id,
    key: id,
    node: { current: null },
    rect: { current: null },
  };
}

function makeActive(id: string): Active {
  return {
    data: { current: {} },
    id,
    rect: { current: { initial: null, translated: null } },
  };
}

describe("project thread move drag ids", () => {
  it("allows project-move ghosts to travel horizontally while keeping reorders vertical", () => {
    const transform = { x: 180, y: 40, scaleX: 1, scaleY: 1 };

    expect(
      projectThreadMoveTransform(getProjectThreadMoveId("t1"), transform),
    ).toEqual(transform);
    expect(projectThreadMoveTransform("project:p1", transform)).toEqual({
      ...transform,
      x: 0,
    });
  });

  it("round-trips thread and project targets", () => {
    expect(
      getThreadIdFromProjectThreadMoveId(getProjectThreadMoveId("t1")),
    ).toBe("t1");
    expect(
      getProjectIdFromProjectDropTarget(getProjectThreadDropTargetId("p1")),
    ).toBe("p1");
    expect(getProjectIdFromProjectDropTarget("project:p2")).toBe("p2");
    expect(getProjectIdFromProjectDropTarget("threads")).toBeNull();
  });

  it("does not treat unrelated sidebar ids as move targets", () => {
    expect(getThreadIdFromProjectThreadMoveId("thread:t1")).toBeNull();
    expect(getProjectIdFromProjectDropTarget("section:s1")).toBeNull();
    expect(getProjectIdFromProjectDropTarget("project-drop:")).toBeNull();
  });

  it("does not highlight or submit a drop onto the thread's current project", () => {
    const threadProjectIds = new Map([["t1", "p1"]]);

    expect(
      getProjectThreadMoveTargetProjectId({
        activeThreadId: "t1",
        overTargetId: getProjectThreadDropTargetId("p1"),
        threadProjectIds,
      }),
    ).toBeNull();
    expect(
      getProjectThreadMoveTargetProjectId({
        activeThreadId: "t1",
        overTargetId: getProjectThreadDropTargetId("p2"),
        threadProjectIds,
      }),
    ).toBe("p2");
  });

  it("keeps personal as an explicit destination so the server can explain the restriction", () => {
    const threadProjectIds = new Map([["t1", "p1"]]);

    expect(
      getProjectThreadMoveTargetProjectId({
        activeThreadId: "t1",
        overTargetId: getProjectThreadDropTargetId(PERSONAL_PROJECT_ID),
        threadProjectIds,
      }),
    ).toBe(PERSONAL_PROJECT_ID);
  });

  it("prefers a project target over nested thread droppables", () => {
    const projectTarget = getProjectThreadDropTargetId("p2");
    const nestedThreadTarget = "thread-sortable:t2";
    const projectRect = makeRect(0, 0, 240, 240);
    const nestedThreadRect = makeRect(40, 0, 240, 32);

    const collisions = projectThreadMoveCollisionDetection({
      active: makeActive(getProjectThreadMoveId("t1")),
      collisionRect: nestedThreadRect,
      droppableContainers: [
        makeDroppable(nestedThreadTarget),
        makeDroppable(projectTarget),
      ],
      droppableRects: new Map([
        [nestedThreadTarget, nestedThreadRect],
        [projectTarget, projectRect],
      ]),
      pointerCoordinates: { x: 120, y: 56 },
    });

    expect(collisions[0]?.id).toBe(projectTarget);
  });

  it("cancels a project move when the pointer leaves the sidebar", () => {
    const projectTarget = getProjectThreadDropTargetId("p2");
    const projectRect = makeRect(0, 0, 240, 240);

    expect(
      projectThreadMoveCollisionDetection({
        active: makeActive(getProjectThreadMoveId("t1")),
        collisionRect: makeRect(0, 400, 240, 32),
        droppableContainers: [makeDroppable(projectTarget)],
        droppableRects: new Map([[projectTarget, projectRect]]),
        pointerCoordinates: { x: 500, y: 16 },
      }),
    ).toEqual([]);
  });

  it("captures the source project for the drag affordance", () => {
    const { result } = renderHook(() =>
      useProjectThreadMoveDnd({
        onMove: vi.fn(),
        threadProjectIds: new Map([["t1", "p1"]]),
      }),
    );

    act(() => {
      result.current.onDragStart({
        active: { id: getProjectThreadMoveId("t1") },
      } as DragStartEvent);
    });

    expect(result.current.activeThreadId).toBe("t1");
    expect(result.current.sourceProjectId).toBe("p1");

    act(() => result.current.onDragCancel());
    expect(result.current.sourceProjectId).toBeNull();
  });
});
