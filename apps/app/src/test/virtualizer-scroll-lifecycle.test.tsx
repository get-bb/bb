// @vitest-environment jsdom

import { useVirtualizer, useWindowVirtualizer } from "@tanstack/react-virtual";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

function ElementVirtualizer({
  scrollElement,
  onChange,
}: {
  scrollElement: HTMLElement;
  onChange: () => void;
}) {
  useVirtualizer({
    count: 100,
    estimateSize: () => 32,
    getScrollElement: () => scrollElement,
    onChange,
  });
  return null;
}

function WindowVirtualizer({ onChange }: { onChange: () => void }) {
  useWindowVirtualizer({
    count: 100,
    estimateSize: () => 32,
    onChange,
  });
  return null;
}

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("virtualizer scroll lifecycle", () => {
  it.each(["element", "window"] as const)(
    "cancels the pending scroll reset when the %s virtualizer unmounts",
    (target) => {
      vi.useFakeTimers();
      const onChange = vi.fn();
      const scrollElement = document.createElement("div");
      const rendered = render(
        target === "element" ? (
          <ElementVirtualizer
            scrollElement={scrollElement}
            onChange={onChange}
          />
        ) : (
          <WindowVirtualizer onChange={onChange} />
        ),
      );
      fireEvent.scroll(target === "element" ? scrollElement : window);
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      rendered.unmount();
      onChange.mockClear();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(300);
      expect(onChange).not.toHaveBeenCalled();
    },
  );
});
