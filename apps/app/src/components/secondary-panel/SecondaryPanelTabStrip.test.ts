// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  SecondaryPanelTabStrip,
  secondaryPanelTabsToClose,
  type SecondaryPanelTabStripProps,
} from "./SecondaryPanelTabStrip";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderStrip(
  overrides: Partial<Parameters<typeof SecondaryPanelTabStrip>[0]> = {},
) {
  return render(
    createElement(
      TooltipProvider,
      null,
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
            tab: { id: "browser", kind: "new-tab" as const },
          },
        ],
        onReorderTab: vi.fn(),
        usesDesktopChrome: false,
        isPanelOpen: true,
        ...overrides,
      }),
    ),
  );
}

describe("SecondaryPanelTabStrip", () => {
  it("renders tabs as a vertical, scrollable icon column", () => {
    const { container } = renderStrip();
    const strip = container.querySelector(
      '[data-testid="secondary-panel-tab-strip"]',
    );
    expect(strip).not.toBeNull();
    expect(strip?.className).toContain("flex-col");
    expect(strip?.className).toContain("overflow-y-auto");
  });

  it("selects a tab when its icon is clicked", () => {
    const onSelect = vi.fn();
    const { getByRole } = renderStrip({
      tabs: [
        {
          label: "Browser",
          isPinned: false,
          leadingVisual: null,
          statusLabel: null,
          onSelect,
          onClose: vi.fn(),
          renderContent: () => null,
          tab: { id: "browser", kind: "new-tab" as const },
        },
      ],
    });
    fireEvent.click(getByRole("button", { name: "Browser" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("closes a non-pinned tab via its close affordance", () => {
    const onClose = vi.fn();
    const { getByRole } = renderStrip({
      tabs: [
        {
          label: "Browser",
          isPinned: false,
          leadingVisual: null,
          statusLabel: null,
          onSelect: vi.fn(),
          onClose,
          renderContent: () => null,
          tab: { id: "browser", kind: "new-tab" as const },
        },
      ],
    });
    fireEvent.click(getByRole("button", { name: "Close Browser" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders a color swatch indicator when the tab has a colorTag", () => {
    const { container } = renderStrip({
      tabs: [
        {
          label: "Terminal",
          isPinned: false,
          leadingVisual: null,
          colorTag: "blue",
          statusLabel: null,
          onSelect: vi.fn(),
          onClose: vi.fn(),
          renderContent: () => null,
          tab: {
            colorTag: "blue",
            id: "terminal",
            kind: "terminal" as const,
            terminalId: "terminal",
          },
        },
      ],
    });
    expect(container.querySelector(".bg-timeline-accent")).not.toBeNull();
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
  renderStrip({ activeTabId: "tab-3", tabs });
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
