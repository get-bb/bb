// @vitest-environment jsdom

import { fireEvent, render } from "@testing-library/react";
import { DndContext, useDraggable } from "@dnd-kit/core";
import { describe, expect, it, vi } from "vitest";
import { useReorderDnd } from "./useReorderDnd";

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
});
