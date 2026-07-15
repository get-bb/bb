// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type {
  DragCancelEvent,
  DragEndEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSidebarReorderDnd } from "./useSidebarReorderDnd";

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

    // A late public callback from dnd-kit must not run owner cleanup twice.
    act(() => result.current.dndContextProps.onDragCancel?.(DRAG_CANCEL_EVENT));
    expect(onDragCancel).toHaveBeenCalledTimes(1);
  });
});
