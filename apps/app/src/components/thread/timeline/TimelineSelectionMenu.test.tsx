// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useLayoutEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPACT_VIEWPORT_QUERY } from "@bb/shared-ui/hooks/use-compact-viewport";
import { POINTER_COARSE_QUERY } from "@bb/shared-ui/hooks/use-pointer-coarse";
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

function mockPointerCoarse() {
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: query === POINTER_COARSE_QUERY,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

function mockLiveSelection(rect: DOMRect | null) {
  vi.spyOn(window, "getSelection").mockReturnValue({
    rangeCount: rect === null ? 0 : 1,
    isCollapsed: rect === null,
    getRangeAt: () => ({
      getClientRects: () => ({ length: 1, item: () => rect }),
      getBoundingClientRect: () => rect,
    }),
    removeAllRanges: () => {},
  } as unknown as Selection);
}

describe("TimelineSelectionMenu", () => {
  it("stays actionable while a scroll moves the selection", () => {
    const onAddToChat = vi.fn();
    const onDismiss = vi.fn();
    render(
      <>
        <div data-testid="scroller" />
        <TimelineSelectionMenu
          selection={makeSelection()}
          onAddToChat={onAddToChat}
          onDismiss={onDismiss}
        />
      </>,
    );
    mockLiveSelection(new DOMRect(10, 40, 100, 20));

    fireEvent.scroll(screen.getByTestId("scroller"));
    fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));

    expect(onAddToChat).toHaveBeenCalledWith("selected text");
  });

  it("dismisses once a scroll moves the selection out of view", () => {
    const onDismiss = vi.fn();
    render(
      <>
        <div data-testid="scroller" />
        <TimelineSelectionMenu
          selection={makeSelection()}
          onAddToChat={vi.fn()}
          onDismiss={onDismiss}
        />
      </>,
    );
    mockLiveSelection(new DOMRect(10, -40, 100, 20));

    fireEvent.scroll(screen.getByTestId("scroller"));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses on scroll once the selection is gone", () => {
    const onDismiss = vi.fn();
    render(
      <>
        <div data-testid="scroller" />
        <TimelineSelectionMenu
          selection={makeSelection()}
          onAddToChat={vi.fn()}
          onDismiss={onDismiss}
        />
      </>,
    );
    mockLiveSelection(null);

    fireEvent.scroll(screen.getByTestId("scroller"));

    expect(onDismiss).toHaveBeenCalledTimes(1);
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

  it.each([
    { edge: "left", release: { x: 300, y: 400 } },
    { edge: "right", release: { x: 1120, y: 400 } },
    { edge: "top", release: { x: 600, y: 20 } },
  ])(
    "keeps the menu inside the timeline for a release past its $edge edge",
    async ({ release }) => {
      const timeline = new DOMRect(320, 48, 780, 752);
      function ClippedTimeline() {
        const [layer, setLayer] = useState<HTMLDivElement | null>(null);
        return (
          <div data-testid="timeline" style={{ overflow: "hidden" }}>
            <div ref={setLayer} />
            <TimelineSelectionMenu
              selection={makeSelection({ anchorPoint: release })}
              onAddToChat={vi.fn()}
              onDismiss={vi.fn()}
              container={layer}
            />
          </div>
        );
      }
      vi.spyOn(
        HTMLElement.prototype,
        "getBoundingClientRect",
      ).mockImplementation(function (this: HTMLElement) {
        return this.dataset.testid === "timeline"
          ? timeline
          : new DOMRect(0, 0, 0, 0);
      });
      render(<ClippedTimeline />);

      await waitFor(() => {
        const wrapper = document.querySelector<HTMLElement>(
          "[data-radix-popper-content-wrapper]",
        );
        const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/u.exec(
          wrapper?.style.transform ?? "",
        );
        expect(match).not.toBeNull();
        const x = Number(match?.[1]);
        const y = Number(match?.[2]);
        expect(x).toBeGreaterThanOrEqual(timeline.left);
        expect(x).toBeLessThanOrEqual(timeline.right);
        expect(y).toBeGreaterThanOrEqual(timeline.top);
        expect(y).toBeLessThanOrEqual(timeline.bottom);
      });
    },
  );

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

  it("opens a compact menu below touch selections, away from the native selection toolbar", () => {
    mockPointerCoarse();
    render(
      <TimelineSelectionMenu
        selection={makeSelection({
          anchorPoint: { x: 60, y: 54 },
          anchorSide: "bottom",
        })}
        onAddToChat={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Add to chat" })).toBeTruthy();
    expect(document.body.querySelector('[data-side="bottom"]')).toBeTruthy();
  });

  it("activates a touch action on pointer-up without waiting for click", () => {
    const onAddToChat = vi.fn();
    const onDismiss = vi.fn();
    render(
      <TimelineSelectionMenu
        selection={makeSelection()}
        onAddToChat={onAddToChat}
        onDismiss={onDismiss}
      />,
    );

    const button = screen.getByRole("button", { name: "Add to chat" });
    fireEvent.pointerDown(button, { pointerType: "touch" });
    fireEvent.pointerUp(button, { pointerType: "touch" });
    fireEvent.click(button);

    expect(onAddToChat).toHaveBeenCalledTimes(1);
    expect(onAddToChat).toHaveBeenCalledWith("selected text");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("focuses the composer before a touch add-to-chat action returns", () => {
    function ComposerFocusHandoff() {
      const [selection, setSelection] = useState<MessageProseSelection | null>(
        makeSelection(),
      );
      const [focusRequest, setFocusRequest] = useState(0);
      const inputRef = useRef<HTMLInputElement>(null);
      useLayoutEffect(() => {
        if (focusRequest > 0) {
          inputRef.current?.focus();
        }
      }, [focusRequest]);

      return (
        <>
          <input ref={inputRef} aria-label="Chat composer" />
          <TimelineSelectionMenu
            selection={selection}
            onAddToChat={() => setFocusRequest((request) => request + 1)}
            onDismiss={() => setSelection(null)}
          />
        </>
      );
    }

    render(<ComposerFocusHandoff />);
    const action = screen.getByRole("button", { name: "Add to chat" });
    let focusedWhenGestureEnded: Element | null = null;
    const recordFocus = () => {
      focusedWhenGestureEnded = document.activeElement;
    };
    document.addEventListener("pointerup", recordFocus);
    fireEvent.pointerDown(action, { pointerType: "touch" });
    fireEvent.pointerUp(action, { pointerType: "touch" });
    document.removeEventListener("pointerup", recordFocus);

    expect(focusedWhenGestureEnded).toBe(
      screen.getByRole("textbox", { name: "Chat composer" }),
    );
  });
});
