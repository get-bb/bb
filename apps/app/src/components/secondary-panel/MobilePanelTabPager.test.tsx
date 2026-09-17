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

function createTabs() {
  return ["Info", "README.md", "package.json"].map((label) => ({
    id: label,
    label,
    ariaLabel: label,
    iconOnly: label === "Info",
    leadingVisual: null,
    onSelect: vi.fn(),
    onClose: label === "Info" ? null : vi.fn(),
  }));
}

describe("MobilePanelTabPager", () => {
  it("keeps the selected tab in a narrow viewport and selects adjacent tabs from the arrows", () => {
    const tabs = createTabs();
    const { rerender } = render(
      <MobilePanelTabPager
        activeTabId="README.md"
        tabs={tabs}
        newTabControl={<button>Add tab</button>}
      />,
    );
    expect(screen.queryByRole("button", { name: "Info" })).toBeNull();
    expect(screen.queryByRole("button", { name: "package.json" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next tab" }));
    expect(tabs[2].onSelect).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Previous tab" }));
    expect(tabs[0].onSelect).toHaveBeenCalledOnce();
    rerender(
      <MobilePanelTabPager
        activeTabId="Info"
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
        activeTabId="package.json"
        tabs={tabs}
        newTabControl={null}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Next tab" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("fills space after compact tabs and hides neighbors that cannot fit a useful label", () => {
    let resize = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    let viewportWidth = 160;
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
      () => viewportWidth,
    );
    const naturalWidths = new Map([
      ["Info", 36],
      ["Diff", 36],
      ["README.md", 132],
      ["package.json", 140],
    ]);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        return naturalWidths.get(this.getAttribute("aria-label") ?? "") ?? 0;
      },
    );
    const tabs = createTabs();
    tabs.splice(1, 0, {
      ...tabs[0],
      id: "Diff",
      label: "Diff",
      ariaLabel: "Diff",
      onSelect: vi.fn(),
    });
    render(
      <MobilePanelTabPager
        activeTabId="Info"
        tabs={tabs}
        newTabControl={null}
      />,
    );
    expect(screen.getByText("Info").className).toContain("sr-only");
    expect(screen.getByText("Diff").className).toContain("sr-only");
    fireEvent.click(screen.getByRole("button", { name: "README.md" }));
    expect(tabs[2].onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "package.json" })).toBeNull();

    viewportWidth = 120;
    act(() => resize());
    expect(screen.queryByRole("button", { name: "README.md" })).toBeNull();
    expect(screen.getByRole("button", { name: "Diff" })).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Info" }).getAttribute("aria-pressed"),
    ).toBe("true");

    viewportWidth = 320;
    act(() => resize());
    expect(
      screen
        .getByRole("button", { name: "package.json" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("advances once for a horizontal swipe and suppresses the resulting close click", () => {
    const tabs = createTabs();
    render(
      <MobilePanelTabPager
        activeTabId="README.md"
        tabs={tabs}
        newTabControl={null}
      />,
    );
    const close = screen.getByRole("button", { name: "Close README.md" });
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
        activeTabId="README.md"
        tabs={tabs}
        newTabControl={null}
      />,
    );
    const tab = screen.getByRole("button", { name: "README.md" });
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
