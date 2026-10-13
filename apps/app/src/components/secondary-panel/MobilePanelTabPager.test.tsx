// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobilePanelTabPager } from "./MobilePanelTabPager";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function createTabs(labels = ["README.md", "package.json", "AGENTS.md"]) {
  return labels.map((label) => ({
    id: label,
    label,
    ariaLabel: label,
    leadingVisual: null,
    onSelect: vi.fn(),
    onClose: vi.fn(),
  }));
}

function createFixedTabs() {
  return ["Info", "Diff"].map((label) => ({
    id: label,
    label,
    ariaLabel: label,
    leadingVisual: null,
    onSelect: vi.fn(),
  }));
}

describe("MobilePanelTabPager", () => {
  it("shows the fixed buttons and one content tab while navigating a narrow header", () => {
    const tabs = createTabs();
    const { rerender } = render(
      <MobilePanelTabPager
        activeTabId="package.json"
        fixedTabs={createFixedTabs()}
        tabs={tabs}
        newTabControl={<button>Add tab</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Info" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Diff" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "README.md" })).toBeNull();
    expect(screen.queryByRole("button", { name: "AGENTS.md" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next tab" }));
    expect(tabs[2].onSelect).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Previous tab" }));
    expect(tabs[0].onSelect).toHaveBeenCalledOnce();
    rerender(
      <MobilePanelTabPager
        activeTabId="README.md"
        fixedTabs={createFixedTabs()}
        tabs={tabs}
        newTabControl={null}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "Previous tab" })
        .hasAttribute("disabled"),
    ).toBe(true);
    rerender(
      <MobilePanelTabPager
        activeTabId="AGENTS.md"
        fixedTabs={createFixedTabs()}
        tabs={tabs}
        newTabControl={null}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Next tab" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("uses wider headers for neighboring tabs and keeps selection visible through resize and removal", () => {
    let width = 460;
    let measure = () => {};
    const disconnect = vi.fn();
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
      () => width + 108,
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const label = this.querySelector("button[aria-pressed]")?.getAttribute(
          "aria-label",
        );
        const widths: Record<string, number> = {
          "README.md": 109,
          "package.json": 114,
          "AGENTS.md": 108,
          "MobilePanelTabPager.tsx": 144,
          "ThreadSecondaryPanel.tsx": 144,
        };
        return DOMRect.fromRect({
          width: this.hasAttribute("data-panel-tab-measure")
            ? widths[label ?? ""]
            : 32,
          height: 32,
        });
      },
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          measure = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const tabs = createTabs([
      "README.md",
      "package.json",
      "AGENTS.md",
      "MobilePanelTabPager.tsx",
      "ThreadSecondaryPanel.tsx",
    ]);
    const panel = (activeTabId: string, currentTabs = tabs) => (
      <MobilePanelTabPager
        activeTabId={activeTabId}
        fixedTabs={createFixedTabs()}
        tabs={currentTabs}
        newTabControl={<button>Add tab</button>}
      />
    );
    const { rerender, unmount } = render(panel("package.json"));
    for (const tab of tabs.slice(1, 4)) {
      expect(screen.getByRole("button", { name: tab.label })).toBeDefined();
    }
    expect(screen.queryByRole("button", { name: "README.md" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next tab" }));
    expect(tabs[2].onSelect).toHaveBeenCalledOnce();
    expect(tabs[4].onSelect).not.toHaveBeenCalled();

    rerender(panel("ThreadSecondaryPanel.tsx"));
    expect(screen.queryByRole("button", { name: "package.json" })).toBeNull();
    expect(screen.getByRole("button", { name: "AGENTS.md" })).toBeDefined();
    act(() => {
      width = 180;
      measure();
    });
    expect(screen.queryByRole("button", { name: "AGENTS.md" })).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "ThreadSecondaryPanel.tsx" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    act(() => {
      width = 310;
      measure();
    });
    expect(
      screen.getByRole("button", { name: "MobilePanelTabPager.tsx" }),
    ).toBeDefined();
    rerender(panel("MobilePanelTabPager.tsx", tabs.slice(0, 4)));
    expect(screen.getByRole("button", { name: "AGENTS.md" })).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "ThreadSecondaryPanel.tsx" }),
    ).toBeNull();
    const disconnects = disconnect.mock.calls.length;
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(disconnects + 1);
  });

  it("keeps the last content tab available while Info or Diff is selected", () => {
    const tabs = createTabs();
    const fixedTabs = createFixedTabs();
    const { rerender } = render(
      <MobilePanelTabPager
        activeTabId="package.json"
        fixedTabs={fixedTabs}
        tabs={tabs}
        newTabControl={null}
      />,
    );
    for (const fixedTab of fixedTabs) {
      fireEvent.click(screen.getByRole("button", { name: fixedTab.label }));
      expect(fixedTab.onSelect).toHaveBeenCalledOnce();
      rerender(
        <MobilePanelTabPager
          activeTabId={fixedTab.id}
          fixedTabs={fixedTabs}
          tabs={tabs}
          newTabControl={null}
        />,
      );
      expect(screen.getByText(fixedTab.label).className).toContain("sr-only");
      expect(
        screen
          .getByRole("button", { name: fixedTab.label })
          .getAttribute("aria-pressed"),
      ).toBe("true");
      const contentTab = screen.getByRole("button", { name: "package.json" });
      expect(contentTab.getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(contentTab);
    }
    expect(tabs[1].onSelect).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Next tab" }));
    expect(tabs[2].onSelect).toHaveBeenCalledOnce();
    rerender(
      <MobilePanelTabPager
        activeTabId="Info"
        fixedTabs={fixedTabs}
        tabs={[tabs[0], tabs[2]]}
        newTabControl={null}
      />,
    );
    expect(screen.getByRole("button", { name: "README.md" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "package.json" })).toBeNull();
  });

  it("leaves fixed views and add available when there are no content tabs", () => {
    render(
      <MobilePanelTabPager
        activeTabId="Info"
        fixedTabs={createFixedTabs()}
        tabs={[]}
        newTabControl={<button>Add tab</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Info" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Diff" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Add tab" })).toBeDefined();
    for (const name of ["Previous tab", "Next tab"]) {
      expect(
        screen.getByRole("button", { name }).hasAttribute("disabled"),
      ).toBe(true);
    }
  });

  it("advances once for a horizontal swipe and suppresses the resulting close click", () => {
    const tabs = createTabs();
    render(
      <MobilePanelTabPager
        activeTabId="package.json"
        fixedTabs={createFixedTabs()}
        tabs={tabs}
        newTabControl={null}
      />,
    );
    const close = screen.getByRole("button", { name: "Close package.json" });
    fireEvent.touchStart(close, { touches: [{ clientX: 160, clientY: 20 }] });
    fireEvent.touchEnd(close, {
      changedTouches: [{ clientX: 80, clientY: 25 }],
    });
    fireEvent.click(close);
    expect(tabs[2].onSelect).toHaveBeenCalledOnce();
    expect(tabs[1].onClose).not.toHaveBeenCalled();
    fireEvent.touchStart(close, { touches: [{ clientX: 80, clientY: 20 }] });
    fireEvent.touchEnd(close, {
      changedTouches: [{ clientX: 80, clientY: 20 }],
    });
    fireEvent.click(close);
    expect(tabs[1].onClose).toHaveBeenCalledOnce();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    fireEvent.touchStart(close, { touches: [{ clientX: 160, clientY: 20 }] });
    fireEvent.touchEnd(close, {
      changedTouches: [{ clientX: 80, clientY: 25 }],
    });
    clock.mockReturnValue(now + 501);
    fireEvent.click(close);
    expect(tabs[1].onClose).toHaveBeenCalledTimes(2);
  });

  it("ignores vertical drags and short movements", () => {
    const tabs = createTabs();
    render(
      <MobilePanelTabPager
        activeTabId="package.json"
        fixedTabs={createFixedTabs()}
        tabs={tabs}
        newTabControl={null}
      />,
    );
    const tab = screen.getByRole("button", { name: "package.json" });
    for (const end of [
      { clientX: 140, clientY: 22 },
      { clientX: 120, clientY: 120 },
    ]) {
      fireEvent.touchStart(tab, { touches: [{ clientX: 160, clientY: 20 }] });
      fireEvent.touchEnd(tab, { changedTouches: [end] });
    }
    expect(tabs[0].onSelect).not.toHaveBeenCalled();
    expect(tabs[2].onSelect).not.toHaveBeenCalled();
  });
});
