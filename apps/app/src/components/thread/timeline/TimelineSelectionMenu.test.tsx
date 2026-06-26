// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPACT_VIEWPORT_QUERY } from "@/components/ui/hooks/use-compact-viewport";
import { TimelineSelectionMenu } from "./TimelineSelectionMenu";
import type { MessageProseSelection } from "./SelectableMessageProse";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeSelection(
  overrides: Partial<MessageProseSelection> = {},
): MessageProseSelection {
  return {
    text: "selected text",
    rect: new DOMRect(10, 10, 100, 20),
    sourceSeqEnd: 12,
    ...overrides,
  };
}

function mockCompactViewport() {
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: query === COMPACT_VIEWPORT_QUERY,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

describe("TimelineSelectionMenu", () => {
  it("renders only the actions with handlers", () => {
    render(
      <TimelineSelectionMenu
        selection={makeSelection()}
        onAddToChat={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Add to chat" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Reply in side chat" }),
    ).toBeNull();
  });

  it("does not mount when no action handlers are supplied", () => {
    render(
      <TimelineSelectionMenu selection={makeSelection()} onDismiss={vi.fn()} />,
    );

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders from a pointer release point without a physical anchor node", () => {
    const { container } = render(
      <TimelineSelectionMenu
        selection={makeSelection({ anchorPoint: { x: 42, y: 84 } })}
        onAddToChat={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Add to chat" })).toBeTruthy();
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it("uses the selected anchor side when positioning from a pointer release", () => {
    render(
      <TimelineSelectionMenu
        selection={makeSelection({
          anchorPoint: { x: 42, y: 84 },
          anchorSide: "bottom",
        })}
        onAddToChat={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(document.body.querySelector('[data-side="bottom"]')).toBeTruthy();
  });

  it("stays anchored instead of rendering as a compact viewport drawer", () => {
    mockCompactViewport();
    render(
      <TimelineSelectionMenu
        selection={makeSelection({ anchorSide: "top" })}
        onAddToChat={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Add to chat" })).toBeTruthy();
    expect(document.body.querySelector('[data-side="top"]')).toBeTruthy();
  });

  it("passes the selection branch point to side-chat replies", () => {
    const onReplyInSideChat = vi.fn();
    render(
      <TimelineSelectionMenu
        selection={makeSelection()}
        onDismiss={vi.fn()}
        onReplyInSideChat={onReplyInSideChat}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reply in side chat" }));

    expect(onReplyInSideChat).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "selected text",
        sourceSeqEnd: 12,
      }),
    );
  });
});
