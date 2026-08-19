// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SecondaryPanelTabStrip,
  type SecondaryPanelTabStripProps,
} from "./SecondaryPanelTabStrip";

function makeTabs(count: number): SecondaryPanelTabStripProps["fileTabs"] {
  return Array.from({ length: count }, (_, index) => ({
    id: `tab-${index}`,
    filename: `file-${index}.ts`,
    isActive: index === 0,
    isPinned: false,
    leadingVisual: null,
    statusLabel: null,
    onSelect: vi.fn(),
    onClose: vi.fn(),
  }));
}

function touchMoveCalls(spy: {
  mock: { calls: readonly (readonly unknown[])[] };
}) {
  return spy.mock.calls.filter(([type]) => type === "touchmove");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SecondaryPanelTabStrip touch sensor scoping", () => {
  it("installs dnd-kit's window touchmove listener only while the panel is open with tabs to reorder, and removes it on close", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const baseProps: SecondaryPanelTabStripProps = {
      fileTabs: makeTabs(2),
      onReorderTab: vi.fn(),
      usesDesktopChrome: false,
      isPanelOpen: false,
    };

    // Mounted inside a closed (retained) panel: no scroll-blocking listener.
    const { rerender } = render(<SecondaryPanelTabStrip {...baseProps} />);
    expect(touchMoveCalls(addSpy)).toHaveLength(0);

    // Opening the panel must actually run the sensor's setup. dnd-kit keys its
    // setup effect on the sensor classes, so this only works when the sensor
    // slot keeps its position and swaps class rather than disappearing.
    rerender(<SecondaryPanelTabStrip {...baseProps} isPanelOpen />);
    const installs = touchMoveCalls(addSpy);
    expect(installs).toHaveLength(1);
    expect(installs[0]?.[2]).toEqual({ capture: false, passive: false });

    // Closing tears it down again instead of leaving it on every page.
    rerender(<SecondaryPanelTabStrip {...baseProps} isPanelOpen={false} />);
    expect(touchMoveCalls(removeSpy)).toHaveLength(1);
    expect(touchMoveCalls(addSpy)).toHaveLength(1);

    // A single tab has nothing to reorder even in an open panel.
    rerender(
      <SecondaryPanelTabStrip
        {...baseProps}
        fileTabs={makeTabs(1)}
        isPanelOpen
      />,
    );
    expect(touchMoveCalls(addSpy)).toHaveLength(1);
  });
});
