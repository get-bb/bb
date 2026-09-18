// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, vi } from "vitest";
import { describe, expect, it } from "vitest";
import {
  SecondaryPanelTabStrip,
  secondaryPanelTabsToClose,
  type SecondaryPanelTabStripProps,
} from "./SecondaryPanelTabStrip";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("secondary panel tab strip", () => {
  it("keeps the desktop tab viewport outside the window drag region", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const tabStrip = (usesDesktopChrome: boolean) =>
      createElement(SecondaryPanelTabStrip, {
        activeTabId: null,
        tabs: [],
        onReorderTab: vi.fn(),
        usesDesktopChrome,
        isPanelOpen: true,
      });
    const view = render(tabStrip(true));
    const viewport = view.container.querySelector(".no-scrollbar");
    expect(viewport?.className).toContain("[app-region:no-drag]");
    expect(viewport?.className).toContain("[-webkit-app-region:no-drag]");

    view.rerender(tabStrip(false));
    expect(
      view.container.querySelector(".no-scrollbar")?.className,
    ).not.toContain("app-region");
  });

  it("reveals Info when switching back from a document tab", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const reveal = vi.spyOn(Element.prototype, "scrollIntoView");
    try {
      const fixture = (activeTabId: string) =>
        createElement(SecondaryPanelTabStrip, {
          activeTabId,
          tabs: makeCloseMenuTabs(),
          leadingTabs: createElement(
            "div",
            null,
            createElement(
              "button",
              { "aria-pressed": activeTabId === "info" },
              "Info",
            ),
          ),
          onReorderTab: vi.fn(),
          usesDesktopChrome: false,
          isPanelOpen: true,
        });
      const view = render(fixture("tab-0"));
      reveal.mockClear();
      view.rerender(fixture("info"));
      expect(reveal.mock.instances.at(-1)).toBe(
        screen.getByRole("button", { name: "Info" }).parentElement,
      );
    } finally {
      reveal.mockRestore();
    }
  });

  it("enlarges coarse-pointer close targets only for file previews", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const { getByRole } = render(
      createElement(SecondaryPanelTabStrip, {
        activeTabId: "file-preview",
        tabs: [
          {
            label: "preview.html",
            isPinned: false,
            leadingVisual: null,
            statusLabel: null,
            onSelect: vi.fn(),
            onClose: vi.fn(),
            renderContent: () => null,
            tab: {
              environmentId: null,
              hostId: null,
              id: "file-preview",
              kind: "host-file-preview" as const,
              lineRange: null,
              path: "preview.html",
              threadId: null,
            },
          },
          {
            label: "Browser",
            isPinned: false,
            leadingVisual: null,
            statusLabel: null,
            onSelect: vi.fn(),
            onClose: vi.fn(),
            renderContent: () => null,
            tab: { id: "browser", kind: "new-tab" as const },
          },
        ],
        onReorderTab: vi.fn(),
        usesDesktopChrome: false,
        isPanelOpen: true,
      }),
    );

    expect(
      getByRole("button", { name: "Close preview.html" }).classList.contains(
        "max-md:pointer-coarse:min-h-9",
      ),
    ).toBe(true);
    expect(
      getByRole("button", { name: "Close Browser" }).classList.contains(
        "max-md:pointer-coarse:min-h-9",
      ),
    ).toBe(false);
  });

  it("keeps partially visible neighbors selectable and reveals selection on resize", () => {
    let measure = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          measure = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const tabModels = makeCloseMenuTabs();
    const { container } = render(
      createElement(SecondaryPanelTabStrip, {
        activeTabId: "tab-0",
        tabs: tabModels,
        onReorderTab: vi.fn(),
        usesDesktopChrome: false,
        isPanelOpen: true,
      }),
    );
    const viewport = container.querySelector<HTMLElement>(".no-scrollbar")!;
    const content = container.querySelector<HTMLElement>(
      "[data-secondary-panel-tab-content]",
    )!;
    const strip = container.querySelector<HTMLElement>(
      '[data-testid="secondary-panel-tab-strip"]',
    )!;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 180 },
      scrollWidth: { configurable: true, value: 452 },
    });
    Object.defineProperty(content, "scrollWidth", {
      configurable: true,
      value: 452,
    });
    Object.defineProperty(strip, "clientWidth", {
      configurable: true,
      value: 180,
    });
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ width: 180 }),
    );
    const tabs = Array.from(
      content.querySelectorAll<HTMLElement>("[data-secondary-panel-tab]"),
    );
    tabs.forEach((tab, index) => {
      vi.spyOn(tab, "getBoundingClientRect").mockImplementation(() =>
        DOMRect.fromRect({ x: index * 114 - viewport.scrollLeft, width: 110 }),
      );
    });
    act(() => measure());
    expect(screen.getByRole("button", { name: "file-0.ts" })).toBeDefined();
    const neighbor = screen.getByRole("button", { name: "file-1.ts" });
    expect(tabs[1].inert).not.toBe(true);
    fireEvent.click(neighbor);
    expect(tabModels[1].onSelect).toHaveBeenCalledOnce();
    viewport.scrollLeft = 58;
    act(() => measure());
    expect(screen.getByRole("button", { name: "file-0.ts" })).toBeDefined();
    expect(screen.getByRole("button", { name: "file-1.ts" })).toBeDefined();
    expect(tabs[0].inert).not.toBe(true);
    expect(tabs[1].inert).not.toBe(true);
    const selected = tabs[0].querySelector(
      'button[aria-pressed="true"]',
    )!.parentElement!;
    const reveal = vi
      .spyOn(selected, "scrollIntoView")
      .mockImplementation(() => {
        viewport.scrollLeft = 0;
      });
    Object.defineProperty(strip, "clientWidth", {
      configurable: true,
      value: 200,
    });
    act(() => measure());
    expect(reveal).toHaveBeenCalledOnce();
    expect(viewport.scrollLeft).toBe(0);
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
        activeTabId: "browser",
        tabs: [
          {
            label: "Browser",
            isPinned: false,
            leadingVisual: null,
            statusLabel: null,
            onSelect: vi.fn(),
            onClose: vi.fn(),
            renderContent: () => null,
            tab: { id: "browser", kind: "new-tab" },
          },
        ],
        onReorderTab: vi.fn(),
        usesDesktopChrome: false,
        isPanelOpen: true,
      }),
    );

    const viewport = container.querySelector(".no-scrollbar");
    const content = container.querySelector(
      "[data-secondary-panel-tab-content]",
    );
    const strip = container.querySelector(
      '[data-testid="secondary-panel-tab-strip"]',
    );
    expect(content).not.toBeNull();
    expect(strip).not.toBeNull();
    expect(observed).toContain(strip);
    expect(observed).toContain(viewport);
    expect(observed).toContain(content);
    expect(resizeCallback).toBeDefined();
    const leftButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Scroll tabs left"]',
    );
    const rightButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Scroll tabs right"]',
    );
    expect(leftButton?.classList.contains("w-0")).toBe(true);
    expect(rightButton?.classList.contains("w-0")).toBe(true);

    Object.defineProperties(viewport!, {
      clientWidth: { configurable: true, value: 120 },
      scrollWidth: { configurable: true, value: 240 },
      scrollLeft: { configurable: true, value: 0, writable: true },
    });
    Object.defineProperty(strip!, "clientWidth", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(content!, "scrollWidth", {
      configurable: true,
      value: 240,
    });
    act(() => {
      resizeCallback?.([], {} as ResizeObserver);
    });

    const scrollRegion = container.querySelector(
      "[data-secondary-panel-tab-scroll-region]",
    );
    expect(strip?.children[0]).toBe(leftButton);
    expect(strip?.children[1]).toBe(scrollRegion);
    expect(strip?.children[2]).toBe(rightButton?.parentElement);
    expect(leftButton?.classList.contains("absolute")).toBe(false);
    expect(rightButton?.classList.contains("absolute")).toBe(false);
    expect(leftButton?.classList.contains("w-0")).toBe(true);
    expect(rightButton?.classList.contains("size-8")).toBe(true);
    expect(leftButton?.classList.contains("mr-1")).toBe(false);
    expect(rightButton?.classList.contains("ml-1")).toBe(true);
    expect(leftButton?.classList.contains("opacity-0")).toBe(true);
    expect(leftButton?.tabIndex).toBe(-1);
    expect(rightButton?.classList.contains("opacity-100")).toBe(true);
    expect(rightButton?.tabIndex).toBe(0);
    expect(rightButton?.classList.contains("bg-sidebar")).toBe(true);
    expect(
      rightButton?.classList.contains("hover:bg-surface-raised-solid"),
    ).toBe(true);
    expect(rightButton?.classList.contains("hover:bg-state-hover")).toBe(false);

    const nextTab = content!.querySelector<HTMLElement>(
      "[data-secondary-panel-tab]",
    )!;
    vi.spyOn(nextTab, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 144, width: 100 }),
    );
    const revealNext = vi.spyOn(nextTab, "scrollIntoView");
    fireEvent.click(rightButton!);
    expect(revealNext).toHaveBeenCalledWith({
      inline: "start",
      block: "nearest",
      behavior: "smooth",
    });
    vi.mocked(nextTab.getBoundingClientRect).mockRestore();

    rightButton?.focus();
    expect(document.activeElement).toBe(rightButton);
    viewport!.scrollLeft = 120;
    fireEvent.scroll(viewport!);
    act(() => animationFrameCallback?.(0));
    expect(rightButton?.classList.contains("w-0")).toBe(true);
    expect(leftButton?.classList.contains("size-8")).toBe(true);
    expect(rightButton?.getAttribute("aria-hidden")).toBe("true");
    expect(leftButton?.getAttribute("aria-hidden")).toBe("false");
    expect(document.activeElement).toBe(leftButton);

    Object.defineProperty(content!, "scrollWidth", {
      configurable: true,
      value: 100,
    });
    act(() => {
      resizeCallback?.([], {} as ResizeObserver);
    });
    expect(leftButton?.classList.contains("w-0")).toBe(true);
    expect(rightButton?.classList.contains("w-0")).toBe(true);
    expect(document.activeElement).toBe(
      container.querySelector('button[aria-pressed="true"]'),
    );
  });
});

function makeCloseMenuTabs(
  pinnedIndexes: readonly number[] = [],
): SecondaryPanelTabStripProps["tabs"] {
  return Array.from({ length: 4 }, (_, index) => ({
    label: `file-${index}.ts`,
    isPinned: pinnedIndexes.includes(index),
    leadingVisual: null,
    statusLabel: null,
    onSelect: vi.fn(),
    onClose: vi.fn(),
    renderContent: () => null,
    tab: { id: `tab-${index}`, kind: "new-tab" as const },
  }));
}

function closeCounts(tabs: SecondaryPanelTabStripProps["tabs"]) {
  return tabs.map((tab) => vi.mocked(tab.onClose).mock.calls.length);
}

function renderCloseMenuStrip(tabs: SecondaryPanelTabStripProps["tabs"]) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  render(
    createElement(SecondaryPanelTabStrip, {
      activeTabId: "tab-3",
      tabs,
      onReorderTab: vi.fn(),
      usesDesktopChrome: false,
      isPanelOpen: true,
    }),
  );
}

describe("secondary panel tab close menu", () => {
  it("selects other tabs and tabs to the right, skipping pinned tabs", () => {
    const tabs = makeCloseMenuTabs([0, 3]);
    const closeIds = (tabId: string, scope: "self" | "others" | "right") =>
      secondaryPanelTabsToClose(tabs, tabId, scope).map((tab) => tab.tab.id);
    expect(closeIds("tab-1", "others")).toEqual(["tab-2"]);
    expect(closeIds("tab-1", "right")).toEqual(["tab-2"]);
    expect(closeIds("tab-0", "self")).toEqual([]);
    expect(closeIds("missing", "others")).toEqual([]);
  });

  it("keeps the app accessible while the tab menu is open", () => {
    renderCloseMenuStrip(makeCloseMenuTabs());

    fireEvent.contextMenu(screen.getByRole("button", { name: "file-2.ts" }));

    expect(screen.getByRole("menuitem", { name: "Close tab" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "file-1.ts" })).toBeTruthy();
    expect(document.body.style.pointerEvents).not.toBe("none");
  });

  it("closes the right-clicked tab", () => {
    const tabs = makeCloseMenuTabs();
    renderCloseMenuStrip(tabs);

    fireEvent.contextMenu(screen.getByRole("button", { name: "file-2.ts" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Close tab" }));

    expect(closeCounts(tabs)).toEqual([0, 0, 1, 0]);
  });

  it("closes tabs to the right and selects the clicked tab when the active tab closes", () => {
    const tabs = makeCloseMenuTabs();
    renderCloseMenuStrip(tabs);

    fireEvent.contextMenu(screen.getByRole("button", { name: "file-1.ts" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Close tabs to the right" }),
    );

    expect(tabs[1]?.onSelect).toHaveBeenCalledTimes(1);
    expect(closeCounts(tabs)).toEqual([0, 0, 1, 1]);
  });

  it("closes other tabs and disables close-to-the-right on the last tab", () => {
    const tabs = makeCloseMenuTabs();
    renderCloseMenuStrip(tabs);

    fireEvent.contextMenu(screen.getByRole("button", { name: "file-3.ts" }));
    expect(
      screen
        .getByRole("menuitem", { name: "Close tabs to the right" })
        .getAttribute("data-disabled"),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Close other tabs" }));

    expect(tabs[3]?.onSelect).not.toHaveBeenCalled();
    expect(closeCounts(tabs)).toEqual([1, 1, 1, 0]);
  });
});
