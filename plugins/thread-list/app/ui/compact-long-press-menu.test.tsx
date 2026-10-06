// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactLongPressMenu } from "./compact-long-press-menu.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CompactLongPressMenu", () => {
  it("cancels a pending actions menu when dragging begins", () => {
    vi.useFakeTimers();
    const onOpenChange = vi.fn();
    const renderMenu = (dragging: boolean) => (
      <CompactLongPressMenu
        label="Thread actions"
        dragging={dragging}
        items={<button type="button">Action</button>}
        onOpenChange={onOpenChange}
      >
        <button type="button">Thread</button>
      </CompactLongPressMenu>
    );
    const { getByRole, rerender } = render(renderMenu(false));
    fireEvent.pointerDown(getByRole("button", { name: "Thread" }), {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 10,
      clientY: 10,
    });

    rerender(renderMenu(true));
    act(() => vi.advanceTimersByTime(800));

    expect(onOpenChange).not.toHaveBeenCalledWith(true);
  });

  it("dismisses an open actions menu when dragging begins", () => {
    const onOpenChange = vi.fn();
    const renderMenu = (dragging: boolean) => (
      <CompactLongPressMenu
        label="Thread actions"
        dragging={dragging}
        items={<button type="button">Action</button>}
        onOpenChange={onOpenChange}
      >
        <button type="button">Thread</button>
      </CompactLongPressMenu>
    );
    const { getByRole, rerender } = render(renderMenu(false));
    fireEvent.contextMenu(getByRole("button", { name: "Thread" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);

    rerender(renderMenu(true));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
