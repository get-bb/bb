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

  it("reveals a selectable neighbor only when the remaining width is usable", () => {
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
    let viewportWidth = 240;
    let selectedWidth = 80;
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
      () => viewportWidth,
    );
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
      () => selectedWidth,
    );
    const tabs = createTabs();
    render(
      <MobilePanelTabPager
        activeTabId="Info"
        tabs={tabs}
        newTabControl={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "README.md" }));
    expect(tabs[1].onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "package.json" })).toBeNull();

    selectedWidth = 180;
    act(() => resize());
    expect(screen.queryByRole("button", { name: "README.md" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Info" }).getAttribute("aria-pressed"),
    ).toBe("true");

    viewportWidth = 320;
    act(() => resize());
    expect(
      screen
        .getByRole("button", { name: "README.md" })
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
