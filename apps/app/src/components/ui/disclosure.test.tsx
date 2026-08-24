// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpandablePanel } from "./disclosure";

class ResizeObserverStub implements ResizeObserver {
  static instances: ResizeObserverStub[] = [];

  constructor(readonly callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this);
  }

  observe: ResizeObserver["observe"] = vi.fn();
  unobserve: ResizeObserver["unobserve"] = vi.fn();
  disconnect: ResizeObserver["disconnect"] = vi.fn();
}

afterEach(() => {
  ResizeObserverStub.instances.length = 0;
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderPanel(isExpanded: boolean) {
  return render(
    <ExpandablePanel
      isExpanded={isExpanded}
      summaryContent="Tool call"
      headerToneClass="text-foreground"
      collapsedContent={<span>Collapsed summary</span>}
    >
      <span>Expanded body</span>
    </ExpandablePanel>,
  );
}

function fireResize(): void {
  const observer = ResizeObserverStub.instances.at(-1);
  if (!observer) {
    throw new Error("No ResizeObserver was installed");
  }
  act(() => {
    observer.callback([], observer);
  });
}

describe("ExpandablePanel body height", () => {
  it("snaps content growth inside an open body but eases the toggle", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const view = renderPanel(true);
    const region =
      view.getByText("Expanded body").parentElement?.parentElement
        ?.parentElement;
    if (!region) {
      throw new Error("Panel body region was not rendered");
    }

    // Mount is not a toggle: no easing.
    expect(region.style.transitionDuration).toBe("0s");

    // A streaming delta grows the open body: still no easing, so the region
    // does not restart a 200ms tween per delta under the timeline's
    // AutoHeightContainer.
    fireResize();
    expect(region.style.transitionDuration).toBe("0s");

    // An expand/collapse toggle restores the class-driven 200ms ease.
    view.rerender(
      <ExpandablePanel
        isExpanded={false}
        summaryContent="Tool call"
        headerToneClass="text-foreground"
        collapsedContent={<span>Collapsed summary</span>}
      >
        <span>Expanded body</span>
      </ExpandablePanel>,
    );
    expect(region.style.transitionDuration).toBe("");

    // Growth after the toggle window is over snaps again.
    vi.spyOn(performance, "now").mockReturnValue(performance.now() + 10_000);
    fireResize();
    expect(region.style.transitionDuration).toBe("0s");
  });
});
