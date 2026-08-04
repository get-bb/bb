// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, vi } from "vitest";
import { describe, expect, it } from "vitest";
import {
  SecondaryPanelTabStrip,
  getTabStripChevronEdgeClass,
  getTabStripChevronVisibilityClass,
  SECONDARY_PANEL_TAB_STRIP_FADE_TONE,
} from "./SecondaryPanelTabStrip";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("secondary panel tab-strip edge fades", () => {
  it("uses one opaque themed edge fade and no second caret gradient", () => {
    expect(SECONDARY_PANEL_TAB_STRIP_FADE_TONE).toBe("sidebar");
    expect(getTabStripChevronEdgeClass("left")).toBe(
      "left-0 justify-start",
    );
    expect(getTabStripChevronEdgeClass("right")).toBe(
      "right-0 justify-end",
    );
  });

  it("keeps an available scroll control visible without requiring hover", () => {
    const visibleClass = getTabStripChevronVisibilityClass(true);

    expect(visibleClass).toContain("pointer-events-auto");
    expect(visibleClass).toContain("opacity-100");
    expect(visibleClass).not.toContain("hover:");
    expect(getTabStripChevronVisibilityClass(false)).toBe(
      "pointer-events-none opacity-0",
    );
  });

  it("observes the intrinsic tab row so async title changes refresh overflow", () => {
    const observed: Element[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(element: Element) {
          observed.push(element);
        }
        disconnect() {}
      },
    );

    const { container } = render(
      createElement(SecondaryPanelTabStrip, {
        fileTabs: [
          {
            id: "browser",
            filename: "Browser",
            isActive: true,
            isPinned: false,
            leadingVisual: null,
            statusLabel: null,
            onSelect: vi.fn(),
            onClose: vi.fn(),
          },
        ],
        onReorderTab: vi.fn(),
        usesDesktopChrome: false,
      }),
    );

    const viewport = container.querySelector(".no-scrollbar");
    const content = container.querySelector(
      "[data-secondary-panel-tab-content]",
    );
    expect(content).not.toBeNull();
    expect(observed).toContain(viewport);
    expect(observed).toContain(content);
  });
});
