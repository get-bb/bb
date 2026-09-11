// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  PaneContext,
  type PaneContextValue,
} from "@/views/thread-detail/PaneContext";
import { beginSplitDrag, decideThreadDrop } from "@/lib/split-drag";
import { SecondaryPanelLayout } from "./SecondaryPanelLayout";

const noop = () => {};
const context: PaneContextValue = {
  paneId: "pane-test",
  isFocused: true,
  isSplitPane: false,
  secondaryPanelHost: null,
  reservesWindowPanelToggle: false,
  onRequestClose: null,
  isMaximized: false,
  onToggleMaximize: null,
  isBoundedPane: false,
  isTopRow: true,
  ownsWindowTopLeft: true,
  navigateInPane: noop,
};

afterEach(() => {
  fireEvent(window, new Event("pointercancel"));
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "resolves a single chat's center with panel open=%s",
  (open) => {
    render(
      <main data-testid="workspace">
        <PaneContext.Provider value={context}>
          <CompactViewportOverrideProvider isCompactViewport={false}>
            <SecondaryPanelLayout
              open={open}
              onToggle={noop}
              onClose={noop}
              resetKey="test"
              contentKey="test"
              drawerLabel="Details"
              drawerFallback={null}
              mainPanelId="chat"
              main={<div data-testid="chat">Chat</div>}
              renderPanel={() => <div data-testid="details">Details</div>}
              composerHost={null}
              compactPresentation="shelf"
            />
          </CompactViewportOverrideProvider>
        </PaneContext.Provider>
      </main>,
    );
    const workspace = screen.getByTestId("workspace");
    const chat = screen.getByTestId("chat");
    const width = open ? 500 : 1000;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return new DOMRect(200, 0, this === workspace ? 1000 : width, 600);
      },
    );
    const originalHitTest = Object.getOwnPropertyDescriptor(
      document,
      "elementsFromPoint",
    );
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: () => [chat],
    });
    const onDrop = vi.fn();
    beginSplitDrag({
      ghostLabel: "Another thread",
      fallback: { paneId: context.paneId, container: workspace },
      shouldEngage: () => true,
      decide: (_paneId, zone) =>
        decideThreadDrop({ zone, threadAlreadyOpen: false, atMaxPanes: false }),
      onDrop,
    });
    try {
      fireEvent(
        window,
        new MouseEvent("pointermove", {
          clientX: 200 + width / 2,
          clientY: 300,
        }),
      );
      expect(
        document.querySelector("[data-split-drag-label]")?.textContent,
      ).toBe("Replace this chat");
      fireEvent(window, new Event("pointerup"));
      expect(onDrop).toHaveBeenCalledWith({
        paneId: context.paneId,
        zone: "center",
      });
      const target = chat.closest("[data-split-pane-id]");
      expect(target?.contains(screen.getByTestId("details"))).toBe(false);
    } finally {
      if (originalHitTest)
        Object.defineProperty(document, "elementsFromPoint", originalHitTest);
      else Reflect.deleteProperty(document, "elementsFromPoint");
    }
  },
);
