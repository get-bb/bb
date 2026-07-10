// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPACT_VIEWPORT_QUERY } from "@bb/shared-ui/hooks/use-compact-viewport";
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
});
