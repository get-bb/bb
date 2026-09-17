/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { ProductMap } from "../src/product-map";

afterEach(() => vi.unstubAllGlobals());

it("defaults to mobile and keeps the selected annotation when switching layouts", () => {
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
  } finally {
    act(() => root.unmount());
    container.remove();
    if (scrollIntoView) HTMLElement.prototype.scrollIntoView = scrollIntoView;
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
});
