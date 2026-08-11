// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
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
  it("uses the themed edge fade", () => {
    expect(SECONDARY_PANEL_TAB_STRIP_FADE_TONE).toBe("sidebar");
  });

  it("observes the intrinsic tab row so async title changes refresh overflow", () => {
    const observed: Element[] = [];
    let resizeCallback: ResizeObserverCallback | undefined;
    let animationFrameCallback: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      animationFrameCallback = callback;
      return 1;
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }
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
    expect(resizeCallback).toBeDefined();
    expect(container.querySelectorAll("[data-overflow-fade]")).toHaveLength(2);
    expect(
      container
        .querySelector("[data-overflow-fade='left']")
        ?.classList.contains("w-6"),
    ).toBe(true);
    expect(
      container.querySelector('[aria-label="Scroll tabs left"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Scroll tabs right"]'),
    ).not.toBeNull();

    const rightFade = container.querySelector("[data-overflow-fade='right']");
    expect(rightFade?.classList.contains("opacity-0")).toBe(true);
    Object.defineProperties(viewport!, {
      clientWidth: { configurable: true, value: 120 },
      scrollWidth: { configurable: true, value: 240 },
      scrollLeft: { configurable: true, value: 0, writable: true },
    });
    act(() => {
      resizeCallback?.([], {} as ResizeObserver);
    });
    expect(rightFade?.classList.contains("opacity-100")).toBe(true);

    const leftButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Scroll tabs left"]',
    );
    const rightButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Scroll tabs right"]',
    );
    expect(leftButton?.classList.contains("opacity-0")).toBe(true);
    expect(leftButton?.tabIndex).toBe(-1);
    expect(rightButton?.classList.contains("opacity-100")).toBe(true);
    expect(rightButton?.tabIndex).toBe(0);
    expect(rightButton?.classList.contains("bg-sidebar")).toBe(true);
    expect(
      rightButton?.classList.contains("hover:bg-surface-raised-solid"),
    ).toBe(true);
    expect(rightButton?.classList.contains("hover:bg-state-hover")).toBe(false);

    const scrollBy = vi.fn();
    Object.defineProperty(viewport!, "scrollBy", {
      configurable: true,
      value: scrollBy,
    });
    fireEvent.click(rightButton!);
    expect(scrollBy).toHaveBeenCalledWith({ left: 140, behavior: "smooth" });

    rightButton?.focus();
    expect(document.activeElement).toBe(rightButton);
    viewport!.scrollLeft = 120;
    fireEvent.scroll(viewport!);
    act(() => animationFrameCallback?.(0));
    expect(rightButton?.getAttribute("aria-hidden")).toBe("true");
    expect(leftButton?.getAttribute("aria-hidden")).toBe("false");
    expect(document.activeElement).toBe(leftButton);
  });
});
