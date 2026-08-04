// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, vi } from "vitest";
import { describe, expect, it } from "vitest";
import {
  SecondaryPanelTabStrip,
  SECONDARY_PANEL_TAB_STRIP_FADE_TONE,
} from "./SecondaryPanelTabStrip";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("secondary panel tab-strip edge fades", () => {
  it("uses the themed edge fade without overlay scroll controls", () => {
    expect(SECONDARY_PANEL_TAB_STRIP_FADE_TONE).toBe("sidebar");
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
    expect(container.querySelectorAll("[data-overflow-fade]")).toHaveLength(2);
    expect(
      container
        .querySelector("[data-overflow-fade='left']")
        ?.classList.contains("w-6"),
    ).toBe(true);
    expect(
      container.querySelector('[aria-label="Scroll tabs left"]'),
    ).toBeNull();
    expect(
      container.querySelector('[aria-label="Scroll tabs right"]'),
    ).toBeNull();
  });
});
