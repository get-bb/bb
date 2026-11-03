// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { DndContext, useDraggable } from "@dnd-kit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReorderDnd } from "@bb/shared-ui/use-reorder-dnd";

function DraggableRow({ onClick }: { onClick: () => void }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: "row" });
  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      Open row
    </button>
  );
}

afterEach(cleanup);

function dispatchOutsideAct(dispatch: () => void) {
  const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = actGlobal.IS_REACT_ACT_ENVIRONMENT;
  actGlobal.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    dispatch();
  } finally {
    actGlobal.IS_REACT_ACT_ENVIRONMENT = previous;
  }
}

describe("useReorderDnd", () => {
  it("keeps a click with small mouse movement from starting a drag", () => {
    const onClick = vi.fn();
    const onDragStart = vi.fn();
    const onDragCancel = vi.fn();
    const onDragEnd = vi.fn();

    function TestHost() {
      const { dndContextProps } = useReorderDnd({
        onDragEnd,
        onDragStart,
        onDragCancel,
      });
      return (
        <DndContext {...dndContextProps}>
          <DraggableRow onClick={onClick} />
        </DndContext>
      );
    }

    const { getByRole } = render(<TestHost />);
    const row = getByRole("button", { name: "Open row" });
    fireEvent.mouseDown(row, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 106, clientY: 100 });
    fireEvent.mouseUp(document, { clientX: 106, clientY: 100 });
    fireEvent.click(row);

    expect(onDragStart).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledOnce();

    fireEvent.mouseDown(row, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 112, clientY: 100 });

    expect(onDragStart).toHaveBeenCalledOnce();
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    fireEvent.mouseUp(document, { clientX: 112, clientY: 100 });

    expect(onDragCancel).toHaveBeenCalledOnce();
    expect(onDragEnd).not.toHaveBeenCalled();
  });

  it("cancels a drag released before the drag-start render commits", async () => {
    const onDragStart = vi.fn();
    const onDragCancel = vi.fn();
    const onDragEnd = vi.fn();

    function TestHost() {
      const { dndContextProps } = useReorderDnd({
        onDragEnd,
        onDragStart,
        onDragCancel,
      });
      return (
        <DndContext {...dndContextProps}>
          <DraggableRow onClick={vi.fn()} />
        </DndContext>
      );
    }

    const { getByRole } = render(<TestHost />);
    const row = getByRole("button", { name: "Open row" });
    dispatchOutsideAct(() => {
      row.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          clientX: 100,
          clientY: 100,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 100,
          clientY: 130,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, clientX: 100, clientY: 130 }),
      );
    });
    await act(async () => {});

    expect(onDragStart).toHaveBeenCalledOnce();
    expect(onDragCancel).toHaveBeenCalledOnce();
    expect(onDragEnd).not.toHaveBeenCalled();
  });
});
