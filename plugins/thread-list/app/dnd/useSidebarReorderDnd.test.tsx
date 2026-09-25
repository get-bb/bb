// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { DndContext, useDraggable } from "@dnd-kit/core";
import type {
  DragCancelEvent,
  DragEndEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SidebarTouchSensor,
  useSidebarReorderDnd,
} from "./useSidebarReorderDnd.js";

const DRAG_START_EVENT = { active: { id: "thread-1" } } as DragStartEvent;
const DRAG_END_EVENT = {
  active: { id: "thread-1" },
  over: { id: "thread-2" },
} as DragEndEvent;
const DRAG_CANCEL_EVENT = { active: { id: "thread-1" } } as DragCancelEvent;

afterEach(() => {
  cleanup();
  delete document.body.dataset.sidebarDragging;
});

describe("useSidebarReorderDnd", () => {
  it("allows callers to opt into unrestricted pointer movement", () => {
    const { result } = renderHook(() =>
      useSidebarReorderDnd({ axis: "free", onDragEnd: vi.fn() }),
    );

    expect(result.current.dndContextProps.modifiers).toEqual([]);
  });

  it("marks the document as dragging until end, cancel, or unmount", () => {
    const onDragEnd = vi.fn();
    const { result, unmount } = renderHook(() =>
      useSidebarReorderDnd({ onDragEnd }),
    );

    act(() => result.current.dndContextProps.onDragStart?.(DRAG_START_EVENT));
    expect(document.body.dataset.sidebarDragging).toBe("true");

    act(() => result.current.dndContextProps.onDragCancel?.(DRAG_CANCEL_EVENT));
    expect(document.body.dataset.sidebarDragging).toBeUndefined();

    act(() => result.current.dndContextProps.onDragStart?.(DRAG_START_EVENT));
    act(() => result.current.dndContextProps.onDragEnd?.(DRAG_END_EVENT));
    expect(document.body.dataset.sidebarDragging).toBeUndefined();

    act(() => result.current.dndContextProps.onDragStart?.(DRAG_START_EVENT));
    unmount();
    expect(document.body.dataset.sidebarDragging).toBeUndefined();
  });

  it("clears app-owned drag state when Escape preempts dnd-kit cancellation", () => {
    const onDragCancel = vi.fn();
    const { result } = renderHook(() =>
      useSidebarReorderDnd({ onDragEnd: vi.fn(), onDragCancel }),
    );

    act(() => result.current.dndContextProps.onDragStart?.(DRAG_START_EVENT));
    expect(document.body.dataset.sidebarDragging).toBe("true");

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
        }),
      );
    });

    expect(document.body.dataset.sidebarDragging).toBeUndefined();
    expect(onDragCancel).toHaveBeenCalledTimes(1);

    act(() => result.current.dndContextProps.onDragCancel?.(DRAG_CANCEL_EVENT));
    expect(onDragCancel).toHaveBeenCalledTimes(1);
  });
});

describe("SidebarTouchSensor", () => {
  function DraggableRow() {
    const { attributes, listeners, setNodeRef } = useDraggable({ id: "thread-1" });
    return <div ref={setNodeRef} {...attributes} {...listeners}>Thread</div>;
  }

  it("keeps a slow drifting row touch as a tap and starts a longer hold as a drag", async () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    function Harness() {
      const { dndContextProps } = useSidebarReorderDnd({ onDragStart, onDragEnd });
      return <DndContext {...dndContextProps}><DraggableRow /></DndContext>;
    }
    const { getByText } = render(<Harness />);
    const row = getByText("Thread");

    fireEvent.touchStart(row, { touches: [{ clientX: 10, clientY: 10 }] });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 230)));
    fireEvent.touchMove(row, { touches: [{ clientX: 14, clientY: 10 }] });
    fireEvent.touchEnd(row, { touches: [] });
    expect(onDragStart).not.toHaveBeenCalled();

    fireEvent.touchStart(row, { touches: [{ clientX: 10, clientY: 10 }] });
    await waitFor(() => expect(onDragStart).toHaveBeenCalledTimes(1), {
      timeout: 900,
    });
    fireEvent.touchEnd(row, { touches: [] });
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  function touchMoveListenerCalls(spy: {
    mock: { calls: readonly (readonly unknown[])[] };
  }) {
    return spy.mock.calls.filter(([type]) => type === "touchmove");
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("installs a non-passive window touchmove listener on setup and removes it on teardown", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const teardown = SidebarTouchSensor.setup();
    const installs = touchMoveListenerCalls(addSpy);
    expect(installs).toHaveLength(1);
    expect(installs[0]?.[2]).toEqual({ capture: false, passive: false });
    expect(touchMoveListenerCalls(removeSpy)).toHaveLength(0);

    teardown();
    expect(touchMoveListenerCalls(removeSpy)).toHaveLength(1);
    expect(touchMoveListenerCalls(addSpy)).toHaveLength(1);
  });
});
