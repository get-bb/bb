// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpandablePanel } from "@/components/ui/disclosure";

class ResizeObserverStub implements ResizeObserver {
  static instances: ResizeObserverStub[] = [];

  readonly observedTargets: Element[] = [];

  constructor(readonly callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this);
  }

  observe: ResizeObserver["observe"] = vi.fn((target: Element) => {
    this.observedTargets.push(target);
  });
  unobserve: ResizeObserver["unobserve"] = vi.fn();
  disconnect: ResizeObserver["disconnect"] = vi.fn();
}

afterEach(() => {
  ResizeObserverStub.instances.length = 0;
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function lastObserver(): ResizeObserverStub {
  const observer = ResizeObserverStub.instances.at(-1);
  if (!observer) {
    throw new Error("No ResizeObserver was installed");
  }
  return observer;
}

function makeEntry(target: Element, blockSize: number): ResizeObserverEntry {
  return {
    target,
    contentRect: new DOMRect(0, 0, 200, blockSize),
    borderBoxSize: [{ blockSize, inlineSize: 200 }],
    contentBoxSize: [{ blockSize, inlineSize: 200 }],
    devicePixelContentBoxSize: [{ blockSize, inlineSize: 200 }],
  };
}

describe("ExpandablePanel on the shared observer", () => {
  function renderTwoPanels() {
    return render(
      <>
        <ExpandablePanel
          isExpanded
          summaryContent="First tool call"
          headerToneClass="text-foreground"
          collapsedContent={<span>First summary</span>}
        >
          <span>First body</span>
        </ExpandablePanel>
        <ExpandablePanel
          isExpanded
          summaryContent="Second tool call"
          headerToneClass="text-foreground"
          collapsedContent={<span>Second summary</span>}
        >
          <span>Second body</span>
        </ExpandablePanel>
      </>,
    );
  }

  it("mounts many panels onto one observer and sizes each from its own entry", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const view = renderTwoPanels();

    expect(ResizeObserverStub.instances).toHaveLength(1);
    expect(lastObserver().observedTargets).toHaveLength(2);

    const regionOf = (text: string) => {
      const region =
        view.getByText(text).parentElement?.parentElement?.parentElement;
      if (!region) {
        throw new Error("Panel body region was not rendered");
      }
      return region;
    };
    const firstRegion = regionOf("First body");
    const secondRegion = regionOf("Second body");
    const [firstTarget, secondTarget] = lastObserver().observedTargets;
    if (!firstTarget || !secondTarget) {
      throw new Error("Panel bodies were not observed");
    }

    act(() => {
      lastObserver().callback(
        [makeEntry(firstTarget, 40), makeEntry(secondTarget, 60)],
        lastObserver(),
      );
    });

    expect(firstRegion.style.height).toBe("40px");
    expect(secondRegion.style.height).toBe("60px");
  });
});
