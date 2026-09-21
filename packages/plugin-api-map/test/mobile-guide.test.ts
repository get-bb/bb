/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { ProductMap } from "../src/product-map";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("pages mobile panes without using annotation selection as navigation", () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const scrollIntoView = HTMLElement.prototype.scrollIntoView;
  const scroll = vi.fn();
  const navigate = vi.fn();
  HTMLElement.prototype.scrollIntoView = scroll;
  try {
    act(() => root.render(createElement(ProductMap, { onSlideChange: navigate })));
    const current = () => container.querySelector("[data-map-section]:not([inert])")!;
    const visiblePage = () => {
      const buttons = container.querySelectorAll(
        "[data-guide-page-list-scroll] li:not([hidden]) button",
      );
      expect(buttons).toHaveLength(1);
      return buttons[0]!.textContent;
    };
    const next = container.querySelector<HTMLButtonElement>('[aria-label="Next surface"]')!;
    const openAnnotation = (id: string) => act(() => {
      current().querySelector<HTMLAnchorElement>(`a[href="#surface-${id}"]`)!.click();
    });
    const nextAnnotation = () => act(() => {
      container.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label^="Next annotation:"]')!.click();
    });
    expect(container.querySelector('[aria-label="Explore an annotation"]')).toBeNull();
    expect(visiblePage()).toBe("Sidebar");
    expect(current().querySelector('[data-guide-mobile-scene="navigation"]')).not.toBeNull();
    openAnnotation("sidebar-navigation");
    act(() => vi.advanceTimersByTime(400));
    expect(scroll).toHaveBeenCalledTimes(1);
    nextAnnotation();
    act(() => vi.advanceTimersByTime(400));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(visiblePage()).toBe("Sidebar");
    expect(container.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Full-page panels");
    const examples = () => container.querySelector('[role="group"][aria-label="Example plugins"]')!;
    const previousExample = () => examples().querySelector<HTMLButtonElement>('[aria-label="Previous example plugin"]')!;
    const nextExample = () => examples().querySelector<HTMLButtonElement>('[aria-label="Next example plugin"]')!;
    expect(previousExample().disabled).toBe(true);
    for (const name of ["Automations", "Docs", "GitHub", "Tasks"]) {
      expect(examples().textContent).toContain(name);
      expect(examples().querySelectorAll('[aria-live="polite"] > span:not(.sr-only)')).toHaveLength(1);
      if (name !== "Tasks") act(() => nextExample().click());
    }
    expect(nextExample().disabled).toBe(true);
    act(() => previousExample().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(examples().textContent).toContain("GitHub");
    expect(visiblePage()).toBe("Sidebar");
    expect(navigate).not.toHaveBeenCalled();
    act(() => container.querySelector('[role="dialog"] button')!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    ));
    expect(navigate).not.toHaveBeenCalled();
    act(() => next.click());
    expect(visiblePage()).toBe("Thread");
    expect(current().querySelector('[data-guide-mobile-scene="conversation"]')).not.toBeNull();
    for (const id of ["timeline-renderers", "message-directives", "pending-interaction", "app-overlay"]) {
      expect(current().querySelector(`a[href="#surface-${id}"]`), id).not.toBeNull();
    }
    act(() => next.click());
    expect(visiblePage()).toBe("Side panel");
    expect(current().querySelector('[data-guide-mobile-scene="panel"]')).not.toBeNull();
    expect([...current().querySelectorAll("[data-guide-badge]")].map((badge) => badge.textContent)).toEqual(["7", "12", "13", "14"]);
    openAnnotation("browser-toolbar");
    for (const [id, number, title] of [
      ["browser-toolbar", "7", "Browser toolbar"],
      ["code-renderers", "12", "Code & diff renderers"],
      ["thread-panel", "13", "Thread side-panel tabs"],
      ["file-opener", "14", "File viewers & editors"],
    ]) {
      expect(current().querySelector(`[data-guide-tab-body="${id}"]`), title).not.toBeNull();
      expect(current().querySelector(`[data-guide-badge="${id}"]`)?.textContent).toBe(number);
      expect(visiblePage()).toBe("Side panel");
      if (id !== "file-opener") nextAnnotation();
    }
    expect(navigate.mock.calls.map(([id]) => id)).toEqual(["app-shell-thread", "app-shell-panel"]);
    const modes = container.querySelectorAll<HTMLButtonElement>("[data-guide-display-mode] button");
    act(() => modes[1]!.click());
    expect(current().getAttribute("data-map-section")).toBe("app-shell");
    act(() => modes[0]!.click());
    expect(visiblePage()).toBe("Side panel");
    act(() => next.click());
    expect(visiblePage()).toBe("Command palette");
    act(() => next.click());
    expect(visiblePage()).toBe("The composer");
    expect(current().querySelectorAll("[data-guide-badge]")).toHaveLength(7);
    const navigation = container.querySelector("[data-guide-page-list-scroll]")!;
    const swipe = (dx: number, dy = 0) => {
      for (const [type, x, y] of [
        ["touchstart", 150, 100],
        ["touchend", 150 + dx, 100 + dy],
      ] as const) {
        const touch = { clientX: x, clientY: y };
        act(() => {
          navigation.dispatchEvent(
            Object.assign(new Event(type, { bubbles: true }), {
              touches: [touch],
              changedTouches: [touch],
            }),
          );
        });
      }
    };
    swipe(-80);
    expect(visiblePage()).toBe("Home page");
    swipe(-10, 80);
    expect(visiblePage()).toBe("Home page");
    swipe(-80);
    expect(visiblePage()).toBe("New thread actions");
    expect(current().querySelector('[data-guide-region="new-thread-panel"]')).not.toBeNull();
    swipe(80);
    expect(visiblePage()).toBe("Home page");
    for (let step = 0; step < 4; step++) act(() => next.click());
    expect(visiblePage()).toBe("Plugin backend");
    expect(next.disabled).toBe(true);
    swipe(-80);
    expect(visiblePage()).toBe("Plugin backend");
  } finally {
    act(() => root.unmount());
    container.remove();
    if (scrollIntoView) HTMLElement.prototype.scrollIntoView = scrollIntoView;
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
});
