// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeightTransition } from "./height-transition";

class ResizeObserverStub implements ResizeObserver {
  observe: ResizeObserver["observe"] = vi.fn();
  unobserve: ResizeObserver["unobserve"] = vi.fn();
  disconnect: ResizeObserver["disconnect"] = vi.fn();
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HeightTransition", () => {
  it("pauses descendant animations while preserving collapsed content state", () => {
    const view = render(
      <HeightTransition visible={false}>
        <span data-testid="animated-child">Working...</span>
      </HeightTransition>,
    );

    const child = view.getByTestId("animated-child");
    const wrapper = child.parentElement?.parentElement;
    expect(wrapper?.className).toContain(
      "[&_*]:![animation-play-state:paused]",
    );

    view.rerender(
      <HeightTransition visible>
        <span data-testid="animated-child">Working...</span>
      </HeightTransition>,
    );

    expect(view.getByTestId("animated-child")).toBe(child);
    expect(wrapper?.className).not.toContain(
      "[&_*]:![animation-play-state:paused]",
    );
  });

  it("snap-syncs its height after a mobile pageshow restore", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const offsetHeight = vi
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockReturnValue(40);
    const view = render(
      <HeightTransition visible>
        <span data-testid="restored-child">Restored content</span>
      </HeightTransition>,
    );
    const wrapper = view.getByTestId("restored-child").parentElement
      ?.parentElement;

    expect(wrapper?.style.height).toBe("40px");
    offsetHeight.mockReturnValue(80);

    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });

    expect(wrapper?.style.height).toBe("80px");
    expect(wrapper?.style.transitionDuration).toBe("0s");
  });
});
