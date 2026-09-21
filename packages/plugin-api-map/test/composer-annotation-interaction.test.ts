/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { RealComposerAnnotated, SurfaceMapContext } from "../src/wireframes";

it("opens each composer control's own card without capturing neighboring annotations", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const select = vi.fn();
  try {
    act(() => root.render(createElement(SurfaceMapContext.Provider, {
      value: { activeId: null, setActiveId: () => {}, numberOf: () => 1, onSelect: select },
    }, createElement(RealComposerAnnotated, { mobile: true }))));
    for (const id of [
      "composer-banners", "composer-state", "mention-provider", "composer-rich-text",
      "composer-plus-menu", "provider-picker", "composer-actions",
    ]) {
      select.mockClear();
      const target = container.querySelector<HTMLElement>(
        `[data-guide-target="${id}"], [data-guide-region="${id}"] a`,
      );
      expect(target, id).not.toBeNull();
      act(() => target!.click());
      expect(select.mock.calls, id).toEqual([[id]]);
    }
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
