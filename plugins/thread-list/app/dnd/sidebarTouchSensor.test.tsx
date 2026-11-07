// @vitest-environment jsdom

import { act, cleanup, createEvent, fireEvent, render, waitFor } from "@testing-library/react";
import { DndContext, useDraggable } from "@dnd-kit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSidebarReorderDnd } from "@/components/ui/use-sidebar-reorder-dnd";
import { SidebarTouchSensor } from "./sidebarTouchSensor.js";

afterEach(() => {
  cleanup();
});

describe("SidebarTouchSensor", () => {
  function DraggableRow({ onClick }: { onClick?: () => void }) {
    const { attributes, listeners, setNodeRef } = useDraggable({ id: "thread-1" });
    return <div ref={setNodeRef} {...attributes} {...listeners} onClick={onClick}>Thread</div>;
  }

  it("keeps a slow drifting row touch as a tap and starts drag after hold and movement", async () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    const onClick = vi.fn();
    function Harness() {
      const { dndContextProps } = useSidebarReorderDnd({
        onDragStart,
        onDragEnd,
        touchSensor: SidebarTouchSensor,
      });
      return <DndContext {...dndContextProps}><DraggableRow onClick={onClick} /></DndContext>;
    }
    const { getByText } = render(<Harness />);
    const row = getByText("Thread");

    fireEvent.touchStart(row, { touches: [{ clientX: 10, clientY: 10 }] });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 230)));
    fireEvent.touchMove(row, { touches: [{ clientX: 14, clientY: 10 }] });
    fireEvent.touchEnd(row, { touches: [] });
    expect(onDragStart).not.toHaveBeenCalled();
    expect(row.hasAttribute("data-sidebar-touch-armed")).toBe(false);
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);

    fireEvent.touchStart(row, { touches: [{ clientX: 10, clientY: 10 }] });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 550)));
    expect(row.dataset.sidebarTouchArmed).toBe("true");
    fireEvent.touchEnd(row, { touches: [] });
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(2);

    fireEvent.touchStart(row, { touches: [{ clientX: 10, clientY: 10 }] });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 550)));
    expect(onDragStart).not.toHaveBeenCalled();
    expect(row.dataset.sidebarTouchArmed).toBe("true");
    fireEvent.touchMove(row, { touches: [{ clientX: 14, clientY: 10 }] });
    expect(row.dataset.sidebarTouchArmed).toBe("true");
    fireEvent.touchMove(row, { touches: [{ clientX: 24, clientY: 10 }] });
    await waitFor(() => expect(onDragStart).toHaveBeenCalledTimes(1));
    expect(row.hasAttribute("data-sidebar-touch-armed")).toBe(false);
    fireEvent.touchEnd(row, { touches: [] });
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it("reports the end of a drag released in the same task that started it", async () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    function Harness() {
      const { dndContextProps } = useSidebarReorderDnd({
        onDragStart,
        onDragEnd,
        touchSensor: SidebarTouchSensor,
      });
      return <DndContext {...dndContextProps}><DraggableRow /></DndContext>;
    }
    const { getByText } = render(<Harness />);
    const row = getByText("Thread");

    fireEvent.touchStart(row, { touches: [{ identifier: 1, clientX: 10, clientY: 10 }] });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 550)));
    const actEnvironment = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
    try {
      row.dispatchEvent(createEvent.touchMove(row, { touches: [{ identifier: 1, clientX: 40, clientY: 10 }] }));
      row.dispatchEvent(createEvent.touchEnd(row, { touches: [], changedTouches: [{ identifier: 1, clientX: 40, clientY: 10 }] }));
    } finally {
      Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", actEnvironment);
    }
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    expect(document.body.dataset.sidebarDragging).toBeUndefined();
  });

  it("claims touchmoves once armed so native scroll and drawer swipes cannot run alongside the drag", async () => {
    function Harness() {
      const { dndContextProps } = useSidebarReorderDnd({
        onDragEnd: vi.fn(),
        touchSensor: SidebarTouchSensor,
      });
      return <DndContext {...dndContextProps}><DraggableRow /></DndContext>;
    }
    const { getByText } = render(<Harness />);
    const row = getByText("Thread");

    fireEvent.touchStart(row, { touches: [{ clientX: 10, clientY: 10 }] });
    expect(fireEvent.touchMove(row, { touches: [{ clientX: 13, clientY: 10 }] })).toBe(true);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 550)));
    expect(fireEvent.touchMove(row, { touches: [{ clientX: 18, clientY: 10 }] })).toBe(false);
    fireEvent.touchEnd(row, { touches: [] });
  });

  it("ends the drag when the touched row remounts mid-drag", async () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    function Harness({ rowKey }: { rowKey: string }) {
      const { dndContextProps } = useSidebarReorderDnd({
        onDragStart,
        onDragEnd,
        touchSensor: SidebarTouchSensor,
      });
      return <DndContext {...dndContextProps}><DraggableRow key={rowKey} /></DndContext>;
    }
    const { getByText, rerender } = render(<Harness rowKey="before" />);
    const row = getByText("Thread");

    fireEvent.touchStart(row, { touches: [{ clientX: 10, clientY: 10 }] });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 550)));
    fireEvent.touchMove(row, { touches: [{ clientX: 10, clientY: 40 }] });
    await waitFor(() => expect(onDragStart).toHaveBeenCalledTimes(1));

    rerender(<Harness rowKey="after" />);
    expect(row.isConnected).toBe(false);
    fireEvent.touchEnd(row, { touches: [] });
    await waitFor(() => expect(onDragEnd).toHaveBeenCalledTimes(1));

    const remounted = getByText("Thread");
    fireEvent.touchStart(remounted, { touches: [{ clientX: 50, clientY: 50 }] });
    fireEvent.touchEnd(remounted, { touches: [] });
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
