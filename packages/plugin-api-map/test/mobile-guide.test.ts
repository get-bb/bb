/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { ProductMap } from "../src/product-map";

afterEach(() => vi.unstubAllGlobals());

it("pages mobile surfaces by controls and swipe while preserving annotation selection across layouts", () => {
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
  HTMLElement.prototype.scrollIntoView = () => {};
  try {
    act(() => root.render(createElement(ProductMap)));
    const current = () =>
      container.querySelector('[data-map-section="app-shell"]');
    expect(
      current()?.querySelector('[data-guide-mobile-scene="navigation"]'),
    ).not.toBeNull();
    const picker = container.querySelector<HTMLSelectElement>(
      '[aria-label="Explore an annotation"]',
    )!;
    const select = (id: string) =>
      act(() => {
        picker.value = id;
        picker.dispatchEvent(new Event("change", { bubbles: true }));
      });
    select("thread-panel");
    expect(
      current()?.querySelector('[data-guide-mobile-scene="panel"]'),
    ).not.toBeNull();
    expect(
      current()?.querySelector('[data-guide-tab-body="thread-panel"]'),
    ).not.toBeNull();
    const modes = container.querySelectorAll<HTMLButtonElement>(
      "[data-guide-display-mode] button",
    );
    act(() => modes[1]!.click());
    expect(
      current()?.querySelector(
        '[data-guide-responsive-strategy="scale-together"]',
      ),
    ).not.toBeNull();
    expect(picker.value).toBe("thread-panel");
    act(() => modes[0]!.click());
    expect(
      current()?.querySelector('[data-guide-mobile-scene="panel"]'),
    ).not.toBeNull();
    expect(picker.value).toBe("thread-panel");
    select("message-actions");
    expect(
      current()?.querySelector('[data-guide-mobile-scene="conversation"]'),
    ).not.toBeNull();
    expect(
      current()?.querySelector(
        '[data-guide-fixture="message-action-selection-toolbar"]',
      ),
    ).not.toBeNull();
    select("sidebar-footer");
    expect(
      current()?.querySelector('[data-guide-mobile-scene="navigation"]'),
    ).not.toBeNull();
    const visiblePage = () => {
      const buttons = container.querySelectorAll(
        "[data-guide-page-list-scroll] li:not([hidden]) button",
      );
      expect(buttons).toHaveLength(1);
      return buttons[0]!.textContent;
    };
    const next = container.querySelector<HTMLButtonElement>(
      '[aria-label="Next surface"]',
    )!;
    expect(visiblePage()).toBe("The bb app window");
    act(() => next.click());
    expect(visiblePage()).toBe("Command palette");
    act(() => next.click());
    expect(visiblePage()).toBe("The composer");
    select("provider-picker");
    const badges = container.querySelectorAll(
      '[data-map-section="composer"] [data-guide-badge]',
    );
    expect(badges).toHaveLength(1);
    expect(badges[0]?.getAttribute("data-guide-badge")).toBe("provider-picker");
    const navigation = container.querySelector(
      "[data-guide-page-list-scroll]",
    )!;
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
    expect(picker.value).toBe("");
    swipe(-10, 80);
    expect(visiblePage()).toBe("Home page");
    swipe(80);
    expect(visiblePage()).toBe("The composer");
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
